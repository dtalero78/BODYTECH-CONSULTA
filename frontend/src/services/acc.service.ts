// ============================================================================
// acc.service — cliente de la Valoración Corporal ACC.
//
// El cálculo NO vive acá: corre en el backend (`/api/acc/calcular`), que es el
// único lugar donde las fórmulas están cubiertas por tests. El panel manda
// medidas y pinta lo que le devuelven.
// ============================================================================

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const client = axios.create({ baseURL: `${API_BASE_URL}/api/acc` });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('bsl_auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export type Evaluacion = 'bajo' | 'normal' | 'alto' | 'optimo';

export interface ValorEvaluado {
  valor: number;
  evaluacion: Evaluacion | null;
}

export interface ResultadoAntropometrico {
  imc: ValorEvaluado | null;
  porcentajeGrasa: ValorEvaluado | null;
  porcentajeMuscular: ValorEvaluado | null;
  pesoMuscularKg: number | null;
  masaGrasaKg: number | null;
  masaLibreGrasaKg: number | null;
  imm: number | null;
  tmbKcal: ValorEvaluado | null;
  icc: ValorEvaluado | null;
  ict: ValorEvaluado | null;
  perimetroAbdominal: ValorEvaluado | null;
  sumatoria6: number | null;
  sumatoria8: number | null;
  metodoGrasa: 'yuhasz' | 'faulkner' | 'durnin-womersley' | null;
  faltantes: string[];
}

/** Las medidas que teclea el fisioterapeuta. Todo string: vienen de inputs. */
export interface Medidas {
  sexo?: string | null;
  edad?: string | number | null;
  estaturaCm?: string | number | null;
  pesoKg?: string | number | null;
  perimetroAbdominal?: string | number | null;
  perimetroCadera?: string | number | null;
  perimetroBrazoRelajadoDer?: string | number | null;
  perimetroBrazoContraidoDer?: string | number | null;
  perimetroBrazoRelajadoIzq?: string | number | null;
  perimetroBrazoContraidoIzq?: string | number | null;
  perimetroMusloDer?: string | number | null;
  perimetroMusloIzq?: string | number | null;
  perimetroPantorrilla?: string | number | null;
  pliegueTriceps?: string | number | null;
  pliegueSubescapular?: string | number | null;
  pliegueBiceps?: string | number | null;
  pliegueCrestaIliaca?: string | number | null;
  pliegueSupraespinal?: string | number | null;
  pliegueAbdominal?: string | number | null;
  pliegueMusloAnterior?: string | number | null;
  plieguePantorrilla?: string | number | null;
}

export interface Valoracion extends Medidas {
  id: number;
  numeroId: string;
  nombreCompleto: string | null;
  fechaEvaluacion: string;
  sede: string | null;
  evaluador: string | null;
  estado: 'borrador' | 'cerrada';
  observaciones: string | null;
  resultado: ResultadoAntropometrico;
  cerradaAt: string | null;
  exportadaSheetAt: string | null;
}

export interface AccPaciente {
  id: number;
  numeroId: string;
  nombreCompleto: string;
  edad: number | null;
  sexo: string | null;
  celular: string | null;
  empresa: string | null;
  cohorte: string;
  estado: string;
  sede: string | null;
  citaFecha: string | null;
  /** Última valoración de la persona, para no medir dos veces a la misma. */
  ultimaValoracion: {
    id: number;
    estado: 'borrador' | 'cerrada';
    fechaEvaluacion: string;
  } | null;
}

export interface Embudo {
  cohorte: string;
  base: number;
  contactados: number;
  agendados: number;
  asistieron: number;
  noShow: number;
  descartados: number;
  tasaNoShow: number | null;
}

/** Error de cierre con el detalle de qué falta. */
export class ValoracionIncompleta extends Error {
  constructor(public faltantes: string[]) {
    super(`Faltan datos para emitir el informe: ${faltantes.join(', ')}`);
    this.name = 'ValoracionIncompleta';
  }
}

async function calcular(medidas: Medidas): Promise<ResultadoAntropometrico> {
  const { data } = await client.post('/calcular', medidas);
  return data.resultado;
}

async function guardar(entrada: Medidas & {
  numeroId: string;
  nombreCompleto?: string | null;
  fechaEvaluacion?: string | null;
  sede?: string | null;
  pacienteId?: number | null;
  observaciones?: string | null;
  origenDatos?: 'manual' | 'inbody';
}): Promise<Valoracion> {
  const { data } = await client.post('/valoraciones', entrada);
  return data.valoracion;
}

async function cerrar(id: number): Promise<Valoracion> {
  try {
    const { data } = await client.post(`/valoraciones/${id}/cerrar`);
    return data.valoracion;
  } catch (e) {
    const resp = axios.isAxiosError(e) ? e.response : undefined;
    if (resp?.status === 422) throw new ValoracionIncompleta(resp.data?.faltantes ?? []);
    throw e;
  }
}

async function getValoracion(id: number): Promise<Valoracion> {
  const { data } = await client.get(`/valoraciones/${id}`);
  return data.valoracion;
}

async function historial(numeroId: string): Promise<Valoracion[]> {
  const { data } = await client.get(`/historial/${encodeURIComponent(numeroId)}`);
  return data.valoraciones;
}

async function listarPacientes(params: {
  cohorte?: string;
  estado?: string;
  q?: string;
  /** YYYY-MM-DD, día de Colombia. Sin esto, la lista no está acotada al día. */
  fecha?: string;
} = {}): Promise<AccPaciente[]> {
  const { data } = await client.get('/pacientes', { params });
  return data.pacientes;
}

async function getEmbudo(cohorte?: string): Promise<Embudo> {
  const { data } = await client.get('/embudo', { params: cohorte ? { cohorte } : {} });
  return data.embudo;
}

async function cargarCohorte(
  cohorte: string,
  pacientes: Array<{ numeroId: string; nombreCompleto: string; [k: string]: unknown }>
): Promise<{ insertados: number; actualizados: number; omitidos: number }> {
  const { data } = await client.post('/pacientes/cargar', { cohorte, pacientes });
  return data;
}

async function marcarEstado(pacienteId: number, estado: string, citaFecha?: string): Promise<void> {
  await client.post(`/pacientes/${pacienteId}/estado`, { estado, citaFecha });
}

async function exportarSheet(): Promise<{ exportadas: number; errores: number }> {
  const { data } = await client.post('/sheets/exportar');
  return data;
}

async function estadoSheet(): Promise<{ configurado: boolean; pendientes: number }> {
  const { data } = await client.get('/sheets/estado');
  return data;
}

/**
 * Abre el informe en una pestaña nueva.
 *
 * Se descarga como blob en vez de apuntar el `href` al endpoint: la ruta exige
 * sesión y una pestaña nueva no lleva el header Authorization. La alternativa
 * —mandar el JWT en la query— lo dejaría escrito en el historial del navegador
 * y en los logs del servidor, que con datos de salud no es aceptable.
 *
 * El object URL se revoca al minuto: para entonces el visor ya cargó el archivo.
 */
async function abrirInforme(id: number): Promise<void> {
  const { data } = await client.get(`/valoraciones/${id}/informe.pdf`, {
    responseType: 'blob',
  });
  const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const accService = {
  calcular,
  guardar,
  cerrar,
  getValoracion,
  historial,
  listarPacientes,
  getEmbudo,
  cargarCohorte,
  marcarEstado,
  exportarSheet,
  estadoSheet,
  abrirInforme,
};

export default accService;
