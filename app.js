'use strict';

/* ===================== Constants ===================== */

const LS_KEY = 'assembly-data-v1';
const GST_RATE = 9; // Singapore GST %

const CATS = {
  income: [
    'Retail sales',
    'Retainer income',
    'Consignment income',
    'Commission',
    'Other income',
  ],
  expense: [
    'Inventory / stock',
    'Rent',
    'Salaries & CPF',
    'Utilities',
    'Marketing & advertising',
    'Professional fees',
    'Transport & travel',
    'Shipping & courier',
    'Office supplies',
    'Software & subscriptions',
    'Bank charges',
    'Entertainment',
    'Other',
  ],
};

const GST_OPTS = [
  { id: 'none', label: 'No GST' },
  { id: 'incl', label: 'Incl. ' + GST_RATE + '% GST' },
  { id: 'zero', label: 'Zero-rated' },
];

const GST_LABEL = { none: 'No GST', incl: 'Incl. ' + GST_RATE + '% GST', zero: 'Zero-rated' };

/* ===================== State ===================== */

let state = load();
let view = { module: null, tab: null, ym: thisYM(), query: '' };
let persistStatus = 'unknown'; // 'persisted' | 'denied' | 'unsupported' | 'unknown'
let backupPromptShownThisSession = false;

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_KEY));
    if (d && d.version === 1 && Array.isArray(d.entries)) {
      d.settings = d.settings || {};
      d.invoices = Array.isArray(d.invoices) ? d.invoices : [];
      d.clients = Array.isArray(d.clients) ? d.clients : [];
      d.tasks = Array.isArray(d.tasks) ? d.tasks : [];
      d.reminders = Array.isArray(d.reminders) ? d.reminders : [];
      d.meetings = Array.isArray(d.meetings) ? d.meetings : [];
      return d;
    }
  } catch (err) { /* corrupt data — start fresh, backups are the safety net */ }
  return { version: 1, entries: [], invoices: [], clients: [], tasks: [], reminders: [], meetings: [], settings: {} };
}

function save() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function requestPersist() {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(function (g) { persistStatus = g ? 'persisted' : 'denied'; }).catch(function () {});
  } else {
    persistStatus = 'unsupported';
  }
}

function refreshPersistStatus(cb) {
  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then(function (p) { persistStatus = p ? 'persisted' : 'denied'; if (cb) cb(); }).catch(function () { if (cb) cb(); });
  } else {
    persistStatus = 'unsupported';
    if (cb) cb();
  }
}

function requestPersistNow() {
  if (!(navigator.storage && navigator.storage.persist)) { showSnack('Storage protection not available here'); return; }
  navigator.storage.persist().then(function (g) {
    persistStatus = g ? 'persisted' : 'denied';
    showSnack(g ? 'Storage protected on this device' : 'Browser declined — keep backing up to a file');
    if (view.tab === 'export') renderExport();
  }).catch(function () {});
}

/* ---- Backup freshness tracking ---- */

const BACKUP_FREQS = [
  { d: 0, label: 'Every change' },
  { d: 1, label: 'Daily' },
  { d: 7, label: 'Weekly' },
  { d: 30, label: 'Monthly' },
];

function hasUserData() {
  return state.entries.length > 0 || state.invoices.length > 0 ||
    state.clients.some(function (c) { return c.name && c.name.trim(); }) ||
    state.tasks.length > 0 ||
    state.meetings.length > 0 ||
    state.reminders.some(function (r) { return !r.builtin; });
}

// Cheap fingerprint of the meaningful data (ignores settings/metadata) so we
// know whether anything has actually changed since the last backup.
function dataFingerprint() {
  const s = JSON.stringify({ e: state.entries, i: state.invoices, c: state.clients, t: state.tasks, r: state.reminders, m: state.meetings });
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + '.' + s.length;
}

function backupDirty() { return dataFingerprint() !== (state.settings.backupFingerprint || ''); }

function daysSinceBackup() {
  const last = state.settings.lastBackup;
  if (!last) return Infinity;
  return Math.floor((Date.now() - new Date(last + 'T00:00:00').getTime()) / 86400000);
}

function backupIntervalDays() {
  return state.settings.backupIntervalDays != null ? state.settings.backupIntervalDays : 7;
}

function backupDue() {
  return hasUserData() && backupDirty() && daysSinceBackup() >= backupIntervalDays();
}

function markBackedUp() {
  state.settings.lastBackup = todayISO();
  state.settings.backupFingerprint = dataFingerprint();
}

/* ===================== Helpers ===================== */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function thisYM() { return todayISO().slice(0, 7); }

function shiftYM(ym, delta) {
  let parts = ym.split('-');
  let y = +parts[0], m = +parts[1] + delta;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return y + '-' + String(m).padStart(2, '0');
}

function fmtYM(ym) {
  const parts = ym.split('-');
  return new Date(+parts[0], +parts[1] - 1, 1).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });
}

