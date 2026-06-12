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
      return d;
    }
  } catch (err) { /* corrupt data — start fresh, backups are the safety net */ }
  return { version: 1, entries: [], settings: {} };
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
    state = data;
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

/* ===================== Init ===================== */

document.querySelectorAll('.tab').forEach(function (b) {
  b.onclick = function () { view.tab = b.dataset.tab; render(); };
});

document.getElementById('fab').onclick = function () { openSheet(); };

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(function () {});
}
