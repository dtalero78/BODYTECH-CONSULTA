// ============================================================================
// mybodytech.service — Alta de afiliado + cita desde mybodytech.
//
// DIFERENCIAS CLAVE con Trepsi (no es un clon):
//   - La agenda NO está sincronizada. mybodytech nos manda fecha + hora + el
//     NOMBRE del profesional (texto libre); no validamos cupos ni resolvemos el
//     profesional contra `profesionales`. Guardamos el nombre tal cual.
//   - No hay `/horarios-disponibles` ni validación de disponibilidad.
//
// Persistencia:
//   - HistoriaClinica: fila del paciente + la cita (fechaAtencion/horaAtencion,
//     medico = nombre del profesional, tipo_consulta='nutricion', sede_id='mybodytech').
//   - mybodytech_afiliados: ciclo de vida keyed por evento_id (idempotencia).
//
// Con UMV_AGENDA_ENABLED (25-sep-2026) nada de lo anterior aplica al alta: la
// orden entra "por agendar" y el afiliado elige su cupo (agenda-umv.service).
// Apagado, todo sigue como arriba.
// ============================================================================

import postgresService from './postgres.service';
import { insertarHistoriaMybodytech, generateHistoriaId } from './mybodytech-historia.service';
import { agendaUmvActiva, celularHabilitadoUmv } from '../helpers/agenda-umv.helper';

export interface AfiliadoInput {
  numeroId: string;
  tipoDocumento: string;
  primerNombre: string;
  segundoNombre?: string;
  primerApellido: string;
  segundoApellido?: string;
  fechaNacimiento: string; // YYYY-MM-DD
  sexo?: string;
  celular: string;
  email?: string;
}

export interface CreateAfiliadoInput {
  eventoId: string;
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM (hora Colombia)
  professionalName: string;
  // Documento del profesional que atiende — necesario para el RIPS (Fase 2).
  userDocumentType?: string;
  userDocumentNumber?: string;
  afiliado: AfiliadoInput;
}

export interface AfiliadoRecord {
  eventoId: string;
  afiliadoId: string; // _id de HistoriaClinica
  estado: string;
  fechaAtencion: string | null;
  professionalName: string | null;
}

export interface ServiceResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: { code: string; message: string };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRecord(row: any): AfiliadoRecord {
  return {
    eventoId: String(row.evento_id),
    afiliadoId: String(row.historia_id),
    estado: String(row.estado),
    fechaAtencion: row.fecha_atencion ? new Date(row.fecha_atencion).toISOString() : null,
    professionalName: row.professional_name ? String(row.professional_name) : null,
  };
}

/**
 * Normaliza un nombre para compararlo: sin tildes, sin puntuación, sin títulos
 * ("Dr.", "Dra."), espacios colapsados, en mayúsculas. mybodytech manda el
 * nombre con formato inconsistente ("Alejandra Perez", "PAULA ANDREA MORA
 * PINZON"), así que comparar en crudo no sirve.
 */
