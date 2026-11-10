/* GoodsGuru Upload centre: update stock, sales speed and items from Excel/CSV files (Tally exports or the GoodsGuru template).
   Nothing is written until you press the confirm button. Files are read in the browser and never stored. */
(function () {
  'use strict';
  var P = window.PAGES; if (!P) return;
  var XLS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  var xp = null;
  function loadX() {
    if (window.XLSX) return Promise.resolve();
    if (xp) return xp;
    xp = new Promise(function (ok, no) {
      var s = document.createElement('script'); s.src = XLS; s.onload = ok;
      s.onerror = function () { xp = null; no(new Error('Could not load the Excel reader. Check the internet and try again.')); };
      document.head.appendChild(s);
    });
    return xp;
  }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(x) { return Number(x).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function toNum(x) {
    if (typeof x === 'number') return isFinite(x) ? x : null;
    if (x == null) return null;
    var s = String(x).trim(); if (!s) return null;
    var neg = /^\(.*\)$/.test(s) || /^\(-\)/.test(s) || /^-/.test(s);
    s = s.replace(/[^0-9.]/g, ''); if (!s || s === '.') return null;
    var n = parseFloat(s); return isFinite(n) ? (neg ? -n : n) : null;
  }

  /* ---------- read a file into { cols:[labels], rows:[[cells]] } ---------- */
  function period(all) {
    var M = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    for (var i = 0; i < Math.min(all.length, 30); i++) {
      var m = String(all[i][0] || all[i][2] || '').match(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+to\s+(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
      if (m) { var y1 = +m[3] < 100 ? 2000 + +m[3] : +m[3], y2 = +m[6] < 100 ? 2000 + +m[6] : +m[6]; var a = Date.UTC(y1, M[m[2].toLowerCase()], +m[1]), b = Date.UTC(y2, M[m[5].toLowerCase()], +m[4]); if (b >= a) return { days: Math.round((b - a) / 864e5) + 1, to: m[4] + '-' + m[5] + '-' + m[6] }; }
    }
    return null;
  }
  function header(all) {
    var hr = -1, i;
    for (i = 0; i < Math.min(all.length, 40); i++) {
      var r = all[i].map(function (c) { return String(c).trim(); });
      if (r.filter(Boolean).length >= 2 && r.some(function (c) { return /^(particulars|item\s*code|code|item\s*name|item|name|product|description|sku)/i.test(c); })) { hr = i; break; }
    }
    if (hr < 0) hr = 0;
    var h1 = (all[hr] || []).map(function (c) { return String(c).trim(); }), s = -1;
    for (i = hr + 1; i <= Math.min(hr + 4, all.length - 1); i++) {
      var q = all[i].filter(function (c) { return /^(quantity|qty)$/i.test(String(c).trim()); }).length;
      if (q >= 1 && all[i].filter(function (c) { return /^(rate|value|amount|gross value)$/i.test(String(c).trim()); }).length >= 1) { s = i; break; }
    }
    var cols = [], start;
    if (s < 0) { cols = h1.map(function (c, k) { return c || ('Column ' + (k + 1)); }); start = hr + 1; }
    else {
      var sub = all[s].map(function (c) { return String(c).trim(); }), grp = (all[s - 1] || []).map(function (c) { return String(c).trim(); }), carry = '', w = Math.max(sub.length, h1.length);
      for (var k = 0; k < w; k++) {
        if (grp[k] && s - 1 > hr) carry = grp[k];
        var lab = sub[k] ? (carry + ' ' + sub[k]).trim() : (h1[k] || '');
        cols.push(lab || ('Column ' + (k + 1)));
      }
      start = s + 1;
    }
    return { cols: cols, rows: all.slice(start) };
  }
  async function readFile(file) {
    await loadX();
    var wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var all = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    var h = header(all); h.name = file.name; h.period = period(all);
    return h;
  }
  /* Tally puts the item code at the end of the name ("Paneer 200g D3815"). Brand lines and batch lines have no code, so they are skipped. */
  var TAIL = /\b([A-Za-z]{1,2}\d{3,5})\s*$/;
  function resolver(data, A, byCode, find) {
    var n = 0, hit = 0;
    data.rows.forEach(function (r) { var s = String(r[A] == null ? '' : r[A]).trim(); if (s) { n++; if (TAIL.test(s)) hit++; } });
    var tally = n > 0 && hit / n > 0.2;
    return function (idv) {
      var s = String(idv == null ? '' : idv).trim(); if (!s) return { skip: 1 };
      if (/^(grand total|total)/i.test(s)) return { skip: 1 };
      if (tally) { var m = s.match(TAIL); if (!m) return { skip: 1 }; var it = byCode[m[1].toUpperCase()] || find(s); return it ? { it: it, t: 1 } : { un: s }; }
      var it2 = find(s); return it2 ? { it: it2 } : { un: s };
    };
  }
  function pick(cols, re, last) {
    var f = -1; cols.forEach(function (c, i) { if (re.test(c)) { if (last || f < 0) f = i; } });
    return f;
  }
  function opts(cols, sel) { return cols.map(function (c, i) { return '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join(''); }

  /* ---------- template download ---------- */
  async function template(kind, items) {
    await loadX();
    var X = window.XLSX, sample = items.slice(0, 5), aoa, nm;
    if (kind === 'stock') { nm = 'GoodsGuru_stock_template.xlsx'; aoa = [['Item Code', 'Item Name', 'Quantity']].concat(sample.map(function (i) { return [i.code, i.name, 0]; })); }
    else if (kind === 'sales') { nm = 'GoodsGuru_sales_template.xlsx'; aoa = [['Item Code', 'Item Name', 'Quantity Sold']].concat(sample.map(function (i) { return [i.code, i.name, 0]; })); }
    else { nm = 'GoodsGuru_items_template.xlsx'; aoa = [['Item Code', 'Item Name', 'Group', 'Unit', 'Lead Time Days', 'MOQ', 'Daily Sales Start']].concat(sample.map(function (i) { return [i.code, i.name, i.group_name || '', i.unit || 'pcs', i.lead_time_days, i.moq, i.seed_daily_usage]; })); }
    var wb = X.utils.book_new(), ws = X.utils.aoa_to_sheet(aoa);
    ws['!cols'] = aoa[0].map(function () { return { wch: 22 }; });
    X.utils.book_append_sheet(wb, ws, 'GoodsGuru');
    X.writeFile(wb, nm);
  }


  /* read EVERY sheet of a workbook -> { sheetNameLower: {cols, rows} } */
  function tabulate(all) {
    var hr = -1, i;
    for (i = 0; i < Math.min(all.length, 40); i++) {
      var r = all[i].map(function (c) { return String(c).trim(); });
      if (r.filter(Boolean).length >= 2 && r.some(function (c) { return /^(particulars|item\s*code|code|item\s*name|item|name|product|description|sku)/i.test(c); })) { hr = i; break; }
    }
    if (hr < 0) hr = 0;
    var cols = (all[hr] || []).map(function (c, k) { return String(c).trim() || ('Column ' + (k + 1)); });
    return { cols: cols, rows: all.slice(hr + 1) };
  }
  async function readBook(file) {
    await loadX();
    var wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' }), out = {};
    wb.SheetNames.forEach(function (n) { out[n.trim().toLowerCase()] = tabulate(window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' })); });
    return out;
  }
  async function masterTemplate(items, wh) {
    await loadX();
    var X = window.XLSX, wb = X.utils.book_new(), s5 = items.slice(0, 5);
    function add(name, aoa, w) { var ws = X.utils.aoa_to_sheet(aoa); ws['!cols'] = aoa[0].map(function (_, i) { return { wch: i < 2 ? 34 : (w || 16) }; }); X.utils.book_append_sheet(wb, ws, name); }
    add('README', [['GoodsGuru daily file'], [''], ['Stock sheet  : paste the quantity from Tally for each godown. Leave a cell EMPTY to keep GoodsGuru as it is. Type 0 only if Tally really says zero.'], ['Sales sheet  : optional, once a week. Quantity sold per item and how many days it covers.'], ['Items sheet  : optional, only when new items or lead times change.'], ['Item Code OR Item Name must match GoodsGuru. Extra rows are ignored.'], ['Then GoodsGuru > Upload > All in one > drop this file.']], 100);
    add('Stock', [['Item Code', 'Item Name'].concat(wh.map(function (w) { return w.code; }))].concat(s5.map(function (i) { return [i.code, i.name].concat(wh.map(function () { return ''; })); })), 12);
    add('Sales', [['Item Code', 'Item Name', 'Quantity Sold', 'Days Covered']].concat(s5.map(function (i) { return [i.code, i.name, '', 90]; })));
    add('Items', [['Item Code', 'Item Name', 'Group', 'Unit', 'Lead Time Days', 'MOQ', 'Daily Sales Start']].concat(s5.map(function (i) { return [i.code, i.name, i.group_name || '', i.unit || 'pcs', i.lead_time_days, i.moq, i.seed_daily_usage]; })));
    X.writeFile(wb, 'GoodsGuru_daily_file.xlsx');
  }

  P.upload = async function (v, c) {
    var env = P.__env(), ctx = c, D = env.D;
    var core;
    try { core = await P.__core(); } catch (e) { v.innerHTML = '<div class="card2"><h3>Could not load</h3><p>' + esc(e.message || e) + '</p></div>'; return; }
    env = P.__env(); D = env.D;
    var head = '<h1 class="page-h">Upload</h1><p class="page-s">Update GoodsGuru from your Tally files. You see a preview first, and nothing changes until you confirm. Files are read here in your browser and are not stored.</p>';
    if (!env.canManage()) { v.innerHTML = head + '<div class="card2"><p>Only admins and managers can upload. Ask the admin.</p></div>'; return; }

    var iby = {}, byCode = {}, byName = {}, bal = {}, wh = core.wh;
    core.items.forEach(function (i) { iby[i.id] = i; byCode[String(i.code).trim().toUpperCase()] = i; byName[norm(i.name)] = i; });
    core.bal.forEach(function (b) { (bal[b.item_id] = bal[b.item_id] || {})[b.warehouse_id] = Number(b.qty); });
    function find(idv) { var s = String(idv == null ? '' : idv).trim(); if (!s) return null; return byCode[s.toUpperCase()] || byName[norm(s)] || null; }

    var TAB = 'all', st = { stock: {}, sales: {}, items: {} };
    var HOW = {
      stock: '<ol class="how"><li>In Tally press <b>Alt+G</b>, type <b>Godown Summary</b>, press Enter.</li><li>Pick one godown (for example Okhla). You will see every item with its quantity.</li><li>Press <b>Alt+F2</b> and set the <b>To date</b> to today.</li><li>Press <b>Ctrl+E</b> (Export), choose <b>Excel (Spreadsheet)</b>, press Enter to save.</li><li>Repeat for each godown, then upload one file per godown below.</li></ol><p class="mu">Screens can look a little different in each Tally version. If one does, ask Anshu to show you the same report, or send me a screenshot.</p>',
      sales: '<ol class="how"><li>In Tally press <b>Alt+G</b>, type <b>Stock Summary</b>, press Enter.</li><li>Press <b>Alt+F2</b> and set the period: From = 90 days ago, To = today.</li><li>Press <b>F12</b> and set <b>Show Goods Outwards</b> to Yes.</li><li>Press <b>Ctrl+E</b>, choose <b>Excel (Spreadsheet)</b>, save.</li><li>Upload it here. If your Master Sale Report already has quantity sold per item, you can use that instead.</li></ol><p class="mu">Outwards also includes stock moved between godowns. Use the same period every time, and prefer the sales report if transfers are big.</p>',
      items: '<ol class="how"><li>Press <b>Download template</b> below. It already has a few of your real items to show the format.</li><li>Fill one row per item: code, name, group, unit, lead time days, MOQ, starting daily sales.</li><li>Upload it. Existing codes are updated, new codes are added, nothing is duplicated.</li></ol>'
    };

    function shell() {
      v.innerHTML = head +
        '<div class="chips" id="utabs">' + [['all', 'All in one file'], ['stock', 'Stock only'], ['sales', 'Sales speed only'], ['items', 'Item list only']].map(function (t) { return '<button type="button" class="fchip' + (t[0] === TAB ? ' on' : '') + '" data-b="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' +
        '<div class="card2 upc" id="upc"></div>';
      var tabs = v.querySelector('#utabs');
      tabs.onclick = function (e) { var b = e.target.closest('[data-b]'); if (!b) return; TAB = b.getAttribute('data-b'); [].forEach.call(tabs.children, function (x) { x.classList.toggle('on', x === b); }); panel(); };
      panel();
    }

    function drop(kind, extra) {
      return '<details class="howbox"><summary>How to get this file from Tally</summary>' + HOW[kind] + '</details>' +
        '<div class="upr">' + (extra || '') + '<button type="button" class="b2 inl ghost" id="utpl">Download template</button></div>' +
        '<label class="drop" id="udrop"><input type="file" id="ufile" accept=".xlsx,.xls,.xlx,.csv" hidden><b>Drop the Excel or CSV file here</b><span class="mu">or click to choose</span></label>' +
        '<div id="uout"></div>';
    }
    function wire(kind, onFile) {
      var d = v.querySelector('#udrop'), f = v.querySelector('#ufile');
      v.querySelector('#utpl').onclick = function () { template(kind, core.items).catch(function (e) { c.say(e.message); }); };
      function take(file) {
        if (!file) return;
        v.querySelector('#uout').innerHTML = '<p class="mu">Reading ' + esc(file.name) + '…</p>';
        readFile(file).then(function (data) { onFile(data); }).catch(function (e) { v.querySelector('#uout').innerHTML = '<p class="uerr">' + esc(e.message || e) + '</p>'; });
      }
      f.onchange = function () { take(f.files[0]); f.value = ''; };
      d.ondragover = function (e) { e.preventDefault(); d.classList.add('on'); };
      d.ondragleave = function () { d.classList.remove('on'); };
      d.ondrop = function (e) { e.preventDefault(); d.classList.remove('on'); take(e.dataTransfer.files[0]); };
    }
    function colPick(data, a, b, labA, labB) {
      return '<div class="upr"><label class="fl">' + labA + '<select class="inp sm" id="cA">' + opts(data.cols, a) + '</select></label><label class="fl">' + labB + '<select class="inp sm" id="cB">' + opts(data.cols, b) + '</select></label></div>';
    }
    function confirmBtn(btn, text, fn) {
      var t, armed = false;
      btn.textContent = text;
      btn.onclick = function () {
        if (!armed) { armed = true; btn.textContent = 'Click again to confirm'; btn.classList.add('danger'); t = setTimeout(function () { armed = false; btn.textContent = text; btn.classList.remove('danger'); }, 5000); return; }
        clearTimeout(t); btn.disabled = true; fn();
      };
    }
    async function pool(list, n, fn, prog) {
      var i = 0, done = 0, errs = [];
      async function w() { while (i < list.length) { var k = i++; try { await fn(list[k]); } catch (e) { errs.push({ k: list[k], e: e }); } done++; prog(done); } }
      var ws = []; for (var j = 0; j < n; j++) ws.push(w());
      await Promise.all(ws); return errs;
    }
    function unmatchedHtml(list) {
      if (!list.length) return '';
      return '<details class="howbox"><summary>' + list.length + ' row' + (list.length === 1 ? '' : 's') + ' not matched to any GoodsGuru item (ignored)</summary><p class="mu">' + list.slice(0, 40).map(esc).join(' · ') + (list.length > 40 ? ' …' : '') + '</p></details>';
    }
    function finish(kind, ok, errs, what) {
      P.__dirty();
      v.querySelector('#uout').innerHTML = '<div class="upok"><b>Done.</b> ' + ok + ' ' + what + ' updated.' + (errs.length ? ' <span class="uerr">' + errs.length + ' failed: ' + esc(errs.slice(0, 3).map(function (x) { return (x.k.code || '') + ' ' + (x.e && x.e.message || x.e); }).join('; ')) + '</span>' : '') + '</div>';
      P.__core(true).then(function (n) { core = n; }).catch(function () { });
    }

    /* ---------- 1. stock now ---------- */
    function panelStock() {
      var S = st.stock, up = c.demo || true;
      var wopts = wh.map(function (w) { return '<option value="' + esc(w.id) + '"' + (w.id === S.wh ? ' selected' : '') + '>' + esc(w.name || w.code) + ' (' + esc(w.code) + ')</option>'; }).join('');
      if (!S.wh && wh.length) S.wh = wh[0].id;
      $('#upc').innerHTML = '<div class="tag">Upload 1 of 3</div><h3>Stock now, one godown at a time</h3><p>Compares Tally with GoodsGuru for the godown you pick. You tick nothing: it shows only the differences and fixes them when you confirm.</p>' +
        drop('stock', '<label class="fl">Godown in this file<select class="inp sm" id="uwh">' + wh.map(function (w) { return '<option value="' + esc(w.id) + '"' + (w.id === S.wh ? ' selected' : '') + '>' + esc(w.name || w.code) + ' (' + esc(w.code) + ')</option>'; }).join('') + '</select></label>');
      v.querySelector('#uwh').onchange = function (e) { S.wh = e.target.value; if (S.data) show(); };
      wire('stock', function (data) {
        S.data = data;
        S.a = pick(data.cols, /^(item\s*code|code|sku)/i); if (S.a < 0) S.a = pick(data.cols, /particulars|item|name|description|product/i); if (S.a < 0) S.a = 0;
        S.b = pick(data.cols, /quantity|qty/i, true); if (S.b < 0) S.b = Math.min(1, data.cols.length - 1);
        show();
      });
      function show() {
        var data = S.data, out = v.querySelector('#uout'), A = S.a, B = S.b;
        var rows = [], un = [], seen = {}, rowsInFile = 0, neg = 0, rs = resolver(data, A, byCode, find);
        data.rows.forEach(function (r) {
          var x = rs(r[A]); if (x.skip) return;
          var q = toNum(r[B]); if (q == null) { if (x.t) q = 0; else return; }
          rowsInFile++;
          if (!x.it) { un.push(x.un); return; }
          if (q < 0) neg++;
          seen[x.it.id] = (seen[x.it.id] || 0) + q;
        });
        var zero = v.querySelector('#uzero') ? v.querySelector('#uzero').checked : S.zero;
        var chg = [], same = 0, miss = 0, withStock = 0;
        core.items.forEach(function (i) {
          var sys = (bal[i.id] || {})[S.wh] || 0, has = Object.prototype.hasOwnProperty.call(seen, i.id);
          if (sys > 0) withStock++;
          if (!has) { if (sys > 0) { miss++; if (zero) chg.push({ it: i, sys: sys, tal: 0, note: 'not in file' }); } return; }
          var tal = seen[i.id]; if (tal < 0) tal = 0;
          if (Math.abs(tal - sys) < 0.0005) same++; else chg.push({ it: i, sys: sys, tal: tal });
        });
        var risky = withStock > 0 && miss / withStock > 0.4;
        if (S.zero == null) S.zero = !risky;
        zero = S.zero; if (!zero) chg = chg.filter(function (x) { return x.note !== 'not in file'; });
        chg.sort(function (a, b) { return Math.abs(b.tal - b.sys) - Math.abs(a.tal - a.sys); });
        S.chg = chg;
        out.innerHTML = colPick(data, A, B, 'Item column', 'Quantity column') +
          '<div class="usum"><span><b>' + rowsInFile + '</b> rows read</span><span><b>' + same + '</b> already match</span><span class="chgn"><b>' + chg.length + '</b> will change</span><span><b>' + un.length + '</b> not matched</span></div>' +
          (neg ? '<p class="mu">' + neg + ' items are <b>negative</b> in Tally. GoodsGuru cannot hold negative stock, so they are set to 0. Fix those in Tally when you can.</p>' : '') + (miss ? '<label class="uck"><input type="checkbox" id="uzero"' + (zero ? ' checked' : '') + '> ' + miss + ' items have stock in GoodsGuru but are not in this file. Treat them as <b>zero</b> in Tally.' + (risky ? ' <span class="uerr">That is a lot. Check you picked the right godown and file before ticking.</span>' : '') + '</label>' : '') +
          unmatchedHtml(un) +
          (chg.length ? '<div class="tw card2 flush"><table class="t"><thead><tr><th>Item</th><th class="r">GoodsGuru now</th><th class="r">Tally says</th><th class="r">Change</th></tr></thead><tbody>' + chg.slice(0, 200).map(function (x) { var d = x.tal - x.sys; return '<tr><td><b>' + esc(x.it.code) + '</b><br><span class="mu">' + esc(x.it.name) + (x.note ? ' · ' + x.note : '') + '</span></td><td class="r">' + num(x.sys) + '</td><td class="r"><b>' + num(x.tal) + '</b></td><td class="r ' + (d < 0 ? 'neg' : '') + '">' + (d > 0 ? '+' : '') + num(d) + '</td></tr>'; }).join('') + '</tbody></table>' + (chg.length > 200 ? '<div class="empty">Showing the biggest 200 of ' + chg.length + '. All will be updated.</div>' : '') + '</div>' +
            '<div class="upr"><button type="button" class="b2 inl" id="ugo"></button><span class="mu" id="uprog"></span></div>' : '<div class="upok">Nothing to change. GoodsGuru already matches this file.</div>');
        v.querySelector('#cA').onchange = function (e) { S.a = +e.target.value; show(); };
        v.querySelector('#cB').onchange = function (e) { S.b = +e.target.value; show(); };
        var z = v.querySelector('#uzero'); if (z) z.onchange = function () { S.zero = z.checked; show(); };
        var go = v.querySelector('#ugo');
        if (go) confirmBtn(go, 'Update ' + chg.length + ' items in ' + (wh.filter(function (w) { return w.id === S.wh; })[0] || {}).code, async function () {
          var note = 'Tally upload ' + new Date().toISOString().slice(0, 10), ok = 0;
          var errs = await pool(chg, 4, function (x) { return D.post('post_count', { p_item: x.it.id, p_wh: S.wh, p_counted: x.tal, p_note: note }).then(function () { ok++; }); }, function (n) { v.querySelector('#uprog').textContent = n + ' of ' + chg.length; });
          finish('stock', ok, errs.map(function (e) { return { k: e.k.it, e: e.e }; }), 'items');
        });
      }
    }

    /* ---------- 2. sales speed ---------- */
    function panelSales() {
      var S = st.sales; if (!S.days) S.days = 90;
      $('#upc').innerHTML = '<div class="tag">Upload 2 of 3</div><h3>Sales speed</h3><p>Sets how many pieces each item sells per day. Reorder, days of cover and the health colours all use this. It overwrites the old number, so the database does not grow.</p>' +
        drop('sales', '<label class="fl">Days covered by the file<input class="inp sm" id="udays" type="number" min="1" max="730" value="' + S.days + '"></label>');
      v.querySelector('#udays').oninput = function (e) { S.days = Math.max(1, +e.target.value || 90); if (S.data) show(); };
      wire('sales', function (data) {
        S.data = data; if (data.period) { S.days = data.period.days; var di = v.querySelector('#udays'); if (di) di.value = S.days; }
        S.a = pick(data.cols, /^(item\s*code|code|sku)/i); if (S.a < 0) S.a = pick(data.cols, /particulars|item|name|description|product/i); if (S.a < 0) S.a = 0;
        S.b = pick(data.cols, /(outward|sold|sale).*(quantity|qty)|(quantity|qty).*(outward|sold|sale)/i, true); if (S.b < 0) S.b = pick(data.cols, /outward|sold|sale/i, true); if (S.b < 0) S.b = pick(data.cols, /quantity|qty/i, true); if (S.b < 0) S.b = Math.min(1, data.cols.length - 1);
        show();
      });
      function show() {
        var data = S.data, out = v.querySelector('#uout'), A = S.a, B = S.b, tot = {}, un = [], rowsInFile = 0, rs = resolver(data, A, byCode, find);
        data.rows.forEach(function (r) {
          var x = rs(r[A]); if (x.skip) return;
          var q = toNum(r[B]); if (q == null) return; rowsInFile++;
          if (!x.it) { un.push(x.un); return; }
          tot[x.it.id] = (tot[x.it.id] || 0) + Math.abs(q);
        });
        var zero = S.zero === true, chg = [], same = 0;
        core.items.forEach(function (i) {
          var has = Object.prototype.hasOwnProperty.call(tot, i.id);
          if (!has && !zero) return;
          var nw = Math.round(((has ? tot[i.id] : 0) / S.days) * 100) / 100, cur = Number(i.seed_daily_usage) || 0;
          if (Math.abs(nw - cur) < 0.005) same++; else chg.push({ it: i, cur: cur, nw: nw });
        });
        chg.sort(function (a, b) { return Math.abs(b.nw - b.cur) - Math.abs(a.nw - a.cur); });
        S.chg = chg;
        out.innerHTML = colPick(data, A, B, 'Item column', 'Quantity sold column') +
          (data.period ? '<p class="mu">The file says the period ends <b>' + esc(data.period.to) + '</b>, so <b>' + data.period.days + ' days</b> is used.</p>' : '') + '<div class="usum"><span><b>' + rowsInFile + '</b> rows read</span><span><b>' + same + '</b> unchanged</span><span class="chgn"><b>' + chg.length + '</b> will change</span><span><b>' + un.length + '</b> not matched</span></div>' +
          '<label class="uck"><input type="checkbox" id="uzero"' + (zero ? ' checked' : '') + '> Items that are not in the file sold nothing, set them to <b>0</b> a day</label>' +
          unmatchedHtml(un) +
          (chg.length ? '<div class="tw card2 flush"><table class="t"><thead><tr><th>Item</th><th class="r">Per day now</th><th class="r">New per day</th></tr></thead><tbody>' + chg.slice(0, 200).map(function (x) { return '<tr><td><b>' + esc(x.it.code) + '</b><br><span class="mu">' + esc(x.it.name) + '</span></td><td class="r">' + num(x.cur) + '</td><td class="r"><b>' + num(x.nw) + '</b></td></tr>'; }).join('') + '</tbody></table>' + (chg.length > 200 ? '<div class="empty">Showing 200 of ' + chg.length + '. All will be updated.</div>' : '') + '</div>' +
            '<div class="upr"><button type="button" class="b2 inl" id="ugo"></button><span class="mu" id="uprog"></span></div>' : '<div class="upok">Nothing to change.</div>');
        v.querySelector('#cA').onchange = function (e) { S.a = +e.target.value; show(); };
        v.querySelector('#cB').onchange = function (e) { S.b = +e.target.value; show(); };
        v.querySelector('#uzero').onchange = function (e) { S.zero = e.target.checked; show(); };
        var go = v.querySelector('#ugo');
        if (go) confirmBtn(go, 'Update ' + chg.length + ' items', async function () {
          var ok = 0;
          var errs = await pool(chg, 4, function (x) { return D.setUsage(x.it.id, x.nw).then(function () { ok++; }); }, function (n) { v.querySelector('#uprog').textContent = n + ' of ' + chg.length; });
          finish('sales', ok, errs.map(function (e) { return { k: e.k.it, e: e.e }; }), 'items');
        });
      }
    }

    /* ---------- 3. item list ---------- */
    function panelItems() {
      var S = st.items;
      $('#upc').innerHTML = '<div class="tag">Upload 3 of 3</div><h3>Item list</h3><p>Adds new items and updates existing ones by item code. Use it when a new product is launched or a lead time changes.</p>' + drop('items');
      wire('items', function (data) {
        var cols = data.cols, ix = {
          code: pick(cols, /^(item\s*code|code|sku|part)/i), name: pick(cols, /^(item\s*name|name|particulars|description|product)/i), grp: pick(cols, /group|categor|brand/i),
          unit: pick(cols, /^unit|uom/i), lead: pick(cols, /lead/i), moq: pick(cols, /moq|min/i), daily: pick(cols, /daily|per\s*day|usage/i)
        };
        var out = v.querySelector('#uout');
        if (ix.code < 0) { out.innerHTML = '<p class="uerr">I could not find an <b>Item Code</b> column. Use the template so the headings match.</p>'; return; }
        var add = [], upd = [], same = 0, bad = [];
        data.rows.forEach(function (r) {
          var code = String(r[ix.code] == null ? '' : r[ix.code]).trim(); if (!code) return;
          var ex = byCode[code.toUpperCase()];
          var row = { code: ex ? ex.code : code };
          function g(k) { return ix[k] >= 0 ? r[ix[k]] : ''; }
          var nm = String(g('name') || '').trim();
          if (!ex && !nm) { bad.push(code); return; }
          row.name = nm || ex.name;
          row.group_name = ix.grp >= 0 && String(g('grp')).trim() ? String(g('grp')).trim() : (ex ? ex.group_name : null);
          row.unit = ix.unit >= 0 && String(g('unit')).trim() ? String(g('unit')).trim() : (ex ? ex.unit : 'pcs');
          var ld = toNum(g('lead')), mq = toNum(g('moq')), dy = toNum(g('daily'));
          row.lead_time_days = ld != null && ld >= 0 ? Math.round(ld) : (ex ? ex.lead_time_days : 7);
          row.moq = mq != null && mq >= 0 ? mq : (ex ? ex.moq : 0);
          row.seed_daily_usage = dy != null && dy >= 0 ? dy : (ex ? ex.seed_daily_usage : 0);
          row.safety_factor = ex ? ex.safety_factor : 1.2; row.track_batch = ex ? ex.track_batch : false; row.active = true;
          if (!ex) { add.push(row); return; }
          var diff = row.name !== ex.name || (row.group_name || '') !== (ex.group_name || '') || row.unit !== ex.unit || row.lead_time_days !== ex.lead_time_days || Number(row.moq) !== Number(ex.moq) || Number(row.seed_daily_usage) !== Number(ex.seed_daily_usage);
          if (diff) upd.push(row); else same++;
        });
        var all = add.concat(upd);
        out.innerHTML = '<div class="usum"><span><b>' + add.length + '</b> new items</span><span class="chgn"><b>' + upd.length + '</b> will update</span><span><b>' + same + '</b> unchanged</span><span><b>' + bad.length + '</b> skipped (new code with no name)</span></div>' +
          (all.length ? '<div class="tw card2 flush"><table class="t"><thead><tr><th>Item</th><th>Group</th><th class="r">Lead</th><th class="r">MOQ</th><th class="r">Daily</th><th></th></tr></thead><tbody>' + all.slice(0, 200).map(function (x) { var nw = !byCode[String(x.code).toUpperCase()]; return '<tr><td><b>' + esc(x.code) + '</b><br><span class="mu">' + esc(x.name) + '</span></td><td class="mu">' + esc(x.group_name || '') + '</td><td class="r">' + x.lead_time_days + 'd</td><td class="r">' + num(x.moq) + '</td><td class="r">' + num(x.seed_daily_usage) + '</td><td>' + (nw ? '<span class="cv g">new</span>' : '<span class="cv o">update</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
            '<div class="upr"><button type="button" class="b2 inl" id="ugo"></button><span class="mu" id="uprog"></span></div>' : '<div class="upok">Nothing to change.</div>');
        var go = v.querySelector('#ugo');
        if (go) confirmBtn(go, 'Save ' + all.length + ' items', async function () {
          var ok = 0;
          var errs = await pool(all, 3, function (x) { return D.saveItem(Object.assign({}, x)).then(function () { ok++; }); }, function (n) { v.querySelector('#uprog').textContent = n + ' of ' + all.length; });
          finish('items', ok, errs.map(function (e) { return { k: e.k, e: e.e }; }), 'items');
        });
      });
    }


    /* ---------- ALL IN ONE ---------- */
    function panelAll() {
      $('#upc').innerHTML = '<div class="tag">Daily file</div><h3>One Excel file, everything inside</h3><p>Download the file once. Each day paste Tally quantities into the <b>Stock</b> sheet, save, and drop it here. The <b>Sales</b> and <b>Items</b> sheets are optional. You see one preview and confirm once.</p>' +
        '<details class="howbox" open><summary>What goes in each sheet, and the Tally keys</summary><ol class="how">' +
        '<li><b>Stock</b> (daily): in Tally press <b>Alt+G</b> &rarr; <b>Godown Summary</b> &rarr; pick the godown &rarr; <b>Alt+F2</b> to set today &rarr; <b>Ctrl+E</b> &rarr; Excel. Copy that godown quantity column into its column in the Stock sheet. Repeat per godown.</li>' +
        '<li><b>Sales</b> (weekly): <b>Alt+G</b> &rarr; <b>Stock Summary</b> &rarr; <b>Alt+F2</b> last 90 days &rarr; <b>F12</b> show Goods Outwards &rarr; <b>Ctrl+E</b>. Copy the outwards quantity into Quantity Sold.</li>' +
        '<li><b>Items</b> (rare): new items, groups, lead times.</li></ol><p class="mu">Rule that keeps it safe: an <b>empty</b> cell means leave GoodsGuru as it is. Only a typed <b>0</b> sets zero. Two uploads a day is fine, the second one only posts what changed since the first.</p></details>' +
        '<div class="upr"><button type="button" class="b2 inl ghost" id="utpl">Download the daily file</button></div>' +
        '<label class="drop" id="udrop"><input type="file" id="ufile" accept=".xlsx,.xls,.xlx" hidden><b>Drop the daily Excel file here</b><span class="mu">or click to choose</span></label><div id="uout"></div>';
      v.querySelector('#utpl').onclick = function () { masterTemplate(core.items, wh).catch(function (e) { c.say(e.message); }); };
      var d = v.querySelector('#udrop'), f = v.querySelector('#ufile');
      function take(file) { if (!file) return; v.querySelector('#uout').innerHTML = '<p class="mu">Reading ' + esc(file.name) + '…</p>'; readBook(file).then(analyse).catch(function (e) { v.querySelector('#uout').innerHTML = '<p class="uerr">' + esc(e.message || e) + '</p>'; }); }
      f.onchange = function () { take(f.files[0]); f.value = ''; };
      d.ondragover = function (e) { e.preventDefault(); d.classList.add('on'); }; d.ondragleave = function () { d.classList.remove('on'); };
      d.ondrop = function (e) { e.preventDefault(); d.classList.remove('on'); take(e.dataTransfer.files[0]); };

      function idCol(cols) { var a = pick(cols, /^(item\s*code|code|sku)/i); if (a < 0) a = pick(cols, /particulars|item|name|description|product/i); return a < 0 ? 0 : a; }
      function analyse(book) {
        var out = v.querySelector('#uout'), jobs = [], html = '', total = 0;
        function sect(title, body) { html += '<div class="usec"><h4>' + title + '</h4>' + body + '</div>'; }
        function table(head, rows) { return '<div class="tw card2 flush"><table class="t"><thead><tr>' + head + '</tr></thead><tbody>' + rows.slice(0, 60).join('') + '</tbody></table>' + (rows.length > 60 ? '<div class="empty">Showing 60 of ' + rows.length + '. All will be updated.</div>' : '') + '</div>'; }

        /* stock */
        var sh = book['stock'];
        if (sh) {
          var A = idCol(sh.cols), wcols = [];
          wh.forEach(function (w) { var k = -1; sh.cols.forEach(function (cl, i) { if (i !== A && (norm(cl) === norm(w.code) || norm(cl) === norm(w.name) || (norm(w.name) && norm(cl).indexOf(norm(w.name)) === 0))) k = i; }); if (k >= 0) wcols.push({ w: w, k: k }); });
          if (!wcols.length) sect('Stock', '<p class="uerr">No godown columns found. The column headings must be the godown codes (' + wh.map(function (w) { return esc(w.code); }).join(', ') + '). Use the downloaded file.</p>');
          else {
            var chg = [], un = [], rd = 0, same = 0;
            sh.rows.forEach(function (r) {
              var idv = r[A]; if (idv === '' || idv == null) return; if (/^(grand total|total)/i.test(String(idv).trim())) return;
              var it = find(idv); if (!it) { un.push(String(idv).trim()); return; } rd++;
              wcols.forEach(function (wc) {
                var q = toNum(r[wc.k]); if (q == null) return; if (q < 0) q = 0;
                var sys = (bal[it.id] || {})[wc.w.id] || 0;
                if (Math.abs(q - sys) < 0.0005) same++; else chg.push({ it: it, w: wc.w, sys: sys, tal: q });
              });
            });
            chg.sort(function (a, b) { return Math.abs(b.tal - b.sys) - Math.abs(a.tal - a.sys); });
            sect('Stock · ' + wcols.map(function (x) { return esc(x.w.code); }).join(', '),
              '<div class="usum"><span><b>' + rd + '</b> items read</span><span><b>' + same + '</b> numbers already match</span><span class="chgn"><b>' + chg.length + '</b> will change</span><span><b>' + un.length + '</b> not matched</span></div>' + unmatchedHtml(un) +
              (chg.length ? table('<th>Item</th><th>Godown</th><th class="r">GoodsGuru now</th><th class="r">Tally says</th><th class="r">Change</th>', chg.map(function (x) { var dd = x.tal - x.sys; return '<tr><td><b>' + esc(x.it.code) + '</b><br><span class="mu">' + esc(x.it.name) + '</span></td><td>' + esc(x.w.code) + '</td><td class="r">' + num(x.sys) + '</td><td class="r"><b>' + num(x.tal) + '</b></td><td class="r ' + (dd < 0 ? 'neg' : '') + '">' + (dd > 0 ? '+' : '') + num(dd) + '</td></tr>'; })) : '<div class="upok">Stock already matches.</div>'));
            if (chg.length) { total += chg.length; var note = 'Tally upload ' + new Date().toISOString().slice(0, 10); jobs.push({ label: 'stock', list: chg, n: 4, run: function (x) { return D.post('post_count', { p_item: x.it.id, p_wh: x.w.id, p_counted: x.tal, p_note: note }); } }); }
          }
        }
        /* sales */
        var ss = book['sales'];
        if (ss) {
          var A2 = idCol(ss.cols), Q = pick(ss.cols, /quantity|qty|sold|outward/i, true), DY = pick(ss.cols, /days/i), days = 90;
          if (DY >= 0) { for (var z = 0; z < ss.rows.length; z++) { var dv = toNum(ss.rows[z][DY]); if (dv > 0) { days = dv; break; } } }
          if (Q < 0) sect('Sales speed', '<p class="uerr">No "Quantity Sold" column found.</p>');
          else {
            var tot = {}, un2 = [], rd2 = 0;
            ss.rows.forEach(function (r) { var idv = r[A2]; if (idv === '' || idv == null) return; if (/^(grand total|total)/i.test(String(idv).trim())) return; var q = toNum(r[Q]); if (q == null) return; var it = find(idv); if (!it) { un2.push(String(idv).trim()); return; } rd2++; tot[it.id] = (tot[it.id] || 0) + Math.abs(q); });
            var chg2 = [], same2 = 0;
            core.items.forEach(function (i) { if (!Object.prototype.hasOwnProperty.call(tot, i.id)) return; var nw = Math.round(tot[i.id] / days * 100) / 100, cur = Number(i.seed_daily_usage) || 0; if (Math.abs(nw - cur) < 0.005) same2++; else chg2.push({ it: i, cur: cur, nw: nw }); });
            chg2.sort(function (a, b) { return Math.abs(b.nw - b.cur) - Math.abs(a.nw - a.cur); });
            sect('Sales speed · ' + num(days) + ' days',
              '<div class="usum"><span><b>' + rd2 + '</b> items read</span><span><b>' + same2 + '</b> unchanged</span><span class="chgn"><b>' + chg2.length + '</b> will change</span><span><b>' + un2.length + '</b> not matched</span></div>' + unmatchedHtml(un2) +
              (chg2.length ? table('<th>Item</th><th class="r">Per day now</th><th class="r">New per day</th>', chg2.map(function (x) { return '<tr><td><b>' + esc(x.it.code) + '</b><br><span class="mu">' + esc(x.it.name) + '</span></td><td class="r">' + num(x.cur) + '</td><td class="r"><b>' + num(x.nw) + '</b></td></tr>'; })) : '<div class="upok">Sales speed unchanged.</div>'));
            if (chg2.length) { total += chg2.length; jobs.push({ label: 'sales speed', list: chg2, n: 4, run: function (x) { return D.setUsage(x.it.id, x.nw); } }); }
          }
        }
        /* items */
        var si = book['items'];
        if (si) {
          var cols = si.cols, ix = { code: pick(cols, /^(item\s*code|code|sku|part)/i), name: pick(cols, /^(item\s*name|name|particulars|description|product)/i), grp: pick(cols, /group|categor|brand/i), unit: pick(cols, /^unit|uom/i), lead: pick(cols, /lead/i), moq: pick(cols, /moq|min/i), daily: pick(cols, /daily|per\s*day|usage/i) };
          if (ix.code >= 0) {
            var all = [], same3 = 0;
            si.rows.forEach(function (r) {
              var code = String(r[ix.code] == null ? '' : r[ix.code]).trim(); if (!code) return; var ex = byCode[code.toUpperCase()]; function g(k) { return ix[k] >= 0 ? r[ix[k]] : ''; }
              var nm = String(g('name') || '').trim(); if (!ex && !nm) return;
              var row = { code: ex ? ex.code : code, name: nm || ex.name };
              row.group_name = ix.grp >= 0 && String(g('grp')).trim() ? String(g('grp')).trim() : (ex ? ex.group_name : null);
              row.unit = ix.unit >= 0 && String(g('unit')).trim() ? String(g('unit')).trim() : (ex ? ex.unit : 'pcs');
              var ld = toNum(g('lead')), mq = toNum(g('moq')), dy = toNum(g('daily'));
              row.lead_time_days = ld != null && ld >= 0 ? Math.round(ld) : (ex ? ex.lead_time_days : 7); row.moq = mq != null && mq >= 0 ? mq : (ex ? ex.moq : 0); row.seed_daily_usage = dy != null && dy >= 0 ? dy : (ex ? ex.seed_daily_usage : 0);
              row.safety_factor = ex ? ex.safety_factor : 1.2; row.track_batch = ex ? ex.track_batch : false; row.active = true;
              if (!ex) { all.push(row); return; }
              if (row.name !== ex.name || (row.group_name || '') !== (ex.group_name || '') || row.unit !== ex.unit || row.lead_time_days !== ex.lead_time_days || Number(row.moq) !== Number(ex.moq) || Number(row.seed_daily_usage) !== Number(ex.seed_daily_usage)) all.push(row); else same3++;
            });
            if (all.length) { sect('Items', '<div class="usum"><span class="chgn"><b>' + all.length + '</b> new or changed</span><span><b>' + same3 + '</b> unchanged</span></div>' + table('<th>Item</th><th>Group</th><th class="r">Lead</th><th class="r">MOQ</th><th></th>', all.map(function (x) { return '<tr><td><b>' + esc(x.code) + '</b><br><span class="mu">' + esc(x.name) + '</span></td><td class="mu">' + esc(x.group_name || '') + '</td><td class="r">' + x.lead_time_days + 'd</td><td class="r">' + num(x.moq) + '</td><td>' + (byCode[String(x.code).toUpperCase()] ? '<span class="cv o">update</span>' : '<span class="cv g">new</span>') + '</td></tr>'; }))); total += all.length; jobs.push({ label: 'items', list: all, n: 3, run: function (x) { return D.saveItem(Object.assign({}, x)); } }); }
          }
        }
        if (!html) html = '<p class="uerr">I could not find a Stock, Sales or Items sheet. Use the downloaded daily file so the sheet names match.</p>';
        out.innerHTML = html + (total ? '<div class="upr"><button type="button" class="b2 inl" id="ugo"></button><span class="mu" id="uprog"></span></div>' : (jobs.length || html.indexOf('uerr') > 0 ? '' : '<div class="upok">Nothing to change. GoodsGuru already matches this file.</div>'));
        var go = v.querySelector('#ugo');
        if (go) confirmBtn(go, 'Apply all ' + total + ' changes', async function () {
          var done = 0, bad = [], okc = 0;
          for (var j = 0; j < jobs.length; j++) {
            var job = jobs[j];
            var errs = await pool(job.list, job.n, function (x) { return job.run(x).then(function () { okc++; }); }, function (n) { v.querySelector('#uprog').textContent = job.label + ': ' + n + ' of ' + job.list.length; });
            errs.forEach(function (e) { bad.push(job.label + ' ' + ((e.k.it || e.k).code || '') + ': ' + (e.e && e.e.message || e.e)); });
          }
          P.__dirty();
          v.querySelector('#uout').innerHTML = '<div class="upok"><b>Done.</b> ' + okc + ' changes saved.' + (bad.length ? ' <span class="uerr">' + bad.length + ' failed: ' + esc(bad.slice(0, 3).join('; ')) + '</span>' : '') + '</div>';
          P.__core(true).then(function (n) { core = n; }).catch(function () { });
        });
      }
    }

    function $(s) { return v.querySelector(s); }
    function panel() { if (TAB === 'all') panelAll(); else if (TAB === 'stock') panelStock(); else if (TAB === 'sales') panelSales(); else panelItems(); }
    shell();
  };
})();
