// ============================================================================
// agenda-umv.service — la orden de MyBodytech que el afiliado agenda solo.
//
// Flujo (decisión de Daniel, 25-sep-2026; la regla pura en agenda-umv.helper):
//   1. MyBodytech manda la orden → `registrarPorAgendar` guarda la fila en
//      `mybodytech_afiliados` con `agenda_estado='por_agendar'` y un token
//      aleatorio. La fecha/hora/profesional que manda NO se usan para la cita.
//   2. Sale el WhatsApp `bodytech_umv_agendar_v1` con el botón "Agendar mi
//      consulta" → https://bodytech.app/agendar/<token>. Si falla, o si la
//      orden entró de noche, lo manda el worker (`maybeDispatch`).
//   3. El afiliado abre /agendar/<token>, ve los cupos libres de TODO el equipo
//      UMV y elige uno → `agendar` se lo asigna al profesional con menos citas
//      ese día y RECIÉN AHÍ crea la HistoriaClinica, con el `historia_id` que
//      ya se le había devuelto a MyBodytech (el RIPS lo busca por ahí).
//
// LO QUE VE MYBODYTECH NO CAMBIA (Daniel, 25-sep-2026: "eso ya está aprobado").
// La respuesta del alta, `GET /afiliados/:eventoId` y el RIPS leen `estado`,
// `fecha_atencion`, `professional_name` y `user_document_*`: se guardan igual
// que en el alta de siempre, con lo que mandó MyBodytech, y este módulo NUNCA
// los escribe. Todo lo del agendamiento va en columnas propias (`agenda_*`,
// `invitacion_*`) y la cita real vive en HistoriaClinica.
//
// Desde ahí la cita es una más: le llegan el recordatorio de las 07:00 y el
// link a la hora (link-auto), y "Reprogramar" la mueve con el mismo profesional.
//
// Nota: este módulo NO importa mybodytech.service (ese lo importa a él); de
// allá solo toma tipos.
// ============================================================================

import crypto from 'crypto';
import postgresService from './postgres.service';
import calendarioService from './calendario.service';
import whatsappService from './whatsapp.service';
import { formatCelularE164, formatHoraCita } from './link-paciente.service';
import { formatFechaCita } from '../helpers/unidad-envio.helper';
import { insertarHistoriaMybodytech, generateHistoriaId } from './mybodytech-historia.service';
import type { CreateAfiliadoInput, AfiliadoRecord, ServiceResult } from './mybodytech.service';
import { firmarId } from '../helpers/reprogramar-firma.helper';
import { nowColombia, rangoDiaColombia } from '../helpers/colombia-time.helper';
import {
  agendaUmvActiva,
  celularHabilitadoUmv,
  codigosEquipoUmv,
  dentroDeHorarioEnvio,
  elegirProfesional,
  textoConfirmacionUmv,
  textoInvitacionUmv,
  unirCupos,
} from '../helpers/agenda-umv.helper';

/** Cuántos días CON cupo se le muestran al afiliado, y hasta dónde se busca. */
const DIAS_A_MOSTRAR = 7;
const MAX_DIAS_BUSQUEDA = 21;
/** Reintentos de la invitación antes de rendirse (queda en la bitácora). */
const MAX_INTENTOS = 3;
/** Los cupos son los mismos para todos: se calculan una vez por minuto, no por visita. */
const CACHE_CUPOS_MS = 60_000;

interface Profesional {
  id: number;
  codigo: string;
  sedeId: string;
  nombre: string;
}

export interface DiaCupos {
  fecha: string;
  horarios: string[];
}

export interface InfoAgenda {
  primerNombre: string;
  estado: 'por_agendar' | 'agendada';
  cita: { fecha: string; hora: string; reprogramarId: string } | null;
}

function baseUrl(): string {
  return process.env.BASE_URL || process.env.PUBLIC_BASE_URL || 'https://bodytech.app';
}

