/* Lab Finanzas Itaú UdeC — cliente de reservas */

const state = {
  view: 'week',
  anchor: startOfDay(new Date()),
  config: null,
  reservations: [],
  stats: null,
  filter: '',
  range: { from: null, to: null },
  admin: {
    token: localStorage.getItem('bfl_admin_token') || null,
    open: false,
    tab: 'pending',
    list: [],
  },
};

const STATUS_LABEL = { approved: 'Aprobada', pending: 'Pendiente', rejected: 'Rechazada' };

const PALETTE = [
  '#ff8a1e', '#3d7dff', '#37c98b', '#c77dff', '#ffce4d',
  '#4dd0e1', '#ff6b9d', '#9ccc65', '#ff7043', '#7986cb',
];

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DOW_SHORT = ['dom','lun','mar','mié','jue','vie','sáb'];

/* ---------------------------------------------------------------- date utils */
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function ymd(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function mondayOf(d) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 dom
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(x, diff);
}
function toMin(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
function minToHHMM(m) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
function sameYMD(a, b) { return ymd(a) === ymd(b); }
function isToday(d) { return sameYMD(d, new Date()); }

/* ---------------------------------------------------------------- colors */
function courseColor(course) {
  const list = state.config?.courses || [];
  const i = list.indexOf(course);
  if (i >= 0) return PALETTE[i % PALETTE.length];
  let h = 0;
  for (const c of course || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/* ---------------------------------------------------------------- api */
async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error('request failed'), { data, status: res.status });
  return data;
}

async function loadConfig() {
  state.config = await api('/api/config');
}

/* ---------------------------------------------------------------- admin api */
async function adminApi(path, opts = {}) {
  try {
    return await api(path, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${state.admin.token}` },
    });
  } catch (err) {
    if (err.status === 401) {
      setAdminToken(null);
      state.admin.open = false;
      render();
      toast('Sesión de administrador expirada', 'error');
    }
    throw err;
  }
}

function setAdminToken(token) {
  state.admin.token = token;
  if (token) localStorage.setItem('bfl_admin_token', token);
  else localStorage.removeItem('bfl_admin_token');
  const btn = document.getElementById('adminBtn');
  const label = document.getElementById('adminBtnLabel');
  btn.classList.toggle('is-auth', Boolean(token));
  label.textContent = token ? 'Panel de administración' : 'Acceso administrador';
  document.getElementById('adminIconBtn').classList.toggle('is-auth', Boolean(token));
}

function computeRange() {
  if (state.view === 'week') {
    const from = mondayOf(state.anchor);
    return { from: ymd(from), to: ymd(addDays(from, 6)) };
  }
  if (state.view === 'month') {
    const y = state.anchor.getFullYear();
    const m = state.anchor.getMonth();
    return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) };
  }
  const y = state.anchor.getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

async function refresh() {
  state.range = computeRange();
  const q = `from=${state.range.from}&to=${state.range.to}`;
  const [list, stats] = await Promise.all([
    api(`/api/reservations?${q}`),
    api(`/api/stats?${q}`),
  ]);
  state.reservations = list;
  state.stats = stats;
  render();
}

/* ---------------------------------------------------------------- filter */
function visibleReservations() {
  const f = state.filter.trim().toLowerCase();
  if (!f) return state.reservations;
  return state.reservations.filter((r) =>
    [r.name, r.course, r.purpose, r.notes].filter(Boolean).join(' ').toLowerCase().includes(f)
  );
}
function matchesFilter(r) {
  const f = state.filter.trim().toLowerCase();
  if (!f) return true;
  return [r.name, r.course, r.purpose, r.notes].filter(Boolean).join(' ').toLowerCase().includes(f);
}

/* ---------------------------------------------------------------- render root */
function render() {
  renderSidebar();
  renderTopbar();
  const root = document.getElementById('viewRoot');
  root.innerHTML = '';
  document.getElementById('viewSwitch').style.visibility = state.admin.open ? 'hidden' : 'visible';
  if (state.admin.open) return renderAdmin(root);
  if (state.view === 'week') renderWeek(root);
  else if (state.view === 'month') renderMonth(root);
  else renderYear(root);
}

function renderSidebar() {
  const c = state.config;
  document.getElementById('brandInstitution').textContent = c.institution || 'Sistema de Reservas';

  const openDaysLabel = c.openDays.map((d) => DOW_SHORT[d]).join(' · ');
  document.getElementById('labFacts').innerHTML = `
    <li><span>Terminales</span><span>${c.terminals}</span></li>
    <li><span>Horario</span><span>${c.openHour}–${c.closeHour}</span></li>
    <li><span>Días</span><span>${openDaysLabel}</span></li>
    <li><span>Máx. por reserva</span><span>${c.maxHoursPerReservation} h</span></li>
  `;

  const s = state.stats || {};
  const occ = s.occupancy == null ? 0 : s.occupancy;
  document.getElementById('occupancyBar').style.width = `${Math.min(100, occ)}%`;
  document.getElementById('occupancyValue').textContent = s.occupancy == null ? '—' : `${occ}%`;
  document.getElementById('occupancyHours').textContent = s.hoursReserved ? `${s.hoursReserved} h reservadas` : '';

  const byCourse = (s.byCourse && Object.entries(s.byCourse)) || [];
  byCourse.sort((a, b) => b[1] - a[1]);
  document.getElementById('courseLegend').innerHTML = byCourse.length
    ? byCourse.map(([name, hrs]) => `
        <li>
          <span class="swatch" style="background:${courseColor(name)}"></span>
          <span>${escapeHtml(name)}</span>
          <span class="count">${Math.round(hrs * 10) / 10} h</span>
        </li>`).join('')
    : '<li class="muted">Sin reservas en el periodo</li>';
}

function renderTopbar() {
  const t = document.getElementById('periodTitle');
  const a = state.anchor;
  const navButtons = ['prevBtn', 'nextBtn', 'todayBtn'].map((id) => document.getElementById(id));
  navButtons.forEach((b) => (b.style.display = state.admin.open ? 'none' : ''));

  t.style.textTransform = state.admin.open ? 'none' : '';
  if (state.admin.open) {
    t.textContent = 'Panel de administración';
    document.getElementById('statPills').innerHTML = '';
    return;
  }

  if (state.view === 'week') {
    const mon = mondayOf(a);
    const sat = addDays(mon, 5);
    const sameMonth = mon.getMonth() === sat.getMonth();
    t.textContent = sameMonth
      ? `${mon.getDate()} – ${sat.getDate()} ${MESES[mon.getMonth()]} ${mon.getFullYear()}`
      : `${mon.getDate()} ${MESES[mon.getMonth()].slice(0, 3)} – ${sat.getDate()} ${MESES[sat.getMonth()].slice(0, 3)} ${sat.getFullYear()}`;
  } else if (state.view === 'month') {
    t.textContent = `${MESES[a.getMonth()]} ${a.getFullYear()}`;
  } else {
    t.textContent = `${a.getFullYear()}`;
  }

  const s = state.stats || {};
  const pendingPill = s.pending
    ? `<span class="pill is-pending"><strong>${s.pending}</strong> por aprobar</span>`
    : '';
  document.getElementById('statPills').innerHTML = `
    <span class="pill"><strong>${s.count ?? 0}</strong> reservas</span>
    <span class="pill"><strong>${s.hoursReserved ?? 0}</strong> horas</span>
    <span class="pill"><strong>${s.occupancy == null ? '—' : s.occupancy + '%'}</strong> ocupación</span>
    ${pendingPill}
  `;
}

/* ---------------------------------------------------------------- week view */
function renderWeek(root) {
  const c = state.config;
  const openMin = toMin(c.openHour);
  const closeMin = toMin(c.closeHour);
  const hours = [];
  for (let m = openMin; m < closeMin; m += 60) hours.push(m);
  const pxPerMin = 52 / 60;

  const mon = mondayOf(state.anchor);
  const days = c.openDays.map((dow) => {
    // dow: 1..6 -> offset from Monday
    const offset = dow === 0 ? 6 : dow - 1;
    return addDays(mon, offset);
  });

  const wrap = document.createElement('div');
  wrap.className = 'week-scroll';
  wrap.style.overflowX = 'auto';

  const grid = document.createElement('div');
  grid.className = 'week-grid';
  grid.style.setProperty('--cols', days.length);

  grid.appendChild(el('div', 'wg-corner', ''));
  for (const d of days) {
    const head = el('div', 'wg-dayhead' + (isToday(d) ? ' is-today' : ''));
    head.innerHTML = `<div class="dow">${DOW_SHORT[d.getDay()]}</div><div class="dom">${d.getDate()}</div>`;
    grid.appendChild(head);
  }

  // time column
  const timecol = el('div', 'wg-timecol');
  for (const m of hours) {
    timecol.appendChild(el('div', 'wg-time', minToHHMM(m)));
  }
  grid.appendChild(timecol);

  // day columns
  for (const d of days) {
    const col = el('div', 'wg-col');
    for (const m of hours) {
      const slot = el('div', 'wg-slot');
      slot.dataset.min = m;
      slot.addEventListener('click', () => openReserve({ date: ymd(d), start: minToHHMM(m) }));
      col.appendChild(slot);
    }
    const dayRes = state.reservations.filter((r) => r.date === ymd(d));
    for (const r of dayRes) {
      const s = toMin(r.start);
      const e = toMin(r.end);
      const pending = r.status === 'pending';
      const ev = el('div', 'wg-event'
        + (matchesFilter(r) ? '' : ' is-dim')
        + (pending ? ' is-pending' : ''));
      ev.style.setProperty('--ev', courseColor(r.course));
      ev.style.top = `${(s - openMin) * pxPerMin}px`;
      ev.style.height = `${Math.max(22, (e - s) * pxPerMin - 3)}px`;
      ev.innerHTML = `
        <div class="ev-time">${r.start}–${r.end}</div>
        <div class="ev-title">${escapeHtml(r.course)}</div>
        <div class="ev-name">${escapeHtml(r.name)}</div>
        ${pending ? '<span class="ev-badge">Pendiente</span>' : ''}`;
      ev.addEventListener('click', (e2) => { e2.stopPropagation(); openDetail(r); });
      col.appendChild(ev);
    }
    grid.appendChild(col);
  }

  wrap.appendChild(grid);
  root.appendChild(wrap);
}

/* ---------------------------------------------------------------- month view */
function renderMonth(root) {
  const c = state.config;
  const y = state.anchor.getFullYear();
  const m = state.anchor.getMonth();
  const first = new Date(y, m, 1);
  const gridStart = mondayOf(first);

  const grid = el('div', 'month-grid');
  for (let i = 1; i <= 7; i++) {
    grid.appendChild(el('div', 'mg-dow', DOW_SHORT[i % 7]));
  }

  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const inMonth = d.getMonth() === m;
    const closed = !c.openDays.includes(d.getDay());
    const cell = el('div', 'mg-day'
      + (inMonth ? '' : ' is-out')
      + (closed ? ' is-closed' : '')
      + (isToday(d) ? ' is-today' : ''));

    cell.appendChild(el('div', 'mg-daynum', String(d.getDate())));

    const dayRes = state.reservations
      .filter((r) => r.date === ymd(d))
      .sort((a, b) => a.start.localeCompare(b.start));

    dayRes.slice(0, 3).forEach((r) => {
      const chip = el('div', 'mg-chip'
        + (matchesFilter(r) ? '' : ' is-dim')
        + (r.status === 'pending' ? ' is-pending' : ''), `${r.start} ${r.course}`);
      chip.style.setProperty('--ev', courseColor(r.course));
      chip.addEventListener('click', (e) => { e.stopPropagation(); openDetail(r); });
      cell.appendChild(chip);
    });
    if (dayRes.length > 3) cell.appendChild(el('div', 'mg-more', `+${dayRes.length - 3} más`));

    if (!closed && inMonth) {
      cell.addEventListener('click', () => {
        state.view = 'week';
        state.anchor = startOfDay(d);
        syncNav();
        refresh();
      });
    }
    grid.appendChild(cell);
  }
  root.appendChild(grid);

  // lista del día seleccionado / hoy
  renderDayList(root);
}

function renderDayList(root) {
  // Próximas reservas visibles (respeta el filtro de búsqueda)
  const today = ymd(new Date());
  const upcoming = visibleReservations()
    .filter((r) => r.date >= today)
    .slice(0, 8);
  if (!upcoming.length) return;
  const box = el('div', 'day-list');
  box.appendChild(el('h3', '', 'Próximas reservas'));
  upcoming.forEach((r) => {
    const item = el('div', 'dl-item');
    item.style.setProperty('--ev', courseColor(r.course));
    item.innerHTML = `
      <span class="dl-time">${fmtShortDate(r.date)} · ${r.start}</span>
      <span class="dl-title">${escapeHtml(r.course)}</span>
      <span class="dl-meta">${escapeHtml(r.name)}</span>`;
    item.addEventListener('click', () => openDetail(r));
    box.appendChild(item);
  });
  root.appendChild(box);
}

/* ---------------------------------------------------------------- year view */
function renderYear(root) {
  const c = state.config;
  const y = state.anchor.getFullYear();
  const openMinutesPerDay = toMin(c.closeHour) - toMin(c.openHour);

  const byDate = {};
  for (const r of state.reservations) {
    if (!matchesFilter(r) || r.status === 'pending') continue;
    byDate[r.date] = (byDate[r.date] || 0) + (toMin(r.end) - toMin(r.start));
  }

  const grid = el('div', 'year-grid');
  for (let m = 0; m < 12; m++) {
    const month = el('div', 'yg-month');
    month.appendChild(el('h3', '', MESES[m]));
    const cells = el('div', 'yg-cells');
    const first = new Date(y, m, 1);
    const start = mondayOf(first);
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      if (d.getMonth() !== m) {
        cells.appendChild(el('div', 'yg-cell is-out'));
        continue;
      }
      const mins = byDate[ymd(d)] || 0;
      const ratio = mins / openMinutesPerDay;
      let lvl = 0;
      if (ratio > 0) lvl = 1;
      if (ratio >= 0.25) lvl = 2;
      if (ratio >= 0.5) lvl = 3;
      if (ratio >= 0.75) lvl = 4;
      const cell = el('div', `yg-cell heat-${lvl}` + (isToday(d) ? ' is-today' : ''));
      cell.title = `${fmtShortDate(ymd(d))} — ${Math.round((mins / 60) * 10) / 10} h reservadas`;
      cell.addEventListener('click', () => {
        state.view = 'week';
        state.anchor = startOfDay(d);
        syncNav();
        refresh();
      });
      cells.appendChild(cell);
    }
    month.appendChild(cells);
    grid.appendChild(month);
  }
  root.appendChild(grid);

  const legend = el('div', 'yg-legend');
  legend.innerHTML = `menos <span class="scale">
    <i class="heat-0"></i><i class="heat-1"></i><i class="heat-2"></i><i class="heat-3"></i><i class="heat-4"></i>
  </span> más ocupación`;
  root.appendChild(legend);
}

/* ---------------------------------------------------------------- reserve modal */
function fillTimeOptions() {
  const c = state.config;
  const open = toMin(c.openHour);
  const close = toMin(c.closeHour);
  const startSel = document.getElementById('startSelect');
  const endSel = document.getElementById('endSelect');
  startSel.innerHTML = '';
  for (let m = open; m < close; m += 30) {
    startSel.appendChild(new Option(minToHHMM(m), minToHHMM(m)));
  }
  updateEndOptions();
  startSel.onchange = updateEndOptions;
}
function updateEndOptions() {
  const c = state.config;
  const close = toMin(c.closeHour);
  const startSel = document.getElementById('startSelect');
  const endSel = document.getElementById('endSelect');
  const s = toMin(startSel.value);
  const maxEnd = Math.min(close, s + c.maxHoursPerReservation * 60);
  const prev = endSel.value;
  endSel.innerHTML = '';
  for (let m = s + 30; m <= maxEnd; m += 30) {
    endSel.appendChild(new Option(minToHHMM(m), minToHHMM(m)));
  }
  if ([...endSel.options].some((o) => o.value === prev)) endSel.value = prev;
}

function openReserve(prefill = {}) {
  const form = document.getElementById('reserveForm');
  form.reset();
  const courseSel = document.getElementById('courseSelect');
  courseSel.innerHTML = state.config.courses.map((c) => `<option>${escapeHtml(c)}</option>`).join('');
  fillTimeOptions();

  const dateInput = form.elements.date;
  dateInput.min = ymd(new Date());
  dateInput.value = prefill.date || ymd(state.anchor > new Date() ? state.anchor : new Date());
  if (prefill.start) {
    form.elements.start.value = prefill.start;
    updateEndOptions();
  }
  document.getElementById('reserveMsg').hidden = true;
  showModal('reserveModal');
  form.elements.name.focus();
}

async function submitReserve(e) {
  e.preventDefault();
  const form = e.target;
  const btn = document.getElementById('submitReserve');
  const msg = document.getElementById('reserveMsg');
  const payload = Object.fromEntries(new FormData(form).entries());
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  try {
    const res = await api('/api/reservations', { method: 'POST', body: JSON.stringify(payload) });
    hideModal('reserveModal');
    const pending = res.status === 'pending';
    document.getElementById('successTitle').textContent = pending ? 'Solicitud enviada' : 'Reserva confirmada';
    document.getElementById('successMsg').textContent = pending
      ? 'Tu reserva quedó pendiente de aprobación por un administrador. Guarda este código para consultar su estado o cancelarla.'
      : 'Guarda este código para cancelar tu reserva.';
    document.getElementById('successCode').textContent = res.code;
    showModal('successModal');
    toast(pending ? 'Solicitud enviada, pendiente de aprobación' : 'Reserva confirmada', 'success');
    await refresh();
  } catch (err) {
    const errors = err.data?.errors || ['No se pudo crear la reserva.'];
    msg.innerHTML = `<ul>${errors.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;
    msg.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmar reserva';
  }
}

/* ---------------------------------------------------------------- detail modal */
function openDetail(r) {
  const body = document.getElementById('detailBody');
  const dur = (toMin(r.end) - toMin(r.start)) / 60;
  const status = r.status || 'approved';
  body.innerHTML = `
    <div class="detail-row"><span>Estado</span><span><span class="admin-status st-${status}">${STATUS_LABEL[status]}</span></span></div>
    <div class="detail-row"><span>Curso / Motivo</span><span>${escapeHtml(r.course)}</span></div>
    ${r.purpose ? `<div class="detail-row"><span>Detalle</span><span>${escapeHtml(r.purpose)}</span></div>` : ''}
    <div class="detail-row"><span>Responsable</span><span>${escapeHtml(r.name)}</span></div>
    <div class="detail-row"><span>Fecha</span><span>${fmtLongDate(r.date)}</span></div>
    <div class="detail-row"><span>Horario</span><span>${r.start} – ${r.end} (${dur} h)</span></div>
    ${r.notes ? `<div class="detail-row"><span>Notas</span><span>${escapeHtml(r.notes)}</span></div>` : ''}
    <p class="muted" style="margin-top:14px">¿Cancelar esta reserva? Ingresa el código entregado al reservar.</p>
    <div class="cancel-box">
      <input id="cancelCode" maxlength="6" placeholder="CÓDIGO" />
      <button class="btn btn-primary" id="cancelBtn">Cancelar reserva</button>
    </div>
    <div class="form-msg" id="cancelMsg" hidden></div>
  `;
  document.getElementById('cancelBtn').addEventListener('click', () => cancelReservation(r.id));
  showModal('detailModal');
}

async function cancelReservation(id) {
  const code = document.getElementById('cancelCode').value.trim().toUpperCase();
  const msg = document.getElementById('cancelMsg');
  if (code.length !== 6) {
    msg.textContent = 'Ingresa el código de 6 caracteres.';
    msg.hidden = false;
    return;
  }
  try {
    await api(`/api/reservations/${id}/cancel`, { method: 'POST', body: JSON.stringify({ code }) });
    hideModal('detailModal');
    toast('Reserva cancelada', 'success');
    await refresh();
  } catch (err) {
    msg.textContent = (err.data?.errors || ['No se pudo cancelar.'])[0];
    msg.hidden = false;
  }
}

/* ---------------------------------------------------------------- modal helpers */
function showModal(id) { document.getElementById(id).hidden = false; }
function hideModal(id) { document.getElementById(id).hidden = true; }
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-close]') || e.target.classList.contains('modal-backdrop')) {
    const bd = e.target.closest('.modal-backdrop');
    if (bd) bd.hidden = true;
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop').forEach((m) => (m.hidden = true));
});

