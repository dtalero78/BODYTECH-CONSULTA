// ============================================================================
// acc.service — Valoración Corporal ACC.
//
// Programa vendido a Sol Médica (base de Novo Nordisk). El fisioterapeuta toma
// medidas antropométricas presenciales desde el celular, la plataforma calcula
// la composición corporal y emite la "Hoja de Valoración ACC".
//
// NOTA SOBRE ERRORES: `postgresService.query()` traga las excepciones y devuelve
// null. Para lecturas está bien; para las ESCRITURAS de un registro clínico no,
// porque el panel creería que guardó. Las escrituras de acá usan `getClient()`
// directo y dejan que el error suba hasta el controller.
// ============================================================================

import postgresService from './postgres.service';
import { nowColombia, rangoDiaColombia } from '../helpers/colombia-time.helper';
import {
  calcularAntropometria,
  normalizarSexo,
  type MedidasAntropometricas,
  type ResultadoAntropometrico,
} from '../helpers/antropometria';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type EstadoPaciente =
  | 'cargado'
  | 'contactado'
  | 'agendado'
  | 'confirmado'
  | 'asistio'
  | 'no_show'
  | 'descartado';

export interface AccPaciente {
  id: number;
  numeroId: string;
  nombreCompleto: string;
  edad: number | null;
  sexo: string | null;
  celular: string | null;
  empresa: string | null;
  cohorte: string;
  estado: EstadoPaciente;
  sede: string | null;
  citaFecha: string | null;
  /**
   * Última valoración de esta persona, si tiene. Va en el listado porque el
   * evaluador necesita saberlo ANTES de tocar la fila: sin esto abriría un
   * formulario en blanco sobre alguien ya medido y crearía un duplicado.
   */
  ultimaValoracion: {
    id: number;
    estado: 'borrador' | 'cerrada';
    fechaEvaluacion: string;
  } | null;
}

/** Lo que el panel envía: medidas crudas, sin nada calculado. */
export interface EntradaValoracion extends MedidasAntropometricas {
  numeroId: string;
  nombreCompleto?: string | null;
  fechaEvaluacion?: string | null;
  sede?: string | null;
  evaluador?: string | null;
  evaluadorUsuarioId?: number | null;
  pacienteId?: number | null;
  origenDatos?: 'manual' | 'inbody';
  observaciones?: string | null;
}

export interface Valoracion extends EntradaValoracion {
  id: number;
  estado: 'borrador' | 'cerrada';
  resultado: ResultadoAntropometrico;
  cerradaAt: string | null;
  exportadaSheetAt: string | null;
  createdAt: string;
}

export interface Embudo {
  cohorte: string;
  base: number;
  contactados: number;
  agendados: number;
  asistieron: number;
  noShow: number;
  descartados: number;
  /** % de los agendados que no asistió. Es el número que define facturación. */
  tasaNoShow: number | null;
}

// ---------------------------------------------------------------------------
// Columnas de medida ↔ campo de entrada.
//
// Un solo mapa: lo usan el INSERT, el UPDATE y la hidratación de vuelta. Agregar
// una medida es agregar una línea acá y la columna en la migración.
// ---------------------------------------------------------------------------

const MEDIDAS: Array<[columna: string, campo: keyof MedidasAntropometricas]> = [
  ['estatura_cm', 'estaturaCm'],
  ['peso_kg', 'pesoKg'],
  ['perimetro_abdominal', 'perimetroAbdominal'],
  ['perimetro_cadera', 'perimetroCadera'],
  ['perimetro_brazo_relajado_der', 'perimetroBrazoRelajadoDer'],
  ['perimetro_brazo_contraido_der', 'perimetroBrazoContraidoDer'],
  ['perimetro_brazo_relajado_izq', 'perimetroBrazoRelajadoIzq'],
  ['perimetro_brazo_contraido_izq', 'perimetroBrazoContraidoIzq'],
  ['perimetro_muslo_der', 'perimetroMusloDer'],
  ['perimetro_muslo_izq', 'perimetroMusloIzq'],
  ['perimetro_pantorrilla', 'perimetroPantorrilla'],
  ['pliegue_triceps', 'pliegueTriceps'],
  ['pliegue_subescapular', 'pliegueSubescapular'],
  ['pliegue_biceps', 'pliegueBiceps'],
  ['pliegue_cresta_iliaca', 'pliegueCrestaIliaca'],
  ['pliegue_supraespinal', 'pliegueSupraespinal'],
  ['pliegue_abdominal', 'pliegueAbdominal'],
  ['pliegue_muslo_anterior', 'pliegueMusloAnterior'],
  ['pliegue_pantorrilla', 'plieguePantorrilla'],
];

