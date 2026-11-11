/* GoodsGuru: photoreal material effects for the item panel.
   Fire and frost are drawn by a WebGL shader (noise based, so nothing is licensed or downloaded).
   Flour dust, fruit splash and falling leaves are a 2D particle engine with soft depth of field.
   FX.play(el, theme) starts one effect inside el. Returns false when it cannot (the CSS fallback stays). */
(function () {
  'use strict';
  var FX = window.FX = {};
  var cur = null;

  function stop() {
    if (!cur) return;
    cancelAnimationFrame(cur.raf);
    if (cur.cv && cur.cv.parentNode) cur.cv.parentNode.removeChild(cur.cv);
    if (cur.el) cur.el.classList.remove('has-c');
    cur = null;
  }
  FX.stop = stop;

  /* ---------------- WebGL: shared pieces ---------------- */
  var HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\nuniform vec2 R; uniform float T; uniform float S;\n' +
    'float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }\n' +
    'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y); }\n' +
    'float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return s; }\n' +
    'float ridge(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * (1. - abs(2. * noise(p) - 1.)); p = p * 2.1 + vec2(3.1, 7.7); a *= .5; } return s; }\n';

  /* FIRE: charred frame with real-looking flame tongues licking up the bottom and the sides */
  var FIRE = HEAD + 'void main(){\n' +
    ' vec2 p = gl_FragCoord.xy / S; vec2 sz = R / S; float W = sz.x, H = sz.y;\n' +
    ' float dl = p.x, dr = W - p.x, db = p.y, dt = H - p.y;\n' +
    ' float dmin = min(min(dl, dr), min(db, dt));\n' +
    ' float char_ = 1. - smoothstep(0., 20. + 6. * noise(p * .05), dmin);\n' +
    /* bottom flames */
    ' float warp = fbm(vec2(p.x * .010, p.y * .008 - T * .9));\n' +
    ' float q = fbm(vec2(p.x * .016 + warp * 1.6, p.y * .013 - T * 1.7));\n' +
    ' float hgt = 70. + 105. * noise(vec2(p.x * .012 + 3., T * .45)) + 40. * sin(T * 2.3 + p.x * .05);\n' +
    ' float m = clamp(1. - db / hgt, 0., 1.);\n' +
    ' float fb = clamp(q * 2.1 * m * m - .06, 0., 1.);\n' +
    /* flames up the sides (shorter, rising) */
    ' float d = min(dl, dr);\n' +
    ' float qs = fbm(vec2(d * .035 + warp, p.y * .012 - T * 1.35));\n' +
    ' float sh = 26. + 22. * noise(vec2(p.y * .02, T * .6));\n' +
    ' float ms = clamp(1. - d / sh, 0., 1.) * smoothstep(H * .78, 0., p.y);\n' +
    ' float fs = clamp(qs * 2.0 * ms - .05, 0., 1.);\n' +
    /* embers along the top edge */
    ' float qt = fbm(vec2(p.x * .03, dt * .05 + T * .8));\n' +
    ' float ft = clamp(qt * 1.6 * clamp(1. - dt / 16., 0., 1.) - .2, 0., 1.);\n' +
    ' float f = max(max(fb, fs), ft);\n' +
    ' vec3 col = mix(vec3(.45, .02, 0.), vec3(1., .22, 0.), smoothstep(0., .3, f));\n' +
    ' col = mix(col, vec3(1., .62, .04), smoothstep(.28, .6, f));\n' +
    ' col = mix(col, vec3(1., .93, .55), smoothstep(.6, .95, f));\n' +
    ' float a = smoothstep(.04, .26, f);\n' +
    ' float glow = (1. - smoothstep(0., 90., db)) * .22 + (1. - smoothstep(0., 40., d)) * .12;\n' +
    ' vec3 base = vec3(.05, .018, 0.) * char_;\n' +
    ' float ba = char_ * .92;\n' +
    ' vec3 outc = col * a + base * (1. - a) * ba + vec3(1., .3, 0.) * glow * (1. - a) * (1. - ba);\n' +
    ' float outa = clamp(a + ba * (1. - a) + glow * (1. - a) * (1. - ba), 0., 1.);\n' +
    ' gl_FragColor = vec4(outc, outa);\n}';

  /* FROST: ice crystals growing in from every edge, glassy rim, slow sparkle */
  var FROST = HEAD +
    'float feather(float u, float d, float seed){\n' +
    ' float L = 38. + 70. * noise(vec2(u * .012 + seed, 4.)) ;\n' +
    ' float r = ridge(vec2(u * .075 + seed, d * .05 + noise(vec2(u * .02, d * .02)) * 2.));\n' +
    ' float r2 = ridge(vec2(u * .19 + seed * 2., d * .13 + 3.));\n' +
    ' float m = clamp(1. - d / L, 0., 1.);\n' +
    ' return clamp(smoothstep(.28, .95, (r * .7 + r2 * .55) * m * 1.5 - .12), 0., 1.) * .92;\n}\n' +
    'void main(){\n' +
    ' vec2 p = gl_FragCoord.xy / S; vec2 sz = R / S; float W = sz.x, H = sz.y;\n' +
    ' float f = 0.;\n' +
    ' f = max(f, feather(p.y, p.x, 1.));\n' +
    ' f = max(f, feather(p.y, W - p.x, 5.));\n' +
    ' f = max(f, feather(p.x, p.y, 9.) * 1.1);\n' +
    ' f = max(f, feather(p.x, H - p.y, 13.));\n' +
    ' float dmin = min(min(p.x, W - p.x), min(p.y, H - p.y));\n' +
    ' float rim = 1. - smoothstep(0., 9., dmin);\n' +
    ' float fog = (1. - smoothstep(0., 120., dmin)) * (.20 + .12 * fbm(p * .01 + T * .02));\n' +
    ' vec3 ice = mix(vec3(.62, .82, 1.), vec3(1.), smoothstep(.2, .85, f));\n' +
    ' float sp = step(.9965, hash(floor(p / 2.5))) * (.45 + .55 * sin(T * 2.2 + hash(floor(p / 2.5)) * 40.)) * smoothstep(.1, .5, f + rim);\n' +
    ' float a = clamp(f * 1.35 + rim * .9 + fog, 0., 1.);\n' +
    ' vec3 c = mix(vec3(.74, .88, 1.), ice, clamp(f * 1.5, 0., 1.)) + sp;\n' +
    ' gl_FragColor = vec4(c * a, a);\n}';

  var VERT = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }';

  function sh(gl, type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { if (window.console) console.warn('FX shader', gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  function gpu(cv, frag) {
    var gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false }) || cv.getContext('experimental-webgl', { premultipliedAlpha: true, alpha: true });
    if (!gl) return null;
    var v = sh(gl, gl.VERTEX_SHADER, VERT), f = sh(gl, gl.FRAGMENT_SHADER, frag); if (!v || !f) return null;
    var pr = gl.createProgram(); gl.attachShader(pr, v); gl.attachShader(pr, f); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
    gl.useProgram(pr);
    var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return { gl: gl, uR: gl.getUniformLocation(pr, 'R'), uT: gl.getUniformLocation(pr, 'T'), uS: gl.getUniformLocation(pr, 'S') };
  }

  /* ---------------- 2D particle engine ---------------- */
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function blurred(draw, w, h, blur) {
    var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d');
    var pad = blur ? Math.ceil(blur * 2) : 0;
    if (blur && 'filter' in x) { x.filter = 'blur(' + blur + 'px)'; }
    draw(x, w, h); return c;
  }

  /* leaves */
  function leafSprite(x, w, h, hue) {
    x.save(); x.translate(w / 2, h / 2);
    var L = h * .42, Wd = w * .30;
    var g = x.createLinearGradient(-Wd, 0, Wd, 0);
    g.addColorStop(0, 'hsl(' + hue + ',55%,24%)'); g.addColorStop(.5, 'hsl(' + hue + ',55%,38%)'); g.addColorStop(1, 'hsl(' + (hue - 8) + ',60%,30%)');
    x.fillStyle = g;
    x.beginPath(); x.moveTo(0, -L);
    x.bezierCurveTo(Wd * 1.5, -L * .5, Wd * 1.25, L * .5, 0, L);
    x.bezierCurveTo(-Wd * 1.25, L * .5, -Wd * 1.5, -L * .5, 0, -L); x.fill();
    x.strokeStyle = 'rgba(210,240,170,.55)'; x.lineWidth = Math.max(1, w * .035);
    x.beginPath(); x.moveTo(0, -L * .92); x.lineTo(0, L * 1.05); x.stroke();
    x.lineWidth = Math.max(.6, w * .018); x.strokeStyle = 'rgba(200,235,160,.32)';
    for (var k = -3; k <= 3; k++) {
      if (!k) continue; var yy = k * L * .24, s = k > 0 ? 1 : -1;
      x.beginPath(); x.moveTo(0, yy); x.lineTo(-Wd * .9, yy - L * .18); x.moveTo(0, yy); x.lineTo(Wd * .9, yy - L * .18); x.stroke();
    }
    x.restore();
  }

  function setup2d(el, kind) {
    var cv = document.createElement('canvas'); el.insertBefore(cv, el.firstChild); cv.className = 'fxc';
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var W = el.clientWidth || 440, H = el.clientHeight || 800;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    return { cv: cv, ctx: ctx, W: W, H: H };
  }

  function engine(kind, o) {
    var ctx = o.ctx, W = o.W, H = o.H, P = [], t0 = performance.now(), last = t0;
    var sprites = [];
    if (kind === 'leaf') {
      [[22, 0, 110], [22, 1, 100], [34, 0, 118], [34, 1.6, 96], [52, 3, 108]].forEach(function (c) {
        sprites.push({ size: c[0], img: blurred(function (x, w, h) { leafSprite(x, w, h, c[2]); }, c[0] * 2, c[0] * 2, c[1]) });
      });
      for (var i = 0; i < 16; i++) P.push(mkLeaf(true));
    }
    function mkLeaf(init) {
      var s = sprites[Math.floor(Math.random() * sprites.length)];
      var d = s.size / 52;
      return { s: s, x: rnd(-20, W + 20), y: init ? rnd(-H * .2, H) : rnd(-80, -20), vy: 28 + d * 46 + rnd(0, 22), sw: rnd(.6, 1.4), ph: rnd(0, 6.28), rot: rnd(0, 6.28), vr: rnd(-1.2, 1.2), flip: rnd(0, 6.28), vf: rnd(1, 2.6), amp: rnd(20, 55), sc: .7 + d * .6, a: .5 + d * .32 };
    }
    var drops = [], nextSplash = 0, dust = [];
    var col = o.color || [255, 150, 30];
    function burst(x0, dir, big) {
      var n = big ? 46 : 26;
      for (var i = 0; i < n; i++) {
        var th = rnd(.12, 1.0), sp = rnd(220, 560) * (big ? 1 : .7);
        drops.push({ x: x0, y: H - 14, vx: Math.sin(th) * sp * dir, vy: -Math.cos(th) * sp, r: rnd(1.4, big ? 6.5 : 4.2), life: 0, max: rnd(1.1, 1.9) });
      }
    }
    if (kind === 'flour') {
      for (var j = 0; j < 220; j++) dust.push(mkDust(true));
    }
    function mkDust(init) {
      var onStream = Math.random() < .7;
      var depth = Math.random();
      return { st: onStream, x: onStream ? W * .86 : rnd(0, W), y: init ? rnd(0, H) : rnd(-30, 0), vy: rnd(70, 190) * (.5 + depth), ph: rnd(0, 6.28), r: .6 + depth * (onStream ? 2.4 : 3.2), a: rnd(.25, .8) * (.5 + depth * .5), dep: depth, off: rnd(-1, 1) };
    }
    function frame(now, dt) {
      var t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      if (kind === 'leaf') {
        /* god rays from the top right + green vignette on the borders */
        ctx.save(); ctx.globalCompositeOperation = 'source-over';
        var g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, 'rgba(16,70,34,.0)');
        [[.74, .13], [.5, .09], [.9, .1]].forEach(function (r, k) {
          var a = r[1] * (.7 + .3 * Math.sin(t * .6 + k * 2));
          var gg = ctx.createLinearGradient(W * r[0], 0, W * (r[0] - .3), H * .8);
          gg.addColorStop(0, 'rgba(255,248,170,' + a + ')'); gg.addColorStop(1, 'rgba(255,248,170,0)');
          ctx.fillStyle = gg; ctx.beginPath(); ctx.moveTo(W * r[0] - 26, 0); ctx.lineTo(W * r[0] + 34, 0); ctx.lineTo(W * (r[0] - .42) + 70, H * .85); ctx.lineTo(W * (r[0] - .42) - 80, H * .85); ctx.fill();
        });
        var v = ctx.createLinearGradient(0, 0, 0, H); v.addColorStop(0, 'rgba(20,92,44,.55)'); v.addColorStop(.18, 'rgba(20,92,44,.0)'); v.addColorStop(.86, 'rgba(20,92,44,0)'); v.addColorStop(1, 'rgba(14,70,34,.5)');
        ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
        var e1 = ctx.createLinearGradient(0, 0, 46, 0); e1.addColorStop(0, 'rgba(18,84,40,.55)'); e1.addColorStop(1, 'rgba(18,84,40,0)'); ctx.fillStyle = e1; ctx.fillRect(0, 0, 46, H);
        var e2 = ctx.createLinearGradient(W, 0, W - 46, 0); e2.addColorStop(0, 'rgba(18,84,40,.55)'); e2.addColorStop(1, 'rgba(18,84,40,0)'); ctx.fillStyle = e2; ctx.fillRect(W - 46, 0, 46, H);
        ctx.restore();
        P.forEach(function (l, i) {
          l.y += l.vy * dt; l.rot += l.vr * dt; l.flip += l.vf * dt;
          var x = l.x + Math.sin(t * l.sw + l.ph) * l.amp;
          if (l.y > H + 60) P[i] = mkLeaf(false);
          ctx.save(); ctx.globalAlpha = l.a; ctx.translate(x, l.y); ctx.rotate(l.rot + Math.sin(t * l.sw + l.ph) * .5);
          ctx.scale(Math.max(.18, Math.abs(Math.cos(l.flip))) * l.sc, l.sc);
          ctx.drawImage(l.s.img, -l.s.size, -l.s.size); ctx.restore();
        });
      } else if (kind === 'splash') {
        if (now > nextSplash) { var sd = Math.random() < .5 ? 1 : -1; burst(sd > 0 ? 26 : W - 26, sd > 0 ? 1 : -1, Math.random() < .5); nextSplash = now + rnd(700, 1300); }
        /* wet sheen along both borders */
        [0, 1].forEach(function (s) {
          var x0 = s ? W : 0, gx = ctx.createLinearGradient(x0, 0, x0 + (s ? -34 : 34), 0);
          gx.addColorStop(0, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',.38)'); gx.addColorStop(1, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0)');
          ctx.fillStyle = gx; ctx.fillRect(s ? W - 34 : 0, 0, 34, H);
        });
        var gb = ctx.createLinearGradient(0, H, 0, H - 120); gb.addColorStop(0, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',.28)'); gb.addColorStop(1, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0)');
        ctx.fillStyle = gb; ctx.fillRect(0, H - 120, W, 120);
        for (var i = drops.length - 1; i >= 0; i--) {
          var d = drops[i]; d.life += dt; d.vy += 900 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vx *= (1 - .35 * dt);
          if (d.life > d.max || d.y > H + 10) { drops.splice(i, 1); continue; }
          var al = Math.min(1, (d.max - d.life) * 2), sp = Math.hypot(d.vx, d.vy), ang = Math.atan2(d.vy, d.vx);
          ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(ang); ctx.globalAlpha = al;
          var len = d.r * (1 + Math.min(sp / 260, 2.4));
          var rg = ctx.createRadialGradient(-len * .15, -d.r * .25, 0, 0, 0, Math.max(len, d.r));
          rg.addColorStop(0, 'rgba(255,255,255,.95)'); rg.addColorStop(.22, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',.55)'); rg.addColorStop(.85, 'rgba(' + Math.round(col[0] * .62) + ',' + Math.round(col[1] * .62) + ',' + Math.round(col[2] * .62) + ',.85)'); rg.addColorStop(1, 'rgba(255,255,255,.55)');
          ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(0, 0, len, d.r, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.ellipse(-len * .25, -d.r * .35, Math.max(.6, len * .2), Math.max(.5, d.r * .22), 0, 0, 6.283); ctx.fill();
          ctx.restore();
        }
      } else if (kind === 'flour') {
        /* mound of flour along the bottom + soft dust clouds */
        var gm = ctx.createLinearGradient(0, H, 0, H - 150); gm.addColorStop(0, 'rgba(226,186,120,.75)'); gm.addColorStop(.5, 'rgba(236,206,150,.25)'); gm.addColorStop(1, 'rgba(240,215,165,0)');
        ctx.fillStyle = gm; ctx.fillRect(0, H - 150, W, 150);
        ctx.fillStyle = 'rgba(214,172,104,.5)'; ctx.beginPath(); ctx.moveTo(0, H);
        for (var xx = 0; xx <= W; xx += 12) ctx.lineTo(xx, H - 26 - 14 * Math.sin(xx * .03 + t * .2) - 18 * Math.exp(-Math.pow((xx - W * .86) / 70, 2)));
        ctx.lineTo(W, H); ctx.fill();
        [0, 1].forEach(function (s) { var gx = ctx.createLinearGradient(s ? W : 0, 0, s ? W - 28 : 28, 0); gx.addColorStop(0, 'rgba(222,184,120,.45)'); gx.addColorStop(1, 'rgba(222,184,120,0)'); ctx.fillStyle = gx; ctx.fillRect(s ? W - 28 : 0, 0, 28, H); });
        dust.forEach(function (p, i) {
          p.y += p.vy * dt; var wob = Math.sin(t * 1.6 + p.ph + p.y * .012) * (p.st ? 16 : 34) + (p.st ? p.off * 10 : 0);
          var x = (p.st ? W * .86 + Math.sin(p.y * .018 + t * 1.2) * 12 : p.x) + wob;
          if (p.y > H) dust[i] = mkDust(false);
          var a = p.a * (p.y < 40 ? p.y / 40 : 1);
          var rr = p.r * (p.dep < .25 ? 3 : 1);
          var rg = ctx.createRadialGradient(x, p.y, 0, x, p.y, rr * 2.2);
          rg.addColorStop(0, 'rgba(244,214,156,' + a + ')'); rg.addColorStop(1, 'rgba(230,190,120,0)');
          ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, p.y, rr * 2.2, 0, 6.283); ctx.fill();
        });
        /* puff at the foot of the stream */
        var pf = ctx.createRadialGradient(W * .86, H - 22, 0, W * .86, H - 22, 90 + 14 * Math.sin(t * 1.4));
        pf.addColorStop(0, 'rgba(240,210,150,.55)'); pf.addColorStop(1, 'rgba(240,210,150,0)'); ctx.fillStyle = pf; ctx.fillRect(W * .86 - 100, H - 120, 200, 120);
      }
    }
    return frame;
  }

  var FRUIT = [
    [/blueberr|grape|jamun|berry mix|mixed berr|plum/, [96, 58, 210]],
    [/strawberr|cherry|cranberr|pomegranate|watermelon|red|tomato|apple/, [226, 32, 58]],
    [/lemon|lime|guava|green apple|kiwi|mint/, [150, 205, 40]],
    [/mango|orange|pineapple|papaya|litchi|lychee|peach|apricot|passion/, [255, 150, 24]],
    [/coconut|water|milk/, [140, 210, 235]]
  ];
  function fruitColor(name) {
    var n = String(name || '').toLowerCase();
    for (var i = 0; i < FRUIT.length; i++) if (FRUIT[i][0].test(n)) return FRUIT[i][1];
    return [255, 150, 24];
  }

  /* ---------------- public ---------------- */
  FX.play = function (el, theme, name) {
    stop();
    if (!el) return false;
    var panel = el.closest('.ip-wrap');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return false;
    var ok = false;
    if (theme === 'fire' || theme === 'frost') {
      var cv = document.createElement('canvas'); cv.className = 'fxc';
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      var W = el.clientWidth || 440, H = el.clientHeight || 800;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      var g = gpu(cv, theme === 'fire' ? FIRE : FROST);
      if (!g) return false;
      el.insertBefore(cv, el.firstChild); el.classList.add('has-c');
      g.gl.viewport(0, 0, cv.width, cv.height);
      cur = { el: el, cv: cv };
      var t0 = performance.now(), lastDraw = 0;
      (function loop(now) {
        if (!cur || cur.cv !== cv) return;
        if (panel && panel.hidden) { stop(); return; }
        cur.raf = requestAnimationFrame(loop);
        if (now - lastDraw < 28) return; lastDraw = now;
        g.gl.clearColor(0, 0, 0, 0); g.gl.clear(g.gl.COLOR_BUFFER_BIT);
        g.gl.uniform2f(g.uR, cv.width, cv.height); g.gl.uniform1f(g.uS, dpr);
        g.gl.uniform1f(g.uT, (now - t0) / 1000 + (theme === 'frost' ? 0 : 0));
        g.gl.drawArrays(g.gl.TRIANGLE_STRIP, 0, 4);
      })(performance.now());
      return true;
    }
    if (theme === 'leaf' || theme === 'splash' || theme === 'flour') {
      var o = setup2d(el, theme); el.classList.add('has-c');
      o.color = theme === 'splash' ? fruitColor(name) : null;
      var fr = engine(theme, o), prev = performance.now();
      cur = { el: el, cv: o.cv };
      (function loop(now) {
        if (!cur || cur.cv !== o.cv) return;
        if (panel && panel.hidden) { stop(); return; }
        cur.raf = requestAnimationFrame(loop);
        var dt = Math.min(.05, (now - prev) / 1000); prev = now;
        fr(now, dt);
      })(performance.now());
      return true;
    }
    return false;
  };
})();
