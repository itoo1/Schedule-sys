import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// DATA_DIR permite apuntar a un disco persistente en la nube (Render, Railway, Fly…).
const DATA_DIR = process.env.DATA_DIR
  ? (process.env.DATA_DIR.startsWith('/') ? process.env.DATA_DIR : join(__dirname, process.env.DATA_DIR))
  : join(__dirname, 'data');
const DATA_FILE = join(DATA_DIR, 'reservations.json');

// Cola de escritura para evitar condiciones de carrera al persistir el JSON.
let writeChain = Promise.resolve();

async function ensureStore() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) {
    await writeFile(DATA_FILE, JSON.stringify({ reservations: [] }, null, 2), 'utf8');
  }
}

async function readStore() {
  await ensureStore();
  try {
    const raw = await readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.reservations)) parsed.reservations = [];
    return parsed;
  } catch {
    return { reservations: [] };
  }
}

function persist(store) {
  writeChain = writeChain.then(async () => {
    await ensureStore();
    const tmp = `${DATA_FILE}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
    await rename(tmp, DATA_FILE);
  });
  return writeChain;
}

export async function getReservations({ from, to } = {}) {
  const { reservations } = await readStore();
  let list = [...reservations];
  if (from) list = list.filter((r) => r.date >= from);
  if (to) list = list.filter((r) => r.date <= to);
  return list.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

export async function getReservationById(id) {
  const { reservations } = await readStore();
  return reservations.find((r) => r.id === id) || null;
}

export async function addReservation(reservation) {
  const store = await readStore();
  store.reservations.push(reservation);
  await persist(store);
  return reservation;
}

export async function updateReservation(id, patch) {
  const store = await readStore();
  const target = store.reservations.find((r) => r.id === id);
  if (!target) return null;
  Object.assign(target, patch);
  await persist(store);
  return target;
}

export async function removeReservation(id) {
  const store = await readStore();
  const idx = store.reservations.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  store.reservations.splice(idx, 1);
  await persist(store);
  return true;
}

// Un bloque está ocupado por reservas aprobadas o pendientes (las rechazadas liberan el horario).
export async function hasConflict({ date, start, end, ignoreId, statuses = ['approved', 'pending'] }) {
  const { reservations } = await readStore();
  return reservations.some((r) => {
    if (r.id === ignoreId) return false;
    if (r.date !== date) return false;
    if (!statuses.includes(r.status || 'approved')) return false;
    // Solapamiento de intervalos [start, end)
    return start < r.end && end > r.start;
  });
}
