// ============================================================================
// bajasService — Baja organizacional: una sola vez, sale de todas las apps.
//
// Fase 2 de unificar el login, con una forma distinta a la que decía el plan
// original —y mejor.
//
// ── Qué problema resuelve ──────────────────────────────────────────────────
// Hay tres listas de usuarios y quien trabaja en dos programas tiene dos
// cuentas. Darlo de baja hay que hacerlo dos veces, y ya se falló: una
// administradora quedó ACTIVA en ACC e INACTIVA en prepagadas.
//
// ── Por qué así y no moviendo las contraseñas ──────────────────────────────
// El plan decía «la lista compartida pasa a mandar»: copiar todo al armario y
// que cada app autentique contra él. Eso exige mover credenciales, cambiar el
// alta, el cambio de clave y el restablecimiento en tres repositorios — y deja
// dos fuentes de verdad que pueden divergir (una clave cambiada localmente
// vuelve obsoleto el hash compartido, y ahí no hay salida buena: o se deja
// entrar a quien no debe, o se deja afuera a quien sí).
//
// Esta versión consigue lo que de verdad se buscaba —una baja que valga en
// todas partes— sin mover una sola contraseña. Cada aplicación sigue
// autenticando como siempre; sólo pregunta antes si la persona sigue en la
// organización.
//
// ── La decisión difícil: qué hacer si el armario no responde ───────────────
// Fallar cerrado (nadie entra) convierte la caída de una base secundaria en
// una caída total del login. Fallar abierto (todos entran) deja entrar a
// alguien recién dado de baja.
//
// Ninguna de las dos. La lista se mantiene EN MEMORIA y se refresca cada pocos
// minutos: si el armario deja de responder, se sigue usando la última lista
// conocida. Quien ya estaba de baja sigue afuera; una caída no bloquea a nadie
// nuevo. Sólo el arranque en frío con el armario caído queda sin lista, y ahí
// se elige no bloquear: el sistema no puede negarle el trabajo a todo el mundo
// porque una base secundaria esté lenta.
// ============================================================================

import { getSharedPool } from './shared-db';

export interface BajaOrganizacional {
  email: string;
  motivo: string | null;
  dadaDeBajaPor: string | null;
  dadaDeBajaEn: string;
}

/** Cada cuánto se refresca la lista en memoria. */
const REFRESCO_MS = 5 * 60 * 1000;

class BajasService {
  private cache = new Set<string>();
  private cacheAt = 0;
  private cargando: Promise<void> | null = null;

  async asegurarEsquema(): Promise<void> {
    await getSharedPool().query(`
      CREATE TABLE IF NOT EXISTS bajas_organizacion (
        email             VARCHAR(200) PRIMARY KEY,
        motivo            TEXT,
        dada_de_baja_por  VARCHAR(120),
        dada_de_baja_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  /**
   * `true` si la persona está dada de baja de la organización.
   *
   * Nunca lanza: un fallo del armario devuelve el estado conocido, no un error
   * que tumbe el login.
   */
  async estaDeBaja(email: string): Promise<boolean> {
    const limpio = String(email ?? '').trim().toLowerCase();
    if (!limpio) return false;
    await this.refrescarSiHaceFalta();
    return this.cache.has(limpio);
  }

  private async refrescarSiHaceFalta(): Promise<void> {
    if (Date.now() - this.cacheAt < REFRESCO_MS) return;
    // Una sola recarga aunque lleguen varios logins a la vez.
    if (this.cargando) return this.cargando;
    this.cargando = (async () => {
      try {
        await this.asegurarEsquema();
        const { rows } = await getSharedPool().query('SELECT email FROM bajas_organizacion');
        this.cache = new Set(rows.map((r) => String(r.email).trim().toLowerCase()));
        this.cacheAt = Date.now();
      } catch (e) {
        // Se conserva la lista anterior a propósito: ver la cabecera.
        console.error('⚠️ [bajas] no se pudo refrescar; se usa la última conocida:', e instanceof Error ? e.message : e);
        // Se marca igual para no reintentar en cada login mientras esté caída.
        this.cacheAt = Date.now();
      } finally {
        this.cargando = null;
      }
    })();
    return this.cargando;
  }

  async listar(): Promise<BajaOrganizacional[]> {
    await this.asegurarEsquema();
    const { rows } = await getSharedPool().query(
      `SELECT email, motivo, dada_de_baja_por, dada_de_baja_en
         FROM bajas_organizacion ORDER BY dada_de_baja_en DESC`,
    );
    return rows.map((r) => ({
      email: String(r.email),
      motivo: r.motivo ? String(r.motivo) : null,
      dadaDeBajaPor: r.dada_de_baja_por ? String(r.dada_de_baja_por) : null,
      dadaDeBajaEn:
        r.dada_de_baja_en instanceof Date
          ? (r.dada_de_baja_en as Date).toISOString()
          : String(r.dada_de_baja_en),
    }));
  }

  /** Da de baja. Idempotente: repetirla actualiza el motivo, no falla. */
  async darDeBaja(email: string, motivo: string | null, por: string | null): Promise<void> {
    const limpio = String(email ?? '').trim().toLowerCase();
    if (!limpio) throw new Error('Falta el correo.');
    await this.asegurarEsquema();
    await getSharedPool().query(
      `INSERT INTO bajas_organizacion (email, motivo, dada_de_baja_por)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET motivo = EXCLUDED.motivo, dada_de_baja_por = EXCLUDED.dada_de_baja_por,
             dada_de_baja_en = NOW()`,
      [limpio, motivo, por],
    );
    // Efecto inmediato: no se espera al refresco.
    this.cache.add(limpio);
  }

  /** Reingreso. También inmediato. */
  async reactivar(email: string): Promise<void> {
    const limpio = String(email ?? '').trim().toLowerCase();
    await this.asegurarEsquema();
    await getSharedPool().query('DELETE FROM bajas_organizacion WHERE email = $1', [limpio]);
    this.cache.delete(limpio);
  }
}

export default new BajasService();