function fmtDate(iso) {
  const p = iso.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtMoney(cents) {
  return 'S$' + (Math.abs(cents) / 100).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseAmount(s) {
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  if (isNaN(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function gstPortion(e) {
  return e.gst === 'incl' ? Math.round(e.amountCents * GST_RATE / (100 + GST_RATE)) : 0;
}

function sortNewestFirst(a, b) {
  return b.date.localeCompare(a.date) || b.createdAt - a.createdAt;
}

/* ===================== Snackbar ===================== */

const $snack = document.getElementById('snackbar');
let snackTimer = null;

function showSnack(msg, undoFn) {
  clearTimeout(snackTimer);
  $snack.innerHTML = '<span>' + esc(msg) + '</span>' + (undoFn ? '<button id="undoBtn">Undo</button>' : '');
  $snack.classList.remove('hidden');
  if (undoFn) {
    $snack.querySelector('#undoBtn').onclick = function () { hideSnack(); undoFn(); };
  }
  snackTimer = setTimeout(hideSnack, 4500);
}

function hideSnack() { $snack.classList.add('hidden'); }

/* ===================== Views ===================== */

const $view = document.getElementById('view');

/* ===================== Module shell ===================== */

const MODULES = {
  accountant: { label: 'Accounts', defaultTab: 'month', tabs: [['month', 'Month'], ['history', 'History'], ['invoice', 'Invoice'], ['export', 'Export']] },
  admin: { label: 'Admin', defaultTab: 'today', tabs: [['today', 'Today'], ['tasks', 'Tasks'], ['reminders', 'Reminders'], ['contacts', 'Contacts']] },
  pa: { label: 'Assistant', defaultTab: 'agenda', tabs: [['agenda', 'Agenda'], ['meetings', 'Meetings'], ['followups', 'Follow-ups']] },
};

const MODULE_CARDS = [
  { id: 'admin', title: 'Admin', desc: 'Client jobs, reminders, contacts', icon: '✓', available: true },
  { id: 'accountant', title: 'Accountant', desc: 'Income, expenses, invoices, P&L', icon: 'S$', available: true },
  { id: 'pa', title: 'Personal Assistant', desc: 'Agenda, meeting notes, follow-ups', icon: '◷', available: true },
  { id: 'researcher', title: 'Researcher', desc: 'Saved links & AI summaries', icon: '⌕', available: false },
];

function enterModule(id) {
  view.module = id;
  view.tab = MODULES[id].defaultTab;
  render();
}

function goHome() { view.module = null; view.tab = null; render(); }

function render() {
  const home = document.getElementById('homeBtn');
  const label = document.getElementById('moduleLabel');
  const tabbar = document.getElementById('tabbar');
  const fab = document.getElementById('fab');

  if (!view.module) {
    home.classList.add('hidden');
    label.textContent = '';
    tabbar.classList.add('hidden');
    fab.classList.add('hidden');
    renderLauncher();
    return;
  }

  const mod = MODULES[view.module];
  home.classList.remove('hidden');
  label.textContent = mod.label;
  tabbar.classList.remove('hidden');
  renderTabbar(mod);
  updateFab();

  if (view.module === 'accountant') {
    if (view.tab === 'month') renderMonth();
    else if (view.tab === 'history') renderHistory();
    else if (view.tab === 'invoice') renderInvoiceTab();
    else renderExport();
  } else if (view.module === 'admin') {
    if (view.tab === 'today') renderToday();
    else if (view.tab === 'tasks') renderTasksTab();
    else if (view.tab === 'reminders') renderRemindersTab();
    else renderContactsTab();
  } else if (view.module === 'pa') {
    if (view.tab === 'agenda') renderAgenda();
    else if (view.tab === 'meetings') renderMeetingsTab();
    else renderFollowupsTab();
  }
}

function renderTabbar(mod) {
  const bar = document.getElementById('tabbar');
  bar.innerHTML = mod.tabs.map(function (t) {
    return '<button class="tab' + (t[0] === view.tab ? ' active' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
  }).join('');
  bar.querySelectorAll('.tab').forEach(function (b) {
    b.onclick = function () { view.tab = b.dataset.tab; render(); };
  });
}

function updateFab() {
  const fab = document.getElementById('fab');
  let label = '', action = null;
  if (view.module === 'accountant') { label = 'Add entry'; action = function () { openSheet(); }; }
  else if (view.module === 'admin') {
    if (view.tab === 'reminders') { label = 'Add reminder'; action = function () { openReminderForm(null); }; }
    else if (view.tab === 'contacts') { label = 'Add contact'; action = function () { openClientForm(null, backToTab); }; }
    else { label = 'Add task'; action = function () { openTaskForm(null); }; }
  }
  else if (view.module === 'pa') { label = 'Add meeting'; action = function () { openMeetingForm(null); }; }
  if (action) {
    fab.classList.remove('hidden');
    fab.setAttribute('aria-label', label);
    fab.onclick = action;
  } else {
    fab.classList.add('hidden');
  }
}

// Re-render the current tab after a sheet closes (used as a "back" callback).
function backToTab() { closeSheet(); render(); }

function renderLauncher() {
  const html = '<div class="launcher">' +
    '<p class="launcher-intro">Your business assistant — choose a module</p>' +
    '<div class="module-grid">' +
    MODULE_CARDS.map(function (m) {
      return '<button class="module-card' + (m.available ? '' : ' soon') + '"' +
        (m.available ? ' data-mod="' + m.id + '"' : ' disabled') + '>' +
        '<span class="module-icon">' + esc(m.icon) + '</span>' +
        '<span class="module-title">' + esc(m.title) + '</span>' +
        '<span class="module-desc">' + esc(m.desc) + '</span>' +
        (m.available ? '' : '<span class="module-soon">Coming soon</span>') +
        '</button>';
    }).join('') +
    '</div></div>';
  $view.innerHTML = html;
  $view.querySelectorAll('.module-card[data-mod]').forEach(function (b) {
    b.onclick = function () { enterModule(b.dataset.mod); };
  });
}

/* ---------- Month (P&L) ---------- */

function monthEntries(ym) {
  return state.entries.filter(function (e) { return e.date.slice(0, 7) === ym; });
}

function breakdown(entries, keyFn) {
  const m = new Map();
  entries.forEach(function (e) {
    const k = keyFn(e) || '(unspecified)';
    m.set(k, (m.get(k) || 0) + e.amountCents);
  });
  return Array.from(m.entries()).sort(function (a, b) { return b[1] - a[1]; });
}

function barsHTML(pairs) {
  if (!pairs.length) return '';
  const max = pairs[0][1];
  return pairs.map(function (p) {
    const w = Math.max(4, Math.round(p[1] / max * 100));
    return '<div class="bar-row">' +
      '<div class="bar-top"><span>' + esc(p[0]) + '</span><span>' + fmtMoney(p[1]) + '</span></div>' +
      '<div class="bar"><i style="width:' + w + '%"></i></div></div>';
  }).join('');
}

function backupBannerHTML() {
  if (!hasUserData() || !backupDirty()) return '';
  const last = state.settings.lastBackup;
  const days = daysSinceBackup();
  const msg = last
    ? '💾 ' + days + ' day' + (days === 1 ? '' : 's') + ' since your last backup — tap to back up'
    : '💾 No backup yet — tap to protect your data';
  return '<button class="banner" id="goBackup">' + msg + '</button>';
}

function entryRowHTML(e) {
  const isIncome = e.type === 'income';
  const title = e.desc || e.category;
  const bits = [fmtDate(e.date)];
  if (e.client) bits.push(e.client);
  if (e.gst === 'incl') bits.push('GST');
  return '<button class="entry" data-id="' + e.id + '">' +
    '<span class="entry-main"><span class="entry-title">' + esc(title) + '</span>' +
    '<span class="entry-sub">' + esc(bits.join(' · ')) + '</span></span>' +
    '<span class="entry-amt ' + (isIncome ? 'green' : 'red') + '">' + (isIncome ? '+' : '−') + fmtMoney(e.amountCents) + '</span>' +
    '</button>';
}

function wireEntryRows(root) {
  root.querySelectorAll('.entry').forEach(function (btn) {
    btn.onclick = function () {
      const e = state.entries.find(function (x) { return x.id === btn.dataset.id; });
      if (e) openSheet(e);
    };
  });
}

function renderMonth() {
  const ym = view.ym;
  const es = monthEntries(ym).sort(sortNewestFirst);

  let inc = 0, exp = 0, gstOut = 0, gstIn = 0;
  es.forEach(function (e) {
    if (e.type === 'income') { inc += e.amountCents; gstOut += gstPortion(e); }
    else { exp += e.amountCents; gstIn += gstPortion(e); }
  });
  const net = inc - exp;

  const incomeByClient = breakdown(es.filter(function (e) { return e.type === 'income'; }), function (e) { return e.client; });
  const expenseByCat = breakdown(es.filter(function (e) { return e.type === 'expense'; }), function (e) { return e.category; });

  let html =
    '<div class="month-nav">' +
    '<button class="nav-btn" id="prevM" aria-label="Previous month">‹</button>' +
    '<h2>' + fmtYM(ym) + '</h2>' +
    '<button class="nav-btn" id="nextM" aria-label="Next month">›</button>' +
    '</div>' +
    backupBannerHTML() +
    '<div class="pnl">' +
    '<div class="pnl-row"><span>Income</span><span class="green">' + fmtMoney(inc) + '</span></div>' +
    '<div class="pnl-row"><span>Expenses</span><span class="red">' + fmtMoney(exp) + '</span></div>' +
    '<div class="pnl-row net"><span>Net</span><span class="' + (net >= 0 ? 'green' : 'red') + '">' + (net < 0 ? '−' : '') + fmtMoney(net) + '</span></div>' +
    (gstOut || gstIn ? '<div class="gst-note">GST collected ' + fmtMoney(gstOut) + ' · GST on purchases ' + fmtMoney(gstIn) + '</div>' : '') +
    '</div>';

  if (incomeByClient.length) {
    html += '<h3 class="sec">Income by client</h3>' + barsHTML(incomeByClient);
  }
  if (expenseByCat.length) {
    html += '<h3 class="sec">Expenses by category</h3>' + barsHTML(expenseByCat);
  }

  if (es.length) {
    html += '<h3 class="sec">Entries</h3>' + es.map(entryRowHTML).join('');
  } else {
    html += '<div class="empty">No entries for ' + fmtYM(ym) + ' yet.<br>Tap <b>+</b> to log income or an expense.</div>';
  }

  $view.innerHTML = html;

  document.getElementById('prevM').onclick = function () { view.ym = shiftYM(view.ym, -1); render(); };
  document.getElementById('nextM').onclick = function () { view.ym = shiftYM(view.ym, 1); render(); };
  const banner = document.getElementById('goBackup');
  if (banner) banner.onclick = function () { openBackupPrompt(false); };
  wireEntryRows($view);
}

/* ---------- History ---------- */

function renderHistory() {
  $view.innerHTML =
    '<label class="field"><span>Search</span>' +
    '<input id="histSearch" placeholder="Description, client or category…" value="' + esc(view.query) + '"></label>' +
    '<div id="histList"></div>';
  const input = document.getElementById('histSearch');
  input.oninput = function () { view.query = input.value; renderHistList(); };
  renderHistList();
}

function renderHistList() {
  const q = view.query.trim().toLowerCase();
  let es = state.entries.slice().sort(sortNewestFirst);
  if (q) {
    es = es.filter(function (e) {
      return (e.desc + ' ' + e.client + ' ' + e.category).toLowerCase().indexOf(q) !== -1;
    });
  }
  const $list = document.getElementById('histList');
  if (!es.length) {
    $list.innerHTML = '<div class="empty">' +
      (state.entries.length ? 'No matches.' : 'No entries yet.<br>Tap <b>+</b> to log your first income or expense.') +
      '</div>';
    return;
  }
  let html = '';
  let curYM = '';
  es.forEach(function (e) {
    const ym = e.date.slice(0, 7);
    if (ym !== curYM) { curYM = ym; html += '<h3 class="sec">' + fmtYM(ym) + '</h3>'; }
    html += entryRowHTML(e);
  });
  $list.innerHTML = html;
  wireEntryRows($list);
}

/* ---------- Export ---------- */

function renderExport() {
  const none = state.entries.length === 0;
  const noData = !hasUserData();
  if (persistStatus === 'unknown') refreshPersistStatus(function () { if (view.tab === 'export') renderExport(); });
  $view.innerHTML =
    '<div class="card"><h3>Excel export</h3>' +
    '<p>One spreadsheet with every entry plus a month-by-month P&amp;L summary. Opens in Excel or Google Sheets.</p>' +
    '<button id="xlsxBtn" class="btn"' + (none ? ' disabled' : '') + '>Download .xlsx</button></div>' +

    '<div class="card"><h3>CSV export</h3>' +
    '<p>A plain table of all entries — also opens in Excel.</p>' +
    '<button id="csvBtn" class="btn ghost"' + (none ? ' disabled' : '') + '>Download .csv</button></div>' +

    '<div class="card"><h3>Backup &amp; data safety</h3>' +
    backupStatusHTML() +
    '<button id="backupBtn" class="btn"' + (noData ? ' disabled' : '') + '>Download backup now</button>' +
    '<button id="restoreBtn" class="btn ghost">Restore from file</button>' +
    '<input type="file" id="restoreFile" accept="application/json,.json" hidden>' +
    '<div class="field" style="margin-top:16px"><span>Remind me to back up</span><div class="chips" id="freqChips"></div></div>' +
    '</div>' +

    '<p class="fineprint">Backups land in your Downloads folder — keep a copy in Google Drive or email it to yourself, so a lost or wiped phone can’t take your records with it.</p>';

  document.getElementById('xlsxBtn').onclick = exportXlsx;
  document.getElementById('csvBtn').onclick = exportCsv;
  document.getElementById('backupBtn').onclick = downloadBackup;
  const fileInput = document.getElementById('restoreFile');
  document.getElementById('restoreBtn').onclick = function () { fileInput.click(); };
  fileInput.onchange = function () { restoreBackup(fileInput.files[0]); fileInput.value = ''; };
  wireBackupControls($view);
}

function backupStatusHTML() {
  const last = state.settings.lastBackup;
  let dataMsg;
  if (!hasUserData()) dataMsg = 'No data to back up yet.';
  else if (!last) dataMsg = '<span class="warn">No backup yet — your data exists only on this device.</span>';
  else if (backupDirty()) dataMsg = '<b>Last backup:</b> ' + fmtDate(last) + ' · <span class="warn">new changes not backed up</span>';
  else dataMsg = '<b>Last backup:</b> ' + fmtDate(last) + ' · <span class="ok">up to date ✓</span>';

  let store;
  if (persistStatus === 'persisted') store = '<span class="ok">✓ Storage protected</span> — the browser won’t auto-clear your data.';
  else if (persistStatus === 'denied') store = '<span class="warn">⚠ Storage not protected.</span> <button class="linkbtn" id="protectBtn">Protect it</button>';
  else if (persistStatus === 'unsupported') store = 'Automatic storage protection isn’t available in this browser.';
  else store = 'Checking storage protection…';

  return '<p>' + dataMsg + '</p><p class="fineprint">' + store + '</p>';
}

function wireBackupControls(root) {
  const protect = root.querySelector('#protectBtn');
  if (protect) protect.onclick = requestPersistNow;
  const freq = root.querySelector('#freqChips');
  if (freq) {
    const cur = backupIntervalDays();
    freq.innerHTML = BACKUP_FREQS.map(function (f) {
      return '<button class="chip' + (f.d === cur ? ' on' : '') + '" data-d="' + f.d + '">' + f.label + '</button>';
    }).join('');
    freq.querySelectorAll('.chip').forEach(function (b) {
      b.onclick = function () {
        state.settings.backupIntervalDays = +b.dataset.d;
        save();
        freq.querySelectorAll('.chip').forEach(function (x) { x.classList.toggle('on', +x.dataset.d === +b.dataset.d); });
      };
    });
  }
}

// Automatic, attention-grabbing prompt shown on launch when a backup is overdue.
function openBackupPrompt(auto) {
  const last = state.settings.lastBackup;
  const days = daysSinceBackup();
  const since = !last ? 'never' : (days === 0 ? 'today' : days + ' day' + (days === 1 ? '' : 's') + ' ago');
  $sheet.innerHTML =
    '<div class="sheet-inner">' +
    '<div class="sheet-head"><button class="close-btn" id="closeSheet" aria-label="Close">✕</button><h2>Back up your data</h2></div>' +
    '<p>Everything in this app is stored only on this phone. A backup file is your safety net if the phone is lost or replaced, or the browser’s data gets cleared.</p>' +
    '<div class="card"><p><b>Last backup:</b> ' + since +
      (hasUserData() && backupDirty() ? ' · <span class="warn">changes not backed up</span>' : (last ? ' · <span class="ok">up to date ✓</span>' : '')) + '</p></div>' +
    '<button class="btn big" id="bkNow">Back up now</button>' +
    '<div class="field" style="margin-top:16px"><span>Remind me to back up</span><div class="chips" id="freqChips"></div></div>' +
    '<p class="fineprint" id="storeLine"></p>' +
    (auto ? '<button class="btn ghost big" id="bkLater">Not now</button>' : '') +
    '</div>';
  $sheet.classList.remove('hidden');
  $sheet.scrollTop = 0;
  const q = function (s) { return $sheet.querySelector(s); };
  q('#closeSheet').onclick = closeSheet;
  q('#bkNow').onclick = function () { downloadBackup(); closeSheet(); };
  const later = q('#bkLater'); if (later) later.onclick = closeSheet;
  q('#storeLine').innerHTML = persistStatus === 'persisted'
    ? '✓ Storage protected on this device.'
    : (persistStatus === 'denied' ? '⚠ <button class="linkbtn" id="protectBtn">Protect storage</button> so the browser can’t auto-clear it.' : '');
  wireBackupControls($sheet);
}

function maybePromptBackup() {
  if (backupPromptShownThisSession) return;
  if (!$sheet.classList.contains('hidden')) return;
  if (!backupDue()) return;
  backupPromptShownThisSession = true;
  openBackupPrompt(true);
}

function download(content, name, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
}

function csvQuote(s) {
  return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
}

function exportCsv() {
  const sorted = state.entries.slice().sort(function (a, b) { return a.date.localeCompare(b.date) || a.createdAt - b.createdAt; });
  const lines = ['Date,Type,Description,Client/Vendor,Category,GST,Amount (SGD),GST portion (SGD)'];
  sorted.forEach(function (e) {
    lines.push([
      e.date,
      e.type === 'income' ? 'Income' : 'Expense',
      csvQuote(e.desc),
      csvQuote(e.client),
      csvQuote(e.category),
      csvQuote(GST_LABEL[e.gst] || ''),
      (e.amountCents / 100).toFixed(2),
      (gstPortion(e) / 100).toFixed(2),
    ].join(','));
  });
  // '\ufeff' = UTF-8 BOM so Excel reads special characters correctly
  download('\ufeff' + lines.join('\r\n'), 'assembly-entries-' + todayISO() + '.csv', 'text/csv;charset=utf-8');
  showSnack('CSV downloaded');
}

function exportXlsx() {
  if (typeof XLSX === 'undefined') {
    showSnack('Excel library missing — use CSV instead');
    return;
  }
  const sorted = state.entries.slice().sort(function (a, b) { return a.date.localeCompare(b.date) || a.createdAt - b.createdAt; });

  const rows = sorted.map(function (e) {
    return {
      'Date': e.date,
      'Type': e.type === 'income' ? 'Income' : 'Expense',
      'Description': e.desc,
      'Client / Vendor': e.client,
      'Category': e.category,
      'GST': GST_LABEL[e.gst] || '',
      'Amount (SGD)': +(e.amountCents / 100).toFixed(2),
      'GST portion (SGD)': +(gstPortion(e) / 100).toFixed(2),
    };
  });

  const byMonth = {};
  sorted.forEach(function (e) {
    const ym = e.date.slice(0, 7);
    const m = byMonth[ym] || (byMonth[ym] = { inc: 0, exp: 0, gstOut: 0, gstIn: 0 });
    if (e.type === 'income') { m.inc += e.amountCents; m.gstOut += gstPortion(e); }
    else { m.exp += e.amountCents; m.gstIn += gstPortion(e); }
  });
  const summary = Object.keys(byMonth).sort().map(function (ym) {
    const m = byMonth[ym];
    return {
      'Month': fmtYM(ym),
      'Income (SGD)': +(m.inc / 100).toFixed(2),
      'Expenses (SGD)': +(m.exp / 100).toFixed(2),
      'Net (SGD)': +((m.inc - m.exp) / 100).toFixed(2),
      'GST collected (SGD)': +(m.gstOut / 100).toFixed(2),
      'GST on purchases (SGD)': +(m.gstIn / 100).toFixed(2),
    };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'All entries');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Monthly P&L');
  XLSX.writeFile(wb, 'assembly-accounts-' + todayISO() + '.xlsx');
  showSnack('Excel file downloaded');
}

function downloadBackup() {
  download(JSON.stringify(state, null, 1), 'assembly-backup-' + todayISO() + '.json', 'application/json');
  markBackedUp();
  save();
  if (view.tab === 'export') renderExport();
  showSnack('Backup downloaded — save a copy to Drive or email');
}

function restoreBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function () {
    let data = null;
    try { data = JSON.parse(reader.result); } catch (err) { /* handled below */ }
    if (!data || data.version !== 1 || !Array.isArray(data.entries)) {
      alert('That file is not a valid Assembly backup.');
      return;
    }
    const ok = confirm('Replace the ' + state.entries.length + ' entries on this device with the ' + data.entries.length + ' entries from the backup?');
    if (!ok) return;
    const prev = JSON.parse(JSON.stringify(state));
    data.settings = data.settings || {};
    data.invoices = Array.isArray(data.invoices) ? data.invoices : [];
    data.clients = Array.isArray(data.clients) ? data.clients : [];
    data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
    data.reminders = Array.isArray(data.reminders) ? data.reminders : [];
    data.meetings = Array.isArray(data.meetings) ? data.meetings : [];
    state = data;
    ensureClientsSeed();
    ensureRemindersSeed();
    markBackedUp();
    save();
    view.ym = thisYM();
    render();
    showSnack('Backup restored', function () {
      state = prev;
      save();
      view.ym = thisYM();
      render();
      showSnack('Restore undone');
    });
  };
  reader.readAsText(file);
}

/* ===================== Add / edit sheet ===================== */

const $sheet = document.getElementById('sheet');

function recentClients() {
  const seen = [];
  const sorted = state.entries.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
  for (let i = 0; i < sorted.length && seen.length < 6; i++) {
    const c = (sorted[i].client || '').trim();
    if (c && seen.indexOf(c) === -1) seen.push(c);
  }
  return seen;
}

function quickFills() {
  const map = new Map();
  state.entries.forEach(function (e) {
    const key = [e.type, e.desc, e.client, e.category, e.amountCents].join('|');
    const cur = map.get(key) || { entry: e, count: 0 };
    cur.count++;
    if (e.createdAt > cur.entry.createdAt) cur.entry = e;
    map.set(key, cur);
  });
  return Array.from(map.values())
    .filter(function (x) { return x.count >= 2; })
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, 3)
    .map(function (x) { return x.entry; });
}

function closeSheet() {
  $sheet.classList.add('hidden');
  $sheet.innerHTML = '';
}

function openSheet(existing, prefill) {
  const isEdit = !!existing;
  const base = existing || prefill || {};
  let type = base.type || 'expense';
  let gst = base.gst || 'none';
  let category = base.category || '';
  const date = isEdit ? existing.date : todayISO();
  const amountVal = base.amountCents != null ? (base.amountCents / 100).toFixed(2) : '';
  const fills = isEdit || prefill ? [] : quickFills();
  const clients = recentClients();

  $sheet.innerHTML =
    '<div class="sheet-inner">' +
    '<div class="sheet-head">' +
    '<button class="close-btn" id="closeSheet" aria-label="Close">✕</button>' +
    '<h2>' + (isEdit ? 'Edit entry' : 'New entry') + '</h2>' +
    (isEdit ? '<button class="danger-link" id="delEntry">Delete</button>' : '') +
    '</div>' +

    (fills.length
      ? '<div class="field"><span>Quick add (your regulars)</span><div class="chips" id="quickChips">' +
        fills.map(function (f, i) {
          return '<button class="chip quick" data-qi="' + i + '">' + esc(f.desc || f.category) + ' · ' + fmtMoney(f.amountCents) + '</button>';
        }).join('') + '</div></div>'
      : '') +

    '<div class="seg" id="typeSeg">' +
    '<button data-t="income"' + (type === 'income' ? ' class="on"' : '') + '>Income</button>' +
    '<button data-t="expense"' + (type === 'expense' ? ' class="on"' : '') + '>Expense</button>' +
    '</div>' +

    '<label class="field"><span>Amount</span>' +
    '<div class="amount-wrap"><span class="cur">S$</span>' +
    '<input id="fAmount" inputmode="decimal" placeholder="0.00" value="' + esc(amountVal) + '"></div></label>' +

    '<label class="field"><span>Date</span><input type="date" id="fDate" value="' + date + '"></label>' +

    '<label class="field"><span>Description (optional)</span>' +
    '<input id="fDesc" placeholder="e.g. Monthly retainer — June" value="' + esc(base.desc || '') + '"></label>' +

    '<label class="field"><span>Client / vendor</span>' +
    '<input id="fClient" placeholder="Who is this for / from?" value="' + esc(base.client || '') + '"></label>' +
    (clients.length ? '<div class="chips chips-margin" id="clientChips">' +
      clients.map(function (c) { return '<button class="chip" data-c="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') +
      '</div>' : '') +

    '<div class="field"><span>Category</span><div class="chips" id="catChips"></div></div>' +

    '<div class="field"><span>GST</span><div class="chips" id="gstChips"></div></div>' +

    '<button class="btn big" id="saveEntry">Save</button>' +
    (isEdit ? '<button class="btn ghost big" id="dupEntry">Duplicate as new entry</button>' : '') +
    '</div>';

  $sheet.classList.remove('hidden');
  $sheet.scrollTop = 0;

  const q = function (sel) { return $sheet.querySelector(sel); };

  function renderTypeSeg() {
    q('#typeSeg').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.t === type);
    });
  }

  function renderCatChips() {
    const cats = CATS[type];
    if (cats.indexOf(category) === -1) category = '';
    q('#catChips').innerHTML = cats.map(function (c) {
      return '<button class="chip' + (c === category ? ' on' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('');
    q('#catChips').querySelectorAll('.chip').forEach(function (b) {
      b.onclick = function () { category = b.dataset.cat; renderCatChips(); };
    });
  }

  function renderGstChips() {
    q('#gstChips').innerHTML = GST_OPTS.map(function (o) {
      return '<button class="chip' + (o.id === gst ? ' on' : '') + '" data-g="' + o.id + '">' + o.label + '</button>';
    }).join('');
    q('#gstChips').querySelectorAll('.chip').forEach(function (b) {
      b.onclick = function () { gst = b.dataset.g; renderGstChips(); };
    });
  }

  renderTypeSeg();
  renderCatChips();
  renderGstChips();

  q('#typeSeg').querySelectorAll('button').forEach(function (b) {
    b.onclick = function () { type = b.dataset.t; renderTypeSeg(); renderCatChips(); };
  });

  const clientChips = q('#clientChips');
  if (clientChips) {
    clientChips.querySelectorAll('.chip').forEach(function (b) {
      b.onclick = function () { q('#fClient').value = b.dataset.c; };
    });
  }

  const quickChips = q('#quickChips');
  if (quickChips) {
    const fillList = fills;
    quickChips.querySelectorAll('.chip').forEach(function (b) {
      b.onclick = function () { openSheet(null, fillList[+b.dataset.qi]); };
    });
  }

  q('#closeSheet').onclick = closeSheet;

  if (isEdit) {
    q('#delEntry').onclick = function () {
      state.entries = state.entries.filter(function (x) { return x.id !== existing.id; });
      save();
      closeSheet();
      render();
      showSnack('Entry deleted', function () {
        state.entries.push(existing);
        save();
        render();
      });
    };
    q('#dupEntry').onclick = function () { openSheet(null, existing); };
  }

  q('#saveEntry').onclick = function () {
    const amountCents = parseAmount(q('#fAmount').value);
    if (!amountCents) {
      q('#fAmount').focus();
      showSnack('Enter an amount first');
      return;
    }
    const entry = {
      id: isEdit ? existing.id : uid(),
      type: type,
      date: q('#fDate').value || todayISO(),
      desc: q('#fDesc').value.trim(),
      client: q('#fClient').value.trim(),
      category: category || (type === 'income' ? 'Other income' : 'Other'),
      gst: gst,
      amountCents: amountCents,
      createdAt: isEdit ? existing.createdAt : Date.now(),
    };
    if (isEdit) {
      const i = state.entries.findIndex(function (x) { return x.id === existing.id; });
      if (i !== -1) state.entries[i] = entry;
    } else {
      state.entries.push(entry);
    }
    save();
    requestPersist();
    closeSheet();
    if (!isEdit) {
      view.tab = 'month';
      view.ym = entry.date.slice(0, 7);
    }
    render();
    showSnack('Saved');
  };

  if (!isEdit && !prefill) q('#fAmount').focus();
}

/* ===================== Invoices ===================== */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// All company / payment details live ON-DEVICE (localStorage), never hardcoded
// in the public repo. The user fills them in once via the Company details form.
function getCompany() {
  const c = state.settings.company || {};
  return {
    name: c.name || '', uen: c.uen || '', addr1: c.addr1 || '', addr2: c.addr2 || '',
    bankName: c.bankName || '', bankAccName: c.bankAccName || '', bankAccNo: c.bankAccNo || '',
    paynow: c.paynow || '', noteText: c.noteText || '', noteClient: c.noteClient || '',
  };
}

function companyConfigured() {
  const c = getCompany();
  return !!(c.name && c.bankAccNo);
}

// Brand colours as ExcelJS ARGB (FF = fully opaque)
const C_GOLD = 'FFC9A227', C_INK = 'FF1A1A1A', C_GREY = 'FF666666';
const C_STRIPE = 'FFFAF7EF', C_BORDER = 'FFD9D9D9', C_WHITE = 'FFFFFFFF';
const NUMFMT = '#,##0.00;(#,##0.00);"-"';

// The related-party note is shown only when the bill-to client name contains
// the (user-configured) trigger text. Both the note and trigger live on-device.
function noteTriggered(company, clientName) {
  if (!company.noteText || !company.noteClient) return false;
  return (clientName || '').toUpperCase().indexOf(company.noteClient.toUpperCase()) !== -1;
}

function invYear(dateISO) { return dateISO.slice(0, 4); }

function fmtInvNumber(year, seq) {
  return 'AMD-' + year + '-' + String(seq).padStart(3, '0');
}

function nextInvoiceNumber(year) {
  let max = 0;
  state.invoices.forEach(function (inv) {
    const m = /^AMD-(\d{4})-(\d{3,})$/.exec(inv.number || '');
    if (m && m[1] === year) max = Math.max(max, +m[2]);
  });
  const stored = (state.settings.invoiceSeq && state.settings.invoiceSeq[year]) || 0;
  return Math.max(max, stored) + 1;
}

function addDays(iso, days) {
  const p = iso.split('-');
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function field(label, id, value, placeholder) {
  return '<label class="field"><span>' + esc(label) + '</span>' +
    '<input id="' + id + '" value="' + esc(value || '') + '" placeholder="' + esc(placeholder || '') + '"></label>';
}

/* ---------- Saved clients (on-device) ---------- */

function clientRef(c) { return 'Client #' + String(c.ref || 0).padStart(3, '0'); }
function clientLabel(c) { return (c.name && c.name.trim()) ? c.name.trim() : clientRef(c); }

// Pre-create the first client slot once (shows as "Client #001" until named).
// No client name is hardcoded — keeps the public repo anonymous.
function ensureClientsSeed() {
  if (state.settings.clientsSeeded) return;
  state.settings.clientsSeeded = true;
  state.settings.clientSeq = state.settings.clientSeq || 0;
  if (!state.clients.length) {
    state.settings.clientSeq += 1;
    state.clients.push({ id: uid(), ref: state.settings.clientSeq, name: '', uen: '', addr1: '', addr2: '', attn: '', terms: 30, createdAt: Date.now() });
  }
  save();
}

function sortedClients() {
  return state.clients.slice().sort(function (a, b) { return (a.ref || 0) - (b.ref || 0); });
}

function kindLabel(k) { return k === 'vendor' ? 'Vendor' : (k === 'both' ? 'Client/Vendor' : 'Client'); }

function clientRowHTML(c) {
  const sub = [];
  if (c.company) sub.push(c.company);
  if (c.phone) sub.push(c.phone);
  if (!(c.name && c.name.trim())) sub.push('unnamed');
  if (!sub.length) sub.push('Net ' + (c.terms != null ? c.terms : 30));
  return '<button class="entry" data-client="' + c.id + '">' +
    '<span class="entry-main"><span class="entry-title">' + esc(clientLabel(c)) + '</span>' +
    '<span class="entry-sub">' + esc(sub.join(' · ')) + '</span></span>' +
    '<span class="entry-amt" style="font-size:11px;color:var(--muted);font-weight:600">' + esc(kindLabel(c.kind)) + '</span>' +
    '</button>';
}

function openClientsList() {
  const cs = sortedClients();
  let html =
    '<div class="sheet-inner">' +
    '<div class="sheet-head"><button class="close-btn" id="closeSheet" aria-label="Close">✕</button><h2>Clients</h2></div>' +
    '<p class="fineprint">Saved only on this device. When creating an invoice, pick a client to auto-fill the bill-to details.</p>' +
    '<button class="btn" id="addClient">+ Add client</button>';
  if (cs.length) html += '<h3 class="sec">Saved clients</h3>' + cs.map(clientRowHTML).join('');
  else html += '<div class="empty">No clients yet.<br>Tap <b>+ Add client</b> to create one.</div>';
  html += '</div>';
  $sheet.innerHTML = html;
  $sheet.classList.remove('hidden');
  $sheet.scrollTop = 0;
  const q = function (s) { return $sheet.querySelector(s); };
  q('#closeSheet').onclick = closeSheet;
  q('#addClient').onclick = function () { openClientForm(null); };
  $sheet.querySelectorAll('.entry[data-client]').forEach(function (btn) {
    btn.onclick = function () {
      const c = state.clients.find(function (x) { return x.id === btn.dataset.client; });
      if (c) openClientForm(c);
    };
  });
}

// Contact editor — shared by the invoicing "Clients" list and the Admin
// "Contacts" tab. `back` is the callback used to return after save/delete/close.
function openClientForm(existing, back) {
  back = back || openClientsList;
  const isEdit = !!existing;
  const c = existing || { name: '', kind: 'client', company: '', uen: '', addr1: '', addr2: '', attn: '', phone: '', email: '', notes: '', terms: 30 };
  let kind = c.kind || 'client';
  const refLabel = isEdit ? clientRef(existing) : ('Client #' + String((state.settings.clientSeq || 0) + 1).padStart(3, '0'));
  $sheet.innerHTML =
    '<div class="sheet-inner">' +
    '<div class="sheet-head"><button class="close-btn" id="closeSheet" aria-label="Close">✕</button>' +
    '<h2>' + (isEdit ? 'Edit contact' : 'New contact') + '</h2>' +
    (isEdit ? '<button class="danger-link" id="delClient">Delete</button>' : '') + '</div>' +
    '<div class="field"><span>Type</span><div class="seg" id="kindSeg">' +
    '<button data-k="client"' + (kind === 'client' ? ' class="on"' : '') + '>Client</button>' +
    '<button data-k="vendor"' + (kind === 'vendor' ? ' class="on"' : '') + '>Vendor</button>' +
    '<button data-k="both"' + (kind === 'both' ? ' class="on"' : '') + '>Both</button>' +
    '</div></div>' +
    '<p class="fineprint">Reference: <b>' + esc(refLabel) + '</b> — used until you enter a name.</p>' +
    field('Name', 'kName', c.name, 'Leave blank to use ' + refLabel) +
    field('Company (optional)', 'kCompany', c.company, 'Company / organisation') +
    field('Phone', 'kPhone', c.phone, 'Mobile or office') +
    field('Email', 'kEmail', c.email, 'name@company.com') +
    field('UEN', 'kUen', c.uen, 'Registration no.') +
    field('Address line 1', 'kAddr1', c.addr1, 'Street, unit') +
    field('Address line 2', 'kAddr2', c.addr2, 'Postal / country') +
    field('Attention (optional)', 'kAttn', c.attn, 'Contact person') +
    field('Default payment terms (days)', 'kTerms', String(c.terms != null ? c.terms : 30), '30') +
    '<label class="field"><span>Notes</span><textarea id="kNotes" class="li-desc" rows="3" placeholder="Anything to remember">' + esc(c.notes || '') + '</textarea></label>' +
    '<button class="btn big" id="saveClient">Save contact</button>' +
    '</div>';
  $sheet.classList.remove('hidden');
  $sheet.scrollTop = 0;
  const q = function (s) { return $sheet.querySelector(s); };
  q('#closeSheet').onclick = back;
  q('#kindSeg').querySelectorAll('button').forEach(function (b) {
    b.onclick = function () { kind = b.dataset.k; q('#kindSeg').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x.dataset.k === kind); }); };
  });
  if (isEdit) {
    q('#delClient').onclick = function () {
      const idx = state.clients.indexOf(existing);
      state.clients = state.clients.filter(function (x) { return x.id !== existing.id; });
      save();
      back();
      showSnack('Contact deleted', function () {
        state.clients.splice(idx < 0 ? state.clients.length : Math.min(idx, state.clients.length), 0, existing);
        save();
        back();
      });
    };
  }
  q('#saveClient').onclick = function () {
    const t = parseInt(q('#kTerms').value, 10);
    const obj = {
      name: q('#kName').value.trim(), kind: kind, company: q('#kCompany').value.trim(),
      phone: q('#kPhone').value.trim(), email: q('#kEmail').value.trim(),
      uen: q('#kUen').value.trim(), addr1: q('#kAddr1').value.trim(), addr2: q('#kAddr2').value.trim(),
      attn: q('#kAttn').value.trim(), notes: q('#kNotes').value.trim(), terms: isNaN(t) ? 30 : t,
    };
    if (isEdit) {
      const i = state.clients.findIndex(function (x) { return x.id === existing.id; });
      if (i !== -1) state.clients[i] = Object.assign({}, existing, obj);
    } else {
      state.settings.clientSeq = (state.settings.clientSeq || 0) + 1;
      state.clients.push(Object.assign({ id: uid(), ref: state.settings.clientSeq, createdAt: Date.now() }, obj));
    }
    save();
    requestPersist();
    back();
    showSnack('Contact saved');
  };
}

/* ---------- Invoice tab ---------- */

const INV_STATUS_LABEL = { void: 'VOID', paid: 'PAID', overdue: 'OVERDUE', outstanding: 'OUTSTANDING' };

function invStatus(inv) {
  if (inv.status === 'void') return 'void';
  if (inv.paid) return 'paid';
  if (inv.dueDate && inv.dueDate < todayISO()) return 'overdue';
  return 'outstanding';
}

function invRowHTML(inv) {
  const st = invStatus(inv);
  const badge = '<span class="badge ' + st + '">' + INV_STATUS_LABEL[st] + '</span>';
  return '<button class="entry' + (st === 'void' ? ' void' : '') + '" data-inv="' + inv.id + '">' +
    '<span class="entry-main"><span class="entry-title">' + esc(inv.number) + ' · ' + esc(inv.client.name) + '</span>' +
    '<span class="entry-sub">' + esc(fmtDate(inv.date)) + (inv.gstMode === 'registered' ? ' · GST' : '') + ' ' + badge + '</span></span>' +
    '<span class="entry-amt">' + fmtMoney(inv.total) + '</span>' +
    '</button>';
}

function renderInvoiceTab() {
  const invs = state.invoices.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  const configured = companyConfigured();
  let html =
    (!configured ? '<button class="banner" id="coBanner">⚙️ Set your company &amp; bank details first — tap to fill them in</button>' : '') +
    '<div class="card"><h3>Create an invoice</h3>' +
    '<p>A branded .xlsx invoice with your logo, ready to send. Generating one also logs the total as income.</p>' +
    '<button id="newInv" class="btn">New invoice</button>' +
    '<button id="clientsBtn" class="btn ghost">Clients</button>' +
    '<button id="coBtn" class="btn ghost">Company details</button></div>';
  if (invs.length) {
    const active = invs.filter(function (i) { return i.status !== 'void'; });
    const unpaid = active.filter(function (i) { return !i.paid; });
    const outstanding = unpaid.reduce(function (s, i) { return s + i.total; }, 0);
    const overdueTotal = unpaid.filter(function (i) { return i.dueDate && i.dueDate < todayISO(); }).reduce(function (s, i) { return s + i.total; }, 0);
    html +=
      '<div class="card outstanding-card"><h3>Outstanding</h3>' +
      (unpaid.length
        ? '<div class="big-amount">' + fmtMoney(outstanding) + '</div>' +
          '<p>' + unpaid.length + ' unpaid invoice' + (unpaid.length === 1 ? '' : 's') +
          (overdueTotal ? ' · <span class="warn">' + fmtMoney(overdueTotal) + ' overdue</span>' : '') + '</p>'
        : '<p class="ok">All invoices paid ✓</p>') +
      '</div>';
    html += '<h3 class="sec">Past invoices</h3>' + invs.map(invRowHTML).join('');
  } else {
    html += '<div class="empty">No invoices yet.<br>Tap <b>New invoice</b> to create your first.</div>';
  }
  $view.innerHTML = html;
  document.getElementById('newInv').onclick = function () {
    if (companyConfigured()) openInvoiceForm();
    else openCompanyForm(true);
  };
  document.getElementById('clientsBtn').onclick = function () { openClientsList(); };
  document.getElementById('coBtn').onclick = function () { openCompanyForm(false); };
  const banner = document.getElementById('coBanner');
  if (banner) banner.onclick = function () { openCompanyForm(false); };
  $view.querySelectorAll('.entry[data-inv]').forEach(function (btn) {
    btn.onclick = function () {
      const inv = state.invoices.find(function (x) { return x.id === btn.dataset.inv; });
      if (inv) openInvoiceView(inv);
    };
  });
}

/* ---------- Company details (stored on-device) ---------- */

function openCompanyForm(thenNewInvoice) {
  const c = getCompany();
  $sheet.innerHTML =
    '<div class="sheet-inner">' +
    '<div class="sheet-head"><button class="close-btn" id="closeSheet" aria-label="Close">✕</button><h2>Company details</h2></div>' +
    '<p class="fineprint">These appear on your invoices. They are stored only on this device — never uploaded, and never put in the app’s public code.</p>' +
    '<h3 class="sec">Business</h3>' +
    field('Company name', 'cName', c.name, 'Registered company name') +
    field('UEN', 'cUen', c.uen, 'Registration no.') +
    field('Address line 1', 'cAddr1', c.addr1, 'Street, unit') +
    field('Address line 2', 'cAddr2', c.addr2, 'Postal / country') +
    '<h3 class="sec">Payment</h3>' +
    field('Bank', 'cBank', c.bankName, 'Bank name') +
    field('Account name', 'cAccName', c.bankAccName, 'Name on the account') +
    field('Account number', 'cAccNo', c.bankAccNo, 'Bank account number') +
    field('PayNow (UEN / phone)', 'cPaynow', c.paynow, 'PayNow identifier') +
    '<h3 class="sec">Related-party note (optional)</h3>' +
    '<label class="field"><span>Note text — printed only for the client below</span>' +
    '<textarea id="cNote" class="li-desc" rows="3" placeholder="e.g. This invoice is issued under a related-party arrangement…">' + esc(c.noteText) + '</textarea></label>' +
    field('Show note when client name contains', 'cNoteClient', c.noteClient, 'A word from the client name as billed') +
    '<button class="btn big" id="saveCompany">Save company details</button>' +
    '</div>';
  $sheet.classList.remove('hidden');
  $sheet.scrollTop = 0;
  const q = function (s) { return $sheet.querySelector(s); };
  q('#closeSheet').onclick = closeSheet;
  q('#saveCompany').onclick = function () {
    state.settings.company = {
      name: q('#cName').value.trim(), uen: q('#cUen').value.trim(),
      addr1: q('#cAddr1').value.trim(), addr2: q('#cAddr2').value.trim(),
      bankName: q('#cBank').value.trim(), bankAccName: q('#cAccName').value.trim(),
      bankAccNo: q('#cAccNo').value.trim(), paynow: q('#cPaynow').value.trim(),
      noteText: q('#cNote').value.trim(), noteClient: q('#cNoteClient').value.trim(),
    };
    save();
    requestPersist();
    if (thenNewInvoice && companyConfigured()) {
      closeSheet();
      openInvoiceForm();
    } else {
      closeSheet();
      render();
      showSnack('Company details saved');
    }
  };
}

/* ---------- Invoice form ---------- */

function openInvoiceForm(prefill) {
  // No prefill given → start from the most recent invoice (handy for a recurring
  // monthly retainer). The very first invoice starts blank.
  if (!prefill) {
    const actives = state.invoices.filter(function (i) { return i.status !== 'void'; });
    if (actives.length) {
      const last = actives.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); })[0];
      prefill = { client: last.client, lineItems: last.lineItems, gstMode: last.gstMode, terms: last.terms };
    }
  }
  const base = prefill || {};
  const client = Object.assign({ name: '', uen: '', addr1: '', addr2: '', attn: '' }, base.client || {});
  let gstMode = base.gstMode || 'none';
  let autoNum = fmtInvNumber(invYear(todayISO()), nextInvoiceNumber(invYear(todayISO())));
  let items = (base.lineItems && base.lineItems.length)
    ? base.lineItems.map(function (it) { return { desc: it.desc, qty: it.qty, unitPrice: it.unitPrice }; })
    : [{ desc: '', qty: 1, unitPrice: 0 }];

  // Client picker: pre-select the matching saved client, else default to the
  // first (named) client, else "Other" for a one-off typed client.
  const clients = sortedClients();
  let selClientId = '__other';
  if (client.name) {
    const m = clients.find(function (c) { return c.name && c.name.trim().toLowerCase() === client.name.trim().toLowerCase(); });
    selClientId = m ? m.id : '__other';
  } else if (clients.length) {
    const named = clients.find(function (c) { return c.name && c.name.trim(); });
    selClientId = (named || clients[0]).id;
  }
  const clientPicker = clients.length
    ? '<label class="field"><span>Client</span><select id="iClientSel">' +
      clients.map(function (c) { return '<option value="' + c.id + '"' + (c.id === selClientId ? ' selected' : '') + '>' + esc(clientLabel(c)) + '</option>'; }).join('') +
      '<option value="__other"' + (selClientId === '__other' ? ' selected' : '') + '>Other (type below)</option>' +
      '</select></label>'
    : '';

  $sheet.innerHTML =
    '<div class="sheet-inner">' +
    '<div class="sheet-head"><button class="close-btn" id="closeSheet" aria-label="Close">✕</button><h2>New invoice</h2></div>' +

    '<div class="field"><span>GST</span><div class="seg" id="gstSeg">' +
    '<button data-g="none"' + (gstMode === 'none' ? ' class="on"' : '') + '>Not GST-reg.</button>' +
    '<button data-g="registered"' + (gstMode === 'registered' ? ' class="on"' : '') + '>GST 9%</button>' +
    '</div></div>' +

    '<h3 class="sec">Bill to</h3>' +
    clientPicker +
    field('Client name', 'iName', client.name, 'Who is this invoice for?') +
    field('Client UEN', 'iUen', client.uen, 'Registration no.') +
    field('Address line 1', 'iAddr1', client.addr1, 'Street, unit') +
    field('Address line 2', 'iAddr2', client.addr2, 'Postal / country') +
    field('Attention (optional)', 'iAttn', client.attn, 'Contact person') +

    '<h3 class="sec">Invoice details</h3>' +
    field('Invoice number', 'iNum', autoNum, '') +
    '<label class="field"><span>Invoice date</span><input type="date" id="iDate" value="' + todayISO() + '"></label>' +
    field('Payment terms (days)', 'iTerms', String(base.terms != null ? base.terms : 30), '30') +
    '<div class="fineprint" id="iDue"></div>' +

    '<h3 class="sec">Line items</h3>' +
    '<div id="liList"></div>' +
    '<button class="btn ghost" id="addLi">+ Add line item</button>' +

    '<div class="inv-totals" id="invTotals"></div>' +

    '<button class="btn big" id="genInv">Generate invoice</button>' +
    '<p class="fineprint">Saves a branded .xlsx to your Downloads and logs the total as income.</p>' +
    '</div>';

  $sheet.classList.remove('hidden');
  $sheet.scrollTop = 0;
  const q = function (s) { return $sheet.querySelector(s); };

  function readItems() {
    $sheet.querySelectorAll('.li-card').forEach(function (card) {
      const i = +card.dataset.i;
      items[i] = {
        desc: card.querySelector('.li-desc').value,
        qty: parseFloat(card.querySelector('.li-qty').value) || 0,
        unitPrice: Math.round((parseFloat(card.querySelector('.li-price').value) || 0) * 100),
      };
    });
  }

  function updateAmounts() {
    let subtotal = 0;
    items.forEach(function (it, i) {
      const amt = Math.round(it.qty * it.unitPrice);
      subtotal += amt;
      const el = q('.li-amt[data-i="' + i + '"]');
      if (el) el.textContent = 'Amount: ' + fmtMoney(amt);
    });
    const gst = gstMode === 'registered' ? Math.round(subtotal * 0.09) : 0;
    q('#invTotals').innerHTML =
      '<div class="pnl-row"><span>Subtotal</span><span>' + fmtMoney(subtotal) + '</span></div>' +
      '<div class="pnl-row"><span>' + (gstMode === 'registered' ? 'GST (9%)' : 'GST (not applicable)') + '</span><span>' + fmtMoney(gst) + '</span></div>' +
      '<div class="pnl-row net"><span>Total</span><span>' + fmtMoney(subtotal + gst) + '</span></div>';
  }

  function renderItems() {
    q('#liList').innerHTML = items.map(function (it, i) {
      return '<div class="li-card" data-i="' + i + '">' +
        '<input class="li-desc" placeholder="Description" value="' + esc(it.desc) + '">' +
        '<div class="li-row">' +
        '<label class="li-field"><span>Qty</span><input class="li-qty" inputmode="decimal" value="' + esc(it.qty) + '"></label>' +
        '<label class="li-field"><span>Unit price (S$)</span><input class="li-price" inputmode="decimal" value="' + (it.unitPrice ? (it.unitPrice / 100).toFixed(2) : '') + '"></label>' +
        (items.length > 1 ? '<button class="li-del" data-i="' + i + '" aria-label="Remove item">✕</button>' : '<span class="li-del-spacer"></span>') +
        '</div><div class="li-amt" data-i="' + i + '"></div></div>';
    }).join('');
    q('#liList').querySelectorAll('.li-card').forEach(function (card) {
      card.querySelectorAll('input').forEach(function (inp) {
        inp.oninput = function () { readItems(); updateAmounts(); };
      });
      const del = card.querySelector('.li-del');
      if (del) del.onclick = function () { readItems(); items.splice(+del.dataset.i, 1); renderItems(); };
    });
    q('#addLi').disabled = items.length >= 8;
    updateAmounts();
  }

  function updateDue() {
    const t = parseInt(q('#iTerms').value, 10);
    const days = isNaN(t) ? 30 : t;
    q('#iDue').textContent = 'Due ' + fmtDate(addDays(q('#iDate').value || todayISO(), days)) + ' · Net ' + days;
  }

  q('#gstSeg').querySelectorAll('button').forEach(function (b) {
    b.onclick = function () {
      gstMode = b.dataset.g;
      q('#gstSeg').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x.dataset.g === gstMode); });
      updateAmounts();
    };
  });

  q('#iDate').onchange = function () {
    const numInp = q('#iNum');
    const y = invYear(q('#iDate').value || todayISO());
    const newAuto = fmtInvNumber(y, nextInvoiceNumber(y));
    if (numInp.value === autoNum) { numInp.value = newAuto; autoNum = newAuto; }
    updateDue();
  };
  q('#iTerms').oninput = updateDue;
  q('#addLi').onclick = function () { readItems(); if (items.length < 8) { items.push({ desc: '', qty: 1, unitPrice: 0 }); renderItems(); } };
  q('#closeSheet').onclick = closeSheet;

  function fillFromClient(c) {
    q('#iName').value = c.name || '';
    q('#iUen').value = c.uen || '';
    q('#iAddr1').value = c.addr1 || '';
    q('#iAddr2').value = c.addr2 || '';
    q('#iAttn').value = c.attn || '';
    if (c.terms != null) q('#iTerms').value = c.terms;
  }
  const clientSel = q('#iClientSel');
  if (clientSel) {
    clientSel.onchange = function () {
      if (clientSel.value === '__other') return;
      const c = state.clients.find(function (x) { return x.id === clientSel.value; });
      if (c) { fillFromClient(c); updateDue(); }
    };
    // First invoice (no prefill client): fill the bill-to from the default client
    if (!(base.client && base.client.name) && selClientId !== '__other') {
      const c0 = state.clients.find(function (x) { return x.id === selClientId; });
      if (c0) fillFromClient(c0);
    }
  }

  q('#genInv').onclick = function () {
    readItems();
    const clientObj = {
      name: q('#iName').value.trim(),
      uen: q('#iUen').value.trim(),
      addr1: q('#iAddr1').value.trim(),
      addr2: q('#iAddr2').value.trim(),
      attn: q('#iAttn').value.trim(),
    };
    if (!clientObj.name) { q('#iName').focus(); showSnack('Enter a client name'); return; }
    const clean = items.filter(function (it) { return it.qty > 0 && it.unitPrice > 0; }).slice(0, 8);
    if (!clean.length) { showSnack('Add at least one item with qty and price'); return; }
    const subtotal = clean.reduce(function (s, it) { return s + Math.round(it.qty * it.unitPrice); }, 0);
    const gst = gstMode === 'registered' ? Math.round(subtotal * 0.09) : 0;
    const dISO = q('#iDate').value || todayISO();
    const t = parseInt(q('#iTerms').value, 10);
    const terms = isNaN(t) ? 30 : t;
    generateInvoice({
      id: uid(),
      number: q('#iNum').value.trim() || autoNum,
      date: dISO,
      dueDate: addDays(dISO, terms),
      terms: terms,
      client: clientObj,
      lineItems: clean,
      gstMode: gstMode,
      subtotal: subtotal,
      gst: gst,
      total: subtotal + gst,
      createdAt: Date.now(),
    });
  };

  renderItems();
  updateDue();
}

