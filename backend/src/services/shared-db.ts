// ============================================================================
// shared-db — Conexión única a `bodytech_profesionales`, la base COMPARTIDA.
//
// En ese cluster hay una base por aplicación (`bodytech`, `bodytech_acc`,
// `bodytech_prepagadas`) más ésta, que guarda lo que las tres tienen que ver
// igual: sedes, planta, empresas cliente y —desde ahora— el padrón de
// afiliados.
//
// Existe para que no haya un pool por servicio. Cada `new Pool()` abre sus
// propias conexiones, y el cluster tiene un tope; tres servicios apuntando a la
// misma base con tres pools gastan el triple sin ganar nada.
//
// `directorio.service` conserva el suyo a propósito: es de SOLO LECTURA y su
// aislamiento es parte de esa garantía. No se toca esta semana, con las
// aplicaciones nuevas entrando en producción.
// ============================================================================

import { Pool } from 'pg';

let pool: Pool | null = null;

export function getSharedPool(): Pool {
  if (pool) return pool;
  pool = new Pool({
    user: process.env.POSTGRES_USER || 'doadmin',
    password: process.env.POSTGRES_PASSWORD,
    host:
      process.env.POSTGRES_HOST ||
      'bslpostgres-do-user-19197755-0.k.db.ondigitalocean.com',
    port: parseInt(process.env.POSTGRES_PORT || '25060'),
    database: process.env.DIRECTORIO_DATABASE || 'bodytech_profesionales',
    // Igual que los demás pools del proyecto: la CA de DigitalOcean no está en
    // el trust store del contenedor.
    ssl: { rejectUnauthorized: false },
    max: 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (err) => {
    console.error('❌ [shared-db] error inesperado en el pool:', err);
  });
  return pool;
}