export function linkAgenda(token: string): string {
  return `${baseUrl()}/agendar/${token}`;
}

function addDias(fecha: string, n: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n, 12));
  return dt.toISOString().slice(0, 10);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function payloadDe(row: any): CreateAfiliadoInput | null {
  const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return p && p.afiliado ? (p as CreateAfiliadoInput) : null;
}

class AgendaUmvService {
  private cacheCupos: { at: number; dias: DiaCupos[] } | null = null;

  // --------------------------------------------------------------------------
  // 1) La orden entra
  // --------------------------------------------------------------------------

  async registrarPorAgendar(input: CreateAfiliadoInput): Promise<ServiceResult<AfiliadoRecord>> {
    const historiaId = generateHistoriaId();
    const token = crypto.randomBytes(18).toString('base64url');

    // ON CONFLICT: dos reenvíos simultáneos del mismo eventoId no crean dos
    // órdenes (el chequeo de idempotencia de mybodytech.service no es atómico).
    // Las columnas que lee MyBodytech van EXACTAMENTE como en el alta de
    // siempre (mybodytech.service): estado 'scheduled', su fecha, su profesional.
    const rows = await postgresService.query(
      `INSERT INTO mybodytech_afiliados (
         evento_id, historia_id, numero_id, professional_name,
         user_document_type, user_document_number, fecha_atencion, estado, payload,
         agenda_estado, agenda_token, invitacion_estado
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8, 'por_agendar', $9, 'pendiente')
       ON CONFLICT (evento_id) DO NOTHING
       RETURNING evento_id`,
      [
        input.eventoId,
        historiaId,
        input.afiliado.numeroId,
        input.professionalName,
        input.userDocumentType ?? null,
        input.userDocumentNumber ?? null,
        `${input.fecha}T${input.hora}:00-05:00`,
        JSON.stringify(input),
        token,
      ]
    );
    if (rows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error registrando el afiliado.' } };
    }

    const actual = await postgresService.query('SELECT * FROM mybodytech_afiliados WHERE evento_id = $1', [
      input.eventoId,
    ]);
    const fila = actual?.[0];
    if (!fila) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error registrando el afiliado.' } };
    }

    // La invitación sale ya si es hora de mandar mensajes; si no, el worker la
    // manda al abrir la franja. Fire-and-forget: que Twilio falle no puede
    // tumbar el alta de un socio B2B.
    if (rows.length > 0 && dentroDeHorarioEnvio(nowColombia().minutos)) {
      this.enviarInvitacion(input.eventoId).catch((e) =>
        console.error(`[agenda-umv] invitación ${input.eventoId}:`, e?.message ?? e)
      );
    }

