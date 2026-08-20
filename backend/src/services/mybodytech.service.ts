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
// ============================================================================

import crypto from 'crypto';
import postgresService from './postgres.service';

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

function generateHistoriaId(): string {
  return `mbt_${crypto.randomBytes(12).toString('hex')}`;
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

    // 3) Crear la HistoriaClinica (paciente + cita). Se espeja el MISMO set de
    //    columnas que usa el alta de Trepsi (probado en prod) para evitar
    //    sorpresas por columnas NOT NULL; los campos que mybodytech no envía van
    //    en null (o '' en los narrativos).
    const hc = await postgresService.query(
      `INSERT INTO "HistoriaClinica" (
         "_id", "_createdDate", "_updatedDate",
         "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
         "celular", "email", "medico", "ciudad", "eps", "fechaAtencion", "fecha_nacimiento",
         "tipo_documento", "genero_biologico", "motivoConsulta", "motivo_consulta_texto",
         "tipo_consulta", "ant_familiares_obs", "peso", "talla", "horaAtencion", "codEmpresa",
         "atendido", "sede_id"
       ) VALUES (
         $1, NOW(), NOW(),
         $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'nutricion',
         $18, $19, $20, $21, $22, 'PENDIENTE', 'mybodytech'
       ) RETURNING "_id"`,
      [
        historiaId,
        a.numeroId,
        a.primerNombre,
        a.segundoNombre ?? null,
        a.primerApellido,
        a.segundoApellido ?? null,
        a.celular,
        a.email ?? null,
        input.professionalName, // medico = NOMBRE tal cual (agenda no sincronizada)
        null, // ciudad
        null, // eps
        fechaAtencion,
        a.fechaNacimiento,
        a.tipoDocumento,
        a.sexo ?? null,
        '', // motivoConsulta
        '', // motivo_consulta_texto
        null, // ant_familiares_obs
        null, // peso
        null, // talla
        input.hora, // horaAtencion
        null, // codEmpresa
      ]
    );
    if (hc === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error creando la historia clínica.' } };
    }

    // 4) Registrar en mybodytech_afiliados (+ payload crudo para auditoría).
    const appt = await postgresService.query(
      `INSERT INTO mybodytech_afiliados (
         evento_id, historia_id, numero_id, professional_name, fecha_atencion, estado, payload
       ) VALUES ($1, $2, $3, $4, $5, 'scheduled', $6)
       RETURNING *`,
      [
        input.eventoId,
        historiaId,
        a.numeroId,
        input.professionalName,
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