/* ---------------------------------------------------------------- toast */
function toast(text, kind = '') {
  const stack = document.getElementById('toastStack');
  const t = el('div', 'toast' + (kind ? ` is-${kind}` : ''), text);
  stack.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => t.remove(), 3000);
}

/* ---------------------------------------------------------------- helpers */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtShortDate(ymdStr) {
  const [y, m, d] = ymdStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DOW_SHORT[dt.getDay()]} ${d} ${MESES[m - 1].slice(0, 3)}`;
}
function fmtLongDate(ymdStr) {
  const [y, m, d] = ymdStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DOW_SHORT[dt.getDay()]}. ${d} de ${MESES[m - 1]} de ${y}`;
}

/* ---------------------------------------------------------------- admin */
function openAdmin() {
  if (!state.admin.token) {
    document.getElementById('loginMsg').hidden = true;
    document.getElementById('loginForm').reset();
    showModal('loginModal');
    setTimeout(() => document.querySelector('#loginForm [name=password]').focus(), 50);
    return;
  }
  state.admin.open = true;
  render();
  loadAdminList();
}

function closeAdmin() {
  state.admin.open = false;
  render();
}

async function loginSubmit(e) {
  e.preventDefault();
  const msg = document.getElementById('loginMsg');
  const password = new FormData(e.target).get('password');
  try {
    const { token } = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
    setAdminToken(token);
    hideModal('loginModal');
    toast('Sesión de administrador iniciada', 'success');
    openAdmin();
  } catch (err) {
    msg.textContent = (err.data?.errors || ['No se pudo iniciar sesión.'])[0];
    msg.hidden = false;
  }
}