/* ---------- Re-download / duplicate a stored invoice ---------- */

function openInvoiceView(inv) {
  const lines = inv.lineItems.map(function (it, i) {
    return '<div class="pnl-row"><span>' + esc(it.desc || '(item ' + (i + 1) + ')') + ' × ' + esc(it.qty) + '</span><span>' + fmtMoney(Math.round(it.qty * it.unitPrice)) + '</span></div>';
  }).join('');
  const st = invStatus(inv);
  const isVoid = st === 'void';
  const paidControl = isVoid ? '' :
    (inv.paid
      ? '<label class="field"><span>Paid on</span><input type="date" id="paidDate" value="' + (inv.paidDate || todayISO()) + '"></label>' +
        '<button class="btn ghost big" id="markUnpaid">Mark as unpaid</button>'
      : '<button class="btn big" id="markPaid">Mark as paid</button>');
  $sheet.innerHTML =
    '<div class="sheet-inner">' +
    '<div class="sheet-head"><button class="close-btn" id="closeSheet" aria-label="Close">✕</button><h2>' + esc(inv.number) + '</h2></div>' +
    '<div class="card"><h3>' + esc(inv.client.name) + ' <span class="badge ' + st + '">' + INV_STATUS_LABEL[st] + '</span></h3>' +
    '<p>' + esc(fmtDate(inv.date)) + ' · Due ' + esc(fmtDate(inv.dueDate)) + ' · Net ' + inv.terms +
      (inv.paid && inv.paidDate ? ' · Paid ' + esc(fmtDate(inv.paidDate)) : '') + '</p>' +
    (isVoid ? '<p class="warn">Voided — removed from your P&amp;L. The number stays on record.</p>' : '') + '</div>' +
    '<h3 class="sec">Items</h3>' + lines +
    '<div class="inv-totals">' +
    '<div class="pnl-row"><span>Subtotal</span><span>' + fmtMoney(inv.subtotal) + '</span></div>' +
    '<div class="pnl-row"><span>' + (inv.gstMode === 'registered' ? 'GST (9%)' : 'GST (not applicable)') + '</span><span>' + fmtMoney(inv.gst) + '</span></div>' +
    '<div class="pnl-row net"><span>Total</span><span>' + fmtMoney(inv.total) + '</span></div></div>' +
    paidControl +
    '<button class="btn ghost big" id="reDl">Download .xlsx again</button>' +
    '<button class="btn ghost big" id="dupInv">Duplicate as new invoice</button>' +
    (isVoid
      ? '<button class="btn ghost big" id="restoreInv">Restore (un-void)</button>'
      : '<button class="btn danger big" id="voidInv">Void / cancel invoice</button>') +
    '<button class="danger-link" id="delInv">Delete permanently</button>' +
    '<p class="fineprint">' +
    (isVoid
      ? 'Restoring re-adds the income to your P&amp;L. '
      : 'Voiding removes its income from your P&amp;L but keeps the invoice number on record (best for an invoice you already sent). ') +
    'Deleting removes it and its income entirely — use it for a mistake. Both can be undone right after.</p>' +
    '</div>';
  $sheet.classList.remove('hidden');
  $sheet.scrollTop = 0;
  const q = function (s) { return $sheet.querySelector(s); };
  q('#closeSheet').onclick = closeSheet;
  q('#reDl').onclick = function () {
    buildInvoiceWorkbook(inv).then(function (buf) {
      download(buf, 'invoice-' + inv.number + '.xlsx', XLSX_MIME);
      showSnack('Invoice downloaded');
    }).catch(function () { showSnack('Could not build the file'); });
  };
  q('#dupInv').onclick = function () {
    openInvoiceForm({ client: inv.client, lineItems: inv.lineItems, gstMode: inv.gstMode, terms: inv.terms });
  };
  const markPaid = q('#markPaid');
  if (markPaid) markPaid.onclick = function () { inv.paid = true; inv.paidDate = todayISO(); save(); render(); openInvoiceView(inv); showSnack('Marked paid'); };
  const markUnpaid = q('#markUnpaid');
  if (markUnpaid) markUnpaid.onclick = function () { inv.paid = false; delete inv.paidDate; save(); render(); openInvoiceView(inv); showSnack('Marked unpaid'); };
  const paidDateInput = q('#paidDate');
  if (paidDateInput) paidDateInput.onchange = function () { inv.paidDate = paidDateInput.value || todayISO(); save(); render(); };
  if (isVoid) q('#restoreInv').onclick = function () { restoreInvoice(inv); };
  else q('#voidInv').onclick = function () { voidInvoice(inv); };
  q('#delInv').onclick = function () { deleteInvoice(inv); };
}

