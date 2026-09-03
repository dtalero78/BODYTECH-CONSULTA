// ============================================================================
// acc.controller — HTTP de la Valoración Corporal ACC.
//
// Envoltorio delgado sobre `acc.service`. Acá solo vive lo que es propio del
// transporte: parseo de query, códigos de estado y forma de la respuesta.
// ============================================================================

import { Request, Response } from 'express';
import accService, { type EstadoPaciente } from '../services/acc.service';
import accSheetsService from '../services/acc-sheets.service';
import pdfService from '../services/pdf.service';
import { construirInformeAccHtml } from '../helpers/acc-informe-html';
import { getSession } from '../middleware/rbac.middleware';
import { normalizarSexo } from '../helpers/antropometria';

const ESTADOS: EstadoPaciente[] = [
  'cargado',
  'contactado',
  'agendado',
  'confirmado',
  'asistio',
  'no_show',
  'descartado',
];

/** Slug seguro para nombre de archivo: sin tildes, espacios ni separadores. */
function slug(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Cálculo en vivo mientras el fisioterapeuta escribe. No persiste nada.
 */
async function calcular(req: Request, res: Response): Promise<void> {
  try {
    const resultado = accService.calcular(req.body ?? {});
    res.json({ success: true, resultado });
  } catch (error) {
    console.error('❌ [ACC] Error calculando:', error);
    res.status(500).json({ success: false, error: 'CALCULO_FALLIDO' });
  }
}

/**
 * Guarda (o actualiza) el borrador de una valoración. El evaluador sale de la
 * sesión, no del body: quién tomó la medida no lo decide el cliente.
 */
async function guardar(req: Request, res: Response): Promise<void> {
  try {
    const session = getSession(req);
    const valoracion = await accService.guardarBorrador({
      ...req.body,
      evaluador: session?.nombre ?? req.body?.evaluador ?? null,
      evaluadorUsuarioId: session?.userId ?? null,
    });
    res.json({ success: true, valoracion });
  } catch (error: any) {
    if (error?.message === 'NUMERO_ID_REQUERIDO') {
      res.status(400).json({ success: false, error: 'NUMERO_ID_REQUERIDO' });
      return;
    }
    console.error('❌ [ACC] Error guardando valoración:', error);
    res.status(500).json({ success: false, error: 'GUARDADO_FALLIDO' });
  }
}

/**
 * Cierra la valoración. 422 con el detalle si faltan datos que el informe
 * imprime — el fisio todavía tiene al paciente enfrente y puede corregir.
 */
async function cerrar(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'ID_INVALIDO' });
    return;
  }
  try {
    const valoracion = await accService.cerrarValoracion(id);
    res.json({ success: true, valoracion });

    // El volcado al Excel de Sol Médica va DESPUÉS de responder y sin await: el
    // fisioterapeuta no tiene por qué esperar a Google para cerrar la atención.
    // Si falla, la fila queda sin marca de exportada y el barrido la retoma.
    accSheetsService.exportarPendientes(10).catch(() => {});
  } catch (error: any) {
    if (error?.message === 'VALORACION_NO_ENCONTRADA') {
      res.status(404).json({ success: false, error: 'VALORACION_NO_ENCONTRADA' });
      return;
    }
    if (error?.message === 'VALORACION_INCOMPLETA') {
      res.status(422).json({
        success: false,
        error: 'VALORACION_INCOMPLETA',
        faltantes: error.faltantes ?? [],
        mensaje: `Faltan datos para emitir el informe: ${(error.faltantes ?? []).join(', ')}.`,
      });
      return;
    }
    console.error('❌ [ACC] Error cerrando valoración:', error);
    res.status(500).json({ success: false, error: 'CIERRE_FALLIDO' });
  }
}

async function getValoracion(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'ID_INVALIDO' });
    return;
  }
  const valoracion = await accService.getValoracion(id);
  if (!valoracion) {
    res.status(404).json({ success: false, error: 'VALORACION_NO_ENCONTRADA' });
    return;
  }
  res.json({ success: true, valoracion });
}

