/* Stockly: one page, hash routing (same technique as Order to Dispatch).
   #/login  sign in
   #/dashboard  #/stock  #/receive  #/issue  #/transfer  #/count  #/reorder  #/settings  (after sign-in) */
(function () {
  'use strict';
  var CFG = window.CFG || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var root = $('#app'), toastEl = $('#toast'), tt;
  var S = { me: null, demo: false, sb: null, tick: 0 };
  var NAME = (CFG.appName || 'Stockly').trim() || 'Stockly';
  var INITIAL = NAME.charAt(0).toUpperCase();
  function brand(html) {
    return html.replace(/Stockly/g, NAME).replace(/STOCKLY/g, NAME.toUpperCase()).replace(/(class="(?:logo|lg2)"[^>]*>)S</g, '$1' + INITIAL + '<');
  }

  var MODS = [
    ['dashboard', 'Dashboard', 'M4 13h6V4H4zM14 20h6V11h-6zM14 8h6V4h-6zM4 20h6v-3H4z', 'Stock health across Okhla, Chattarpur and Gurgaon, items to reorder, and what moved today.'],
    ['stock', 'Stock', 'M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10', 'Every item and how much is in each warehouse, with a search and a health bar.'],
    ['receive', 'Receive', 'M12 4v12M7 11l5 5 5-5M4 20h16', 'Book goods in against a PO or invoice, with batch and expiry where needed.'],
    ['issue', 'Issue', 'M12 20V8M7 13l5-5 5 5M4 4h16', 'Take goods out for a dispatch. Linked to Order to Dispatch later.'],
    ['transfer', 'Transfer', 'M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4', 'Move stock between Okhla, Chattarpur and Gurgaon in one entry, so nothing goes missing.'],
    ['count', 'Count', 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3', 'Enter a physical count. The system posts the difference and keeps the history.'],
    ['reorder', 'Reorder', 'M4 4v6h6M20 20v-6h-6M5.5 15a7 7 0 0012 2M18.5 9a7 7 0 00-12-2', 'What to order this week, rounded to pack size, with one-click indents like IND-18.'],
    ['upload', 'Upload', 'M12 16V4M7 9l5-5 5 5M4 20h16', 'Update stock, sales speed and items from your Tally Excel files, with a preview before anything changes.'],
    ['settings', 'Settings', 'M4 7h9M17 7h3M4 17h3M11 17h9M13 5v4M7 15v4', 'Warehouses, items, suppliers, people and roles.']
  ];

  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function say(m) { toastEl.textContent = m; toastEl.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { toastEl.classList.remove('on'); }, 3200); }

  /* ---------------- login page ---------------- */
  var LOGIN = String.raw`<main class="lg" id="scene">
  <header class="nav rise" style="--i:0">
    <a class="brand" href="#top" data-say="You are on the login page."><span class="logo" aria-hidden="true">S</span><b>Stockly</b></a>
    <nav class="links" aria-label="Main">
      <a href="#features" data-say="Features: stock ledger, transfers, counts, reorder. Preview only.">Features <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
      <a href="#modules" data-say="Modules: Receive, Issue, Transfer, Count. Preview only.">Modules <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
      <a href="#integrations" data-say="Integrations: Staffly, Order to Dispatch, Atlas, Tally. Preview only.">Integrations <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
      <a href="#why" data-say="Why Stockly: one live view, built for DCC. Preview only.">Why Stockly</a>
      <a href="#help" data-say="Help: ask the admin. Preview only.">Help</a>
    </nav>
    <span class="grow"></span>
    <a class="lnk" href="#login" id="navLogin">Log in</a>
    <a class="cta" href="#access" data-say="Ask the admin to create your account.">Get access <span aria-hidden="true">→</span></a>
  </header>

  <section class="left">
    <div class="hero">
      <div class="rise" style="--i:1"><span class="chip c-done"><span class="pdot"></span> Live stock · 3 warehouses</span></div>
      <h1 class="h1 rise" style="--i:2">Stock that<br><i>counts itself.</i></h1>
      <p class="sub rise" style="--i:3">One live view of Okhla, Chattarpur and Gurgaon, built to work with every other DCC system.</p>
      <div class="tick rise" style="--i:4" aria-label="What Stockly does">
        <span class="td" aria-hidden="true"></span>
        <div class="tl">
          <span style="--k:0">Connected with Staffly, Order to Dispatch and Atlas.</span>
          <span style="--k:1">Dispatch an order. Stock updates itself.</span>
          <span style="--k:2">Running low? The reorder is already drafted.</span>
          <span style="--k:3">One login for every DCC app.</span>
          <span style="--k:4">Count once. Trust it everywhere.</span>
        </div>
      </div>

      <form id="loginForm" class="glass rise" style="--i:4" novalidate>
        <label class="f" for="email">Work email
          <input class="inp" id="email" type="email" autocomplete="username" required>
        </label>
        <label class="f" for="password">Password
          <span class="wrap">
            <input class="inp" id="password" type="password" autocomplete="current-password" required>
            <button class="eye" id="eye" type="button" aria-controls="password" aria-pressed="false">Show</button>
          </span>
        </label>
        <div class="err" id="err" role="alert"></div>
        <div class="meta">
          <label for="keep"><input id="keep" type="checkbox" checked> Keep me signed in</label>
          <a class="link" href="#forgot" id="forgot">Forgot password?</a>
        </div>
        <button class="btn beam" id="go" type="submit"><span class="sp" aria-hidden="true"></span><span id="lab">Sign in</span><span class="ar" aria-hidden="true">→</span></button>
      </form>
      <p class="help rise" style="--i:5">Trouble signing in? Ask the admin to reset your password.</p>
    </div>

    <div class="stats rise" style="--i:6">
      <div><b>740+</b><span>items tracked</span></div>
      <div><b>3</b><span>warehouses</span></div>
      <div><b>1</b><span>login, all apps</span></div>
    </div>
    <div class="foot">© DCC Supply Chain &amp; Distribution LLP</div>
  </section>

  <div class="man">
    <img src="man.webp" alt="The company owner, standing and looking to the side" width="1048" height="914">
    <!-- Thought cloud. Text is live. The line needs the owner's OK before launch. -->
    <div class="thought">
      <div class="bub">
        <svg viewBox="0 0 340 260" aria-hidden="true">
          <defs>
            <linearGradient id="cfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.96"/><stop offset="1" stop-color="#eaf3ff" stop-opacity="0.92"/></linearGradient>
            <linearGradient id="cbeam" gradientUnits="userSpaceOnUse" x1="20" y1="0" x2="300" y2="0"><stop offset="0" stop-color="#c8102e"/><stop offset="0.5" stop-color="#f5c451"/><stop offset="1" stop-color="#0f7b4a"/></linearGradient>
          </defs>
          <path class="base" pathLength="100" d="M80 150 A38 38 0 0 1 60 85 A34 34 0 0 1 110 50 A42 42 0 0 1 180 38 A38 38 0 0 1 245 62 A40 40 0 0 1 282 118 A36 36 0 0 1 245 160 A90 90 0 0 1 170 168 A70 70 0 0 1 80 150 Z"/>
          <path class="glow" pathLength="100" d="M80 150 A38 38 0 0 1 60 85 A34 34 0 0 1 110 50 A42 42 0 0 1 180 38 A38 38 0 0 1 245 62 A40 40 0 0 1 282 118 A36 36 0 0 1 245 160 A90 90 0 0 1 170 168 A70 70 0 0 1 80 150 Z"/>
          <path class="run" pathLength="100" d="M80 150 A38 38 0 0 1 60 85 A34 34 0 0 1 110 50 A42 42 0 0 1 180 38 A38 38 0 0 1 245 62 A40 40 0 0 1 282 118 A36 36 0 0 1 245 160 A90 90 0 0 1 170 168 A70 70 0 0 1 80 150 Z"/>
          <circle class="tdot" cx="270" cy="190" r="11" style="animation-delay:1.7s"/>
          <circle class="tdot" cx="293" cy="214" r="7.5" style="animation-delay:1.85s"/>
          <circle class="tdot" cx="306" cy="234" r="4.5" style="animation-delay:2s"/>
        </svg>
        <div class="tx"><span>I get back<br><i>8 hours</i> of my day.</span></div>
      </div>
    </div>
    <aside class="fc glass rim apps" aria-label="Built on Supabase, GitHub, Vercel, Node.js and n8n">
      <div class="in stk" style="--d:1.3s">
        <span title="Supabase"><svg viewBox="0 0 109 113" aria-hidden="true"><path d="M63.7 110.3c-2.9 3.7-8.9 1.7-9-3l-1-68.9h46.8c8.5 0 13.2 9.8 7.9 16.4z" fill="#3ecf8e"/><path d="M45.3 2.1c2.9-3.7 8.9-1.7 9 3l.5 68.9H8.5c-8.5 0-13.2-9.8-7.9-16.4z" fill="#249361"/></svg></span>
        <span title="GitHub"><svg viewBox="0 0 16 16" aria-hidden="true"><path fill="#181717" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg></span>
        <span title="Vercel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 17.5H2z" fill="#000"/></svg></span>
        <span title="Node.js"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.8l8.8 5.1v10.2L12 22.2 3.2 17.1V6.9z" fill="#5fa04e"/><path d="M12 7.2v9.6M9 8.8l6 6.4" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg></span>
        <span title="n8n"><svg viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="15.5" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="10.5" fill="#ea4b71">n8n</text></svg></span>
        <span class="pl">+</span>
      </div>
    </aside>

    <aside class="fc glass rim ai" aria-hidden="true">
      <div class="in" style="--d:0.9s">
        <div class="tt"><span class="ic">✦</span> Reorder assistant</div>
        <p>Milky Mist Table Butter 500 gm will run out in 6 days at Chattarpur.</p>
        <div class="rec"><small>RECOMMENDED ORDER</small><b>120<span>units</span></b></div>
        <span class="ok on">✓ IND-18 created</span>
      </div>
    </aside>

    <aside class="fc glass rim act" aria-hidden="true">
      <div class="in" style="--d:1.1s">
        <div class="row" style="justify-content:space-between"><div class="tt">Okhla C-34</div><span class="chip c-act">Live</span></div>
        <div class="feed">
          <div class="r" style="--k:0"><span class="n go"></span><span class="t">Receiving 40 crates</span><small>now</small></div>
          <div class="r" style="--k:1"><span class="n">✓</span><span class="t">Transfer posted · Chattarpur to Okhla</span><small>2 min</small></div>
          <div class="r" style="--k:2"><span class="n">✓</span><span class="t">Stock count matched · Gurgaon</span><small>5 min</small></div>
        </div>
      </div>
    </aside>

    <aside class="fc glass rim ask" aria-hidden="true">
      <span class="lg2">S</span>
      <div><small>ASK STOCKLY</small><q>Which items will run short at Gurgaon this week?</q></div>
    </aside>
  </div>

</main>`;

  function renderLogin() {
    document.body.className = 'login';
    document.title = 'Sign in · ' + NAME;
    root.innerHTML = brand(LOGIN);
    var $$ = function (id) { return document.getElementById(id); };
    var form = $$('loginForm'), email = $$('email'), pw = $$('password'), err = $$('err');
    var go = $$('go'), lab = $$('lab'), eye = $$('eye');

    eye.addEventListener('click', function () {
      var show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      eye.textContent = show ? 'Hide' : 'Show';
      eye.setAttribute('aria-pressed', String(show));
    });
    $$('forgot').addEventListener('click', function (e) { e.preventDefault(); say('Ask the admin to reset your password.'); });
    root.querySelectorAll('[data-say]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); say(a.getAttribute('data-say')); });
    });
    $$('navLogin').addEventListener('click', function (e) { e.preventDefault(); email.focus(); });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var bad = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
      email.setAttribute('aria-invalid', bad ? 'true' : 'false');
      pw.setAttribute('aria-invalid', pw.value.length < 6 ? 'true' : 'false');
      if (bad) { err.textContent = 'Enter your work email, like name@company.com.'; email.focus(); return; }
      if (pw.value.length < 6) { err.textContent = 'Password must be at least 6 characters.'; pw.focus(); return; }
      err.textContent = '';
      go.disabled = true; lab.textContent = 'Signing in';
      try {
        if (S.sb) {
          var r = await S.sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value });
          if (r.error) throw r.error;
          await loadMe();                      /* shows its own message if not linked */
          if (S.me) location.hash = '#/dashboard';
        } else {
          S.demo = true; S.me = null;
          location.hash = '#/dashboard';       /* preview mode */
        }
      } catch (ex) {
        err.textContent = /invalid/i.test(ex.message || '') ? 'Email or password is wrong.' : (ex.message || 'Could not sign in.');
      }
      go.disabled = false; lab.textContent = 'Sign in';
    });

    /* depth: the man and the cards move a little against the pointer */
    var scene = $$('scene');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) {
      window.onpointermove = function (e) {
        scene.style.setProperty('--px', (e.clientX / window.innerWidth - 0.5).toFixed(3));
        scene.style.setProperty('--py', (e.clientY / window.innerHeight - 0.5).toFixed(3));
      };
    }
  }

  /* ---------------- app shell + pages ---------------- */
  function collapsed() { try { return !!localStorage.getItem('gg_mini'); } catch (e) { return false; } }
  /* live numbers on the menu, fed by pages.js whenever stock data loads */
  window.GG_BADGES = function (n) {
    var s = document.getElementById('nb-stock'), r = document.getElementById('nb-reorder');
    if (s) { s.textContent = n.items; s.hidden = false; }
    if (r) { r.textContent = n.reorder; r.hidden = !n.reorder; }
  };
  function renderShell(page) {
    window.onpointermove = null;
    document.body.className = 'appmode';
    var m = MODS.filter(function (x) { return x[0] === page; })[0] || MODS[0];
    document.title = m[1] + ' · ' + NAME;
    var GR = { dashboard: 'Overview', stock: 'Stock', receive: 'Movements', upload: 'Admin' };
    var nav = MODS.map(function (x) {
      return (GR[x[0]] ? '<span class="grp">' + GR[x[0]] + '</span>' : '') +
        '<a class="nv ' + (x[0] === m[0] ? 'on' : '') + '" href="#/' + x[0] + '" title="' + esc(x[1]) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + x[2] + '"></path></svg><span class="nt">' + x[1] + '</span>' +
        (x[0] === 'stock' || x[0] === 'reorder' ? '<span class="bd' + (x[0] === 'reorder' ? ' r' : '') + '" id="nb-' + x[0] + '" hidden></span>' : '') + '</a>';
    }).join('');
    var who = S.me ? esc(S.me.full_name || S.me.email) : 'Preview mode';
    var role = S.me ? esc(S.me.role) : 'not signed in';
    var shell = $('.app', root) && $('#view');
    if (shell) {
      Array.prototype.forEach.call(root.querySelectorAll('a.nv'), function (el) { el.classList.toggle('on', el.getAttribute('href') === '#/' + m[0]); });
    } else {
      root.innerHTML =
        '<div class="app' + (collapsed() ? ' mini' : '') + '"><aside class="side">' +
          '<div class="brandrow"><a class="brand" href="#/dashboard"><span class="logo" aria-hidden="true">' + esc(INITIAL) + '</span><span class="bn">' + esc(NAME) + '</span></a><button id="colp" class="colp" type="button" aria-label="Collapse menu" title="Collapse menu">&laquo;</button></div>' +
          '<nav aria-label="Pages">' + nav + '</nav>' +
          '<div class="me"><span class="av" aria-hidden="true">' + esc((who.charAt(0) || 'G').toUpperCase()) + '</span><span class="mt"><b>' + who + '</b><br>' + role + '</span><button id="out" type="button">Sign out</button></div>' +
        '</aside><main class="main" id="view"></main></div>';
      $('#out').onclick = signOut;
      $('#colp').onclick = function () { var ap = $('.app', root); ap.classList.toggle('mini'); try { localStorage.setItem('gg_mini', ap.classList.contains('mini') ? '1' : ''); } catch (e) {} };
    }
    window.scrollTo(0, 0);
    var v = $('#view');
    var banner = S.demo ? '<div class="banner">Preview mode. You are not signed in, so you are seeing sample data and nothing here is saved. Add the Supabase key in config.js to switch on real sign-in.</div>' : '';
    var pg = window.PAGES && window.PAGES[m[0]];
    if (!pg) { v.innerHTML = banner + '<h1 class="page-h">' + m[1] + '</h1><p class="page-s">' + esc(m[3]) + '</p>'; return; }
    v.innerHTML = banner + '<div id="pg"></div>';
    var mine = ++S.tick;
    pg($('#pg'), { sb: S.sb, demo: S.demo, me: S.me, say: say, esc: esc }).catch(function (e) { if (mine === S.tick) $('#pg').innerHTML = '<div class="card2"><h3>Something went wrong</h3><p>' + esc(e && e.message || e) + '</p></div>'; });
  }

  async function signOut() {
    if (S.sb) { try { await S.sb.auth.signOut(); } catch (e) {} }
    S.me = null; S.demo = false;
    if (window.PAGES && window.PAGES.__reset) window.PAGES.__reset();
    location.hash = '#/login';
  }

  /* ---------------- who is signed in ---------------- */
  async function loadMe() {
    S.me = null;
    if (!S.sb) return;
    var ses = await S.sb.auth.getSession();
    var user = ses.data && ses.data.session && ses.data.session.user;
    if (!user) return;
    var p = await S.sb.from('profiles').select('full_name, role, company_id, active').eq('user_id', user.id).maybeSingle();
    if (!p.data || !p.data.active) {
      await S.sb.auth.signOut();
      var e = document.getElementById('err');
      if (e) e.textContent = 'Your login is not linked to a company yet. Ask the admin.';
      return;
    }
    S.me = { id: user.id, email: user.email, full_name: p.data.full_name, role: p.data.role, company_id: p.data.company_id };
  }

  /* ---------------- router ---------------- */
  function route() {
    var h = (location.hash || '').replace(/^#\//, '').split('?')[0].split('/');
    var page = h[0] || '';
    var inside = !!(S.me || S.demo);
    if (!inside) { if (page !== 'login') { location.hash = '#/login'; return; } renderLogin(); return; }
    if (page === 'login' || page === '') { location.hash = '#/dashboard'; return; }
    renderShell(page);
  }

  window.addEventListener('hashchange', route);

  (async function start() {
    var keyOk = /^(sb_publishable_|eyJ)/.test(String(CFG.supabaseKey || ''));
    if (CFG.supabaseUrl && keyOk && window.supabase) {
      S.sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
      S.sb.auth.onAuthStateChange(function (ev) {
        if (ev === 'SIGNED_OUT' && S.me) {
          S.me = null; S.demo = false;
          if (window.PAGES && window.PAGES.__reset) window.PAGES.__reset();
          location.hash = '#/login'; route();
          setTimeout(function () { var e = document.getElementById('err'); if (e) e.textContent = 'Your session ended. Please sign in again.'; }, 50);
        }
      });
      await loadMe();
    }
    if (!location.hash) location.hash = S.me ? '#/dashboard' : '#/login'; else route();
  })();
})();
