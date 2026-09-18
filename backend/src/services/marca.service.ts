// ============================================================================
// marca.service — la marca por la que se le escribe al paciente de una cita.
// La regla vive en helpers/marca.helper.ts; acá solo se lee `codEmpresa`.
// ============================================================================

import postgresService from './postgres.service';
import { Marca, athleticActivo, marcaDeEnvio } from '../helpers/marca.helper';

/**
 * Marca de envío de una historia.
 *
 * Con Athletic apagado ni siquiera consulta: todo sale por Bodytech, igual que
 * antes. Encendido, si la base no responde también cae a Bodytech. Así el peor
 * caso es que un paciente de Athletic reciba el mensaje desde el número de
 * Bodytech, que es lo que pasaba antes de que esto existiera. No recibirlo sería
 * peor que recibirlo desde el número de la otra marca.
 */
export async function marcaDeEnvioParaHistoria(historiaId: string): Promise<Marca> {
  if (!athleticActivo()) return 'bodytech';
  try {
    const rows = await postgresService.query(
      `SELECT "codEmpresa" FROM "HistoriaClinica" WHERE "_id" = $1`,
      [historiaId]
    );
    if (rows === null) throw new Error('la base no respondió');
    return marcaDeEnvio(rows[0]?.codEmpresa);
  } catch (e: any) {
    console.warn(`⚠️ [marca] No se pudo leer codEmpresa de ${historiaId} (${e?.message ?? e}); se envía por Bodytech`);
    return 'bodytech';
  }
}