    return {
      ok: true,
      status: rows.length > 0 ? 201 : 200,
      data: {
        eventoId: String(fila.evento_id),
        afiliadoId: String(fila.historia_id),
        estado: String(fila.estado),
        fechaAtencion: fila.fecha_atencion ? new Date(fila.fecha_atencion).toISOString() : null,
        professionalName: fila.professional_name ? String(fila.professional_name) : null,
      },
    };
  }

  // --------------------------------------------------------------------------
  // 2) La invitación por WhatsApp
  // --------------------------------------------------------------------------

  /**
   * Manda la invitación de UNA orden. El claim atómico evita que el alta y el
   * worker la manden dos veces; una fila 'enviando' de hace más de 15 min (el
   * proceso murió a mitad) se vuelve a tomar.
   */
  async enviarInvitacion(eventoId: string): Promise<'enviada' | 'error' | 'sin_celular' | 'omitida'> {
    const templateSid = (process.env.TWILIO_WHATSAPP_UMV_AGENDAR_TEMPLATE_SID || '').trim();
    if (!templateSid) return 'omitida';

    const claim = await postgresService.query(
      `UPDATE mybodytech_afiliados
          SET invitacion_estado = 'enviando',
              invitacion_intentos = invitacion_intentos + 1,
              updated_at = NOW()
        WHERE evento_id = $1
          AND agenda_estado = 'por_agendar'
          AND invitacion_intentos < $2
          AND (invitacion_estado IN ('pendiente', 'error')
               OR (invitacion_estado = 'enviando' AND updated_at < NOW() - INTERVAL '15 minutes'))
        RETURNING *`,
      [eventoId, MAX_INTENTOS]
    );
    const fila = claim?.[0];
    if (!fila) return 'omitida';

    const payload = payloadDe(fila);
    const telefono = payload ? formatCelularE164(payload.afiliado.celular) : null;
    // Segunda llave del modo pruebas: aunque la orden haya entrado al flujo
    // nuevo, si el celular salió de la lista no se le escribe.
    if (payload && telefono && !celularHabilitadoUmv(telefono)) {
      await postgresService.query(
        `UPDATE mybodytech_afiliados
            SET invitacion_estado = 'bloqueada', invitacion_error = 'Modo pruebas: celular fuera de UMV_SOLO_CELULARES', updated_at = NOW()
          WHERE evento_id = $1`,
        [eventoId]
      );
      return 'omitida';
    }
    if (!payload || !telefono) {
      await postgresService.query(
        `UPDATE mybodytech_afiliados
            SET invitacion_estado = 'sin_celular', invitacion_error = 'Celular vacío o con formato no reconocido', updated_at = NOW()
          WHERE evento_id = $1`,
        [eventoId]
      );
      return 'sin_celular';
    }

    const nombre = payload.afiliado.primerNombre.trim();
    const r = await whatsappService.sendContentTemplate(telefono, templateSid, {
      '1': nombre,
      '2': String(fila.agenda_token), // botón → https://bodytech.app/agendar/{{2}}
    });

    if (!r.success) {
      await postgresService.query(
        `UPDATE mybodytech_afiliados
            SET invitacion_estado = 'error', invitacion_error = $2, updated_at = NOW()
          WHERE evento_id = $1`,
        [eventoId, (r.error || 'error desconocido').slice(0, 500)]
      );
      return 'error';
    }

    await postgresService.query(
      `UPDATE mybodytech_afiliados
          SET invitacion_estado = 'enviada', invitacion_enviada_at = NOW(), invitacion_error = NULL, updated_at = NOW()
        WHERE evento_id = $1`,
      [eventoId]
    );
    // El mensaje queda en el hilo del chat del panel, como los demás envíos.
    try {
      await postgresService.registrarMensajeSaliente(
        telefono,
        textoInvitacionUmv({ nombre, link: linkAgenda(String(fila.agenda_token)) }),
        r.messageSid || '',
        `${payload.afiliado.primerNombre} ${payload.afiliado.primerApellido}`.trim()
      );
    } catch (e: any) {
      console.warn(`[agenda-umv] no se registró en el chat (${eventoId}):`, e?.message ?? e);
    }
    return 'enviada';
  }

  /**
   * Pasada del worker: las invitaciones pendientes (órdenes que entraron fuera
   * de horario) y las que fallaron (con 10 min de respiro entre intentos).
   */
  async maybeDispatch(): Promise<void> {
    if (!agendaUmvActiva()) return;
    if (!dentroDeHorarioEnvio(nowColombia().minutos)) return;

    const rows = await postgresService.query(
      `SELECT evento_id FROM mybodytech_afiliados
        WHERE agenda_estado = 'por_agendar'
          AND invitacion_intentos < $1
          AND (invitacion_estado = 'pendiente'
               OR (invitacion_estado = 'error' AND updated_at < NOW() - INTERVAL '10 minutes')
               OR (invitacion_estado = 'enviando' AND updated_at < NOW() - INTERVAL '15 minutes'))
        ORDER BY created_at
        LIMIT 30`,
      [MAX_INTENTOS]
    );
    for (const r of rows ?? []) {
      await this.enviarInvitacion(String(r.evento_id));
      await new Promise((ok) => setTimeout(ok, 1000));
    }
  }

  /**
   * `bodytech_umv_confirmacion_v1`: fecha, hora y botón Reprogramar. Sin la
   * plantilla configurada no se manda nada (la pantalla ya confirmó).
   */
  private async enviarConfirmacion(
    payload: CreateAfiliadoInput,
    fecha: string,
    hora: string,
    reprogramarId: string
  ): Promise<void> {
    const templateSid = (process.env.TWILIO_WHATSAPP_UMV_CONFIRMACION_TEMPLATE_SID || '').trim();
    const telefono = formatCelularE164(payload.afiliado.celular);
    if (!templateSid || !telefono || !celularHabilitadoUmv(telefono)) return;

    const nombre = payload.afiliado.primerNombre.trim();
    const fechaTxt = formatFechaCita(fecha) ?? fecha;
    const horaTxt = formatHoraCita(hora);
    const r = await whatsappService.sendContentTemplate(telefono, templateSid, {
      '1': nombre,
      '2': fechaTxt,
      '3': horaTxt,
      '4': reprogramarId, // botón → https://bodytech.app/reprogramar/{{4}}
    });
    if (!r.success) {
      console.warn(`[agenda-umv] la confirmación no salió (${telefono}): ${r.error}`);
      return;
    }
    await postgresService.registrarMensajeSaliente(
      telefono,
      textoConfirmacionUmv({
        nombre,
        fecha: fechaTxt,
        hora: horaTxt,
        linkReprogramar: `${baseUrl()}/reprogramar/${reprogramarId}`,
      }),
      r.messageSid || '',
      `${payload.afiliado.primerNombre} ${payload.afiliado.primerApellido}`.trim()
    );
  }

  // --------------------------------------------------------------------------
  // 3) El calendario
  // --------------------------------------------------------------------------

  /**
   * El equipo UMV: los códigos de `UMV_AGENDA_PROFESIONALES` si está puesta;
   * si no, las fichas activas de la unidad `bsl` con rol medico que no sean de
   * prueba. Por eso queda afuera un coach de nutrición que vive en `bsl`.
   */
  async equipo(): Promise<Profesional[]> {
    const codigos = codigosEquipoUmv();
    const rows = await postgresService.query(
      `SELECT id, codigo, sede_id,
              concat_ws(' ', primer_nombre, primer_apellido) AS nombre
         FROM profesionales
        WHERE activo = TRUE
          AND (
            (cardinality($1::text[]) > 0 AND codigo = ANY($1::text[]))
            OR (cardinality($1::text[]) = 0
                AND sede_id = 'bsl' AND rol = 'medico'
                AND codigo !~* 'prueba'
                AND concat_ws(' ', primer_nombre, primer_apellido) !~* 'prueba')
          )
        ORDER BY codigo`,
      [codigos]
    );
    if (rows === null) throw new Error('la base no respondió al leer el equipo UMV');
    return rows.map((r) => ({
      id: Number(r.id),
      codigo: String(r.codigo),
      sedeId: String(r.sede_id),
      nombre: String(r.nombre ?? '').trim(),
    }));
  }

  /** Horas libres de cada profesional del equipo en un día. */
  private async cuposDelDia(fecha: string, equipo: Profesional[]) {
    return Promise.all(
      equipo.map(async (p) => {
        const r = await calendarioService.getHorariosDisponibles(fecha, p.id, p.sedeId, 'virtual');
        const libres = r.ok && r.data ? r.data.horarios.filter((s) => s.disponible).map((s) => s.hora) : [];
        return { prof: p, codigo: p.codigo, libres };
      })
    );
  }

  /** Los próximos días con cupo, con las horas del equipo unidas. */
  async horarios(): Promise<DiaCupos[]> {
    if (this.cacheCupos && Date.now() - this.cacheCupos.at < CACHE_CUPOS_MS) return this.cacheCupos.dias;

    const equipo = await this.equipo();
    const hoy = nowColombia().fecha;
    const dias: DiaCupos[] = [];
    for (let i = 0; i < MAX_DIAS_BUSQUEDA && dias.length < DIAS_A_MOSTRAR; i++) {
      const fecha = addDias(hoy, i);
      const horarios = unirCupos(await this.cuposDelDia(fecha, equipo));
      if (horarios.length > 0) dias.push({ fecha, horarios });
    }
    this.cacheCupos = { at: Date.now(), dias };
    return dias;
  }

  // --------------------------------------------------------------------------
  // 4) El afiliado elige
  // --------------------------------------------------------------------------

  async getInfo(token: string): Promise<InfoAgenda | null> {
    // La fecha de la cita sale de HistoriaClinica (la real, que pudo
    // reprogramarse), no de `fecha_atencion`, que es la que mandó MyBodytech.
    const rows = await postgresService.query(
      `SELECT a.*,
              CASE WHEN h."fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
                to_char(h."fechaAtencion"::timestamptz AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') END AS fecha_bogota,
              CASE WHEN h."fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
                to_char(h."fechaAtencion"::timestamptz AT TIME ZONE 'America/Bogota', 'HH24:MI') END AS hora_bogota
         FROM mybodytech_afiliados a
         LEFT JOIN "HistoriaClinica" h ON h."_id" = a.historia_id
        WHERE a.agenda_token = $1`,
      [token]
    );
    if (rows === null) throw new Error('la base no respondió');
    const fila = rows[0];
    const payload = fila ? payloadDe(fila) : null;
    if (!fila || !payload) return null;

    const agendada = fila.agenda_estado === 'agendada' && fila.fecha_bogota;
    return {
      primerNombre: payload.afiliado.primerNombre,
      estado: agendada ? 'agendada' : 'por_agendar',
      cita: agendada
        ? {
            fecha: String(fila.fecha_bogota),
            hora: String(fila.hora_bogota),
            reprogramarId: firmarId(String(fila.historia_id), process.env.JWT_SECRET),
          }
        : null,
    };
  }

  async agendar(
    token: string,
    fecha: string,
    hora: string
  ): Promise<ServiceResult<{ fecha: string; hora: string; reprogramarId: string }>> {
    // Claim: solo una pestaña agenda a la vez. Un 'agendando' de hace más de
    // 2 min (el proceso murió a mitad) se puede volver a tomar.
    const claim = await postgresService.query(
      `UPDATE mybodytech_afiliados
          SET agenda_estado = 'agendando', updated_at = NOW()
        WHERE agenda_token = $1
          AND (agenda_estado = 'por_agendar'
               OR (agenda_estado = 'agendando' AND updated_at < NOW() - INTERVAL '2 minutes'))
        RETURNING *`,
      [token]
    );
    if (claim === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'No pudimos agendar. Intenta de nuevo.' } };
    }
    const fila = claim[0];
    if (!fila) {
      const info = await this.getInfo(token);
      if (!info) return { ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'No encontramos tu orden.' } };
      return {
        ok: false,
        status: 409,
        error: { code: 'YA_AGENDADA', message: 'Tu consulta ya está agendada.' },
      };
    }

    const soltar = () =>
      postgresService.query(
        `UPDATE mybodytech_afiliados SET agenda_estado = 'por_agendar', updated_at = NOW()
          WHERE agenda_token = $1 AND agenda_estado = 'agendando'`,
        [token]
      );

    try {
      const payload = payloadDe(fila);
      if (!payload) throw new Error('la orden no tiene los datos del afiliado');

      // ¿Quién tiene libre esa hora? (recalculado: la lista que vio el afiliado
      // pudo cambiar mientras elegía).
      const equipo = await this.equipo();
      const cupos = await this.cuposDelDia(fecha, equipo);
      const libres = cupos.filter((c) => c.libres.includes(hora));
      if (libres.length === 0) {
        await soltar();
        this.cacheCupos = null;
        return {
          ok: false,
          status: 409,
          error: { code: 'SLOT_TOMADO', message: 'Ese horario se acaba de ocupar. Elige otro, por favor.' },
        };
      }

      // Se reparte la carga: el que menos citas tiene ese día.
      const { inicioUtc, finUtc } = rangoDiaColombia(fecha);
      const carga = await postgresService.query(
        `SELECT "medico", count(*)::int AS n FROM "HistoriaClinica"
          WHERE "medico" = ANY($1::text[])
            AND "fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            AND "fechaAtencion"::timestamptz >= $2::timestamptz
            AND "fechaAtencion"::timestamptz <  $3::timestamptz
          GROUP BY "medico"`,
        [libres.map((l) => l.codigo), inicioUtc, finUtc]
      );
      const porCodigo = new Map((carga ?? []).map((r) => [String(r.medico), Number(r.n)]));
      const codigo = elegirProfesional(libres.map((l) => ({ codigo: l.codigo, citasDelDia: porCodigo.get(l.codigo) ?? 0 })));
      const prof = libres.find((l) => l.codigo === codigo)!.prof;

      const val = await calendarioService.validarSlotDisponible(prof.sedeId, prof.codigo, fecha, hora, 'virtual');
      if (!val.ok) {
        await soltar();
        this.cacheCupos = null;
        return {
          ok: false,
          status: val.status,
          error: { code: val.error?.code ?? 'SLOT_NO_DISPONIBLE', message: val.error?.message ?? 'Ese horario ya no está disponible.' },
        };
      }

      const historiaId = String(fila.historia_id);
      const fechaAtencion = `${fecha}T${hora}:00-05:00`;
      // Si un intento anterior alcanzó a crear la historia y murió antes de
      // cerrar la orden, se corrige esa fila en vez de chocar con la PK.
      const existe = await postgresService.query('SELECT 1 FROM "HistoriaClinica" WHERE "_id" = $1', [historiaId]);
      const hcOk =
        existe && existe.length > 0
          ? (await postgresService.query(
              `UPDATE "HistoriaClinica" SET "medico" = $2, "fechaAtencion" = $3, "horaAtencion" = $4, "_updatedDate" = NOW()
                WHERE "_id" = $1`,
              [historiaId, prof.codigo, fechaAtencion, hora]
            )) !== null
          : await insertarHistoriaMybodytech({
              historiaId,
              afiliado: payload.afiliado,
              medico: prof.codigo,
              fechaAtencion,
              hora,
            });
      if (!hcOk) throw new Error('no se pudo crear la historia clínica');

      // Solo las columnas propias del agendamiento: lo que lee MyBodytech
      // (estado, fecha, profesional, documento del RIPS) queda como lo mandó.
      await postgresService.query(
        `UPDATE mybodytech_afiliados
            SET agenda_estado = 'agendada', agendada_at = NOW(), updated_at = NOW()
          WHERE agenda_token = $1`,
        [token]
      );
      this.cacheCupos = null;
      console.log(`📅 [agenda-umv] ${fila.evento_id} agendada ${fecha} ${hora} con ${prof.codigo}`);

      const reprogramarId = firmarId(historiaId, process.env.JWT_SECRET);
      // Confirmación por WhatsApp. Fire-and-forget: la cita ya quedó, y la
      // pantalla se la muestra al afiliado aunque el mensaje falle.
      this.enviarConfirmacion(payload, fecha, hora, reprogramarId).catch((e) =>
        console.warn(`[agenda-umv] confirmación ${fila.evento_id}:`, e?.message ?? e)
      );

      return { ok: true, status: 201, data: { fecha, hora, reprogramarId } };
    } catch (e: any) {
      console.error(`[agenda-umv] agendar ${fila.evento_id}:`, e?.message ?? e);
      await soltar();
      return { ok: false, status: 500, error: { code: 'ERROR', message: 'No pudimos agendar. Intenta de nuevo.' } };
    }
  }
}

export default new AgendaUmvService();