async function adminLogout() {
  try { await adminApi('/api/admin/logout', { method: 'POST' }); } catch { /* ignore */ }
  setAdminToken(null);
  closeAdmin();
  toast('Sesión cerrada');
}

async function loadAdminList() {
  try {
    state.admin.list = await adminApi('/api/admin/reservations');
    render();
  } catch (err) {
    console.error(err);
  }
}

async function adminAct(id, action, note) {
  const verb = { approve: 'aprobar', reject: 'rechazar', delete: 'eliminar' }[action];
  if (action === 'delete' && !confirm('¿Eliminar esta reserva de forma permanente?')) return;
  try {
    if (action === 'delete') {
      await adminApi(`/api/admin/reservations/${id}`, { method: 'DELETE' });
    } else {
      await adminApi(`/api/admin/reservations/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ note: note || '' }),
      });
    }
    toast(`Reserva ${action === 'approve' ? 'aprobada' : action === 'reject' ? 'rechazada' : 'eliminada'}`, 'success');
    await Promise.all([loadAdminList(), refresh()]);
  } catch (err) {
    toast((err.data?.errors || [`No se pudo ${verb} la reserva.`])[0], 'error');
  }
}

function renderAdmin(root) {
  const list = state.admin.list;
  const counts = {
    pending: list.filter((r) => r.status === 'pending').length,
    approved: list.filter((r) => (r.status || 'approved') === 'approved').length,
    all: list.length,
  };
  const tab = state.admin.tab;
  const shown = list
    .filter((r) => (tab === 'all' ? true : (r.status || 'approved') === tab))
    .filter(matchesFilter);

  const wrap = el('div', 'admin');

  const head = el('div', 'admin-head');
  head.innerHTML = `
    <div>
      <h2>Reservas del laboratorio</h2>
      <span class="muted">Aprueba, rechaza o elimina solicitudes. Los cambios se reflejan de inmediato en el calendario.</span>
    </div>
    <div class="admin-tabs">
      <button class="admin-tab ${tab === 'pending' ? 'is-active' : ''}" data-tab="pending">
        Pendientes${counts.pending ? `<span class="n">${counts.pending}</span>` : ''}
      </button>
      <button class="admin-tab ${tab === 'approved' ? 'is-active' : ''}" data-tab="approved">Aprobadas</button>
      <button class="admin-tab ${tab === 'all' ? 'is-active' : ''}" data-tab="all">Todas</button>
    </div>`;
  head.querySelectorAll('.admin-tab').forEach((b) =>
    b.addEventListener('click', () => { state.admin.tab = b.dataset.tab; render(); }));
  wrap.appendChild(head);

  const bar = el('div', 'admin-head');
  bar.style.marginTop = '-6px';
  const backBtn = el('button', 'btn btn-ghost', '‹ Volver al calendario');
  backBtn.addEventListener('click', closeAdmin);
  const outBtn = el('button', 'btn btn-no', 'Cerrar sesión');
  outBtn.addEventListener('click', adminLogout);
  bar.appendChild(backBtn);
  bar.appendChild(outBtn);
  wrap.appendChild(bar);

  if (!shown.length) {
    wrap.appendChild(el('div', 'empty-state', tab === 'pending'
      ? 'No hay solicitudes pendientes. Todo al día.'
      : 'Sin reservas en esta vista.'));
    root.appendChild(wrap);
    return;
  }

  const table = el('div', 'admin-table');
  for (const r of shown) {
    const status = r.status || 'approved';
    const dur = (toMin(r.end) - toMin(r.start)) / 60;
    const row = el('div', 'admin-row' + (status === 'pending' ? ' is-pending' : ''));
    row.style.setProperty('--ev', courseColor(r.course));
    row.innerHTML = `
      <div class="admin-when">${fmtShortDate(r.date)}<small>${r.start}–${r.end} · ${dur} h</small></div>
      <div class="admin-what">
        <div class="who">${escapeHtml(r.course)}</div>
        <div class="sub">${escapeHtml(r.name)} · <a href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a>${r.purpose ? ' · ' + escapeHtml(r.purpose) : ''}</div>
      </div>
      <div><span class="admin-status st-${status}">${STATUS_LABEL[status]}</span></div>
      <div class="admin-actions"></div>
      ${r.notes ? `<div class="admin-note">Nota: ${escapeHtml(r.notes)}</div>` : ''}
      ${r.decisionNote ? `<div class="admin-note">Decisión: ${escapeHtml(r.decisionNote)}</div>` : ''}
    `;
    const actions = row.querySelector('.admin-actions');
    if (status === 'pending') {
      const ok = el('button', 'btn btn-ok', 'Aprobar');
      ok.addEventListener('click', () => adminAct(r.id, 'approve'));
      const no = el('button', 'btn btn-no', 'Rechazar');
      no.addEventListener('click', () => {
        const note = prompt('Motivo del rechazo (opcional):', '');
        if (note !== null) adminAct(r.id, 'reject', note);
      });
      actions.append(ok, no);
    }
    const del = el('button', 'btn btn-no', 'Eliminar');
    del.addEventListener('click', () => adminAct(r.id, 'delete'));
    actions.appendChild(del);
    table.appendChild(row);
  }
  wrap.appendChild(table);
  root.appendChild(wrap);
}

/* ---------------------------------------------------------------- navigation */
function step(dir) {
  if (state.view === 'week') state.anchor = addDays(state.anchor, dir * 7);
  else if (state.view === 'month') state.anchor = new Date(state.anchor.getFullYear(), state.anchor.getMonth() + dir, 1);
  else state.anchor = new Date(state.anchor.getFullYear() + dir, 0, 1);
  refresh();
}
function syncNav() {
  document.querySelectorAll('#viewSwitch .seg').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.view === state.view));
}

/* ---------------------------------------------------------------- init */
function bindUI() {
  document.getElementById('openReserveBtn').addEventListener('click', () => openReserve());
  document.getElementById('prevBtn').addEventListener('click', () => step(-1));
  document.getElementById('nextBtn').addEventListener('click', () => step(1));
  document.getElementById('todayBtn').addEventListener('click', () => { state.anchor = startOfDay(new Date()); refresh(); });
  document.getElementById('reserveForm').addEventListener('submit', submitReserve);

  document.querySelectorAll('#viewSwitch .seg').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      state.admin.open = false;
      syncNav();
      refresh();
    });
  });

  document.getElementById('adminBtn').addEventListener('click', openAdmin);
  document.getElementById('adminIconBtn').addEventListener('click', openAdmin);
  document.getElementById('loginForm').addEventListener('submit', loginSubmit);

  let ft;
  document.getElementById('filterInput').addEventListener('input', (e) => {
    clearTimeout(ft);
    ft = setTimeout(() => { state.filter = e.target.value; render(); }, 150);
  });

  const clock = document.getElementById('clock');
  const tick = () => {
    clock.textContent = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  tick();
  setInterval(tick, 1000);
}

(async function init() {
  bindUI();
  setAdminToken(state.admin.token);
  try {
    await loadConfig();
    await refresh();
    if (state.admin.token) loadAdminList();
  } catch (err) {
    document.getElementById('viewRoot').innerHTML =
      '<div class="empty-state"><strong>No se pudo cargar el sistema</strong>Revisa que el servidor esté en ejecución.</div>';
    console.error(err);
  }
})();
