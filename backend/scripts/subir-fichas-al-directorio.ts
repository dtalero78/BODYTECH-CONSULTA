// ============================================================================
// Sube al DIRECTORIO compartido las fichas de Consulta que nacieron antes de
// que el directorio fuera el primer paso obligatorio.
//
// La regla nueva es: quien quiera crear un profesional escribe PRIMERO en el
// directorio —venga por el Excel de RRHH, por el botón o por una API— y de ahí
// salen las cuentas. Las 13 fichas que ya existen en Consulta son anteriores a
// esa regla: 9 son coaches de Trepsi (que no son nómina de Bodytech y por eso
// nunca van a estar en el Excel de RRHH) y el resto se crearon a mano.
//
// Idempotente: no pisa a quien ya está en el directorio, y nunca toca a los de
// fuente 'rrhh'. Con `--aplicar` escribe; sin ese argumento sólo cuenta.
// ============================================================================

import 'dotenv/config';
import { Pool } from 'pg';
import postgresService from '../src/services/postgres.service';
import { getSharedPool } from '../src/services/shared-db';

const APLICAR = process.argv.includes('--aplicar');

interface Ficha {
  documento: string;
  nombre: string;
  rol: string;
  especialidad: string | null;
  citas_trepsi: number;
}

async function main(): Promise<void> {
  const filas = (await postgresService.query(
    `SELECT p.documento,
            trim(concat_ws(' ', p.primer_nombre, p.primer_apellido)) AS nombre,
            p.rol, p.especialidad,
            (SELECT count(*) FROM trepsi_appointments t
               JOIN "HistoriaClinica" h ON h._id = t.historia_id
              WHERE h.medico = p.codigo) AS citas_trepsi
       FROM profesionales p
      WHERE p.activo AND p.documento IS NOT NULL AND p.documento <> ''`,
  )) as Ficha[] | null;

  if (!filas || filas.length === 0) {
    console.log('No hay fichas con documento. Nada que subir.');
    return;
  }

  const shared: Pool = getSharedPool();
  let nuevas = 0;
  let yaEstaban = 0;

  for (const f of filas) {
    const { rows } = await shared.query('SELECT 1 FROM profesionales WHERE documento = $1', [
      f.documento,
    ]);
    if (rows.length > 0) {
      yaEstaban++;
      continue;
    }
    // El rol de Consulta ('medico' | 'coach') ya es vocabulario del directorio.
    const fuente = Number(f.citas_trepsi) > 0 ? 'trepsi' : 'manual';
    console.log(
      `${APLICAR ? '+' : '·'} ${f.documento}  ${f.nombre}  ${f.rol}  fuente=${fuente}` +
        (f.especialidad ? `  (${f.especialidad})` : ''),
    );
    if (APLICAR) {
      await shared.query(
        `INSERT INTO profesionales (documento, nombre, rol, cargo, ambito, fuente, activo)
         VALUES ($1, $2, $3, $4, 'virtual', $5, TRUE)
         ON CONFLICT (documento) DO NOTHING`,
        [f.documento, f.nombre, f.rol, f.especialidad ?? f.rol, fuente],
      );
    }
    nuevas++;
  }

  console.log(
    `\n${APLICAR ? 'Subidas' : 'Se subirían'}: ${nuevas}. Ya estaban en el directorio: ${yaEstaban}.`,
  );
  if (!APLICAR) console.log('Ensayo. Para escribir: npm run directorio:subir -- --aplicar');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exit(1);
  });
