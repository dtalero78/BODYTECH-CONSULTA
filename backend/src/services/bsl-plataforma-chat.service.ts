// ============================================================================
// bsl-plataforma-chat.service — proxy al chat de WhatsApp de bsl-plataforma.
//
// El inbound de WhatsApp del número +5716284820 lo recibe bsl-plataforma (donde
// BODYTECH es un tenant, hostname mediconecta.bodytech.app). Por eso el chat del
// panel médico NO se lee de la BD de bodytech: se consulta la API de la
// plataforma (`/api/irischat/*`) autenticado como el tenant BODYTECH.
//
// Athletic tiene su propio tenant, ATHLETIC, porque bsl-plataforma admite UN
// número de WhatsApp por tenant y Athletic escribe desde el suyo. Mismo servidor,
// sin dominio propio: se le habla con el header X-Tenant-Id. Necesita su PROPIO
// usuario: la plataforma ata el JWT al tenant, y un token de BODYTECH con
// X-Tenant-Id: ATHLETIC responde TENANT_MISMATCH.
//
// Auth: login email+password (JWT 24h) → se cachea, uno por tenant. Config por env:
//   BSL_PLATAFORMA_URL  (default https://mediconecta.bodytech.app)
//   BSL_PLATAFORMA_TENANT (default 'BODYTECH')
//   BSL_PLATAFORMA_USER / BSL_PLATAFORMA_PASS (admin del tenant BODYTECH)
//   ATHLETIC_PLATAFORMA_USER / ATHLETIC_PLATAFORMA_PASS (usuario del tenant ATHLETIC)
// ============================================================================

import axios, { AxiosInstance } from 'axios';
import { Marca, athleticActivo } from '../helpers/marca.helper';

const BASE = (process.env.BSL_PLATAFORMA_URL || 'https://mediconecta.bodytech.app').replace(/\/+$/, '');

export interface WaMensaje {
  id: number;
  direccion: 'entrante' | 'saliente';
  contenido: string;
  tipoMensaje: string;
  mediaUrl: string | null;
  createdAt: string;
}

/** Un mensaje del hilo, con la marca (el número) por la que pasó. */
export interface WaMensajeMarca extends WaMensaje {
  marca: Marca;
}

export interface HiloMarca {
  marca: Marca;
  mensajes: WaMensaje[];
}

function soloDigitos(s: string): string {
  return (s || '').replace(/\D/g, '');
}

function mapMsg(m: any): WaMensaje {
  return {
    id: Number(m?.id ?? 0) || 0,
    direccion: m?.direccion === 'saliente' ? 'saliente' : 'entrante',
    contenido: m?.contenido ?? '',
    tipoMensaje: m?.tipo_mensaje ?? m?.tipoMensaje ?? 'text',
    mediaUrl: m?.media_url ?? m?.mediaUrl ?? null,
    createdAt: m?.timestamp ?? m?.created_at ?? m?.createdAt ?? new Date().toISOString(),
  };
}

interface ConfigTenant {
  tenant: string;
  user: string;
  pass: string;
}

class BslPlataformaChatService {
  private client: AxiosInstance;
  private token: string | null = null;
  private tokenExp = 0;

  constructor(private readonly cfg: ConfigTenant) {
    // Se manda X-Tenant-Id siempre: la plataforma lo prefiere sobre el dominio,
    // y es la única forma de llegar a ATHLETIC, que no tiene dominio propio.
    this.client = axios.create({
      baseURL: BASE,
      timeout: 15000,
      headers: { 'X-Tenant-Id': cfg.tenant },
    });
  }

