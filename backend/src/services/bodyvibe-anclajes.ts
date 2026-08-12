// ============================================================================
// bodyvibe-anclajes — Dónde se puede enchufar un app dentro de la plataforma.
//
// Es la otra mitad de la puerta 2: además de cambiar la apariencia, un app con
// código propio puede quedar INCRUSTADO en una pantalla que ya existe, en vez
// de vivir aparte en `/apps`.
//
// Los anclajes son explícitos y limitados a propósito. No es "cualquier lugar
// de cualquier pantalla": es una lista de puntos que alguien instaló a mano
// sabiendo qué hay alrededor. Un anclaje mal puesto no rompe un app — rompe la
// pantalla donde vive.
//
// ⚠️ REGLA QUE NO SE NEGOCIA: no hay ni habrá anclajes dentro de `VideoRoom` ni
// de `MedicalConsultationPanel`. Ese panel comparte pantalla con una consulta
// en vivo y produce un documento legal; ahí solo se permite apariencia
// (decisión 07). `/panel-medico` sí admite anclajes: es la lista de pacientes,
// una pantalla distinta que se usa antes y después de atender, nunca durante.
// ============================================================================

export interface Anclaje {
  id: string;
  /** Ruta donde vive, para que el agente sepa qué hay alrededor. */
  pantalla: string;
  nombre: string;
  descripcion: string;
}

export const ANCLAJES: Anclaje[] = [
  {
    id: 'panel-medico.pie',
    pantalla: '/panel-medico',
    nombre: 'Panel médico — debajo de la lista',
    descripcion:
      'Al pie de la lista de pacientes del día. Lo ven médicos y coaches antes y después de atender, nunca durante una consulta.',
  },
  {
    id: 'coordinador.calendario.pie',
    pantalla: '/coordinador',
    nombre: 'Coordinador — debajo del calendario',
    descripcion: 'Al pie de la vista de calendario, después de la agenda del día.',
  },
  {
    id: 'coordinador.profesionales.pie',
    pantalla: '/coordinador',
    nombre: 'Coordinador — debajo de profesionales',
    descripcion: 'Al pie del listado de profesionales.',
  },
  {
    id: 'coordinador.indicadores.pie',
    pantalla: '/coordinador',
    nombre: 'Coordinador — debajo de indicadores',
    descripcion: 'Al pie de la vista de indicadores. El lugar natural para un tablero propio.',
  },
  {
    id: 'ordenes.pie',
    pantalla: '/ordenes',
    nombre: 'Órdenes — debajo del listado',
    descripcion: 'Al pie del panel de órdenes médicas.',
  },
  {
    id: 'historias.pie',
    pantalla: '/historias',
    nombre: 'Historias — debajo del buscador',
    descripcion: 'Al pie del buscador de historias clínicas.',
  },
];

export function anclajeValido(id: string | null | undefined): boolean {
  if (!id) return true; // sin anclaje = app suelto en /apps
  return ANCLAJES.some((a) => a.id === id);
}

export function describirAnclaje(id: string | null | undefined): string {
  if (!id) return 'suelto, en la pantalla de Aplicaciones';
  return ANCLAJES.find((a) => a.id === id)?.nombre ?? id;
}
