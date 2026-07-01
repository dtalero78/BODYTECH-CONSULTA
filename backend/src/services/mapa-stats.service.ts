// ============================================================================
// mapaStatsService — feed en vivo del "Mapa de Rutas" (privado, danieltalero78).
//
// Namespace Socket.io AISLADO (`/mapa-rutas`): no comparte salas ni eventos con
// el postural ni el tracker, así que NO puede interferir con las llamadas.
// - "ahora": consultas activas del sessionTracker (en memoria), clasificadas por
//   sub-sala. Además, POR SUB-SALA, la lista de gente conectada ahora
//   (coach/médico + paciente, con nombre) para pintarlos dentro del local.
// - "hoy": agendadas/atendidas hoy (HistoriaClinica.fechaAtencion/fechaConsulta).
// Cada sala se resuelve UNA vez (zona + nombres) y se cachea → el conteo/gente es
// pura suma en memoria. Push SOLO cuando algo cambia → sin polling.
// Gated: el handshake valida token+email.
// ============================================================================

import { Server as SocketIOServer, Namespace, Socket } from 'socket.io';
import authService from './auth.service';
import postgresService from './postgres.service';
import { sessionTracker } from './session-tracker.service';

const ADMIN_EMAIL = 'danieltalero78@gmail.com';

type ZoneId = 'medica-nativa' | 'nutricion-trepsi' | 'nutricion-nativa';
const ZONES: ZoneId[] = ['medica-nativa', 'nutricion-trepsi', 'nutricion-nativa'];

interface Consulta {
  prof: { role: 'medico' | 'coach'; name: string; online: boolean };
  paciente: { name: string; online: boolean };
  startedAt?: string; // inicio de la consulta (ISO) para el cronómetro
}
interface ZoneStats {
  ahora: number;
  agendadasHoy: number;
  atendidasHoy: number;
  consultas: Consulta[]; // una tarjeta por consulta activa (prof arriba, paciente abajo)
}
type StatsPayload = Record<ZoneId, ZoneStats>;

interface RoomInfo {
  zone: ZoneId;
  rol: 'medico' | 'coach' | null;
  coach: string | null; // nombre del profesional (de profesionales)
}
interface ZoneHoy {
  agendadas: number;
  atendidas: number;
}

function zerosHoy(): Record<ZoneId, ZoneHoy> {
  return {
    'medica-nativa': { agendadas: 0, atendidas: 0 },
    'nutricion-trepsi': { agendadas: 0, atendidas: 0 },
    'nutricion-nativa': { agendadas: 0, atendidas: 0 },
  };
}

class MapaStatsService {
  private ns: Namespace | null = null;
  private roomCache = new Map<string, RoomInfo>(); // roomName -> {zona, nombres}
  private resolving = new Set<string>();
  private hoy: Record<ZoneId, ZoneHoy> = zerosHoy();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private pushDebounce: ReturnType<typeof setTimeout> | null = null;

  initialize(io: SocketIOServer): void {
    const ns = io.of('/mapa-rutas');
    this.ns = ns;

    ns.use((socket, next) => {
      try {
        const raw =
          (socket.handshake.auth && (socket.handshake.auth as Record<string, unknown>).token) ||
          socket.handshake.query?.token;
        const payload = raw ? (authService.verifyToken(String(raw)) as unknown as { email?: string } | null) : null;
        const email = payload?.email ? String(payload.email).toLowerCase() : '';
        if (email === ADMIN_EMAIL) return next();
        return next(new Error('unauthorized'));
      } catch {
        return next(new Error('unauthorized'));
      }
    });

    ns.on('connection', (socket: Socket) => {
      this.ensureHeartbeat();
      this.refreshHoy().finally(() => this.pushTo(socket));
      socket.on('disconnect', () => this.maybeStopHeartbeat());
    });

    sessionTracker.onChange(() => this.schedulePush());
    console.log('[MapaStats] Namespace /mapa-rutas listo (feed privado)');
  }

  private hasClients(): boolean {
    return !!this.ns && this.ns.sockets.size > 0;
  }