async function historial(req: Request, res: Response): Promise<void> {
  const valoraciones = await accService.listarPorPaciente(String(req.params.numeroId));
  res.json({ success: true, valoraciones });
}

/**
 * El informe en PDF. El archivo se rotula con nombre y cédula — pedido
 * explícito del cliente, no un detalle cosmético.
 */
async function informe(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'ID_INVALIDO' });
    return;
  }

  try {
    const v = await accService.getValoracion(id);
    if (!v) {
      res.status(404).json({ success: false, error: 'VALORACION_NO_ENCONTRADA' });
      return;
    }

    const r = v.resultado;
    const html = construirInformeAccHtml({
      nombreCompleto: v.nombreCompleto ?? '',
      numeroId: v.numeroId,
      edad: v.edad ?? null,
      sexo: normalizarSexo(v.sexo),
      estaturaCm: v.estaturaCm ?? null,
      pesoKg: v.pesoKg ?? null,
      fechaEvaluacion: v.fechaEvaluacion ?? '',
      evaluador: v.evaluador ?? null,
      sede: v.sede ?? null,

      imc: r.imc?.valor ?? null,
      imcEstado: r.imc?.evaluacion ?? null,
      pctGrasa: r.porcentajeGrasa?.valor ?? null,
      grasaEstado: r.porcentajeGrasa?.evaluacion ?? null,
      metodoGrasa: r.metodoGrasa,
      pctMuscular: r.porcentajeMuscular?.valor ?? null,
      muscularEstado: r.porcentajeMuscular?.evaluacion ?? null,
      pesoMuscularKg: r.pesoMuscularKg,
      masaGrasaKg: r.masaGrasaKg,
      masaLibreGrasaKg: r.masaLibreGrasaKg,
      imm: r.imm,
      tmbKcal: r.tmbKcal?.valor ?? null,
      icc: r.icc?.valor ?? null,
      iccEstado: r.icc?.evaluacion ?? null,
      ict: r.ict?.valor ?? null,
      ictEstado: r.ict?.evaluacion ?? null,
      perimetroAbdominal: v.perimetroAbdominal ?? null,
      perimetroAbdominalEstado: r.perimetroAbdominal?.evaluacion ?? null,
      perimetroCadera: v.perimetroCadera ?? null,
      sumatoria6: r.sumatoria6,
      sumatoria8: r.sumatoria8,

      perimetros: [
        { label: 'Abdominal', valor: v.perimetroAbdominal ?? null, unidad: 'cm' },
        { label: 'Cadera', valor: v.perimetroCadera ?? null, unidad: 'cm' },
        { label: 'Bíceps derecho relajado', valor: v.perimetroBrazoRelajadoDer ?? null, unidad: 'cm' },
        { label: 'Bíceps derecho contraído', valor: v.perimetroBrazoContraidoDer ?? null, unidad: 'cm' },
        { label: 'Bíceps izquierdo relajado', valor: v.perimetroBrazoRelajadoIzq ?? null, unidad: 'cm' },
        { label: 'Bíceps izquierdo contraído', valor: v.perimetroBrazoContraidoIzq ?? null, unidad: 'cm' },
        { label: 'Muslo derecho', valor: v.perimetroMusloDer ?? null, unidad: 'cm' },
        { label: 'Muslo izquierdo', valor: v.perimetroMusloIzq ?? null, unidad: 'cm' },
        { label: 'Pantorrilla', valor: v.perimetroPantorrilla ?? null, unidad: 'cm' },
      ],
      pliegues: [
        { label: 'Tríceps', valor: v.pliegueTriceps ?? null },
        { label: 'Subescapular', valor: v.pliegueSubescapular ?? null },
        { label: 'Bíceps', valor: v.pliegueBiceps ?? null },
        { label: 'Cresta ilíaca', valor: v.pliegueCrestaIliaca ?? null },
        { label: 'Supraespinal', valor: v.pliegueSupraespinal ?? null },
        { label: 'Abdominal', valor: v.pliegueAbdominal ?? null },
        { label: 'Muslo anterior', valor: v.pliegueMusloAnterior ?? null },
        { label: 'Pantorrilla', valor: v.plieguePantorrilla ?? null },
      ],
      observaciones: v.observaciones ?? null,
    });

    const pdf = await pdfService.htmlToPdf(html);
    const nombre = `valoracion-acc-${slug(v.nombreCompleto ?? 'paciente')}-${slug(v.numeroId)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
    res.send(pdf);
  } catch (error) {
    console.error('❌ [ACC] Error generando el informe:', error);
    res.status(500).json({ success: false, error: 'INFORME_FALLIDO' });
  }
}

async function listarPacientes(req: Request, res: Response): Promise<void> {
  const estadoRaw = req.query.estado ? String(req.query.estado) : undefined;
  const estado = estadoRaw && ESTADOS.includes(estadoRaw as EstadoPaciente)
    ? (estadoRaw as EstadoPaciente)
    : undefined;

  // `fecha` es la agenda del evaluador ("a quién le toca hoy"). Se valida acá
  // para que una cadena rara no llegue al rango de fechas del servicio.
  const fechaRaw = req.query.fecha ? String(req.query.fecha) : '';
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaRaw) ? fechaRaw : undefined;

  const pacientes = await accService.listarPacientes({
    cohorte: req.query.cohorte ? String(req.query.cohorte) : undefined,
    estado,
    busqueda: req.query.q ? String(req.query.q) : undefined,
    fecha,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  res.json({ success: true, pacientes });
}

/** Carga la base que entrega Sol Médica. Idempotente por (cédula, cohorte). */
async function cargarCohorte(req: Request, res: Response): Promise<void> {
  const cohorte = String(req.body?.cohorte ?? '').trim();
  const pacientes = req.body?.pacientes;
  if (!cohorte) {
    res.status(400).json({ success: false, error: 'COHORTE_REQUERIDA' });
    return;
  }
  if (!Array.isArray(pacientes) || pacientes.length === 0) {
    res.status(400).json({ success: false, error: 'PACIENTES_REQUERIDOS' });
    return;
  }
  if (pacientes.length > 5000) {
    res.status(413).json({ success: false, error: 'LOTE_DEMASIADO_GRANDE', maximo: 5000 });
    return;
  }

  try {
    const resumen = await accService.cargarCohorte(cohorte, pacientes);
    res.json({ success: true, ...resumen });
  } catch (error) {
    console.error('❌ [ACC] Error cargando cohorte:', error);
    res.status(500).json({ success: false, error: 'CARGA_FALLIDA' });
  }
}

async function marcarEstado(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const estado = String(req.body?.estado ?? '');
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'ID_INVALIDO' });
    return;
  }
  if (!ESTADOS.includes(estado as EstadoPaciente)) {
    res.status(400).json({ success: false, error: 'ESTADO_INVALIDO', permitidos: ESTADOS });
    return;
  }
  try {
    await accService.marcarEstado(id, estado as EstadoPaciente, req.body?.citaFecha);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ [ACC] Error marcando estado:', error);
    res.status(500).json({ success: false, error: 'ESTADO_FALLIDO' });
  }
}

/** El embudo. La tasa de no-show es la que define qué se factura. */
async function embudo(req: Request, res: Response): Promise<void> {
  const embudo = await accService.getEmbudo(
    req.query.cohorte ? String(req.query.cohorte) : undefined
  );
  res.json({ success: true, embudo });
}

async function exportarSheet(_req: Request, res: Response): Promise<void> {
  try {
    const resultado = await accSheetsService.exportarPendientes();
    res.json({ success: resultado.ok, ...resultado });
  } catch (error) {
    console.error('❌ [ACC] Error exportando al Sheet:', error);
    res.status(500).json({ success: false, error: 'EXPORT_FALLIDO' });
  }
}

async function estadoSheet(_req: Request, res: Response): Promise<void> {
  const pendientes = await accService.pendientesDeExportar(200);
  res.json({
    success: true,
    configurado: accSheetsService.estaConfigurado(),
    pendientes: pendientes.length,
  });
}

export const accController = {
  calcular,
  guardar,
  cerrar,
  getValoracion,
  historial,
  informe,
  listarPacientes,
  cargarCohorte,
  marcarEstado,
  embudo,
  exportarSheet,
  estadoSheet,
};

export default accController;
