// ============================================================================
// Router /api/usuarios-global/* — Creación de Usuarios.
//
// El panel único desde el que se crean, editan e inhabilitan los usuarios de
// las tres aplicaciones. El rol que se asigna decide a qué plataforma llega la
// persona al iniciar sesión.
//
// ── Por qué Consulta se crea distinto ──────────────────────────────────────
// Un usuario de Consulta tiene que existir TAMBIÉN en la tabla local: de su id
// cuelgan las vistas guardadas del coordinador, la auditoría y el vínculo con
// su ficha de profesional. Por eso para 'consulta' se llama al servicio de
// siempre —que crea local y refleja en la global— y para ACC y prepagadas se
// escribe directo en la global, que es lo único que esas aplicaciones leen.
//
// ── Quién puede qué ────────────────────────────────────────────────────────
// Admin: todo. Coordinador: sólo Consulta, sólo roles no privilegiados
// (médico, coach, auxiliar), sólo SUS sedes, y nunca la baja organizacional.
// Son los mismos límites que aplicaba el panel anterior de usuarios; se
// trasladan acá porque esta ruta lo reemplaza. Sin ellos, unificar el panel
// habría sido una escalada de privilegios disfrazada de mejora.
// ============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import usuariosGlobalService from '../services/usuarios-global.service';
import { getSession } from '../middleware/rbac.middleware';
import usuariosService from '../services/usuarios.service';
import bajasService from '../services/bajas.service';
import { getSharedPool } from '../services/shared-db';
import postgresService from '../services/postgres.service';
import {
  revisarAlta,
  revisarEdicion,
  visibleEnListado,
  puedeDarDeBaja,
  Actor,
} from '../helpers/usuarios-permisos.helper';

const router = Router();

/** El actor, en los términos que entiende el helper de permisos. */
function actorDe(req: Request): Actor {
  const s = getSession(req);
  return { role: s?.role ?? '', email: s?.email ?? '', sedes: s?.sedes ?? [] };
}

/** Traduce un rechazo del helper a la respuesta HTTP. */
function rechazar(res: Response, r: { code: string; message: string }): void {
  res.status(r.code === 'FORBIDDEN' ? 403 : 400).json({
    success: false,
    error: r.code,
    message: r.message,
  });
}

