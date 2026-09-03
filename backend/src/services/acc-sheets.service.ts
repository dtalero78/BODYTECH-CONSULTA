// ============================================================================
// acc-sheets.service — vuelca las valoraciones cerradas al Excel de Sol Médica.
//
// El Excel dejó de ser el producto y pasó a ser una SALIDA: el dato nace en la
// plataforma y esto lo publica en la hoja que el cliente consulta. El orden de
// columnas es el que Bodytech aprobó en la reunión de validación y está abajo,
// en un solo sitio.
//
// POR QUÉ NO SE USA `googleapis`
// ------------------------------
// El paquete oficial pesa ~100 MB (trae TODAS las APIs de Google). Esta app
// corre en un contenedor único de DigitalOcean que ya carga Chromium y ffmpeg,
// y el tamaño de imagen es una restricción real del proyecto. Para escribir en
// una hoja hacen falta dos llamadas HTTP y un JWT firmado con RS256 — eso lo
// hace el módulo `crypto` de Node sin dependencia alguna.
//
// CONFIGURACIÓN (si falta, el servicio NO-OP y lo dice en el log; nunca tira)
//   ACC_SHEETS_ID                   → id de la hoja de cálculo
//   ACC_SHEETS_TAB                  → nombre de la pestaña (default abajo)
//   GOOGLE_SERVICE_ACCOUNT_JSON_B64 → el JSON de la cuenta de servicio en base64
//
// La hoja debe estar COMPARTIDA CON EL `client_email` de la cuenta de servicio,
// con permiso de edición. Es el paso que siempre se olvida.
// ============================================================================

import crypto from 'crypto';
import accService, { type Valoracion } from './acc.service';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TAB_DEFAULT = 'Registro de Pacientes';

interface CuentaServicio {
  client_email: string;
  private_key: string;
}

/**
 * Orden de columnas del Excel acumulado, tal como se aprobó.
 *
 * ⚠️ Es un contrato con el cliente: Sol Médica lee esta hoja. Insertar una
 * columna en el medio desalinea todas las filas ya escritas. Agregar al FINAL
 * es seguro; reordenar no lo es.
 */
export const COLUMNAS_SHEET: Array<{ header: string; valor: (v: Valoracion) => string | number }> = [
  { header: 'Nombre Completo', valor: (v) => v.nombreCompleto ?? '' },
  { header: 'Cédula / ID', valor: (v) => v.numeroId },
  { header: 'Edad', valor: (v) => v.edad ?? '' },
  { header: 'Sexo', valor: (v) => (v.sexo === 'masculino' ? 'Masculino' : v.sexo === 'femenino' ? 'Femenino' : '') },
  { header: 'Estatura (cm)', valor: (v) => v.estaturaCm ?? '' },
  { header: 'Fecha Evaluación', valor: (v) => formatoFechaCo(v.fechaEvaluacion) },
  { header: 'Peso (Kg)', valor: (v) => v.pesoKg ?? '' },
  { header: 'IMC (kg/m²)', valor: (v) => v.resultado.imc?.valor ?? '' },
  { header: 'Estado IMC', valor: (v) => etiqueta(v.resultado.imc?.evaluacion) },
  { header: '% Grasa', valor: (v) => v.resultado.porcentajeGrasa?.valor ?? '' },
  { header: 'Estado % Grasa', valor: (v) => etiqueta(v.resultado.porcentajeGrasa?.evaluacion) },
  { header: '% Muscular', valor: (v) => v.resultado.porcentajeMuscular?.valor ?? '' },
  { header: 'Peso Muscular', valor: (v) => v.resultado.pesoMuscularKg ?? '' },
  { header: 'IMM (kg/m²)', valor: (v) => v.resultado.imm ?? '' },
  { header: 'TMB (kcal)', valor: (v) => v.resultado.tmbKcal?.valor ?? '' },
  { header: 'Perímetro Abdominal', valor: (v) => v.perimetroAbdominal ?? '' },
  { header: 'Perímetro Cadera', valor: (v) => v.perimetroCadera ?? '' },
  { header: 'ICC', valor: (v) => v.resultado.icc?.valor ?? '' },
  { header: 'ICT', valor: (v) => v.resultado.ict?.valor ?? '' },
  { header: 'Bícep Der Rel/Con', valor: (v) => par(v.perimetroBrazoRelajadoDer, v.perimetroBrazoContraidoDer) },
  { header: 'Bícep Izq Rel/Con', valor: (v) => par(v.perimetroBrazoRelajadoIzq, v.perimetroBrazoContraidoIzq) },
  { header: 'Muslo Der (cm)', valor: (v) => v.perimetroMusloDer ?? '' },
  { header: 'Muslo Izq (cm)', valor: (v) => v.perimetroMusloIzq ?? '' },
];

const ETIQUETAS: Record<string, string> = {
  bajo: 'Bajo',
  normal: 'Normal',
  alto: 'Alto',
  optimo: 'Óptimo',
};

function etiqueta(e: string | null | undefined): string {
  return e ? (ETIQUETAS[e] ?? e) : '';
}

