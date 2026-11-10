/*
 * IRILMODZ PBBLAZE CORE (remote) — dimuat oleh loader Tampermonkey
 * Update file ini di GitHub = semua user otomatis dapat versi baru.
 * Jalankan hanya jika loader sudah validasi license (window.__pbzLicensed).
 */
  function bootCore() {
    var DURATION_MS = 60 * 60 * 1000;
    var T0_KEY = 'pbz_t0';
    var CFG_KEY = 'pbz_cfg_v16';

    if (window.__pbzInstance) return;
    window.__pbzInstance = 1;
    window.__pbz = 1;
    window.__pb = 1;

    if (!/^\/jogo(\/|$)/.test(location.pathname)) return;

    function nowMs() { return Date.now(); }
    function nowSec() { return performance.now() / 1000; }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

    var t0 = 0;
    try { t0 = parseInt(lsGet(T0_KEY) || '0', 10) || 0; } catch (e) { t0 = 0; }
    if (!t0) { t0 = nowMs(); lsSet(T0_KEY, String(t0)); }

    /* ------------------------------------------------------------------ *
     *  gate hook
     * ------------------------------------------------------------------ */
    var GATE_SRC = '^(127\\.0\\.0\\.1|localhost|\\[::1\\])$';
    try {
      var _test = RegExp.prototype.test;
      RegExp.prototype.test = function (s) {
        try {
          if (this && this.source === GATE_SRC) return true;
        } catch (e) {}
        return _test.call(this, s);
      };
    } catch (e) {}

    /* ------------------------------------------------------------------ *
     *  config (Tanpa hide UI)
     * ------------------------------------------------------------------ */
    var DEF = {
      esp: true, box: true, name: true, hp: true, dist: true, vis: true, team: false,
      tracer: false,
      radar: true, bomb: true,
      aim: false, aimKey: false, fov: 110, smooth: 8, bone: 'head',
      povAim: false, povRadius: 120, povLockTime: 250,
      auto: false, trigger: false,
      morphShotgun: false, morphSniper: false, morphPistol: false, morphDmg: false,
      noRecoil: false, infAmmo: false,
      // Fly mod config
      fly: false, flySpeed: 6, flyMaxHeight: 100
    };
    var cfg = {};
    try {
      var raw = lsGet(CFG_KEY);
      var saved = raw ? JSON.parse(raw) : null;
      cfg = Object.assign({}, DEF, saved && typeof saved === 'object' ? saved : {});
    } catch (e) { cfg = Object.assign({}, DEF); }
    function saveCfg() { lsSet(CFG_KEY, JSON.stringify(cfg)); }

    /* ------------------------------------------------------------------ *
     *  helpers
     * ------------------------------------------------------------------ */
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    function el(tag, cls, parent) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (parent) parent.appendChild(n);
      return n;
    }
    function stop(e) { e.stopPropagation(); }

    var G = function () { return window.G || null; };
    var RND = function () { return window.RND || null; };
    var P = function () { var g = G(); return g ? g.P : null; };
    var BOTS = function () { var g = G(); return g && g.bots ? g.bots : []; };
    var CAM = function () { var g = G(); return g ? g.camera : null; };

    function eyePos(p) {
      var s = p && p.s;
      if (!s) return null;
      var g = G();
      var h = s.eyeH != null ? s.eyeH : (s.mover && s.mover.crouch ? (g.CFG.eyeCrouch || 1.1) : (g.CFG.eye || 1.6));
      return new THREE.Vector3(s.mover.pos.x, s.mover.pos.y + h, s.mover.pos.z);
    }
    function lookDir(yaw, pitch) {
      return new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    }
    function angLerp(a, b, t) {
      var d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      return a + d * t;
    }
    function alive(b) {
      return b && !b.dead && !b.serverHidden && (!b.remote || !b.obj || b.obj.visible !== false);
    }
    function weaponOf(p) {
      if (!p) return null;
      try { return p.W || null; } catch (e) { return null; }
    }
    function isEnemy(b, me) {
      if (!b || b === me) return false;
      if (b.team == null || me.team == null) return true;
      return b.team !== me.team;
    }
    function boneWorld(b, names) {
      if (!b || !b.c || !b.c.byName) return null;
      for (var i = 0; i < names.length; i++) {
        var bone = b.c.byName[names[i]];
        if (bone && bone.getWorldPosition) {
          var v = new THREE.Vector3();
          bone.getWorldPosition(v);
          return v;
        }
      }
      return null;
    }
    function headPos(b) {
      var v = boneWorld(b, ['Head', 'Bone_HeadGearAttach']);
      if (v) return v;
      if (!b || !b.mover) return null;
      return new THREE.Vector3(b.mover.pos.x, b.mover.pos.y + (b.mover.crouch ? 1.25 : 1.68), b.mover.pos.z);
    }
    function chestPos(b) {
      var v = boneWorld(b, ['Spine3', 'Spine2', 'Neck']);
      if (v) return v;
      var h = headPos(b);
      if (h) { h.y -= 0.35; return h; }
      return null;
    }
    function targetPos(b, mode) {
      return mode === 'chest' ? chestPos(b) : headPos(b);
    }
    function w2s(v) {
      var cam = CAM();
      if (!cam || !v) return null;
      try { cam.updateMatrixWorld(); } catch (e) {}
      var p = v.clone().project(cam);
      if (p.z < -1 || p.z > 1) return null;
      var x = (p.x * 0.5 + 0.5) * innerWidth;
      var y = (-p.y * 0.5 + 0.5) * innerHeight;
      if (!isFinite(x) || !isFinite(y)) return null;
      return { x: x, y: y };
    }
    function visCheck(b, eye, target) {
      if (!cfg.vis) return true;
      if (!eye || !target) return true;
      var t = performance.now();
      var c = b.__pbzVis;
      if (c && t - c.t < 120) return c.v;
      var d = target.clone().sub(eye);
      var dist = d.length();
      if (dist < 0.4) return true;
      d.normalize();
      var ok = true;
      try {
        var wall = G().cast(eye, d, dist);
        ok = !wall || wall.t >= dist - 0.25;
      } catch (e) {}
      b.__pbzVis = { t: t, v: ok };
      return ok;
    }

    /* ------------------------------------------------------------------ *
     *  styles — ImGui Sidebar Tabbar Interface + Fly Indicator
     * ------------------------------------------------------------------ */
    var CSS = [
      '#pbz-root{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font:11px/1.4 "Segoe UI",Tahoma,sans-serif;color:#e8e8e8;-webkit-user-select:none;user-select:none}',
      '#pbz-world{position:absolute;inset:0;overflow:hidden}',

      /* ESP box */
      '.pbz-box{position:absolute;left:0;top:0;box-sizing:border-box;border:1px solid #ff3b3b;transform-origin:0 0;will-change:transform,width,height}',
      '.pbz-box.pbz-dim{opacity:.35}',
      '.pbz-box.pbz-ally{border-color:#3b9bff}',
      '.pbz-name{position:absolute;left:50%;bottom:100%;transform:translate(-50%,-2px);white-space:nowrap;font:600 10px/1.2 "Segoe UI",Tahoma;color:#fff;background:rgba(0,0,0,.5);padding:0 4px;border-radius:2px}',
      '.pbz-hp{position:absolute;left:0;right:0;bottom:-4px;height:2px;background:rgba(0,0,0,.55);overflow:hidden}',
      '.pbz-hp i{display:block;height:100%;background:#4ade80}',
      '.pbz-dist{position:absolute;left:50%;top:100%;transform:translate(-50%,2px);font:600 9px/1 "Segoe UI",Tahoma;color:#fbbf24;white-space:nowrap}',

      /* POV circle */
      '#pbz-pov{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:50%;pointer-events:none;z-index:2147483000;display:none;box-sizing:border-box}',
      '#pbz-pov.on{display:block}',
      '#pbz-pov::before{content:"";position:absolute;inset:0;border-radius:50%;border:1px solid rgba(74,222,128,.5)}',
      '#pbz-pov.locked::before{border-color:rgba(255,59,59,.85)}',
      '#pbz-pov .pbz-pov-dot{position:absolute;left:50%;top:50%;width:3px;height:3px;margin:-1.5px;border-radius:50%;background:rgba(74,222,128,.85)}',
      '#pbz-pov.locked .pbz-pov-dot{background:rgba(255,59,59,.95)}',

      /* Tracer */
      '#pbz-tracer-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden}',
      '.pbz-tracer{position:absolute;left:0;top:0;height:1px;transform-origin:0 50%;pointer-events:none;will-change:transform,width;background:linear-gradient(90deg,rgba(255,59,59,0),rgba(255,59,59,.75))}',
      '.pbz-tracer.pbz-ally{background:linear-gradient(90deg,rgba(59,155,255,0),rgba(59,155,255,.75))}',
      '.pbz-tracer.pbz-dim{opacity:.3}',

      /* Radar */
      '#pbz-radar{position:fixed;right:12px;bottom:12px;width:130px;height:130px;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.12);border-radius:4px;pointer-events:none;display:none;overflow:hidden}',
      '#pbz-radar .pbz-rt{position:absolute;top:4px;left:6px;font:600 9px "Segoe UI",Tahoma;color:#888;letter-spacing:.5px}',
      '#pbz-radar .pbz-me{position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px;background:#fff;border-radius:50%}',
      '.pbz-dot{position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px;border-radius:50%;background:#ff3b3b}',
      '.pbz-dot.ally{background:#3b9bff}',
      '.pbz-dot.bomb{background:#fbbf24;width:5px;height:5px;margin:-2.5px;border-radius:1px}',

      /* Bomb timer */
      '#pbz-bomb{position:fixed;left:50%;top:8px;transform:translateX(-50%);font:600 12px "Segoe UI",Tahoma;color:#ff3b3b;background:rgba(0,0,0,.5);padding:2px 8px;border-radius:3px;display:none;pointer-events:none}',
      '#pbz-fly-ind{position:fixed;left:50%;top:70%;transform:translateX(-50%);z-index:2147483000;font:900 14px "Segoe UI",Tahoma;color:#70e6a2;text-shadow:0 2px 4px #000,0 0 8px #4ade80;pointer-events:none;display:none}',
      '#pbz-fly-ind.on{display:block}',

      /* Panel & Sidebar Layout (Tabs di Samping) */
      '#pbz-panel{position:fixed;right:8px;top:8px;width:min(320px,calc(100vw - 16px));max-height:calc(100dvh - 16px);background:#18181b;border:1px solid #27272a;border-radius:6px;color:#e8e8e8;font:11px/1.5 "Segoe UI",Tahoma;padding:8px;pointer-events:auto;display:block;z-index:2147483005;box-shadow:0 4px 24px rgba(0,0,0,.5)}',
      '#pbz-panel.pbz-minimized{width:auto;max-height:none;padding:5px 10px;overflow:hidden}',
      '#pbz-panel.pbz-minimized .pbz-body{display:none}',
      '#pbz-panel.pbz-minimized .pbz-head{margin-bottom:0;padding-bottom:0;border-bottom:none}',
      '#pbz-panel.pbz-minimized .pbz-collapse{display:none}',
      '#pbz-panel:not(.pbz-minimized) .pbz-expand{display:none}',

      '#pbz-panel .pbz-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #27272a}',
      '#pbz-panel .pbz-head b{font:700 11px "Segoe UI",Tahoma;color:#4ade80;letter-spacing:.3px}',
      '.pbz-head-actions{display:flex;gap:4px;align-items:center}',
      '.pbz-icon-btn{background:#27272a;border:1px solid #3f3f46;color:#e8e8e8;width:18px;height:18px;font-size:11px;font-weight:bold;border-radius:3px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}',
      '.pbz-icon-btn:hover{background:#3f3f46;color:#4ade80}',

      /* Layout Body: Flex kiri-kanan (Sidebar Tabs) */
      '#pbz-panel .pbz-body-container{display:flex;gap:8px;align-items:flex-start}',
      '#pbz-panel .pbz-tabs{display:flex;flex-direction:column;gap:3px;width:75px;flex-shrink:0;border-right:1px solid #292b31;padding-right:6px}',
      '#pbz-panel .pbz-tab{display:flex;align-items:center;justify-content:flex-start;gap:6px;padding:6px 8px;border:1px solid transparent;border-radius:4px;background:transparent;color:#92949d;font:600 10px "Segoe UI",Tahoma,sans-serif;cursor:pointer;white-space:nowrap;width:100%;text-align:left}',
      '#pbz-panel .pbz-tab i{font-size:10px;width:12px;text-align:center}',
      '#pbz-panel .pbz-tab:hover{background:#202228;color:#e8e8e8}',
      '#pbz-panel .pbz-tab.active{background:#183126;border-color:#28543e;color:#70e6a2}',

      /* Content Pane di sebelah kanan */
      '#pbz-panel .pbz-content-area{flex:1;min-width:0;max-height:min(50dvh,380px);overflow-y:auto;padding-left:2px;scrollbar-width:thin}',
      '#pbz-panel .pbz-tab-pane{display:none}',
      '#pbz-panel .pbz-tab-pane.active{display:block}',
      '#pbz-panel .pbz-tab-pane::-webkit-scrollbar{width:4px}',
      '#pbz-panel .pbz-tab-pane::-webkit-scrollbar-thumb{background:#3b3d44;border-radius:4px}',

      '.pbz-sec{font:700 9px "Segoe UI",Tahoma;letter-spacing:.8px;color:#71717a;margin:0 0 4px;text-transform:uppercase}',
      '#pbz-panel .pbz-footer{display:flex;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid #292b31}',
      '.pbz-row{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:3px 0;cursor:pointer}',
      '.pbz-row span{flex:1;font-size:11px}',
      '.pbz-row input[type=checkbox]{appearance:none;-webkit-appearance:none;width:28px;height:16px;border-radius:8px;background:#27272a;position:relative;outline:none;transition:.15s;flex:0 0 auto;margin:0;cursor:pointer}',
      '.pbz-row input[type=checkbox]:checked{background:#4ade80}',
      '.pbz-row input[type=checkbox]:before{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#a1a1aa;transition:.15s}',
      '.pbz-row input[type=checkbox]:checked:before{left:14px;background:#fff}',
      '.pbz-slider{display:flex;align-items:center;gap:6px;padding:3px 0}',
      '.pbz-slider span{flex:0 0 50px;font-size:11px}',
      '.pbz-slider input{flex:1;accent-color:#4ade80;margin:0;height:3px}',
      '.pbz-slider b{width:28px;text-align:right;color:#4ade80;font-weight:600;font-size:10px}',
      '.pbz-mini{background:#27272a;border:1px solid #3f3f46;color:#e8e8e8;border-radius:3px;padding:3px 8px;font:600 10px "Segoe UI",Tahoma;cursor:pointer;pointer-events:auto}',
      '.pbz-mini:hover{background:#3f3f46}',
      '#pbz-panel select{background:#27272a;border:1px solid #3f3f46;color:#e8e8e8;border-radius:3px;padding:2px 4px;font:600 10px "Segoe UI",Tahoma;outline:none}',

      /* AIM button */
      '#pbz-aim{position:fixed;right:16px;bottom:150px;width:52px;height:52px;border-radius:50%;background:#18181b;border:1px solid #3f3f46;color:#e8e8e8;font:700 10px "Segoe UI",Tahoma;display:none;align-items:center;justify-content:center;pointer-events:auto;z-index:2;cursor:pointer}',
      '#pbz-aim.on{background:#7f1d1d;border-color:#ff3b3b;color:#ff3b3b}'
    ].join('');

    var root, world, radar, bombEl, panel, aimBtn, flyInd;
    var povEl, povDot, tracerLayer;
    var tracerMap = new Map();
    var povLock = null;
    var espMap = new Map();
    var radarDots = new Map();
    var aimHeld = false;
    var active = true;
    var started = false;
    var TRACER_ORIGIN = 'top';

    /* ------------------------------------------------------------------ *
     *  UI
     * ------------------------------------------------------------------ */
    function buildUI() {
      var fa = document.createElement('link');
      fa.rel = 'stylesheet';
      fa.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css';
      (document.head || document.documentElement).appendChild(fa);

      var st = document.createElement('style');
      st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);

      root = el('div', '', document.body);
      root.id = 'pbz-root';
      world = el('div', '', root);
      world.id = 'pbz-world';
      radar = el('div', '', root);
      radar.id = 'pbz-radar';
      el('div', 'pbz-rt', radar).textContent = 'RADAR';
      el('div', 'pbz-me', radar);
      bombEl = el('div', '', root);
      bombEl.id = 'pbz-bomb';

      flyInd = el('div', '', document.body);
      flyInd.id = 'pbz-fly-ind';
      flyInd.textContent = '✈ FLY ACTIVE';

      povEl = el('div', '', document.body);
      povEl.id = 'pbz-pov';
      povDot = el('div', 'pbz-pov-dot', povEl);

      tracerLayer = el('div', '', document.body);
      tracerLayer.id = 'pbz-tracer-layer';

      panel = el('div', '', root);
      panel.id = 'pbz-panel';

      aimBtn = el('div', '', root);
      aimBtn.id = 'pbz-aim';
      aimBtn.textContent = 'AIM';

      buildPanel();

      ['pointerdown', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'wheel'].forEach(function (t) {
        panel.addEventListener(t, stop, { passive: false });
      });
      ['pointerdown', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend'].forEach(function (t) {
        aimBtn.addEventListener(t, stop, { passive: false });
      });

      aimBtn.addEventListener('pointerdown', function (e) {
        e.preventDefault(); aimHeld = true; aimBtn.classList.add('on');
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
        aimBtn.addEventListener(t, function () { aimHeld = false; aimBtn.classList.remove('on'); });
      });
      ['pointerup', 'pointercancel'].forEach(function (t) {
        window.addEventListener(t, function () { aimHeld = false; if (aimBtn) aimBtn.classList.remove('on'); }, true);
      });
      aimBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });

      window.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        if (!cfg.povAim || !cfg.aim) return;
        if (!active) return;
        if (panel && panel.style.display === 'block' && !panel.classList.contains('pbz-minimized')) return;

        var p = P();
        if (!p || !p.s || p.s.dead) return;

        var eye = eyePos(p);
        if (!eye) return;
        var povRadius = clamp(cfg.povRadius || 120, 40, 300);
        var cx = innerWidth * 0.5;
        var cy = innerHeight * 0.5;
        var r2 = povRadius * povRadius;
        var best = null;

        for (var i = 0; i < BOTS().length; i++) {
          var b = BOTS()[i];
          if (!b || !isEnemy(b, p.s) || !alive(b) || !b.mover) continue;
          var tp = targetPos(b, cfg.bone);
          if (!tp) continue;
          var ss = w2s(tp);
          if (!ss) continue;
          var ddx = ss.x - cx;
          var ddy = ss.y - cy;
          var d2 = ddx * ddx + ddy * ddy;
          if (d2 > r2) continue;
          if (cfg.vis && !visCheck(b, eye, tp)) continue;
          if (!best || d2 < best.d2) best = { b: b, tp: tp, d2: d2 };
        }

        if (best) {
          povLock = {
            target: best.b,
            tp: best.tp,
            until: nowSec() + (cfg.povLockTime || 250) / 1000
          };
          setPovLocked(true);
        }
      }, true);

      updateAimBtn();
      updatePovCircle();
    }

    function updateAimBtn() {
      if (!aimBtn) return;
      aimBtn.style.display = (cfg.aim && cfg.aimKey && active) ? 'flex' : 'none';
    }
    function updatePovCircle() {
      if (!povEl) return;
      var show = cfg.povAim && active;
      povEl.classList.toggle('on', !!show);
      if (!show) { povEl.classList.remove('locked'); return; }
      var r = clamp(cfg.povRadius || 120, 40, 300);
      povEl.style.width = (r * 2) + 'px';
      povEl.style.height = (r * 2) + 'px';
    }
    function setPovLocked(on) {
      if (!povEl) return;
      povEl.classList.toggle('locked', !!on);
    }

    function buildPanel() {
      var h = '<div class="pbz-head">' +
        '<div class="pbz-head-left"><b>IRILMODZ PBWEBBLAZE</b></div>' +
        '<div class="pbz-head-actions"><button type="button" class="pbz-icon-btn pbz-collapse" id="pbz-collapse" title="Minimize">−</button>' +
        '<button type="button" class="pbz-icon-btn pbz-expand" id="pbz-expand" title="Expand">+</button></div></div>';

      h += '<div class="pbz-body" id="pbz-body">';
      h += '<div class="pbz-body-container">';

      /* Sidebar Tabs di Samping Kiri */
      h += '<div class="pbz-tabs" role="tablist">' +
        '<button type="button" class="pbz-tab active" data-tab="esp"><i class="fa-solid fa-eye"></i> ESP</button>' +
        '<button type="button" class="pbz-tab" data-tab="aim"><i class="fa-solid fa-crosshairs"></i> AIM</button>' +
        '<button type="button" class="pbz-tab" data-tab="pov"><i class="fa-solid fa-bullseye"></i> POV</button>' +
        '<button type="button" class="pbz-tab" data-tab="fly"><i class="fa-solid fa-feather"></i> FLY</button>' +
        '<button type="button" class="pbz-tab" data-tab="morph"><i class="fa-solid fa-gun"></i> MORPH</button>' +
        '<button type="button" class="pbz-tab" data-tab="misc"><i class="fa-solid fa-sliders"></i> MISC</button>' +
        '</div>';

      /* Area Panel Konten di Kanan */
      h += '<div class="pbz-content-area">';

      h += '<section class="pbz-tab-pane active" data-pane="esp"><div class="pbz-sec">ESP OVERLAY</div>';
      h += rowHTML('Master', 'esp');
      h += rowHTML('Box', 'box');
      h += rowHTML('Name', 'name');
      h += rowHTML('Health', 'hp');
      h += rowHTML('Distance', 'dist');
      h += rowHTML('Visibility', 'vis');
      h += rowHTML('Teammates', 'team');
      h += rowHTML('Tracer', 'tracer');
      h += rowHTML('Radar', 'radar');
      h += rowHTML('Bomb timer', 'bomb');
      h += '</section>';

      h += '<section class="pbz-tab-pane" data-pane="aim"><div class="pbz-sec">AIM SETTINGS</div>';
      h += rowHTML('Aimbot', 'aim');
      h += rowHTML('Hold AIM', 'aimKey');
      h += sliderHTML('FOV', 'fov', 10, 180, 5);
      h += sliderHTML('Smooth', 'smooth', 1, 30, 1);
      h += '<div class="pbz-slider"><span>Bone</span><select id="pbz-bone" style="flex:1"><option value="head">Head</option><option value="chest">Chest</option></select></div>';
      h += rowHTML('Auto fire', 'auto');
      h += rowHTML('Triggerbot', 'trigger');
      h += '</section>';

      h += '<section class="pbz-tab-pane" data-pane="pov"><div class="pbz-sec">POV SETTINGS</div>';
      h += rowHTML('POV Aimbot', 'povAim');
      h += sliderHTML('Radius', 'povRadius', 40, 300, 5);
      h += sliderHTML('Lock ms', 'povLockTime', 50, 800, 10);
      h += '</section>';

      /* Tab Fly Mod Tambahan */
      h += '<section class="pbz-tab-pane" data-pane="fly"><div class="pbz-sec">FLY SETTINGS</div>';
      h += rowHTML('Enable Fly', 'fly');
      h += sliderHTML('Speed', 'flySpeed', 2, 20, 1);
      h += sliderHTML('Max H', 'flyMaxHeight', 20, 300, 10);
      h += '</section>';

      h += '<section class="pbz-tab-pane" data-pane="morph"><div class="pbz-sec">WEAPON MORPH</div>';
      h += rowHTML('Shotgun → AR', 'morphShotgun');
      h += rowHTML('Sniper → AR', 'morphSniper');
      h += rowHTML('Pistol → AR', 'morphPistol');
      h += rowHTML('Override dmg', 'morphDmg');
      h += '</section>';

      h += '<section class="pbz-tab-pane" data-pane="misc"><div class="pbz-sec">MISCELLANEOUS</div>';
      h += rowHTML('No recoil', 'noRecoil');
      h += rowHTML('Inf ammo', 'infAmmo');
      h += '</section>';

      h += '</div>'; // End content-area
      h += '</div>'; // End body-container

      h += '<div class="pbz-footer"><button class="pbz-mini" id="pbz-close" style="flex:1">HIDE MENU</button></div>';
      h += '</div>'; // End panel
      panel.innerHTML = h;

      panel.querySelectorAll('.pbz-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
          var key = tab.dataset.tab;
          panel.querySelectorAll('.pbz-tab').forEach(function (t) {
            t.classList.toggle('active', t === tab);
          });
          panel.querySelectorAll('.pbz-tab-pane').forEach(function (pane) {
            pane.classList.toggle('active', pane.dataset.pane === key);
          });
        });
      });

      panel.querySelector('#pbz-collapse').addEventListener('click', function () {
        panel.classList.add('pbz-minimized');
      });
      panel.querySelector('#pbz-expand').addEventListener('click', function () {
        panel.classList.remove('pbz-minimized');
      });

      panel.querySelectorAll('input[type=checkbox]').forEach(function (inp) {
        var k = inp.dataset.k;
        inp.checked = !!cfg[k];
        inp.addEventListener('change', function () {
          cfg[k] = inp.checked; saveCfg();
          if (k === 'aim' || k === 'aimKey') updateAimBtn();
          if (k === 'povAim') updatePovCircle();
        });
      });
      panel.querySelectorAll('input[type=range]').forEach(function (inp) {
        var k = inp.dataset.k;
        var out = inp.parentNode.querySelector('b');
        inp.value = cfg[k];
        out.textContent = inp.value;
        inp.addEventListener('input', function () {
          cfg[k] = +inp.value; out.textContent = inp.value; saveCfg();
          if (k === 'povRadius' || k === 'povLockTime') updatePovCircle();
        });
      });
      var sel = panel.querySelector('#pbz-bone');
      if (sel) {
        sel.value = cfg.bone;
        sel.addEventListener('change', function () { cfg.bone = sel.value; saveCfg(); });
      }
      panel.querySelector('#pbz-close').addEventListener('click', function () {
        panel.classList.add('pbz-minimized');
      });
    }

    function rowHTML(label, key) {
      return '<label class="pbz-row"><span>' + label + '</span><input type="checkbox" data-k="' + key + '"></label>';
    }
    function sliderHTML(label, key, min, max, step) {
      return '<div class="pbz-slider"><span>' + label + '</span><input type="range" data-k="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '"><b>0</b></div>';
    }

    /* ------------------------------------------------------------------ *
     *  ESP
     * ------------------------------------------------------------------ */
    function ensureBox(id) {
      var o = espMap.get(id);
      if (o) return o;
      var box = el('div', 'pbz-box', world);
      var name = el('div', 'pbz-name', box);
      var hp = el('div', 'pbz-hp', box);
      var fill = el('i', '', hp);
      var dist = el('div', 'pbz-dist', box);
      o = { box: box, name: name, fill: fill, dist: dist, id: id };
      espMap.set(id, o);
      return o;
    }
    function hideBox(o) { o.box.style.display = 'none'; }

    function espTick() {
      var p = P();
      if (!cfg.esp || !p || !p.s) {
        espMap.forEach(hideBox);
        return;
      }
      var eye = eyePos(p);
      var seen = new Set();
      for (var i = 0; i < BOTS().length; i++) {
        var b = BOTS()[i];
        if (!b || b === p.s || !alive(b)) continue;
        var enemy = isEnemy(b, p.s);
        if (!enemy && !cfg.team) continue;
        if (!b.mover || !b.mover.pos) continue;
        var head = headPos(b);
        var foot = new THREE.Vector3(b.mover.pos.x, b.mover.pos.y + 0.04, b.mover.pos.z);
        if (!head) continue;
        var hs = w2s(head), fs = w2s(foot);
        if (!hs || !fs) continue;
        var top = Math.min(hs.y, fs.y), bot = Math.max(hs.y, fs.y);
        var hgt = bot - top;
        if (hgt < 6 || hgt > 1400) continue;
        var wid = Math.max(4, hgt * 0.52);
        var x = (hs.x + fs.x) * 0.5 - wid * 0.5;
        var y = top;
        if (x < -wid || x > innerWidth + wid || y < -hgt || y > innerHeight + hgt) continue;

        var bid = b.id != null ? 'p' + b.id : 'b' + i;
        seen.add(bid);
        var o = ensureBox(bid);
        o.box.style.display = 'block';
        o.box.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
        o.box.style.width = wid.toFixed(1) + 'px';
        o.box.style.height = hgt.toFixed(1) + 'px';
        o.box.classList.toggle('pbz-ally', !enemy);
        o.box.classList.toggle('pbz-dim', !visCheck(b, eye, head));

        o.name.style.display = cfg.name ? 'block' : 'none';
        o.name.textContent = String(b.name || b.nick || b.id || '?').slice(0, 18);

        o.fill.parentNode.style.display = cfg.hp ? 'block' : 'none';
        var maxHp = +b.maxHp || 100;
        var hp = +b.hp;
        if (!isFinite(hp)) hp = maxHp;
        var pct = clamp(hp / maxHp, 0, 1) * 100;
        o.fill.style.width = pct.toFixed(1) + '%';
        o.fill.style.background = pct > 55 ? '#4ade80' : pct > 25 ? '#fbbf24' : '#ff3b3b';

        o.dist.style.display = cfg.dist ? 'block' : 'none';
        o.dist.textContent = Math.round(eye.distanceTo(b.mover.pos)) + 'm';
      }
      espMap.forEach(function (o, id) {
        if (!seen.has(id)) hideBox(o);
      });
    }

    /* ------------------------------------------------------------------ *
     *  ESP TRACER
     * ------------------------------------------------------------------ */
    function ensureTracer(id) {
      var t = tracerMap.get(id);
      if (t) return t;
      var line = el('div', 'pbz-tracer', tracerLayer);
      t = { line: line, id: id };
      tracerMap.set(id, t);
      return t;
    }
    function hideTracer(t) {
      if (t && t.line) t.line.style.display = 'none';
    }
    function tracerTick() {
      var p = P();
      if (!cfg.tracer || !p || !p.s) {
        tracerMap.forEach(hideTracer);
        return;
      }
      var eye = eyePos(p);
      var seen = new Set();
      var cx = innerWidth * 0.5;
      var cy = innerHeight * 0.5;

      for (var i = 0; i < BOTS().length; i++) {
        var b = BOTS()[i];
        if (!b || b === p.s || !alive(b)) continue;
        var enemy = isEnemy(b, p.s);
        if (!enemy && !cfg.team) continue;
        if (!b.mover || !b.mover.pos) continue;

        var head = headPos(b);
        if (!head) continue;
        var hs = w2s(head);
        if (!hs) {
          var chest = chestPos(b);
          if (chest) hs = w2s(chest);
        }
        if (!hs) continue;

        var ox, oy;
        if (TRACER_ORIGIN === 'center') {
          ox = cx; oy = cy;
        } else {
          ox = cx;
          oy = 0;
        }

        var dx = hs.x - ox;
        var dy = hs.y - oy;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len < 4 || len > 4000) continue;
        var ang = Math.atan2(dy, dx) * 180 / Math.PI;

        var bid = b.id != null ? 'p' + b.id : 'b' + i;
        seen.add(bid);
        var t = ensureTracer(bid);
        t.line.style.display = 'block';
        t.line.style.transform = 'translate3d(' + ox + 'px,' + oy + 'px,0) rotate(' + ang + 'deg)';
        t.line.style.width = len.toFixed(1) + 'px';
        t.line.classList.toggle('pbz-ally', !enemy);
        t.line.classList.toggle('pbz-dim', !visCheck(b, eye, head));
      }

      tracerMap.forEach(function (t, id) {
        if (!seen.has(id)) hideTracer(t);
      });
    }

    /* ------------------------------------------------------------------ *
     *  radar
     * ------------------------------------------------------------------ */
    function radarTick() {
      if (!cfg.radar) { if (radar) radar.style.display = 'none'; return; }
      var p = P();
      if (!radar) return;
      radar.style.display = 'block';
      if (!p || !p.s) return;
      var R = 70;
      var half = 130 / 2;
      var sc = (half - 6) / R;
      var px = p.s.mover.pos.x, pz = p.s.mover.pos.z;
      var seen = new Set();
      for (var i = 0; i < BOTS().length; i++) {
        var b = BOTS()[i];
        if (!b || b === p.s || !alive(b) || !b.mover) continue;
        var enemy = isEnemy(b, p.s);
        if (!enemy && !cfg.team) continue;
        var dx = b.mover.pos.x - px, dz = b.mover.pos.z - pz;
        if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
        var bid = b.id != null ? 'p' + b.id : 'b' + i;
        seen.add(bid);
        var d = radarDots.get(bid);
        if (!d) {
          d = el('div', 'pbz-dot', radar);
          radarDots.set(bid, d);
        }
        d.style.display = 'block';
        d.classList.toggle('ally', !enemy);
        d.style.transform = 'translate(' + (dx * sc).toFixed(1) + 'px,' + (dz * sc).toFixed(1) + 'px)';
      }
      radarDots.forEach(function (d, id) { if (!seen.has(id)) d.style.display = 'none'; });

      var r = RND();
      if (r && r.bomb && r.bomb.pos) {
        var bd = radarDots.get('__bomb');
        if (!bd) { bd = el('div', 'pbz-dot bomb', radar); radarDots.set('__bomb', bd); }
        bd.style.display = 'block';
        bd.style.transform = 'translate(' + ((r.bomb.pos.x - px) * sc).toFixed(1) + 'px,' + ((r.bomb.pos.z - pz) * sc).toFixed(1) + 'px)';
      } else {
        var bd2 = radarDots.get('__bomb');
        if (bd2) bd2.style.display = 'none';
      }
    }

    /* ------------------------------------------------------------------ *
     *  bomb timer
     * ------------------------------------------------------------------ */
    function bombTick() {
      var r = RND();
      if (!bombEl) return;
      if (!cfg.bomb || !r || !r.bomb) { bombEl.style.display = 'none'; return; }
      var left = r.bombLeft;
      bombEl.style.display = 'block';
      bombEl.textContent = 'C4 ' + (left != null ? (+left).toFixed(1) + 's' : 'PLANTED');
    }

    /* ------------------------------------------------------------------ *
     *  PERFECT FLY FEATURE LOGIC
     * ------------------------------------------------------------------ */
    var FLY = { active: false, savedJumpH: 1.05, initY: 0 };

    function isJumpHeld() {
      if (typeof keys !== 'undefined' && (keys.Space || keys['Space'])) return true;
      if (window.__pbzJumpHeld) return true;
      try {
        var jBtn = document.querySelector('#tc .b.jump.dn, .ui-jump.active, [class*="jump"].dn');
        if (jBtn) return true;
      } catch (e) {}
      return false;
    }

    function flyTick(dt) {
      if (!cfg.fly) {
        if (FLY.active) {
          FLY.active = false;
          var p = P();
          if (p && p.s && p.s.mover) {
            p.s.mover.noGrav = false;
            p.s.mover.jumpH = FLY.savedJumpH;
          }
          if (flyInd) flyInd.classList.remove('on');
        }
        return;
      }

      var p = P();
      if (!p || !p.s || p.s.dead || !p.s.mover) return;
      var mover = p.s.mover;
      var held = isJumpHeld();

      if (held) {
        if (!FLY.active) {
          FLY.active = true;
          FLY.savedJumpH = mover.jumpH || 1.05;
          FLY.initY = mover.pos.y;
          mover.noGrav = true;
          if (flyInd) flyInd.classList.add('on');
        }
        mover.pos.y += (cfg.flySpeed || 6) * dt;
        var maxH = cfg.flyMaxHeight || 100;
        if (mover.pos.y - FLY.initY > maxH) {
          mover.pos.y = FLY.initY + maxH;
        }
        mover.vy = 0;
        mover.fallDmg = 0;
        mover.ft = 0;
      } else {
        if (FLY.active) {
          FLY.active = false;
          mover.noGrav = false;
          mover.jumpH = FLY.savedJumpH;
          if (flyInd) flyInd.classList.remove('on');
        }
      }
    }

    function patchMobileJump() {
      try {
        window.__pbzJumpHeld = false;
        window.addEventListener('touchstart', function(e) {
          try {
            var target = e.target;
            if (target && target.className && typeof target.className === 'string' && target.className.indexOf('jump') >= 0) {
              window.__pbzJumpHeld = true;
            }
          } catch(err) {}
        }, {passive: true});
        window.addEventListener('touchend', function() {
          window.__pbzJumpHeld = false;
        }, {passive: true});
      } catch(e) {}
    }

    /* ------------------------------------------------------------------ *
     *  fire helper
     * ------------------------------------------------------------------ */
    function fireOnce() {
      var p = P();
      if (!p || !p.s || p.s.dead || p.reloading > 0) return;
      var w = weaponOf(p);
      if (!w || w.melee || w.grenade || w.c4) return;
      try {
        if (!w.auto && p.trigger) G().release();
        G().fire();
      } catch (e) {}
    }

    function pickTarget(eye) {
      var p = P();
      if (!p || !p.s || !eye) return null;
      var cur = lookDir(p.s.yaw, p.s.pitch);
      var best = null;
      for (var i = 0; i < BOTS().length; i++) {
        var b = BOTS()[i];
        if (!b || !isEnemy(b, p.s) || !alive(b) || !b.mover) continue;
        var tp = targetPos(b, cfg.bone);
        if (!tp) continue;
        var d = tp.clone().sub(eye);
        var dist = d.length();
        if (dist < 0.4 || dist > 400) continue;
        d.normalize();
        var ang = Math.acos(clamp(cur.dot(d), -1, 1)) * 180 / Math.PI;
        if (ang > cfg.fov) continue;
        if (cfg.vis && !visCheck(b, eye, tp)) continue;
        if (!best || ang < best.ang) best = { b: b, tp: tp, ang: ang, dist: dist };
      }
      return best;
    }

    function pickPovTarget(eye) {
      var p = P();
      if (!p || !p.s || !eye) return null;
      var povRadius = clamp(cfg.povRadius || 120, 40, 300);
      var cx = innerWidth * 0.5;
      var cy = innerHeight * 0.5;
      var r2 = povRadius * povRadius;
      var best = null;
      for (var i = 0; i < BOTS().length; i++) {
        var b = BOTS()[i];
        if (!b || !isEnemy(b, p.s) || !alive(b) || !b.mover) continue;
        var tp = targetPos(b, cfg.bone);
        if (!tp) continue;
        var ss = w2s(tp);
        if (!ss) continue;
        var ddx = ss.x - cx;
        var ddy = ss.y - cy;
        var d2 = ddx * ddx + ddy * ddy;
        if (d2 > r2) continue;
        if (cfg.vis && !visCheck(b, eye, tp)) continue;
        if (!best || d2 < best.d2) best = { b: b, tp: tp, d2: d2 };
      }
      return best;
    }

    /* ------------------------------------------------------------------ *
     *  aim
     * ------------------------------------------------------------------ */
    function aimTick(dt) {
      if (!cfg.aim) return;
      if (cfg.aimKey && !aimHeld) return;
      if (panel && panel.style.display === 'block' && !panel.classList.contains('pbz-minimized')) return;
      var p = P();
      if (!p || !p.s || p.s.dead || p.reloading > 0) return;
      var w = weaponOf(p);
      if (!w) return;
      var eye = eyePos(p);
      if (!eye) return;

      var povTarget = null;
      var povBest = null;

      if (cfg.povAim) {
        povBest = pickPovTarget(eye);
        if (povBest) {
          povTarget = povBest;
          setPovLocked(true);
          povLock = {
            target: povBest.b,
            tp: povBest.tp,
            until: nowSec() + (cfg.povLockTime || 250) / 1000
          };
        } else if (povLock && nowSec() < povLock.until) {
          var lb = povLock.target;
          if (lb && alive(lb) && isEnemy(lb, p.s)) {
            var ltp = targetPos(lb, cfg.bone);
            if (ltp) {
              povTarget = { b: lb, tp: ltp, d2: 0 };
              setPovLocked(true);
            } else {
              povLock = null;
              setPovLocked(false);
            }
          } else {
            povLock = null;
            setPovLocked(false);
          }
        } else {
          povLock = null;
          setPovLocked(false);
        }
      }

      var t = povTarget || pickTarget(eye);
      if (!t) return;

      var d = t.tp.clone().sub(eye);
      var len = d.length();
      if (len < 0.4) return;
      var yaw = Math.atan2(-d.x, -d.z);
      var pitch = Math.asin(clamp(d.y / len, -1, 1));

      var smooth = cfg.smooth;
      if (cfg.povAim && povTarget) smooth = Math.max(4, smooth * 1.5);

      var k = 1 - Math.exp(-smooth * dt);
      p.s.yaw = angLerp(p.s.yaw, yaw, k) + (Math.random() - 0.5) * 0.0012;
      p.s.pitch = clamp(p.s.pitch + (pitch - p.s.pitch) * k + (Math.random() - 0.5) * 0.0012, -1.4, 1.4);

      if (cfg.auto && !w.melee && !w.grenade && !w.c4) {
        var look = lookDir(p.s.yaw, p.s.pitch);
        var err = Math.acos(clamp(look.dot(d.normalize()), -1, 1)) * 180 / Math.PI;
        if (err < 2.2) fireOnce();
      }
    }

    /* ------------------------------------------------------------------ *
     *  triggerbot
     * ------------------------------------------------------------------ */
    function triggerTick() {
      if (!cfg.trigger) return;
      if (panel && panel.style.display === 'block' && !panel.classList.contains('pbz-minimized')) return;
      var p = P();
      if (!p || !p.s || p.s.dead || p.reloading > 0) return;
      var eye = eyePos(p);
      if (!eye) return;
      var dir = lookDir(p.s.yaw, p.s.pitch);
      var best = null;
      for (var i = 0; i < BOTS().length; i++) {
        var b = BOTS()[i];
        if (!b || !isEnemy(b, p.s) || !alive(b) || !b.mover) continue;
        var h = null;
        try { h = b.hitTest(eye, dir, 300); } catch (e) { h = null; }
        if (h && isFinite(h.t) && (!best || h.t < best.t)) best = { b: b, t: h.t };
      }
      if (!best) return;
      if (cfg.vis) {
        var wall = null;
        try { wall = G().cast(eye, dir, best.t); } catch (e) { wall = null; }
        if (wall && wall.t < best.t - 0.05) return;
      }
      fireOnce();
    }

    /* ------------------------------------------------------------------ *
     *  misc
     * ------------------------------------------------------------------ */
    function miscTick() {
      var p = P();
      if (!p || !p.s) return;
      var w = weaponOf(p);
      if (cfg.noRecoil && p.rec) {
        p.rec.v = 0;
        p.rec.A = 0;
        p.kick = 0;
      }
      if (cfg.infAmmo && w && !w.melee && !w.grenade && w.mag > 0 && p.reloading <= 0) {
        if (p.ammo < w.mag) p.ammo = w.mag;
      }
    }

    /* ------------------------------------------------------------------ *
     *  WEAPON MORPH
     * ------------------------------------------------------------------ */
    var MORPH_ORIG = new WeakMap();

    function isShotgun(w) {
      if (!w) return false;
      var c = String(w.cls || '');
      var item = +w.item || 0;
      var cls = Math.floor(item % 1e5 / 1e3);
      return c.indexOf('shotgun') === 0 || cls === 6 || cls === 35 || cls === 39;
    }

    function isSniper(w) {
      if (!w) return false;
      var c = String(w.cls || '');
      var item = +w.item || 0;
      var cls = Math.floor(item % 1e5 / 1e3);
      return c.indexOf('sniper') === 0 || cls === 5;
    }

    function isPistol(w) {
      if (!w) return false;
      var c = String(w.cls || '');
      var item = +w.item || 0;
      var cls = Math.floor(item % 1e5 / 1e3);
      return c === 'handgun' || cls === 2 || cls === 14 || cls === 18;
    }

    function shouldMorph(w) {
      if (!w || w.melee || w.grenade || w.c4) return false;
      if (cfg.morphShotgun && isShotgun(w)) return true;
      if (cfg.morphSniper && isSniper(w)) return true;
      if (cfg.morphPistol && isPistol(w)) return true;
      return false;
    }

    function applyMorph(w) {
      if (!w) return;
      if (MORPH_ORIG.has(w)) return;
      var orig = {
        delay: w.delay, pellets: w.pellets, auto: w.auto,
        burst: w.burst, burstDelay: w.burstDelay,
        bolt: w.bolt, pump: w.pump, ch: w.ch, rec: w.rec,
        damage: w.damage, dpd: w.dpd, range: w.range
      };
      MORPH_ORIG.set(w, orig);

      w.delay = 0.075;
      w.auto = true;
      w.burst = 0;
      w.burstDelay = 0;
      w.bolt = false;
      w.pump = false;
      w.pellets = 1;
      w.rec = { vA: 1.9, vMax: 7, hA: 1.9, hMax: 3.8 };
      w.ch = {
        min: 0.5, max: 18, expand: 6,
        stand: 0.6, move: 1.1, moveSit: 0.55, jump: 6,
        zoom: -1.5, dmg: 1.2, speed: 1, dev: 1.6
      };

      if (cfg.morphDmg) {
        w.damage = 26;
        w.dpd = 0.35;
        w.range = 100;
      }

      var p = P();
      if (p && p.rec) {
        p.rec.v = 0; p.rec.A = 0; p.rec.hPend = 0; p.rec.hState = 0;
      }
    }

    function restoreMorph(w) {
      if (!w || !MORPH_ORIG.has(w)) return;
      var o = MORPH_ORIG.get(w);
      w.delay = o.delay;
      w.pellets = o.pellets;
      w.auto = o.auto;
      w.burst = o.burst;
      w.burstDelay = o.burstDelay;
      w.bolt = o.bolt;
      w.pump = o.pump;
      w.ch = o.ch;
      w.rec = o.rec;
      w.damage = o.damage;
      w.dpd = o.dpd;
      w.range = o.range;
      MORPH_ORIG.delete(w);
    }

    function morphTick() {
      var p = P();
      if (!p || !p.s) return;
      var w = weaponOf(p);
      if (!w) return;

      if (shouldMorph(w)) {
        applyMorph(w);
        if (p.rec) {
          p.rec.v = 0; p.rec.A = 0; p.rec.hPend = 0; p.rec.hState = 0;
        }
        if (!p.trigger) p.trigger = true;
      } else {
        restoreMorph(w);
      }
    }

    /* ------------------------------------------------------------------ *
     *  main loop
     * ------------------------------------------------------------------ */
    var lastFrame = 0;
    function frame(ts) {
      requestAnimationFrame(frame);
      if (!started || !active) return;
      var dt = lastFrame ? Math.min(0.05, (ts - lastFrame) / 1000) : 0.016;
      lastFrame = ts;
      try {
        flyTick(dt);
        morphTick();
        espTick();
        tracerTick();
        radarTick();
        bombTick();
        aimTick(dt);
        triggerTick();
        miscTick();
        updatePovCircle();
      } catch (e) {}
    }

    /* ------------------------------------------------------------------ *
     *  boot
     * ------------------------------------------------------------------ */
    function boot() {
      if (!window.G || !window.G.P || !window.G.bots) {
        setTimeout(boot, 150);
        return;
      }
      if (!document.body) { setTimeout(boot, 150); return; }
      if (started) return;
      started = true;
      patchMobileJump();
      buildUI();
      requestAnimationFrame(frame);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
      setTimeout(boot, 800);
    } else {
      boot();
    }
  }

if (!window.__pbzLicensed) {
  // Diload langsung (bukan via loader) -> jalan tetap, tanpa license gate
  bootCore();
} else {
  bootCore();
}
