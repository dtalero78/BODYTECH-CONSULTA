// ============================================================================
// mybodytech-historia — la fila de HistoriaClinica de un afiliado de MyBodytech.
//
// La escriben dos caminos y tiene que salir igual en los dos:
//   · el alta de siempre (mybodytech.service), con la cita que manda MyBodytech;
//   · el agendamiento del afiliado (agenda-umv.service), con el cupo que eligió.
// Vive aparte porque mybodytech.service importa a agenda-umv.service: si la
// función viviera allá, los dos se importarían mutuamente.
// ============================================================================

import crypto from 'crypto';
import postgresService from './postgres.service';

export function generateHistoriaId(): string {
  return `mbt_${crypto.randomBytes(12).toString('hex')}`;
}

export interface AfiliadoHistoria {
  numeroId: string;
  tipoDocumento: string;
  primerNombre: string;
  segundoNombre?: string;
  primerApellido: string;
  segundoApellido?: string;
  fechaNacimiento: string;
  sexo?: string;
  celular: string;
  email?: string;
}

/**
 * Inserta paciente + cita. Se espeja el MISMO set de columnas que usa el alta de
 * Trepsi (probado en prod) para evitar sorpresas por columnas NOT NULL; los
 * campos que MyBodytech no envía van en null (o '' en los narrativos).
 *
 * `medico` es el nombre escrito a mano (alta de siempre) o el `codigo` del
 * profesional al que se le asignó (agendamiento UMV). Devuelve `false` si la
 * base falló.
 */
export async function insertarHistoriaMybodytech(p: {
  historiaId: string;
  afiliado: AfiliadoHistoria;
  medico: string;
  /** ISO con offset Colombia, ej. 2026-09-25T09:00:00-05:00 */
  fechaAtencion: string;
  hora: string;
}): Promise<boolean> {
  const a = p.afiliado;
  const hc = await postgresService.query(
    `INSERT INTO "HistoriaClinica" (
       "_id", "_createdDate", "_updatedDate",
       "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
       "celular", "email", "medico", "ciudad", "eps", "fechaAtencion", "fecha_nacimiento",
       "tipo_documento", "genero_biologico", "motivoConsulta", "motivo_consulta_texto",
       "tipo_consulta", "ant_familiares_obs", "peso", "talla", "horaAtencion", "codEmpresa",
       "atendido", "sede_id", "origen"
     ) VALUES (
       $1, NOW(), NOW(),
       $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'nutricion',
       $18, $19, $20, $21, $22, 'PENDIENTE', 'mybodytech', 'mybodytech'
     ) RETURNING "_id"`,
    [
      p.historiaId,
      a.numeroId,
      a.primerNombre,
      a.segundoNombre ?? null,
      a.primerApellido,
      a.segundoApellido ?? null,
      a.celular,
      a.email ?? null,
      p.medico,
      null, // ciudad
      null, // eps
      p.fechaAtencion,
      a.fechaNacimiento,
      a.tipoDocumento,
      a.sexo ?? null,
      '', // motivoConsulta
      '', // motivo_consulta_texto
      null, // ant_familiares_obs
      null, // peso
      null, // talla
      p.hora, // horaAtencion
      null, // codEmpresa
    ]
  );
  return hc !== null;
}
