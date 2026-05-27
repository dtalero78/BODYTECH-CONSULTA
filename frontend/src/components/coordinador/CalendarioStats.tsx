// ============================================================================
// CalendarioStats — DEPRECADO en la spec del Panel Coordinador editorial.
//
// Antes renderizaba 3 charts Recharts (PieChart x2 + stacked BarChart). En el
// rediseño iter-2, las estadísticas viven como 4 KPI cards (estilo Stripe) en
// el header de `CalendarioView.tsx` (`KpiCard`), con delta porcentual vs. mes
// anterior. Este archivo se conserva como stub vacío para no romper imports
// externos eventuales y para documentar dónde se movió la responsabilidad.
//
// El paquete `recharts` puede seguir instalado (lo usan otras páginas), pero
// aquí ya no se importa. NO eliminar este archivo sin verificar que ningún
// otro módulo lo importa.
// ============================================================================

import type { MesResumen } from '../../services/calendario.service';
import type { Profesional } from '../../services/profesionales.service';

interface Props {
  mes: MesResumen;
  profesionales: Profesional[];
}

export function CalendarioStats(_props: Props): null {
  return null;
}