/* ---------- Void / delete an invoice with linked P&L cleanup ---------- */

// Removes the income entry an invoice logged (if still present) and returns it
// so the action can be undone.
function removeLinkedEntry(inv) {
  if (!inv.loggedEntryId) return null;
  const e = state.entries.find(function (x) { return x.id === inv.loggedEntryId; });
  if (e) state.entries = state.entries.filter(function (x) { return x.id !== inv.loggedEntryId; });
  return e || null;
}

function voidInvoice(inv) {
  const removed = removeLinkedEntry(inv);
  const prevStatus = inv.status;
  inv.status = 'void';
  inv.voidedAt = Date.now();
  save();
  closeSheet();
  render();
  showSnack('Invoice voided — income removed from P&L', function () {
    if (prevStatus) inv.status = prevStatus; else delete inv.status;
    delete inv.voidedAt;
    if (removed) state.entries.push(removed);
    save();
    render();
  });
}

function deleteInvoice(inv) {
  const removed = removeLinkedEntry(inv);
  const idx = state.invoices.indexOf(inv);
  state.invoices = state.invoices.filter(function (x) { return x.id !== inv.id; });
  save();
  closeSheet();
  render();
  showSnack('Invoice deleted', function () {
    state.invoices.splice(idx < 0 ? state.invoices.length : Math.min(idx, state.invoices.length), 0, inv);
    if (removed) state.entries.push(removed);
    save();
    render();
  });
}

