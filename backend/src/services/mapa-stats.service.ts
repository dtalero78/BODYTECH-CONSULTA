// ============================================================================
// mapaStatsService — feed en vivo del "Mapa de Rutas" (privado, danieltalero78).
//
// Namespace Socket.io AISLADO (`/mapa-rutas`): no comparte salas ni eventos con
// el postural ni el tracker, así que NO puede interferir con las llamadas.
// - "ahora": consultas activas del sessionTracker (en memoria), clasificadas por
//   local con `zonaDe` (mapa-zonas.helper). Además, POR LOCAL, la lista de
//   gente conectada ahora (coach/médico + paciente, con nombre) para pintarlos
//   dentro del local.
// - "hoy": agendadas/atendidas hoy (HistoriaClinica.fechaAtencion/fechaConsulta).
// Cada sala se resuelve UNA vez (zona + nombres) y se cachea → el conteo/gente es
// pura suma en memoria. Push SOLO cuando algo cambia → sin polling.
// Gated: el handshake valida token+email.
// ============================================================================

import { Server as SocketIOServer, Namespace, Socket } from 'socket.io';
import authService from './auth.service';
import postgresService from './postgres.service';
import { sessionTracker } from './session-tracker.service';
import { ZONAS_EN_VIVO, ZonaEnVivo, zonaDe } from '../helpers/mapa-zonas.helper';

// Emails autorizados a ver el Mapa de Rutas en vivo (privado).
const MAPA_ALLOWED = new Set<string>([
  'danieltalero78@gmail.com',
  'nikolay.correal@bodytechcorp.com',
]);

// Solo los locales con datos en esta base; Nutrición presencial y ACC no viajan.
type ZoneId = ZonaEnVivo;
const ZONES = ZONAS_EN_VIVO;

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
  const out = {} as Record<ZoneId, ZoneHoy>;
  for (const z of ZONES) out[z] = { agendadas: 0, atendidas: 0 };
  return out;
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
        if (MAPA_ALLOWED.has(email)) return next();
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
      // Profesional: rol + nombre + especialidad (por su código).
      let rol: 'medico' | 'coach' | null = null;
      let coach: string | null = null;
      let especialidad: string | null = null;
      if (medicoCode) {
        try {
          const r = await postgresService.query(
            `SELECT rol, especialidad,
                    COALESCE(NULLIF(alias, ''), TRIM(BOTH ' ' FROM COALESCE(primer_nombre, '') || ' ' || COALESCE(primer_apellido, ''))) AS nombre
             FROM profesionales WHERE codigo = $1 LIMIT 1`,
            [medicoCode],
          );
          const v = r?.[0]?.rol;
          rol = v === 'coach' ? 'coach' : v === 'medico' ? 'medico' : null;
          coach = r?.[0]?.nombre || null;
          especialidad = r?.[0]?.especialidad || null;
        } catch {
          /* profesional desconocido */
        }
      }

      // Origen de la historia de la sala, y si la creó Trepsi.
      let esTrepsi = false;
      let origen: string | null = null;
      try {
        const r = await postgresService.query(
          `SELECT h."origen",
                  EXISTS(SELECT 1 FROM trepsi_appointments t WHERE t.historia_id = m.historia_id) AS es_trepsi
             FROM room_historia_map m
             LEFT JOIN "HistoriaClinica" h ON h."_id" = m.historia_id
            WHERE m.room_name = $1
            LIMIT 1`,
          [roomName],
        );
        const v = r?.[0]?.es_trepsi;
        esTrepsi = v === true || v === 't' || v === 'true';
        origen = r?.[0]?.origen ?? null;
      } catch {
        /* origen desconocido → lo decide quién atiende */
      }

      const zone = zonaDe({ esTrepsi, origen, rol, especialidad });
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

      // Agrupado por lo que decide el local; la regla la aplica `zonaDe`, la
      // misma que clasifica las salas en vivo.
      const rows = await postgresService.query(
        `SELECT
           EXISTS(SELECT 1 FROM trepsi_appointments t WHERE t.historia_id = h."_id") AS es_trepsi,
           h."origen" AS origen,
           p.rol,
           p.especialidad,
           COUNT(*) AS agendadas,
           COUNT(h."fechaConsulta") AS atendidas
         FROM "HistoriaClinica" h
         LEFT JOIN LATERAL (
           SELECT rol, especialidad FROM profesionales
            WHERE codigo = h."medico"
            ORDER BY activo DESC NULLS LAST
            LIMIT 1
         ) p ON TRUE
         WHERE h."fechaAtencion" >= $1 AND h."fechaAtencion" <= $2
         GROUP BY 1, 2, 3, 4`,
        [start, end],
      );
      if (!rows) return; // la base no respondió: se quedan los conteos anteriores
      const n = (v: unknown): number => parseInt(String(v ?? '0'), 10) || 0;
      const hoy = zerosHoy();
      for (const r of rows) {
        const esTrepsi = r.es_trepsi === true || r.es_trepsi === 't' || r.es_trepsi === 'true';
        const z = zonaDe({ esTrepsi, origen: r.origen, rol: r.rol, especialidad: r.especialidad });
        hoy[z].agendadas += n(r.agendadas);
        hoy[z].atendidas += n(r.atendidas);
      }
      this.hoy = hoy;
    } catch (e) {
      console.error('[MapaStats] Error refrescando "hoy":', e);
    }
  }
}

export const mapaStatsService = new MapaStatsService();
