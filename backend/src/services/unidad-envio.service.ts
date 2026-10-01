// ============================================================================
// unidad-envio.service — ¿el link de esta historia sale con la plantilla de la
// UMV? La regla vive en helpers/unidad-envio.helper.ts; acá solo se lee la cita.
// ============================================================================

import postgresService from './postgres.service';
import { esCitaUmv, formatFechaCita, requiereListaDePrueba } from '../helpers/unidad-envio.helper';
import { celularHabilitadoUmv } from '../helpers/agenda-umv.helper';

export interface EnvioUmv {
  templateSid: string;
  /** "jueves 25 de septiembre" — la variable {{2}}. */
  fecha: string;
}

/**
 * `null` = se envía la plantilla de siempre. Pasa cuando la cita no es de la
 * UMV, cuando la plantilla todavía no está configurada (así se puede desplegar
 * antes de que Meta la apruebe) y cuando la base no responde: recibir el link
 * con el texto genérico es mejor que no recibirlo.
 */
export async function envioUmvParaHistoria(
  historiaId: string,
  /** Qué plantilla UMV: la del link (default) o la del recordatorio de la mañana. */
  variableSid: 'TWILIO_WHATSAPP_UMV_TEMPLATE_SID' | 'TWILIO_WHATSAPP_UMV_RECORDATORIO_TEMPLATE_SID' = 'TWILIO_WHATSAPP_UMV_TEMPLATE_SID'
): Promise<EnvioUmv | null> {
  const templateSid = (process.env[variableSid] || '').trim();
  if (!templateSid) return null;
  try {
    const rows = await postgresService.query(
      `SELECT "origen", "celular",
              CASE WHEN "fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                   THEN to_char("fechaAtencion"::timestamptz AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD')
              END AS fecha_bogota
         FROM "HistoriaClinica" WHERE "_id" = $1`,
      [historiaId]
    );
    if (rows === null) throw new Error('la base no respondió');
    const fila = rows[0];
    if (!fila || !esCitaUmv(fila.origen)) return null;
    // Modo pruebas: a la cita de MyBodytech solo con celular de la lista (las
    // demás ni reciben mensaje: bloqueadoPorPruebasUmv). La creada en el panel
    // de la evaluadora (origen umv) recibe la de la UMV con cualquier celular.
    if (requiereListaDePrueba(fila.origen) && !celularHabilitadoUmv(fila.celular)) return null;
    const fecha = formatFechaCita(fila.fecha_bogota);
    if (!fecha) return null;
    return { templateSid, fecha };
  } catch (e: any) {
    console.warn(`⚠️ [umv] No se pudo leer la cita ${historiaId} (${e?.message ?? e}); sale la plantilla de siempre`);
    return null;
  }
}

/**
 * MODO PRUEBAS DE LA UMV (Daniel, 29-sep-2026: "todo lo que se está haciendo
 * ahorita son pruebas. No debe haber envío de mensajes todavía real").
 *
 * `true` = a esta cita NO se le escribe: llegó de MyBodytech (afiliado real) y
 * su celular no está en `UMV_SOLO_CELULARES`. La que crea la evaluadora en su
 * panel (origen umv) pasa con cualquier celular: es como el equipo prueba con
 * distintas personas (1-oct-2026). Lo consultan el link (automático
 * y "Contactar"), el recordatorio y la confirmación de reprogramada. Las citas
 * que no son de la UMV (Trepsi, corporativo, nativa) no se tocan.
 *
 * Si la base no responde se deja pasar: no se puede saber si la cita es de la
 * UMV, y bloquear a ciegas cortaría también los mensajes de Trepsi. El envío
 * automático tiene además su propio filtro en el SQL (link-auto.service).
 */
export async function bloqueadoPorPruebasUmv(historiaId: string | null | undefined): Promise<boolean> {
  if (!historiaId) return false;
  try {
    const rows = await postgresService.query(
      `SELECT "origen", "celular" FROM "HistoriaClinica" WHERE "_id" = $1`,
      [historiaId]
    );
    if (rows === null) throw new Error('la base no respondió');
    const fila = rows[0];
    if (!fila || !esCitaUmv(fila.origen)) return false;
    // Solo los afiliados de MyBodytech: la cita creada en el panel pasa.
    return requiereListaDePrueba(fila.origen) && !celularHabilitadoUmv(fila.celular);
  } catch (e: any) {
    console.warn(`⚠️ [umv] No se pudo verificar el modo pruebas de ${historiaId} (${e?.message ?? e})`);
    return false;
  }
}
