// ============================================================================
// Sube a LA carpeta del paciente las consultas que ya existían.
//
// De acá en adelante cada guardado deja su entrada solo; esto es para las
// 4.551 consultas anteriores, que si no quedarían invisibles justo para el
// caso que importa: alguien que ya vino y vuelve por otro programa.
//
// Sin `--aplicar` sólo cuenta. Escribe por lotes y nunca toca `HistoriaClinica`.
// ============================================================================

import 'dotenv/config';
import postgresService from '../src/services/postgres.service';
import { getSharedPool } from '../src/services/shared-db';
import carpetaService from '../src/services/carpeta.service';

const APLICAR = process.argv.includes('--aplicar');
const LOTE = 400;

async function main(): Promise<void> {
  await carpetaService.asegurarEsquema();

  const total = await postgresService.query(
    `SELECT count(*)::int AS n FROM "HistoriaClinica"
      WHERE "numeroId" IS NOT NULL AND "numeroId" <> ''`,
  );
  const n = total?.[0]?.n ?? 0;
  console.log(`Consultas con cédula: ${n}`);
  if (!APLICAR) {
    console.log('Ensayo. Para escribir: npm run carpeta:llenar -- --aplicar');
    return;
  }

  const pool = getSharedPool();
  let offset = 0;
  let personas = 0;
  let entradas = 0;

  for (;;) {
    const filas = await postgresService.query(
      `SELECT "_id", "numeroId", "primerNombre", "primerApellido", "medico", "origen",
              "fechaConsulta", "fechaAtencion",
              motivo_consulta_texto, hallazgos_descripcion, "mdConceptoFinal",
              "mdRecomendacionesMedicasAdicionales",
              cc_peso_nuevo, cc_estatura_nuevo, tas, tad, fcr
         FROM "HistoriaClinica"
        WHERE "numeroId" IS NOT NULL AND "numeroId" <> ''
        ORDER BY "_id" LIMIT $1 OFFSET $2`,
      [LOTE, offset],
    );
    if (!filas || filas.length === 0) break;

    // Una transacción por lote: 4.551 escrituras sueltas por VPN son diez
    // minutos; por lotes, segundos.
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      for (const h of filas) {
        const doc = String(h.numeroId).replace(/\D/g, '');
        if (!doc) continue;
        const nombre = [h.primerNombre, h.primerApellido].filter(Boolean).join(' ').trim() || null;
        await cliente.query(
          `INSERT INTO afiliados (documento, nombre) VALUES ($1, $2)
           ON CONFLICT (documento) DO UPDATE
             SET nombre = COALESCE(afiliados.nombre, EXCLUDED.nombre)`,
          [doc, nombre],
        );
        personas++;
        const partes = [
          h.motivo_consulta_texto && `Motivo: ${h.motivo_consulta_texto}`,
          h.hallazgos_descripcion && `Hallazgos: ${h.hallazgos_descripcion}`,
          h.mdConceptoFinal && `Concepto: ${h.mdConceptoFinal}`,
        ].filter(Boolean);
        await cliente.query(
          `INSERT INTO historia_entradas
             (documento, app, servicio, origen_id, profesional, fecha, resumen, datos)
           VALUES ($1, 'consulta', $2, $3, $4, $5, $6, $7)
           ON CONFLICT (app, origen_id) DO NOTHING`,
          [
            doc,
            // El origen de la cita ES el servicio; lo demás es la consulta de siempre.
            ['trepsi', 'umv', 'corporativo'].includes(String(h.origen ?? '').toLowerCase())
              ? String(h.origen).toLowerCase()
              : 'nativa',
            String(h._id),
            h.medico ?? null,
            // `fechaAtencion` es TEXTO con formatos mezclados: se descarta lo
            // que no empiece por una fecha ISO en vez de reventar el lote.
            /^\d{4}-\d{2}-\d{2}/.test(String(h.fechaConsulta ?? h.fechaAtencion ?? ''))
              ? String(h.fechaConsulta ?? h.fechaAtencion)
              : null,
            partes.length > 0 ? partes.join(' · ') : null,
            JSON.stringify({
              peso: h.cc_peso_nuevo ?? null,
              estatura: h.cc_estatura_nuevo ?? null,
              tensionSistolica: h.tas ?? null,
              tensionDiastolica: h.tad ?? null,
              frecuenciaCardiaca: h.fcr ?? null,
              recomendaciones: h.mdRecomendacionesMedicasAdicionales ?? null,
            }),
          ],
        );
        entradas++;
      }
      await cliente.query('COMMIT');
    } catch (e) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      cliente.release();
    }

    offset += filas.length;
    console.log(`  ${offset}/${n}…`);
  }

  const { rows } = await pool.query(
    'SELECT count(DISTINCT documento)::int AS personas FROM historia_entradas',
  );
  console.log(`\nListo. ${entradas} entradas, ${rows[0].personas} personas con carpeta.`);
  void personas;
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exit(1);
  });
