// ============================================================================
// dispositivo.service — El asistente de escritorio para la consulta presencial
// (firmware en dispositivo/ de este repo).
//
// Tres partes:
//  1) Emparejamiento, como un televisor: la placa pide un código y lo muestra;
//     el médico, con su sesión del panel, lo escribe en "Vincular dispositivo";
//     la placa, que guardó un secreto al pedir el código, reclama su token. Ver
//     el código en la pantalla no alcanza para robarlo: hace falta el secreto.
//  2) Autenticación: el token (solo su hash vive en la base) se convierte en la
//     MISMA sesión que tendría el médico en el panel, leída de `usuarios` en
//     cada petición. Desactivar al usuario, darlo de baja o revocar el
//     dispositivo corta el acceso enseguida, y la auditoría queda a su nombre.
//  3) La consulta: buscar la cita de hoy por cédula (solo citas agendadas con
//     ESE médico), la guía del programa con lo que ya se sabe del paciente,
//     guardar lo transcrito frase a frase, proponer los campos y cerrar.
// ============================================================================

import crypto from 'crypto';
import postgresService from './postgres.service';
import usuariosService from './usuarios.service';
import bajasService from './bajas.service';
import medicalHistoryService from './medical-history.service';
import historiaMutationService from './historia-mutation.service';
import corporativoSheetService from './corporativo-sheet.service';
import { openai } from './openai.service';
import { SessionPayload } from './auth.service';
import {
  camposDe,
  pasosPara,
  promptExtraccion,
  puedeLlenar,
  validarExtraccion,
  GUIAS,
  Programa,
} from '../helpers/guias-dispositivo';
import {
  edadDesde,
  formatearCodigo,
  generarCodigo,
  generarSecreto,
  generarToken,
  hashSecreto,
  hoyColombia,
  tieneValor,
  transcripcionPorPasos,
  Segmento,
} from '../helpers/dispositivo.helper';

const VIGENCIA_CODIGO_MIN = 10;

export interface Autenticado {
  dispositivoId: number;
  sesion: SessionPayload;
  /** Placa de pruebas: ve la historia de cualquier paciente, sea del profesional que sea (solo lectura). */
  veTodo: boolean;
}

export type ResultadoReclamo =
  | { estado: 'pendiente' }
  | { estado: 'listo'; token: string; medico: string }
  | { estado: 'invalido' };

export type ResultadoBusqueda =
  | { estado: 'ok'; historia: HistoriaRow }
  | { estado: 'SIN_CITA' }
  | { estado: 'YA_ATENDIDA' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HistoriaRow = Record<string, any>;

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "12-ago-2026", en hora de Colombia. */
function fechaCorta(v: unknown): string | null {
  if (!v) return null;
  const f = new Date(v as string);
  if (Number.isNaN(f.getTime())) return null;
  const co = new Date(f.getTime() - 5 * 60 * 60 * 1000);
  return `${co.getUTCDate()}-${MESES[co.getUTCMonth()]}-${co.getUTCFullYear()}`;
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nombreCompleto(h: HistoriaRow): string {
  return [h.primerNombre, h.segundoNombre, h.primerApellido, h.segundoApellido]
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x: string) => x.trim())
    .join(' ');
}

