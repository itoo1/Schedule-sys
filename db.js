/* Capa de datos con dos backends:
 *
 *  - Redis (Upstash) si están definidas UPSTASH_REDIS_REST_URL/TOKEN
 *    (o KV_REST_API_URL/TOKEN). Necesario en hostings serverless (Vercel).
 *  - Archivo JSON local en cualquier otro caso (desarrollo, Render con disco…).
 *
 * Todas las reservas viven en una sola estructura { reservations: [...] }.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const USE_REDIS = Boolean(REDIS_URL && REDIS_TOKEN);
const REDIS_KEY = 'lab:reservations';

// ---------------------------------------------------------------------------
// Backend Redis
// ---------------------------------------------------------------------------
let redis = null;
if (USE_REDIS) {
  const { Redis } = await import('@upstash/redis');
  redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
}

// ---------------------------------------------------------------------------
// Backend archivo JSON
// ---------------------------------------------------------------------------
const DATA_DIR = process.env.DATA_DIR
  ? (process.env.DATA_DIR.startsWith('/') ? process.env.DATA_DIR : join(__dirname, process.env.DATA_DIR))
  : join(__dirname, 'data');
const DATA_FILE = join(DATA_DIR, 'reservations.json');
let writeChain = Promise.resolve();

async function ensureFile() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) {
    await writeFile(DATA_FILE, JSON.stringify({ reservations: [] }, null, 2), 'utf8');
  }
}

// ---------------------------------------------------------------------------
// Lectura / escritura del arreglo completo
// ---------------------------------------------------------------------------
async function readAll() {
  if (USE_REDIS) {
    const data = await redis.get(REDIS_KEY); // @upstash/redis deserializa JSON automáticamente
    return Array.isArray(data) ? data : [];
  }
  await ensureFile();
  try {
    const parsed = JSON.parse(await readFile(DATA_FILE, 'utf8'));
    return Array.isArray(parsed.reservations) ? parsed.reservations : [];
  } catch {
    return [];
  }
}

async function writeAll(list) {
  if (USE_REDIS) {
    await redis.set(REDIS_KEY, list);
    return;
  }
  // Escritura atómica y serializada al archivo local.
  writeChain = writeChain.then(async () => {
    await ensureFile();
    const tmp = `${DATA_FILE}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ reservations: list }, null, 2), 'utf8');
    await rename(tmp, DATA_FILE);
  });
  return writeChain;
}

// ---------------------------------------------------------------------------
// API pública del módulo
// ---------------------------------------------------------------------------
export const storageBackend = USE_REDIS ? 'redis' : 'file';

export async function getReservations({ from, to } = {}) {
  let list = await readAll();
  if (from) list = list.filter((r) => r.date >= from);
  if (to) list = list.filter((r) => r.date <= to);
  return list.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

export async function getReservationById(id) {
  const list = await readAll();
  return list.find((r) => r.id === id) || null;
}

export async function addReservation(reservation) {
  const list = await readAll();
  list.push(reservation);
  await writeAll(list);
  return reservation;
}

export async function updateReservation(id, patch) {
  const list = await readAll();
  const target = list.find((r) => r.id === id);
  if (!target) return null;
  Object.assign(target, patch);
  await writeAll(list);
  return target;
}

export async function removeReservation(id) {
  const list = await readAll();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  await writeAll(list);
  return true;
}

/** Reemplaza TODAS las reservas de una sola vez (usado por el bootstrap del horario). */
export async function replaceAllReservations(list) {
  await writeAll(list);
  return list;
}

// Un bloque está ocupado por reservas aprobadas o pendientes (las rechazadas liberan el horario).
export async function hasConflict({ date, start, end, ignoreId, statuses = ['approved', 'pending'] }) {
  const list = await readAll();
  return list.some((r) => {
    if (r.id === ignoreId) return false;
    if (r.date !== date) return false;
    if (!statuses.includes(r.status || 'approved')) return false;
    // Solapamiento de intervalos [start, end)
    return start < r.end && end > r.start;
  });
}
