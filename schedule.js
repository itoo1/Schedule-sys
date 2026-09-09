/* Horario académico recurrente del semestre.
 *
 * - Como módulo:  import { buildSchedule } from './schedule.js'
 * - Como script:  node schedule.js   → BORRA todas las reservas y recarga el horario
 */
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

const RANGE_START = '2026-08-10'; // lunes
const RANGE_END = '2026-12-11';   // viernes, segunda semana de diciembre

const CSM = { name: 'Claudio San Martín', email: 'csanmartin2022@udec.cl' };
const FC = 'financeclubudec@gmail.com';

// dow: 1 = lunes ... 5 = viernes
const WEEKLY = {
  1: [
    { start: '11:15', end: '12:45', course: 'Preparación CFA Research Challenge', name: 'Finance Club UdeC', email: FC },
    { start: '13:15', end: '14:45', course: 'Análisis de Inversiones 2', ...CSM },
    { start: '15:15', end: '16:45', course: 'Certificaciones Bloomberg', name: 'Agustín Torres', email: 'agtorres2022@udec.cl' },
    { start: '18:15', end: '19:45', course: 'Análisis de Inversiones 1', ...CSM },
  ],
  2: [
    { start: '13:15', end: '14:45', course: 'Análisis de Inversiones 2', ...CSM },
    { start: '18:15', end: '19:45', course: 'Análisis de Inversiones 1', ...CSM },
  ],
  3: [
    { start: '10:15', end: '11:45', course: 'Certificación Bloomberg', name: 'Bastián Bizama', email: 'bbizama2023@udec.cl' },
    { start: '12:15', end: '13:45', course: 'Certificación Bloomberg · Finance Club UdeC', name: 'Benjamín Pérez', email: 'benjamiperez2023@udec.cl' },
    { start: '14:15', end: '15:45', course: 'Certificación Bloomberg', ...CSM },
  ],
  4: [
    { start: '10:15', end: '11:45', course: 'Certificación Bloomberg', name: 'Bastián Bizama', email: 'bbizama2023@udec.cl' },
    { start: '14:15', end: '15:45', course: 'Certificación Bloomberg · Finance Club UdeC', name: 'Javiera Espinoza', email: 'javieespinoza2023@udec.cl' },
  ],
  5: [
    { start: '13:15', end: '14:45', course: 'Preparación CFA Research Challenge', ...CSM },
  ],
};

const pad = (n) => String(n).padStart(2, '0');
// Fechas en UTC para evitar desfases por horario de verano.
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
function makeCode() {
  const ab = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => ab[Math.floor(Math.random() * ab.length)]).join('');
}

/** Devuelve el arreglo de reservas fijas del semestre. */
export function buildSchedule() {
  const reservations = [];
  const now = new Date().toISOString();
  const d = new Date(`${RANGE_START}T00:00:00Z`);
  const last = new Date(`${RANGE_END}T00:00:00Z`);

  while (d <= last) {
    const blocks = WEEKLY[d.getUTCDay()];
    if (blocks) {
      for (const b of blocks) {
        reservations.push({
          id: randomUUID(),
          code: makeCode(),
          name: b.name,
          email: b.email,
          course: b.course,
          purpose: '',
          notes: '',
          date: ymd(d),
          start: b.start,
          end: b.end,
          status: 'approved',
          createdAt: now,
          decidedAt: now,
          decisionNote: 'Horario académico del semestre',
        });
      }
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return reservations;
}

export const SCHEDULE_RANGE = { start: RANGE_START, end: RANGE_END };

// Ejecución como script: reemplaza el archivo de datos.
if (import.meta.url === `file://${process.argv[1]}`) {
  const reservations = buildSchedule();
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify({ reservations }, null, 2), 'utf8');
  const weeks = new Set(reservations.map((r) => r.date.slice(0, 7)));
  console.log('Reservas anteriores eliminadas.');
  console.log(`Creadas ${reservations.length} reservas fijas del ${RANGE_START} al ${RANGE_END}.`);
  console.log(`Meses cubiertos: ${[...weeks].join(', ')}`);
}
