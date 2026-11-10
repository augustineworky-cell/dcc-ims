/* GoodsGuru item pictures: side panel, auto pictures for items without a photo, bulk upload.
   Needs window.PAGES.__env() from pages.js -> { ctx, D, core, canManage }. */
(function () {
  'use strict';
  var PH = window.PHOTOS = {};
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function num(x) { if (x == null || x === '') return '–'; return Number(x).toLocaleString('en-IN', { maximumFractionDigits: 3 }); }
  function env() { return window.PAGES.__env(); }
  function errMsg(e) { var m = (e && (e.message || e.error_description)) || String(e); if (/row-level security|permission denied|JWT/i.test(m)) return 'Your login may have expired, or you do not have permission for this. Sign out, sign in again and retry.'; return m; }

  /* ---------- lookups (cached per core object) ---------- */
  var cache = { core: null, items: {}, health: {} };
  function maps() {
    var c = env().core;
    if (!c) return cache;
    if (cache.core !== c) {
      cache = { core: c, items: {}, health: {} };
      c.items.forEach(function (i) { cache.items[i.id] = i; });
      c.health.forEach(function (h) { cache.health[h.item_id] = h; });
    }
    return cache;
  }

  /* ---------- picture for an item with no photo ---------- */
  function hue(s) { var h = 7; s = String(s || 'x'); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  var SHAPES = {
    cone: '<circle cx="50" cy="34" r="21"/><path d="M31 48h38L50 90z"/>',
    tub: '<rect x="20" y="26" width="60" height="13" rx="5"/><path d="M25 42h50l-6 44H31z"/>',
    bar: '<rect x="33" y="12" width="34" height="58" rx="15"/><rect x="46" y="68" width="8" height="22" rx="3"/>',
    bottle: '<rect x="41" y="9" width="18" height="14" rx="3"/><path d="M35 26h30l4 13v46a6 6 0 0 1-6 6H37a6 6 0 0 1-6-6V39z"/>',
    box: '<rect x="20" y="26" width="60" height="54" rx="7"/><rect x="44" y="26" width="12" height="54" fill="rgba(0,0,0,.18)"/>'
  };
  function kind(n) {
    n = String(n || '').toLowerCase();
    if (/cone|cornet/.test(n)) return 'cone';
    if (/\b(bar|stick|candy|kulfi|bite|choco ?bar)\b/.test(n)) return 'bar';
    if (/\b(tub|cup|tray|family|jar|brick)\b/.test(n)) return 'tub';
    if (/bottle|shake|drink|juice|milk|lassi|syrup|sauce/.test(n)) return 'bottle';
    return 'box';
  }
  function art(it) {
    var h = hue(it.group_name || String(it.name || '').split(' ')[0]);
    return '<div class="art" style="background:linear-gradient(145deg,hsl(' + h + ' 58% 52%),hsl(' + ((h + 35) % 360) + ' 62% 36%))"><svg viewBox="0 0 100 100" fill="rgba(255,255,255,.92)" aria-hidden="true">' + SHAPES[kind(it.name)] + '</svg></div>';
  }
  function inner(it) { return it.image_url ? '<img src="' + esc(it.image_url) + '" alt="" loading="lazy" decoding="async" width="64" height="64">' : art(it); }
  PH.thumb = function (it, cls) { return '<span class="th ' + (cls || '') + '" data-th="' + esc(it.id) + '">' + inner(it) + '</span>'; };

  /* clickable cell for tables: picture + code + name. Opens the side panel. */
  PH.cell = function (h) {
    var it = maps().items[h.item_id || h.id];
    var body = '<span class="icn"><b>' + esc(h.code) + '</b><span class="mu">' + esc(h.name) + '</span></span>';
    if (!it) return body;
    return '<button type="button" class="ic" data-item="' + esc(it.id) + '">' + PH.thumb(it) + body + '</button>';
  };
  PH.refresh = function (id) {
    var it = maps().items[id]; if (!it) return;
    $$('[data-th="' + id + '"]').forEach(function (el) { el.innerHTML = inner(it); });
  };
  // broken image link -> fall back to the generated picture
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.parentNode && t.parentNode.getAttribute && t.parentNode.getAttribute('data-th')) {
      var it = maps().items[t.parentNode.getAttribute('data-th')]; if (it) t.parentNode.innerHTML = art(it);
    }
  }, true);

  /* ---------- image helpers ---------- */
  function shrink(file, max) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var s = Math.min(1, max / Math.max(im.width, im.height)), w = Math.max(1, Math.round(im.width * s)), h = Math.max(1, Math.round(im.height * s));
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0, w, h);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? res(b) : rej(new Error('Could not read ' + (file.name || 'image'))); }, 'image/webp', 0.82);
      };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Not a picture: ' + (file.name || 'file'))); };
      im.src = url;
    });
  }
  /* every save is counted; every failure stays on screen until dismissed */
  var ST = { ok: 0, fail: 0, last: '', items: [] };
  function banner() {
    var b = $('#phfail');
    if (!ST.fail) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'phfail'; b.className = 'phfail'; document.body.appendChild(b); b.onclick = function (e) { if (e.target.closest('[data-x]')) { ST.fail = 0; ST.items = []; banner(); } }; }
    b.innerHTML = '<div><b>' + ST.fail + ' photo' + (ST.fail === 1 ? '' : 's') + ' NOT saved.</b> ' + esc(ST.last) + '<br><span>' + esc(ST.items.slice(-6).join(', ')) + (ST.items.length > 6 ? ' …' : '') + '</span></div><button type="button" data-x="1">Dismiss</button>';
  }
  function failed(code, x) { ST.fail++; ST.last = errMsg(x); ST.items.push(code); banner(); }
  PH.stats = function () { return ST; };
  async function savePhoto(it, file) {
    var E = env();
    try {
      var blob = await shrink(file, 640);
      var url = await E.D.setPhoto(it, blob);
      it.image_url = url; PH.refresh(it.id); ST.ok++;
      return url;
    } catch (x) { failed(it.code, x); throw x; }
  }
  PH.savePhoto = savePhoto;

  PH.auto = true;
  function rankedItems() { return env().core.items.slice().sort(function (a, b) { return (Number(b.seed_daily_usage) - Number(a.seed_daily_usage)) || (a.code < b.code ? -1 : 1); }); }
  function photoCount() { var it = env().core.items, n = 0; it.forEach(function (i) { if (i.image_url) n++; }); return [n, it.length]; }
  function nextMissing(afterId) {
    var r = rankedItems(), k = -1, i;
    for (i = 0; i < r.length; i++) if (r[i].id === afterId) { k = i; break; }
    for (i = 1; i <= r.length; i++) { var x = r[(k + i) % r.length]; if (!x.image_url && x.id !== afterId) return x; }
    return null;
  }
  function afterSave(it) {
    var E = env();
    if (PH.auto) { var nx = nextMissing(it.id); if (nx) { PH.open(nx.id); return; } E.ctx.say('Every item has a photo now'); }
    render(it);
  }

  /* ---------- side panel ---------- */
  var panel, curId = null;
  function ensurePanel() {
    if (panel) return;
    panel = document.createElement('div'); panel.className = 'ip-wrap'; panel.hidden = true;
    panel.innerHTML = '<div class="ip-bg" data-close="1"></div><aside class="ip" role="dialog" aria-label="Item details"><button type="button" class="ip-x" data-close="1" aria-label="Close">×</button><div class="ip-body"></div></aside>';
    document.body.appendChild(panel);
    panel.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) PH.close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) PH.close(); });
    window.addEventListener('hashchange', function () { PH.close(); });
    document.addEventListener('paste', async function (e) {
      if (panel.hidden || !curId) return;
      var E = env(); if (!E.canManage()) return;
      var files = (e.clipboardData && e.clipboardData.files) || [], f = null;
      for (var i = 0; i < files.length; i++) if (/^image\//.test(files[i].type)) { f = files[i]; break; }
      if (!f) return;
      e.preventDefault();
      var it = maps().items[curId]; if (!it) return;
      if (it.image_url && !E.isAdmin()) { E.ctx.say('Only the admin can replace a photo'); return; }
      E.ctx.say('Saving pasted photo…');
      try { await savePhoto(it, f); E.ctx.say('Photo saved'); afterSave(it); } catch (x) { E.ctx.say(errMsg(x)); }
    });
  }
  PH.close = function () { if (panel) { panel.hidden = true; document.body.classList.remove('ip-open'); } curId = null; };
  PH.open = async function (id) {
    var m = maps(), it = m.items[id]; if (!it) return;
    ensurePanel(); curId = id; panel.hidden = false; document.body.classList.add('ip-open');
    render(it);
    var E = env(), box = $('#ipm', panel);
    try {
      var mv = await E.D.itemMoves(id, 10);
      if (curId !== id || !box) return;
      box.innerHTML = mv.length ? '<table class="t"><tbody>' + mv.map(function (x) {
        return '<tr><td class="mu">' + esc(String(x.occurred_on || '').slice(5)) + '</td><td>' + esc(String(x.move_type).replace('_', ' ')) + '</td><td>' + esc((x.warehouses && x.warehouses.code) || x.wh || '') + '</td><td class="r"><b class="' + (x.qty < 0 ? 'neg' : '') + '">' + (x.qty > 0 ? '+' : '') + num(x.qty) + '</b></td><td class="mu">' + esc(x.ref_no || '') + '</td></tr>';
      }).join('') + '</tbody></table>' : '<div class="empty sm">No movements yet.</div>';
    } catch (x) { if (box) box.innerHTML = '<div class="empty sm">' + esc(errMsg(x)) + '</div>'; }
  };
  function render(it) {
    var E = env(), m = maps(), h = m.health[it.id] || {}, core = E.core;
    var BANDS = { out: ['Out of stock', '#c8102e'], critical: ['Critical', '#e5483a'], low: ['Low', '#e08a00'], healthy: ['Healthy', '#0f7b4a'], over: ['Over', '#3a6fd8'], 'no-usage': ['No usage', '#7a869b'] };
    var b = BANDS[h.band] || BANDS['no-usage'];
    var wrows = core.wh.map(function (w) {
      var q = core.bal.filter(function (x) { return x.item_id === it.id && x.warehouse_id === w.id; }).reduce(function (a, x) { return a + Number(x.qty); }, 0);
      return '<div class="wr"><span>' + esc(w.code) + ' <span class="mu">' + esc(w.name) + '</span></span><b class="' + (q < 0 ? 'neg' : (q === 0 ? 'zero' : '')) + '">' + num(q) + '</b></div>';
    }).join('');
    var trig = Number(h.max_level) > 0 ? Math.ceil(Number(h.max_level) * 0.66) : null;
    var q = encodeURIComponent((it.name + ' ' + (it.group_name || '')).trim());
    var mg = E.canManage(), adm = E.isAdmin();
    $('.ip-body', panel).innerHTML =
      '<div class="ip-pic" data-th="' + esc(it.id) + '">' + inner(it) + '</div>' +
      (it.image_url ? '' : '<p class="mu ip-note">Temporary picture. Upload the real photo below.</p>') +
      '<h2 class="ip-h">' + esc(it.name) + '</h2>' +
      '<div class="ip-sub"><b>' + esc(it.code) + '</b>' + (it.group_name ? ' · ' + esc(it.group_name) : '') + ' <span class="pill" style="--c:' + b[1] + '">' + b[0] + '</span></div>' +
      '<div class="ip-stats">' +
      '<div><small>In stock</small><b>' + num(h.stock) + '</b><span class="mu">' + esc(it.unit) + '</span></div>' +
      '<div><small>Sells per day</small><b>' + num(Math.round(Number(h.avg_daily || 0) * 10) / 10) + '</b></div>' +
      '<div><small>Max level</small><b>' + num(h.max_level) + '</b></div>' +
      '<div><small>Reorder at</small><b>' + (trig == null ? '–' : num(trig)) + '</b></div>' +
      '<div><small>Lead time</small><b>' + esc(it.lead_time_days) + 'd</b></div>' +
      '<div><small>Pack size</small><b>' + num(it.moq) + '</b></div></div>' +
      '<div class="tag">By warehouse</div><div class="wl">' + wrows + '</div>' +
      '<div class="tag" style="margin-top:18px">Last movements</div><div id="ipm"><div class="empty sm">Loading…</div></div>' +
      (mg ? '<div class="tag" style="margin-top:18px">Photo · ' + photoCount()[0] + ' of ' + photoCount()[1] + ' items done · this session: ' + ST.ok + ' saved, ' + ST.fail + ' failed</div><div class="pact">' +
        ((it.image_url && !adm) ? '' : '<label class="b2 inl up">' + (it.image_url ? 'Replace photo' : 'Upload photo') + '<input type="file" accept="image/*" hidden id="ipf"></label>') +
        '<a class="b2 inl ghost up" target="_blank" rel="noopener" href="https://www.google.com/search?tbm=isch&q=' + q + '">Find photo on Google</a>' +
        ((it.image_url && adm) ? '<button type="button" class="b2 inl ghost" id="ipr">Remove</button>' : '') + '</div>' +
        ((it.image_url && !adm) ? '<p class="mu ip-note">Only the admin can replace or remove a photo.</p>' : '<p class="mu ip-note">Quick way: on Google Images right-click a picture, choose Copy image, come back here and press Ctrl+V.</p>') +
        '<label class="ck2 ip-auto"><input type="checkbox" id="ipa"' + (PH.auto ? ' checked' : '') + '> After saving, open the next item without a photo</label>' : '');
    var f = $('#ipf', panel);
    if (f) f.onchange = async function () {
      if (!f.files[0]) return; E.ctx.say('Uploading…');
      try { await savePhoto(it, f.files[0]); E.ctx.say('Photo saved'); afterSave(it); } catch (x) { E.ctx.say(errMsg(x)); }
    };
    var au = $('#ipa', panel); if (au) au.onchange = function () { PH.auto = au.checked; };
    var r = $('#ipr', panel), armed = 0;
    if (r) r.onclick = async function () {
      if (!armed) { armed = 1; r.textContent = 'Click again to remove'; r.classList.add('danger'); setTimeout(function () { armed = 0; if (r.isConnected) { r.textContent = 'Remove'; r.classList.remove('danger'); } }, 3500); return; }
      try { await E.D.clearPhoto(it); it.image_url = null; PH.refresh(it.id); E.ctx.say('Photo removed'); render(it); } catch (x) { E.ctx.say(errMsg(x)); }
    };
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-item]');
    if (a) { e.preventDefault(); PH.open(a.getAttribute('data-item')); }
  });

  /* ---------- bulk upload ---------- */
  var STOP = { the: 1, of: 1, and: 1, a: 1, img: 1, image: 1, photo: 1, jpg: 1, jpeg: 1, png: 1, webp: 1, copy: 1 };
  function toks(s) {
    s = String(s || '').toLowerCase().replace(/(\d)\s+(ml|ltr|litre|l|gm|g|kg|pcs|oz)\b/g, '$1$2').replace(/(\d)(ltr|litre)\b/g, '$1l').replace(/(\d)gm\b/g, '$1g');
    var o = {}, n = 0;
    s.split(/[^a-z0-9]+/).forEach(function (t) { if (t && !STOP[t]) { o[t] = 1; n++; } });
    return { set: o, n: n };
  }
  function dice(a, b) {
    if (!a.n || !b.n) return 0;
    var k = 0; for (var t in a.set) if (b.set[t]) k++;
    return 2 * k / (a.n + b.n);
  }
  function baseOf(name) { return String(name).replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, ''); }
  function loadZip() {
    if (window.JSZip) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = res; s.onerror = function () { rej(new Error('Could not load the zip reader. Check the internet, or choose the pictures without zipping.')); };
      document.head.appendChild(s);
    });
  }
  var IMGEXT = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
  async function expand(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (/\.zip$/i.test(f.name)) {
        await loadZip();
        var z = await window.JSZip.loadAsync(f);
        var names = Object.keys(z.files);
        for (var j = 0; j < names.length; j++) {
          var en = z.files[names[j]], bn = names[j].replace(/^.*\//, '');
          if (en.dir || !IMGEXT.test(bn) || /__MACOSX/.test(names[j]) || bn.charAt(0) === '.') continue;
          out.push(new File([await en.async('blob')], bn, { type: 'image/' + bn.split('.').pop().toLowerCase().replace('jpg', 'jpeg'), lastModified: en.date ? +en.date : 0 }));
        }
      } else if (IMGEXT.test(f.name) || /^image\//.test(f.type)) out.push(f);
    }
    return out;
  }

  PH.mountBulk = function (host, E) {
    var items = E.core.items, rows = [], busy = false;
    var codeMap = {}, itemToks = [];
    items.forEach(function (i) { codeMap[String(i.code).toLowerCase()] = i; itemToks.push({ it: i, t: toks(i.name) }); });
    var ranked = items.slice().sort(function (a, b) { return (Number(b.seed_daily_usage) - Number(a.seed_daily_usage)) || (a.code < b.code ? -1 : 1); });
    var label = {}; items.forEach(function (i) { label[(i.code + ' · ' + i.name).toLowerCase()] = i; });

    host.innerHTML = '<section class="card2" id="bk"><div class="tag">Bulk photos</div>' +
      '<p class="mu" style="margin-top:8px">Drop many pictures or one .zip. A file named by item code (<b>D0123.jpg</b>) matches exactly. Other names are matched to item names and shown for you to confirm. Nothing is saved until you press Upload.</p>' +
      '<datalist id="bdl">' + items.map(function (i) { return '<option value="' + esc(i.code + ' · ' + i.name) + '"></option>'; }).join('') + '</datalist>' +
      '<div class="ordbox"><label class="ck2"><input type="checkbox" id="bord"> Pictures are in <b>order</b> (made in batches, e.g. with Gemini): match them to the rank list instead of file names</label>' +
      '<label class="ck2"><input type="checkbox" id="bmiss" checked> Rank list = only items <b>without a photo</b></label>' +
      '<label class="mu">Start at rank # <input class="inp sm" id="bstart" type="number" min="1" value="1" style="width:90px"></label></div>' +
      '<div class="drop" id="bdrop"><b>Drop pictures or a .zip here</b><div class="pact">' +
      '<label class="b2 inl up">Choose files<input type="file" multiple accept="image/*,.zip" hidden id="bf"></label>' +
      '<label class="b2 inl ghost up">Choose a folder<input type="file" webkitdirectory multiple hidden id="bd"></label>' +
      '<button type="button" class="b2 inl ghost" id="bcsv">Download item list (CSV)</button>' +
      '<button type="button" class="b2 inl ghost" id="bmcsv">Items without photo (CSV)</button>' +
      (E.isAdmin() ? '<button type="button" class="b2 inl ghost" id="bbak">Back up all photos (zip)</button>' : '') + '</div></div>' +
      '<div id="bst" class="mu" style="margin-top:10px"></div><div id="bres"></div></section>';

    $('#bcsv', host).onclick = function () {
      var csv = 'rank,code,name,group\n' + ranked.map(function (i, k) { return [k + 1, i.code, i.name, i.group_name || ''].map(function (x) { return '"' + String(x).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'goodsguru-items.csv'; document.body.appendChild(a); a.click(); a.remove();
    };
    var pc = (function () { var n = 0; items.forEach(function (i) { if (i.image_url) n++; }); return n; })();
    $('#bk .tag', host).insertAdjacentHTML('afterend', '<div class="pbar"><i style="width:' + Math.round(100 * pc / Math.max(1, items.length)) + '%"></i></div><div class="mu" style="margin-top:6px"><b>' + pc + '</b> of ' + items.length + ' items have a photo (' + Math.round(100 * pc / Math.max(1, items.length)) + '%)</div>');
    function dl(name, text, type) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
    $('#bmcsv', host).onclick = function () {
      var miss = ranked.filter(function (x) { return !x.image_url; });
      dl('goodsguru-items-without-photo.csv', 'rank,code,name,group\n' + miss.map(function (i, k) { return [k + 1, i.code, i.name, i.group_name || ''].map(function (x) { return '"' + String(x).replace(/"/g, '""') + '"'; }).join(','); }).join('\n'));
    };
    var bak = $('#bbak', host);
    if (bak) bak.onclick = async function () {
      if (busy) return; busy = true; bak.disabled = true;
      try {
        await loadZip();
        var list = items.filter(function (i) { return i.image_url; }), z = new window.JSZip(), done = 0, bad = 0, n = 0, csv = ['code,name,image_url'];
        async function w() {
          while (n < list.length) {
            var i = list[n++];
            try { var r = await fetch(i.image_url); if (!r.ok) throw new Error('x'); z.file(String(i.code).replace(/[^A-Za-z0-9._-]/g, '_') + '.webp', await r.blob()); csv.push([i.code, i.name, i.image_url.split('?')[0]].map(function (x) { return '"' + String(x).replace(/"/g, '""') + '"'; }).join(',')); }
            catch (x) { bad++; }
            status('Backing up photos ' + (++done) + ' of ' + list.length + '…');
          }
        }
        await Promise.all([w(), w(), w(), w(), w(), w()]);
        z.file('photo_links.csv', csv.join('\n'));
        status('Packing the zip…');
        var blob = await z.generateAsync({ type: 'blob', compression: 'STORE' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'goodsguru-photos-' + new Date().toISOString().slice(0, 10) + '.zip'; document.body.appendChild(a); a.click(); a.remove();
        status('Backup downloaded: ' + (list.length - bad) + ' photos' + (bad ? ', ' + bad + ' could not be read' : '') + '.');
      } catch (x) { status(errMsg(x)); }
      busy = false; bak.disabled = false;
    };
    var drop = $('#bdrop', host);
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('on'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('on'); }); });
    drop.addEventListener('drop', function (e) { start(e.dataTransfer.files); });
    $('#bf', host).onchange = function (e) { start(e.target.files); e.target.value = ''; };
    $('#bd', host).onchange = function (e) { start(e.target.files); e.target.value = ''; };

    function status(t) { $('#bst', host).textContent = t; }

    function matchOne(r) {
      var base = baseOf(r.name), lc = base.toLowerCase().trim(), hit = null;
      if (codeMap[lc]) hit = codeMap[lc];
      if (!hit) { var first = lc.split(/[\s_]+/)[0]; if (codeMap[first]) hit = codeMap[first]; }
      if (!hit) { var parts = lc.split(/[^a-z0-9]+/); for (var i = 0; i < parts.length; i++) if (parts[i].length > 2 && codeMap[parts[i]]) { hit = codeMap[parts[i]]; break; } }
      if (hit) { r.item = hit; r.state = 'matched'; r.how = 'code'; return; }
      var ft = toks(base), best = null, bs = 0, second = 0;
      for (var k = 0; k < itemToks.length; k++) {
        var s = dice(ft, itemToks[k].t);
        if (s > bs) { second = bs; bs = s; best = itemToks[k].it; } else if (s > second) second = s;
      }
      if (best && bs >= 0.85 && bs - second >= 0.1) { r.item = best; r.state = 'matched'; r.how = 'name'; }
      else if (best && bs >= 0.5) { r.item = best; r.state = 'check'; r.how = 'guess'; }
      else { r.item = null; r.state = 'none'; r.how = ''; }
    }

    async function start(fl) {
      if (busy) return; busy = true;
      try {
        status('Reading files…');
        var files = await expand(Array.prototype.slice.call(fl));
        if (!files.length) { status('No pictures found in that selection.'); busy = false; return; }
        var ord = $('#bord', host).checked, ordList = $('#bmiss', host).checked ? ranked.filter(function (x) { return !x.image_url; }) : ranked, st0 = Math.max(1, parseInt($('#bstart', host).value || '1', 10)) - 1;
        if (ord) files.sort(function (a, b) { return (a.lastModified - b.lastModified) || (a.name < b.name ? -1 : 1); });
        var done = 0, next = 0; rows.forEach(function (r) { if (r.url) URL.revokeObjectURL(r.url); }); rows = new Array(files.length);
        async function worker() {
          while (next < files.length) {
            var ix = next++, f = files[ix];
            try {
              var blob = await shrink(f, 640);
              rows[ix] = { name: f.name, blob: blob, url: URL.createObjectURL(blob), item: null, state: 'none', include: false };
            } catch (x) { rows[ix] = { name: f.name, blob: null, url: '', item: null, state: 'bad', err: errMsg(x), include: false }; }
            status('Preparing pictures ' + (++done) + ' of ' + files.length + '…');
          }
        }
        await Promise.all([worker(), worker(), worker(), worker()]);
        var used = {};
        rows.forEach(function (r, ix) {
          if (r.state === 'bad') return;
          if (ord) {
            var it = ordList[st0 + ix];
            r.rank = st0 + ix + 1;
            if (it) { r.item = it; r.state = 'matched'; r.how = 'order'; r.include = true; used[it.id] = 1; } else { r.state = 'none'; }
            return;
          }
          matchOne(r);
          if (r.item) {
            if (used[r.item.id]) { r.state = 'check'; r.how = 'duplicate'; r.include = false; }
            else { used[r.item.id] = 1; r.include = r.state === 'matched'; }
          }
        });
        rows.forEach(function (r) { if (r.item && r.item.image_url) { r.had = true; r.include = false; if (r.state === 'matched') { r.state = 'check'; } r.how = 'haspic'; } });
        status(''); draw();
      } catch (x) { status(errMsg(x)); }
      busy = false;
    }

    function counts() { var c = { matched: 0, check: 0, none: 0, bad: 0, go: 0 }; rows.forEach(function (r) { c[r.state]++; if (r.include && r.item && r.blob) c.go++; }); return c; }
    var ORD = { none: 0, check: 1, bad: 2, matched: 3, done: 4, fail: 0 };
    var LBL = { matched: ['Matched', '#0f7b4a'], check: ['Check', '#e08a00'], none: ['No match', '#c8102e'], bad: ['Not a picture', '#7a869b'], done: ['Saved', '#0f7b4a'], fail: ['Failed', '#c8102e'] };

    function draw() {
      var c = counts();
      if (!rows.length) { $('#bres', host).innerHTML = ''; return; }
      var order = rows.slice().sort(function (a, b) { return (ORD[a.state] - ORD[b.state]) || ((a.rank || 0) - (b.rank || 0)) || (a.name < b.name ? -1 : 1); });
      $('#bres', host).innerHTML =
        '<div class="bar2" style="margin-top:14px"><span><b>' + rows.length + '</b> pictures: <span style="color:#0f7b4a">' + c.matched + ' matched</span> · <span style="color:#e08a00">' + c.check + ' to check</span> · <span style="color:#c8102e">' + c.none + ' no match</span></span>' +
        '<button type="button" class="b2 inl" id="bgo"' + (c.go ? '' : ' disabled') + '>Upload ' + c.go + ' picture' + (c.go === 1 ? '' : 's') + '</button></div>' +
        '<div class="tw card2 flush" style="margin-top:10px"><table class="t"><thead><tr><th></th><th>Picture</th><th>Item (type a code or name to change)</th><th>Result</th></tr></thead><tbody>' +
        order.map(function (r) {
          var i = rows.indexOf(r), l = LBL[r.state];
          return '<tr><td><input type="checkbox" data-i="' + i + '"' + (r.include ? ' checked' : '') + (r.item && r.blob && !(r.had && !E.isAdmin()) ? '' : ' disabled') + '></td>' +
            '<td><div class="bpic">' + (r.url ? '<img src="' + r.url + '" alt="">' : '') + '<span class="mu">' + (r.rank ? '<b>#' + r.rank + '</b> ' : '') + esc(r.name) + '</span></div></td>' +
            '<td>' + (r.blob ? '<input class="inp sm bi" list="bdl" data-i="' + i + '" value="' + esc(r.item ? r.item.code + ' · ' + r.item.name : '') + '" placeholder="Pick an item">' : '<span class="mu">' + esc(r.err || '') + '</span>') + '</td>' +
            '<td><span class="pill" style="--c:' + l[1] + '">' + l[0] + '</span>' + (r.how === 'haspic' ? '<br><span class="mu">already has a photo' + (E.isAdmin() ? ' (tick to replace)' : ' (only admin can replace)') + '</span>' : r.how === 'duplicate' ? '<br><span class="mu">same item as another file</span>' : r.how === 'guess' ? '<br><span class="mu">best guess</span>' : r.err && r.state === 'fail' ? '<br><span class="mu">' + esc(r.err) + '</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      $$('input[type=checkbox]', host).forEach(function (cb) { cb.onchange = function () { rows[+cb.getAttribute('data-i')].include = cb.checked; refreshBtn(); }; });
      $$('.bi', host).forEach(function (inp) {
        inp.onchange = function () {
          var r = rows[+inp.getAttribute('data-i')], v = inp.value.trim().toLowerCase(), it = label[v] || codeMap[v] || null;
          r.item = it; r.how = ''; r.had = !!(it && it.image_url); r.state = it ? (r.had ? 'check' : 'matched') : 'none'; if (r.had) r.how = 'haspic'; r.include = !!it && !r.had; draw();
        };
      });
      var go = $('#bgo', host); if (go) go.onclick = upload;
    }
    function refreshBtn() { var c = counts(), go = $('#bgo', host); if (go) { go.disabled = !c.go; go.textContent = 'Upload ' + c.go + ' picture' + (c.go === 1 ? '' : 's'); } }

    async function upload() {
      if (busy) return; busy = true;
      var todo = rows.filter(function (r) { return r.include && r.item && r.blob; }), n = 0, ok = 0, bad = 0, i = 0;
      $('#bgo', host).disabled = true;
      async function worker() {
        while (i < todo.length) {
          var r = todo[i++];
          try { r.item.image_url = await E.D.setPhoto(r.item, r.blob); PH.refresh(r.item.id); r.state = 'done'; r.include = false; ok++; ST.ok++; }
          catch (x) { r.state = 'fail'; r.err = errMsg(x); bad++; failed(r.item.code, x); }
          status('Uploading ' + (++n) + ' of ' + todo.length + '…');
        }
      }
      await Promise.all([worker(), worker(), worker()]);
      status('Done. ' + ok + ' saved' + (bad ? ', ' + bad + ' failed (see list)' : '') + '.');
      E.ctx.say(ok + ' photos saved');
      busy = false; draw();
    }
  };
})();