// Un-void: reconstruct the income entry from the invoice and re-add it to the P&L.
function restoreInvoice(inv) {
  if (inv.loggedEntryId && !state.entries.some(function (x) { return x.id === inv.loggedEntryId; })) {
    state.entries.push({
      id: inv.loggedEntryId,
      type: 'income',
      date: inv.date,
      desc: 'Invoice ' + inv.number,
      client: inv.client.name,
      category: noteTriggered(getCompany(), inv.client.name) ? 'Retainer income' : 'Other income',
      gst: inv.gstMode === 'registered' ? 'incl' : 'none',
      amountCents: inv.total,
      createdAt: Date.now(),
    });
  }
  delete inv.status;
  delete inv.voidedAt;
  save();
  closeSheet();
  render();
  showSnack('Invoice restored — income added back');
}

/* ---------- Generate: build file, download, log income, persist ---------- */

function generateInvoice(inv) {
  if (typeof ExcelJS === 'undefined') { showSnack('Invoice library missing — reload the app'); return; }
  if (!companyConfigured()) { showSnack('Set your company details first'); openCompanyForm(false); return; }
  buildInvoiceWorkbook(inv).then(function (buf) {
    download(buf, 'invoice-' + inv.number + '.xlsx', XLSX_MIME);

    const entry = {
      id: uid(),
      type: 'income',
      date: inv.date,
      desc: 'Invoice ' + inv.number,
      client: inv.client.name,
      category: noteTriggered(getCompany(), inv.client.name) ? 'Retainer income' : 'Other income',
      gst: inv.gstMode === 'registered' ? 'incl' : 'none',
      amountCents: inv.total,
      createdAt: Date.now(),
    };
    inv.loggedEntryId = entry.id;
    state.entries.push(entry);
    state.invoices.push(inv);

    state.settings.invoiceSeq = state.settings.invoiceSeq || {};
    const m = /^AMD-(\d{4})-(\d{3,})$/.exec(inv.number);
    if (m) state.settings.invoiceSeq[m[1]] = Math.max(state.settings.invoiceSeq[m[1]] || 0, +m[2]);

    save();
    requestPersist();
    closeSheet();
    view.tab = 'invoice';
    render();
    showSnack('Invoice created & logged as income');
  }).catch(function () {
    showSnack('Could not build the invoice file');
  });
}

