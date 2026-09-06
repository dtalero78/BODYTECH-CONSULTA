// ============================================================================
// padron.helper — Normalización y clasificación de identidades de afiliados.
//
// Funciones PURAS, sin base de datos, para poder probarlas contra los casos
// reales que aparecieron al medir producción (ver `__tests__/padron.helper.test.ts`).
//
// ── Por qué existe ──────────────────────────────────────────────────────────
// El padrón único de afiliados va a agrupar por documento a las ~4.187 personas
// que hoy viven sueltas en `HistoriaClinica`. Medido contra producción, 74 de
// esos documentos traen MÁS DE UNA versión del nombre, y no todas significan lo
// mismo:
//
//   · la gran mayoría es la misma persona escrita con más o menos partes
//     ("Ana Bernal" y "Ana Maria Bernal Ruiz"),
//   · dos son reservas administrativas hechas con la cédula de un profesional
//     ("capacitación SST", "Evaluación Puesto Trabajo"),
//   · y una es un choque de verdad: el documento 1045230662 tiene "Jose López"
//     y "yoelis del carmen solano palacio".
//
// Agrupar por documento a secas fusionaría ese último caso en una sola persona
// y le colgaría a alguien la historia clínica de otro. Por eso la clasificación
// distingue tres estados y sólo unifica el caso seguro.
// ============================================================================

/**
 * Forma comparable de un nombre: sin tildes, sin dobles espacios, en mayúsculas.
 *
 * Usa NFD y NO un reemplazo carácter a carácter: en producción hay tildes
 * DESCOMPUESTAS (la letra y el acento como dos caracteres), invisibles para un
 * `translate()`. Por eso "Mónica" y "Monica" parecían personas distintas al
 * medir la base.
 *
 * La Ñ queda como N, porque NFD también la descompone. Es lo que se quiere para
 * COMPARAR —quien escribe "Patino" y quien escribe "Patiño" es la misma
 * persona—, pero implica que esto sirve de LLAVE y nunca para mostrar: el
 * nombre que se le enseña a alguien es siempre el original.
 */
export function normalizarNombre(raw: string | null | undefined): string {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z\s]/g, ' ') // comas y puntos: "Jennifer, Romero" == "Jennifer Romero"
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** Documento comparable: sólo dígitos, sin ceros a la izquierda. */
export function normalizarDocumento(raw: string | null | undefined): string {
  const soloDigitos = String(raw ?? '').replace(/\D/g, '');
  return soloDigitos.replace(/^0+(?=\d)/, '');
}

/**
 * Las partes del nombre, como conjunto. Es lo que permite decir que
 * "Ana Bernal" está CONTENIDO en "Ana Maria Bernal Ruiz".
 */
function partes(nombre: string): Set<string> {
  return new Set(normalizarNombre(nombre).split(' ').filter(Boolean));
}

/** `true` si todas las partes de `a` están en `b` (a es una versión corta de b). */
function contenidoEn(a: Set<string>, b: Set<string>): boolean {
  for (const p of a) if (!b.has(p)) return false;
  return true;
}

export type EstadoIdentidad = 'unico' | 'unificable' | 'conflicto' | 'administrativo';

export interface IdentidadAgrupada {
  documento: string;
  variantes: string[];
  /** La versión que gana: la más completa de las unificables. */
  nombreCanonico: string;
  estado: EstadoIdentidad;
  /** Por qué quedó en ese estado, en lenguaje de negocio. */
  motivo: string;
  /**
   * La cédula pertenece a alguien de la planta. Es CONTEXTO para quien revise,
   * no una clasificación: un profesional puede atenderse como paciente, y de
   * hecho pasa (Mauricio Peña, nutricionista, aparece con su propia cédula).
   */
  esCedulaDeProfesional: boolean;
}

/**
 * Palabras que delatan una reserva administrativa en vez de una persona. Salen
 * de los casos reales encontrados en producción; la lista es corta a propósito
 * — es mejor que se escape una que bautizar como "no persona" a alguien.
 */
const PALABRAS_ADMINISTRATIVAS = [
  'CAPACITACION',
  'EVALUACION',
  'PUESTO',
  'TRABAJO',
  'SST',
  'PRUEBA',
  'TEST',
];

function pareceAdministrativo(variantes: string[]): boolean {
  return variantes.some((v) => {
    const n = normalizarNombre(v);
    return PALABRAS_ADMINISTRATIVAS.some((p) => n.includes(p));
  });
}

/**
 * Clasifica las versiones del nombre que trae un mismo documento.
 *
 * `documentosDeProfesionales` son las cédulas de la planta: cuando un documento
 * es de un profesional, lo que hay detrás no es un paciente sino una reserva
 * hecha con su cédula, y no debe entrar al padrón como persona.
 */
export function clasificarIdentidad(
  documento: string,
  variantesCrudas: ReadonlyArray<string>,
  documentosDeProfesionales: ReadonlySet<string> = new Set(),
): IdentidadAgrupada {
  const doc = normalizarDocumento(documento);

  // Distintas en su forma comparable; se conserva la escritura original para mostrar.
  const vistas = new Map<string, string>();
  for (const v of variantesCrudas) {
    const n = normalizarNombre(v);
    if (n && !vistas.has(n)) vistas.set(n, String(v).trim());
  }
  const normalizadas = [...vistas.keys()];
  const originales = [...vistas.values()];

  const esCedulaDeProfesional = documentosDeProfesionales.has(doc);
  const base = (estado: EstadoIdentidad, motivo: string, canonico: string): IdentidadAgrupada => ({
    documento: doc,
    variantes: originales,
    nombreCanonico: canonico,
    estado,
    motivo,
    esCedulaDeProfesional,
  });

  // Que la cédula sea de un profesional NO basta para decir "no es una persona":
  // al correr esto contra las 4.188 filas reales, la regla dejaba fuera a
  // Mauricio Peña —nutricionista atendido como paciente con su propia cédula—.
  // Quien decide es el NOMBRE; lo otro se informa como contexto.
  if (pareceAdministrativo(originales)) {
    return base(
      'administrativo',
      'El nombre describe un servicio, no a una persona.',
      originales[0] ?? '',
    );
  }
  if (normalizadas.length <= 1) {
    return base('unico', 'Una sola versión del nombre.', originales[0] ?? '');
  }

  // Unificable ⟺ existe UNA versión que contiene a todas las demás. Ese es el
  // caso "misma persona escrita con más o menos partes", y esa versión gana.
  const conjuntos = normalizadas.map(partes);
  let indiceMasCompleto = 0;
  for (let i = 1; i < conjuntos.length; i++) {
    if (conjuntos[i].size > conjuntos[indiceMasCompleto].size) indiceMasCompleto = i;
  }
  const masCompleto = conjuntos[indiceMasCompleto];
  const todasContenidas = conjuntos.every((c) => contenidoEn(c, masCompleto));

  if (todasContenidas) {
    return base(
      'unificable',
      'La misma persona escrita con más o menos partes del nombre; gana la versión completa.',
      originales[indiceMasCompleto],
    );
  }

  return base(
    'conflicto',
    'El documento trae nombres que no son versiones del mismo: hay que revisarlo a mano antes de unificar.',
    originales[indiceMasCompleto],
  );
}
