// ============================================================================
// cuentasApagadas — Quién está apagado en Consulta, para cortarle la sesión.
//
// ── Qué problema resuelve ──────────────────────────────────────────────────
// Apagar a alguien en Creación de Usuarios solo cerraba la puerta del login de
// la tabla global. La sesión que ya tenía abierta seguía sirviendo: el JWT se
// valida con la firma, sin mirar la base, y con «recordarme» dura 30 días. Un
// coach apagado el 22-sep-2026 siguió entrando hasta el 27, editó citas y
// marcó un «No contesta».
//
// ── Por qué una lista en memoria y no una consulta por request ─────────────
// El middleware de sesión corre en CADA request con token. Una consulta a la
// base ahí sería el endpoint más llamado de la plataforma. La lista son unas
// pocas filas; se refresca cada minuto y Creación de Usuarios la actualiza al
// instante al apagar o encender, así que el corte es inmediato en esta
// instancia y tarda a lo sumo un minuto en cualquier otra.
//
// ── Si la base no responde ─────────────────────────────────────────────────
// Se sigue usando la última lista conocida (mismo criterio que `bajas`): quien
// ya estaba apagado sigue afuera, y una caída no saca a nadie nuevo.
//
// Las dos bases se leen con import perezoso: el middleware de sesión importa
// este módulo, y no tiene por qué arrastrar los pools a cada test de rutas.
// ============================================================================

const REFRESCO_MS = 60 * 1000;

function limpiar(email: string | null | undefined): string {
  return String(email ?? '').trim().toLowerCase();
}

class CuentasApagadasService {
  /** Cuentas locales de Consulta con `activo = false`. */
  private locales = new Set<string>();
  /** Personas apagadas en la tabla global, o sin acceso a Consulta. */
  private globales = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  /** Sincrónico a propósito: lo llama el middleware de sesión en cada request. */
  estaApagada(email: string | null | undefined): boolean {
    const e = limpiar(email);
    if (!e) return false;
    return this.locales.has(e) || this.globales.has(e);
  }

  /** Efecto inmediato al apagar, sin esperar al refresco. */
  marcar(email: string | null | undefined): void {
    const e = limpiar(email);
    if (e) this.globales.add(e);
  }

  /** Efecto inmediato al encender. */
  desmarcar(email: string | null | undefined): void {
    const e = limpiar(email);
    this.locales.delete(e);
    this.globales.delete(e);
  }

  /**
   * Para el login, que no puede esperar al refresco: recién desplegado, la
   * lista está vacía el primer minuto. Pregunta por UN correo a la tabla
   * global. Si no responde, contesta con la lista en memoria.
   */
  async apagadaAhora(email: string): Promise<boolean> {
    const e = limpiar(email);
    if (!e) return false;
    try {
      const { getSharedPool } = await import('./shared-db');
      const { rows } = await getSharedPool().query(
        `SELECT 1
           FROM personas p
           LEFT JOIN persona_apps pa ON pa.persona_id = p.id AND pa.app = 'consulta'
          WHERE p.email = $1 AND (p.activo = FALSE OR pa.activo = FALSE)
          LIMIT 1`,
        [e],
      );
      return rows.length > 0;
    } catch {
      return this.estaApagada(e);
    }
  }

  /** Relee las dos listas. Cada una se reemplaza solo si su consulta funcionó. */
  async refrescar(): Promise<void> {
    try {
      const { default: postgresService } = await import('./postgres.service');
      const filas = await postgresService.query(
        `SELECT lower(email) AS email FROM usuarios WHERE activo = FALSE`,
      );
      if (filas) this.locales = new Set(filas.map((f) => String(f.email)));
    } catch (e) {
      console.error('⚠️ [cuentas-apagadas] no se pudo leer la tabla local:', e instanceof Error ? e.message : e);
    }
    try {
      const { getSharedPool } = await import('./shared-db');
      const { rows } = await getSharedPool().query(
        `SELECT lower(p.email) AS email
           FROM personas p
           LEFT JOIN persona_apps pa ON pa.persona_id = p.id AND pa.app = 'consulta'
          WHERE p.activo = FALSE OR pa.activo = FALSE`,
      );
      this.globales = new Set(rows.map((r) => String(r.email)));
    } catch (e) {
      console.error('⚠️ [cuentas-apagadas] no se pudo leer la tabla global:', e instanceof Error ? e.message : e);
    }
  }

  /** Arranca el refresco periódico. Idempotente. */
  iniciar(): void {
    if (this.timer) return;
    void this.refrescar();
    this.timer = setInterval(() => void this.refrescar(), REFRESCO_MS);
    this.timer.unref?.();
  }
}

export default new CuentasApagadasService();
