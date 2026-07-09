// ============================================================================
// trepsi.controller — HTTP wrappers para la integración Trepsi.
//
// Sigue el envelope { ok, error: { code, message, details? } } definido en la
// spec v2.1 (sección 7 — Códigos de respuesta). Es DIFERENTE al envelope
// `{ success, ... }` del resto de la API porque este contrato es público hacia
// un tercero y ya está documentado en el PDF.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import trepsiService from '../services/trepsi.service';
import profesionalesService from '../services/profesionales.service';
import calendarioService from '../services/calendario.service';

// ---------------------------------------------------------------------------
// Zod schemas (espejo de la spec)
// ---------------------------------------------------------------------------

const medicoSchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().optional(),
  especialidad: z.string().optional(),
});

const pacienteSchema = z.object({
  numeroId: z.string().min(1).regex(/^\d+$/, 'numeroId debe contener sólo dígitos.'),
  tipoDocumento: z.enum(['CC', 'CE', 'TI', 'PA', 'RC']),
  primerNombre: z.string().min(1),
  segundoNombre: z.string().optional(),
  primerApellido: z.string().min(1),
  segundoApellido: z.string().optional(),
  fechaNacimiento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'fechaNacimiento debe ser YYYY-MM-DD.'),
  sexo: z.enum(['M', 'F', 'Otro']).optional(),
  // Normalización defensiva: Trepsi a veces manda el celular local colombiano
  // (10 dígitos empezando por 3) sin el prefijo +57. Lo autopoblamos aquí para
  // no rechazar la cita, dejando E.164 como formato canónico interno.
  celular: z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const clean = v.replace(/\s+/g, '').trim();
    if (/^3\d{9}$/.test(clean)) return `+57${clean}`;
    return clean;
  }, z.string().regex(/^\+\d{8,15}$/, 'celular debe estar en formato E.164 (ej. +573001234567) o ser un móvil colombiano de 10 dígitos empezando por 3.')),
  email: z.string().email().optional(),
  direccion: z.string().optional(),
  ciudad: z.string().optional(),
  eps: z.string().optional(),
});

const historiaClinicaSchema = z
  .object({
    motivoConsulta: z.string().min(1),
    consentimientoInformado: z.literal(true, {
      errorMap: () => ({ message: 'consentimientoInformado debe ser true.' }),
    }),
  })
  .passthrough(); // aceptamos campos adicionales (antecedentes, hábitos, adjuntos, etc.)

const iso8601WithOffsetRegex =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// Nuevos campos nutricionales que Trepsi envía a partir de su update (jun 2026).
// Todos opcionales — citas anteriores siguen funcionando sin ellos.
const patientMedidasSchema = z
  .object({
    perimetroCintura: z.number().nullable().optional(),
    perimetroAbdomen: z.number().nullable().optional(),
    perimetroCadera: z.number().nullable().optional(),
    perimetroPecho: z.number().nullable().optional(),
    brazoDerecho: z.number().nullable().optional(),
    brazoIzquierdo: z.number().nullable().optional(),
    piernaDerecha: z.number().nullable().optional(),
    piernaIzquierda: z.number().nullable().optional(),
    pliegueBiceps: z.number().nullable().optional(),
    pliegueTriceps: z.number().nullable().optional(),
    pliegueSubescapular: z.number().nullable().optional(),
    pliegueAbdominal: z.number().nullable().optional(),
    perimetroCuello: z.number().nullable().optional(),
  })
  .passthrough();

const alimentoAnamnesisSchema = z.object({
  alimento: z.string(),
  cantidad: z.number(),
});

const anamnesisSchema = z
  .object({
    desayuno: z.array(alimentoAnamnesisSchema).optional(),
    nueves: z.array(alimentoAnamnesisSchema).optional(),
    almuerzo: z.array(alimentoAnamnesisSchema).optional(),
    onces: z.array(alimentoAnamnesisSchema).optional(),
    cena: z.array(alimentoAnamnesisSchema).optional(),
  })
  .passthrough();

