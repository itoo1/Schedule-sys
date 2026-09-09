import express from 'express';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getReservations,
  getReservationById,
  addReservation,
  updateReservation,
  removeReservation,
  hasConflict,
} from './db.js';
import { buildSchedule } from './schedule.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

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
  terminals: 8,
  maxHoursPerReservation: 4,
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

const sessions = new Map(); // token -> { createdAt }
const SESSION_TTL = 1000 * 60 * 60 * 8; // 8 horas

function checkPassword(candidate) {
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = token && sessions.get(token);
  if (!session || Date.now() - session.createdAt > SESSION_TTL) {
    if (token) sessions.delete(token);
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

function validateReservation(body) {
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
  if ((e - s) % 30 !== 0) errors.push('Los bloques deben ser múltiplos de 30 minutos.');
  if (e - s > LAB_CONFIG.maxHoursPerReservation * 60) {
    errors.push(`La reserva no puede exceder ${LAB_CONFIG.maxHoursPerReservation} horas.`);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  if (date < todayStr) errors.push('No se pueden crear reservas en fechas pasadas.');

  if (errors.length) return { errors };

  return {
    value: { name, email, course, purpose, notes, date, start, end },
  };
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
  const { errors, value } = validateReservation(req.body || {});
  if (errors) return res.status(400).json({ errors });

  if (await hasConflict(value)) {
    return res.status(409).json({
      errors: ['Ese bloque ya está reservado o tiene una solicitud pendiente. Elige otro horario.'],
    });
  }

  const status = LAB_CONFIG.requireApproval ? 'pending' : 'approved';
  const reservation = {
    id: randomUUID(),
    code: makeCode(),
    ...value,
    status,
    createdAt: new Date().toISOString(),
    decidedAt: status === 'approved' ? new Date().toISOString() : null,
    decisionNote: '',
  };
  await addReservation(reservation);

  res.status(201).json({
    id: reservation.id,
    code: reservation.code,
    status,
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

  await removeReservation(reservation.id);
  res.json({ message: 'Reserva cancelada.' });
});

// ---------------------------------------------------------------------------
// API de administrador
// ---------------------------------------------------------------------------
app.post('/api/admin/login', (req, res) => {
  if (!checkPassword(req.body?.password || '')) {
    return res.status(401).json({ errors: ['Contraseña incorrecta.'] });
  }
  const token = randomBytes(24).toString('hex');
  sessions.set(token, { createdAt: Date.now() });
  res.json({ token, expiresIn: SESSION_TTL });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  const token = req.headers.authorization.slice(7);
  sessions.delete(token);
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

app.post('/api/admin/reservations/:id/approve', requireAdmin, async (req, res) => {
  const r = await getReservationById(req.params.id);
  if (!r) return res.status(404).json({ errors: ['La reserva no existe.'] });

  // Verificar que no choque con otra reserva ya aprobada
  if (await hasConflict({ ...r, ignoreId: r.id, statuses: ['approved'] })) {
    return res.status(409).json({ errors: ['Choca con otra reserva ya aprobada en ese horario.'] });
  }
  const updated = await updateReservation(r.id, {
    status: 'approved',
    decidedAt: new Date().toISOString(),
    decisionNote: String(req.body?.note || '').slice(0, 300),
  });
  res.json(updated);
});

app.post('/api/admin/reservations/:id/reject', requireAdmin, async (req, res) => {
  const r = await getReservationById(req.params.id);
  if (!r) return res.status(404).json({ errors: ['La reserva no existe.'] });
  const updated = await updateReservation(r.id, {
    status: 'rejected',
    decidedAt: new Date().toISOString(),
    decisionNote: String(req.body?.note || '').slice(0, 300),
  });
  res.json(updated);
});

app.post('/api/admin/reservations', requireAdmin, async (req, res) => {
  const { errors, value } = validateReservation(req.body || {});
  if (errors) return res.status(400).json({ errors });
  if (await hasConflict({ ...value, statuses: ['approved'] })) {
    return res.status(409).json({ errors: ['Choca con una reserva ya aprobada.'] });
  }
  const reservation = {
    id: randomUUID(),
    code: makeCode(),
    ...value,
    status: 'approved',
    createdAt: new Date().toISOString(),
    decidedAt: new Date().toISOString(),
    decisionNote: 'Creada por administrador',
  };
  await addReservation(reservation);
  res.status(201).json(reservation);
});

app.delete('/api/admin/reservations/:id', requireAdmin, async (req, res) => {
  const ok = await removeReservation(req.params.id);
  if (!ok) return res.status(404).json({ errors: ['La reserva no existe.'] });
  res.json({ message: 'Reserva eliminada.' });
});

app.get('*', (_req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));

// En un despliegue nuevo (o disco vacío) carga el horario del semestre automáticamente.
// Ponte BOOTSTRAP_SCHEDULE=0 para desactivarlo.
async function bootstrap() {
  if (process.env.BOOTSTRAP_SCHEDULE === '0') return;
  const existing = await getReservations();
  if (existing.length > 0) return;
  for (const r of buildSchedule()) await addReservation(r);
  console.log('  Horario del semestre cargado automáticamente (base vacía).');
}

await bootstrap();

app.listen(PORT, () => {
  console.log(`\n  ${LAB_CONFIG.name}`);
  console.log(`  Reservas disponibles en  http://localhost:${PORT}`);
  console.log(`  Panel de administración   http://localhost:${PORT}/admin\n`);
});