/** La persona y su acceso a Consulta, para decidir si el actor puede tocarla. */
async function personaBasica(
  id: number,
): Promise<{ email: string; rolConsulta: string | null; sedes: string[] } | null> {
  const { rows } = await getSharedPool().query(
    `SELECT p.email, pa.rol, pa.alcance
       FROM personas p
       LEFT JOIN persona_apps pa ON pa.persona_id = p.id AND pa.app = 'consulta'
      WHERE p.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    email: String(r.email),
    rolConsulta: r.rol ? String(r.rol) : null,
    sedes: (r.alcance?.sedes as string[]) ?? [],
  };
}

/**
 * Roles válidos POR aplicación. No hay un vocabulario único a propósito: un
 * fisioterapeuta no existe como rol en prepagadas, y forzar una lista común
 * sería inventar una realidad que no existe.
 */
const ROLES_POR_APP: Record<string, readonly string[]> = {
  consulta: ['admin', 'coordinador', 'medico', 'coach', 'auxiliar', 'torre'],
  acc: ['admin', 'fisioterapeuta'],
  prepagadas: ['admin', 'asesor', 'profesional'],
};

/**
 * A qué programa pertenece la persona. Mismo vocabulario que el `origen` de las
 * citas a propósito: si la persona es de Trepsi y la cita es de Trepsi, tienen
 * que llamarse igual o nadie va a poder cruzarlos.
 */
const PROGRAMAS = ['trepsi', 'umv', 'corporativo', 'mybodytech', 'nativa'] as const;

const crearSchema = z
  .object({
    email: z.string().email(),
    nombre: z.string().trim().min(2, 'El nombre es muy corto.').max(200),
    // Opcional a propósito: si la persona YA está en el armario (trabaja en
    // otra aplicación) esto no crea una cuenta nueva, le agrega el acceso —y
    // conserva la clave que ya usa. Una persona, una contraseña.
    password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').optional(),
    documento: z.string().trim().regex(/^[0-9]{5,15}$/).nullable().optional(),
    app: z.enum(['consulta', 'acc', 'prepagadas']),
    rol: z.string().min(1),
    sedes: z.array(z.string()).optional(),
    esGlobal: z.boolean().optional(),
    // Sólo aplica a Consulta: un médico o coach SIN profesional vinculado no
    // puede agendar (el sistema responde SIN_PROFESIONAL). Crear uno así es
    // crear una cuenta que parece funcionar y no funciona.
    profesionalId: z.number().int().nullable().optional(),
    celular: z.string().trim().max(30).nullable().optional(),
    programas: z.array(z.enum(PROGRAMAS)).optional(),
  })
  .refine((v) => ROLES_POR_APP[v.app]?.includes(v.rol), {
    message: 'Ese rol no existe en esa aplicación.',
    path: ['rol'],
  });

router.get('/roles', (_req: Request, res: Response) => {
  res.json({ success: true, data: ROLES_POR_APP });
});

/**
 * La ficha de agenda, tal como la necesita la lista de personas. Se lee de la
 * base de Consulta, que es donde vive.
 */
interface FichaLite {
  id: number;
  codigo: string;
  documento: string | null;
  nombre: string;
  rol: string;
  sedeId: string;
  especialidad: string | null;
  activo: boolean;
}

async function fichasDeConsulta(): Promise<FichaLite[]> {
  const filas = await postgresService.query(
    `SELECT id, codigo, documento, rol, sede_id,
            trim(concat_ws(' ', primer_nombre, primer_apellido)) AS nombre,
            especialidad, activo
       FROM profesionales`,
  );
  return (filas ?? []).map((f) => ({
    id: Number(f.id),
    codigo: String(f.codigo),
    documento: f.documento ? String(f.documento) : null,
    nombre: String(f.nombre),
    rol: String(f.rol),
    sedeId: String(f.sede_id),
    especialidad: f.especialidad ? String(f.especialidad) : null,
    activo: Boolean(f.activo),
  }));
}

/**
 * La lista ÚNICA de gente: las cuentas, cada una con su ficha de agenda si la
 * tiene, más las fichas que todavía no tienen cuenta.
 *
 * Esas fichas sueltas son la razón de que la lista no pueda salir sólo de la
 * tabla de cuentas: alguien que quedó con ficha y sin cuenta desaparecería de
 * la pantalla justo cuando hay que notarlo —aparece en la agenda y no puede
 * entrar—. Se muestran como una fila más, sin correo.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [todas, fichas] = await Promise.all([
      usuariosGlobalService.listar(),
      fichasDeConsulta(),
    ]);
    const actor = actorDe(req);

    const porId = new Map(fichas.map((f) => [f.id, f]));
    const porDocumento = new Map(
      fichas.filter((f) => f.documento).map((f) => [f.documento as string, f]),
    );
    const usadas = new Set<number>();

    const personas = todas
      .filter((p) => {
        const c = p.apps.find((a) => a.app === 'consulta');
        return visibleEnListado(actor, {
          email: p.email,
          rolConsulta: c?.rol ?? null,
          sedes: ((c?.alcance as { sedes?: string[] })?.sedes ?? []) as string[],
        });
      })
      .map((p) => {
        const c = p.apps.find((a) => a.app === 'consulta');
        const idFicha = (c?.alcance as { profesionalId?: number | null })?.profesionalId ?? null;
        // Por id de la ficha (el vínculo explícito) y, si no, por cédula: es la
        // llave con la que se cruza todo lo demás.
        const ficha =
          (idFicha ? porId.get(idFicha) : undefined) ??
          (p.documento ? porDocumento.get(p.documento) : undefined) ??
          null;
        if (ficha) usadas.add(ficha.id);
        return { ...p, ficha };
      });

    // Las fichas sin cuenta, como filas propias. Sólo las ve quien puede verlo
    // todo: acotarlas por sede exigiría un alcance que no tienen.
    const sueltas =
      actor.role === 'admin'
        ? fichas
            .filter((f) => !usadas.has(f.id))
            .map((f) => ({
              id: -f.id, // negativo: no es una persona de la tabla de cuentas
              email: '',
              nombre: f.nombre,
              documento: f.documento,
              activo: f.activo,
              apps: [],
              baja: null,
              ficha: f,
            }))
        : [];

    res.json({ success: true, data: [...personas, ...sueltas] });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const parsed = crearSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: 'VALIDACION',
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos.',
    });
    return;
  }
  const d = parsed.data;
  const fallo = revisarAlta(actorDe(req), d);
  if (fallo) return rechazar(res, fallo);

  try {
    const yaExiste = await usuariosGlobalService.hashDe(d.email);
    if (!yaExiste && !d.password) {
      res.status(400).json({
        success: false,
        error: 'VALIDACION',
        message: 'Una persona nueva necesita una contraseña.',
      });
      return;
    }

    if (d.app === 'consulta') {
      // Camino local + reflejo: ver la cabecera. Si ya existe se REUSA su hash:
      // crear la fila local con uno nuevo se lo reflejaría encima y le
      // cambiaría la contraseña de las otras aplicaciones sin avisar.
      const r = await usuariosService.create({
        email: d.email,
        passwordHash: yaExiste?.passwordHash ?? bcrypt.hashSync(d.password as string, 10),
        nombre: d.nombre,
        rol: d.rol as never,
        esGlobal: d.esGlobal ?? false,
        sedes: d.sedes ?? [],
        profesionalId: d.profesionalId ?? null,
        celular: d.celular ?? null,
        programas: d.programas ?? [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      if (!r.ok) {
        res.status(r.error === 'EMAIL_TAKEN' ? 409 : 500).json({
          success: false,
          error: r.error,
          message: r.error === 'EMAIL_TAKEN' ? 'Ya existe un usuario con ese correo.' : 'No se pudo crear.',
        });
        return;
      }
      res.status(201).json({ success: true, id: r.id });
      return;
    }

    const r = await usuariosGlobalService.crear({
      email: d.email,
      // `crear` sólo usa la contraseña cuando inserta a alguien nuevo; a quien
      // ya existe le agrega el acceso sin tocarle el hash.
      password: d.password ?? '',
      nombre: d.nombre,
      documento: d.documento ?? null,
      app: d.app,
      rol: d.rol,
      alcance: d.sedes && d.sedes.length > 0 ? { sedes: d.sedes } : {},
    });
    if (!r.ok) {
      res.status(500).json({ success: false, error: r.error, message: 'No se pudo crear.' });
      return;
    }
    res.status(201).json({ success: true, id: r.id });
  } catch (e) {
    next(e);
  }
});

const editarSchema = z.object({
  nombre: z.string().trim().min(2).max(200).optional(),
  documento: z.string().trim().regex(/^[0-9]{5,15}$/).nullable().optional(),
  activo: z.boolean().optional(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').optional(),
  app: z.enum(['consulta', 'acc', 'prepagadas']).optional(),
  rol: z.string().optional(),
  accesoActivo: z.boolean().optional(),
  // Sólo para Consulta. Se escriben en su tabla local, que es de donde cuelgan
  // las sedes y la ficha del profesional, y de ahí se reflejan en la global.
  sedes: z.array(z.string()).optional(),
  esGlobal: z.boolean().optional(),
  profesionalId: z.number().int().nullable().optional(),
  celular: z.string().trim().max(30).nullable().optional(),
  programas: z.array(z.enum(PROGRAMAS)).optional(),
});

/** El id LOCAL del usuario de Consulta, guardado en su alcance al migrar. */
async function idLocalDeConsulta(personaId: number): Promise<number | null> {
  const { rows } = await getSharedPool().query(
    `SELECT (alcance->>'usuarioIdLocal')::int AS id
       FROM persona_apps WHERE persona_id = $1 AND app = 'consulta'`,
    [personaId],
  );
  const id = rows[0]?.id;
  return id ? Number(id) : null;
}

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  const id = Number(req.params.id);
  const parsed = editarSchema.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({
      success: false,
      error: 'VALIDACION',
      message: parsed.success ? 'Id inválido.' : parsed.error.issues[0]?.message,
    });
    return;
  }
  const d = parsed.data;
  if (d.app && d.rol && !ROLES_POR_APP[d.app]?.includes(d.rol)) {
    res.status(400).json({ success: false, error: 'VALIDACION', message: 'Ese rol no existe en esa aplicación.' });
    return;
  }
  try {
    const destino = await personaBasica(id);
    if (!destino) {
      res.status(404).json({ success: false, error: 'NO_ENCONTRADA' });
      return;
    }
    const fallo = revisarEdicion(actorDe(req), destino, d);
    if (fallo) return rechazar(res, fallo);
    // Lo propio de Consulta (sedes, profesional, esGlobal) se escribe en SU
    // tabla, que es de donde cuelgan, y se refleja solo en la global.
    const tocaConsulta =
      d.sedes !== undefined ||
      d.esGlobal !== undefined ||
      d.profesionalId !== undefined ||
      d.celular !== undefined ||
      d.programas !== undefined;
    if (tocaConsulta) {
      const idLocal = await idLocalDeConsulta(id);
      if (!idLocal) {
        res.status(400).json({
          success: false,
          error: 'SIN_CUENTA_CONSULTA',
          message: 'Esa persona no tiene cuenta en Consulta; esos campos no aplican.',
        });
        return;
      }
      // Las sedes van como TERCER argumento, no dentro del objeto: adentro se
      // ignorarían en silencio y el usuario quedaría sin ninguna.
      await usuariosService.update(
        idLocal,
        {
          nombre: d.nombre,
          rol: d.app === 'consulta' ? (d.rol as never) : undefined,
          activo: d.activo,
          esGlobal: d.esGlobal,
          profesionalId: d.profesionalId,
          celular: d.celular,
          programas: d.programas,
        },
        d.sedes,
      );
    }
    // La contraseña de alguien de Consulta se escribe por la tabla local, que
    // la refleja: escribirla sólo en la global dejaría la copia local con la
    // clave vieja, y el camino de respaldo (global caída) pediría la anterior.
    // Se escribe UNA vez —bcrypt de la misma clave da hashes distintos, y dos
    // escrituras dejarían local y global divergentes sin razón.
    let cambios = d;
    if (d.password) {
      const idLocal = await idLocalDeConsulta(id);
      if (idLocal) {
        await usuariosService.setPassword(idLocal, bcrypt.hashSync(d.password, 10));
        cambios = { ...d, password: undefined };
      }
    }
    await usuariosGlobalService.editar(id, cambios);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

/** Da de baja de la organización, o la revierte. Sale de TODAS las aplicaciones. */
router.post('/:id/baja', async (req: Request, res: Response, next: NextFunction) => {
  const id = Number(req.params.id);
  const dar = req.body?.dar !== false;
  if (!puedeDarDeBaja(actorDe(req))) {
    return rechazar(res, {
      code: 'FORBIDDEN',
      message: 'Sólo un administrador da de baja de la organización.',
    });
  }
  try {
    const { rows } = await getSharedPool().query('SELECT email FROM personas WHERE id = $1', [id]);
    const email = rows[0]?.email;
    if (!email) {
      res.status(404).json({ success: false, error: 'NO_ENCONTRADA' });
      return;
    }
    if (dar) {
      await bajasService.darDeBaja(String(email), req.body?.motivo ?? null, getSession(req)?.email ?? null);
    } else {
      await bajasService.reactivar(String(email));
    }
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

export default router;