export function normalizarNombreProfesional(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tildes
    .replace(/\b(dr|dra|doctor|doctora|lic)\.?\b/gi, '')
    .replace(/[^A-Za-z\s]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

/**
 * Busca el `codigo` del profesional cuyo nombre coincida con el que manda
 * mybodytech. Devuelve `null` si no hay ninguno, y `'AMBIGUO'` si hay más de uno
 * (mismo nombre en dos sedes) — en ese caso adivinar pegaría la cita al coach
 * equivocado, que es peor que dejarla sin resolver.
 *
 * OJO: hoy esto es SOLO OBSERVABILIDAD. No cambia lo que se guarda en "medico"
 * (sigue siendo el nombre en texto libre, ver la cabecera de este archivo). Sirve
 * para que una cita que apunta a un profesional inexistente se note en los logs
 * en lugar de acumularse en silencio. Al 2026-08-20 ninguno de los nombres que
 * manda mybodytech existe en `profesionales`, así que siempre da `null`.
 */
export async function buscarCodigoProfesional(
  professionalName: string
): Promise<string | null | 'AMBIGUO'> {
  const objetivo = normalizarNombreProfesional(professionalName);
  if (!objetivo) return null;

  const rows = await postgresService.query(
    `SELECT codigo,
            concat_ws(' ', primer_nombre, segundo_nombre, primer_apellido, segundo_apellido) AS nombre,
            alias
       FROM profesionales
      WHERE activo = TRUE`
  );
  if (rows === null) return null; // la BD falló: no es motivo para tumbar el alta

  const coincidencias = new Set<string>();
  for (const r of rows) {
    const nombre = normalizarNombreProfesional(String(r.nombre ?? ''));
    const alias = normalizarNombreProfesional(String(r.alias ?? ''));
    if (objetivo === nombre || (alias && objetivo === alias)) {
      coincidencias.add(String(r.codigo));
    }
  }
  if (coincidencias.size === 0) return null;
  if (coincidencias.size > 1) return 'AMBIGUO';
  return [...coincidencias][0];
}

class MybodytechService {
  /**
   * Crea (o devuelve, si ya existe) el afiliado como paciente + su cita.
   * Idempotente por evento_id.
   */
  async createAfiliado(input: CreateAfiliadoInput): Promise<ServiceResult<AfiliadoRecord>> {
    // 1) Idempotencia
    const existing = await postgresService.query(
      'SELECT * FROM mybodytech_afiliados WHERE evento_id = $1',
      [input.eventoId]
    );
    if (existing === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando la base de datos.' } };
    }
    if (existing.length > 0) {
      return { ok: true, status: 200, data: rowToRecord(existing[0]) };
    }

    // 1.b) Flujo nuevo de la UMV (25-sep-2026): la cita que manda MyBodytech
    //      se IGNORA. La orden queda "por agendar", el afiliado recibe un
    //      WhatsApp con un botón y elige su cupo en el calendario del equipo
    //      UMV (ver agenda-umv.service). La HistoriaClinica nace cuando agenda.
    //      En pruebas (UMV_SOLO_CELULARES) solo entran los celulares de la lista:
    //      el resto de las órdenes sigue el alta de siempre, y a esos pacientes
    //      no les llega nada nuevo.
    if (agendaUmvActiva() && celularHabilitadoUmv(input.afiliado.celular)) {
      // Import perezoso: el servicio arrastra el cliente de Twilio, y con el
      // flujo apagado no hace falta cargarlo.
      const { default: agendaUmvService } = await import('./agenda-umv.service');
      return agendaUmvService.registrarPorAgendar(input);
    }

    // 2) fecha (YYYY-MM-DD) + hora (HH:MM) → fechaAtencion ISO con offset Colombia (-05:00).
    const fechaAtencion = `${input.fecha}T${input.hora}:00-05:00`;
    const a = input.afiliado;
    const historiaId = generateHistoriaId();

    // 2.b) ¿El profesional que manda mybodytech existe en `profesionales`?
    //      NO cambiamos lo que se guarda (sigue el nombre en texto libre), pero
    //      si no existe la cita queda huérfana: nadie la ve en el panel médico ni
    //      puede atenderla desde la plataforma. Se avisa para que se note.
    //      Envuelto en try/catch: esto es observabilidad, jamás debe tumbar un
    //      alta de un socio B2B.
    try {
      const codigo = await buscarCodigoProfesional(input.professionalName);
      if (codigo === null) {
        console.warn(
          `[mybodytech] Profesional no registrado: "${input.professionalName}" ` +
            `(evento ${input.eventoId}). La cita queda huérfana: no aparecerá en el ` +
            `panel médico. Darlo de alta en \`profesionales\` para poder atenderla.`
        );
      } else if (codigo === 'AMBIGUO') {
        console.warn(
          `[mybodytech] Nombre ambiguo: "${input.professionalName}" coincide con más de ` +
            `un profesional activo (evento ${input.eventoId}). No se resuelve.`
        );
      }
    } catch (e) {
      console.warn('[mybodytech] Fallo la verificación de profesional (no bloquea):', e);
    }

    // 3) Crear la HistoriaClinica (paciente + cita).
    const hcOk = await insertarHistoriaMybodytech({
      historiaId,
      afiliado: a,
      medico: input.professionalName, // medico = NOMBRE tal cual (agenda no sincronizada)
      fechaAtencion,
      hora: input.hora,
    });
    if (!hcOk) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error creando la historia clínica.' } };
    }

    // 4) Registrar en mybodytech_afiliados (+ payload crudo para auditoría).
    //    Se guarda el documento del profesional para poder enviar el RIPS en
    //    la Fase 2 (external-rips lo exige).
    const appt = await postgresService.query(
      `INSERT INTO mybodytech_afiliados (
         evento_id, historia_id, numero_id, professional_name,
         user_document_type, user_document_number, fecha_atencion, estado, payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8)
       RETURNING *`,
      [
        input.eventoId,
        historiaId,
        a.numeroId,
        input.professionalName,
        input.userDocumentType ?? null,
        input.userDocumentNumber ?? null,
        fechaAtencion,
        JSON.stringify(input),
      ]
    );
    if (appt === null || appt.length === 0) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error registrando el afiliado.' } };
    }

    return { ok: true, status: 201, data: rowToRecord(appt[0]) };
  }

  /** Consulta el estado de un afiliado/cita por evento_id. */
  async getAfiliado(eventoId: string): Promise<ServiceResult<AfiliadoRecord>> {
    const rows = await postgresService.query(
      'SELECT * FROM mybodytech_afiliados WHERE evento_id = $1',
      [eventoId]
    );
    if (rows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando la base de datos.' } };
    }
    if (rows.length === 0) {
      return { ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'eventoId no existe.' } };
    }
    return { ok: true, status: 200, data: rowToRecord(rows[0]) };
  }
}

export default new MybodytechService();
