/* GoodsGuru pages: Dashboard, Stock, Receive, Issue, Transfer, Count, Reorder, Settings.
   Each page is  window.PAGES.<name>(viewElement, ctx).  ctx = { sb, demo, me, say, esc, go } from app.js.
   Real mode reads Supabase views and calls the posting functions. Preview mode uses sample data in memory. */
(function () {
  'use strict';
  var P = window.PAGES = {};
  var ctx, D, core = null;

  /* ---------- small helpers ---------- */
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(x) { if (x == null || x === '') return '–'; return Number(x).toLocaleString('en-IN', { maximumFractionDigits: 3 }); }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function fmtDate(d) { if (!d) return ''; var x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }); }
  function role() { return ctx.me ? ctx.me.role : 'admin'; }
  function canPost() { return ctx.demo || ['admin', 'manager', 'staff'].indexOf(role()) >= 0; }
  function canManage() { return ctx.demo || ['admin', 'manager'].indexOf(role()) >= 0; }
  function isAdmin() { return ctx.demo || role() === 'admin'; }
  function errMsg(e) { var m = (e && (e.message || e.error_description)) || String(e); if (/row-level security|permission denied|JWT/i.test(m)) return 'Your login may have expired, or you do not have permission for this. Sign out, sign in again and retry.'; return m; }

  var BAND = {
    out: ['Out', '#c8102e'], critical: ['Critical', '#d9480f'], low: ['Low', '#b8860b'],
    healthy: ['Healthy', '#0f7b4a'], over: ['Over', '#2d6cdf'], 'no-usage': ['No usage', '#6b7a90']
  };
  var ORDER = { out: 0, critical: 1, low: 2, healthy: 3, over: 4, 'no-usage': 5 };
  function chip(b) { var m = BAND[b] || BAND['no-usage']; return '<span class="pill" style="--c:' + m[1] + '">' + m[0] + '</span>'; }
  /* days of cover = stock / average sold per day */
  function cover(h) {
    var a = Number(h.avg_daily), s = Number(h.stock);
    if (!(a > 0)) return '<span class="cv n">n/a</span>';
    if (!(s > 0)) return '<span class="cv r">0 d</span>';
    var d = s / a, t = d >= 100 ? '99+' : (d < 10 ? d.toFixed(1) : String(Math.round(d)));
    return '<span class="cv ' + (d <= 2 ? 'r' : d <= 7 ? 'o' : d <= 45 ? 'g' : 'b') + '" title="' + t + ' days of stock at the current selling speed">' + t + ' d</span>';
  }
  function bar(h) {
    var m = BAND[h.band] || BAND['no-usage'];
    var w = h.pct == null ? 0 : Math.max(0, Math.min(100, Number(h.pct)));
    return '<div class="hb"><i style="width:' + w + '%;background:' + m[1] + '"></i></div>';
  }

  /* pages of 1000 rows: first page tells us the total, the rest are fetched together (not one after another) */
  async function fetchAll(make) {
    var step = 1000, first = await make(0, step - 1);
    if (first.error) throw first.error;
    var out = first.data || [];
    if (out.length < step) return out;
    var total = first.count, jobs = [];
    if (typeof total === 'number') { for (var i = step; i < total; i += step) jobs.push(make(i, i + step - 1)); }
    else { for (var j = 1; j <= 4; j++) jobs.push(make(j * step, (j + 1) * step - 1)); }
    var rest = await Promise.all(jobs);
    rest.forEach(function (r) { if (r.error) throw r.error; out = out.concat(r.data || []); });
    if (typeof total !== 'number' && rest.length && (rest[rest.length - 1].data || []).length >= step) {
      var k = (4 + 1) * step, more;
      do { more = await make(k, k + step - 1); if (more.error) throw more.error; out = out.concat(more.data || []); k += step; } while ((more.data || []).length >= step);
    }
    return out;
  }

  /* ---------- data layer: real Supabase ---------- */
  var real = {
    async core() {
      var sb = ctx.sb;
      var r = await Promise.all([
        fetchAll(function (a, b) { return sb.from('items').select('*', { count: 'exact' }).eq('active', true).order('code').range(a, b); }),
        fetchAll(function (a, b) { return sb.from('warehouses').select('*').eq('active', true).order('code').range(a, b); }),
        fetchAll(function (a, b) { return sb.from('stock_balance').select('item_id,warehouse_id,qty', { count: 'exact' }).order('item_id').order('warehouse_id').range(a, b); }),
        fetchAll(function (a, b) { return sb.from('item_health').select('*', { count: 'exact' }).order('code').range(a, b); })
      ]);
      return { items: r[0], wh: r[1], bal: r[2], health: r[3] };
    },
    async moves(types, n) {
      var r = await ctx.sb.from('stock_movements')
        .select('id,move_type,qty,ref_no,note,occurred_on,batch_no,items(code,name,unit),warehouses(code)')
        .in('move_type', types).order('id', { ascending: false }).limit(n);
      if (r.error) throw r.error;
      return r.data || [];
    },
    async post(fn, args) { var r = await ctx.sb.rpc(fn, args); if (r.error) throw r.error; return r.data; },
    async suggestions() { return fetchAll(function (a, b) { return ctx.sb.from('reorder_suggestions').select('*').order('code').range(a, b); }); },
    async indents() {
      var r = await ctx.sb.from('indents').select('id,indent_no,status,note,created_at,indent_lines(qty,received_qty)').order('created_at', { ascending: false }).limit(20);
      if (r.error) throw r.error; return r.data || [];
    },
    async createIndent(note) { var r = await ctx.sb.rpc('create_indent_from_suggestions', { p_note: note || null }); if (r.error) throw r.error; return r.data; },
    async setIndent(id, status) { var r = await ctx.sb.from('indents').update({ status: status }).eq('id', id); if (r.error) throw r.error; },
    async saveItem(it) {
      it.company_id = ctx.me.company_id;
      var r = await ctx.sb.from('items').upsert(it, { onConflict: 'company_id,code' }); if (r.error) throw r.error;
    },
    async setUsage(id, val) { var r = await ctx.sb.from('items').update({ seed_daily_usage: val }).eq('id', id).select('id'); if (r.error) throw r.error; if (!r.data || r.data.length !== 1) throw new Error('Not saved'); },
    async addWh(w) { w.company_id = ctx.me.company_id; var r = await ctx.sb.from('warehouses').insert(w); if (r.error) throw r.error; },
    async people() { var r = await ctx.sb.from('profiles').select('user_id,full_name,role,active').order('full_name'); if (r.error) throw r.error; return r.data || []; },
    async itemMoves(id, n) {
      var r = await ctx.sb.from('stock_movements').select('id,move_type,qty,ref_no,occurred_on,warehouses(code)').eq('item_id', id).order('id', { ascending: false }).limit(n);
      if (r.error) throw r.error; return r.data || [];
    },
    async setPhoto(it, blob) {
      var ses = await ctx.sb.auth.getSession();
      if (!ses.data || !ses.data.session) throw new Error('Your login expired. Sign out, sign in again and retry. Nothing was saved.');
      var path = ctx.me.company_id + '/' + String(it.code).replace(/[^A-Za-z0-9._-]/g, '_') + '.webp';
      var st = ctx.sb.storage.from('item-photos');
      var up = await st.upload(path, blob, { upsert: true, contentType: 'image/webp', cacheControl: '3600' });
      if (up.error) throw up.error;
      var url = st.getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
      var r = await ctx.sb.from('items').update({ image_url: url }).eq('id', it.id).select('id');
      if (r.error) throw r.error;
      if (!r.data || r.data.length !== 1) throw new Error('The file uploaded but could not be linked to ' + it.code + '. Not saved.');
      return url;
    },
    async clearPhoto(it) { var r = await ctx.sb.from('items').update({ image_url: null }).eq('id', it.id); if (r.error) throw r.error; },
    async setRole(id, rl) { var r = await ctx.sb.from('profiles').update({ role: rl }).eq('user_id', id); if (r.error) throw r.error; }
  };

  /* ---------- data layer: preview (sample data, in memory) ---------- */
  var demoState = null;
  function demoInit() {
    if (demoState) return demoState;
    var wh = [
      { id: 'w1', code: 'OKH', name: 'Okhla C-34', kind: 'warehouse' },
      { id: 'w2', code: 'CHT', name: 'Chattarpur', kind: 'warehouse' },
      { id: 'w3', code: 'GGN', name: 'Gurgaon', kind: 'warehouse' },
      { id: 'w4', code: 'SDJ', name: 'Safdarjung HO', kind: 'office' }
    ];
    var raw = [
      ['BR-VAN-5L', 'Vanilla Tub 5L', 'Ice cream', 'tub', 18, 3, 24, 40, 24, 12, 8],
      ['BR-CHO-5L', 'Chocolate Tub 5L', 'Ice cream', 'tub', 14, 3, 24, 6, 4, 2, 0],
      ['BR-STR-2L', 'Strawberry Tub 2L', 'Ice cream', 'tub', 10, 3, 12, 0, 0, 0, 0],
      ['BR-CON-24', 'Waffle Cone Pack of 24', 'Dry', 'pack', 9, 3, 10, 80, 30, 20, 0],
      ['AM-BTR-500', 'Butter 500g', 'Dairy', 'pcs', 60, 4, 20, 120, 60, 40, 0],
      ['AM-MLK-1L', 'Milk 1L', 'Dairy', 'pcs', 150, 2, 24, 90, 60, 40, 0],
      ['AM-PNR-200', 'Paneer 200g', 'Dairy', 'pcs', 45, 3, 12, 30, 20, 10, 0],
      ['AM-CHZ-200', 'Cheese Slices 200g', 'Dairy', 'pcs', 30, 5, 12, 400, 120, 80, 0],
      ['KW-DRM-250', 'Kwality Walls Cone 250ml', 'Ice cream', 'pcs', 70, 3, 36, 20, 10, 6, 0],
      ['PK-CRT-1', 'Plastic Crate', 'Packing', 'pcs', 0, 10, 0, 300, 200, 150, 0],
      ['OM-SWT-1K', 'Om Sweets Box 1kg', 'Sweets', 'box', 12, 2, 10, 70, 40, 30, 0],
      ['CH-FRY-1K', 'French Fries 1kg', 'Frozen', 'pack', 25, 4, 20, 55, 45, 20, 0]
    ];
    var items = raw.map(function (r, i) {
      return { id: 'i' + i, code: r[0], name: r[1], group_name: r[2], unit: r[3], seed_daily_usage: r[4], lead_time_days: r[5], moq: r[6], safety_factor: 1.2, track_batch: r[2] === 'Dairy' || r[2] === 'Ice cream', active: true };
    });
    var mv = [], id = 1;
    raw.forEach(function (r, i) {
      [7, 8, 9].forEach(function (k, wi) { if (r[k] > 0) mv.push({ id: id++, item_id: 'i' + i, warehouse_id: wh[wi].id, move_type: 'opening', qty: r[k], ref_no: 'OPENING', occurred_on: '2026-11-01' }); });
    });
    demoState = { wh: wh, items: items, mv: mv, nid: id, indents: [], ino: 17 };
    return demoState;
  }
  function dBal(s) {
    var m = {};
    s.mv.forEach(function (x) { var k = x.item_id + '|' + x.warehouse_id; m[k] = (m[k] || 0) + x.qty; });
    return Object.keys(m).map(function (k) { var p = k.split('|'); return { item_id: p[0], warehouse_id: p[1], qty: m[k] }; });
  }
  function dHealth(s) {
    var bal = dBal(s), tot = {};
    bal.forEach(function (b) { tot[b.item_id] = (tot[b.item_id] || 0) + b.qty; });
    return s.items.map(function (i) {
      var stock = tot[i.id] || 0, avg = Number(i.seed_daily_usage), max = Math.ceil(avg * i.lead_time_days * i.safety_factor);
      var pct = max > 0 ? Math.round(100 * stock / max) : null, band;
      if (stock <= 0) band = 'out'; else if (max === 0) band = 'no-usage'; else if (100 * stock / max <= 33) band = 'critical';
      else if (100 * stock / max <= 66) band = 'low'; else if (100 * stock / max <= 100) band = 'healthy'; else band = 'over';
      return { item_id: i.id, code: i.code, name: i.name, group_name: i.group_name, unit: i.unit, stock: stock, avg_daily: avg, max_level: max, pct: pct, band: band };
    });
  }
  function dOnOrder(s) {
    var o = {};
    s.indents.forEach(function (n) { if (['draft', 'approved', 'ordered'].indexOf(n.status) >= 0) n.lines.forEach(function (l) { o[l.item_id] = (o[l.item_id] || 0) + l.qty - l.received_qty; }); });
    return o;
  }
  function dSuggest(s) {
    var oo = dOnOrder(s), out = [];
    dHealth(s).forEach(function (h) {
      if (h.max_level <= 0) return;
      var it = s.items.filter(function (i) { return i.id === h.item_id; })[0], on = oo[h.item_id] || 0;
      if (h.stock + on > h.max_level * 0.66) return;
      var need = h.max_level - h.stock - on;
      var q = it.moq > 0 ? Math.ceil(need / it.moq) * it.moq : Math.ceil(need);
      out.push({ item_id: h.item_id, code: h.code, name: h.name, unit: h.unit, stock: h.stock, on_order: on, max_level: h.max_level, band: h.band, suggested_qty: q });
    });
    return out;
  }
  function dBalOf(s, item, wh) { return dBal(s).filter(function (b) { return b.item_id === item && b.warehouse_id === wh; }).reduce(function (a, b) { return a + b.qty; }, 0); }
  var demo = {
    async core() { var s = demoInit(); return { items: s.items.slice(), wh: s.wh.slice(), bal: dBal(s), health: dHealth(s) }; },
    async moves(types, n) {
      var s = demoInit();
      return s.mv.filter(function (x) { return types.indexOf(x.move_type) >= 0; }).slice(-n).reverse().map(function (x) {
        var it = s.items.filter(function (i) { return i.id === x.item_id; })[0], w = s.wh.filter(function (y) { return y.id === x.warehouse_id; })[0];
        return { id: x.id, move_type: x.move_type, qty: x.qty, ref_no: x.ref_no, note: x.note, occurred_on: x.occurred_on, batch_no: x.batch_no, items: { code: it.code, name: it.name, unit: it.unit }, warehouses: { code: w.code } };
      });
    },
    async post(fn, a) {
      var s = demoInit(), day = a.p_date || new Date().toISOString().slice(0, 10);
      function add(item, wh, type, qty, extra) { s.mv.push(Object.assign({ id: s.nid++, item_id: item, warehouse_id: wh, move_type: type, qty: qty, ref_no: a.p_ref, note: a.p_note, occurred_on: day }, extra || {})); }
      if (!(a.p_qty > 0) && fn !== 'post_count') throw new Error('Quantity must be more than zero');
      if (fn === 'post_receipt') {
        add(a.p_item, a.p_wh, 'receipt', a.p_qty, { batch_no: a.p_batch });
        var left = a.p_qty;
        s.indents.forEach(function (n) { n.lines.forEach(function (l) { if (l.item_id === a.p_item && left > 0 && ['approved', 'ordered', 'draft'].indexOf(n.status) >= 0) { var t = Math.min(left, l.qty - l.received_qty); l.received_qty += t; left -= t; } }); if (n.lines.every(function (l) { return l.received_qty >= l.qty; })) n.status = 'received'; });
        return 1;
      }
      if (fn === 'post_issue') {
        var b = dBalOf(s, a.p_item, a.p_wh); if (b < a.p_qty) throw new Error('Not enough stock. Only ' + num(b) + ' available here.');
        add(a.p_item, a.p_wh, 'issue', -a.p_qty); return 1;
      }
      if (fn === 'post_transfer') {
        if (a.p_from === a.p_to) throw new Error('From and To must be different');
        var b2 = dBalOf(s, a.p_item, a.p_from); if (b2 < a.p_qty) throw new Error('Not enough stock. Only ' + num(b2) + ' available at the source.');
        add(a.p_item, a.p_from, 'transfer_out', -a.p_qty); add(a.p_item, a.p_to, 'transfer_in', a.p_qty); return 'tid';
      }
      if (fn === 'post_count') {
        var sys = dBalOf(s, a.p_item, a.p_wh), diff = a.p_counted - sys;
        if (diff !== 0) add(a.p_item, a.p_wh, 'count_adjust', diff);
        return diff;
      }
    },
    async suggestions() { return dSuggest(demoInit()); },
    async itemMoves(id, n) { return demoInit().mv.filter(function (x) { return x.item_id === id; }).slice(-n).reverse().map(function (x) { var w = demoInit().wh.filter(function (y) { return y.id === x.warehouse_id; })[0]; return { id: x.id, move_type: x.move_type, qty: x.qty, ref_no: x.ref_no, occurred_on: x.occurred_on, warehouses: { code: w ? w.code : '' } }; }); },
    async setPhoto(it, blob) { it.image_url = URL.createObjectURL(blob); return it.image_url; },
    async clearPhoto(it) { it.image_url = null; },
    async indents() { return demoInit().indents.slice().reverse().map(function (n) { return { id: n.id, indent_no: n.no, status: n.status, note: n.note, created_at: n.at, indent_lines: n.lines }; }); },
    async createIndent(note) {
      var s = demoInit(), sg = dSuggest(s);
      if (!sg.length) throw new Error('Nothing to reorder right now');
      var n = { id: 'n' + s.ino, no: 'IND-' + (s.ino++), status: 'draft', note: note, at: new Date().toISOString(), lines: sg.map(function (x) { return { item_id: x.item_id, qty: x.suggested_qty, received_qty: 0 }; }) };
      s.indents.push(n); return n.id;
    },
    async setIndent(id, st) { demoInit().indents.forEach(function (n) { if (n.id === id) n.status = st; }); },
    async saveItem(it) {
      var s = demoInit(), f = s.items.filter(function (i) { return i.code === it.code; })[0];
      if (f) Object.assign(f, it); else s.items.push(Object.assign({ id: 'i' + s.items.length + 'x', active: true, track_batch: false }, it));
    },
    async setUsage(id, val) { demoInit().items.forEach(function (i) { if (i.id === id) i.seed_daily_usage = val; }); },
    async addWh(w) { var s = demoInit(); s.wh.push(Object.assign({ id: 'w' + (s.wh.length + 1) }, w)); },
    async people() { return [{ user_id: 'u1', full_name: 'Preview admin', role: 'admin', active: true }]; },
    async setRole() { }
  };

  var gen = 0, inflight = null, coreAt = 0;
  /* last good copy kept on this device, so the app opens instantly and refreshes quietly. Wiped on sign out and after any posting. */
  function ckey() { return ctx && ctx.me && !ctx.demo ? 'gg_core_' + ctx.me.id : null; }
  function cacheLoad() { try { var k = ckey(); if (!k) return null; var o = JSON.parse(localStorage.getItem(k) || 'null'); return o && o.d && o.d.items && Date.now() - o.at < 864e5 ? o : null; } catch (e) { return null; } }
  function cacheSave(c) { try { var k = ckey(); if (k) localStorage.setItem(k, JSON.stringify({ at: Date.now(), d: c })); } catch (e) { } }
  function cacheWipe() { try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('gg_core_') === 0) localStorage.removeItem(k); }); } catch (e) { } }
  function fetchCore() {
    var g = gen, pr = D.core().then(function (c) { if (g === gen) { core = c; coreAt = Date.now(); cacheSave(c); } return c; });
    inflight = pr;
    pr.then(function () { if (inflight === pr) inflight = null; }, function () { if (inflight === pr) inflight = null; });
    return pr;
  }
  /* getCore(): cached copy right away. getCore(true): always fetch fresh (use after posting). */
  function badges(c) {
    try {
      if (!c || !window.GG_BADGES) return c;
      var r = 0; c.health.forEach(function (h) { if (Number(h.max_level) > 0 && (h.band === 'out' || h.band === 'critical' || h.band === 'low')) r++; });
      window.GG_BADGES({ items: c.health.length, reorder: r });
    } catch (e) { }
    return c;
  }
  async function getCore(force) { if (force) return badges(await fetchCore()); if (!core && !inflight) { var ca = cacheLoad(); if (ca) { core = ca.d; coreAt = ca.at; } } if (core) return badges(core); return badges(await (inflight || fetchCore())); }
  function dirty() { gen++; core = null; inflight = null; cacheWipe(); }
  P.__reset = dirty; P.__dirty = dirty; P.__core = getCore;
  function sig(c) { return c.items.length + ':' + c.bal.length + ':' + c.bal.reduce(function (a, b) { return a + Number(b.qty); }, 0) + ':' + c.items.filter(function (i) { return i.image_url; }).length; }
  /* read-only pages: show cached data instantly, refresh quietly, redraw only if something changed */
  function soft(v, c, name) {
    if (!core || Date.now() - coreAt < 15000) return;
    var old = core, mine = ctx;
    fetchCore().then(function (n) {
      if (n && sig(n) !== sig(old) && v.isConnected && location.hash.indexOf('#/' + name) === 0 && mine === ctx) P[name](v, c);
    }).catch(function () { });
  }
  P.__env = function () { return { ctx: ctx, D: D, core: core, canManage: canManage, isAdmin: isAdmin }; };
  function cell(h) { return window.PHOTOS ? window.PHOTOS.cell(h) : '<b>' + esc(h.code) + '</b><br><span class="mu">' + esc(h.name) + '</span>'; }

  /* ---------- shared bits ---------- */
  var SK = '<div class="sk"><div class="sk-h"></div><div class="sk-s"></div><div class="sk-kp"><i></i><i></i><i></i><i></i></div><div class="sk-card">' + new Array(8).join('<div class="sk-row"><i class="sk-th"></i><span><i></i><i></i></span><b></b></div>') + '</div></div>';
  function loading(v, more) { if (core && !more) return; v.innerHTML = SK; }
  function failed(v, e) { v.innerHTML = '<div class="card2"><div class="tag">Could not load</div><h3>Something went wrong</h3><p>' + esc(errMsg(e)) + '</p></div>'; }
  function head(title, sub) { return '<h1 class="page-h">' + esc(title) + '</h1><p class="page-s">' + esc(sub) + '</p>'; }
  function movesTable(rows) {
    if (!rows.length) return '<div class="empty">Nothing posted yet.</div>';
    return '<div class="tw"><table class="t"><thead><tr><th>Date</th><th>Item</th><th>Where</th><th class="r">Qty</th><th>Ref</th></tr></thead><tbody>' +
      rows.map(function (m) {
        var q = Number(m.qty);
        return '<tr><td>' + esc(fmtDate(m.occurred_on)) + '</td><td><b>' + esc(m.items && m.items.code) + '</b> <span class="mu">' + esc(m.items && m.items.name) + '</span></td><td>' + esc(m.warehouses && m.warehouses.code) +
          '</td><td class="r ' + (q < 0 ? 'neg' : 'pos') + '">' + (q > 0 ? '+' : '') + num(q) + ' <span class="mu">' + esc(m.items && m.items.unit) + '</span></td><td class="mu">' + esc(m.ref_no || m.move_type) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ---------- STOCK ---------- */
  /* ---------- shared filter helpers ---------- */
  var F = { stock: { q: '', band: 'all', grp: '', wh: '', photo: '', sort: 'health', lim: 100 }, reorder: { q: '', band: 'all', grp: '', sort: 'demand', st: 'all' }, dash: { grp: '', top: 10, lvl: 'oc' }, items: { q: '', grp: '', photo: '', lim: 100 } };
  function NG(h) { return (h && h.group_name) || '(no group)'; }
  function groupsOf(items) { var m = {}; items.forEach(function (i) { var g = NG(i); m[g] = (m[g] || 0) + 1; }); return Object.keys(m).sort().map(function (g) { return [g, g + ' (' + m[g] + ')']; }); }
  function opts(list, cur) { return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  function sel(id, list, cur, label) { return '<select class="inp sm" id="' + id + '" aria-label="' + esc(label) + '">' + opts(list, cur) + '</select>'; }
  function fx(el, cls) { if (!el) return; cls = cls || 'fx'; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function chipRow(id, list, cur, counts) {
    return '<div class="chips" id="' + id + '">' + list.map(function (o) { return '<button type="button" class="fchip' + (o[0] === cur ? ' on' : '') + '" data-b="' + o[0] + '">' + esc(o[1]) + (counts ? ' <em>' + (counts[o[0]] || 0) + '</em>' : '') + '</button>'; }).join('') + '</div>';
  }
  function chipsOn(root, id, cb) {
    var el = $('#' + id, root); if (!el) return;
    el.onclick = function (e) { var b = e.target.closest('[data-b]'); if (!b) return; $$('.fchip', el).forEach(function (x) { x.classList.toggle('on', x === b); }); cb(b.getAttribute('data-b')); };
  }

  P.stock = async function (v, c) {
    ctx = c; D = c.demo ? demo : real; loading(v);
    var core;
    try { core = await getCore(); } catch (e) { return failed(v, e); }
    var wh = core.wh, by = {}, S = F.stock, iby = {}, neg = {};
    core.items.forEach(function (i) { iby[i.id] = i; });
    core.bal.forEach(function (b) { (by[b.item_id] = by[b.item_id] || {})[b.warehouse_id] = Number(b.qty); if (Number(b.qty) < 0) neg[b.item_id] = 1; });
    var counts = { all: core.health.length, instock: 0, neg: Object.keys(neg).length };
    core.health.forEach(function (h) { counts[h.band] = (counts[h.band] || 0) + 1; if (Number(h.stock) > 0) counts.instock++; });
    var CH = [['all', 'All'], ['instock', 'In stock'], ['out', 'Out'], ['critical', 'Critical'], ['low', 'Low'], ['healthy', 'Healthy'], ['over', 'Over'], ['no-usage', 'No usage'], ['neg', 'Negative stock']];
    var WO = [['', 'All warehouses']]; wh.forEach(function (w) { WO.push(['has:' + w.id, 'In stock at ' + w.code]); WO.push(['no:' + w.id, 'Not in stock at ' + w.code]); });
    var SO = [['health', 'Sort: needs attention first'], ['sales', 'Sort: fastest selling'], ['stockdesc', 'Sort: most stock'], ['stockasc', 'Sort: least stock'], ['name', 'Sort: name A to Z'], ['code', 'Sort: item code']];
    v.innerHTML = head('Stock', 'Every item and how much is in each warehouse. Health compares stock with what you normally need for the supplier lead time.') +
      '<div class="fbar"><input class="inp sm" id="q" type="search" placeholder="Search code, name or group" autocomplete="off" value="' + esc(S.q) + '">' +
      sel('fg', [['', 'All groups']].concat(groupsOf(core.items)), S.grp, 'Group') + sel('fw', WO, S.wh, 'Warehouse') +
      sel('fp', [['', 'All photos'], ['with', 'With photo'], ['without', 'No photo yet']], S.photo, 'Photo') + sel('fs', SO, S.sort, 'Sort') +
      '<button type="button" class="lnk" id="fc" hidden>Clear filters</button></div>' +
      chipRow('chips', CH, S.band, counts) + '<div class="fcount mu" id="fcnt"></div><div class="tw card2 flush" id="tbl"></div>';
    function rank(h) { return (h.band === 'out' && !(Number(h.max_level) > 0)) ? 6 : ORDER[h.band]; }
    var SORTS = {
      health: function (a, b) { return (rank(a) - rank(b)) || (rank(a) === 5 ? Number(b.stock) - Number(a.stock) : 0) || ((a.pct == null ? 999 : a.pct) - (b.pct == null ? 999 : b.pct)) || (Number(b.avg_daily) - Number(a.avg_daily)) || (a.code < b.code ? -1 : 1); },
      sales: function (a, b) { return (Number(b.avg_daily) - Number(a.avg_daily)) || (a.code < b.code ? -1 : 1); },
      stockdesc: function (a, b) { return (Number(b.stock) - Number(a.stock)) || (a.code < b.code ? -1 : 1); },
      stockasc: function (a, b) { return (Number(a.stock) - Number(b.stock)) || (a.code < b.code ? -1 : 1); },
      name: function (a, b) { return String(a.name).toLowerCase() < String(b.name).toLowerCase() ? -1 : 1; },
      code: function (a, b) { return a.code < b.code ? -1 : 1; }
    };
    function pass(h) {
      if (S.band === 'instock') { if (!(Number(h.stock) > 0)) return false; } else if (S.band === 'neg') { if (!neg[h.item_id]) return false; } else if (S.band !== 'all' && h.band !== S.band) return false;
      if (S.grp && NG(h) !== S.grp) return false;
      if (S.wh) { var k = S.wh.split(':'), q = (by[h.item_id] || {})[k[1]] || 0; if (k[0] === 'has' ? !(q > 0) : q > 0) return false; }
      if (S.photo) { var it = iby[h.item_id]; if ((S.photo === 'with') !== !!(it && it.image_url)) return false; }
      var s = S.q.toLowerCase(); if (s && (h.code + ' ' + h.name + ' ' + (h.group_name || '')).toLowerCase().indexOf(s) < 0) return false;
      return true;
    }
    function draw(anim) {
      var rows = core.health.filter(pass).sort(SORTS[S.sort] || SORTS.health), shown = rows.slice(0, S.lim);
      var on = S.q || S.grp || S.wh || S.photo || S.band !== 'all';
      $('#fc').hidden = !on;
      $('#fcnt').textContent = 'Showing ' + num(shown.length) + ' of ' + num(rows.length) + ' item' + (rows.length === 1 ? '' : 's') + (on ? ' (filtered from ' + num(core.health.length) + ')' : '');
      if (!rows.length) { $('#tbl').innerHTML = '<div class="empty">No items match these filters.</div>'; if (anim) fx($('#tbl')); return; }
      $('#tbl').innerHTML = '<table class="t"><thead><tr><th>Item</th>' + wh.map(function (w) { return '<th class="r" title="' + esc(w.name) + '">' + esc(w.code) + '</th>'; }).join('') +
        '<th class="r">Total</th><th class="r">Cover</th><th>Health</th></tr></thead><tbody>' +
        shown.map(function (h) {
          var m = by[h.item_id] || {};
          return '<tr><td>' + cell(h) + '</td>' +
            wh.map(function (w) { var x = m[w.id] || 0; return '<td class="r ' + (x < 0 ? 'neg' : (x === 0 ? 'zero' : '')) + '">' + num(x) + '</td>'; }).join('') +
            '<td class="r"><b>' + num(h.stock) + '</b> <span class="mu">' + esc(h.unit) + '</span></td>' +
            '<td class="r">' + cover(h) + '</td>' +
            '<td class="hcell">' + bar(h) + '<div class="hl">' + chip(h.band) + '<span class="mu">' + (h.pct == null ? 'no usage yet' : h.pct + '% of ' + num(h.max_level)) + '</span></div></td></tr>';
        }).join('') + '</tbody></table>' + (rows.length > S.lim ? '<div class="empty"><button type="button" class="b2 inl ghost" id="more">Show 100 more (' + num(rows.length - S.lim) + ' left)</button></div>' : '');
      var mo = $('#more'); if (mo) { mo.onclick = function () { S.lim += 100; draw(false); }; if (window.IntersectionObserver) new IntersectionObserver(function (e, o) { if (e[0].isIntersecting) { o.disconnect(); mo.click(); } }, { rootMargin: '500px' }).observe(mo); }
      if (anim) fx($('#tbl'));
    }
    var qt; $('#q').oninput = function (e) { S.q = e.target.value; S.lim = 100; clearTimeout(qt); qt = setTimeout(function () { draw(true); }, 120); };
    [['fg', 'grp'], ['fw', 'wh'], ['fp', 'photo'], ['fs', 'sort']].forEach(function (x) { $('#' + x[0]).onchange = function (e) { S[x[1]] = e.target.value; S.lim = 100; draw(true); }; });
    chipsOn(v, 'chips', function (b) { S.band = b; S.lim = 100; draw(true); });
    $('#fc').onclick = function () { F.stock = S = { q: '', band: 'all', grp: '', wh: '', photo: '', sort: S.sort, lim: 100 }; P.stock(v, c); };
    draw(false);
    soft(v, c, 'stock');
  };

  /* ---------- DASHBOARD ---------- */
  P.dashboard = async function (v, c) {
    ctx = c; D = c.demo ? demo : real; loading(v, true);
    var core, sg, mv;
    try { var rr = await Promise.all([getCore(), D.suggestions(), D.moves(['receipt', 'issue', 'transfer_out', 'count_adjust', 'opening'], 8)]); core = rr[0]; sg = rr[1]; mv = rr[2]; } catch (e) { return failed(v, e); }
    var S = F.dash, iby = {}; core.items.forEach(function (i) { iby[i.id] = i; });
    var LV = [['oc', 'Out + Critical'], ['out', 'Out only'], ['critical', 'Critical only'], ['ocl', 'Out, Critical + Low']];
    var TN = [[10, 'Top 10'], [25, 'Top 25'], [50, 'Top 50'], [9999, 'All']];
    function kpi(label, n, color, href) { return '<a class="kpi" href="' + href + '"><small>' + label + '</small><b style="color:' + color + '">' + num(n) + '</b></a>'; }
    v.innerHTML = head('Dashboard', 'What needs attention across your warehouses today.') +
      '<div class="fbar">' + sel('dg', [['', 'All groups']].concat(groupsOf(core.items)), S.grp, 'Group') + sel('dl', LV, S.lvl, 'Show') + sel('dt', TN, S.top, 'How many') + '<button type="button" class="lnk" id="dc" hidden>Clear filters</button></div>' +
      '<div id="dbody"></div>';
    function paint(anim) {
      var H = core.health.filter(function (h) { return !S.grp || NG(h) === S.grp; }), ids = {}; H.forEach(function (h) { ids[h.item_id] = 1; });
      var cnt = {}, instock = 0; H.forEach(function (h) { if (Number(h.stock) > 0) instock++; if (h.band === 'out' && !(Number(h.max_level) > 0)) return; cnt[h.band] = (cnt[h.band] || 0) + 1; });
      var bands = S.lvl === 'out' ? ['out'] : S.lvl === 'critical' ? ['critical'] : S.lvl === 'ocl' ? ['out', 'critical', 'low'] : ['out', 'critical'];
      var all = H.filter(function (h) { return Number(h.max_level) > 0 && bands.indexOf(h.band) >= 0; }).sort(function (a, b) { return Number(b.avg_daily) - Number(a.avg_daily); });
      var attn = all.slice(0, Number(S.top));
      var by = {}; core.bal.forEach(function (b) { if (ids[b.item_id] && Number(b.qty) > 0) by[b.warehouse_id] = (by[b.warehouse_id] || 0) + 1; });
      var nre = sg.filter(function (s) { return ids[s.item_id]; }).length;
      $('#dc').hidden = !S.grp;
      $('#dbody').innerHTML =
        '<div class="kpis">' + kpi('Items tracked', H.length, 'var(--ink)', '#/stock') + kpi('In stock', instock, BAND.healthy[1], '#/stock') + kpi('Out of stock', cnt.out || 0, BAND.out[1], '#/stock') +
        kpi('Critical', cnt.critical || 0, BAND.critical[1], '#/stock') + kpi('Low', cnt.low || 0, BAND.low[1], '#/stock') + kpi('To reorder', nre, 'var(--ink)', '#/reorder') + '</div>' +
        '<div class="cols"><section class="card2"><div class="tag">Needs attention · fastest sellers first · showing ' + attn.length + ' of ' + all.length + '</div>' +
        (attn.length ? '<div class="tw"><table class="t"><tbody>' + attn.map(function (h) {
          return '<tr><td>' + cell(h) + '</td><td class="r"><b>' + num(h.stock) + '</b> <span class="mu">' + esc(h.unit) + '</span></td><td class="r mu">sells ' + num(Math.round(Number(h.avg_daily))) + '/day</td><td>' + bar(h) + '</td><td>' + chip(h.band) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">Nothing here. Good.</div>') + '</section>' +
        '<section class="card2"><div class="tag">Items in stock, by warehouse</div><div class="whs">' + core.wh.map(function (w) {
          return '<div class="wcard"><b>' + num(by[w.id] || 0) + '</b><span>' + esc(w.code) + '</span><small>' + esc(w.name) + '</small></div>';
        }).join('') + '</div></section></div>' +
        '<section class="card2" style="margin-top:16px"><div class="tag">Recent movements</div>' + movesTable(mv) + '</section>';
      if (anim) fx($('#dbody'), 'fx2');
    }
    [['dg', 'grp'], ['dl', 'lvl'], ['dt', 'top']].forEach(function (x) { $('#' + x[0]).onchange = function (e) { S[x[1]] = e.target.value; paint(true); }; });
    $('#dc').onclick = function () { S.grp = ''; $('#dg').value = ''; paint(true); };
    paint(false);
    soft(v, c, 'dashboard');
  };

  /* ---------- RECEIVE / ISSUE / TRANSFER ---------- */
  function moveForm(kind) {
    return async function (v, c) {
      ctx = c; D = c.demo ? demo : real; loading(v);
      var core;
      try { core = await getCore(); } catch (e) { return failed(v, e); }
      var T = {
        receive: { h: 'Receive', s: 'Book goods in against a PO or invoice. Open indents are matched automatically.', types: ['receipt'], btn: 'Receive stock', fn: 'post_receipt' },
        issue: { h: 'Issue', s: 'Take goods out for a dispatch. The system blocks it if the warehouse does not have enough.', types: ['issue'], btn: 'Issue stock', fn: 'post_issue' },
        transfer: { h: 'Transfer', s: 'Move stock from one warehouse to another in one entry, so nothing goes missing in between.', types: ['transfer_out'], btn: 'Transfer stock', fn: 'post_transfer' }
      }[kind];
      if (!canPost()) { v.innerHTML = head(T.h, T.s) + '<div class="card2"><p>Your role is view only, so you cannot post stock.</p></div>'; return; }
      var wopts = core.wh.map(function (w) { return '<option value="' + w.id + '">' + esc(w.code) + ' · ' + esc(w.name) + '</option>'; }).join('');
      var dl = core.items.map(function (i) { return '<option value="' + esc(i.code + ' · ' + i.name) + '"></option>'; }).join('');
      v.innerHTML = head(T.h, T.s) +
        '<div class="cols2"><form class="card2 mf" id="mf" autocomplete="off" novalidate>' +
        '<label class="fl">Item<input class="inp" id="item" list="dl" placeholder="Type code or name" required></label><datalist id="dl">' + dl + '</datalist>' +
        (kind === 'transfer'
          ? '<div class="two"><label class="fl">From<select class="inp" id="from">' + wopts + '</select></label><label class="fl">To<select class="inp" id="to">' + wopts + '</select></label></div>'
          : '<label class="fl">Warehouse<select class="inp" id="wh">' + wopts + '</select></label>') +
        '<div class="hint" id="hint">Pick an item to see what is in stock.</div>' +
        '<div class="two"><label class="fl">Quantity<input class="inp" id="qty" type="number" inputmode="decimal" min="0" step="any" placeholder="0" required></label>' +
        '<label class="fl">Date (blank = today)<input class="inp" id="date" type="date"></label></div>' +
        (kind === 'receive' ? '<div class="two" id="bx"><label class="fl">Batch no.<input class="inp" id="batch"></label><label class="fl">Expiry date<input class="inp" id="exp" type="date"></label></div>' : '') +
        '<label class="fl">' + (kind === 'receive' ? 'PO / invoice no.' : kind === 'issue' ? 'Invoice / dispatch no.' : 'Reference') + '<input class="inp" id="ref"></label>' +
        '<label class="fl">Note<input class="inp" id="note"></label>' +
        '<div class="err2" id="e"></div><button class="b2" id="go" type="submit">' + T.btn + '</button></form>' +
        '<section class="card2"><div class="tag">Last ' + T.h.toLowerCase() + ' entries</div><div id="recent"></div></section></div>';
      if (kind === 'transfer' && core.wh.length > 1) $('#to').selectedIndex = 1;
      var map = {};
      core.items.forEach(function (i) { map[(i.code + ' · ' + i.name).toLowerCase()] = i; map[i.code.toLowerCase()] = i; });
      function pick() {
        var t = $('#item').value.trim().toLowerCase(); if (!t) return null;
        if (map[t]) return map[t];
        var hit = core.items.filter(function (i) { return i.name.toLowerCase() === t; }); return hit.length === 1 ? hit[0] : null;
      }
      function balOf(item, wh) { var r = core.bal.filter(function (b) { return b.item_id === item && b.warehouse_id === wh; })[0]; return r ? Number(r.qty) : 0; }
      function hint() {
        var it = pick(), el = $('#hint');
        if (!it) { el.textContent = 'Pick an item to see what is in stock.'; el.className = 'hint'; if ($('#bx')) $('#bx').style.display = ''; return; }
        var w = kind === 'transfer' ? $('#from').value : $('#wh').value, b = balOf(it.id, w);
        el.innerHTML = 'In stock here: <b>' + num(b) + '</b> ' + esc(it.unit) + (it.track_batch && kind === 'receive' ? ' · this item is batch tracked, fill batch and expiry' : '');
        el.className = 'hint' + (b <= 0 && kind !== 'receive' ? ' warn' : '');
      }
      async function recent() {
        try { $('#recent').innerHTML = movesTable(await D.moves(T.types, 8)); } catch (e) { $('#recent').innerHTML = '<div class="empty">' + esc(errMsg(e)) + '</div>'; }
      }
      $('#item').oninput = hint; $('#item').onchange = hint;
      ['#wh', '#from'].forEach(function (s) { if ($(s)) $(s).onchange = hint; });
      $('#mf').onsubmit = async function (e) {
        e.preventDefault();
        var err = $('#e'), it = pick(), q = Number($('#qty').value);
        err.textContent = '';
        if (!it) { err.textContent = 'Pick an item from the list.'; $('#item').focus(); return; }
        if (!(q > 0)) { err.textContent = 'Enter a quantity above zero.'; $('#qty').focus(); return; }
        var a = { p_item: it.id, p_qty: q };
        if (kind === 'transfer') {
          a.p_from = $('#from').value; a.p_to = $('#to').value;
          if (a.p_from === a.p_to) { err.textContent = 'From and To must be different.'; return; }
        } else a.p_wh = $('#wh').value;
        if ($('#date').value) a.p_date = $('#date').value;
        if ($('#ref').value.trim()) a.p_ref = $('#ref').value.trim();
        if ($('#note').value.trim()) a.p_note = $('#note').value.trim();
        if (kind === 'receive') { if ($('#batch').value.trim()) a.p_batch = $('#batch').value.trim(); if ($('#exp').value) a.p_expiry = $('#exp').value; }
        var btn = $('#go'); btn.disabled = true; btn.textContent = 'Saving…';
        try {
          await D.post(T.fn, a);
          c.say(T.h + ' saved: ' + num(q) + ' ' + it.unit + ' of ' + it.code);
          dirty(); core = await getCore(true);
          $('#item').value = ''; $('#qty').value = ''; $('#ref').value = ''; $('#note').value = '';
          if ($('#batch')) { $('#batch').value = ''; $('#exp').value = ''; }
          hint(); recent(); $('#item').focus();
        } catch (x) { err.textContent = errMsg(x); }
        btn.disabled = false; btn.textContent = T.btn;
      };
      recent(); $('#item').focus();
    };
  }
  P.receive = moveForm('receive'); P.issue = moveForm('issue'); P.transfer = moveForm('transfer');

  /* ---------- COUNT ---------- */
  P.count = async function (v, c) {
    ctx = c; D = c.demo ? demo : real; loading(v);
    var core;
    try { core = await getCore(); } catch (e) { return failed(v, e); }
    if (!canPost()) { v.innerHTML = head('Count', 'Enter a physical count.') + '<div class="card2"><p>Your role is view only.</p></div>'; return; }
    var whId = core.wh[0] && core.wh[0].id, q = '';
    v.innerHTML = head('Count', 'Pick a warehouse, type what you physically counted, and save. The difference is posted as an adjustment and the count history is kept.') +
      '<div class="bar2"><select class="inp sm" id="cw">' + core.wh.map(function (w) { return '<option value="' + w.id + '">' + esc(w.code) + ' · ' + esc(w.name) + '</option>'; }).join('') + '</select>' +
      '<input class="inp sm" id="cq" type="search" placeholder="Search item" autocomplete="off"><button class="b2 inl" id="save" type="button">Save counts</button></div>' +
      '<div class="err2" id="ce"></div><div class="tw card2 flush" id="ctbl"></div>';
    var typed = {};
    function sys(item) { var r = core.bal.filter(function (b) { return b.item_id === item && b.warehouse_id === whId; })[0]; return r ? Number(r.qty) : 0; }
    function draw() {
      var s = q.toLowerCase();
      var rows = core.items.filter(function (i) { return !s || (i.code + ' ' + i.name).toLowerCase().indexOf(s) >= 0; }).slice(0, 300);
      $('#ctbl').innerHTML = '<table class="t"><thead><tr><th>Item</th><th class="r">System</th><th class="r">Counted</th><th class="r">Difference</th></tr></thead><tbody>' +
        rows.map(function (i) {
          var t = typed[whId + '|' + i.id], d = t === undefined || t === '' ? null : Number(t) - sys(i.id);
          return '<tr><td><b>' + esc(i.code) + '</b><br><span class="mu">' + esc(i.name) + '</span></td><td class="r">' + num(sys(i.id)) + ' <span class="mu">' + esc(i.unit) + '</span></td>' +
            '<td class="r"><input class="inp cin" data-i="' + i.id + '" type="number" min="0" step="any" inputmode="decimal" value="' + (t === undefined ? '' : esc(t)) + '"></td>' +
            '<td class="r dd ' + (d == null ? '' : d < 0 ? 'neg' : d > 0 ? 'pos' : 'zero') + '">' + (d == null ? '' : (d > 0 ? '+' : '') + num(d)) + '</td></tr>';
        }).join('') + '</tbody></table>';
      $$('.cin', v).forEach(function (el) {
        el.oninput = function () {
          typed[whId + '|' + el.getAttribute('data-i')] = el.value;
          var tr = el.closest('tr'), d = el.value === '' ? null : Number(el.value) - sys(el.getAttribute('data-i')), cell = $('.dd', tr);
          cell.textContent = d == null ? '' : (d > 0 ? '+' : '') + num(d); cell.className = 'r dd ' + (d == null ? '' : d < 0 ? 'neg' : d > 0 ? 'pos' : 'zero');
        };
      });
    }
    $('#cw').onchange = function (e) { whId = e.target.value; draw(); };
    $('#cq').oninput = function (e) { q = e.target.value; draw(); };
    $('#save').onclick = async function () {
      var todo = Object.keys(typed).filter(function (k) { return k.split('|')[0] === whId && typed[k] !== ''; });
      var err = $('#ce'); err.textContent = '';
      if (!todo.length) { err.textContent = 'Type at least one counted quantity.'; return; }
      var b = $('#save'); b.disabled = true; b.textContent = 'Saving…';
      var ok = 0, fail = 0;
      for (var k = 0; k < todo.length; k++) {
        try { await D.post('post_count', { p_item: todo[k].split('|')[1], p_wh: whId, p_counted: Number(typed[todo[k]]) }); ok++; delete typed[todo[k]]; }
        catch (x) { fail++; err.textContent = errMsg(x); }
      }
      dirty(); try { core = await getCore(true); } catch (x) { }
      c.say(ok + ' count' + (ok === 1 ? '' : 's') + ' saved' + (fail ? ', ' + fail + ' failed' : ''));
      b.disabled = false; b.textContent = 'Save counts'; draw();
    };
    draw();
  };

  /* ---------- REORDER ---------- */
  P.reorder = async function (v, c) {
    ctx = c; D = c.demo ? demo : real; loading(v, true);
    var sg, ind, core;
    try { var rr = await Promise.all([getCore(), D.suggestions(), D.indents()]); core = rr[0]; sg = rr[1]; ind = rr[2]; } catch (e) { return failed(v, e); }
    var S = F.reorder, iby = {}; core.items.forEach(function (i) { iby[i.id] = i; });
    sg.forEach(function (s) { s.group_name = (iby[s.item_id] && iby[s.item_id].group_name) || null; });
    var STAT = ['draft', 'approved', 'ordered', 'received', 'cancelled'], bc = { all: sg.length };
    sg.forEach(function (s) { bc[s.band] = (bc[s.band] || 0) + 1; });
    var SO = [['demand', 'Sort: biggest demand'], ['qty', 'Sort: biggest order'], ['low', 'Sort: lowest stock'], ['name', 'Sort: name A to Z'], ['code', 'Sort: item code']];
    var sc = { all: ind.length }; ind.forEach(function (n) { sc[n.status] = (sc[n.status] || 0) + 1; });
    v.innerHTML = head('Reorder', 'Items at or below two thirds of their maximum level, counting what is already on order, rounded up to pack size.') +
      '<div class="fbar"><input class="inp sm" id="rq" type="search" placeholder="Search code, name or group" autocomplete="off" value="' + esc(S.q) + '">' +
      sel('rg', [['', 'All groups']].concat(groupsOf(core.items)), S.grp, 'Group') + sel('rs', SO, S.sort, 'Sort') + '<button type="button" class="lnk" id="rc" hidden>Clear filters</button>' +
      (canManage() ? '<button class="b2 inl" id="mk" type="button" style="margin-left:auto"' + (sg.length ? '' : ' disabled') + '>Create indent from all ' + sg.length + '</button>' : '') + '</div>' +
      chipRow('rchips', [['all', 'All'], ['out', 'Out'], ['critical', 'Critical'], ['low', 'Low'], ['healthy', 'Healthy']], S.band, bc) +
      '<div class="fcount mu" id="rcnt"></div><div class="err2" id="re"></div><div class="tw card2 flush" id="rtbl"></div>' +
      '<h2 class="h2">Indents</h2>' + chipRow('schips', [['all', 'All']].concat(STAT.map(function (s) { return [s, s.charAt(0).toUpperCase() + s.slice(1)]; })), S.st, sc) +
      '<div class="tw card2 flush" id="itbl2" style="margin-top:10px"></div>';
    var RS = {
      demand: function (a, b) { return Number(b.max_level) - Number(a.max_level); },
      qty: function (a, b) { return Number(b.suggested_qty) - Number(a.suggested_qty); },
      low: function (a, b) { return (Number(a.stock) / (Number(a.max_level) || 1)) - (Number(b.stock) / (Number(b.max_level) || 1)); },
      name: function (a, b) { return String(a.name).toLowerCase() < String(b.name).toLowerCase() ? -1 : 1; },
      code: function (a, b) { return a.code < b.code ? -1 : 1; }
    };
    function drawS(anim) {
      var s = S.q.toLowerCase();
      var rows = sg.filter(function (x) { return (S.band === 'all' || x.band === S.band) && (!S.grp || NG(x) === S.grp) && (!s || (x.code + ' ' + x.name + ' ' + (x.group_name || '')).toLowerCase().indexOf(s) >= 0); }).sort(RS[S.sort] || RS.demand);
      var on = S.q || S.grp || S.band !== 'all'; $('#rc').hidden = !on;
      $('#rcnt').textContent = 'Showing ' + num(rows.length) + ' of ' + num(sg.length) + ' item' + (sg.length === 1 ? '' : 's') + ' to order' + (on ? '. "Create indent" still uses all ' + num(sg.length) + '.' : '');
      $('#rtbl').innerHTML = rows.length ? '<table class="t"><thead><tr><th>Item</th><th class="r">Stock</th><th class="r">On order</th><th class="r">Max</th><th class="r">Order</th><th>Health</th></tr></thead><tbody>' +
        rows.map(function (x) {
          return '<tr><td>' + cell(x) + '</td><td class="r">' + num(x.stock) + '</td><td class="r">' + num(x.on_order) + '</td><td class="r">' + num(x.max_level) + '</td><td class="r"><b>' + num(x.suggested_qty) + '</b> <span class="mu">' + esc(x.unit) + '</span></td><td>' + chip(x.band) + '</td></tr>';
        }).join('') + '</tbody></table>' : '<div class="empty">' + (sg.length ? 'No items match these filters.' : 'Nothing to reorder. Everything is above two thirds of its maximum.') + '</div>';
      if (anim) fx($('#rtbl'));
    }
    function drawI(anim) {
      var L2 = ind.filter(function (n) { return S.st === 'all' || n.status === S.st; });
      $('#itbl2').innerHTML = L2.length ? '<table class="t"><thead><tr><th>No.</th><th>Date</th><th class="r">Lines</th><th class="r">Received</th><th>Status</th></tr></thead><tbody>' +
        L2.map(function (n) {
          var L = n.indent_lines || [], q = L.reduce(function (a, l) { return a + Number(l.qty); }, 0), r = L.reduce(function (a, l) { return a + Number(l.received_qty); }, 0);
          return '<tr><td><b>' + esc(n.indent_no) + '</b></td><td>' + esc(fmtDate(n.created_at)) + '</td><td class="r">' + L.length + '</td><td class="r">' + num(r) + ' / ' + num(q) + '</td><td>' +
            (canManage() ? '<select class="inp sm st" data-id="' + esc(n.id) + '">' + STAT.map(function (x) { return '<option' + (x === n.status ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>' : esc(n.status)) + '</td></tr>';
        }).join('') + '</tbody></table>' : '<div class="empty">No indents' + (S.st === 'all' ? ' yet.' : ' with this status.') + '</div>';
      $$('.st', v).forEach(function (el) {
        el.onchange = async function () { try { await D.setIndent(el.getAttribute('data-id'), el.value); ind.forEach(function (n) { if (n.id === el.getAttribute('data-id')) n.status = el.value; }); c.say('Indent marked ' + el.value); } catch (e) { c.say(errMsg(e)); } };
      });
      if (anim) fx($('#itbl2'));
    }
    var qt; $('#rq').oninput = function (e) { S.q = e.target.value; clearTimeout(qt); qt = setTimeout(function () { drawS(true); }, 120); };
    $('#rg').onchange = function (e) { S.grp = e.target.value; drawS(true); };
    $('#rs').onchange = function (e) { S.sort = e.target.value; drawS(true); };
    $('#rc').onclick = function () { S.q = ''; S.grp = ''; S.band = 'all'; P.reorder(v, c); };
    chipsOn(v, 'rchips', function (b) { S.band = b; drawS(true); });
    chipsOn(v, 'schips', function (b) { S.st = b; drawI(true); });
    var mk = $('#mk');
    if (mk) mk.onclick = async function () {
      mk.disabled = true; $('#re').textContent = '';
      try { await D.createIndent(null); c.say('Indent created as a draft'); P.reorder(v, c); } catch (e) { $('#re').textContent = errMsg(e); mk.disabled = false; }
    };
    drawS(false); drawI(false);
    soft(v, c, 'reorder');
  };

  /* ---------- SETTINGS ---------- */
  P.settings = async function (v, c) {
    ctx = c; D = c.demo ? demo : real; loading(v);
    var core, people = [];
    try { core = await getCore(); if (canManage()) people = await D.people(); } catch (e) { return failed(v, e); }
    var edit = null, IS = F.items;
    function drawItems(anim) {
      var s = IS.q.toLowerCase();
      var rows = core.items.filter(function (i) { return (!IS.grp || NG(i) === IS.grp) && (!IS.photo || (IS.photo === 'with') === !!i.image_url) && (!s || (i.code + ' ' + i.name + ' ' + (i.group_name || '')).toLowerCase().indexOf(s) >= 0); });
      var shown = rows.slice(0, IS.lim);
      $('#icnt').textContent = 'Showing ' + num(shown.length) + ' of ' + num(rows.length) + ' items';
      $('#itbl').innerHTML = rows.length ? '<table class="t"><thead><tr><th>Item</th><th>Group</th><th class="r">Lead</th><th class="r">MOQ</th><th class="r">Daily start</th>' + (canManage() ? '<th></th>' : '') + '</tr></thead><tbody>' +
        shown.map(function (i) {
          return '<tr><td>' + cell(i) + '</td><td class="mu">' + esc(i.group_name || '') + '</td><td class="r">' + i.lead_time_days + 'd</td><td class="r">' + num(i.moq) + '</td><td class="r">' + num(i.seed_daily_usage) + '</td>' +
            (canManage() ? '<td class="r"><button class="lnk" data-e="' + esc(i.code) + '" type="button">Edit</button></td>' : '') + '</tr>';
        }).join('') + '</tbody></table>' + (rows.length > IS.lim ? '<div class="empty"><button type="button" class="b2 inl ghost" id="imore">Show 100 more (' + num(rows.length - IS.lim) + ' left)</button></div>' : '') : '<div class="empty">No items match.</div>';
      var mo = $('#imore'); if (mo) mo.onclick = function () { IS.lim += 100; drawItems(false); };
      $$('[data-e]', $('#itbl')).forEach(function (b) {
        b.onclick = function () { edit = core.items.filter(function (i) { return i.code === b.getAttribute('data-e'); })[0]; draw(); window.scrollTo(0, $('#itf').offsetTop - 20); };
      });
      if (anim) fx($('#itbl'));
    }
    function draw() {
      var it = edit || { lead_time_days: 7, safety_factor: 1.2, moq: 0, seed_daily_usage: 0, unit: 'pcs' };
      v.innerHTML = head('Settings', 'Warehouses, items and people.') +
        '<h2 class="h2">Warehouses</h2><div class="tw card2 flush"><table class="t"><thead><tr><th>Code</th><th>Name</th><th>Type</th></tr></thead><tbody>' +
        core.wh.map(function (w) { return '<tr><td><b>' + esc(w.code) + '</b></td><td>' + esc(w.name) + '</td><td class="mu">' + esc(w.kind) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        (canManage() ? '<form class="card2 inlineform" id="wf"><input class="inp sm" id="wc" placeholder="Code (e.g. NOI)" maxlength="8" required><input class="inp sm" id="wn" placeholder="Name" required><select class="inp sm" id="wk"><option value="warehouse">warehouse</option><option value="office">office</option></select><button class="b2 inl" type="submit">Add warehouse</button></form>' : '') +
        '<h2 class="h2">Items <span class="mu">' + core.items.length + '</span></h2>' +
        (canManage() ? '<div id="bulkph" style="margin-bottom:14px"></div>' : '') +
        (canManage() ? '<form class="card2 mf" id="itf"><div class="two"><label class="fl">Code<input class="inp" id="ic" value="' + esc(it.code || '') + '"' + (edit ? ' readonly' : '') + ' required></label><label class="fl">Name<input class="inp" id="in" value="' + esc(it.name || '') + '" required></label></div>' +
          '<div class="four"><label class="fl">Group<input class="inp" id="ig" value="' + esc(it.group_name || '') + '"></label><label class="fl">Unit<input class="inp" id="iu" value="' + esc(it.unit) + '" required></label>' +
          '<label class="fl">Lead time (days)<input class="inp" id="il" type="number" min="0" value="' + esc(it.lead_time_days) + '"></label><label class="fl">Safety factor<input class="inp" id="is" type="number" min="1" step="0.05" value="' + esc(it.safety_factor) + '"></label></div>' +
          '<div class="four"><label class="fl">Pack size (MOQ)<input class="inp" id="im" type="number" min="0" step="any" value="' + esc(it.moq) + '"></label><label class="fl">Starting daily usage<input class="inp" id="id" type="number" min="0" step="any" value="' + esc(it.seed_daily_usage) + '"></label>' +
          '<label class="fl ck"><input id="ib" type="checkbox"' + (it.track_batch ? ' checked' : '') + '> Track batch and expiry</label></div>' +
          '<div class="err2" id="ie"></div><div class="two"><button class="b2" type="submit">' + (edit ? 'Save changes' : 'Add item') + '</button>' + (edit ? '<button class="b2 ghost" type="button" id="cx">Cancel</button>' : '') + '</div></form>' : '') +
        '<div class="fbar"><input class="inp sm" id="iq" type="search" placeholder="Search items" autocomplete="off" value="' + esc(IS.q) + '">' + sel('igp', [['', 'All groups']].concat(groupsOf(core.items)), IS.grp, 'Group') +
        sel('ipf', [['', 'All photos'], ['with', 'With photo'], ['without', 'No photo yet']], IS.photo, 'Photo') + '</div><div class="fcount mu" id="icnt"></div>' +
        '<div class="tw card2 flush" id="itbl"></div>' +
        (canManage() ? '<h2 class="h2">People</h2><div class="tw card2 flush"><table class="t"><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody>' +
          people.map(function (p) {
            return '<tr><td>' + esc(p.full_name || '') + (p.active ? '' : ' <span class="mu">(inactive)</span>') + '</td><td>' + (isAdmin() ? '<select class="inp sm rl" data-u="' + esc(p.user_id) + '">' +
              ['admin', 'manager', 'staff', 'viewer'].map(function (r) { return '<option' + (r === p.role ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select>' : esc(p.role)) + '</td></tr>';
          }).join('') + '</tbody></table></div><p class="mu note">To add a person: create their login in Supabase (Authentication, Users), then add them here by linking a profile. Roles: admin does everything, manager can order and edit items, staff posts stock, viewer only looks.</p>' : '');
      if ($('#bulkph') && window.PHOTOS) window.PHOTOS.mountBulk($('#bulkph'), P.__env());
      var wf = $('#wf');
      if (wf) wf.onsubmit = async function (e) {
        e.preventDefault();
        try { await D.addWh({ code: $('#wc').value.trim().toUpperCase(), name: $('#wn').value.trim(), kind: $('#wk').value }); c.say('Warehouse added'); dirty(); core = await getCore(true); draw(); } catch (x) { c.say(errMsg(x)); }
      };
      var itf = $('#itf');
      if (itf) itf.onsubmit = async function (e) {
        e.preventDefault();
        var row = { code: $('#ic').value.trim(), name: $('#in').value.trim(), group_name: $('#ig').value.trim() || null, unit: $('#iu').value.trim() || 'pcs',
          lead_time_days: parseInt($('#il').value || '7', 10), safety_factor: Number($('#is').value || 1.2), moq: Number($('#im').value || 0), seed_daily_usage: Number($('#id').value || 0), track_batch: $('#ib').checked };
        try { await D.saveItem(row); c.say('Item saved'); edit = null; dirty(); core = await getCore(true); draw(); } catch (x) { $('#ie').textContent = errMsg(x); }
      };
      if ($('#cx')) $('#cx').onclick = function () { edit = null; draw(); };
      var iqt; $('#iq').oninput = function (e) { IS.q = e.target.value; IS.lim = 100; clearTimeout(iqt); iqt = setTimeout(function () { drawItems(true); }, 120); };
      $('#igp').onchange = function (e) { IS.grp = e.target.value; IS.lim = 100; drawItems(true); };
      $('#ipf').onchange = function (e) { IS.photo = e.target.value; IS.lim = 100; drawItems(true); };
      drawItems(false);
      $$('.rl', v).forEach(function (s) {
        s.onchange = async function () { try { await D.setRole(s.getAttribute('data-u'), s.value); c.say('Role updated'); } catch (x) { c.say(errMsg(x)); } };
      });
    }
    draw();
  };
})();