function recortar(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// Columnas que se leen de la historia: identidad, estado y todo lo que tocan
// las guías. Los nombres salen de listas fijas (nunca del pedido).
const COLUMNAS_BASE = [
  '_id', 'numeroId', 'primerNombre', 'segundoNombre', 'primerApellido', 'segundoApellido',
  'fecha_nacimiento', 'genero_biologico', 'fechaAtencion', 'horaAtencion', 'atendido',
  'fechaConsulta', 'medico', 'origen',
];
const COLUMNAS_GUIAS = Array.from(new Set([...camposDe('umv'), ...camposDe('corporativo')].map((c) => c.field)));
const COLUMNAS_RESUMEN = [
  'cc_peso_nuevo', 'mc_peso', 'peso', 'cc_estatura_nuevo', 'mc_talla', 'talla', 'tas', 'tad',
  'mc_frec_card', 'riesgo_final', 'mc_riesgo_bodytech', '_createdDate',
];
const SELECT_HISTORIA = Array.from(new Set([...COLUMNAS_BASE, ...COLUMNAS_GUIAS, ...COLUMNAS_RESUMEN]))
  .map((c) => `"${c}"`)
  .join(', ');

class DispositivoService {
  // ==========================================================================
  // 1) Emparejamiento
  // ==========================================================================

  /** La placa pide un código. Devuelve también el secreto, que solo ella guarda. */
  async iniciarEmparejamiento(): Promise<{ codigo: string; mostrar: string; secreto: string; venceEn: Date } | null> {
    // Limpieza oportunista: los códigos vencidos no sirven para nada.
    await postgresService.query(
      `DELETE FROM dispositivo_emparejamientos WHERE vence_en < NOW() - INTERVAL '1 day'`
    );
    const secreto = generarSecreto();
    const venceEn = new Date(Date.now() + VIGENCIA_CODIGO_MIN * 60 * 1000);
    for (let intento = 0; intento < 3; intento++) {
      const codigo = generarCodigo();
      const rows = await postgresService.query(
        `INSERT INTO dispositivo_emparejamientos (codigo, secreto_hash, vence_en)
         VALUES ($1, $2, $3)
         ON CONFLICT (codigo) DO NOTHING
         RETURNING codigo`,
        [codigo, hashSecreto(secreto), venceEn]
      );
      if (rows === null) return null;
      if (rows.length) return { codigo, mostrar: formatearCodigo(codigo), secreto, venceEn };
    }
    return null;
  }

  /** El médico escribe el código en su panel. */
  async confirmarEmparejamiento(
    codigo: string,
    usuarioId: number
  ): Promise<'ok' | 'NO_EXISTE' | 'VENCIDO' | 'YA_USADO' | 'DB_ERROR'> {
    const rows = await postgresService.query(
      `SELECT vence_en, usuario_id FROM dispositivo_emparejamientos WHERE codigo = $1`,
      [codigo]
    );
    if (rows === null) return 'DB_ERROR';
    if (!rows.length) return 'NO_EXISTE';
    if (new Date(rows[0].vence_en) < new Date()) return 'VENCIDO';
    if (rows[0].usuario_id !== null) return 'YA_USADO';
    const upd = await postgresService.query(
      `UPDATE dispositivo_emparejamientos
          SET usuario_id = $2, confirmado_en = NOW()
        WHERE codigo = $1 AND usuario_id IS NULL AND vence_en > NOW()
        RETURNING codigo`,
      [codigo, usuarioId]
    );
    if (upd === null) return 'DB_ERROR';
    return upd.length ? 'ok' : 'YA_USADO';
  }

  /** La placa pregunta si ya la vincularon. El token se entrega UNA sola vez. */
  async reclamar(codigo: string, secreto: string): Promise<ResultadoReclamo | null> {
    const rows = await postgresService.query(
      `SELECT secreto_hash, vence_en, usuario_id, dispositivo_id
         FROM dispositivo_emparejamientos WHERE codigo = $1`,
      [codigo]
    );
    if (rows === null) return null;
    if (!rows.length) return { estado: 'invalido' };
    const r = rows[0];
    const esperado = Buffer.from(r.secreto_hash, 'hex');
    const dado = Buffer.from(hashSecreto(secreto), 'hex');
    if (esperado.length !== dado.length || !crypto.timingSafeEqual(esperado, dado)) return { estado: 'invalido' };
    if (r.dispositivo_id !== null) return { estado: 'invalido' };
    if (r.usuario_id === null) {
      return new Date(r.vence_en) < new Date() ? { estado: 'invalido' } : { estado: 'pendiente' };
    }

    // Se marca como reclamado ANTES de crear el token: dos pedidos a la vez no
    // pueden sacar dos tokens del mismo código.
    const tomado = await postgresService.query(
      `UPDATE dispositivo_emparejamientos SET dispositivo_id = 0
        WHERE codigo = $1 AND dispositivo_id IS NULL RETURNING usuario_id`,
      [codigo]
    );
    if (tomado === null) return null;
    if (!tomado.length) return { estado: 'invalido' };

    const usuario = await usuariosService.findActiveById(tomado[0].usuario_id);
    if (!usuario) return { estado: 'invalido' };
    const token = generarToken();
    const disp = await postgresService.query(
      `INSERT INTO dispositivos (usuario_id, token_hash) VALUES ($1, $2) RETURNING id`,
      [usuario.id, hashSecreto(token)]
    );
    if (!disp || !disp.length) return null;
    await postgresService.query(
      `UPDATE dispositivo_emparejamientos SET dispositivo_id = $2 WHERE codigo = $1`,
      [codigo, disp[0].id]
    );
    return { estado: 'listo', token, medico: usuario.nombre };
  }

  // ==========================================================================
  // 2) Autenticación y gestión desde el panel
  // ==========================================================================

  /** Token de la placa → la sesión del médico. null si no sirve. */
  async autenticar(token: string): Promise<Autenticado | null> {
    const rows = await postgresService.query(
      `SELECT id, usuario_id, ultimo_uso_en, ve_todo FROM dispositivos
        WHERE token_hash = $1 AND revocado_en IS NULL`,
      [hashSecreto(token)]
    );
    if (!rows || !rows.length) return null;
    const d = rows[0];
    const usuario = await usuariosService.findActiveById(d.usuario_id);
    if (!usuario) return null;
    if (await bajasService.estaDeBaja(usuario.email)) return null;
    const s = await usuariosService.toSesion(usuario);
    // Para "último uso" en el panel basta con minutos; no se escribe en cada petición.
    if (!d.ultimo_uso_en || Date.now() - new Date(d.ultimo_uso_en).getTime() > 5 * 60 * 1000) {
      postgresService
        .query(`UPDATE dispositivos SET ultimo_uso_en = NOW() WHERE id = $1`, [d.id])
        .catch(() => undefined);
    }
    return {
      dispositivoId: Number(d.id),
      veTodo: d.ve_todo === true,
      sesion: {
        kind: 'session',
        userId: s.id,
        email: s.email,
        nombre: s.nombre,
        role: s.rol,
        sedes: s.sedes,
        esGlobal: s.esGlobal,
        codigo: s.codigo,
        especialidad: s.especialidad,
      },
    };
  }

  async listar(usuarioId: number): Promise<unknown[] | null> {
    return postgresService.query(
      `SELECT id, nombre, creado_en, ultimo_uso_en FROM dispositivos
        WHERE usuario_id = $1 AND revocado_en IS NULL ORDER BY creado_en DESC`,
      [usuarioId]
    );
  }

  /** Solo el dueño revoca el suyo. */
  async revocar(id: number, usuarioId: number): Promise<boolean | null> {
    const rows = await postgresService.query(
      `UPDATE dispositivos SET revocado_en = NOW()
        WHERE id = $1 AND usuario_id = $2 AND revocado_en IS NULL RETURNING id`,
      [id, usuarioId]
    );
    return rows === null ? null : rows.length > 0;
  }

  // ==========================================================================
  // 3) La consulta
  // ==========================================================================

  /** La cita de HOY de esa cédula con ESE médico. No se crean citas desde acá. */
  async buscarCitaHoy(medicoCodigo: string, cedula: string): Promise<ResultadoBusqueda | null> {
    const { inicio, fin } = hoyColombia();
    // `fechaAtencion` es TEXT con tres formatos mezclados ("-05:00", "Z" y
    // "+00:00"): comparado como texto, el resultado depende de la zona horaria
    // del servidor. Se compara como instante. La guarda va en un CASE (en un
    // AND, Postgres no garantiza el orden) para que una fila mal formada no
    // aborte la consulta.
    const instante = `(CASE WHEN "fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN "fechaAtencion"::timestamptz END)`;
    const rows = await postgresService.query(
      `SELECT ${SELECT_HISTORIA} FROM "HistoriaClinica"
        WHERE "medico" = $1 AND "numeroId" = $2
          AND ${instante} >= $3::timestamptz
          AND ${instante} <= $4::timestamptz
        ORDER BY ("fechaConsulta" IS NULL) DESC, ${instante} ASC
        LIMIT 1`,
      [medicoCodigo, cedula, inicio.toISOString(), fin.toISOString()]
    );
    if (rows === null) return null;
    if (!rows.length) return { estado: 'SIN_CITA' };
    if (rows[0].fechaConsulta) return { estado: 'YA_ATENDIDA' };
    return { estado: 'ok', historia: rows[0] };
  }

  /**
   * Placa de pruebas (`ve_todo`): la cédula, sea del profesional que sea. La
   * cita abierta de hoy si hay; si no, la historia más reciente del paciente.
   */
  async buscarCualquiera(cedula: string): Promise<{ historia: HistoriaRow; deHoy: boolean } | null | 'SIN_HISTORIA'> {
    const { inicio, fin } = hoyColombia();
    const instante = `(CASE WHEN "fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN "fechaAtencion"::timestamptz END)`;
    const hoy = await postgresService.query(
      `SELECT ${SELECT_HISTORIA} FROM "HistoriaClinica"
        WHERE "numeroId" = $1 AND "fechaConsulta" IS NULL
          AND ${instante} >= $2::timestamptz AND ${instante} <= $3::timestamptz
        ORDER BY ${instante} ASC LIMIT 1`,
      [cedula, inicio.toISOString(), fin.toISOString()]
    );
    if (hoy === null) return null;
    if (hoy.length) return { historia: hoy[0], deHoy: true };
    const ultima = await postgresService.query(
      `SELECT ${SELECT_HISTORIA} FROM "HistoriaClinica" WHERE "numeroId" = $1
        ORDER BY COALESCE("fechaConsulta", "_createdDate") DESC LIMIT 1`,
      [cedula]
    );
    if (ultima === null) return null;
    return ultima.length ? { historia: ultima[0], deHoy: false } : 'SIN_HISTORIA';
  }

  /** Nombre y especialidad del profesional de una historia (para el encabezado y la guía). */
  async profesional(codigo: string | null | undefined): Promise<{ nombre: string; especialidad: string | null } | null> {
    if (!codigo) return null;
    const rows = await postgresService.query(
      `SELECT concat_ws(' ', primer_nombre, primer_apellido) AS nombre, especialidad
         FROM profesionales WHERE codigo = $1 LIMIT 1`,
      [codigo]
    );
    if (!rows || !rows.length) return null;
    return { nombre: String(rows[0].nombre ?? '').replace(/\s+/g, ' ').trim(), especialidad: rows[0].especialidad ?? null };
  }

  /** "Cita de hoy 23:30 · Paula Mora" / "12-ago-2026 · Paula Mora": de quién y de cuándo. */
  encabezado(historia: HistoriaRow, deHoy: boolean, profesional: string | null): string {
    const cuando = deHoy
      ? `Cita de hoy${historia.horaAtencion ? ` ${historia.horaAtencion}` : ''}`
      : fechaCorta(historia.fechaConsulta ?? historia.fechaAtencion ?? historia._createdDate) ?? 'Sin fecha';
    return `${cuando} · ${profesional || historia.medico || 'sin profesional'}`;
  }

  /** La historia, solo si es de ese médico. */
  async historiaDelMedico(historiaId: string, medicoCodigo: string): Promise<HistoriaRow | null> {
    const rows = await postgresService.query(
      `SELECT ${SELECT_HISTORIA} FROM "HistoriaClinica" WHERE "_id" = $1 AND "medico" = $2`,
      [historiaId, medicoCodigo]
    );
    return rows && rows.length ? rows[0] : null;
  }

  /** Visitas atendidas anteriores del paciente, de la más reciente a la más vieja. */
  async visitasAnteriores(numeroId: string, excluirId: string): Promise<HistoriaRow[]> {
    const rows = await postgresService.query(
      `SELECT ${SELECT_HISTORIA} FROM "HistoriaClinica"
        WHERE "numeroId" = $1 AND "_id" <> $2 AND "atendido" = 'ATENDIDO'
        ORDER BY COALESCE("fechaConsulta", "_createdDate") DESC
        LIMIT 10`,
      [numeroId, excluirId]
    );
    return rows ?? [];
  }

  /** Lo que ve el médico al abrir la consulta: paciente, resumen y la guía. */
  armarConsulta(historia: HistoriaRow, programa: Programa, anteriores: HistoriaRow[], encabezado?: string) {
    const paciente = {
      cedula: historia.numeroId,
      nombre: nombreCompleto(historia),
      edad: edadDesde(historia.fecha_nacimiento),
      genero: historia.genero_biologico ?? null,
    };

    const medidas = anteriores.map((h) => {
      const peso = numero(h.cc_peso_nuevo) ?? numero(h.mc_peso) ?? numero(h.peso);
      let talla = numero(h.cc_estatura_nuevo) ?? numero(h.mc_talla) ?? numero(h.talla);
      if (talla !== null && talla < 3) talla *= 100; // hay tallas guardadas en metros
      const imc = peso && talla ? Math.round((peso / (talla / 100) ** 2) * 10) / 10 : null;
      return {
        fecha: fechaCorta(h.fechaConsulta ?? h._createdDate),
        peso,
        imc,
        tas: numero(h.tas),
        tad: numero(h.tad),
        riesgo: (h.riesgo_final || h.mc_riesgo_bodytech || null) as string | null,
      };
    });

    // Líneas listas para la pantalla de 2,8": el firmware solo las pinta.
    const lineas: string[] = [];
    if (!medidas.length) {
      lineas.push('Primera consulta registrada');
    } else {
      const u = medidas[0];
      lineas.push(`${medidas.length} ${medidas.length === 1 ? 'visita' : 'visitas'} · última ${u.fecha ?? '—'}`);
      const conPeso = medidas.filter((m) => m.peso !== null);
      if (conPeso.length) {
        const p = conPeso[0].peso!;
        const antes = conPeso[1]?.peso;
        const delta = antes ? Math.round((p - antes) * 10) / 10 : null;
        const d = delta === null ? '' : ` (${delta > 0 ? '+' : ''}${String(delta).replace('.', ',')})`;
        lineas.push(`Peso ${String(p).replace('.', ',')} kg${d}${conPeso[0].imc ? ` · IMC ${String(conPeso[0].imc).replace('.', ',')}` : ''}`);
      }
      const conTa = medidas.find((m) => m.tas && m.tad);
      if (conTa) lineas.push(`TA ${conTa.tas}/${conTa.tad}`);
      const conRiesgo = medidas.find((m) => m.riesgo);
      if (conRiesgo) lineas.push(`Riesgo ${String(conRiesgo.riesgo).toLowerCase()}`);
    }

    // Cada paso lleva lo que ya se sabe: lo de esta historia si el médico ya lo
    // escribió (p. ej. en el computador), si no lo de la última visita.
    const pasos = pasosPara(programa, paciente.genero).map((p) => {
      const texto = p.campos.find((c) => c.tipo === 'texto');
      let nota: string | null = null;
      if (texto && tieneValor(historia[texto.field])) {
        nota = `Ya registrado: ${recortar(String(historia[texto.field]), 110)}`;
      } else if (texto) {
        const prev = anteriores.find((h) => tieneValor(h[texto.field]));
        if (prev) {
          nota = `${fechaCorta(prev.fechaConsulta ?? prev._createdDate) ?? 'Antes'}: ${recortar(String(prev[texto.field]), 100)}`;
        }
      }
      return { id: p.id, tema: p.tema, pregunta: p.pregunta, pista: p.pista ?? null, nota };
    });

    return {
      historiaId: historia._id as string,
      programa,
      encabezado: encabezado ?? null,
      // La placa de pruebas puede abrir historias ajenas o ya cerradas: solo para mirar.
      soloLectura: Boolean(historia.fechaConsulta),
      hora: historia.horaAtencion ?? null,
      paciente,
      resumen: { visitas: medidas.length, ultimas: medidas.slice(0, 3), lineas },
      pasos,
    };
  }

  /** Guarda las frases que mandó la placa. Un reintento con el mismo `seq` no duplica. */
  async guardarSegmentos(
    historiaId: string,
    dispositivoId: number,
    segmentos: { seq: number; paso: string | null; texto: string }[]
  ): Promise<number | null> {
    let guardados = 0;
    for (const s of segmentos) {
      const rows = await postgresService.query(
        `INSERT INTO consulta_segmentos (historia_id, dispositivo_id, seq, paso, texto)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (historia_id, dispositivo_id, seq) DO NOTHING
         RETURNING id`,
        [historiaId, dispositivoId, s.seq, s.paso, s.texto]
      );
      if (rows === null) return null;
      guardados += rows.length;
    }
    return guardados;
  }

  async segmentos(historiaId: string): Promise<Segmento[] | null> {
    const rows = await postgresService.query(
      `SELECT paso, texto FROM consulta_segmentos
        WHERE historia_id = $1 ORDER BY creado_en ASC, dispositivo_id ASC, seq ASC`,
      [historiaId]
    );
    return rows as Segmento[] | null;
  }

  transcripcion(segmentos: Segmento[], programa: Programa): string {
    const temas = Object.fromEntries(GUIAS[programa].map((p) => [p.id, p.tema]));
    return transcripcionPorPasos(segmentos, temas);
  }

  /**
   * Lo que la IA propone para la historia, solo donde se puede llenar (ver
   * puedeLlenar: lo que el médico ya escribió no se toca). Nada se guarda todavía.
   */
  async borrador(historia: HistoriaRow, programa: Programa, transcripcion: string) {
    if (!transcripcion.trim()) return [];
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: [
        { role: 'system', content: promptExtraccion(programa) },
        { role: 'user', content: `Transcripción de la consulta:\n\n${transcripcion}` },
      ],
    });
    let crudo: unknown = null;
    try {
      crudo = JSON.parse(resp.choices?.[0]?.message?.content ?? '');
    } catch {
      crudo = null;
    }
    const valores = validarExtraccion(programa, crudo);
    return camposDe(programa)
      .filter((c) => c.field in valores && puedeLlenar(c.tipo, historia[c.field], valores[c.field]))
      .map((c) => ({ field: c.field, etiqueta: c.etiqueta, tipo: c.tipo, valor: valores[c.field] }));
  }

  /**
   * Guarda lo que el médico aprobó (solo campos de la guía y solo donde se
   * puede llenar), la transcripción completa, y cierra la consulta como el
   * botón "Finalizar" del panel.
   */
  async finalizar(
    historia: HistoriaRow,
    programa: Programa,
    campos: Record<string, unknown>,
    transcripcion: string
  ): Promise<{ guardados: string[]; omitidos: string[] }> {
    const permitidos = validarExtraccion(programa, campos);
    const tipos = Object.fromEntries(camposDe(programa).map((c) => [c.field, c.tipo]));
    const guardados: string[] = [];
    const omitidos: string[] = [];
    for (const [field, valor] of Object.entries(permitidos)) {
      if (!puedeLlenar(tipos[field], historia[field], valor)) {
        omitidos.push(field);
        continue;
      }
      const r = await medicalHistoryService.updateField(historia._id, field, valor);
      (r.success ? guardados : omitidos).push(field);
    }
    if (transcripcion.trim()) {
      await medicalHistoryService.updateField(historia._id, 'transcription_text', transcripcion);
      await medicalHistoryService.updateField(historia._id, 'transcription_status', 'done');
    }
    await historiaMutationService.marcarAtendida(historia._id);
    // Igual que el panel: la hoja del corporativo filtra sola lo que no es suyo.
    corporativoSheetService.encolar(historia._id).catch((e) => {
      console.error('[corporativo-sheet] encolar falló:', e?.message ?? e);
    });
    return { guardados, omitidos };
  }
}

export default new DispositivoService();