/** "24.5 / 27.0" — el formato relajado/contraído que usa la hoja. */
function par(relajado: number | null | undefined, contraido: number | null | undefined): string {
  if (relajado === null || relajado === undefined) return '';
  if (contraido === null || contraido === undefined) return relajado.toFixed(1);
  return `${relajado.toFixed(1)} / ${contraido.toFixed(1)}`;
}

/** La hoja usa DD/MM/YYYY, no ISO. */
function formatoFechaCo(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// ---------------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------------

function leerCuenta(): CuentaServicio | null {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  if (!b64) return null;
  try {
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
    if (!json.client_email || !json.private_key) {
      console.error('❌ [ACC Sheets] La cuenta de servicio no trae client_email/private_key');
      return null;
    }
    return { client_email: json.client_email, private_key: json.private_key };
  } catch {
    console.error('❌ [ACC Sheets] GOOGLE_SERVICE_ACCOUNT_JSON_B64 no es un JSON válido en base64');
    return null;
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

let cacheToken: { token: string; expiraEn: number } | null = null;

/**
 * Token OAuth2 por JWT-bearer. Se cachea hasta 60 s antes de expirar para no
 * pedir uno por cada fila.
 */
async function getAccessToken(cuenta: CuentaServicio): Promise<string> {
  if (cacheToken && Date.now() < cacheToken.expiraEn) return cacheToken.token;

  const ahora = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: cuenta.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: ahora,
      exp: ahora + 3600,
    })
  );

  const firma = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(cuenta.private_key);
  const jwt = `${header}.${claims}.${base64url(firma)}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    throw new Error(`Google rechazó el JWT (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cacheToken = {
    token: data.access_token,
    expiraEn: Date.now() + (data.expires_in - 60) * 1000,
  };
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

export interface ResultadoExport {
  ok: boolean;
  motivo?: string;
  exportadas: number;
  errores: number;
}

/** Reintento con backoff: la API de Sheets devuelve 429/5xx con frecuencia. */
async function conReintento<T>(fn: () => Promise<T>, intentos = 3): Promise<T> {
  let ultimoError: unknown;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn();
    } catch (e) {
      ultimoError = e;
      if (i < intentos - 1) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** i));
      }
    }
  }
  throw ultimoError;
}

async function appendFilas(filas: Array<Array<string | number>>): Promise<number | null> {
  const cuenta = leerCuenta();
  const sheetId = process.env.ACC_SHEETS_ID;
  if (!cuenta || !sheetId) throw new Error('SHEETS_NO_CONFIGURADO');

  const tab = process.env.ACC_SHEETS_TAB || TAB_DEFAULT;
  const token = await getAccessToken(cuenta);
  const rango = encodeURIComponent(`${tab}!A1`);

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}` +
      `/values/${rango}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: filas }),
    }
  );

  if (!res.ok) {
    const cuerpo = await res.text();
    // Un 401/403 casi siempre es la hoja sin compartir con la cuenta de
    // servicio. Vale la pena decirlo con todas las letras.
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Sheets rechazó la escritura (${res.status}). ¿Compartiste la hoja con ${cuenta.client_email} como editor? — ${cuerpo}`
      );
    }
    throw new Error(`Sheets respondió ${res.status}: ${cuerpo}`);
  }

  const data = (await res.json()) as { updates?: { updatedRange?: string } };
  // "Registro!A25:W25" → 25
  const m = /![A-Z]+(\d+)/.exec(data.updates?.updatedRange ?? '');
  return m ? Number(m[1]) : null;
}

/** ¿Está configurado el destino? Lo consulta el endpoint de estado del panel. */
function estaConfigurado(): boolean {
  return Boolean(leerCuenta() && process.env.ACC_SHEETS_ID);
}

/**
 * Vuelca al Excel las valoraciones cerradas que faltan. Cada fila se marca como
 * exportada apenas se confirma, así que una caída a mitad de lote no duplica ni
 * pierde: la siguiente pasada retoma donde quedó.
 */
async function exportarPendientes(limite = 50): Promise<ResultadoExport> {
  if (!estaConfigurado()) {
    return {
      ok: false,
      motivo: 'Falta ACC_SHEETS_ID o GOOGLE_SERVICE_ACCOUNT_JSON_B64',
      exportadas: 0,
      errores: 0,
    };
  }

  const pendientes = await accService.pendientesDeExportar(limite);
  if (pendientes.length === 0) return { ok: true, exportadas: 0, errores: 0 };

  let exportadas = 0;
  let errores = 0;

  for (const v of pendientes) {
    try {
      const fila = COLUMNAS_SHEET.map((c) => c.valor(v));
      const numeroFila = await conReintento(() => appendFilas([fila]));
      await accService.marcarExportada(v.id, numeroFila);
      exportadas++;
    } catch (e) {
      errores++;
      console.error(`❌ [ACC Sheets] Valoración ${v.id} no se pudo exportar:`, e);
    }
  }

  return { ok: errores === 0, exportadas, errores };
}

export const accSheetsService = {
  estaConfigurado,
  exportarPendientes,
  COLUMNAS_SHEET,
};

export default accSheetsService;
