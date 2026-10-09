import postgresService from './postgres.service';

/**
 * El cupo de un profesional, tomado de a uno.
 *
 * `validarSlotDisponible` responde "¿está libre?" y después alguien inserta la
 * cita. Entre esas dos cosas cabe otra solicitud: dos personas que agendan en
 * el mismo segundo pasan las dos la revisión y las dos quedan agendadas. Acá
 * la que decide es la base de datos — la PK de `cita_cupo` es (medico,
 * instante), así que el segundo INSERT choca y no hay empate posible.
 *
 * El cupo se LIBERA cuando la cita se cancela o se mueve a otra hora. Y un
 * cupo cuya cita ya no existe (o quedó cancelada) se re-toma solo: sin eso,
 * una fila huérfana dejaría una hora inutilizable para siempre.
 */
class CupoClaimService {
  /**
   * Intenta tomar el cupo para esa historia.
   *
   * `true` = el cupo quedó a su nombre (o ya era suyo: es idempotente, un
   * reenvío de la misma cita no se choca contra sí misma).
   * `false` = otra cita viva lo tiene.
   * `null` = no se pudo consultar la base; quien llama decide, y lo sensato es
   * NO bloquear por un problema nuestro.
   */
  async tomar(medico: string, instanteIso: string, historiaId: string): Promise<boolean | null> {
    const rows = await postgresService.query(
      `INSERT INTO cita_cupo (medico, instante, historia_id)
            VALUES ($1, $2::timestamptz, $3)
       ON CONFLICT (medico, instante) DO UPDATE
              SET historia_id = EXCLUDED.historia_id, created_at = NOW()
            WHERE cita_cupo.historia_id = EXCLUDED.historia_id
               OR NOT EXISTS (
                    SELECT 1 FROM "HistoriaClinica" h
                     WHERE h."_id" = cita_cupo.historia_id
                       AND NOT EXISTS (
                             SELECT 1 FROM trepsi_appointments t
                              WHERE t.historia_id = h."_id" AND t.estado = 'cancelled')
                  )
        RETURNING historia_id`,
      [medico, instanteIso, historiaId]
    );
    if (rows === null) return null;
    return rows.length > 0;
  }

  /**
   * Suelta los cupos VIEJOS de esa historia tras moverla de hora. Se llama
   * DESPUÉS de tomar el nuevo: soltar primero dejaría la hora vieja libre un
   * instante y, si el nuevo cupo fallara, la cita quedaría sin ninguno.
   */
  async soltarOtros(historiaId: string, medico: string, instanteIso: string): Promise<void> {
    await postgresService.query(
      `DELETE FROM cita_cupo
        WHERE historia_id = $1
          AND NOT (medico = $2 AND instante = $3::timestamptz)`,
      [historiaId, medico, instanteIso]
    );
  }

  /** Suelta el cupo de esa historia (al cancelar, o antes de moverla de hora). */
  async soltar(historiaId: string): Promise<void> {
    await postgresService.query('DELETE FROM cita_cupo WHERE historia_id = $1', [historiaId]);
  }
}

export default new CupoClaimService();
