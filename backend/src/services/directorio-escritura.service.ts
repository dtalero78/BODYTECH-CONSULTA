// ============================================================================
// directorio-escritura — La ÚNICA vía por la que Consulta agrega gente al
// directorio compartido.
//
// La regla es que toda persona de la plataforma existe primero en el directorio
// (`bodytech_profesionales.profesionales`, con la cédula como llave) y de esa
// fila salen su ficha de agenda y su cuenta. Da igual la puerta por la que
// entre: el Excel de RRHH, este botón o una API — el destino es el mismo.
//
// Por qué es un servicio aparte de `directorio.service`: ese es de SÓLO
// LECTURA a propósito, con su propio pool, y esa garantía se mantiene. Acá se
// escribe, y sólo lo que entra por la mano de un coordinador.
//
// Nunca pisa a quien ya está. Si la persona vino del Excel de RRHH, sus datos
// son de RRHH y mandan: agregarla de nuevo desde acá no le cambia el cargo ni
// el rol. Por eso el upsert no actualiza nada — sólo completa lo que falta.
// ============================================================================

import { getSharedPool } from './shared-db';

/** Vocabulario del directorio. No es el rol de la cuenta: eso es otra cosa. */
export type RolDirectorio =
  | 'medico'
  | 'evaluador'
  | 'fisioterapeuta'
  | 'nutricionista'
  | 'coach'
  | 'administrativo';

export interface PersonaDirectorio {
  documento: string;
  nombre: string;
  rol: RolDirectorio;
  /** El cargo literal. Si no se sabe, se usa el rol. */
  cargo?: string | null;
  /** 'sede' | 'corporativo' | 'virtual'. Consulta atiende en teleconsulta. */
  ambito?: 'sede' | 'corporativo' | 'virtual';
  ciudad?: string | null;
}

export type ResultadoDirectorio =
  | { ok: true; creada: boolean }
  | { ok: false; error: string };

/**
 * Deja a la persona en el directorio. `creada: false` significa que ya estaba
 * —lo normal cuando viene de RRHH— y no es un error: el flujo sigue.
 */
export async function asegurarPersona(p: PersonaDirectorio): Promise<ResultadoDirectorio> {
  const documento = String(p.documento ?? '').replace(/\D/g, '');
  if (!documento) return { ok: false, error: 'DOCUMENTO_REQUERIDO' };
  try {
    const { rows } = await getSharedPool().query(
      `INSERT INTO profesionales (documento, nombre, rol, cargo, ambito, ciudad, fuente, activo)
       VALUES ($1, $2, $3, $4, $5, $6, 'manual', TRUE)
       ON CONFLICT (documento) DO NOTHING
       RETURNING documento`,
      [
        documento,
        p.nombre.trim(),
        p.rol,
        (p.cargo ?? '').trim() || p.rol,
        p.ambito ?? 'virtual',
        p.ciudad ?? null,
      ],
    );
    return { ok: true, creada: rows.length > 0 };
  } catch (e) {
    console.error(
      '❌ [directorio-escritura] no se pudo escribir en el directorio:',
      e instanceof Error ? e.message : e,
    );
    return { ok: false, error: 'DIRECTORIO_NO_DISPONIBLE' };
  }
}

/** ¿Ya está esta cédula en el directorio? Para avisar antes de duplicar a nadie. */
export async function existePersona(documento: string): Promise<boolean | null> {
  const limpio = String(documento ?? '').replace(/\D/g, '');
  if (!limpio) return false;
  try {
    const { rows } = await getSharedPool().query(
      'SELECT 1 FROM profesionales WHERE documento = $1',
      [limpio],
    );
    return rows.length > 0;
  } catch {
    return null;
  }
}