/** Columnas donde se persiste lo calculado, en el orden del INSERT. */
const CALCULADAS = [
  'imc',
  'imc_estado',
  'pct_grasa',
  'grasa_estado',
  'metodo_grasa',
  'pct_muscular',
  'muscular_estado',
  'peso_muscular_kg',
  'masa_grasa_kg',
  'masa_libre_grasa_kg',
  'imm',
  'tmb_kcal',
  'icc',
  'icc_estado',
  'ict',
  'ict_estado',
  'perimetro_abdominal_estado',
  'sumatoria_6',
  'sumatoria_8',
] as const;

function valoresCalculados(r: ResultadoAntropometrico): unknown[] {
  return [
    r.imc?.valor ?? null,
    r.imc?.evaluacion ?? null,
    r.porcentajeGrasa?.valor ?? null,
    r.porcentajeGrasa?.evaluacion ?? null,
    r.metodoGrasa,
    r.porcentajeMuscular?.valor ?? null,
    r.porcentajeMuscular?.evaluacion ?? null,
    r.pesoMuscularKg,
    r.masaGrasaKg,
    r.masaLibreGrasaKg,
    r.imm,
    r.tmbKcal?.valor ?? null,
    r.icc?.valor ?? null,
    r.icc?.evaluacion ?? null,
    r.ict?.valor ?? null,
    r.ict?.evaluacion ?? null,
    r.perimetroAbdominal?.evaluacion ?? null,
    r.sumatoria6,
    r.sumatoria8,
  ];
}

// ---------------------------------------------------------------------------
// Acceso a datos
// ---------------------------------------------------------------------------

