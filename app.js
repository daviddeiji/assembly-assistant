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
let view = { tab: 'month', ym: thisYM(), query: '' };
let persistAsked = false;

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_KEY));
    if (d && d.version === 1 && Array.isArray(d.entries)) {
      d.settings = d.settings || {};
      d.invoices = Array.isArray(d.invoices) ? d.invoices : [];
      d.clients = Array.isArray(d.clients) ? d.clients : [];
      return d;
    }
  } catch (err) { /* corrupt data — start fresh, backups are the safety net */ }
  return { version: 1, entries: [], invoices: [], clients: [], settings: {} };
}

function save() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function requestPersist() {
  if (!persistAsked && navigator.storage && navigator.storage.persist) {
    persistAsked = true;
    navigator.storage.persist().catch(function () {});
  }
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

function render() {
  document.querySelectorAll('.tab').forEach(function (b) {
    b.classList.toggle('active', b.dataset.tab === view.tab);
  });
  if (view.tab === 'month') renderMonth();
  else if (view.tab === 'history') renderHistory();
  else if (view.tab === 'invoice') renderInvoiceTab();
  else renderExport();
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
  if (!state.entries.length) return '';
  const last = state.settings.lastBackup;
  if (last) {
    const days = Math.floor((Date.now() - new Date(last + 'T00:00:00').getTime()) / 86400000);
    if (days < 14) return '';
    return '<button class="banner" id="goExport">💾 Last backup was ' + days + ' days ago — tap to back up</button>';
  }
  return '<button class="banner" id="goExport">💾 No backup yet — tap to back up your data</button>';
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
  const banner = document.getElementById('goExport');
  if (banner) banner.onclick = function () { view.tab = 'export'; render(); };
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
  const last = state.settings.lastBackup;
  const none = state.entries.length === 0;
  $view.innerHTML =
    '<div class="card"><h3>Excel export</h3>' +
    '<p>One spreadsheet with every entry plus a month-by-month P&amp;L summary. Opens in Excel or Google Sheets.</p>' +
    '<button id="xlsxBtn" class="btn"' + (none ? ' disabled' : '') + '>Download .xlsx</button></div>' +

    '<div class="card"><h3>CSV export</h3>' +
    '<p>A plain table of all entries — also opens in Excel.</p>' +
    '<button id="csvBtn" class="btn ghost"' + (none ? ' disabled' : '') + '>Download .csv</button></div>' +

    '<div class="card"><h3>Backup &amp; restore</h3>' +
    '<p>Your data lives only on this device. The backup file restores everything if you switch phones or clear Chrome’s data.<br><b>Last backup:</b> ' + (last ? fmtDate(last) : 'never') + '</p>' +
    '<button id="backupBtn" class="btn"' + (none ? ' disabled' : '') + '>Download backup</button>' +
    '<button id="restoreBtn" class="btn ghost">Restore from file</button>' +
    '<input type="file" id="restoreFile" accept="application/json,.json" hidden></div>' +

    '<p class="fineprint">Tip: back up at least every two weeks. The file lands in your Downloads folder — keep a copy in Google Drive or email it to yourself.</p>';

  document.getElementById('xlsxBtn').onclick = exportXlsx;
  document.getElementById('csvBtn').onclick = exportCsv;
  document.getElementById('backupBtn').onclick = downloadBackup;
  const fileInput = document.getElementById('restoreFile');
  document.getElementById('restoreBtn').onclick = function () { fileInput.click(); };
  fileInput.onchange = function () { restoreBackup(fileInput.files[0]); fileInput.value = ''; };
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
  state.settings.lastBackup = todayISO();
  save();
  renderExport();
  showSnack('Backup downloaded');
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
    data.settings = data.settings || {};
    data.invoices = Array.isArray(data.invoices) ? data.invoices : [];
    data.clients = Array.isArray(data.clients) ? data.clients : [];
    state = data;
    ensureClientsSeed();
    save();
    view.ym = thisYM();
    render();
    showSnack('Backup restored');
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

function clientRowHTML(c) {
  const sub = [];
  if (c.uen) sub.push(c.uen);
  sub.push('Net ' + (c.terms != null ? c.terms : 30));
  if (!(c.name && c.name.trim())) sub.push('unnamed');
  return '<button class="entry" data-client="' + c.id + '">' +
    '<span class="entry-main"><span class="entry-title">' + esc(clientLabel(c)) + '</span>' +
    '<span class="entry-sub">' + esc(sub.join(' · ')) + '</span></span>' +
    '<span class="entry-amt" style="font-size:12px;color:var(--muted);font-weight:600">' + esc(clientRef(c)) + '</span>' +
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

function openClientForm(existing) {
  const isEdit = !!existing;
  const c = existing || { name: '', uen: '', addr1: '', addr2: '', attn: '', terms: 30 };
  const refLabel = isEdit ? clientRef(existing) : ('Client #' + String((state.settings.clientSeq || 0) + 1).padStart(3, '0'));
  $sheet.innerHTML =
    '<div class="sheet-inner">' +
    '<div class="sheet-head"><button class="close-btn" id="closeSheet" aria-label="Close">✕</button>' +
    '<h2>' + (isEdit ? 'Edit client' : 'New client') + '</h2>' +
    (isEdit ? '<button class="danger-link" id="delClient">Delete</button>' : '') + '</div>' +
    '<p class="fineprint">Reference: <b>' + esc(refLabel) + '</b> — used until you enter a name.</p>' +
    field('Client name', 'kName', c.name, 'Leave blank to use ' + refLabel) +
    field('UEN', 'kUen', c.uen, 'Registration no.') +
    field('Address line 1', 'kAddr1', c.addr1, 'Street, unit') +
    field('Address line 2', 'kAddr2', c.addr2, 'Postal / country') +
    field('Attention (optional)', 'kAttn', c.attn, 'Contact person') +
    field('Default payment terms (days)', 'kTerms', String(c.terms != null ? c.terms : 30), '30') +
    '<button class="btn big" id="saveClient">Save client</button>' +
    '</div>';
  $sheet.classList.remove('hidden');
  $sheet.scrollTop = 0;
  const q = function (s) { return $sheet.querySelector(s); };
  q('#closeSheet').onclick = openClientsList;
  if (isEdit) {
    q('#delClient').onclick = function () {
      state.clients = state.clients.filter(function (x) { return x.id !== existing.id; });
      save();
      openClientsList();
      showSnack('Client deleted');
    };
  }
  q('#saveClient').onclick = function () {
    const t = parseInt(q('#kTerms').value, 10);
    const obj = {
      name: q('#kName').value.trim(), uen: q('#kUen').value.trim(),
      addr1: q('#kAddr1').value.trim(), addr2: q('#kAddr2').value.trim(),
      attn: q('#kAttn').value.trim(), terms: isNaN(t) ? 30 : t,
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
    openClientsList();
    showSnack('Client saved');
  };
}

/* ---------- Invoice tab ---------- */

function invRowHTML(inv) {
  return '<button class="entry" data-inv="' + inv.id + '">' +
    '<span class="entry-main"><span class="entry-title">' + esc(inv.number) + ' · ' + esc(inv.client.name) + '</span>' +
    '<span class="entry-sub">' + esc(fmtDate(inv.date)) + (inv.gstMode === 'registered' ? ' · GST' : '') + '</span></span>' +
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
    field('Show note when client name contains', 'cNoteClient', c.noteClient, 'e.g. a client short-code') +
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
  if (!prefill && state.invoices.length) {
    const last = state.invoices.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); })[0];
    prefill = { client: last.client, lineItems: last.lineItems, gstMode: last.gstMode, terms: last.terms };
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
  $sheet.innerHTML =
    '<div class="sheet-inner">' +
    '<div class="sheet-head"><button class="close-btn" id="closeSheet" aria-label="Close">✕</button><h2>' + esc(inv.number) + '</h2></div>' +
    '<div class="card"><h3>' + esc(inv.client.name) + '</h3>' +
    '<p>' + esc(fmtDate(inv.date)) + ' · Due ' + esc(fmtDate(inv.dueDate)) + ' · Net ' + inv.terms + '</p></div>' +
    '<h3 class="sec">Items</h3>' + lines +
    '<div class="inv-totals">' +
    '<div class="pnl-row"><span>Subtotal</span><span>' + fmtMoney(inv.subtotal) + '</span></div>' +
    '<div class="pnl-row"><span>' + (inv.gstMode === 'registered' ? 'GST (9%)' : 'GST (not applicable)') + '</span><span>' + fmtMoney(inv.gst) + '</span></div>' +
    '<div class="pnl-row net"><span>Total</span><span>' + fmtMoney(inv.total) + '</span></div></div>' +
    '<button class="btn big" id="reDl">Download .xlsx again</button>' +
    '<button class="btn ghost big" id="dupInv">Duplicate as new invoice</button>' +
    '<p class="fineprint">Re-downloading does not log income again. Duplicating starts a new invoice with the next number.</p>' +
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

  // Line-item header (row 17)
  const head = { size: 9, bold: true, color: { argb: C_WHITE } };
  set('A17', 'No.', head, M, C_INK);
  set('B17', 'Description', head, L, C_INK);
  set('C17', 'Qty', head, M, C_INK);
  set('D17', 'Unit Price (SGD)', head, M, C_INK);
  set('E17', 'Amount (SGD)', head, M, C_INK);

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
  const totFont = { size: 11, bold: true, color: { argb: C_WHITE } };
  set('D29', 'TOTAL (SGD)', totFont, R, C_GOLD);
  set('E29', undefined, totFont, R, C_GOLD, NUMFMT).value = { formula: 'E27+E28', result: +(inv.total / 100).toFixed(2) };

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

/* ===================== Init ===================== */

document.querySelectorAll('.tab').forEach(function (b) {
  b.onclick = function () { view.tab = b.dataset.tab; render(); };
});

document.getElementById('fab').onclick = function () { openSheet(); };

ensureClientsSeed();
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(function () {});
}
