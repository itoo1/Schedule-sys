/* Genera reservas de demostración para el año en curso. Uso: node seed.js */
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR
  ? (process.env.DATA_DIR.startsWith('/') ? process.env.DATA_DIR : join(__dirname, process.env.DATA_DIR))
  : join(__dirname, 'data');
const DATA_FILE = join(DATA_DIR, 'reservations.json');

const COURSES = [
  'Valoración de Empresas', 'Mercado de Capitales', 'Renta Fija',
  'Derivados y Gestión de Riesgo', 'Portfolio Management', 'Análisis Técnico',
  'Trading Room', 'Investigación / Tesis', 'Certificación Bloomberg (BMC)',
];
const NAMES = [
  'María José Fuentes', 'Diego Salinas', 'Camila Rojas', 'Sebastián Vera',
  'Antonia Muñoz', 'Ignacio Tapia', 'Valentina Contreras', 'Matías Herrera',
  'Josefa Pizarro', 'Tomás Castillo', 'Fernanda Álvarez', 'Benjamín Soto',
  'Prof. Andrés Lagos', 'Prof. Claudia Reyes',
];
const PURPOSES = [
  'Simulación de portafolio', 'Análisis de estados financieros', 'Curva de rendimiento',
  'Backtesting de estrategia', 'Comparables de mercado', 'Preparación certificación',
  'Datos para tesis', 'Taller práctico', '',
];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function makeCode() {
  const ab = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => ab[Math.floor(Math.random() * ab.length)]).join('');
}

const year = new Date().getFullYear();
const reservations = [];

for (let m = 0; m < 12; m++) {
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, m, day);
    const dow = d.getDay();
    if (dow === 0) continue; // domingo cerrado
    // intensidad: más actividad entre semana, algo en sábado
    const base = dow === 6 ? 0.35 : 0.8;
    const blocks = Math.random() < base ? 1 + Math.floor(Math.random() * (dow === 6 ? 2 : 4)) : 0;

    const used = [];
    for (let b = 0; b < blocks; b++) {
      const startH = 8 + Math.floor(Math.random() * 10); // 8..17
      const dur = pick([1, 1, 2, 2, 3]);
      const endH = startH + dur;
      if (endH > 20) continue;
      if (used.some(([s, e]) => startH < e && endH > s)) continue;
      used.push([startH, endH]);
      // Reservas futuras cercanas: algunas quedan pendientes de aprobación para la demo.
      const isFuture = d > new Date();
      const daysAhead = (d - new Date()) / 86400000;
      const status = isFuture && daysAhead < 21 && Math.random() < 0.28 ? 'pending' : 'approved';
      reservations.push({
        id: randomUUID(),
        code: makeCode(),
        name: pick(NAMES),
        email: 'demo@universidad.cl',
        course: pick(COURSES),
        purpose: pick(PURPOSES),
        notes: '',
        date: ymd(d),
        start: `${pad(startH)}:00`,
        end: `${pad(endH)}:00`,
        status,
        createdAt: new Date().toISOString(),
        decidedAt: status === 'approved' ? new Date().toISOString() : null,
        decisionNote: '',
      });
    }
  }
}

if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
await writeFile(DATA_FILE, JSON.stringify({ reservations }, null, 2), 'utf8');
console.log(`Generadas ${reservations.length} reservas de demostración para ${year}.`);