  get configurado(): boolean {
    return !!this.cfg.user && !!this.cfg.pass;
  }

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExp) return this.token;
    if (!this.configurado) {
      throw new Error(`Usuario de bsl-plataforma no configurado para el tenant ${this.cfg.tenant}`);
    }
    const res = await this.client.post('/api/auth/login', { email: this.cfg.user, password: this.cfg.pass });
    const token = res.data?.token;
    if (!token) throw new Error(`Login a bsl-plataforma (${this.cfg.tenant}) no devolvió token`);
    this.token = token;
    this.tokenExp = Date.now() + 20 * 60 * 60 * 1000; // 20h (el JWT dura 24h)
    return token;
  }

  /** Ejecuta un request autenticado; reintenta una vez si el token expiró (401). */
  private async authed<T>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
    const token = await this.ensureToken();
    const headers = { Authorization: `Bearer ${token}`, 'X-Tenant-Id': this.cfg.tenant };
    try {
      return await fn(headers);
    } catch (e: any) {
      if (e?.response?.status === 401) {
        this.token = null;
        const t2 = await this.ensureToken();
        return fn({ Authorization: `Bearer ${t2}`, 'X-Tenant-Id': this.cfg.tenant });
      }
      throw e;
    }
  }

  /** Resuelve la conversación (id + celular canónico) por número. null si no existe. */
  private async findConversacion(celular: string): Promise<{ id: number; celular: string } | null> {
    const target = soloDigitos(celular);
    const tail = target.slice(-10); // últimos 10 dígitos (ignora +57 / formatos)
    return this.authed(async (headers) => {
      const res = await this.client.get('/api/irischat/conversaciones', {
        headers,
        params: { search: tail },
      });
      const items: any[] = Array.isArray(res.data?.conversaciones) ? res.data.conversaciones : [];
      const match = items.find((c) => soloDigitos(c.celular).endsWith(tail));
      return match ? { id: Number(match.id), celular: String(match.celular) } : null;
    });
  }

  /**
   * Envía una plantilla (por SID) A TRAVÉS de la plataforma, para que quede en
   * el hilo del chat. Devuelve true si la plataforma la envió/guardó. Se usa
   * para las notificaciones de cita/reprogramación: sale por el número del
   * tenant de esta instancia (+5716284820 en BODYTECH, +15055871860 en ATHLETIC).
   * false → el caller cae al envío directo por Twilio (el paciente igual recibe,
   * aunque no quede en chat).
   */
  async enviarPlantilla(
    celular: string,
    templateSid: string,
    variables: Record<string, string>
  ): Promise<boolean> {
    if (!this.configurado || !celular || !templateSid) return false;
    try {
      return await this.authed(async (headers) => {
        const res = await this.client.post(
          '/api/irischat/enviar-plantilla',
          { celular, templateSid, variables },
          { headers }
        );
        return res.data?.success === true;
      });
    } catch (e: any) {
      console.error(`[bsl-plataforma ${this.cfg.tenant}] enviarPlantilla error:`, e?.message ?? e);
      return false;
    }
  }

  /** Hilo de mensajes por celular (vacío si no hay conversación). */
  async getMensajes(celular: string): Promise<{ celular: string; mensajes: WaMensaje[] }> {
    const conv = await this.findConversacion(celular);
    if (!conv) return { celular, mensajes: [] };
    return this.authed(async (headers) => {
      const res = await this.client.get(`/api/irischat/conversaciones/${conv.id}/mensajes`, {
        headers,
        params: { limit: 200 },
      });
      const raw: any[] = Array.isArray(res.data?.mensajes) ? res.data.mensajes : [];
      const mensajes = raw.filter((m) => m && m.id != null).map(mapMsg);
      return { celular: conv.celular, mensajes };
    });
  }

  /**
   * Responde al paciente vía bsl-plataforma (queda en el hilo del tenant).
   * Devuelve el mensaje guardado, o null si no hay conversación previa (sin
   * ventana de 24h no hay a quién responder por texto libre).
   */
  async sendReply(celular: string, texto: string): Promise<WaMensaje | null> {
    const conv = await this.findConversacion(celular);
    if (!conv) return null;
    return this.authed(async (headers) => {
      const res = await this.client.post(
        `/api/irischat/conversaciones/${conv.id}/mensajes`,
        { contenido: texto },
        { headers }
      );
      const m = res.data?.mensaje ?? res.data;
      return mapMsg({ ...m, direccion: 'saliente', contenido: m?.contenido ?? texto });
    });
  }
}

export const bslPlataformaChatService = new BslPlataformaChatService({
  tenant: process.env.BSL_PLATAFORMA_TENANT || 'BODYTECH',
  user: process.env.BSL_PLATAFORMA_USER || '',
  pass: process.env.BSL_PLATAFORMA_PASS || '',
});

export const athleticPlataformaChatService = new BslPlataformaChatService({
  tenant: 'ATHLETIC',
  user: process.env.ATHLETIC_PLATAFORMA_USER || '',
  pass: process.env.ATHLETIC_PLATAFORMA_PASS || '',
});