/** Escritura que NO se traga los errores. Ver la nota de la cabecera. */
async function escribir(sql: string, params: unknown[]): Promise<any[]> {
  const client = await postgresService.getClient();
  if (!client) throw new Error('DB_UNAVAILABLE');
  try {
    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    client.release();
  }
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * Resuelve a qué paciente de la cohorte pertenece una cédula.
 *
 * El vínculo importa: cerrar una valoración marca al paciente como «asistió», y
 * ese es el hecho que mueve el embudo y habilita el cobro. La agenda ya manda
 * el `pacienteId` en la URL, pero el fisioterapeuta también puede arrancar una
 * valoración suelta desde el botón "Nueva valoración" — y ahí no hay URL que
 * traiga nada. Resolverlo acá hace que el vínculo no dependa de cómo llegó.
 *
 * Si la cédula no está en ninguna cohorte devuelve null y la valoración queda
 * suelta, que es lo correcto para un paciente fuera del programa.
 */
async function resolverPacienteId(numeroId: string): Promise<number | null> {
  const rows = await postgresService.query(
    `SELECT id FROM acc_pacientes WHERE numero_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [numeroId]
  );
  return rows && rows.length > 0 ? Number(rows[0].id) : null;
}

function filaAValoracion(row: any): Valoracion {
  const medidas: MedidasAntropometricas = { sexo: row.sexo, edad: row.edad };
  for (const [columna, campo] of MEDIDAS) {
    (medidas as Record<string, unknown>)[campo] = num(row[columna]);
  }
  return {
    id: Number(row.id),
    pacienteId: row.paciente_id !== null ? Number(row.paciente_id) : null,
    numeroId: row.numero_id,
    nombreCompleto: row.nombre_completo,
    fechaEvaluacion:
      row.fecha_evaluacion instanceof Date
        ? row.fecha_evaluacion.toISOString().slice(0, 10)
        : row.fecha_evaluacion,
    sede: row.sede,
    evaluador: row.evaluador,
    evaluadorUsuarioId: row.evaluador_usuario_id,
    origenDatos: row.origen_datos,
    observaciones: row.observaciones,
    estado: row.estado,
    cerradaAt: row.cerrada_at,
    exportadaSheetAt: row.exportada_sheet_at,
    createdAt: row.created_at,
    ...medidas,
    // Se recalcula al leer para que el panel siempre vea el detalle completo
    // (faltantes, método usado). Los valores persistidos son los que manda:
    // el informe se arma desde las columnas, no desde esto.
    resultado: calcularAntropometria(medidas),
  };
}

// ---------------------------------------------------------------------------
// API del servicio
// ---------------------------------------------------------------------------

/**
 * Cálculo en vivo para el panel. No toca la base: el fisio ve los números
 * mientras escribe y solo se persisten al guardar.
 */
function calcular(medidas: MedidasAntropometricas): ResultadoAntropometrico {
  return calcularAntropometria(medidas);
}

/**
 * Crea o actualiza el borrador de una valoración.
 *
 * Idempotente por (numero_id, fecha_evaluacion) mientras siga en borrador: si
 * el fisio recarga el celular a mitad de la toma, retoma el mismo registro en
 * vez de abrir uno nuevo. Una valoración ya cerrada nunca se pisa.
 */
async function guardarBorrador(entrada: EntradaValoracion): Promise<Valoracion> {
  if (!entrada.numeroId) throw new Error('NUMERO_ID_REQUERIDO');

  const fecha = entrada.fechaEvaluacion || nowColombia().fecha;
  const resultado = calcularAntropometria(entrada);

  // La agenda manda el id; si no vino (valoración suelta), se busca por cédula.
  const pacienteId =
    entrada.pacienteId ?? (await resolverPacienteId(entrada.numeroId.trim()));

  const existente = await postgresService.query(
    `SELECT id FROM acc_valoraciones
      WHERE numero_id = $1 AND fecha_evaluacion = $2 AND estado = 'borrador'
      ORDER BY id DESC LIMIT 1`,
    [entrada.numeroId, fecha]
  );

  const columnasMedida = MEDIDAS.map(([c]) => c);
  const valoresMedida = MEDIDAS.map(([, campo]) => num(entrada[campo]));

  if (existente && existente.length > 0) {
    const id = Number(existente[0].id);
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };

    // COALESCE: un borrador que empezó suelto queda atado a la cohorte en cuanto
    // se resuelve la cédula, pero un vínculo ya establecido no se pisa con null.
    params.push(pacienteId);
    sets.push(`paciente_id = COALESCE($${params.length}, paciente_id)`);
    push('nombre_completo', entrada.nombreCompleto ?? null);
    push('edad', num(entrada.edad));
    push('sexo', normalizarSexo(entrada.sexo));
    push('sede', entrada.sede ?? null);
    push('evaluador', entrada.evaluador ?? null);
    push('evaluador_usuario_id', entrada.evaluadorUsuarioId ?? null);
    push('origen_datos', entrada.origenDatos ?? 'manual');
    push('observaciones', entrada.observaciones ?? null);
    columnasMedida.forEach((c, i) => push(c, valoresMedida[i]));
    CALCULADAS.forEach((c, i) => push(c, valoresCalculados(resultado)[i]));
    sets.push('updated_at = NOW()');

    params.push(id);
    const rows = await escribir(
      `UPDATE acc_valoraciones SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    return filaAValoracion(rows[0]);
  }

  const columnas = [
    'paciente_id',
    'numero_id',
    'nombre_completo',
    'edad',
    'sexo',
    'fecha_evaluacion',
    'sede',
    'evaluador',
    'evaluador_usuario_id',
    'origen_datos',
    'observaciones',
    ...columnasMedida,
    ...CALCULADAS,
  ];
  const valores = [
    pacienteId,
    entrada.numeroId,
    entrada.nombreCompleto ?? null,
    num(entrada.edad),
    normalizarSexo(entrada.sexo),
    fecha,
    entrada.sede ?? null,
    entrada.evaluador ?? null,
    entrada.evaluadorUsuarioId ?? null,
    entrada.origenDatos ?? 'manual',
    entrada.observaciones ?? null,
    ...valoresMedida,
    ...valoresCalculados(resultado),
  ];

  const placeholders = valores.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await escribir(
    `INSERT INTO acc_valoraciones (${columnas.join(', ')})
     VALUES (${placeholders}) RETURNING *`,
    valores
  );
  return filaAValoracion(rows[0]);
}

/**
 * Cierra la valoración: la vuelve inmutable y la habilita para el informe y el
 * Excel. Marca al paciente como asistido — es el hecho que se factura.
 *
 * Se RECHAZA si falta cualquiera de los cinco resultados que el informe
 * imprime. Un PDF con celdas vacías y el logo de Bodytech es peor que un error
 * en pantalla que el fisio puede corregir con el paciente todavía enfrente.
 */
async function cerrarValoracion(id: number): Promise<Valoracion> {
  const rows = await postgresService.query(`SELECT * FROM acc_valoraciones WHERE id = $1`, [id]);
  if (!rows || rows.length === 0) throw new Error('VALORACION_NO_ENCONTRADA');
  const actual = filaAValoracion(rows[0]);
  if (actual.estado === 'cerrada') return actual;

  const r = actual.resultado;
  const faltantes: string[] = [];
  if (r.imc === null) faltantes.push('IMC');
  if (r.porcentajeGrasa === null) faltantes.push('% graso');
  if (r.tmbKcal === null) faltantes.push('TMB');
  if (r.icc === null) faltantes.push('índice cintura/cadera');
  if (r.perimetroAbdominal === null) faltantes.push('perímetro abdominal');
  if (faltantes.length > 0) {
    const err = new Error('VALORACION_INCOMPLETA') as Error & { faltantes: string[] };
    err.faltantes = faltantes;
    throw err;
  }

  const cerrada = await escribir(
    `UPDATE acc_valoraciones
        SET estado = 'cerrada', cerrada_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id]
  );

  // El paciente pasa a "asistió" — el evento que habilita el cobro. Sin
  // paciente_id la valoración igual se cierra: puede ser un walk-in fuera de
  // la cohorte de Sol Médica.
  if (actual.pacienteId) {
    await escribir(
      `UPDATE acc_pacientes
          SET estado = 'asistio', asistio_at = COALESCE(asistio_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND estado <> 'asistio'`,
      [actual.pacienteId]
    );
  }

  return filaAValoracion(cerrada[0]);
}

async function getValoracion(id: number): Promise<Valoracion | null> {
  const rows = await postgresService.query(`SELECT * FROM acc_valoraciones WHERE id = $1`, [id]);
  if (!rows || rows.length === 0) return null;
  return filaAValoracion(rows[0]);
}

/** Historial de un paciente, más reciente primero. Habilita la comparación. */
async function listarPorPaciente(numeroId: string): Promise<Valoracion[]> {
  const rows = await postgresService.query(
    `SELECT * FROM acc_valoraciones WHERE numero_id = $1 ORDER BY fecha_evaluacion DESC, id DESC`,
    [numeroId]
  );
  return (rows ?? []).map(filaAValoracion);
}

/**
 * Cohorte de pacientes, filtrable por estado del embudo, texto y DÍA de la cita.
 *
 * `fecha` (YYYY-MM-DD, día de Colombia) es lo que convierte este listado en la
 * agenda del evaluador: "a quién le toca hoy". Se resuelve contra el rango UTC
 * del día colombiano, no con `::date`, porque el servidor corre en UTC y las
 * citas de la tarde caerían en el día siguiente.
 *
 * Cada fila trae además su última valoración (si existe). Es un LATERAL y no un
 * GROUP BY para que el planner corte en la primera fila por paciente.
 */
async function listarPacientes(opts: {
  cohorte?: string;
  estado?: EstadoPaciente;
  busqueda?: string;
  fecha?: string;
  limit?: number;
}): Promise<AccPaciente[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.cohorte) {
    params.push(opts.cohorte);
    where.push(`p.cohorte = $${params.length}`);
  }
  if (opts.estado) {
    params.push(opts.estado);
    where.push(`p.estado = $${params.length}`);
  }
  if (opts.busqueda) {
    params.push(`%${opts.busqueda.toLowerCase()}%`);
    where.push(
      `(LOWER(p.nombre_completo) LIKE $${params.length} OR p.numero_id LIKE $${params.length})`
    );
  }

  let ordenFecha = false;
  if (opts.fecha) {
    let rango;
    try {
      rango = rangoDiaColombia(opts.fecha);
    } catch {
      return []; // fecha inválida: lista vacía, no un error 500
    }
    params.push(rango.inicioUtc);
    const desde = params.length;
    params.push(rango.finUtc);
    where.push(`p.cita_fecha >= $${desde}::timestamptz AND p.cita_fecha < $${params.length}::timestamptz`);
    ordenFecha = true;
  }

  params.push(Math.min(opts.limit ?? 200, 500));

  const rows = await postgresService.query(
    `SELECT p.id, p.numero_id, p.nombre_completo, p.edad, p.sexo, p.celular, p.empresa,
            p.cohorte, p.estado, p.sede, p.cita_fecha,
            v.id AS val_id, v.estado AS val_estado, v.fecha_evaluacion AS val_fecha
       FROM acc_pacientes p
       LEFT JOIN LATERAL (
         SELECT id, estado, fecha_evaluacion
           FROM acc_valoraciones
          WHERE numero_id = p.numero_id
          ORDER BY fecha_evaluacion DESC, id DESC
          LIMIT 1
       ) v ON TRUE
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${ordenFecha ? 'p.cita_fecha ASC, ' : ''}p.nombre_completo
      LIMIT $${params.length}`,
    params
  );

  return (rows ?? []).map((r: any) => ({
    id: Number(r.id),
    numeroId: r.numero_id,
    nombreCompleto: r.nombre_completo,
    edad: r.edad,
    sexo: r.sexo,
    celular: r.celular,
    empresa: r.empresa,
    cohorte: r.cohorte,
    estado: r.estado,
    sede: r.sede,
    citaFecha: r.cita_fecha,
    ultimaValoracion: r.val_id
      ? {
          id: Number(r.val_id),
          estado: r.val_estado,
          fechaEvaluacion:
            r.val_fecha instanceof Date
              ? r.val_fecha.toISOString().slice(0, 10)
              : String(r.val_fecha).slice(0, 10),
        }
      : null,
  }));
}

/**
 * Carga la base que entrega Sol Médica. Idempotente por (numero_id, cohorte):
 * reenviar el mismo archivo actualiza los datos de contacto pero NO pisa el
 * estado del embudo — quien ya asistió sigue asistido.
 */
async function cargarCohorte(
  cohorte: string,
  pacientes: Array<{
    numeroId: string;
    nombreCompleto: string;
    edad?: number | null;
    sexo?: string | null;
    celular?: string | null;
    email?: string | null;
    empresa?: string | null;
  }>
): Promise<{ insertados: number; actualizados: number; omitidos: number }> {
  let insertados = 0;
  let actualizados = 0;
  let omitidos = 0;

  for (const p of pacientes) {
    if (!p.numeroId || !p.nombreCompleto) {
      omitidos++;
      continue;
    }
    const rows = await escribir(
      `INSERT INTO acc_pacientes
         (numero_id, nombre_completo, edad, sexo, celular, email, empresa, cohorte)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (numero_id, cohorte) DO UPDATE
         SET nombre_completo = EXCLUDED.nombre_completo,
             edad    = COALESCE(EXCLUDED.edad, acc_pacientes.edad),
             sexo    = COALESCE(EXCLUDED.sexo, acc_pacientes.sexo),
             celular = COALESCE(EXCLUDED.celular, acc_pacientes.celular),
             email   = COALESCE(EXCLUDED.email, acc_pacientes.email),
             empresa = COALESCE(EXCLUDED.empresa, acc_pacientes.empresa),
             updated_at = NOW()
       RETURNING (xmax = 0) AS insertado`,
      [
        String(p.numeroId).trim(),
        String(p.nombreCompleto).trim(),
        num(p.edad),
        normalizarSexo(p.sexo),
        p.celular ?? null,
        p.email ?? null,
        p.empresa ?? null,
        cohorte,
      ]
    );
    if (rows[0]?.insertado) insertados++;
    else actualizados++;
  }

  return { insertados, actualizados, omitidos };
}

/** Avanza a un paciente en el embudo. Solo sella la marca de tiempo la primera vez. */
async function marcarEstado(
  pacienteId: number,
  estado: EstadoPaciente,
  citaFecha?: string | null
): Promise<void> {
  const columnaFecha: Partial<Record<EstadoPaciente, string>> = {
    contactado: 'contactado_at',
    agendado: 'agendado_at',
    asistio: 'asistio_at',
    no_show: 'no_show_at',
  };
  const col = columnaFecha[estado];
  const sets = ['estado = $2', 'updated_at = NOW()'];
  const params: unknown[] = [pacienteId, estado];
  if (col) sets.push(`${col} = COALESCE(${col}, NOW())`);
  if (citaFecha !== undefined) {
    params.push(citaFecha);
    sets.push(`cita_fecha = $${params.length}`);
  }
  await escribir(`UPDATE acc_pacientes SET ${sets.join(', ')} WHERE id = $1`, params);
}

/**
 * El embudo comprometido con Sol Médica: base → contactados → agendados →
 * asistieron. La tasa de no-show es la que define qué se factura, así que se
 * calcula sobre los AGENDADOS (quien nunca aceptó cita no es un no-show).
 *
 * Los estados son acumulativos: quien asistió también fue contactado y
 * agendado, así que cada escalón cuenta a los que llegaron hasta ahí o más.
 */
async function getEmbudo(cohorte?: string): Promise<Embudo> {
  const params: unknown[] = [];
  let filtro = '';
  if (cohorte) {
    params.push(cohorte);
    filtro = `WHERE cohorte = $1`;
  }

  const rows = await postgresService.query(
    `SELECT
       COUNT(*)                                                        AS base,
       COUNT(*) FILTER (WHERE contactado_at IS NOT NULL)               AS contactados,
       COUNT(*) FILTER (WHERE agendado_at   IS NOT NULL)               AS agendados,
       COUNT(*) FILTER (WHERE asistio_at    IS NOT NULL)               AS asistieron,
       COUNT(*) FILTER (WHERE no_show_at    IS NOT NULL)               AS no_show,
       COUNT(*) FILTER (WHERE estado = 'descartado')                   AS descartados
     FROM acc_pacientes ${filtro}`,
    params
  );

  const r = rows?.[0] ?? {};
  const agendados = Number(r.agendados ?? 0);
  const noShow = Number(r.no_show ?? 0);

  return {
    cohorte: cohorte ?? 'todas',
    base: Number(r.base ?? 0),
    contactados: Number(r.contactados ?? 0),
    agendados,
    asistieron: Number(r.asistieron ?? 0),
    noShow,
    descartados: Number(r.descartados ?? 0),
    tasaNoShow: agendados > 0 ? Math.round((noShow / agendados) * 1000) / 10 : null,
  };
}

/** Valoraciones cerradas que todavía no se volcaron al Excel de Sol Médica. */
async function pendientesDeExportar(limit = 50): Promise<Valoracion[]> {
  const rows = await postgresService.query(
    `SELECT * FROM acc_valoraciones
      WHERE estado = 'cerrada' AND exportada_sheet_at IS NULL
      ORDER BY cerrada_at ASC
      LIMIT $1`,
    [limit]
  );
  return (rows ?? []).map(filaAValoracion);
}

async function marcarExportada(id: number, fila: number | null): Promise<void> {
  await escribir(
    `UPDATE acc_valoraciones SET exportada_sheet_at = NOW(), sheet_fila = $2 WHERE id = $1`,
    [id, fila]
  );
}

export const accService = {
  calcular,
  guardarBorrador,
  cerrarValoracion,
  getValoracion,
  listarPorPaciente,
  listarPacientes,
  cargarCohorte,
  marcarEstado,
  getEmbudo,
  pendientesDeExportar,
  marcarExportada,
};

export default accService;
