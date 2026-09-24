// ============================================================================
// programas-acceso — a qué programas está limitada la persona que pregunta.
//
// La sesión NO trae los programas (el JWT lleva rol y sedes), así que se leen de
// `usuarios.programas` en cada petición, igual que hace `digitalizar-acceso`:
// sacar a alguien de un programa le quita lo que ve de inmediato, sin esperar a
// que vuelva a entrar. Con una caché corta, porque el panel hace varias
// peticiones seguidas y esto no cambia dos veces por minuto.
//
// **Si la base no responde, no se filtra.** Es lo contrario de Digitalizar, y a
// propósito: allá el programa CONCEDE un permiso extra y fallar cerrado es lo
// correcto; acá lo ÚNICO que hace es recortar lo que ya se podía ver, así que un
// bache de base dejaría a la coordinación con la pantalla vacía sin decir por
// qué. Se vuelve al comportamiento de siempre y se registra.
// ============================================================================

import { Request } from 'express';
import postgresService from './postgres.service';
import { getSession } from '../middleware/rbac.middleware';
import { normalizarProgramas } from '../helpers/programa-scope';

const TTL_MS = 60_000;

/**
 * El filtro nace APAGADO, y no por prudencia genérica: al medirlo contra
 * producción (23-sep-2026) las marcas no están confiables. De las 7 cuentas con
 * programa, la de coordinación de Karen Ariza dice `corporativo` aunque ella
 * coordina la UMV: prenderlo sin corregir eso le escondería su propio trabajo
 * (vería 4 citas del mes en vez de 1.211). Cuando las marcas estén revisadas se
 * pone `PROGRAMAS_FILTRAN=true` y empieza a acotar, sin desplegar nada.
 */
function filtroEncendido(): boolean {
  return String(process.env.PROGRAMAS_FILTRAN ?? '').toLowerCase() === 'true';
}

interface Entrada {
  programas: string[] | undefined;
  expiraEn: number;
}

const cache = new Map<number, Entrada>();

/** Vacía la caché de una persona (o toda). La usa quien edita sus programas. */
export function olvidarProgramas(usuarioId?: number): void {
  if (usuarioId === undefined) cache.clear();
  else cache.delete(usuarioId);
}

/**
 * Los programas a los que está limitada la sesión, o `undefined` cuando no
 * tiene límite (que es el caso de casi todo el mundo).
 */
export async function programasDeSesion(req: Request): Promise<string[] | undefined> {
  if (!filtroEncendido()) return undefined;

  const sesion = getSession(req);
  const usuarioId = sesion?.userId;
  if (!usuarioId) return undefined;

  const ahora = Date.now();
  const cacheado = cache.get(usuarioId);
  if (cacheado && cacheado.expiraEn > ahora) return cacheado.programas;

  let programas: string[] | undefined;
  try {
    const filas = await postgresService.query(
      'SELECT programas FROM usuarios WHERE id = $1 AND activo = TRUE',
      [usuarioId]
    );
    if (!filas) throw new Error('la base no respondió');
    programas = normalizarProgramas(filas[0]?.programas);
  } catch (e) {
    console.error('[programas-acceso] no se pudo leer los programas:', (e as Error)?.message ?? e);
    return undefined; // sin filtro: recortar de menos es mejor que vaciar la pantalla
  }

  cache.set(usuarioId, { programas, expiraEn: ahora + TTL_MS });
  return programas;
}