/** El tenant de la plataforma por el que se le escribe a un paciente de esta marca. */
export function plataformaDe(marca: Marca): BslPlataformaChatService {
  return marca === 'athletic' ? athleticPlataformaChatService : bslPlataformaChatService;
}

// ---------------------------------------------------------------------------
// El chat del panel con las dos marcas
//
// El chat se abre con el celular, sin la historia, y así está bien: la
// conversación vive en el número al que el paciente ESCRIBIÓ, que no tiene por
// qué ser el de su marca (un paciente de Athletic puede haberle escrito al
// número de Bodytech). Por eso se leen los dos hilos y se responde por donde
// está la ventana de 24 h abierta, no por la marca del paciente.
// ---------------------------------------------------------------------------

function msDe(fecha: string): number {
  const t = Date.parse(fecha);
  return Number.isNaN(t) ? 0 : t;
}

/** PURA: los hilos de las dos marcas en un solo orden cronológico. */
export function unirHilos(hilos: HiloMarca[]): WaMensajeMarca[] {
  return hilos
    .flatMap((h) => h.mensajes.map((m) => ({ ...m, marca: h.marca })))
    .sort((a, b) => msDe(a.createdAt) - msDe(b.createdAt));
}

/**
 * PURA: la marca por la que se responde = la del número al que el paciente
 * escribió por ÚLTIMA vez. Ahí está abierta la ventana de 24 h; responder por el
 * otro número sería texto libre fuera de ventana (error 63016). null si el
 * paciente nunca escribió.
 */
export function marcaParaResponder(hilos: HiloMarca[]): Marca | null {
  let mejor: { marca: Marca; ms: number } | null = null;
  for (const h of hilos) {
    for (const m of h.mensajes) {
      if (m.direccion !== 'entrante') continue;
      const ms = msDe(m.createdAt);
      if (!mejor || ms > mejor.ms) mejor = { marca: h.marca, ms };
    }
  }
  return mejor ? mejor.marca : null;
}

/** Los dos hilos del paciente. Si uno de los tenants falla, se muestra el otro. */
async function hilosDelPaciente(celular: string): Promise<{ celular: string; hilos: HiloMarca[] }> {
  const marcas: Marca[] = athleticActivo() ? ['bodytech', 'athletic'] : ['bodytech'];
  const resultados = await Promise.allSettled(marcas.map((m) => plataformaDe(m).getMensajes(celular)));

  const hilos: HiloMarca[] = [];
  // Celular canónico: el de una conversación con mensajes, Bodytech primero; si
  // ninguna tiene, el de la primera respuesta — que con Athletic apagado es
  // exactamente lo que devolvía getMensajes antes.
  let conMensajes: string | null = null;
  let primero: string | null = null;
  let primerError: unknown = null;
  resultados.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      hilos.push({ marca: marcas[i], mensajes: r.value.mensajes });
      primero = primero ?? r.value.celular;
      if (!conMensajes && r.value.mensajes.length > 0) conMensajes = r.value.celular;
    } else {
      console.error(`[WA-Chat] No se pudo leer el hilo de ${marcas[i]}:`, (r.reason as any)?.message ?? r.reason);
      primerError = primerError ?? r.reason;
    }
  });
  if (hilos.length === 0) throw primerError;
  return { celular: conMensajes ?? primero ?? celular, hilos };
}

/** Hilo del paciente para el chat del panel: los mensajes de las dos marcas, en orden. */
export async function mensajesDelPaciente(celular: string): Promise<{ celular: string; mensajes: WaMensajeMarca[] }> {
  const { celular: canonico, hilos } = await hilosDelPaciente(celular);
  return { celular: canonico, mensajes: unirHilos(hilos) };
}

/**
 * Responde al paciente por el número al que escribió por última vez.
 * null si nunca escribió (no hay ventana de 24 h por ningún número).
 */
export async function responderAlPaciente(celular: string, texto: string): Promise<WaMensajeMarca | null> {
  if (!athleticActivo()) {
    const m = await bslPlataformaChatService.sendReply(celular, texto);
    return m ? { ...m, marca: 'bodytech' } : null;
  }
  const { hilos } = await hilosDelPaciente(celular);
  const marca = marcaParaResponder(hilos);
  if (!marca) return null;
  const m = await plataformaDe(marca).sendReply(celular, texto);
  return m ? { ...m, marca } : null;
}

export default bslPlataformaChatService;