/* ---------- ExcelJS workbook matching INVOICE_SPEC.md ---------- */

function buildInvoiceWorkbook(inv) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Invoice', {
    views: [{ showGridLines: false }],
    pageSetup: {
      orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1,
      margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  });
  ws.columns = [{ width: 6 }, { width: 42 }, { width: 12 }, { width: 14 }, { width: 16 }];

  const R = { horizontal: 'right' }, L = { horizontal: 'left' }, M = { horizontal: 'center' };

  function set(addr, value, font, align, fill, numFmt) {
    const cell = ws.getCell(addr);
    if (value !== undefined) cell.value = value;
    if (font) cell.font = Object.assign({ name: 'Georgia' }, font);
    if (align) cell.alignment = align;
    if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    if (numFmt) cell.numFmt = numFmt;
    return cell;
  }

  // Logo at A1, ~145px wide, aspect kept (~1.30:1)
  if (window.ASSEMBLY_LOGO) {
    const b64 = window.ASSEMBLY_LOGO.replace(/^data:image\/png;base64,/, '');
    const imgId = wb.addImage({ base64: b64, extension: 'png' });
    ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 145, height: Math.round(145 / 1.304) } });
  }

  const co = getCompany();

  // Header (right)
  set('E1', 'INVOICE', { size: 22, bold: true, color: { argb: C_INK } }, R);
  set('E3', co.name, { size: 10, bold: true, color: { argb: C_INK } }, R);
  if (co.uen) set('E4', 'UEN: ' + co.uen, { size: 9, color: { argb: C_GREY } }, R);
  set('E5', co.addr1, { size: 9, color: { argb: C_GREY } }, R);
  set('E6', co.addr2, { size: 9, color: { argb: C_GREY } }, R);

  // Row 8 divider — medium gold bottom border across A–E
  ['A8', 'B8', 'C8', 'D8', 'E8'].forEach(function (a) {
    ws.getCell(a).border = { bottom: { style: 'medium', color: { argb: C_GOLD } } };
  });

  // Bill to
  set('A10', 'BILL TO', { size: 9, bold: true, color: { argb: C_GOLD } }, L);
  set('A11', inv.client.name, { size: 10, bold: true, color: { argb: C_INK } }, L);
  const billLines = [];
  if (inv.client.uen) billLines.push(inv.client.uen);
  if (inv.client.addr1) billLines.push(inv.client.addr1);
  if (inv.client.addr2) billLines.push(inv.client.addr2);
  if (inv.client.attn) billLines.push('Attn: ' + inv.client.attn);
  billLines.slice(0, 4).forEach(function (t, i) {
    set('A' + (12 + i), t, { size: 9, color: { argb: C_GREY } }, L);
  });

  // Meta block (D labels / E values)
  const lab = { size: 9, bold: true, color: { argb: C_INK } };
  const val = { size: 9, color: { argb: C_INK } };
  set('D10', 'Invoice No.', lab, R); set('E10', inv.number, val, R);
  set('D11', 'Invoice Date', lab, R); set('E11', fmtDate(inv.date), val, R);
  set('D12', 'Due Date', lab, R); set('E12', fmtDate(inv.dueDate), val, R);
  set('D13', 'Terms', lab, R); set('E13', 'Net ' + inv.terms, val, R);

  // Line-item header (row 17) — smaller font + wrap + taller row so the
  // longer labels ("Unit Price (SGD)") never overflow their cells.
  const head = { size: 8, bold: true, color: { argb: C_WHITE } };
  const headC = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const headL = { horizontal: 'left', vertical: 'middle', wrapText: true };
  set('A17', 'No.', head, headC, C_INK);
  set('B17', 'Description', head, headL, C_INK);
  set('C17', 'Qty', head, headC, C_INK);
  set('D17', 'Unit Price (SGD)', head, headC, C_INK);
  set('E17', 'Amount (SGD)', head, headC, C_INK);
  ws.getRow(17).height = 26;

  // Item rows 18–25 (8 rows)
  for (let i = 0; i < 8; i++) {
    const r = 18 + i;
    const item = inv.lineItems[i];
    const fill = (r % 2 === 0) ? C_STRIPE : null;
    const f = { size: 9, color: { argb: C_INK } };
    set('A' + r, item ? (i + 1) : undefined, f, M, fill);
    set('B' + r, item ? item.desc : undefined, f, L, fill);
    set('C' + r, item ? item.qty : undefined, f, M, fill);
    set('D' + r, item ? +(item.unitPrice / 100).toFixed(2) : undefined, f, R, fill, NUMFMT);
    const eCell = set('E' + r, undefined, f, R, fill, NUMFMT);
    eCell.value = {
      formula: 'IF(OR(C' + r + '="",D' + r + '=""),"",C' + r + '*D' + r + ')',
      result: item ? +((item.qty * item.unitPrice) / 100).toFixed(2) : undefined,
    };
    ['A', 'B', 'C', 'D', 'E'].forEach(function (col) {
      const cell = ws.getCell(col + r);
      const b = cell.border || {};
      b.bottom = { style: 'thin', color: { argb: C_BORDER } };
      cell.border = b;
    });
  }

  // Totals
  set('D27', 'Subtotal', lab, R);
  set('E27', undefined, val, R, null, NUMFMT).value = { formula: 'SUM(E18:E25)', result: +(inv.subtotal / 100).toFixed(2) };
  if (inv.gstMode === 'registered') {
    set('D28', 'GST (9%)', lab, R);
    set('E28', undefined, val, R, null, NUMFMT).value = { formula: 'E27*0.09', result: +(inv.gst / 100).toFixed(2) };
  } else {
    set('D28', 'GST (not applicable)', lab, R);
    set('E28', 0, val, R, null, NUMFMT);
  }
  const totFont = { size: 10, bold: true, color: { argb: C_WHITE } };
  const totAlign = { horizontal: 'right', vertical: 'middle' };
  set('C29', undefined, null, null, C_GOLD); // extend gold band left so the label never spills onto white
  set('D29', 'TOTAL (SGD)', totFont, totAlign, C_GOLD);
  set('E29', undefined, totFont, totAlign, C_GOLD, NUMFMT).value = { formula: 'E27+E28', result: +(inv.total / 100).toFixed(2) };
  ws.getRow(29).height = 22;

  // Footer — payment details (from on-device company settings)
  set('A32', 'PAYMENT DETAILS', { size: 9, bold: true, color: { argb: C_GOLD } }, L);
  const payLines = [];
  if (co.bankName) payLines.push('Bank: ' + co.bankName);
  if (co.bankAccName) payLines.push('Account Name: ' + co.bankAccName);
  if (co.bankAccNo) payLines.push('Account No.: ' + co.bankAccNo);
  if (co.paynow) payLines.push('PayNow (UEN): ' + co.paynow);
  payLines.forEach(function (t, i) {
    set('A' + (33 + i), t, { size: 9, color: { argb: C_GREY } }, L);
  });

  // Related-party note — only when the client matches the configured trigger
  if (noteTriggered(co, inv.client.name)) {
    ws.mergeCells('A38:E38');
    set('A38', co.noteText, { size: 8, italic: true, color: { argb: C_GREY } }, { horizontal: 'left', vertical: 'top', wrapText: true });
    ws.getRow(38).height = 30;
  }

  // Thank you
  set('A40', 'Thank you for your business.', { size: 9, italic: true, color: { argb: C_GOLD } }, L);

  return wb.xlsx.writeBuffer();
}

/* ===================== Admin module ===================== */

const TASK_STATUS = { todo: 'To-do', doing: 'Doing', done: 'Done' };
const FREQ_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
const REMINDER_FREQS = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']];

let contactFilter = 'all';

function contactById(id) { return state.clients.find(function (c) { return c.id === id; }); }
function contactName(id) { const c = contactById(id); return c ? clientLabel(c) : ''; }

