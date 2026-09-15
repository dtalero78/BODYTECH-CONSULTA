/**
 * Hoja donde cae una fila por cada valoración del Médico Corporativo al cerrar
 * la historia (la escribe `corporativo-sheet.service.ts` en el backend). Es la
 * que el médico les pasa a los entrenadores para armar el plan.
 *
 * Va acá y no en una variable de entorno porque no cambia y así queda
 * rastreable desde los botones que la usan (panel de coordinador y panel del
 * médico corporativo). Ojo con lo que eso implica: este archivo termina en el
 * bundle público, así que la URL es pública — y la hoja está compartida como
 * "cualquiera con el enlace" (decisión de Daniel, 9-sep-2026). Cualquiera que
 * mire el JS del sitio puede abrirla.
 */
export const EXCEL_VALORACIONES_URL =
  'https://docs.google.com/spreadsheets/d/1IZvnkd_HX-TRtHvmWGktYzaoKxFqQ4IKdKNIBh8vzTg/edit';
