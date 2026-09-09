// ============================================================================
// informe-corporativo — El informe mensual que se le entrega a la empresa.
//
// Hasta ahora se armaba a mano: alguien abría las valoraciones una por una,
// contaba, pegaba las gráficas en un Word y escribía los análisis. Un informe
// por empresa y por mes.
//
// Acá se arma solo. TODO sale de `HistoriaClinica`: no hay un segundo registro
// que alguien tenga que llenar, y por eso el informe no puede desactualizarse
// respecto de las historias — es la misma fila leída de otra manera.
//
// Dos partes distintas, a propósito:
//   · LOS NÚMEROS los cuenta este servicio. Son verificables y no opinan.
//   · LOS ANÁLISIS los redacta la plataforma leyendo esos números, como
//     borrador. El médico los ajusta antes de enviar: un informe clínico lo
//     firma una persona.
// ============================================================================

import postgresService from './postgres.service';

export interface Conteo {
  etiqueta: string;
  valor: number;
}

export interface DatosInforme {
  empresa: string;
  desde: string;
  hasta: string;
  /** Cuántas valoraciones entran en el informe. Si es 0, no hay informe. */
  total: number;
  oportunidad: { agendadas: number; efectivas: number; inasistencias: number; cumplimiento: number };
  genero: Conteo[];
  edad: { minima: number | null; maxima: number | null; promedio: number | null };
  edadPorGenero: Array<{ rango: string; femenino: number; masculino: number }>;
  imc: Conteo[];
  imcPorGenero: Array<{ clase: string; femenino: number; masculino: number }>;
  actividad: Conteo[];
  horasEjercicioPorGenero: Array<{ horas: string; femenino: number; masculino: number }>;
  sedentario: Conteo[];
  aptitud: Conteo[];
  nivel: Conteo[];
  riesgo: Conteo[];
  diagnosticos: Conteo[];
}

/** Una fila cruda: lo que hace falta de cada valoración, nada más. */
interface Fila {
  genero: string | null;
  edad: number | null;
  imc: number | null;
  af_clasificacion: string | null;
  af_minutos_semana: number | null;
  af_horas_sedentario: number | null;
  af_nivel: string | null;
  aptitud: string | null;
  riesgo: string | null;
  dx_osteomuscular: string | null;
  atendida: boolean;
}

const norm = (s: string | null | undefined): string =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

/** Cuenta por etiqueta, en el orden que se le indique y sin inventar categorías. */
function contar(valores: Array<string | null>, orden?: string[]): Conteo[] {
  const mapa = new Map<string, number>();
  for (const v of valores) {
    const k = String(v ?? '').trim();
    if (!k) continue;
    mapa.set(k, (mapa.get(k) ?? 0) + 1);
  }
  const salida: Conteo[] = [];
  if (orden) {
    for (const e of orden) {
      const encontrado = [...mapa.entries()].find(([k]) => norm(k) === norm(e));
      if (encontrado) {
        salida.push({ etiqueta: e, valor: encontrado[1] });
        mapa.delete(encontrado[0]);
      }
    }
  }
  // Lo que no encaja en el orden esperado NO se descarta: se muestra como vino.
  // Descartarlo haría que los porcentajes no sumen y nadie se enteraría.
  for (const [k, v] of [...mapa.entries()].sort((a, b) => b[1] - a[1])) {
    salida.push({ etiqueta: k, valor: v });
  }
  return salida;
}

/** La clase de IMC según los cortes de la OMS. */
function claseImc(imc: number | null): string | null {
  if (imc === null || !Number.isFinite(imc) || imc <= 0) return null;
  if (imc < 18.5) return 'Bajo peso';
  if (imc < 25) return 'Normopeso';
  if (imc < 30) return 'Sobrepeso';
  return 'Obesidad';
}

function rangoEdad(edad: number | null): string | null {
  if (edad === null || !Number.isFinite(edad)) return null;
  if (edad < 30) return '20 - 29';
  if (edad < 40) return '30 - 39';
  if (edad <= 50) return '40 - 50';
  return '> 50';
}

const RANGOS = ['20 - 29', '30 - 39', '40 - 50', '> 50'];

function esFemenino(g: string | null): boolean {
  const n = norm(g);
  return n.startsWith('f') || n === 'mujer';
}
function esMasculino(g: string | null): boolean {
  const n = norm(g);
  return n.startsWith('m') && n !== 'mujer';
}

/** Cruza una dimensión contra el género. Devuelve una fila por categoría. */
function porGenero<T extends string>(
  filas: Fila[],
  clave: (f: Fila) => T | null,
  orden: string[],
): Array<{ etiqueta: string; femenino: number; masculino: number }> {
  const mapa = new Map<string, { femenino: number; masculino: number }>();
  for (const f of filas) {
    const k = clave(f);
    if (!k) continue;
    const fila = mapa.get(k) ?? { femenino: 0, masculino: 0 };
    if (esFemenino(f.genero)) fila.femenino += 1;
    else if (esMasculino(f.genero)) fila.masculino += 1;
    mapa.set(k, fila);
  }
  const ordenadas = orden.filter((o) => mapa.has(o)).map((o) => ({ etiqueta: o, ...mapa.get(o)! }));
  for (const [k, v] of mapa) if (!orden.includes(k)) ordenadas.push({ etiqueta: k, ...v });
  return ordenadas;
}

/**
 * Lee las valoraciones de UNA empresa en un rango de fechas.
 *
 * Se filtra por `fechaConsulta` —cuándo se atendió— y no por la fecha agendada:
 * el informe es de lo que pasó, no de lo que estaba previsto.
 */
