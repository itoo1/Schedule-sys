import express from 'express';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getReservations,
  getReservationById,
  addReservation,
  addReservations,
  updateReservation,
  updateReservationsWhere,
  findConflictingDates,
  removeReservation,
  removeReservationsWhere,
  replaceAllReservations,
  hasConflict,
  storageBackend,
  storeInitialized,
} from './db.js';
import { buildSchedule } from './schedule.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// El API nunca se cachea (ni en el navegador ni en el CDN de Vercel).
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  next();
});

app.use(express.static(join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) res.set('Cache-Control', 'no-cache');
  },
}));

// En un despliegue nuevo (base vacía) carga el horario del semestre automáticamente.
// Ponte BOOTSTRAP_SCHEDULE=0 para desactivarlo. Se ejecuta una sola vez por instancia.
let bootstrapPromise = null;
function ensureBootstrap() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      if (process.env.BOOTSTRAP_SCHEDULE === '0') return;
      // Solo se carga el horario si el almacén nunca existió. Que esté vacío (o ilegible) no basta:
      // así un fallo transitorio de lectura no puede reemplazar las reservas existentes.
      if (await storeInitialized()) return;
      await replaceAllReservations(buildSchedule());
      console.log('  Horario del semestre cargado automáticamente (base vacía).');
    })().catch((err) => {
      bootstrapPromise = null; // permite reintentar en la siguiente petición
      throw err;
    });
  }
  return bootstrapPromise;
}
app.use((_req, _res, next) => ensureBootstrap().then(() => next()).catch(next));

// ---------------------------------------------------------------------------
// Configuración del laboratorio
// ---------------------------------------------------------------------------
const LAB_CONFIG = {
  name: 'Lab Finanzas Itaú UdeC',
  institution: 'FACEA · UdeC',
  openDays: [1, 2, 3, 4, 5], // lunes a viernes (0 = domingo ... 6 = sábado)
  openHour: '08:00',
  closeHour: '20:00',
  slotMinutes: 60,
  terminals: 15,
  maxHoursPerReservation: 4,
  minAdvanceDays: 0, // días de anticipación mínima para reservar (0 = sin restricción)
  maxRecurringWeeks: 20, // máximo de semanas que se pueden reservar de una sola vez
  requireApproval: true, // las reservas quedan pendientes hasta que un administrador las aprueba
  courses: [
    'Valoración de Empresas',
    'Mercado de Capitales',
    'Renta Fija',
    'Derivados y Gestión de Riesgo',
    'Portfolio Management',
    'Análisis Técnico',
    'Trading Room',
    'Investigación / Tesis',
    'Certificación Bloomberg (BMC)',
    'Otro',
  ],
};

// ---------------------------------------------------------------------------
// Autenticación de administrador (contraseña única por variable de entorno)
// ---------------------------------------------------------------------------
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'bloomberg-admin';
if (!process.env.ADMIN_PASSWORD) {
  console.warn('\n  ⚠  ADMIN_PASSWORD no está definida. Usando clave por defecto "bloomberg-admin".');
  console.warn('     Define ADMIN_PASSWORD antes de usar esto en producción.\n');
}

const SESSION_TTL = 1000 * 60 * 60 * 8; // 8 horas

function checkPassword(candidate) {
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Token sin estado (HMAC firmado con ADMIN_PASSWORD). No requiere almacenamiento,
// así funciona igual en un servidor normal o en funciones serverless.
function issueToken() {
  const exp = String(Date.now() + SESSION_TTL);
  const sig = createHmac('sha256', ADMIN_PASSWORD).update(exp).digest('hex');
  return `${exp}.${sig}`;
}

function validToken(token) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig || Date.now() > Number(exp)) return false;
  const expected = createHmac('sha256', ADMIN_PASSWORD).update(exp).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!validToken(token)) {
    return res.status(401).json({ errors: ['Sesión de administrador inválida o expirada.'] });
  }
  next();
}

// ---------------------------------------------------------------------------
// Utilidades de validación
// ---------------------------------------------------------------------------
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