function isoYMD(y, m, d) { return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

function nextDayOfMonth(dom) {
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth();
  if (now.getDate() >= dom) { m++; if (m > 11) { m = 0; y++; } }
  return isoYMD(y, m, Math.min(dom, daysInMonth(y, m)));
}

function advanceDate(iso, freq) {
  const p = iso.split('-');
  let y = +p[0], m = +p[1] - 1, d = +p[2];
  if (freq === 'daily') return addDays(iso, 1);
  if (freq === 'weekly') return addDays(iso, 7);
  const addM = freq === 'monthly' ? 1 : (freq === 'quarterly' ? 3 : 0);
  const addY = freq === 'yearly' ? 1 : 0;
  m += addM; y += addY;
  while (m > 11) { m -= 12; y++; }
  return isoYMD(y, m, Math.min(d, daysInMonth(y, m)));
}

// Pre-load the Singapore business reminders once (generic names — no client
// name hardcoded). Toggle/edit on-device.
function ensureRemindersSeed() {
  if (state.settings.remindersSeeded) return;
  state.settings.remindersSeeded = true;
  if (!state.reminders.length) {
    const y = new Date().getFullYear();
    [
      { title: 'CPF payment', freq: 'monthly', enabled: true, nextDue: nextDayOfMonth(14), notes: 'CPF contributions due by the 14th of the month.' },
      { title: 'GST filing', freq: 'quarterly', enabled: false, nextDue: nextDayOfMonth(1), notes: 'Only applies once GST-registered.' },
      { title: 'Monthly retainer invoice', freq: 'monthly', enabled: true, nextDue: nextDayOfMonth(1), notes: 'Send the monthly retainer invoice.' },
      { title: 'ACRA annual return', freq: 'yearly', enabled: true, nextDue: isoYMD(y + 1, 0, 31), notes: 'File the annual return with ACRA.' },
    ].forEach(function (r) {
      state.reminders.push(Object.assign({ id: uid(), builtin: true, createdAt: Date.now() }, r));
    });
  }
  save();
}

/* ---------- Date-status badges (shared by Today / Tasks) ---------- */

function dueLabel(date) {
  const today = todayISO();
  if (date < today) return 'OVERDUE';
  if (date === today) return 'TODAY';
  const days = Math.round((new Date(date + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000);
  return 'in ' + days + 'd';
}
function dateClass(date) {
  const today = todayISO();
  if (date < today) return 'overdue';
  if (date === today) return 'today';
  return 'soon';
}

/* ---------- Today ---------- */

function renderToday() {
  const today = todayISO();
  const in7 = addDays(today, 7);
  const items = [];
  state.tasks.forEach(function (t) { if (t.status !== 'done' && t.deadline) items.push({ date: t.deadline, type: 'task', obj: t }); });
  state.reminders.forEach(function (r) { if (r.enabled && r.nextDue) items.push({ date: r.nextDue, type: 'reminder', obj: r }); });
  items.sort(function (a, b) { return a.date.localeCompare(b.date); });

  const buckets = [
    ['Overdue', items.filter(function (i) { return i.date < today; })],
    ['Today', items.filter(function (i) { return i.date === today; })],
    ['Next 7 days', items.filter(function (i) { return i.date > today && i.date <= in7; })],
    ['Later', items.filter(function (i) { return i.date > in7; }).slice(0, 25)],
  ];

  let html;
  if (!items.length) {
    html = '<div class="empty">Nothing due right now.<br>Add a task or switch on a reminder.</div>';
  } else {
    html = buckets.map(function (b) {
      if (!b[1].length) return '';
      return '<h3 class="sec">' + b[0] + '</h3>' + b[1].map(todayRowHTML).join('');
    }).join('');
  }
  $view.innerHTML = html;
  $view.querySelectorAll('.entry[data-task]').forEach(function (btn) {
    btn.onclick = function () { const t = state.tasks.find(function (x) { return x.id === btn.dataset.task; }); if (t) openTaskForm(t); };
  });
  $view.querySelectorAll('.entry[data-reminder]').forEach(function (btn) {
    btn.onclick = function () { const r = state.reminders.find(function (x) { return x.id === btn.dataset.reminder; }); if (r) openReminderForm(r); };
  });
}

function todayRowHTML(item) {
  const o = item.obj;
  const badge = '<span class="badge ' + dateClass(item.date) + '">' + dueLabel(item.date) + '</span>';
  if (item.type === 'task') {
    const who = o.clientId ? contactName(o.clientId) : 'Internal';
    return '<button class="entry" data-task="' + o.id + '">' +
      '<span class="entry-main"><span class="entry-title">' + esc(o.title || '(untitled)') + '</span>' +
      '<span class="entry-sub">' + esc(who) + ' · ' + esc(fmtDate(item.date)) + ' · ' + TASK_STATUS[o.status || 'todo'] + '</span></span>' +
      badge + '</button>';
  }
  return '<button class="entry" data-reminder="' + o.id + '">' +
    '<span class="entry-main"><span class="entry-title">🔔 ' + esc(o.title) + '</span>' +
    '<span class="entry-sub">' + FREQ_LABEL[o.freq] + ' · ' + esc(fmtDate(item.date)) + '</span></span>' +
    badge + '</button>';
}

/* ---------- Tasks (grouped by client) ---------- */

function taskStatusBadge(t) {
  if (t.status === 'done') return 'DONE';
  if (t.deadline && t.deadline < todayISO()) return 'OVERDUE';
  return t.status === 'doing' ? 'DOING' : 'TO-DO';
}
function taskStatusClass(t) {
  if (t.status === 'done') return 'done';
  if (t.deadline && t.deadline < todayISO()) return 'overdue';
  return t.status === 'doing' ? 'today' : 'soon';
}

function taskRowHTML(t) {
  const cl = t.checklist || [];
  const prog = cl.length ? ' · ' + cl.filter(function (s) { return s.done; }).length + '/' + cl.length : '';
  const sub = [];
  if (t.deadline) sub.push(fmtDate(t.deadline));
  sub.push(TASK_STATUS[t.status || 'todo'] + prog);
  return '<button class="entry' + (t.status === 'done' ? ' void' : '') + '" data-task="' + t.id + '">' +
    '<span class="entry-main"><span class="entry-title">' + esc(t.title || '(untitled)') + '</span>' +
    '<span class="entry-sub">' + esc(sub.join(' · ')) + '</span></span>' +
    '<span class="badge ' + taskStatusClass(t) + '">' + taskStatusBadge(t) + '</span></button>';
}

function renderTasksTab() {
  const open = state.tasks.filter(function (t) { return t.status !== 'done'; });
  const done = state.tasks.filter(function (t) { return t.status === 'done'; });
  let html = '';
  if (!state.tasks.length) {
    html = '<div class="empty">No client jobs yet.<br>Tap <b>+</b> to add one.</div>';
  } else {
    const groups = {};
    open.forEach(function (t) { const k = t.clientId || ''; (groups[k] = groups[k] || []).push(t); });
    const keys = Object.keys(groups).sort(function (a, b) {
      if (a === '') return 1;
      if (b === '') return -1;
      return (contactName(a) || '').localeCompare(contactName(b) || '');
    });
    keys.forEach(function (k) {
      const label = k ? contactName(k) : 'Internal / unassigned';
      html += '<h3 class="sec">' + esc(label) + '</h3>';
      groups[k].sort(function (a, b) { return (a.deadline || '9999').localeCompare(b.deadline || '9999'); }).forEach(function (t) { html += taskRowHTML(t); });
    });
    if (!open.length) html += '<div class="empty">No open jobs — all done ✓</div>';
    if (done.length) html += '<h3 class="sec">Done (' + done.length + ')</h3>' + done.slice(0, 25).map(taskRowHTML).join('');
  }
  $view.innerHTML = html;
  $view.querySelectorAll('.entry[data-task]').forEach(function (btn) {
    btn.onclick = function () { const t = state.tasks.find(function (x) { return x.id === btn.dataset.task; }); if (t) openTaskForm(t); };
  });
}

function openTaskForm(existing) {
  const isEdit = !!existing;
  const t = existing || { title: '', clientId: '', deadline: '', status: 'todo', checklist: [], notes: '' };
  let status = t.status || 'todo';
  let checklist = (t.checklist || []).map(function (s) { return { id: s.id || uid(), text: s.text, done: !!s.done }; });
  const contacts = sortedClients().filter(function (c) { return c.name && c.name.trim(); });

  $sheet.innerHTML =
    '<div class="sheet-inner">' +
    '<div class="sheet-head"><button class="close-btn" id="closeSheet" aria-label="Close">✕</button><h2>' + (isEdit ? 'Edit job' : 'New job') + '</h2>' +
    (isEdit ? '<button class="danger-link" id="delTask">Delete</button>' : '') + '</div>' +
    field('Title', 'tTitle', t.title, 'What needs doing?') +
    '<label class="field"><span>Client</span><select id="tClient">' +
    '<option value="">— No client (internal) —</option>' +
    contacts.map(function (c) { return '<option value="' + c.id + '"' + (c.id === t.clientId ? ' selected' : '') + '>' + esc(clientLabel(c)) + '</option>'; }).join('') +
    '</select></label>' +
    '<label class="field"><span>Deadline (optional)</span><input type="date" id="tDeadline" value="' + (t.deadline || '') + '"></label>' +
    '<div class="field"><span>Status</span><div class="seg" id="tStatusSeg">' +
    '<button data-s="todo"' + (status === 'todo' ? ' class="on"' : '') + '>To-do</button>' +
    '<button data-s="doing"' + (status === 'doing' ? ' class="on"' : '') + '>Doing</button>' +
    '<button data-s="done"' + (status === 'done' ? ' class="on"' : '') + '>Done</button>' +
    '</div></div>' +
    '<div class="field"><span>Checklist</span><div id="clBox"></div>' +
    '<button class="btn ghost" id="addStep">+ Add sub-step</button></div>' +
    '<label class="field"><span>Notes</span><textarea id="tNotes" class="li-desc" rows="3" placeholder="Anything to remember">' + esc(t.notes || '') + '</textarea></label>' +
    '<button class="btn big" id="saveTask">Save job</button>' +
    '</div>';
  $sheet.classList.remove('hidden');
  $sheet.scrollTop = 0;
  const q = function (s) { return $sheet.querySelector(s); };
  q('#closeSheet').onclick = backToTab;

  function readChecklist() {
    $sheet.querySelectorAll('.cl-text').forEach(function (inp) { checklist[+inp.dataset.ci].text = inp.value; });
  }
  function renderChecklist() {
    q('#clBox').innerHTML = checklist.map(function (s, i) {
      return '<div class="cl-item">' +
        '<button class="cl-check' + (s.done ? ' on' : '') + '" data-ci="' + i + '" aria-label="Toggle step">' + (s.done ? '✓' : '') + '</button>' +
        '<input class="cl-text" data-ci="' + i + '" value="' + esc(s.text) + '" placeholder="Sub-step">' +
        '<button class="cl-del" data-ci="' + i + '" aria-label="Remove step">✕</button>' +
        '</div>';
    }).join('');
    q('#clBox').querySelectorAll('.cl-check').forEach(function (b) {
      b.onclick = function () { readChecklist(); const i = +b.dataset.ci; checklist[i].done = !checklist[i].done; renderChecklist(); };
    });
    q('#clBox').querySelectorAll('.cl-del').forEach(function (b) {
      b.onclick = function () { readChecklist(); checklist.splice(+b.dataset.ci, 1); renderChecklist(); };
    });
  }
  renderChecklist();

  q('#addStep').onclick = function () { readChecklist(); checklist.push({ id: uid(), text: '', done: false }); renderChecklist(); const inputs = $sheet.querySelectorAll('.cl-text'); if (inputs.length) inputs[inputs.length - 1].focus(); };
  q('#tStatusSeg').querySelectorAll('button').forEach(function (b) {
    b.onclick = function () { status = b.dataset.s; q('#tStatusSeg').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x.dataset.s === status); }); };
  });

  if (isEdit) {
    q('#delTask').onclick = function () {
      const idx = state.tasks.indexOf(existing);
      state.tasks = state.tasks.filter(function (x) { return x.id !== existing.id; });
      save();
      backToTab();
      showSnack('Job deleted', function () {
        state.tasks.splice(idx < 0 ? state.tasks.length : Math.min(idx, state.tasks.length), 0, existing);
        save();
        backToTab();
      });
    };
  }

  q('#saveTask').onclick = function () {
    readChecklist();
    const title = q('#tTitle').value.trim();
    if (!title) { q('#tTitle').focus(); showSnack('Give the job a title'); return; }
    const obj = {
      title: title,
      clientId: q('#tClient').value,
      deadline: q('#tDeadline').value || '',
      status: status,
      checklist: checklist.filter(function (s) { return s.text.trim(); }),
      notes: q('#tNotes').value.trim(),
    };
    if (status === 'done') obj.doneAt = (existing && existing.doneAt) || Date.now();
    if (isEdit) {
      const i = state.tasks.findIndex(function (x) { return x.id === existing.id; });
      if (i !== -1) state.tasks[i] = Object.assign({}, existing, obj);
    } else {
      state.tasks.push(Object.assign({ id: uid(), createdAt: Date.now() }, obj));
    }
    save();
    requestPersist();
    backToTab();
    showSnack('Job saved');
  };
}

/* ---------- Reminders ---------- */

function reminderRowHTML(r) {
  return '<div class="rem-row' + (r.enabled ? '' : ' off') + '">' +
    '<button class="rem-main" data-rem="' + r.id + '">' +
    '<span class="entry-title">' + esc(r.title) + '</span>' +
    '<span class="entry-sub">' + FREQ_LABEL[r.freq] + (r.enabled && r.nextDue ? ' · next ' + esc(fmtDate(r.nextDue)) : '') + '</span></button>' +
    '<button class="toggle' + (r.enabled ? ' on' : '') + '" data-toggle="' + r.id + '">' + (r.enabled ? 'On' : 'Off') + '</button>' +
    '</div>';
}

function renderRemindersTab() {
  const rs = state.reminders.slice().sort(function (a, b) {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return (a.nextDue || '').localeCompare(b.nextDue || '');
  });
  let html = '<p class="fineprint">Reminders appear in <b>Today</b> when due. They don’t buzz your phone (a browser app can’t without a server). Switch on the ones you want.</p>';
  html += rs.length ? rs.map(reminderRowHTML).join('') : '<div class="empty">No reminders.</div>';
  $view.innerHTML = html;
  $view.querySelectorAll('.rem-main').forEach(function (b) {
    b.onclick = function () { const r = state.reminders.find(function (x) { return x.id === b.dataset.rem; }); if (r) openReminderForm(r); };
  });
  $view.querySelectorAll('.toggle').forEach(function (b) {
    b.onclick = function () {
      const r = state.reminders.find(function (x) { return x.id === b.dataset.toggle; });
      if (r) { r.enabled = !r.enabled; save(); renderRemindersTab(); }
    };
  });
}

function openReminderForm(existing) {
  const isEdit = !!existing;
  const r = existing || { title: '', freq: 'monthly', enabled: true, nextDue: todayISO(), notes: '' };
  let freq = r.freq || 'monthly';
  $sheet.innerHTML =
    '<div class="sheet-inner">' +
    '<div class="sheet-head"><button class="close-btn" id="closeSheet" aria-label="Close">✕</button><h2>' + (isEdit ? 'Edit reminder' : 'New reminder') + '</h2>' +
    (isEdit ? '<button class="danger-link" id="delRem">Delete</button>' : '') + '</div>' +
    field('Title', 'rTitle', r.title, 'e.g. CPF payment') +
    '<div class="field"><span>Repeat</span><div class="chips" id="rFreq">' +
    REMINDER_FREQS.map(function (f) { return '<button class="chip' + (f[0] === freq ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '</button>'; }).join('') +
    '</div></div>' +
    '<label class="field"><span>Next due</span><input type="date" id="rNext" value="' + (r.nextDue || todayISO()) + '"></label>' +
    '<label class="field"><span>Notes</span><textarea id="rNotes" class="li-desc" rows="2" placeholder="Optional">' + esc(r.notes || '') + '</textarea></label>' +
    (isEdit ? '<button class="btn big" id="rDone">Mark done → next ' + FREQ_LABEL[freq].toLowerCase() + '</button>' : '') +
    '<button class="btn ghost big" id="saveRem">Save reminder</button>' +
    '</div>';
  $sheet.classList.remove('hidden');
  $sheet.scrollTop = 0;
  const q = function (s) { return $sheet.querySelector(s); };
  q('#closeSheet').onclick = backToTab;
  q('#rFreq').querySelectorAll('.chip').forEach(function (b) {
    b.onclick = function () { freq = b.dataset.f; q('#rFreq').querySelectorAll('.chip').forEach(function (x) { x.classList.toggle('on', x.dataset.f === freq); }); };
  });

  const rDone = q('#rDone');
  if (rDone) rDone.onclick = function () {
    const cur = q('#rNext').value || todayISO();
    existing.nextDue = advanceDate(cur, freq);
    existing.freq = freq;
    save();
    backToTab();
    showSnack('Done — next on ' + fmtDate(existing.nextDue));
  };

  if (isEdit) {
    q('#delRem').onclick = function () {
      const idx = state.reminders.indexOf(existing);
      state.reminders = state.reminders.filter(function (x) { return x.id !== existing.id; });
      save();
      backToTab();
      showSnack('Reminder deleted', function () {
        state.reminders.splice(idx < 0 ? state.reminders.length : Math.min(idx, state.reminders.length), 0, existing);
        save();
        backToTab();
      });
    };
  }

  q('#saveRem').onclick = function () {
    const title = q('#rTitle').value.trim();
    if (!title) { q('#rTitle').focus(); showSnack('Give the reminder a title'); return; }
    const obj = { title: title, freq: freq, nextDue: q('#rNext').value || todayISO(), notes: q('#rNotes').value.trim() };
    if (isEdit) {
      const i = state.reminders.findIndex(function (x) { return x.id === existing.id; });
      if (i !== -1) state.reminders[i] = Object.assign({}, existing, obj);
    } else {
      state.reminders.push(Object.assign({ id: uid(), enabled: true, createdAt: Date.now() }, obj));
    }
    save();
    requestPersist();
    backToTab();
    showSnack('Reminder saved');
  };
}

/* ---------- Contacts ---------- */

function renderContactsTab() {
  const all = sortedClients();
  const filtered = all.filter(function (c) {
    if (contactFilter === 'all') return true;
    if (contactFilter === 'client') return c.kind !== 'vendor';
    return c.kind === 'vendor' || c.kind === 'both';
  });
  let html =
    '<div class="chips chips-margin" id="cFilter">' +
    [['all', 'All'], ['client', 'Clients'], ['vendor', 'Vendors']].map(function (f) {
      return '<button class="chip' + (f[0] === contactFilter ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '</button>';
    }).join('') +
    '</div>';
  html += filtered.length ? filtered.map(clientRowHTML).join('')
    : '<div class="empty">No contacts here.<br>Tap <b>+</b> to add one.</div>';
  $view.innerHTML = html;
  $view.querySelectorAll('#cFilter .chip').forEach(function (b) {
    b.onclick = function () { contactFilter = b.dataset.f; renderContactsTab(); };
  });
  $view.querySelectorAll('.entry[data-client]').forEach(function (btn) {
    btn.onclick = function () { const c = contactById(btn.dataset.client); if (c) openClientForm(c, backToTab); };
  });
}

/* ===================== Personal Assistant module ===================== */

function meetingById(id) { return state.meetings.find(function (m) { return m.id === id; }); }
function meetingActionTasks(meetingId) { return state.tasks.filter(function (t) { return t.meetingId === meetingId; }); }
function followupTasks() { return state.tasks.filter(function (t) { return !!t.meetingId; }); }
function meetingAttendeeNames(m) { return (m.contactIds || []).map(function (id) { return contactName(id); }).filter(Boolean); }

/* ---------- Agenda ---------- */

function renderAgenda() {
  const today = todayISO();
  const in7 = addDays(today, 7);
  const items = [];
  state.tasks.forEach(function (t) { if (t.status !== 'done' && t.deadline) items.push({ date: t.deadline, type: 'task', obj: t }); });
  state.reminders.forEach(function (r) { if (r.enabled && r.nextDue) items.push({ date: r.nextDue, type: 'reminder', obj: r }); });
  state.meetings.forEach(function (m) { if (m.date && m.date >= today) items.push({ date: m.date, type: 'meeting', obj: m }); });
  items.sort(function (a, b) { return a.date.localeCompare(b.date); });

  const buckets = [
    ['Overdue', items.filter(function (i) { return i.date < today; })],
    ['Today', items.filter(function (i) { return i.date === today; })],
    ['Next 7 days', items.filter(function (i) { return i.date > today && i.date <= in7; })],
    ['Later', items.filter(function (i) { return i.date > in7; }).slice(0, 25)],
  ];
  let html;
  if (!items.length) html = '<div class="empty">Nothing on your agenda.<br>Log a meeting, or add tasks and reminders in Admin.</div>';
  else html = buckets.map(function (b) { return b[1].length ? '<h3 class="sec">' + b[0] + '</h3>' + b[1].map(agendaRowHTML).join('') : ''; }).join('');
  $view.innerHTML = html;
  wireAgendaRows($view);
}

function agendaRowHTML(item) {
  if (item.type === 'meeting') {
    const m = item.obj;
    const who = meetingAttendeeNames(m).join(', ');
    return '<button class="entry" data-meeting="' + m.id + '">' +
      '<span class="entry-main"><span class="entry-title">📅 ' + esc(m.title || 'Meeting') + '</span>' +
      '<span class="entry-sub">' + esc(who || 'No attendees') + ' · ' + esc(fmtDate(item.date)) + '</span></span>' +
      '<span class="badge ' + dateClass(item.date) + '">' + dueLabel(item.date) + '</span></button>';
  }
  return todayRowHTML(item);
}

function wireAgendaRows(root) {
  root.querySelectorAll('.entry[data-task]').forEach(function (b) { b.onclick = function () { const t = state.tasks.find(function (x) { return x.id === b.dataset.task; }); if (t) openTaskForm(t); }; });
  root.querySelectorAll('.entry[data-reminder]').forEach(function (b) { b.onclick = function () { const r = state.reminders.find(function (x) { return x.id === b.dataset.reminder; }); if (r) openReminderForm(r); }; });
  root.querySelectorAll('.entry[data-meeting]').forEach(function (b) { b.onclick = function () { const m = meetingById(b.dataset.meeting); if (m) openMeetingForm(m); }; });
}

/* ---------- Meetings ---------- */

function meetingRowHTML(m) {
  const who = meetingAttendeeNames(m).join(', ');
  const open = meetingActionTasks(m.id).filter(function (t) { return t.status !== 'done'; }).length;
  const sub = [esc(fmtDate(m.date))];
  if (who) sub.push(esc(who));
  return '<button class="entry" data-meeting="' + m.id + '">' +
    '<span class="entry-main"><span class="entry-title">' + esc(m.title || 'Meeting') + '</span>' +
    '<span class="entry-sub">' + sub.join(' · ') + '</span></span>' +
    (open ? '<span class="badge soon">' + open + ' open</span>' : '') + '</button>';
}

function renderMeetingsTab() {
  const ms = state.meetings.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0); });
  $view.innerHTML = ms.length ? ms.map(meetingRowHTML).join('') : '<div class="empty">No meetings yet.<br>Tap <b>+</b> to log one with notes and follow-ups.</div>';
  $view.querySelectorAll('.entry[data-meeting]').forEach(function (b) { b.onclick = function () { const m = meetingById(b.dataset.meeting); if (m) openMeetingForm(m); }; });
}