const createSchema = z.object({
  citaId: z.string().min(1).max(120),
  fechaAtencion: z
    .string()
    .regex(iso8601WithOffsetRegex, 'fechaAtencion debe ser ISO 8601 con offset.'),
  duracionMinutos: z.number().int().min(15).max(120).optional(),
  medico: medicoSchema,
  paciente: pacienteSchema,
  historiaClinica: historiaClinicaSchema,
  tipoConsulta: z.string().optional(),
  sede: z.string().optional(),
  observaciones: z.string().max(1000).optional(),
  // Empresa que patrocina la consulta (ej. "athletic"). Trepsi lo añade
  // para segmentar sus reportes. Se persiste en HistoriaClinica.codEmpresa
  // en mayúsculas para consistencia con las empresas legacy (PARTICULAR,
  // SANITHELP-JJ, etc.).
  empresa: z.string().max(50).optional(),
  // Datos nutricionales que el paciente diligencia en la app Trepsi.
  vasosDeAguaBebidos: z.string().optional(),
  perimetros: patientMedidasSchema.nullable().optional(),
  alimentosNoDeseados: z.array(z.string()).optional(),
  alimentosFavoritos: z.array(z.string()).optional(),
  anamnesis: anamnesisSchema.optional(),
  objective: z.string().optional(),
  // Medidas de primer nivel (Trepsi las envía fuera de historiaClinica).
  // Sin esto, z.object() las descarta antes de llegar al servicio.
  peso: z.union([z.number(), z.string()]).optional(),
  alturaEnCm: z.union([z.number(), z.string()]).optional(),
});