// isAdmin: el administrador autenticado puede reservar sin la anticipación mínima.
function validateReservation(body, { isAdmin = false } = {}) {
  const errors = [];
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const course = String(body.course || '').trim();
  const purpose = String(body.purpose || '').trim();
  const notes = String(body.notes || '').trim().slice(0, 500);
  const date = String(body.date || '').trim();
  const start = String(body.start || '').trim();
  const end = String(body.end || '').trim();

  if (name.length < 3) errors.push('El nombre debe tener al menos 3 caracteres.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('Correo electrónico inválido.');
  if (!course) errors.push('Selecciona un curso o motivo.');
  if (!YMD.test(date)) errors.push('Fecha inválida.');
  if (!HHMM.test(start) || !HHMM.test(end)) errors.push('Horario inválido.');

  if (errors.length) return { errors };

  const day = new Date(`${date}T00:00:00`);
  if (Number.isNaN(day.getTime())) errors.push('Fecha inválida.');
  else if (!LAB_CONFIG.openDays.includes(day.getDay())) {
    errors.push('El laboratorio no abre ese día de la semana.');
  }

  const s = toMinutes(start);
  const e = toMinutes(end);
  const open = toMinutes(LAB_CONFIG.openHour);
  const close = toMinutes(LAB_CONFIG.closeHour);

  if (s >= e) errors.push('La hora de término debe ser posterior a la de inicio.');
  if (s < open || e > close) {
    errors.push(`El horario debe estar entre ${LAB_CONFIG.openHour} y ${LAB_CONFIG.closeHour}.`);
  }
  if (e - s < 15) errors.push('La reserva debe durar al menos 15 minutos.');
  if (e - s > LAB_CONFIG.maxHoursPerReservation * 60) {
    errors.push(`La reserva no puede exceder ${LAB_CONFIG.maxHoursPerReservation} horas.`);
  }

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  if (date < todayStr) errors.push('No se pueden crear reservas en fechas pasadas.');

  if (!isAdmin && LAB_CONFIG.minAdvanceDays > 0) {
    const minDate = new Date(now);
    minDate.setUTCDate(minDate.getUTCDate() + LAB_CONFIG.minAdvanceDays);
    const minStr = minDate.toISOString().slice(0, 10);
    if (date < minStr) {
      errors.push(
        `Las reservas se solicitan con al menos ${LAB_CONFIG.minAdvanceDays} días de anticipación. ` +
        `La fecha más próxima disponible es el ${minStr}.`
      );
    }
  }

  if (errors.length) return { errors };

  return {
    value: { name, email, course, purpose, notes, date, start, end },
  };
}

// ---------------------------------------------------------------------------
// Reservas recurrentes: el mismo día y horario durante N semanas seguidas
// ---------------------------------------------------------------------------
function parseWeeks(body) {
  const raw = body.weeks === undefined || body.weeks === '' ? 1 : Number(body.weeks);
  if (!Number.isInteger(raw) || raw < 1 || raw > LAB_CONFIG.maxRecurringWeeks) {
    return { error: `Las semanas deben ser un número entre 1 y ${LAB_CONFIG.maxRecurringWeeks}.` };
  }
  return { weeks: raw };
}

function addDaysYmd(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const fmtChile = (ymd) => ymd.split('-').reverse().join('/'); // dd/mm/aaaa

/**
 * Crea la reserva (o la serie semanal) de forma atómica: si alguna semana choca con otra
 * reserva no se crea ninguna y se informan las fechas en conflicto.
 */
async function createReservations(value, weeks, { status, decisionNote = '' }) {
  const slots = Array.from({ length: weeks }, (_, i) => ({
    date: addDaysYmd(value.date, 7 * i), start: value.start, end: value.end,
  }));

  const conflicts = await findConflictingDates(slots);
  if (conflicts.length) {
    return {
      conflict: weeks === 1
        ? 'Ese bloque ya está reservado o tiene una solicitud pendiente. Elige otro horario.'
        : `Hay conflicto de horario en: ${conflicts.map(fmtChile).join(', ')}. ` +
          'Elige menos semanas u otro horario (no se creó ninguna reserva).',
    };
  }

  const now = new Date().toISOString();
  const code = makeCode();                 // un solo código para toda la serie
  const seriesId = weeks > 1 ? randomUUID() : null;
  const items = slots.map((slot, i) => ({
    id: randomUUID(),
    code,
    ...value,
    date: slot.date,
    status,
    createdAt: now,
    decidedAt: status === 'approved' ? now : null,
    decisionNote,
    ...(seriesId ? { seriesId, seriesIndex: i + 1, seriesTotal: weeks } : {}),
  }));
  await addReservations(items);
  return { items, code };
}

const publicView = (r) => ({
  id: r.id,
  name: r.name,
  course: r.course,
  purpose: r.purpose,
  date: r.date,
  start: r.start,
  end: r.end,
  status: r.status || 'approved',
  week: r.seriesIndex || 1,
  weeks: r.seriesTotal || 1,
});

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------
app.get('/api/config', (_req, res) => res.json(LAB_CONFIG));

app.get('/api/reservations', async (req, res) => {
  const { from, to } = req.query;
  const list = await getReservations({ from, to });
  res.json(list.filter((r) => (r.status || 'approved') !== 'rejected').map(publicView));
});

app.get('/api/stats', async (req, res) => {
  const { from, to } = req.query;
  const all = await getReservations({ from, to });
  const approved = all.filter((r) => (r.status || 'approved') === 'approved');
  const pending = all.filter((r) => r.status === 'pending');

  const totalMinutes = approved.reduce((acc, r) => acc + (toMinutes(r.end) - toMinutes(r.start)), 0);
  const openMinutesPerDay = toMinutes(LAB_CONFIG.closeHour) - toMinutes(LAB_CONFIG.openHour);

  let openDaysInRange = 0;
  if (YMD.test(from || '') && YMD.test(to || '')) {
    const d = new Date(`${from}T00:00:00`);
    const last = new Date(`${to}T00:00:00`);
    while (d <= last) {
      if (LAB_CONFIG.openDays.includes(d.getDay())) openDaysInRange++;
      d.setDate(d.getDate() + 1);
    }
  }

  const capacity = openDaysInRange * openMinutesPerDay;
  const byCourse = {};
  for (const r of approved) {
    byCourse[r.course] = (byCourse[r.course] || 0) + (toMinutes(r.end) - toMinutes(r.start)) / 60;
  }

  res.json({
    count: approved.length,
    pending: pending.length,
    hoursReserved: Math.round((totalMinutes / 60) * 10) / 10,
    occupancy: capacity ? Math.round((totalMinutes / capacity) * 1000) / 10 : null,
    byCourse,
  });
});

app.post('/api/reservations', async (req, res) => {
  const body = req.body || {};
  const { errors, value } = validateReservation(body);
  const w = parseWeeks(body);
  if (w.error) (errors || []).push(w.error);
  if (errors || w.error) return res.status(400).json({ errors: errors || [w.error] });

  const status = LAB_CONFIG.requireApproval ? 'pending' : 'approved';
  const result = await createReservations(value, w.weeks, { status });
  if (result.conflict) return res.status(409).json({ errors: [result.conflict] });

  const { items, code } = result;
  res.status(201).json({
    id: items[0].id,
    code,
    status,
    count: items.length,
    firstDate: items[0].date,
    lastDate: items[items.length - 1].date,
    message: status === 'pending'
      ? 'Solicitud enviada. Un administrador debe aprobarla. Guarda el código para consultarla o cancelarla.'
      : 'Reserva confirmada. Guarda el código para cancelarla.',
  });
});

// Consulta pública del estado de una reserva por código
app.get('/api/reservations/:id', async (req, res) => {
  const r = await getReservationById(req.params.id);
  const code = String(req.query.code || '').trim().toUpperCase();
  if (!r || code !== r.code) return res.status(404).json({ errors: ['Reserva no encontrada.'] });
  res.json({ ...publicView(r), decisionNote: r.decisionNote || '' });
});

app.post('/api/reservations/:id/cancel', async (req, res) => {
  const reservation = await getReservationById(req.params.id);
  if (!reservation) return res.status(404).json({ errors: ['La reserva no existe.'] });

  const code = String(req.body?.code || '').trim().toUpperCase();
  if (code !== reservation.code) {
    return res.status(403).json({ errors: ['Código de cancelación incorrecto.'] });
  }

  // scope "series": cancela todas las semanas que se reservaron juntas.
  if (req.body?.scope === 'series' && reservation.seriesId) {
    const removed = await removeReservationsWhere((r) => r.seriesId === reservation.seriesId && r.code === code);
    return res.json({ message: `${removed} reservas canceladas.`, removed });
  }

  await removeReservation(reservation.id);
  res.json({ message: 'Reserva cancelada.', removed: 1 });
});

// ---------------------------------------------------------------------------
// API de administrador
// ---------------------------------------------------------------------------
app.post('/api/admin/login', (req, res) => {
  if (!checkPassword(req.body?.password || '')) {
    return res.status(401).json({ errors: ['Contraseña incorrecta.'] });
  }
  res.json({ token: issueToken(), expiresIn: SESSION_TTL });
});

app.post('/api/admin/logout', requireAdmin, (_req, res) => {
  // El token es sin estado: el cliente simplemente lo descarta.
  res.json({ ok: true });
});

app.get('/api/admin/reservations', requireAdmin, async (req, res) => {
  const { from, to, status } = req.query;
  let list = await getReservations({ from, to });
  if (status) list = list.filter((r) => (r.status || 'approved') === status);
  // ordenar: pendientes primero, luego por fecha
  list.sort((a, b) => {
    const pa = a.status === 'pending' ? 0 : 1;
    const pb = b.status === 'pending' ? 0 : 1;
    return pa - pb || (a.date + a.start).localeCompare(b.date + b.start);
  });
  res.json(list);
});

// Reservas sobre las que actúa aprobar/rechazar: solo la indicada o, con ?scope=series,
// todas las pendientes que se solicitaron juntas (misma serie semanal).
const targetsOf = (target, scope) => (r) =>
  r.id === target.id ||
  (scope === 'series' && target.seriesId && r.seriesId === target.seriesId && r.status === 'pending');

app.post('/api/admin/reservations/:id/approve', requireAdmin, async (req, res) => {
  const r = await getReservationById(req.params.id);
  if (!r) return res.status(404).json({ errors: ['La reserva no existe.'] });
  const pick = targetsOf(r, req.query.scope);

  // Verificar que ninguna choque con otra reserva ya aprobada
  const all = (await getReservations()).filter(pick);
  const conflicts = await findConflictingDates(all, { statuses: ['approved'], ignoreIds: all.map((x) => x.id) });
  if (conflicts.length) {
    return res.status(409).json({
      errors: [`Choca con otra reserva ya aprobada el ${conflicts.map(fmtChile).join(', ')}. No se aprobó ninguna.`],
    });
  }
  const updated = await updateReservationsWhere(pick, {
    status: 'approved',
    decidedAt: new Date().toISOString(),
    decisionNote: String(req.body?.note || '').slice(0, 300),
  });
  res.json({ updated: updated.length, reservation: updated.find((x) => x.id === r.id) });
});

app.post('/api/admin/reservations/:id/reject', requireAdmin, async (req, res) => {
  const r = await getReservationById(req.params.id);
  if (!r) return res.status(404).json({ errors: ['La reserva no existe.'] });
  const updated = await updateReservationsWhere(targetsOf(r, req.query.scope), {
    status: 'rejected',
    decidedAt: new Date().toISOString(),
    decisionNote: String(req.body?.note || '').slice(0, 300),
  });
  res.json({ updated: updated.length, reservation: updated.find((x) => x.id === r.id) });
});

app.post('/api/admin/reservations', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const { errors, value } = validateReservation(body, { isAdmin: true });
  const w = parseWeeks(body);
  if (errors || w.error) return res.status(400).json({ errors: [...(errors || []), ...(w.error ? [w.error] : [])] });

  const result = await createReservations(value, w.weeks, { status: 'approved', decisionNote: 'Creada por administrador' });
  if (result.conflict) {
    return res.status(409).json({
      errors: [result.conflict.replace('Elige menos semanas u otro horario', 'Apruébalas o recházalas primero, o elige otro horario')],
    });
  }
  const { items, code } = result;
  res.status(201).json({
    ...items[0], code, count: items.length,
    firstDate: items[0].date, lastDate: items[items.length - 1].date,
  });
});

const weekdayOf = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

// Elimina una reserva. Con ?scope=series elimina además todas las del semestre que comparten
// día de la semana, horario, curso y responsable (el bloque que se repite cada semana).
app.delete('/api/admin/reservations/:id', requireAdmin, async (req, res) => {
  const target = await getReservationById(req.params.id);
  if (!target) return res.status(404).json({ errors: ['La reserva no existe.'] });

  if (req.query.scope === 'series') {
    const dow = weekdayOf(target.date);
    const removed = await removeReservationsWhere((r) =>
      weekdayOf(r.date) === dow &&
      r.start === target.start && r.end === target.end &&
      r.course === target.course && r.name === target.name);
    return res.json({ message: `${removed} reservas eliminadas.`, removed });
  }

  await removeReservation(target.id);
  res.json({ message: 'Reserva eliminada.', removed: 1 });
});

// Vuelve a cargar el horario fijo del semestre (definido en schedule.js),
// BORRANDO todas las reservas actuales (incluidas las hechas por estudiantes).
// Útil tras editar schedule.js para que el cambio llegue también a producción.
app.post('/api/admin/resync-schedule', requireAdmin, async (_req, res) => {
  const reservations = buildSchedule();
  await replaceAllReservations(reservations);
  res.json({ message: `Horario recargado: ${reservations.length} reservas.`, count: reservations.length });
});

app.get('*', (_req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));

// Servidor tradicional (local, Render, Railway…). En Vercel se usa la exportación de abajo.
const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  app.listen(PORT, () => {
    console.log(`\n  ${LAB_CONFIG.name}  ·  almacenamiento: ${storageBackend}`);
    console.log(`  Reservas disponibles en  http://localhost:${PORT}`);
    console.log(`  Panel de administración   http://localhost:${PORT}/admin\n`);
  });
}

export default app;