// Sync the in-memory action-item list back to tasks (each is a task with meetingId).
function syncMeetingActions(m, actions) {
  const before = meetingActionTasks(m.id);
  const kept = [];
  actions.forEach(function (a) {
    if (!a.title.trim()) return;
    if (a.taskId) {
      const t = state.tasks.find(function (x) { return x.id === a.taskId; });
      if (t) {
        t.title = a.title.trim();
        t.deadline = a.deadline || '';
        t.clientId = (m.contactIds || [])[0] || '';
        if (a.done) { t.status = 'done'; t.doneAt = t.doneAt || Date.now(); }
        else { if (t.status === 'done') { t.status = 'todo'; } delete t.doneAt; }
        kept.push(t.id);
      }
    } else {
      const nt = { id: uid(), title: a.title.trim(), clientId: (m.contactIds || [])[0] || '', deadline: a.deadline || '', status: a.done ? 'done' : 'todo', checklist: [], notes: '', meetingId: m.id, createdAt: Date.now() };
      if (a.done) nt.doneAt = Date.now();
      state.tasks.push(nt);
      kept.push(nt.id);
    }
  });
  before.forEach(function (t) { if (kept.indexOf(t.id) === -1) state.tasks = state.tasks.filter(function (x) { return x.id !== t.id; }); });
}

function openMeetingForm(existing) {
  const isEdit = !!existing;
  const m = existing || { id: uid(), date: todayISO(), title: '', contactIds: [], notes: '', createdAt: Date.now() };
  let contactIds = (m.contactIds || []).slice();
  let actions = meetingActionTasks(m.id).map(function (t) { return { taskId: t.id, title: t.title, deadline: t.deadline || '', done: t.status === 'done' }; });

  $sheet.innerHTML =
    '<div class="sheet-inner">' +
    '<div class="sheet-head"><button class="close-btn" id="closeSheet" aria-label="Close">✕</button><h2>' + (isEdit ? 'Edit meeting' : 'New meeting') + '</h2>' +
    (isEdit ? '<button class="danger-link" id="delMeeting">Delete</button>' : '') + '</div>' +
    '<label class="field"><span>Date</span><input type="date" id="mDate" value="' + (m.date || todayISO()) + '"></label>' +
    field('Title (optional)', 'mTitle', m.title, 'e.g. Q3 planning') +
    '<div class="field"><span>Who</span><div class="chips chips-margin" id="attChips"></div>' +
    '<select id="attAdd"></select></div>' +
    '<label class="field"><span>Notes</span><textarea id="mNotes" class="li-desc" rows="5" placeholder="What was discussed">' + esc(m.notes || '') + '</textarea></label>' +
    '<div class="field"><span>Action items / follow-ups</span><div id="aiBox"></div>' +
    '<button class="btn ghost" id="addAction">+ Add action item</button></div>' +
    '<button class="btn big" id="saveMeeting">Save meeting</button>' +
    '</div>';
  $sheet.classList.remove('hidden');
  $sheet.scrollTop = 0;
  const q = function (s) { return $sheet.querySelector(s); };
  q('#closeSheet').onclick = backToTab;

  function renderAttendees() {
    q('#attChips').innerHTML = contactIds.length
      ? contactIds.map(function (id) { const c = contactById(id); return '<button class="chip on" data-att="' + id + '">' + esc(c ? clientLabel(c) : '?') + ' ✕</button>'; }).join('')
      : '<span class="fineprint">No attendees yet.</span>';
    q('#attChips').querySelectorAll('[data-att]').forEach(function (b) {
      b.onclick = function () { contactIds = contactIds.filter(function (x) { return x !== b.dataset.att; }); renderAttendees(); };
    });
    const avail = sortedClients().filter(function (c) { return c.name && c.name.trim() && contactIds.indexOf(c.id) === -1; });
    q('#attAdd').innerHTML = '<option value="">+ Add attendee…</option>' + avail.map(function (c) { return '<option value="' + c.id + '">' + esc(clientLabel(c)) + '</option>'; }).join('');
  }
  q('#attAdd').onchange = function () { if (q('#attAdd').value) { contactIds.push(q('#attAdd').value); renderAttendees(); } };
  renderAttendees();

  function readActions() {
    $sheet.querySelectorAll('.ai-card').forEach(function (card) {
      const i = +card.dataset.i;
      actions[i].title = card.querySelector('.ai-title').value;
      actions[i].deadline = card.querySelector('.ai-date').value;
    });
  }
  function renderActions() {
    q('#aiBox').innerHTML = actions.map(function (a, i) {
      return '<div class="ai-card" data-i="' + i + '">' +
        '<input class="ai-title" placeholder="Action item / follow-up" value="' + esc(a.title) + '">' +
        '<div class="ai-row">' +
        '<button class="ai-done' + (a.done ? ' on' : '') + '" data-ai="' + i + '">' + (a.done ? '✓ Done' : 'Open') + '</button>' +
        '<input type="date" class="ai-date" value="' + (a.deadline || '') + '">' +
        '<button class="ai-del" data-ai="' + i + '" aria-label="Remove">✕</button>' +
        '</div></div>';
    }).join('');
    q('#aiBox').querySelectorAll('.ai-done').forEach(function (b) { b.onclick = function () { readActions(); actions[+b.dataset.ai].done = !actions[+b.dataset.ai].done; renderActions(); }; });
    q('#aiBox').querySelectorAll('.ai-del').forEach(function (b) { b.onclick = function () { readActions(); actions.splice(+b.dataset.ai, 1); renderActions(); }; });
  }
  renderActions();
  q('#addAction').onclick = function () { readActions(); actions.push({ title: '', deadline: '', done: false }); renderActions(); const t = $sheet.querySelectorAll('.ai-title'); if (t.length) t[t.length - 1].focus(); };

  if (isEdit) {
    q('#delMeeting').onclick = function () {
      const idx = state.meetings.indexOf(existing);
      state.meetings = state.meetings.filter(function (x) { return x.id !== existing.id; });
      save();
      backToTab();
      showSnack('Meeting deleted', function () {
        state.meetings.splice(idx < 0 ? state.meetings.length : Math.min(idx, state.meetings.length), 0, existing);
        save();
        backToTab();
      });
    };
  }

  q('#saveMeeting').onclick = function () {
    readActions();
    m.date = q('#mDate').value || todayISO();
    m.title = q('#mTitle').value.trim();
    m.contactIds = contactIds;
    m.notes = q('#mNotes').value.trim();
    if (!isEdit) state.meetings.push(m);
    syncMeetingActions(m, actions);
    save();
    requestPersist();
    backToTab();
    showSnack('Meeting saved');
  };
}

/* ---------- Follow-ups ---------- */

function followupRowHTML(t) {
  const m = t.meetingId ? meetingById(t.meetingId) : null;
  const src = m ? (m.title || 'Meeting') + ' · ' + fmtDate(m.date) : 'From a past meeting';
  const sub = [src];
  if (t.deadline) sub.push(fmtDate(t.deadline));
  const done = t.status === 'done';
  return '<div class="fu-row' + (done ? ' done' : '') + '">' +
    '<button class="fu-check' + (done ? ' on' : '') + '" data-fucheck="' + t.id + '" aria-label="Toggle done">' + (done ? '✓' : '') + '</button>' +
    '<button class="fu-main" data-fu="' + t.id + '">' +
    '<span class="entry-title">' + esc(t.title || '(untitled)') + '</span>' +
    '<span class="entry-sub">' + esc(sub.join(' · ')) + '</span></button>' +
    (t.deadline && !done ? '<span class="badge ' + dateClass(t.deadline) + '">' + dueLabel(t.deadline) + '</span>' : '') +
    '</div>';
}

function renderFollowupsTab() {
  const fus = followupTasks();
  const open = fus.filter(function (t) { return t.status !== 'done'; }).sort(function (a, b) { return (a.deadline || '9999').localeCompare(b.deadline || '9999'); });
  const done = fus.filter(function (t) { return t.status === 'done'; });
  let html = '<p class="fineprint">Action items from your meetings. Tick to mark done, or tap to edit.</p>';
  if (!fus.length) html += '<div class="empty">No follow-ups yet.<br>Add action items inside a meeting.</div>';
  else {
    if (open.length) html += '<h3 class="sec">Open (' + open.length + ')</h3>' + open.map(followupRowHTML).join('');
    if (done.length) html += '<h3 class="sec">Done (' + done.length + ')</h3>' + done.slice(0, 25).map(followupRowHTML).join('');
  }
  $view.innerHTML = html;
  $view.querySelectorAll('.fu-check').forEach(function (b) {
    b.onclick = function () {
      const t = state.tasks.find(function (x) { return x.id === b.dataset.fucheck; });
      if (!t) return;
      if (t.status === 'done') { t.status = 'todo'; delete t.doneAt; }
      else { t.status = 'done'; t.doneAt = Date.now(); }
      save();
      renderFollowupsTab();
    };
  });
  $view.querySelectorAll('.fu-main').forEach(function (b) {
    b.onclick = function () { const t = state.tasks.find(function (x) { return x.id === b.dataset.fu; }); if (t) openTaskForm(t); };
  });
}

/* ===================== Init ===================== */

document.getElementById('homeBtn').onclick = goHome;

ensureClientsSeed();
ensureRemindersSeed();
requestPersist();
render();
refreshPersistStatus(function () { if (view.module === 'accountant' && view.tab === 'export') renderExport(); });
maybePromptBackup();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(function () {});
}