export async function agregar(
  empresa: string,
  desde: string,
  hasta: string,
): Promise<DatosInforme> {
  const filas = ((await postgresService.query(
    `SELECT h."genero_biologico" AS genero,
            CASE WHEN h."fecha_nacimiento" IS NOT NULL
                 THEN date_part('year', age(h."fecha_nacimiento"))::int END AS edad,
            h."mc_imc"::float AS imc,
            h."mc_af_clasificacion" AS af_clasificacion,
            h."mc_af_minutos_semana"::float AS af_minutos_semana,
            h."mc_af_horas_sedentario"::float AS af_horas_sedentario,
            h."mc_af_nivel" AS af_nivel,
            h."aptitud" AS aptitud,
            h."mc_riesgo_bodytech" AS riesgo,
            h."mc_dx_osteomuscular" AS dx_osteomuscular,
            (h."fechaConsulta" IS NOT NULL) AS atendida
       FROM "HistoriaClinica" h
      WHERE h."mc_empresa" = $1
        -- Las dos fechas NO son del mismo tipo: fechaConsulta es timestamptz y
        -- fechaAtencion es TEXTO con formatos mezclados. Un COALESCE entre las
        -- dos ni siquiera compila, y el cast de la segunda necesita la guarda
        -- regex delante: una fila mal formada abortaria la consulta entera.
        AND (
          (h."fechaConsulta" IS NOT NULL
            AND h."fechaConsulta" BETWEEN $2::timestamptz AND ($3::timestamptz + interval '1 day'))
          OR
          (h."fechaConsulta" IS NULL
            AND h."fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            AND h."fechaAtencion"::timestamptz
                BETWEEN $2::timestamptz AND ($3::timestamptz + interval '1 day'))
        )`,
    [empresa, desde, hasta],
  )) ?? []) as unknown as Fila[];

  const atendidas = filas.filter((f) => f.atendida);
  const agendadas = filas.length;
  const efectivas = atendidas.length;

  const edades = atendidas.map((f) => f.edad).filter((e): e is number => e !== null);

  return {
    empresa,
    desde,
    hasta,
    total: efectivas,
    oportunidad: {
      agendadas,
      efectivas,
      inasistencias: agendadas - efectivas,
      cumplimiento: agendadas > 0 ? (efectivas / agendadas) * 100 : 0,
    },
    genero: [
      { etiqueta: 'Femenino', valor: atendidas.filter((f) => esFemenino(f.genero)).length },
      { etiqueta: 'Masculino', valor: atendidas.filter((f) => esMasculino(f.genero)).length },
    ],
    edad: {
      minima: edades.length ? Math.min(...edades) : null,
      maxima: edades.length ? Math.max(...edades) : null,
      promedio: edades.length ? Math.round(edades.reduce((a, b) => a + b, 0) / edades.length) : null,
    },
    edadPorGenero: porGenero(atendidas, (f) => rangoEdad(f.edad), RANGOS).map((r) => ({
      rango: r.etiqueta,
      femenino: r.femenino,
      masculino: r.masculino,
    })),
    imc: contar(
      atendidas.map((f) => claseImc(f.imc)),
      ['Bajo peso', 'Normopeso', 'Sobrepeso', 'Obesidad'],
    ),
    imcPorGenero: porGenero(atendidas, (f) => claseImc(f.imc), [
      'Bajo peso',
      'Normopeso',
      'Sobrepeso',
      'Obesidad',
    ]).map((r) => ({ clase: r.etiqueta, femenino: r.femenino, masculino: r.masculino })),
    actividad: contar(
      atendidas.map((f) => f.af_clasificacion),
      ['Activo', 'Inactivo'],
    ),
    horasEjercicioPorGenero: porGenero(
      atendidas,
      (f) =>
        f.af_minutos_semana === null
          ? null
          : (`${Math.round(f.af_minutos_semana / 60)} h` as string),
      [],
    )
      .sort((a, b) => parseInt(a.etiqueta, 10) - parseInt(b.etiqueta, 10))
      .map((r) => ({ horas: r.etiqueta, femenino: r.femenino, masculino: r.masculino })),
    sedentario: contar(
      atendidas.map((f) =>
        f.af_horas_sedentario === null ? null : `${Math.round(f.af_horas_sedentario)}`,
      ),
    ).sort((a, b) => parseInt(a.etiqueta, 10) - parseInt(b.etiqueta, 10)),
    aptitud: contar(
      atendidas.map((f) => f.aptitud),
      ['Apto', 'Apto con recomendaciones', 'Apto con restricciones', 'Pendiente aptitud', 'No apto'],
    ),
    nivel: contar(
      atendidas.map((f) => f.af_nivel),
      ['Principiante', 'Intermedio', 'Avanzado'],
    ),
    riesgo: contar(
      atendidas.map((f) => f.riesgo),
      ['Bajo', 'Moderado', 'Alto'],
    ),
    // Un diagnóstico puede traer varios separados por coma o punto y coma.
    diagnosticos: contar(
      atendidas.flatMap((f) =>
        String(f.dx_osteomuscular ?? '')
          .split(/[;,]/)
          .map((d) => d.trim())
          .filter(Boolean),
      ),
    ),
  };
}

/** Las empresas que tienen valoraciones, para el selector del panel. */
export async function empresasConValoraciones(): Promise<string[]> {
  const filas = await postgresService.query(
    `SELECT DISTINCT "mc_empresa" AS empresa FROM "HistoriaClinica"
      WHERE "mc_empresa" IS NOT NULL AND "mc_empresa" <> '' ORDER BY 1`,
  );
  return (filas ?? []).map((f) => String(f.empresa));
}