// PATCH /appointments/:citaId/historia — todos los campos son opcionales,
// pero al menos uno debe enviarse. consentimientoInformado se ignora si llega
// (no se puede cambiar retroactivamente; el consentimiento ya se dio al crear).
const patchHistoriaSchema = z
  .object({
    motivoConsulta: z.string().min(1).optional(),
    enfermedadActual: z.string().optional(),
    antecedentesPersonales: z
      .object({
        patologicos: z.array(z.string()).optional(),
        quirurgicos: z.array(z.string()).optional(),
        alergicos: z.array(z.string()).optional(),
        farmacologicos: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    antecedentesFamiliares: z.string().optional(),
    habitos: z.object({}).passthrough().optional(),
    medicacionActual: z
      .array(
        z.object({
          nombre: z.string(),
          dosis: z.string().optional(),
          frecuencia: z.string().optional(),
        })
      )
      .optional(),
    alergias: z
      .array(
        z.object({
          sustancia: z.string(),
          reaccion: z.string().nullable().optional(),
        })
      )
      .optional(),
    signosVitales: z
      .object({
        ta: z.string().optional(),
        fc: z.number().optional(),
        fr: z.number().optional(),
        temp: z.number().optional(),
        peso: z.number().optional(),
        talla: z.number().optional(),
        imc: z.number().optional(),
      })
      .passthrough()
      .optional(),
    adjuntos: z.array(z.object({}).passthrough()).optional(),
  })
  .passthrough()
  .refine(
    (v) => Object.keys(v).length > 0,
    'Debe enviar al menos un campo de historiaClinica.'
  );

const scheduleSchema = z
  .object({
    fechaAtencion: z
      .string()
      .regex(iso8601WithOffsetRegex, 'fechaAtencion debe ser ISO 8601 con offset.')
      .optional(),
    duracionMinutos: z.number().int().min(15).max(120).optional(),
    medico: medicoSchema.optional(),
    motivo: z.string().optional(),
  })
  .refine(
    (v) => v.fechaAtencion || v.duracionMinutos != null || v.medico,
    'Debe enviar al menos uno de: fechaAtencion, duracionMinutos, medico.'
  );

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zodToDetails(err: ZodError) {
  return err.errors.map((e) => ({
    field: e.path.join('.') || '(root)',
    issue: e.message,
  }));
}

function respond<T>(
  res: Response,
  result: { ok: boolean; status: number; data?: T; error?: { code: string; message: string } }
): void {
  if (result.ok) {
    res.status(result.status).json({ ok: true, ...(result.data as object) });
    return;
  }
  res.status(result.status).json({
    ok: false,
    error: result.error,
  });
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

class TrepsiController {
  createAppointment = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Uno o más campos son inválidos.',
            details: zodToDetails(parsed.error),
          },
        });
        return;
      }

      const result = await trepsiService.createAppointment(parsed.data);

      if (result.ok && result.data) {
        res.status(result.status).json({
          ok: true,
          citaId: result.data.citaId,
          historiaClinicaId: result.data.historiaClinicaId,
          fechaAtencion: result.data.fechaAtencion,
          estado: result.data.estado,
          createdAt: result.data.createdAt,
        });
        return;
      }
      respond(res, result);
    } catch (err) {
      next(err);
    }
  };

  reschedule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const citaId = req.params.citaId;
      if (!citaId) {
        res.status(400).json({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'citaId es requerido en la URL.' },
        });
        return;
      }

      const parsed = scheduleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Uno o más campos son inválidos.',
            details: zodToDetails(parsed.error),
          },
        });
        return;
      }

      const result = await trepsiService.reschedule(citaId, parsed.data);

      if (result.ok && result.data) {
        res.status(result.status).json({
          ok: true,
          citaId: result.data.citaId,
          fechaAtencion: result.data.fechaAtencion,
          estado: result.data.estado,
        });
        return;
      }
      respond(res, result);
    } catch (err) {
      next(err);
    }
  };

  patchHistoria = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const citaId = req.params.citaId;
      if (!citaId) {
        res.status(400).json({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'citaId es requerido en la URL.' },
        });
        return;
      }

      const parsed = patchHistoriaSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Uno o más campos son inválidos.',
            details: zodToDetails(parsed.error),
          },
        });
        return;
      }

      // consentimientoInformado no puede modificarse vía PATCH — se ignora si llega.
      const { consentimientoInformado: _ignored, ...patch } = parsed.data as Record<string, unknown>;
      void _ignored;

      const result = await trepsiService.updateHistoria(citaId, patch);

      if (result.ok && result.data) {
        res.status(result.status).json({
          ok: true,
          citaId: result.data.citaId,
          historiaClinicaId: result.data.historiaClinicaId,
          estado: result.data.estado,
          updatedAt: result.data.updatedAt,
        });
        return;
      }
      respond(res, result);
    } catch (err) {
      next(err);
    }
  };

  cancel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const citaId = req.params.citaId;
      if (!citaId) {
        res.status(400).json({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'citaId es requerido en la URL.' },
        });
        return;
      }
      const result = await trepsiService.cancel(citaId);
      if (result.ok && result.data) {
        res.status(result.status).json({
          ok: true,
          citaId: result.data.citaId,
          status: 'cancelled',
        });
        return;
      }
      respond(res, result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /medicos — devuelve profesionales activos (médicos + coaches) de TODAS
   * las sedes para que Trepsi pueda asignarlos en POST /appointments y mostrar
   * disponibilidad al paciente.
   *
   * Filtro opcional por query param `?rol=medico|coach`. Si no se envía,
   * devuelve ambos roles.
   *
   * No expone firma ni campos internos sensibles.
   */
  listMedicos = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rolRaw = req.query.rol;
      let rol: 'medico' | 'coach' | undefined;
      if (rolRaw === 'medico' || rolRaw === 'coach') rol = rolRaw;

      const result = await profesionalesService.list({
        // sedeId=null → sin filtro por sede.
        sedeId: null,
        rol,
        activo: true,
      });
      if (!result.ok || !result.data) {
        res.status(result.status).json({ ok: false, error: result.error });
        return;
      }
      const medicos = result.data.map((m) => ({
        codigo: m.codigo,
        nombre:
          m.alias ||
          [m.primerNombre, m.segundoNombre, m.primerApellido, m.segundoApellido]
            .filter(Boolean)
            .join(' '),
        rol: m.rol,
        especialidad: m.especialidad,
        tiempoConsultaMinutos: m.tiempoConsulta,
      }));
      res.status(200).json({ ok: true, medicos });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /horarios-disponibles?fecha=YYYY-MM-DD&medico=COD&modalidad=virtual
   *
   * Devuelve los slots libres del profesional para esa fecha, cruzando su
   * disponibilidad teórica (panel coordinador) con las citas ya agendadas.
   *
   * Trepsi usa este endpoint para mostrar al paciente qué horas tiene disponibles
   * el médico o coach al agendar.
   */
  listHorariosDisponibles = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const fecha = typeof req.query.fecha === 'string' ? req.query.fecha : '';
      const medicoCodigo = typeof req.query.medico === 'string' ? req.query.medico : '';
      const modalidadRaw = req.query.modalidad;
      const modalidad =
        modalidadRaw === 'presencial' ? 'presencial' : 'virtual';

      if (!fecha || !medicoCodigo) {
        res.status(400).json({
          ok: false,
          error: {
            code: 'INVALID_PARAMS',
            message: 'Parámetros requeridos: fecha (YYYY-MM-DD), medico (código del profesional).',
          },
        });
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        res.status(400).json({
          ok: false,
          error: { code: 'INVALID_DATE', message: 'fecha debe ser YYYY-MM-DD.' },
        });
        return;
      }

      // Resolver profesional por código (sin filtrar sede). Devuelve id + sede.
      const profResult = await profesionalesService.list({
        sedeId: null,
        activo: true,
      });
      if (!profResult.ok || !profResult.data) {
        res.status(profResult.status).json({ ok: false, error: profResult.error });
        return;
      }
      const prof = profResult.data.find((p) => p.codigo === medicoCodigo);
      if (!prof) {
        res.status(404).json({
          ok: false,
          error: {
            code: 'MEDICO_NOT_FOUND',
            message: `No se encontró profesional activo con código '${medicoCodigo}'.`,
          },
        });
        return;
      }

      const horariosResult = await calendarioService.getHorariosDisponibles(
        fecha,
        prof.id,
        prof.sedeId,
        modalidad
      );
      if (!horariosResult.ok || !horariosResult.data) {
        res.status(horariosResult.status).json({ ok: false, error: horariosResult.error });
        return;
      }

      // Devolver solo los slots disponibles (más útil para Trepsi que la lista
      // completa con marcados).
      const data = horariosResult.data;
      const slotsLibres = data.horarios.filter((s) => s.disponible).map((s) => s.hora);

      res.status(200).json({
        ok: true,
        fecha: data.fecha,
        medico: {
          codigo: prof.codigo,
          nombre:
            prof.alias ||
            [prof.primerNombre, prof.primerApellido].filter(Boolean).join(' '),
          rol: prof.rol,
        },
        modalidad: data.modalidad,
        tiempoConsultaMinutos: data.tiempoConsulta,
        horariosDisponibles: slotsLibres,
      });
    } catch (err) {
      next(err);
    }
  };

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const citaId = req.params.citaId;
      if (!citaId) {
        res.status(400).json({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'citaId es requerido en la URL.' },
        });
        return;
      }
      const result = await trepsiService.get(citaId);
      if (result.ok && result.data) {
        res.status(result.status).json({
          ok: true,
          citaId: result.data.citaId,
          historiaClinicaId: result.data.historiaClinicaId,
          estado: result.data.estado,
          fechaAtencion: result.data.fechaAtencion,
          duracionMinutos: result.data.duracionMinutos,
          medico: result.data.medicoCodigo ? { codigo: result.data.medicoCodigo } : null,
          createdAt: result.data.createdAt,
          updatedAt: result.data.updatedAt,
        });
        return;
      }
      respond(res, result);
    } catch (err) {
      next(err);
    }
  };
}

export default new TrepsiController();
