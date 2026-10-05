// ============================================================================
// mybodytech-enlace.service — une la orden de MyBodytech con la cita de Trepsi
// de la misma persona (por cédula), para que el RIPS salga al cerrar la que
// de verdad se atiende. Reglas en helpers/mybodytech-enlace.helper.ts.
//
// Lo que MyBodytech ve NO cambia: el enlace vive en columnas propias
// (`historia_enlazada_id`, `enlazada_at`) y el RIPS sigue saliendo con SU
// eventoId y SU documento de profesional. A Trepsi tampoco le llega nada nuevo.
//
// Todo es best-effort: nunca lanza. Un fallo acá no puede tumbar el alta de una
// cita de Trepsi ni de una orden de MyBodytech.
// ============================================================================

import postgresService from './postgres.service';
import {
  diasVentanaEnlace,
  documentoEnlazable,
  documentoSql,
  normalizarDocumento,
} from '../helpers/mybodytech-enlace.helper';

class MybodytechEnlaceService {
  /**
   * Llegó una cita de Trepsi: si la cédula tiene una orden de MyBodytech
   * pendiente (RIPS sin enviar, su propia historia sin atender, sin otro
   * enlace), se le pega la historia de Trepsi. La más antigua primero.
   * Devuelve el eventoId enlazado, o null.
   */
  async enlazarDesdeTrepsi(historiaTrepsiId: string, numeroId: string): Promise<string | null> {
    try {
      const doc = normalizarDocumento(numeroId);
      if (!historiaTrepsiId || !documentoEnlazable(doc)) return null;

      const rows = await postgresService.query(
        `UPDATE mybodytech_afiliados a
            SET historia_enlazada_id = $1, enlazada_at = NOW(), updated_at = NOW()
          WHERE a.evento_id = (
                  SELECT m.evento_id
                    FROM mybodytech_afiliados m
                   WHERE ${documentoSql('m.numero_id')} = $2
                     AND COALESCE(m.fuente, 'mybodytech') = 'mybodytech'
                     AND m.historia_enlazada_id IS NULL
                     AND m.rips_estado IS DISTINCT FROM 'done'
                     AND m.historia_id IS DISTINCT FROM $1
                     AND m.created_at > NOW() - make_interval(days => $3)
                     AND NOT EXISTS (
                           SELECT 1 FROM "HistoriaClinica" h
                            WHERE h."_id" = m.historia_id AND h."atendido" = 'ATENDIDO')
                   ORDER BY m.created_at
                   LIMIT 1
                   FOR UPDATE SKIP LOCKED)
            AND a.historia_enlazada_id IS NULL
            AND NOT EXISTS (
                  SELECT 1 FROM mybodytech_afiliados x WHERE x.historia_enlazada_id = $1)
        RETURNING a.evento_id`,
        [historiaTrepsiId, doc, diasVentanaEnlace()]
      );
      const eventoId = rows?.[0]?.evento_id ? String(rows[0].evento_id) : null;
      if (eventoId) {
        console.log(`🔗 [mybodytech-enlace] Orden ${eventoId} ↔ historia Trepsi ${historiaTrepsiId}`);
      }
      return eventoId;
    } catch (e) {
      console.error('⚠️  [mybodytech-enlace] enlazarDesdeTrepsi:', e instanceof Error ? e.message : e);
      return null;
    }
  }

  /**
   * Llegó una orden de MyBodytech y la persona YA tenía cita en Trepsi (el
   * orden inverso). Se enlaza con la cita de Trepsi vigente —ni cancelada ni
   * atendida— más antigua. Devuelve la historia de Trepsi enlazada, o null.
   */
  async enlazarDesdeMybodytech(eventoId: string, numeroId: string): Promise<string | null> {
    try {
      const doc = normalizarDocumento(numeroId);
      if (!eventoId || !documentoEnlazable(doc)) return null;

      const rows = await postgresService.query(
        `WITH t AS (
           SELECT ta.historia_id
             FROM trepsi_appointments ta
             JOIN "HistoriaClinica" h ON h."_id" = ta.historia_id
            WHERE ${documentoSql('h."numeroId"')} = $2
              AND ta.estado NOT IN ('cancelled', 'attended')
              AND COALESCE(h."atendido", '') <> 'ATENDIDO'
              AND ta.created_at > NOW() - make_interval(days => $3)
              AND NOT EXISTS (
                    SELECT 1 FROM mybodytech_afiliados x WHERE x.historia_enlazada_id = ta.historia_id)
            ORDER BY ta.created_at
            LIMIT 1
         )
         UPDATE mybodytech_afiliados a
            SET historia_enlazada_id = t.historia_id, enlazada_at = NOW(), updated_at = NOW()
           FROM t
          WHERE a.evento_id = $1
            AND a.historia_enlazada_id IS NULL
            AND COALESCE(a.fuente, 'mybodytech') = 'mybodytech'
        RETURNING a.historia_enlazada_id`,
        [eventoId, doc, diasVentanaEnlace()]
      );
      const historia = rows?.[0]?.historia_enlazada_id ? String(rows[0].historia_enlazada_id) : null;
      if (historia) {
        console.log(`🔗 [mybodytech-enlace] Orden ${eventoId} ↔ historia Trepsi ${historia} (Trepsi llegó primero)`);
      }
      return historia;
    } catch (e) {
      console.error('⚠️  [mybodytech-enlace] enlazarDesdeMybodytech:', e instanceof Error ? e.message : e);
      return null;
    }
  }

  /**
   * Trepsi canceló la cita: se suelta el enlace para que la orden quede libre
   * de nuevo (si la persona vuelve a agendar, se enlaza con la nueva). Un RIPS
   * ya enviado no se toca.
   */
  async desenlazarTrepsi(historiaTrepsiId: string): Promise<void> {
    try {
      if (!historiaTrepsiId) return;
      const rows = await postgresService.query(
        `UPDATE mybodytech_afiliados
            SET historia_enlazada_id = NULL, enlazada_at = NULL, updated_at = NOW()
          WHERE historia_enlazada_id = $1
            AND rips_estado IS DISTINCT FROM 'done'
        RETURNING evento_id`,
        [historiaTrepsiId]
      );
      if (rows?.[0]?.evento_id) {
        console.log(`🔗 [mybodytech-enlace] Suelto: orden ${rows[0].evento_id} (Trepsi canceló ${historiaTrepsiId})`);
      }
    } catch (e) {
      console.error('⚠️  [mybodytech-enlace] desenlazarTrepsi:', e instanceof Error ? e.message : e);
    }
  }
}

export default new MybodytechEnlaceService();