  private ensureHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      if (!this.hasClients()) return;
      this.refreshHoy().finally(() => this.pushAll());
    }, 30000);
  }

  private maybeStopHeartbeat(): void {
    if (this.heartbeat && !this.hasClients()) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private schedulePush(): void {
    if (!this.hasClients() || this.pushDebounce) return;
    this.pushDebounce = setTimeout(() => {
      this.pushDebounce = null;
      this.pushAll();
    }, 400);
  }

  private pushAll(): void {
    if (this.ns) this.ns.emit('stats', this.buildPayload());
  }
  private pushTo(socket: Socket): void {
    socket.emit('stats', this.buildPayload());
  }

  private buildPayload(): StatsPayload {
    const out = {} as StatsPayload;
    for (const z of ZONES) {
      out[z] = {
        ahora: 0,
        agendadasHoy: this.hoy[z].agendadas,
        atendidasHoy: this.hoy[z].atendidas,
        consultas: [],
      };
    }
    for (const s of sessionTracker.getActiveSessions()) {
      const info = this.roomCache.get(s.roomName);
      // Resolver si es nueva, o si aún no tenemos el profesional pero ya hay medicoCode.
      if (!info || (info.rol === null && !!s.medicoCode)) {
        void this.resolveRoom(s.roomName, s.medicoCode);
      }
      if (!info) continue;
      // Solo "en consulta ahora" si AMBOS siguen conectados. Si uno se desconecta
      // (o quedó una sesión fantasma por un disconnect perdido), no se muestra.
      if (!(s.doctorConnected && s.patientConnected)) continue;
      const zs = out[info.zone];
      zs.ahora += 1;
      const profName = info.coach || (s.doctorName && s.doctorName.trim()) || 'Profesional';
      const patName =
        (s.patientName && s.patientName.trim()) ||
        (s.patientDocumento ? 'Doc. ' + s.patientDocumento : 'Paciente');
      zs.consultas.push({
        prof: { role: info.rol === 'coach' ? 'coach' : 'medico', name: profName, online: s.doctorConnected },
        paciente: { name: patName, online: s.patientConnected },
        startedAt: s.startedAt,
      });
    }
    return out;
  }

  private async resolveRoom(roomName: string, medicoCode?: string): Promise<void> {
    if (this.resolving.has(roomName)) return;
    this.resolving.add(roomName);
    try {
      // Profesional: rol + nombre (por su código).
      let rol: 'medico' | 'coach' | null = null;
      let coach: string | null = null;
      if (medicoCode) {
        try {
          const r = await postgresService.query(
            `SELECT rol,
                    COALESCE(NULLIF(alias, ''), TRIM(BOTH ' ' FROM COALESCE(primer_nombre, '') || ' ' || COALESCE(primer_apellido, ''))) AS nombre
             FROM profesionales WHERE codigo = $1 LIMIT 1`,
            [medicoCode],
          );
          const v = r?.[0]?.rol;
          rol = v === 'coach' ? 'coach' : v === 'medico' ? 'medico' : null;
          coach = r?.[0]?.nombre || null;
        } catch {
          /* profesional desconocido */
        }
      }

      // Origen: ¿la sala corresponde a una historia creada por Trepsi?
      let isTrepsi = false;
      try {
        const r = await postgresService.query(
          `SELECT EXISTS(
             SELECT 1 FROM trepsi_appointments t
             JOIN room_historia_map m ON m.historia_id = t.historia_id
             WHERE m.room_name = $1
           ) AS is_trepsi`,
          [roomName],
        );
        const v = r?.[0]?.is_trepsi;
        isTrepsi = v === true || v === 't' || v === 'true';
      } catch {
        /* origen desconocido → nativa */
      }

      const zone: ZoneId = isTrepsi
        ? 'nutricion-trepsi'
        : rol === 'coach'
          ? 'nutricion-nativa'
          : 'medica-nativa';
      this.roomCache.set(roomName, { zone, rol, coach });
      this.schedulePush();
    } finally {
      this.resolving.delete(roomName);
    }
  }

  private async refreshHoy(): Promise<void> {
    try {
      const now = new Date();
      const col = new Date(now.getTime() - 5 * 60 * 60 * 1000); // Colombia UTC-5
      const y = col.getUTCFullYear();
      const m = col.getUTCMonth();
      const d = col.getUTCDate();
      const start = new Date(Date.UTC(y, m, d, 5, 0, 0, 0));
      const end = new Date(Date.UTC(y, m, d + 1, 4, 59, 59, 999));

      const rows = await postgresService.query(
        `SELECT
           SUM(CASE WHEN is_trepsi THEN 1 ELSE 0 END) AS nt_agend,
           SUM(CASE WHEN is_trepsi AND atendida THEN 1 ELSE 0 END) AS nt_atend,
           SUM(CASE WHEN NOT is_trepsi AND rol_coach THEN 1 ELSE 0 END) AS nn_agend,
           SUM(CASE WHEN NOT is_trepsi AND rol_coach AND atendida THEN 1 ELSE 0 END) AS nn_atend,
           SUM(CASE WHEN NOT is_trepsi AND NOT rol_coach THEN 1 ELSE 0 END) AS mn_agend,
           SUM(CASE WHEN NOT is_trepsi AND NOT rol_coach AND atendida THEN 1 ELSE 0 END) AS mn_atend
         FROM (
           SELECT
             (h."fechaConsulta" IS NOT NULL) AS atendida,
             EXISTS(SELECT 1 FROM trepsi_appointments t WHERE t.historia_id = h."_id") AS is_trepsi,
             EXISTS(SELECT 1 FROM profesionales p WHERE p.codigo = h."medico" AND p.rol = 'coach') AS rol_coach
           FROM "HistoriaClinica" h
           WHERE h."fechaAtencion" >= $1 AND h."fechaAtencion" <= $2
         ) x`,
        [start, end],
      );
      const r = rows?.[0] || {};
      const n = (v: unknown): number => parseInt(String(v ?? '0'), 10) || 0;
      this.hoy = {
        'medica-nativa': { agendadas: n(r.mn_agend), atendidas: n(r.mn_atend) },
        'nutricion-trepsi': { agendadas: n(r.nt_agend), atendidas: n(r.nt_atend) },
        'nutricion-nativa': { agendadas: n(r.nn_agend), atendidas: n(r.nn_atend) },
      };
    } catch (e) {
      console.error('[MapaStats] Error refrescando "hoy":', e);
    }
  }
}

export const mapaStatsService = new MapaStatsService();
