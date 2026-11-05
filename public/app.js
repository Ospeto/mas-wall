/* ==========================================================================
   MAS WALL - public/app.js
   Owner: interactions. Contract: docs/CONTRACT.md section 8.
   Classic script: no modules, no imports, no build step.
   All user text is rendered with textContent / createElement only.
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------- constants ------------------------------ */
  const CACHE_KEY = 'mas-wall:v1';
  const IDENTITY_KEY = 'mas-wall:me';
  const OUTBOX_KEY = 'mas-wall:outbox';
  const VIEW_KEY = 'mas-wall:view';

  const CANVAS_W = 2200;
  const CANVAS_H = 1600;
  const CARD_W_MIN = 300;
  const CARD_W_MAX = 460;
  const CARD_W_DEFAULT = 360;
  const CARD_H_GUESS = 320;
  const MAX_CARDS = 400;
  const MAX_RENDERED = 400;
  const MAX_REQS = 40;
  const TITLE_MAX = 200;
  const TEXT_MAX = 4000;
  const REQ_MAX = 200;
  const SNAP = 8;
  const DRAG_THRESHOLD = 4;
  const TRASH_LONG_PRESS = 450;
  const TRASH_ARM_MARGIN = 24;
  const TZ_OFFSET_MIN = 390; /* Asia/Rangoon = UTC+06:30 */
  const API_MIN_INTERVAL = 1000 / 6; /* ~6 writes/second, contract 8.11 */
  const SAVE_DEBOUNCE = 250;
  /* Write access is verified by the server (POST api/auth/unlock) and the resulting
     short-lived token is what authorizes POST api/op. Only the token is cached. */
  const UNLOCK_KEY = 'mas-wall:write-token';
  const PRESENCE_HEARTBEAT = 25000;
  const PRESENCE_POS_THROTTLE = 150;
  const CONN_RETRY_MAX = 8000;
  const MAX_POSTER_REQS = 8;
  const STATE_TIMEOUT = 2500;
  const POLL_INTERVAL = 2500;
  const POLL_INTERVAL_OFFLINE = 5000;
  const SSE_RETRY_POLLING = 30000;
  const SSE_WATCHDOG = 3500;
  const SUPABASE_CONFIG_URL = 'supabase-config.json';
  const SUPABASE_VENDOR = 'vendor/supabase-js.min.js';
  const SUPABASE_TRACK_MS = 20000;
  const SUPABASE_RECONNECT_MS = 5000;
  const SUPABASE_VENDOR_TIMEOUT = 8000;

  const COLORS = ['bone', 'blush', 'sage', 'sky', 'butter'];
  const TYPES = ['assignment', 'presentation', 'other'];
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const MONTHS_FULL = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  const USER_COLORS = ['#E8451F', '#1F6B5E', '#B8873B', '#8C5A3C', '#5B7C8D', '#A8443C'];

  const mqCoarse = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
  const mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  /* -------------------------------- helpers ------------------------------- */
  function byId(id) { return document.getElementById(id); }
  function clamp(v, lo, hi) { if (hi < lo) hi = lo; return v < lo ? lo : (v > hi ? hi : v); }
  function snap(v) { return Math.round(v / SNAP) * SNAP; }
  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function nowIso() { return new Date().toISOString(); }
  function prefersReducedMotion() { return !!(mqReduce && mqReduce.matches); }
  function limit(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) : s; }
  function str(v, n) { return limit(typeof v === 'string' ? v : (v == null ? '' : String(v)), n); }
  function num(v, dflt, lo, hi) {
    var x = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(x)) x = dflt;
    return clamp(x, lo, hi);
  }
  function makeId(prefix) {
    var raw = '';
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') raw = window.crypto.randomUUID().replace(/-/g, '');
    } catch (e) { raw = ''; }
    if (!raw) raw = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
    return String(prefix || 'x') + '_' + raw.slice(0, 8);
  }
  function readJSON(key) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return null;
      var val = JSON.parse(raw);
      return val == null ? null : val;
    } catch (e) { return null; }
  }
  function writeJSON(key, val) {
    try { window.localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }
  function el(tag, cls) { var n = document.createElement(tag); if (cls) n.className = cls; return n; }
  function iconBtn(cls, label, text) {
    var b = el('button', cls);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.textContent = text;
    return b;
  }
  function listTagFor(host) {
    var tag = host && host.tagName ? host.tagName.toUpperCase() : '';
    return (tag === 'UL' || tag === 'OL') ? 'li' : 'div';
  }

  /* ------------------------------ date helpers ---------------------------- */
  /* Asia/Rangoon wall-clock parts without relying on Intl. */
  function yangonParts(ms) {
    var d = new Date(ms + TZ_OFFSET_MIN * 60000);
    return {
      y: d.getUTCFullYear(),
      m: d.getUTCMonth() + 1,
      d: d.getUTCDate(),
      h: d.getUTCHours(),
      mi: d.getUTCMinutes()
    };
  }
  function sameYangonDay(a, b) { return a.y === b.y && a.m === b.m && a.d === b.d; }
  /* whole calendar days between two instants, in Asia/Rangoon */
  function dayDelta(t, now) {
    var a = yangonParts(now);
    var b = yangonParts(t);
    return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
  }
  function dueMs(card) {
    if (!card || !card.due) return NaN;
    var t = Date.parse(card.due);
    return isFinite(t) ? t : NaN;
  }
  function urgencyOf(card, now) {
    if (card.done) return 'done';
    var t = dueMs(card);
    if (!isFinite(t)) return 'none';
    if (t < now) return 'late';
    var delta = dayDelta(t, now);
    if (delta === 0) return 'today';
    if (delta <= 3) return 'soon';
    if (delta <= 7) return 'week';
    return 'later';
  }
  function dueText(card, now) {
    if (card.done) return 'Done';
    var t = dueMs(card);
    if (!isFinite(t)) return 'No date';
    var delta = dayDelta(t, now);
    if (t < now) {
      if (delta === 0) return 'due now';
      var late = Math.abs(delta);
      return late === 1 ? '1 day late' : late + ' days late';
    }
    if (delta === 0) return 'today';
    if (delta === 1) return 'tomorrow';
    return 'in ' + delta + ' days';
  }
  function splitDue(due) {
    var t = due ? Date.parse(due) : NaN;
    if (!isFinite(t)) return { date: '', time: '' };
    var p = yangonParts(t);
    return { date: p.y + '-' + pad2(p.m) + '-' + pad2(p.d), time: pad2(p.h) + ':' + pad2(p.mi) };
  }
  function composeDue(dateVal, timeVal) {
    var d = typeof dateVal === 'string' ? dateVal.slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    var probe = Date.parse(d + 'T00:00:00+06:30');
    if (!isFinite(probe)) return null;
    var t = typeof timeVal === 'string' && /^\d{1,2}:\d{2}/.test(timeVal) ? timeVal.slice(0, 5) : '23:59';
    var bits = t.split(':');
    var hh = clamp(parseInt(bits[0], 10) || 0, 0, 23);
    var mm = clamp(parseInt(bits[1], 10) || 0, 0, 59);
    if (isNaN(hh)) hh = 23;
    if (isNaN(mm)) mm = 59;
    return d + 'T' + pad2(hh) + ':' + pad2(mm) + ':00+06:30';
  }

  /* -------------------------------- state --------------------------------- */
  const state = {
    rev: 0,
    course: { title: 'MAS WALL', subtitle: 'Assignments, presentations & everything due', term: '' },
    cards: [],
    index: new Map(),
    pendingCards: new Map(),
    users: [],
    me: null,
    conn: 'connecting',
    mode: 'unknown',
    transport: 'sse',
    unlocked: false,
    writeToken: null,
    pendingWrite: null,
    pollForced: false,
    supabase: null,
    supaChannel: null,
    view: 'wall',
    filters: { type: 'all', course: 'all', status: 'all', q: '' },
    coarse: !!(mqCoarse && mqCoarse.matches),
    outbox: [],
    flushing: false,
    agendaDirty: false
  };

  const ui = {};
  const posterNodes = new Map();
  const lastPointer = { x: 0, y: 0 };
  let suppressClickUntil = 0;

  const drawer = { id: null, color: 'bone', done: false, mode: 'edit', saveTimer: 0, stateTimer: 0, lastFocus: null };
  const drag = { active: false, visual: false, node: null, card: null, pid: 0, sx: 0, sy: 0, ox: 0, oy: 0, x: 0, y: 0, z: 0, moved: false, movedBy: 0, lifted: false, longPress: false, lpTimer: 0, prevZ: 1 };

  /* ------------------------------- DOM cache ------------------------------ */
  const DOM_IDS = [
    'app', 'masthead', 'brandMark', 'wallTitle', 'wallSubtitle', 'wallTerm', 'wallStats',
    'presenceList', 'presenceCount', 'btnMe', 'btnShare', 'btnAdd', 'btnHelp',
    'deadlineStrip', 'deadlineRail', 'toolbar', 'filterType', 'filterCourse', 'filterStatus',
    'searchInput', 'viewToggle', 'connBadge', 'stage', 'wallView', 'wallCanvas', 'wallEmpty',
    'agendaView', 'agendaGroups', 'drawer', 'drawerBackdrop', 'toasts', 'nameDialog',
    'nameInput', 'nameSave', 'nameCancel', 'helpDialog', 'helpClose', 'drawerKicker',
    'drawerTitleInput', 'drawerTypeSelect', 'drawerCourseInput', 'drawerKindInput',
    'drawerDueDate', 'drawerDueTime', 'drawerWeightInput', 'drawerBriefInput', 'drawerModeSelect',
    'drawerNotesInput', 'drawerLinkInput', 'drawerColorGroup', 'drawerDoneToggle', 'drawerForm',
    'drawerDueBadge', 'drawerProgress', 'drawerReqs', 'btnAddReq', 'btnDuplicateCard',
    'btnDeleteCard', 'drawerSaveState', 'drawerClose', 'drawerTitle', 'drawerEditBtn', 'drawerForm',
    'btnLock', 'unlockDialog', 'unlockInput', 'unlockError', 'unlockSubmit', 'unlockCancel'
  ];
  function cacheDom() {
    for (var i = 0; i < DOM_IDS.length; i++) {
      var id = DOM_IDS[i];
      if (!byId(id)) ui[id] = byId(id);
      else ui[id] = byId(id);
    }
  }

  /* -------------------------------- toasts -------------------------------- */
  function toast(message, kind, action) {
    var host = ui.toasts;
    if (!host) { try { console.info('[MAS WALL]', message); } catch (e) {} return; }
    var node = el('div', 'toast' + (kind === 'error' ? ' is-error' : (kind === 'ok' ? ' is-ok' : '')));
    var textNode = el('span', 'toast-text');
    textNode.textContent = String(message == null ? '' : message);
    node.appendChild(textNode);
    node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    var life = prefersReducedMotion() ? 1400 : 2800;
    if (action && typeof action === 'object') {
      if (typeof action.duration === 'number' && action.duration > 0) life = action.duration;
      if (action.label) {
        var undoBtn = el('button', 'toast-undo');
        undoBtn.type = 'button';
        undoBtn.textContent = String(action.label);
        undoBtn.addEventListener('click', function () {
          try { if (typeof action.onClick === 'function') action.onClick(); } catch (e) {}
          if (node.parentNode) node.parentNode.removeChild(node);
        });
        node.appendChild(undoBtn);
      }
    }
    host.appendChild(node);
    while (host.children.length > 4) host.removeChild(host.firstChild);
    setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, life);
  }


  /* ------------------------------ trash zone ------------------------------ */
  /* app.js creates this element and toggles .is-visible/.is-armed; styles.css owns
     appearance. If no .trash-zone rule exists yet, a small fallback sheet is
     injected so the feature stays usable (visual CSS wins when it defines fixed). */
  let trashEl = null;
  let trashStylesDone = false;
  const TRASH_FALLBACK_CSS = '#trashZone.trash-zone{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:950;width:min(280px,calc(100vw - 32px));min-height:62px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:10px;padding:12px 18px;background:rgba(23,20,16,.94);border:1px dashed rgba(244,238,226,.55);border-radius:3px;color:#F4EEE2;font:600 10.5px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;opacity:0;visibility:hidden;pointer-events:none;transform:translate(-50%,14px);transition:opacity 160ms cubic-bezier(.2,.7,.2,1),transform 160ms cubic-bezier(.2,.7,.2,1),background 120ms linear,border-color 120ms linear}#trashZone.trash-zone.is-visible{opacity:1;visibility:visible;transform:translate(-50%,0)}#trashZone.trash-zone.is-armed{background:#E8451F;border-color:#E8451F;border-style:solid;color:#171410;transform:translate(-50%,0) scale(1.03)}#trashZone .trash-glyph{position:relative;flex:none;width:12px;height:15px;border:2px solid currentColor;border-top:0;border-radius:0 0 2px 2px}#trashZone .trash-glyph::before{content:\"\";position:absolute;left:-4px;top:-5px;width:20px;height:2px;background:currentColor}#trashZone .trash-label{white-space:nowrap}.toast-undo{appearance:none;border:1px solid currentColor;background:transparent;color:inherit;font:inherit;font-size:10px;letter-spacing:.12em;text-transform:uppercase;padding:3px 8px;border-radius:2px;cursor:pointer;margin-left:10px;line-height:1.2}.toast-undo:hover{background:rgba(255,255,255,.14)}@media (prefers-reduced-motion: reduce){#trashZone.trash-zone{transition:opacity 120ms linear}#trashZone.trash-zone.is-armed{transform:translate(-50%,0)}}';
  function ensureTrashStyles() {
    if (trashStylesDone) return;
    trashStylesDone = true;
    try {
      var style = document.createElement('style');
      style.setAttribute('data-mas-trash-fallback', '1');
      style.textContent = TRASH_FALLBACK_CSS;
      document.head.appendChild(style);
    } catch (e) {}
  }
  function ensureTrash() {
    if (trashEl && document.body && document.body.contains(trashEl)) return trashEl;
    var node = byId('trashZone');
    if (!node) {
      node = el('div', 'trash-zone');
      node.id = 'trashZone';
      node.setAttribute('aria-hidden', 'true');
      var glyph = el('span', 'trash-glyph');
      glyph.setAttribute('aria-hidden', 'true');
      var label = el('span', 'trash-label');
      label.textContent = 'Drop to delete';
      node.appendChild(glyph);
      node.appendChild(label);
      (document.body || document.documentElement).appendChild(node);
    }
    if (!node.querySelector('.trash-label')) {
      var label2 = el('span', 'trash-label');
      label2.textContent = 'Drop to delete';
      node.appendChild(label2);
    }
    trashEl = node;
    try {
      if (window.getComputedStyle(node).position !== 'fixed') ensureTrashStyles();
    } catch (e) { ensureTrashStyles(); }
    return node;
  }
  function trashBlocked() {
    return !!(drawer.id || dialogOpen(ui.unlockDialog) || dialogOpen(ui.nameDialog) || dialogOpen(ui.helpDialog));
  }
  function showTrash() {
    if (trashBlocked()) return;
    var node = ensureTrash();
    node.classList.add('is-visible');
    node.setAttribute('aria-hidden', 'false');
  }
  function hideTrash() {
    if (!trashEl) return;
    trashEl.classList.remove('is-visible', 'is-armed');
    trashEl.setAttribute('aria-hidden', 'true');
    var label = trashEl.querySelector('.trash-label');
    if (label) label.textContent = 'Drop to delete';
  }
  function trashVisible() {
    return !!(trashEl && trashEl.classList.contains('is-visible'));
  }
  function armTrash(on) {
    if (!trashVisible()) return;
    var node = ensureTrash();
    var armed = node.classList.contains('is-armed');
    if (armed === !!on) return;
    node.classList.toggle('is-armed', !!on);
    var label = node.querySelector('.trash-label');
    if (label) label.textContent = on ? 'Release to delete' : 'Drop to delete';
  }
  function trashHitRect() {
    var node = ensureTrash();
    var rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return rect;
    var w = Math.min(280, Math.max(180, window.innerWidth - 32));
    var h = 62;
    return {
      left: (window.innerWidth - w) / 2,
      right: (window.innerWidth + w) / 2,
      top: window.innerHeight - 16 - h,
      bottom: window.innerHeight - 16
    };
  }
  function isOverTrash(x, y) {
    var rect = trashHitRect();
    var m = TRASH_ARM_MARGIN;
    return x >= rect.left - m && x <= rect.right + m && y >= rect.top - m && y <= rect.bottom + m;
  }
  function clearLongPress() {
    if (drag.lpTimer) { clearTimeout(drag.lpTimer); drag.lpTimer = 0; }
  }

  /* ------------------------ connection badge / banner --------------------- */
  function offlineBanner() {
    var b = byId('offlineBanner') || document.querySelector('.offline-banner');
    if (b) return b;
    b = el('div', 'offline-banner');
    b.id = 'offlineBanner';
    b.hidden = true;
    b.setAttribute('role', 'status');
    b.style.position = 'fixed';
    b.style.left = '50%';
    b.style.transform = 'translateX(-50%)';
    b.style.bottom = '18px';
    b.style.zIndex = '90';
    b.style.padding = '8px 14px';
    b.style.background = '#E8451F';
    b.style.color = '#fff';
    b.style.font = '600 12px/1.3 ui-monospace, monospace';
    b.style.letterSpacing = '0.04em';
    b.style.borderRadius = '3px';
    b.textContent = 'OFFLINE - changes stay on this device';
    (document.body || document.documentElement).appendChild(b);
    return b;
  }
  function setConn(status) {
    if (status !== 'live' && status !== 'polling' && status !== 'connecting' && status !== 'offline') status = 'connecting';
    var prev = state.conn;
    state.conn = status;
    var badge = ui.connBadge;
    if (badge) {
      badge.dataset.state = status;
      badge.classList.toggle('is-live', status === 'live' || status === 'polling');
      badge.classList.toggle('is-connecting', status === 'connecting');
      badge.classList.toggle('is-offline', status === 'offline');
      badge.setAttribute('title',
        status === 'live' ? 'Connected - changes sync live' :
        status === 'polling' ? 'Live stream unavailable - polling for updates' :
        status === 'connecting' ? 'Reconnecting to the wall...' : 'Offline - showing your saved copy');
      badge.textContent = status === 'live' ? 'Live' : (status === 'polling' ? 'Polling' : (status === 'connecting' ? 'Connecting' : 'Offline'));
    }
    document.documentElement.dataset.conn = status;
    var banner = offlineBanner();
    if (banner) banner.hidden = status !== 'offline';
    if (prev !== status && status === 'offline' && (prev === 'live' || prev === 'polling')) toast('Offline - changes are saved on this device', 'error');
    if (prev === 'offline' && (status === 'live' || status === 'polling')) toast('Back online');
  }

  /* ------------------------------- network -------------------------------- */
  const rate = { chain: Promise.resolve(), last: 0 };
  function withRate(fn) {
    function run() {
      var wait = Math.max(0, rate.last + API_MIN_INTERVAL - Date.now());
      if (wait > 0) {
        return sleep(wait).then(function () { rate.last = Date.now(); return fn(); });
      }
      rate.last = Date.now();
      return fn();
    }
    var next = rate.chain.then(run, run);
    rate.chain = next.then(function () {}, function () {});
    return next;
  }
  function loadOutbox() {
    var a = readJSON(OUTBOX_KEY);
    if (!Array.isArray(a)) return [];
    return a.filter(function (o) { return o && typeof o === 'object' && typeof o.op === 'string'; }).slice(-100);
  }
  function saveOutbox() { writeJSON(OUTBOX_KEY, state.outbox.slice(-100)); }
  function enqueueOp(op) {
    var copy = cloneCard(op);
    state.outbox.push(copy);
    if (state.outbox.length > 100) state.outbox.shift();
    saveOutbox();
  }
  function postOp(op, noEnqueue) {
    if (state.mode === 'supabase') return supaWrite(op, noEnqueue);
    if (state.mode !== 'http' || !navigator.onLine) {
      if (!noEnqueue) enqueueOp(op);
      setSaveState('offline');
      return Promise.resolve({ ok: false, error: 'offline' });
    }
    return withRate(function () {
      return fetch('api/op', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-write-token': state.writeToken || ''
        },
        body: JSON.stringify(op)
      }).then(function (res) {
        return res.text().then(function (text) {
          var body = null;
          try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
          return { res: res, body: body };
        });
      });
    }).then(function (r) {
      if (r.res.status === 401) {
        state.unlocked = false;
        state.writeToken = null;
        try { sessionStorage.removeItem(UNLOCK_KEY); } catch (e) {}
        updateLockUi();
        toast('Write password required — unlock again');
        setSaveState('error');
        return { ok: false, error: 'locked', status: 401 };
      }
      if (!r.res.ok || (r.body && r.body.ok === false)) {
        setSaveState('error');
        return { ok: false, error: (r.body && r.body.error) || ('HTTP ' + r.res.status), status: r.res.status };
      }
      if (r.body && isFiniteNum(r.body.rev)) state.rev = r.body.rev;
      setSaveState('saved');
      return { ok: true };
    }).catch(function () {
      if (!noEnqueue) enqueueOp(op);
      setSaveState('offline');
      return { ok: false, error: 'network' };
    });
  }
  function flushOutbox() {
    if (state.flushing || !state.outbox.length) return;
    if (state.mode !== 'http' && state.mode !== 'supabase') return;
    if (!navigator.onLine || state.conn === 'offline') return;
    state.flushing = true;
    var step = function () {
      if (!state.outbox.length) { state.flushing = false; return; }
      var op = state.outbox[0];
      postOp(op, true).then(function (res) {
        if (!res.ok) { state.flushing = false; return; }
        state.outbox.shift();
        saveOutbox();
        step();
      });
    };
    step();
  }

  /* ------------------------------- presence ------------------------------- */
  let presenceLast = 0;
  let presenceTimer = 0;
  let presenceBusy = false;
  let presenceQueued = false;
  function schedulePresence(immediate) {
    if (immediate) { presenceQueued = true; pumpPresence(); return; }
    if (presenceTimer) return;
    presenceTimer = setTimeout(function () { presenceTimer = 0; presenceQueued = true; pumpPresence(); }, PRESENCE_POS_THROTTLE);
  }
  function pumpPresence() {
    if (!presenceQueued || presenceBusy || !state.me) return;
    if (state.mode === 'unknown' || state.mode === 'offline') { presenceQueued = false; return; }
    if (state.mode === 'supabase') { presenceQueued = false; supaTrackSelf(); return; }
    if (state.presenceAvailable === false) { presenceQueued = false; return; }
    var wait = Math.max(0, presenceLast + 150 - Date.now());
    if (wait > 0) {
      if (!presenceTimer) presenceTimer = setTimeout(function () { presenceTimer = 0; pumpPresence(); }, wait);
      return;
    }
    presenceQueued = false;
    presenceBusy = true;
    presenceLast = Date.now();
    var me = state.me;
    var body = {
      user: {
        id: me.id,
        name: me.name,
        color: me.color,
        x: Math.round(lastPointer.x),
        y: Math.round(lastPointer.y),
        cardId: drawer.id || null
      }
    };
    fetch('api/presence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true
    }).then(function (res) {
      if (res && (res.status === 404 || res.status === 501)) degradePresence();
    }, function () {}).then(function () {
      presenceBusy = false;
      if (presenceQueued) schedulePresence(false);
    });
  }
  let heartbeatTimer = 0;
  function restartHeartbeat(ms) {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(function () { schedulePresence(true); }, ms || PRESENCE_HEARTBEAT);
  }
  function startHeartbeat() { restartHeartbeat(PRESENCE_HEARTBEAT); }
  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = 0; }
  }

  /* ------------------------ transport: HTTP SSE + polling ------------------- */
  let es = null;
  let sseFailures = 0;
  let sseWatchdog = 0;
  let sseOpened = false;
  let sseRetryTimer = 0;
  let pollTimer = 0;
  let pollBusy = false;

  function closeSSE() {
    if (es) { try { es.close(); } catch (e) {} es = null; }
  }
  function clearWatchdog() {
    if (sseWatchdog) { clearTimeout(sseWatchdog); sseWatchdog = 0; }
  }
  function scheduleWatchdog() {
    clearWatchdog();
    sseWatchdog = setTimeout(function () {
      sseWatchdog = 0;
      if (es && !sseOpened) {
        closeSSE();
        sseFailures += 1;
        startPolling();
      }
    }, SSE_WATCHDOG);
  }
  function startTransport() {
    if (state.mode !== 'http') return;
    if (state.pollForced || typeof window.EventSource !== 'function') { startPolling(); return; }
    connectSSE();
  }
  function connectSSE() {
    if (state.mode !== 'http' || state.pollForced) { startPolling(); return; }
    if (es) return;
    if (typeof window.EventSource !== 'function') { startPolling(); return; }
    if (state.transport !== 'polling') setConn('connecting');
    try { es = new EventSource('api/events'); } catch (e) { startPolling(); return; }
    sseOpened = false;
    scheduleWatchdog();
    es.addEventListener('open', function () {
      sseOpened = true;
      clearWatchdog();
      sseFailures = 0;
      stopPolling();
      setConn('live');
      flushOutbox();
      schedulePresence(true);
    });
    es.addEventListener('hello', function (ev) {
      sseOpened = true;
      clearWatchdog();
      sseFailures = 0;
      stopPolling();
      handleSseMessage(ev.data);
      setConn('live');
      flushOutbox();
    });
    es.addEventListener('message', function (ev) { handleSseMessage(ev.data); });
    var named = ['card.upsert', 'card.delete', 'course.update', 'presence'];
    for (var i = 0; i < named.length; i++) {
      (function (type) {
        es.addEventListener(type, function (ev) { handleSseMessage(ev.data || '{"type":"' + type + '"}'); });
      })(named[i]);
    }
    es.addEventListener('error', function () {
      closeSSE();
      clearWatchdog();
      sseFailures += 1;
      startPolling();
      scheduleSseRetry();
    });
  }
  function startPolling() {
    if (state.mode !== 'http') return;
    if (state.transport === 'polling') { schedulePoll(POLL_INTERVAL); scheduleSseRetry(); return; }
    state.transport = 'polling';
    clearWatchdog();
    setConn(navigator.onLine ? 'polling' : 'offline');
    schedulePoll(0);
    scheduleSseRetry();
  }
  function stopPolling() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = 0; }
    if (sseRetryTimer) { clearTimeout(sseRetryTimer); sseRetryTimer = 0; }
    state.transport = 'sse';
  }
  function schedulePoll(delay) {
    if (state.mode !== 'http' || state.transport !== 'polling') return;
    if (pollTimer) return;
    pollTimer = setTimeout(runPoll, typeof delay === 'number' ? delay : POLL_INTERVAL);
  }
  function runPoll() {
    pollTimer = 0;
    if (state.mode !== 'http' || state.transport !== 'polling') return;
    if (document.hidden || pollBusy) { schedulePoll(POLL_INTERVAL); return; }
    if (drag.active) { schedulePoll(600); return; }
    pollBusy = true;
    fetchState().then(function (data) {
      pollBusy = false;
      applyServerState(data);
      renderAll();
      populateCourseFilter();
      queueCacheSave();
      flushOutbox();
      setConn('polling');
      schedulePoll(POLL_INTERVAL);
    }).catch(function () {
      pollBusy = false;
      setConn('offline');
      schedulePoll(POLL_INTERVAL_OFFLINE);
    });
  }
  function scheduleSseRetry() {
    if (state.mode !== 'http' || state.transport !== 'polling') return;
    if (sseRetryTimer) return;
    sseRetryTimer = setTimeout(function () {
      sseRetryTimer = 0;
      if (state.mode === 'http' && state.transport === 'polling') { sseFailures = 0; connectSSE(); }
    }, SSE_RETRY_POLLING);
  }
  function handleSseMessage(raw) {
    var data = null;
    try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return; }
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
    if (isFiniteNum(data.rev)) state.rev = data.rev;
    switch (data.type) {
      case 'hello':
        stopPolling();
        state.presenceAvailable = true;
        if (data.state && typeof data.state === 'object') applyServerState(data.state);
        if (Array.isArray(data.users)) { state.users = normaliseUsers(data.users); renderPresence(); }
        renderAll();
        queueCacheSave();
        break;
      case 'card.upsert':
        handleRemoteUpsert(data.card);
        break;
      case 'card.delete':
        handleRemoteDelete(data.id);
        break;
      case 'course.update':
        if (data.course && typeof data.course === 'object') {
          state.course = normaliseCourse(data.course);
          renderChrome();
          queueCacheSave();
        }
        break;
      case 'presence':
        state.presenceAvailable = true;
        if (Array.isArray(data.users)) { state.users = normaliseUsers(data.users); renderPresence(); }
        break;
      default:
        break;
    }
  }
  function handleRemoteUpsert(raw) {
    var incoming = normaliseCard(raw);
    if (!incoming) return;
    var local = getCard(incoming.id);
    var localUpdated = local ? Date.parse(local.updatedAt || '') : NaN;
    var remoteUpdated = Date.parse(incoming.updatedAt || '');
    if (local && isFinite(localUpdated) && isFinite(remoteUpdated) && localUpdated > remoteUpdated) {
      /* our own newer write is still in flight - keep local copy */
      return;
    }
    state.pendingCards.delete(incoming.id);
    var isNewPoster = !posterNodes.has(incoming.id);
    if (!putCard(incoming)) return;
    if (isNewPoster) renderWall(); else updatePoster(incoming.id);
    renderStats();
    renderRail();
    state.agendaDirty = true;
    if (state.view === 'agenda') renderAgenda();
    if (drawer.id === incoming.id && !drawerHasFocus()) {
      fillDrawer(incoming);
      renderDrawerMeta(incoming);
    }
    queueCacheSave();
    updateEmptyState();
  }
  function handleRemoteDelete(id) {
    if (typeof id !== 'string') return;
    if (!dropCard(id)) return;
    removePosterNode(id);
    if (drawer.id === id) closeDrawer({ flush: false });
    renderStats();
    renderRail();
    state.agendaDirty = true;
    if (state.view === 'agenda') renderAgenda();
    updateEmptyState();
    queueCacheSave();
  }

  /* ---------------------------- card normalisers -------------------------- */
  function safeLink(v) {
    var s = str(v, 500).trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s) || /^mailto:/i.test(s)) return s;
    return '';
  }
  function normaliseDue(v) {
    if (typeof v !== 'string') return null;
    var s = v.trim().slice(0, 40);
    if (!s) return null;
    var t = Date.parse(s);
    return isFinite(t) ? s : null;
  }
  function normaliseReqs(list) {
    if (!Array.isArray(list)) return [];
    var out = [], seen = new Set();
    for (var i = 0; i < list.length && out.length < MAX_REQS; i++) {
      var raw = list[i];
      var req = {};
      if (raw && typeof raw === 'object') {
        var id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 48) : makeId('r');
        if (seen.has(id)) id = makeId('r');
        seen.add(id);
        req.id = id;
        req.text = str(raw.text, REQ_MAX);
        req.done = raw.done === true;
      } else if (typeof raw === 'string') {
        var rid = makeId('r');
        seen.add(rid);
        req.id = rid;
        req.text = str(raw, REQ_MAX);
        req.done = false;
      } else { continue; }
      out.push(req);
    }
    return out;
  }
  function normaliseCard(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var out = {};
    var k;
    /* preserve unknown JSON-ish fields so a round-trip never loses server data */
    for (k in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      var v = raw[k];
      if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    }
    var id = typeof raw.id === 'string' ? raw.id.trim() : '';
    out.id = (id || makeId('c')).slice(0, 64);
    out.title = str(raw.title, TITLE_MAX).trim() || 'Untitled poster';
    out.type = TYPES.indexOf(raw.type) >= 0 ? raw.type : 'assignment';
    out.course = str(raw.course, 60);
    out.kind = str(raw.kind, 60);
    out.due = normaliseDue(raw.due);
    out.weight = str(raw.weight, 24);
    out.brief = str(raw.brief, TEXT_MAX);
    out.notes = str(raw.notes, TEXT_MAX);
    out.link = safeLink(raw.link);
    out.requirements = normaliseReqs(raw.requirements);
    out.w = num(raw.w, CARD_W_DEFAULT, CARD_W_MIN, CARD_W_MAX);
    out.x = clamp(snap(num(raw.x, 70, -100000, 100000)), 0, CANVAS_W - out.w);
    out.y = clamp(snap(num(raw.y, 90, -100000, 100000)), 0, CANVAS_H - CARD_H_GUESS);
    out.rot = num(raw.rot, 0, -3, 3);
    out.z = Math.round(num(raw.z, 1, 1, 1000000));
    out.color = COLORS.indexOf(raw.color) >= 0 ? raw.color : 'bone';
    out.mode = raw.mode === 'group' ? 'group' : 'individual';
    out.done = raw.done === true;
    out.createdAt = typeof raw.createdAt === 'string' ? raw.createdAt.slice(0, 40) : nowIso();
    out.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt.slice(0, 40) : nowIso();
    return out;
  }
  function normaliseCourse(raw) {
    var course = {
      title: 'MAS WALL',
      subtitle: 'Assignments, presentations & everything due',
      term: ''
    };
    if (raw && typeof raw === 'object') {
      if (typeof raw.title === 'string' && raw.title.trim()) course.title = limit(raw.title.trim(), 80);
      if (typeof raw.subtitle === 'string') course.subtitle = limit(raw.subtitle.trim(), 160);
      if (typeof raw.term === 'string') course.term = limit(raw.term.trim(), 80);
    }
    return course;
  }
  function normaliseUsers(list) {
    if (!Array.isArray(list)) return [];
    var out = [], seen = new Set();
    for (var i = 0; i < list.length && out.length < 60; i++) {
      var u = list[i];
      if (!u || typeof u !== 'object') continue;
      var id = typeof u.id === 'string' ? u.id.slice(0, 64) : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id: id,
        name: str(u.name, 40) || 'Guest',
        color: /^#[0-9a-fA-F]{6}$/.test(u.color || '') ? u.color : USER_COLORS[0],
        x: num(u.x, 0, -10000, 10000),
        y: num(u.y, 0, -10000, 10000),
        cardId: typeof u.cardId === 'string' ? u.cardId.slice(0, 64) : null
      });
    }
    return out;
  }
  function cloneCard(card) {
    try { return JSON.parse(JSON.stringify(card)); } catch (e) { return null; }
  }

  /* ------------------------------ card store ------------------------------ */
  function getCard(id) { return state.index.get(id) || null; }
  function putCard(card) {
    if (!card || !card.id) return false;
    var prev = state.index.get(card.id);
    if (prev) {
      var at = state.cards.indexOf(prev);
      if (at >= 0) state.cards[at] = card; else state.cards.push(card);
    } else {
      if (state.cards.length >= MAX_CARDS) return false;
      state.cards.push(card);
    }
    state.index.set(card.id, card);
    return true;
  }
  function dropCard(id) {
    var card = state.index.get(id);
    if (!card) return false;
    state.index.delete(id);
    var at = state.cards.indexOf(card);
    if (at >= 0) state.cards.splice(at, 1);
    state.pendingCards.delete(id);
    return true;
  }
  function nextZ() {
    var max = 0;
    for (var i = 0; i < state.cards.length; i++) if (state.cards[i].z > max) max = state.cards[i].z;
    return Math.min(max + 1, 1000000);
  }
  function overlayPendingCards() {
    if (!state.pendingCards.size) return;
    var it = state.pendingCards.entries();
    var step = it.next();
    while (!step.done) {
      var id = step.value[0], card = step.value[1];
      var existing = state.index.get(id);
      if (existing) {
        var at = state.cards.indexOf(existing);
        if (at >= 0) { state.cards[at] = card; state.index.set(id, card); }
      } else if (state.cards.length < MAX_CARDS) {
        state.cards.push(card);
        state.index.set(id, card);
      }
      step = it.next();
    }
  }
  function applyServerState(data) {
    if (!data || typeof data !== 'object') return;
    if (isFiniteNum(Number(data.rev))) state.rev = Number(data.rev);
    if (data.course && typeof data.course === 'object') state.course = normaliseCourse(data.course);
    if (Array.isArray(data.cards)) {
      var cards = [], seen = new Set();
      for (var i = 0; i < data.cards.length && cards.length < MAX_CARDS; i++) {
        var c = normaliseCard(data.cards[i]);
        if (!c || seen.has(c.id)) continue;
        seen.add(c.id);
        cards.push(c);
      }
      state.cards = cards;
      state.index = new Map();
      for (var j = 0; j < cards.length; j++) state.index.set(cards[j].id, cards[j]);
      if (state.pendingCards.size) {
        state.pendingCards.forEach(function (pending, id) {
          var serverCard = state.index.get(id);
          if (!serverCard) return;
          var st = Date.parse(serverCard.updatedAt || '');
          var pt = Date.parse(pending.updatedAt || '');
          if (isFinite(st) && isFinite(pt) && st >= pt) state.pendingCards.delete(id);
        });
      }
    }
    overlayPendingCards();
  }

  /* --------------------------- localStorage cache ------------------------- */
  let cacheTimer = 0;
  function queueCacheSave() {
    if (cacheTimer) return;
    cacheTimer = setTimeout(function () { cacheTimer = 0; saveCache(); }, 300);
  }
  function saveCache() {
    var payload = {
      rev: state.rev,
      course: state.course,
      cards: state.cards,
      ts: Date.now()
    };
    writeJSON(CACHE_KEY, payload);
    writeJSON(OUTBOX_KEY, state.outbox.slice(-100));
  }
  function readCache() {
    var cached = readJSON(CACHE_KEY);
    if (!cached || typeof cached !== 'object') return null;
    if (!Array.isArray(cached.cards)) return null;
    return cached;
  }

  /* ------------------------------- rendering ------------------------------ */
  function renderAll() {
    renderChrome();
    renderStats();
    renderRail();
    renderWall();
    if (state.view === 'agenda') renderAgenda();
    state.agendaDirty = false;
  }
  function renderChrome() {
    var c = state.course;
    if (ui.wallTitle) ui.wallTitle.textContent = c.title;
    if (ui.wallSubtitle) ui.wallSubtitle.textContent = c.subtitle;
    if (ui.wallTerm) {
      ui.wallTerm.textContent = c.term || '';
      ui.wallTerm.hidden = !c.term;
    }
    if (ui.brandMark && !ui.brandMark.textContent) ui.brandMark.textContent = 'MAS';
    document.title = c.title + (c.term ? ' - ' + c.term : '');
  }
  function renderStats() {
    var total = state.cards.length;
    var done = 0, late = 0, now = Date.now();
    for (var i = 0; i < state.cards.length; i++) {
      var card = state.cards[i];
      if (card.done) { done++; continue; }
      var t = dueMs(card);
      if (isFinite(t) && t < now) late++;
    }
    var text = total + (total === 1 ? ' poster' : ' posters') + ' \u00b7 ' + done + ' done';
    if (late > 0) text += ' \u00b7 ' + late + ' late';
    if (ui.wallStats) ui.wallStats.textContent = text;
  }
  function visibleCards() {
    var out = [];
    for (var i = 0; i < state.cards.length; i++) {
      if (matchesFilters(state.cards[i])) out.push(state.cards[i]);
    }
    out.sort(function (a, b) { return a.z - b.z; });
    if (out.length > MAX_RENDERED) out = out.slice(0, MAX_RENDERED);
    return out;
  }
  function searchText(card) {
    var parts = [card.title, card.course, card.kind, card.brief, card.notes];
    for (var i = 0; i < card.requirements.length; i++) parts.push(card.requirements[i].text);
    return parts.join(' ').toLowerCase();
  }
  function matchesFilters(card) {
    var f = state.filters;
    if (f.type !== 'all' && card.type !== f.type) return false;
    if (f.course !== 'all' && card.course !== f.course) return false;
    var now = Date.now();
    if (f.status === 'open' && card.done) return false;
    if (f.status === 'done' && !card.done) return false;
    if (f.status === 'late') {
      if (card.done) return false;
      var lt = dueMs(card);
      if (!isFinite(lt) || lt >= now) return false;
    }
    if (f.status === 'week') {
      if (card.done) return false;
      var wt = dueMs(card);
      if (!isFinite(wt) || wt < now) return false;
      var wd = dayDelta(wt, now);
      if (wd > 7) return false;
    }
    var q = String(f.q || '').trim().toLowerCase();
    if (q && searchText(card).indexOf(q) === -1) return false;
    return true;
  }
  function buildPoster(card) {
    var art = el('article', 'poster');
    art.dataset.id = card.id;
    art.dataset.type = card.type;
    art.dataset.color = card.color;

    var tape = el('div', 'poster-tape');
    tape.setAttribute('aria-hidden', 'true');

    var head = el('header', 'poster-head');
    var kicker = el('span', 'poster-kicker');
    var courseEl = el('span', 'poster-course');
    var kindEl = el('span', 'poster-kind');
    var modeEl = el('span', 'poster-mode');
    modeEl.dataset.mode = card.mode === 'group' ? 'group' : 'individual';
    modeEl.textContent = card.mode === 'group' ? 'Group' : 'Individual';
    kicker.appendChild(courseEl);
    kicker.appendChild(kindEl);
    kicker.appendChild(modeEl);
    var openBtn = iconBtn('poster-open', 'Open details', '\u22ef');
    openBtn.dataset.action = 'open';
    head.appendChild(kicker);
    head.appendChild(openBtn);

    var title = el('h2', 'poster-title');
    title.tabIndex = 0;

    var due = el('div', 'poster-due');
    var dueDay = el('span', 'due-day');
    var dueMonth = el('span', 'due-month');
    var dueCount = el('span', 'due-count');
    due.appendChild(dueDay);
    due.appendChild(dueMonth);
    due.appendChild(dueCount);

    var brief = el('p', 'poster-brief');
    var reqs = el('ul', 'poster-reqs');

    var foot = el('footer', 'poster-foot');
    var weight = el('span', 'poster-weight');
    var prog = el('span', 'poster-progress');
    var ring = el('span', 'ring');
    var pct = el('span', 'poster-pct');
    prog.appendChild(ring);
    prog.appendChild(pct);
    foot.appendChild(weight);
    foot.appendChild(prog);

    art.appendChild(tape);
    art.appendChild(head);
    art.appendChild(title);
    art.appendChild(due);
    art.appendChild(brief);
    art.appendChild(reqs);
    art.appendChild(foot);

    art.__refs = {
      course: courseEl, kind: kindEl, mode: modeEl, title: title, due: due, dueDay: dueDay,
      dueMonth: dueMonth, dueCount: dueCount, brief: brief, reqs: reqs,
      weight: weight, prog: prog, pct: pct
    };
    return art;
  }
  function buildPosterReqRow(req) {
    var li = el('li', 'req');
    li.dataset.reqId = req.id;
    var label = el('label', 'req-label');
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.reqId = req.id;
    input.checked = !!req.done;
    var box = el('span', 'req-box');
    var text = el('span', 'req-text');
    text.textContent = req.text;
    label.appendChild(input);
    label.appendChild(box);
    label.appendChild(text);
    li.appendChild(label);
    li.classList.toggle('is-done', !!req.done);
    return li;
  }
  function updatePoster(id) {
    var node = posterNodes.get(id);
    var card = getCard(id);
    if (!node || !card) return;
    var refs = node.__refs;
    var now = Date.now();

    node.style.left = card.x + 'px';
    node.style.top = card.y + 'px';
    node.style.width = card.w + 'px';
    node.style.setProperty('--rot', card.rot + 'deg');
    node.style.setProperty('--z', String(card.z));
    node.dataset.type = card.type;
    node.dataset.color = card.color;
    node.classList.toggle('is-done', card.done);

    refs.course.textContent = card.course;
    refs.kind.textContent = card.kind;
    refs.course.hidden = !card.course;
    refs.kind.hidden = !card.kind;
    if (refs.mode) {
      refs.mode.dataset.mode = card.mode === 'group' ? 'group' : 'individual';
      refs.mode.textContent = card.mode === 'group' ? 'Group' : 'Individual';
    }
    refs.title.textContent = card.title;

    var urgency = urgencyOf(card, now);
    refs.due.dataset.urgency = urgency;
    var parts = isFinite(dueMs(card)) ? yangonParts(dueMs(card)) : null;
    refs.dueDay.textContent = parts ? pad2(parts.d) : '\u2014';
    refs.dueMonth.textContent = parts ? MONTHS[parts.m - 1] : 'TBD';
    refs.dueCount.textContent = dueText(card, now);

    refs.brief.textContent = card.brief;
    refs.brief.hidden = !card.brief;

    refs.weight.textContent = card.weight;
    refs.weight.hidden = !card.weight;

    var total = card.requirements.length;
    var doneCount = 0;
    for (var i = 0; i < total; i++) if (card.requirements[i].done) doneCount++;
    refs.pct.textContent = total ? (doneCount + '/' + total) : '\u2013';
    refs.prog.style.setProperty('--p', total ? String(Math.round((doneCount / total) * 100)) : '0');

    syncPosterReqs(node, card);
  }
  function syncPosterReqs(node, card) {
    var host = node.__refs.reqs;
    var wanted = card.requirements.slice(0, MAX_POSTER_REQS);
    var existing = host.children;
    var keep = wanted.length;
    var extra = card.requirements.length - wanted.length;
    while (existing.length > keep) host.removeChild(host.lastChild);
    for (var i = 0; i < wanted.length; i++) {
      var req = wanted[i];
      var row = existing[i];
      if (!row) {
        row = buildPosterReqRow(req);
        host.appendChild(row);
        continue;
      }
      if (row.dataset.reqId !== req.id) {
        row.dataset.reqId = req.id;
        var input = row.querySelector('input');
        if (input) input.dataset.reqId = req.id;
      }
      row.classList.toggle('is-done', !!req.done);
      var boxEl = row.querySelector('.req-text');
      if (boxEl && boxEl.textContent !== req.text) boxEl.textContent = req.text;
      var check = row.querySelector('input');
      if (check && document.activeElement !== check) check.checked = !!req.done;
    }
    if (extra > 0) {
      var more = el('li', 'req req-more');
      more.textContent = '+' + extra + ' more';
      host.appendChild(more);
    }
  }
  function removePosterNode(id) {
    var node = posterNodes.get(id);
    if (!node) return;
    if (node.parentNode) node.parentNode.removeChild(node);
    posterNodes.delete(id);
  }
  function renderWall() {
    var canvas = ui.wallCanvas;
    if (!canvas) return;
    var list = visibleCards();
    var keep = new Set();
    for (var i = 0; i < list.length; i++) {
      var card = list[i];
      keep.add(card.id);
      var node = posterNodes.get(card.id);
      if (!node) {
        node = buildPoster(card);
        posterNodes.set(card.id, node);
        canvas.appendChild(node);
      }
      updatePoster(card.id);
    }
    var stale = [];
    posterNodes.forEach(function (node, id) { if (!keep.has(id)) stale.push(id); });
    for (var j = 0; j < stale.length; j++) removePosterNode(stale[j]);
    updateEmptyState(list.length);
  }
  function updateEmptyState(count) {
    var empty = ui.wallEmpty;
    if (!empty) return;
    if (typeof count !== 'number') count = visibleCards().length;
    var hasAny = state.cards.length > 0;
    empty.hidden = count > 0;
    var filtered = hasAny && count === 0;
    empty.dataset.reason = filtered ? 'filtered' : 'none';
    empty.dataset.count = String(count);
    var kicker = empty.querySelector('.wall-empty-kicker');
    var title = empty.querySelector('.wall-empty-title');
    var copy = empty.querySelector('.wall-empty-copy');
    var hint = empty.querySelector('.wall-empty-hint');
    if (filtered) {
      if (kicker) kicker.textContent = 'No matches';
      if (title) title.textContent = 'Nothing matches.';
      if (copy) copy.textContent = 'Clear the search or switch the filters to bring the posters back — nothing has been deleted.';
      if (hint) hint.hidden = true;
    } else {
      if (kicker) kicker.textContent = 'Nothing pinned yet';
      if (title) title.textContent = 'Bare wall.';
      if (copy) copy.textContent = 'Pin your first assignment or presentation. Drag it anywhere, tick the requirements as you go — everyone on the link sees it move.';
      if (hint) hint.hidden = false;
    }
  }
  function renderRail() {
    var rail = ui.deadlineRail;
    if (!rail) return;
    var now = Date.now();
    var upcoming = [];
    for (var i = 0; i < state.cards.length; i++) {
      var card = state.cards[i];
      var t = dueMs(card);
      if (card.done || !isFinite(t)) continue;
      /* the strip is "NEXT UP": overdue cards stay on the wall/agenda, not here */
      if (dayDelta(t, now) < 0) continue;
      upcoming.push(card);
    }
    upcoming.sort(function (a, b) { return dueMs(a) - dueMs(b); });
    upcoming = upcoming.slice(0, 8);
    rail.textContent = '';
    if (upcoming.length === 0) {
      rail.hidden = true;
      if (ui.deadlineStrip) ui.deadlineStrip.hidden = true;
      return;
    }
    rail.hidden = false;
    if (ui.deadlineStrip) ui.deadlineStrip.hidden = false;
    for (var j = 0; j < upcoming.length; j++) {
      rail.appendChild(buildRailItem(upcoming[j], now));
    }
  }
  function buildRailItem(card, now) {
    var item = el('a', 'rail-item');
    item.dataset.id = card.id;
    item.dataset.urgency = urgencyOf(card, now);
    item.setAttribute('role', 'listitem');
    item.tabIndex = 0;
    var parts = yangonParts(dueMs(card));
    var day = el('span', 'rail-day');
    day.textContent = pad2(parts.d);
    var month = el('span', 'rail-month');
    month.textContent = MONTHS[parts.m - 1];
    var title = el('span', 'rail-title');
    title.textContent = card.title;
    var course = el('span', 'rail-course');
    course.textContent = card.course || card.kind || card.type;
    var when = el('span', 'rail-when');
    when.textContent = dueText(card, now);
    item.appendChild(day);
    item.appendChild(month);
    item.appendChild(title);
    item.appendChild(course);
    item.appendChild(when);
    item.setAttribute('aria-label', card.title + ' - ' + dueText(card, now));
    return item;
  }
  function renderAgenda() {
    var host = ui.agendaGroups;
    if (!host) return;
    var now = Date.now();
    var list = visibleCards();
    var months = {};
    var monthOrder = [];
    var noDate = [];
    var doneItems = [];
    for (var i = 0; i < list.length; i++) {
      var card = list[i];
      if (card.done) { doneItems.push(card); continue; }
      var t = dueMs(card);
      if (!isFinite(t)) { noDate.push(card); continue; }
      var p = yangonParts(t);
      var key = p.y + '-' + pad2(p.m);
      if (!months[key]) { months[key] = { y: p.y, m: p.m, items: [] }; monthOrder.push(key); }
      months[key].items.push(card);
    }
    monthOrder.sort();
    host.textContent = '';
    var any = false;
    for (var k = 0; k < monthOrder.length; k++) {
      var group = months[monthOrder[k]];
      group.items.sort(function (a, b) { return dueMs(a) - dueMs(b); });
      any = true;
      host.appendChild(buildAgendaGroup(MONTHS_FULL[group.m - 1] + ' ' + group.y, group.items, now, false));
    }
    if (noDate.length) {
      any = true;
      noDate.sort(function (a, b) { return a.title.localeCompare(b.title); });
      host.appendChild(buildAgendaGroup('No date', noDate, now, false));
    }
    if (doneItems.length) {
      any = true;
      doneItems.sort(function (a, b) { return Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''); });
      host.appendChild(buildAgendaGroup('Done', doneItems, now, true));
    }
    if (!any) {
      var empty = el('p', 'agenda-empty');
      empty.textContent = state.cards.length ? 'No posters match these filters.' : 'Nothing on the wall yet - add your first poster.';
      host.appendChild(empty);
    }
    state.agendaDirty = false;
  }
  function buildAgendaGroup(labelText, items, now, isDone) {
    var sec = el('section', 'agenda-group');
    var head = el('h3', 'agenda-head');
    var label = el('span', 'agenda-label');
    label.textContent = labelText;
    var total = el('span', 'agenda-total');
    total.textContent = items.length + (items.length === 1 ? ' poster' : ' posters');
    head.appendChild(label);
    head.appendChild(total);
    var ol = el('ol', 'agenda-list');
    for (var i = 0; i < items.length; i++) ol.appendChild(buildAgendaItem(items[i], now, isDone));
    sec.appendChild(head);
    sec.appendChild(ol);
    return sec;
  }
  function buildAgendaItem(card, now, isDone) {
    var li = el('li', 'agenda-item');
    li.dataset.id = card.id;
    li.dataset.type = card.type;
    li.dataset.urgency = isDone ? 'done' : urgencyOf(card, now);
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-label', 'Open ' + card.title);
    var t = dueMs(card);
    var parts = isFinite(t) ? yangonParts(t) : null;
    var day = el('span', 'agenda-day');
    day.textContent = parts ? pad2(parts.d) : '\u2014';
    var body = el('span', 'agenda-body');
    var title = el('span', 'agenda-title');
    title.textContent = card.title;
    var bits = [];
    if (card.course) bits.push(card.course);
    if (card.kind) bits.push(card.kind);
    bits.push(card.mode === 'group' ? 'Group' : 'Solo');
    if (card.weight) bits.push(card.weight);
    var meta = el('span', 'agenda-meta');
    meta.textContent = bits.join(' \u00b7 ');
    body.appendChild(title);
    body.appendChild(meta);
    var stateEl = el('span', 'agenda-state');
    var total = card.requirements.length;
    var done = 0;
    for (var i = 0; i < total; i++) if (card.requirements[i].done) done++;
    stateEl.textContent = isDone ? 'done' : (total ? (done + '/' + total + ' done') : dueText(card, now));
    li.appendChild(day);
    li.appendChild(body);
    li.appendChild(stateEl);
    return li;
  }
  function renderPresence() {
    var me = state.me;
    if (!me) return;
    var users = Array.isArray(state.users) ? state.users : [];
    var self = null, others = [];
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      if (u.id === me.id) self = u; else others.push(u);
    }
    if (!self) self = { id: me.id, name: me.name, color: me.color, cardId: drawer.id || null };

    var host = ui.presenceList;
    var available = state.presenceAvailable !== false;
    if (host) {
      host.hidden = !available;
      host.textContent = '';
      if (available) {
        var tag = listTagFor(host);
        var frag = document.createDocumentFragment();
        frag.appendChild(buildAvatar(self, true, tag));
        var shown = 1;
        for (var j = 0; j < others.length && shown < 8; j++, shown++) frag.appendChild(buildAvatar(others[j], false, tag));
        var rest = others.length - Math.min(others.length, 7);
        if (rest > 0) {
          var more = el(tag, 'presence-more');
          more.textContent = '+' + rest;
          frag.appendChild(more);
        }
        host.appendChild(frag);
      }
    }
    if (ui.presenceCount) {
      if (!available) ui.presenceCount.textContent = 'just you';
      else {
        var n = Math.max(1, users.length || 1);
        ui.presenceCount.textContent = n + ' online';
      }
    }
    updateMeButton();
  }
  function buildAvatar(user, isMe, tag) {
    var node = el(tag || 'li', 'presence-avatar');
    node.dataset.userId = user.id;
    if (isMe) node.classList.add('is-me');
    node.style.background = user.color;
    node.textContent = initialOf(user.name);
    node.setAttribute('role', 'img');
    var label = user.name;
    if (user.cardId) {
      var card = getCard(user.cardId);
      if (card) label += ' - editing ' + card.title;
    }
    node.setAttribute('aria-label', label);
    node.title = label;
    return node;
  }
  function initialOf(name) {
    var s = String(name || '?').trim();
    return s ? s.charAt(0).toUpperCase() : '?';
  }
  function updateMeButton() {
    var btn = ui.btnMe;
    var me = state.me;
    if (!btn || !me) return;
    var label = btn.querySelector('.btn-label, .btn-me-name, .me-name, .presence-name');
    if (label) label.textContent = me.name; else btn.textContent = me.name;
    btn.dataset.name = me.name;
    btn.dataset.initial = initialOf(me.name);
    btn.title = me.name + ' - click to change your name';
    btn.style.setProperty('--user-color', me.color);
  }
  function setView(view) {
    state.view = view === 'agenda' ? 'agenda' : 'wall';
    if (ui.wallView) ui.wallView.hidden = state.view !== 'wall';
    if (ui.agendaView) ui.agendaView.hidden = state.view !== 'agenda';
    if (state.view === 'agenda') renderAgenda();
    updateViewButtons();
    document.documentElement.dataset.view = state.view;
    try { window.localStorage.setItem(VIEW_KEY, state.view); } catch (e) {}
  }
  function updateViewButtons() {
    var host = ui.viewToggle;
    if (!host) return;
    var btns = host.querySelectorAll('[data-view]');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].dataset.view === state.view;
      btns[i].classList.toggle('is-active', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  function toggleView() { setView(state.view === 'wall' ? 'agenda' : 'wall'); }

  /* -------------------------------- drawer -------------------------------- */
  function setSaveState(kind) {
    var node = ui.drawerSaveState;
    if (!node) return;
    node.dataset.state = kind || 'idle';
    node.classList.toggle('is-saving', kind === 'saving');
    node.classList.toggle('is-saved', kind === 'saved');
    node.classList.toggle('is-error', kind === 'error');
    node.textContent =
      kind === 'saving' ? 'Saving\u2026' :
      kind === 'saved' ? 'Saved' :
      kind === 'offline' ? 'Saved on this device' :
      kind === 'error' ? 'Could not save' : 'Saved';
    if (drawer.stateTimer) clearTimeout(drawer.stateTimer);
    if (kind === 'saved') {
      drawer.stateTimer = setTimeout(function () {
        drawer.stateTimer = 0;
        if (ui.drawerSaveState && ui.drawerSaveState.dataset.state === 'saved') setSaveState('idle');
      }, 2200);
    }
  }
  function drawerHasFocus() {
    var d = ui.drawer;
    if (!d) return false;
    var a = document.activeElement;
    return !!(a && d.contains(a));
  }
  function firstFocusable(host) {
    if (!host) return null;
    var nodes = host.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.offsetParent === null && n.getClientRects().length === 0) continue;
      if (n.type === 'hidden') continue;
      return n;
    }
    return null;
  }
  /* keep the page behind the modal drawer out of the tab order / a11y tree */
  function setPageInert(on) {
    ['masthead', 'deadlineStrip', 'toolbar', 'stage'].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.inert = !!on;
    });
  }

  /* view mode: the drawer opens as a read-only preview (agenda/rail taps); the Edit
     button flips the same drawer into the autosaving editor */
  function applyDrawerMode(mode) {
    drawer.mode = mode === 'view' ? 'view' : 'edit';
    var view = drawer.mode === 'view';
    if (!ui.drawer) return;
    ui.drawer.classList.toggle('is-view', view);
    if (ui.drawerEditBtn) ui.drawerEditBtn.hidden = !view;
    if (ui.drawerForm) {
      var controls = ui.drawerForm.querySelectorAll('input, select, textarea, button');
      for (var i = 0; i < controls.length; i++) {
        var c = controls[i];
        if (c.tagName === 'BUTTON') { c.disabled = view; continue; }
        if (c.tagName === 'TEXTAREA' || (c.tagName === 'INPUT' && (c.type === 'text' || c.type === 'url'))) {
          c.readOnly = view;
          c.disabled = false;
        } else {
          c.disabled = view;
        }
      }
    }
    /* a clean preview only shows fields that actually have content */
    var optional = [
      ui.drawerCourseInput, ui.drawerKindInput, ui.drawerWeightInput,
      ui.drawerBriefInput, ui.drawerNotesInput, ui.drawerLinkInput
    ];
    for (var k = 0; k < optional.length; k++) {
      var elm = optional[k];
      if (!elm || !elm.closest) continue;
      var field = elm.closest('.field');
      if (field) field.hidden = view && !String(elm.value || '').trim();
    }
    if (ui.btnAddReq) ui.btnAddReq.disabled = view;
    if (ui.drawerSaveState) ui.drawerSaveState.hidden = view;
    if (ui.btnDuplicateCard) ui.btnDuplicateCard.disabled = view;
    if (ui.btnDeleteCard) ui.btnDeleteCard.disabled = view;
    if (view) setSaveState('idle');
    sizeViewTextareas(view);
  }

  function sizeViewTextareas(view) {
    var areas = [ui.drawerBriefInput, ui.drawerNotesInput];
    for (var i = 0; i < areas.length; i++) {
      var area = areas[i];
      if (!area) continue;
      if (view) {
        area.style.minHeight = '0';
        area.style.resize = 'none';
        area.style.height = '0px';
        area.style.height = Math.min(area.scrollHeight + 2, 340) + 'px';
      } else {
        area.style.minHeight = '';
        area.style.resize = '';
        area.style.height = '';
      }
    }
  }

  function openDrawer(id, opts) {
    var card = getCard(id);
    if (!card) return;
    hideTrash();
    opts = opts || {};
    if (!state.unlocked) opts.mode = 'view';
    if (!drawer.id) drawer.lastFocus = document.activeElement;
    drawer.id = card.id;
    drawer.color = card.color;
    drawer.done = !!card.done;
    fillDrawer(card);
    renderDrawerMeta(card);
    applyDrawerMode((opts.mode === 'view' || !state.unlocked) ? 'view' : 'edit');
    setSaveState('idle');
    if (ui.drawer) {
      ui.drawer.dataset.cardId = card.id;
      ui.drawer.classList.add('is-open');
      ui.drawer.setAttribute('aria-hidden', 'false');
    }
    if (ui.drawerBackdrop) {
      ui.drawerBackdrop.hidden = false;
      ui.drawerBackdrop.classList.add('is-open');
    }
    document.body.classList.add('drawer-open');
    document.documentElement.dataset.drawer = 'open';
    setPageInert(true);
    schedulePresence(true);
    var focusTarget = opts.mode === 'view'
      ? (ui.drawerClose || ui.drawer)
      : (ui.drawerTitleInput || firstFocusable(ui.drawer));
    var run = function () {
      if (!drawer.id) return;
      var target = (opts.mode !== 'view' && opts.focusTitle && ui.drawerTitleInput) ? ui.drawerTitleInput : focusTarget;
      if (!target || !document.contains(target)) return;
      try { target.focus({ preventScroll: true }); } catch (e) { try { target.focus(); } catch (e2) {} }
      if (opts.focusTitle && opts.selectTitle && typeof target.select === 'function') {
        try { target.select(); } catch (e3) {}
      }
    };
    if (prefersReducedMotion()) {
      run();
    } else {
      requestAnimationFrame(function () { requestAnimationFrame(run); });
      /* the inert fixup can blur the previously focused poster after the first focus;
         refocus once if focus fell back to <body> */
      setTimeout(function () {
        if (!drawer.id) return;
        if (document.activeElement === document.body) run();
      }, 160);
    }
  }
  function closeDrawer(opts) {
    if (!drawer.id) return;
    opts = opts || {};
    if (opts.flush !== false && drawer.saveTimer) flushDrawerSave();
    if (drawer.saveTimer) { clearTimeout(drawer.saveTimer); drawer.saveTimer = 0; }
    drawer.id = null;
    if (ui.drawer) {
      ui.drawer.classList.remove('is-open');
      ui.drawer.setAttribute('aria-hidden', 'true');
      delete ui.drawer.dataset.cardId;
    }
    applyDrawerMode('edit');
    if (ui.drawerBackdrop) {
      ui.drawerBackdrop.classList.remove('is-open');
      ui.drawerBackdrop.hidden = true;
    }
    document.body.classList.remove('drawer-open');
    document.documentElement.dataset.drawer = 'closed';
    setPageInert(false);
    setSaveState('idle');
    schedulePresence(true);
    var back = drawer.lastFocus;
    drawer.lastFocus = null;
    if (back && typeof back.focus === 'function' && document.contains(back)) {
      try { back.focus({ preventScroll: true }); } catch (e) { try { back.focus(); } catch (e2) {} }
    } else if (ui.wallCanvas) {
      var node = posterNodes.get(opts.focusId || '');
      if (node) {
        var btn = node.querySelector('[data-action="open"]');
        if (btn) { try { btn.focus(); } catch (e3) {} }
      }
    }
  }
  function setInput(node, value) {
    if (!node) return;
    var v = value == null ? '' : String(value);
    if (node.tagName === 'SELECT') {
      var ok = false;
      for (var i = 0; i < node.options.length; i++) if (node.options[i].value === v) ok = true;
      if (ok) node.value = v;
      return;
    }
    if (node.value !== v) node.value = v;
  }
  function fillDrawer(card) {
    drawer.color = card.color;
    drawer.done = !!card.done;
    setInput(ui.drawerTitleInput, card.title);
    setInput(ui.drawerTypeSelect, card.type);
    setInput(ui.drawerCourseInput, card.course);
    setInput(ui.drawerKindInput, card.kind);
    setInput(ui.drawerModeSelect, card.mode);
    var due = splitDue(card.due);
    setInput(ui.drawerDueDate, due.date);
    setInput(ui.drawerDueTime, due.time);
    setInput(ui.drawerWeightInput, card.weight);
    setInput(ui.drawerBriefInput, card.brief);
    setInput(ui.drawerNotesInput, card.notes);
    setInput(ui.drawerLinkInput, card.link);
    if (ui.drawerKicker) {
      var bits = [];
      if (card.course) bits.push(card.course);
      if (card.kind) bits.push(card.kind);
      ui.drawerKicker.textContent = bits.length ? bits.join(' \u00b7 ') : 'New poster';
    }
    updateColorSwatches();
    updateDoneToggle();
    fillDrawerReqs(card);
    renderDrawerMeta(card);
  }
  function updateColorSwatches() {
    var host = ui.drawerColorGroup;
    if (!host) return;
    var btns = host.querySelectorAll('[data-color]');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].dataset.color === drawer.color;
      btns[i].classList.toggle('is-active', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  function updateDoneToggle() {
    var node = ui.drawerDoneToggle;
    if (!node) return;
    if (node.tagName === 'INPUT' && node.type === 'checkbox') {
      node.checked = !!drawer.done;
    } else {
      node.setAttribute('aria-pressed', drawer.done ? 'true' : 'false');
      node.classList.toggle('is-active', !!drawer.done);
    }
  }
  function readDoneToggle() {
    var node = ui.drawerDoneToggle;
    if (!node) return !!drawer.done;
    if (node.tagName === 'INPUT' && node.type === 'checkbox') return !!node.checked;
    return node.getAttribute('aria-pressed') === 'true' || node.classList.contains('is-active');
  }
  function fillDrawerReqs(card) {
    var host = ui.drawerReqs;
    if (!host) return;
    host.textContent = '';
    for (var i = 0; i < card.requirements.length; i++) host.appendChild(buildDrawerReqRow(card.requirements[i]));
  }
  function buildDrawerReqRow(req) {
    var row = el('li', 'drawer-req');
    row.dataset.reqId = req.id;
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.reqToggle = '1';
    input.checked = !!req.done;
    input.setAttribute('aria-label', 'Requirement done');
    var text = document.createElement('input');
    text.type = 'text';
    text.className = 'drawer-req-text';
    text.maxLength = REQ_MAX;
    text.value = req.text;
    text.dataset.reqText = '1';
    text.setAttribute('aria-label', 'Requirement text');
    text.setAttribute('placeholder', 'What needs doing?');
    var remove = iconBtn('drawer-req-remove', 'Remove requirement', '\u00d7');
    remove.dataset.reqRemove = '1';
    row.appendChild(input);
    row.appendChild(text);
    row.appendChild(remove);
    row.classList.toggle('is-done', !!req.done);
    return row;
  }
  function reqRowOf(target) {
    var host = ui.drawerReqs;
    if (!host || !target || !target.closest) return null;
    return target.closest('.drawer-req');
  }
  function findReq(card, reqId) {
    for (var i = 0; i < card.requirements.length; i++) if (card.requirements[i].id === reqId) return card.requirements[i];
    return null;
  }
  function syncDrawerReqChecks(card) {
    var host = ui.drawerReqs;
    if (!host) return;
    var rows = host.querySelectorAll('.drawer-req');
    for (var i = 0; i < rows.length; i++) {
      var req = findReq(card, rows[i].dataset.reqId);
      if (!req) continue;
      var check = rows[i].querySelector('input[type="checkbox"]');
      if (check && document.activeElement !== check) check.checked = !!req.done;
      rows[i].classList.toggle('is-done', !!req.done);
    }
  }
  function readDrawerFields(card) {
    var next = cloneCard(card);
    if (!next) return null;
    var title = ui.drawerTitleInput ? str(ui.drawerTitleInput.value, TITLE_MAX).trim() : next.title;
    next.title = title || 'Untitled poster';
    var typeEl = ui.drawerTypeSelect;
    if (typeEl && TYPES.indexOf(typeEl.value) >= 0) next.type = typeEl.value;
    if (ui.drawerCourseInput) next.course = str(ui.drawerCourseInput.value, 60).trim();
    if (ui.drawerKindInput) next.kind = str(ui.drawerKindInput.value, 60).trim();
    if (ui.drawerModeSelect) next.mode = ui.drawerModeSelect.value === 'group' ? 'group' : 'individual';
    if (ui.drawerWeightInput) next.weight = str(ui.drawerWeightInput.value, 24).trim();
    if (ui.drawerBriefInput) next.brief = limit(ui.drawerBriefInput.value, TEXT_MAX);
    if (ui.drawerNotesInput) next.notes = limit(ui.drawerNotesInput.value, TEXT_MAX);
    if (ui.drawerLinkInput) next.link = safeLink(ui.drawerLinkInput.value);
    if (ui.drawerDueDate || ui.drawerDueTime) {
      next.due = composeDue(
        ui.drawerDueDate ? ui.drawerDueDate.value : '',
        ui.drawerDueTime ? ui.drawerDueTime.value : ''
      );
    }
    next.color = drawer.color;
    next.done = readDoneToggle();
    next.updatedAt = nowIso();
    return next;
  }
  function applyDrawerFields() {
    if (!drawer.id) return;
    var card = getCard(drawer.id);
    if (!card) return;
    var next = readDrawerFields(card);
    if (!next) return;
    putCard(next);
    state.pendingCards.set(next.id, next);
    updatePoster(next.id);
    renderStats();
    renderRail();
    renderDrawerMeta(next);
    queueCacheSave();
  }
  function scheduleDrawerSave() {
    if (!drawer.id) return;
    setSaveState('saving');
    if (drawer.saveTimer) clearTimeout(drawer.saveTimer);
    drawer.saveTimer = setTimeout(function () { drawer.saveTimer = 0; flushDrawerSave(); }, SAVE_DEBOUNCE);
  }
  function flushDrawerSave() {
    if (drawer.saveTimer) { clearTimeout(drawer.saveTimer); drawer.saveTimer = 0; }
    if (!drawer.id) return;
    var card = getCard(drawer.id);
    if (!card) return;
    state.pendingCards.set(card.id, card);
    postOp({ op: 'card.upsert', card: cloneCard(card) });
  }
  function renderDrawerMeta(card) {
    var now = Date.now();
    if (ui.drawerDueBadge) {
      ui.drawerDueBadge.dataset.urgency = urgencyOf(card, now);
      ui.drawerDueBadge.textContent = dueText(card, now);
    }
    var total = card.requirements.length;
    var done = 0;
    for (var i = 0; i < total; i++) if (card.requirements[i].done) done++;
    var pct = total ? Math.round((done / total) * 100) : 0;
    var prog = ui.drawerProgress;
    if (prog) {
      prog.style.setProperty('--p', String(pct));
      prog.dataset.done = String(done);
      prog.dataset.total = String(total);
      var label = prog.querySelector('.drawer-progress-label, .progress-label, .poster-pct');
      if (label) label.textContent = done + '/' + total;
      else prog.textContent = done + '/' + total;
    }
  }
  function drawerOnInput(e) {
    if (!drawer.id || drawer.mode === 'view' || !state.unlocked) return;
    var target = e.target;
    if (target && target.closest && target.closest('#drawerReqs')) return;
    if (target && target === ui.drawerDoneToggle) {
      drawer.done = readDoneToggle();
    }
    applyDrawerFields();
    scheduleDrawerSave();
  }
  function drawerOnReqsInput(e) {
    if (!drawer.id) return;
    var card = getCard(drawer.id);
    if (!card) return;
    var row = reqRowOf(e.target);
    if (!row) return;
    var req = findReq(card, row.dataset.reqId);
    if (!req) return;
    var target = e.target;
    if (target && target.dataset && target.dataset.reqText) {
      req.text = str(target.value, REQ_MAX);
    }
    if (target && target.dataset && target.dataset.reqToggle) {
      req.done = !!target.checked;
      row.classList.toggle('is-done', req.done);
      syncPosterReqs(posterNodes.get(card.id) || { __refs: { reqs: document.createElement('ul') } }, card);
      var node = posterNodes.get(card.id);
      if (node) updatePoster(card.id);
    }
    card.updatedAt = nowIso();
    pendingKeep(card);
    renderDrawerMeta(card);
    renderStats();
    renderRail();
    scheduleDrawerSave();
  }
  function pendingKeep(card) { state.pendingCards.set(card.id, card); }
  function drawerOnReqsClick(e) {
    if (!drawer.id) return;
    var btn = e.target && e.target.closest ? e.target.closest('[data-req-remove]') : null;
    if (!btn) return;
    e.preventDefault();
    var row = reqRowOf(btn);
    if (!row) return;
    var card = getCard(drawer.id);
    if (!card) return;
    var reqId = row.dataset.reqId;
    var nextReqs = [];
    for (var i = 0; i < card.requirements.length; i++) if (card.requirements[i].id !== reqId) nextReqs.push(card.requirements[i]);
    card.requirements = nextReqs;
    card.updatedAt = nowIso();
    pendingKeep(card);
    fillDrawerReqs(card);
    renderDrawerMeta(card);
    var node = posterNodes.get(card.id);
    if (node) updatePoster(card.id);
    renderStats();
    renderRail();
    scheduleDrawerSave();
  }

  /* --------------------------- add requirement ---------------------------- */
  function addRequirement() {
    if (!drawer.id) return;
    var card = getCard(drawer.id);
    if (!card) return;
    if (card.requirements.length >= MAX_REQS) { toast('That is the maximum number of requirements'); return; }
    var req = { id: makeId('r'), text: '', done: false };
    card.requirements = card.requirements.concat([req]);
    card.updatedAt = nowIso();
    pendingKeep(card);
    fillDrawerReqs(card);
    renderDrawerMeta(card);
    var node = posterNodes.get(card.id);
    if (node) updatePoster(card.id);
    renderStats();
    renderRail();
    scheduleDrawerSave();
    var host = ui.drawerReqs;
    if (host) {
      var rows = host.querySelectorAll('.drawer-req');
      var last = rows[rows.length - 1];
      if (last) {
        var input = last.querySelector('.drawer-req-text');
        if (input) { try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } }
      }
    }
  }

  /* ------------------------ create / duplicate / delete ------------------- */
  function viewportCenter(w, h) {
    var canvas = ui.wallCanvas;
    if (!canvas) return { x: 96, y: 96 };
    var rect = canvas.getBoundingClientRect();
    var x = (window.innerWidth / 2) - rect.left - (w / 2);
    var y = (window.innerHeight / 2) - rect.top - (h / 2);
    return {
      x: clamp(snap(x), 0, CANVAS_W - w),
      y: clamp(snap(y), 0, CANVAS_H - CARD_H_GUESS)
    };
  }
  function createCard() {
    if (state.cards.length >= MAX_CARDS) { toast('The wall is full (400 posters)'); return; }
    if (state.view !== 'wall') setView('wall');
    var at = viewportCenter(CARD_W_DEFAULT, CARD_H_GUESS);
    var card = {
      id: makeId('c'),
      title: 'Untitled poster',
      type: 'assignment',
      course: '',
      kind: '',
      due: null,
      weight: '',
      brief: '',
      notes: '',
      link: '',
      requirements: [],
      x: at.x,
      y: at.y,
      w: CARD_W_DEFAULT,
      rot: Math.round((Math.random() * 2.4 - 1.2) * 10) / 10,
      z: nextZ(),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      mode: 'individual',
      done: false,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    if (!putCard(card)) { toast('The wall is full (400 posters)'); return; }
    pendingKeep(card);
    renderWall();
    renderStats();
    renderRail();
    queueCacheSave();
    postOp({ op: 'card.upsert', card: cloneCard(card) });
    openDrawer(card.id, { focusTitle: true, selectTitle: true });
    toast('New poster added');
    return card.id;
  }
  function duplicateCard() {
    if (!drawer.id) return;
    var src = getCard(drawer.id);
    if (!src) return;
    if (state.cards.length >= MAX_CARDS) { toast('The wall is full (400 posters)'); return; }
    var copy = cloneCard(src);
    if (!copy) return;
    copy.id = makeId('c');
    copy.title = limit(src.title + ' copy', TITLE_MAX);
    copy.x = clamp(snap(src.x + 28), 0, CANVAS_W - src.w);
    copy.y = clamp(snap(src.y + 28), 0, CANVAS_H - CARD_H_GUESS);
    copy.z = nextZ();
    copy.done = false;
    copy.updatedAt = nowIso();
    copy.createdAt = nowIso();
    var reqs = [];
    for (var i = 0; i < src.requirements.length; i++) {
      reqs.push({ id: makeId('r'), text: src.requirements[i].text, done: false });
    }
    copy.requirements = reqs;
    if (!putCard(copy)) { toast('The wall is full (400 posters)'); return; }
    pendingKeep(copy);
    renderWall();
    renderStats();
    renderRail();
    queueCacheSave();
    postOp({ op: 'card.upsert', card: cloneCard(copy) });
    openDrawer(copy.id, { focusTitle: true });
    toast('Poster duplicated');
  }
  function applyCardDelete(id) {
    if (!id) return;
    dropCard(id);
    removePosterNode(id);
    if (drawer.id === id) closeDrawer({ flush: false });
    renderStats();
    renderRail();
    updateEmptyState();
    state.agendaDirty = true;
    if (state.view === 'agenda') renderAgenda();
    queueCacheSave();
    postOp({ op: 'card.delete', id: id });
  }
  function deleteCard() {
    if (!drawer.id) return;
    var card = getCard(drawer.id);
    if (!card) return;
    var ok = true;
    try { ok = window.confirm('Delete "' + limit(card.title, 60) + '" from the wall? This cannot be undone.'); } catch (e) { ok = true; }
    if (!ok) return;
    var id = card.id;
    applyCardDelete(id);
    toast('Poster deleted');
  }
  function deleteCardWithUndo(card) {
    if (!card || !card.id) return;
    var snapshot = cloneCard(getCard(card.id) || card);
    if (!snapshot) return;
    applyCardDelete(card.id);
    toast('Deleted \u201c' + limit(snapshot.title, 40) + '\u201d', 'ok', {
      label: 'Undo',
      duration: 8000,
      onClick: function () { restoreDeletedCard(snapshot); }
    });
  }
  function restoreDeletedCard(card) {
    var restored = normaliseCard(card);
    if (!restored) return;
    putCard(restored);
    pendingKeep(restored);
    renderWall();
    renderStats();
    renderRail();
    updateEmptyState();
    state.agendaDirty = true;
    if (state.view === 'agenda') renderAgenda();
    queueCacheSave();
    postOp({ op: 'card.upsert', card: cloneCard(restored) });
    toast('Restored \u201c' + limit(restored.title, 40) + '\u201d');
  }
  function toggleRequirement(cardId, reqId, checked) {
    var card = getCard(cardId);
    if (!card) return;
    var req = findReq(card, reqId);
    if (!req) return;
    req.done = !!checked;
    card.updatedAt = nowIso();
    pendingKeep(card);
    updatePoster(card.id);
    if (drawer.id === card.id) {
      syncDrawerReqChecks(card);
      renderDrawerMeta(card);
    }
    renderStats();
    renderRail();
    state.agendaDirty = true;
    if (state.view === 'agenda') renderAgenda();
    queueCacheSave();
    postOp({ op: 'card.upsert', card: cloneCard(card) });
  }

  /* -------------------------------- drag ---------------------------------- */
  function clampCardPosition(card, x, y) {
    var node = posterNodes.get(card.id);
    var h = node ? node.offsetHeight : CARD_H_GUESS;
    var maxY = Math.max(0, CANVAS_H - h);
    return {
      x: clamp(snap(x), 0, Math.max(0, CANVAS_W - card.w)),
      y: clamp(snap(y), 0, maxY)
    };
  }
  function startDragVisual() {
    drag.visual = true;
    drag.node.classList.add('is-dragging');
    drag.node.style.setProperty('--rot', '0deg');
    drag.node.style.setProperty('--z', String(drag.z));
    document.body.classList.add('is-dragging');
    document.documentElement.style.setProperty('--drag-z', String(drag.z));
    if (ui.wallCanvas) ui.wallCanvas.style.userSelect = 'none';
  }
  function endDragVisual() {
    drag.visual = false;
    var node = drag.node;
    if (node) {
      node.classList.remove('is-dragging');
      node.style.removeProperty('user-select');
    }
    document.body.classList.remove('is-dragging');
    if (ui.wallCanvas) ui.wallCanvas.style.removeProperty('user-select');
  }
  function onPointerDown(e) {
    if (!state.unlocked) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (drag.active) return;
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('button, input, label, a, textarea, select, [contenteditable="true"]')) return;
    var node = e.target.closest('.poster');
    if (!node || !ui.wallCanvas || !ui.wallCanvas.contains(node)) return;
    var card = getCard(node.dataset.id);
    if (!card) return;
    drag.active = true;
    drag.visual = false;
    drag.node = node;
    drag.card = card;
    drag.pid = e.pointerId;
    drag.sx = e.clientX;
    drag.sy = e.clientY;
    drag.ox = card.x;
    drag.oy = card.y;
    drag.x = card.x;
    drag.y = card.y;
    drag.z = nextZ();
    drag.prevZ = card.z;
    drag.moved = false;
    drag.movedBy = 0;
    drag.lifted = false;
    drag.longPress = false;
    try { node.setPointerCapture(e.pointerId); } catch (err) {}
    lastPointer.x = e.clientX - ui.wallCanvas.getBoundingClientRect().left;
    lastPointer.y = e.clientY - ui.wallCanvas.getBoundingClientRect().top;
    clearLongPress();
    drag.lpTimer = setTimeout(function () {
      drag.lpTimer = 0;
      if (!drag.active || drag.moved || drag.longPress) return;
      drag.longPress = true;
      showTrash();
      if (state.coarse && drag.node) {
        drag.lifted = true;
        startDragVisual();
      }
      schedulePresence(true);
    }, TRASH_LONG_PRESS);
  }
  function onPointerMove(e) {
    if (ui.wallCanvas) {
      var rect = ui.wallCanvas.getBoundingClientRect();
      lastPointer.x = e.clientX - rect.left;
      lastPointer.y = e.clientY - rect.top;
    }
    if (!drag.active || e.pointerId !== drag.pid) {
      if (drag.active === false && ui.wallCanvas && ui.wallCanvas.contains(e.target)) schedulePresence(false);
      return;
    }
    var dx = e.clientX - drag.sx;
    var dy = e.clientY - drag.sy;
    drag.movedBy = Math.max(Math.abs(dx), Math.abs(dy));
    if (!drag.moved) {
      var canActivate = drag.movedBy >= DRAG_THRESHOLD && (!state.coarse || drag.lifted);
      if (!canActivate) return;
      drag.moved = true;
      clearLongPress();
      startDragVisual();
      showTrash();
    }
    if (e.cancelable) e.preventDefault();
    var pos = clampCardPosition(drag.card, drag.ox + dx, drag.oy + dy);
    drag.x = pos.x;
    drag.y = pos.y;
    drag.node.style.left = pos.x + 'px';
    drag.node.style.top = pos.y + 'px';
    armTrash(isOverTrash(e.clientX, e.clientY));
    schedulePresence(false);
  }
  function finishDrag() {
    var node = drag.node;
    var card = drag.card;
    var z = drag.z;
    var x = clamp(snap(drag.x), 0, Math.max(0, CANVAS_W - card.w));
    var nodeH = node ? node.offsetHeight : CARD_H_GUESS;
    var y = clamp(snap(drag.y), 0, Math.max(0, CANVAS_H - nodeH));
    endDragVisual();
    if (node) {
      node.style.left = x + 'px';
      node.style.top = y + 'px';
      node.style.setProperty('--z', String(z));
      node.style.setProperty('--rot', card.rot + 'deg');
    }
    card.x = x;
    card.y = y;
    card.z = z;
    card.updatedAt = nowIso();
    pendingKeep(card);
    queueCacheSave();
    postOp({ op: 'card.upsert', card: cloneCard(card) });
    suppressClickUntil = Date.now() + 350;
    schedulePresence(true);
  }
  function cancelDrag() {
    var node = drag.node;
    var card = drag.card;
    if (node && card) {
      node.style.left = card.x + 'px';
      node.style.top = card.y + 'px';
      node.style.setProperty('--z', String(card.z));
      node.style.setProperty('--rot', card.rot + 'deg');
    }
    endDragVisual();
  }
  function onPointerUp(e) {
    if (!drag.active || e.pointerId !== drag.pid) return;
    var moved = drag.moved;
    var movedBy = drag.movedBy;
    var longPress = drag.longPress;
    var wasVisual = drag.visual;
    var node = drag.node;
    var card = drag.card;
    var overTrash = moved && isOverTrash(e.clientX, e.clientY);
    clearLongPress();
    try { if (node && node.hasPointerCapture && node.hasPointerCapture(e.pointerId)) node.releasePointerCapture(e.pointerId); } catch (err) {}
    drag.active = false;
    hideTrash();
    if (moved && overTrash && card) {
      endDragVisual();
      drag.node = null;
      drag.card = null;
      suppressClickUntil = Date.now() + 400;
      deleteCardWithUndo(card);
      return;
    }
    if (moved) {
      if (movedBy >= DRAG_THRESHOLD) finishDrag(); else cancelDrag();
    } else {
      if (wasVisual) cancelDrag(); else endDragVisual();
      if (longPress) suppressClickUntil = Date.now() + 400;
    }
    drag.node = null;
    drag.card = null;
  }
  function onPointerCancel(e) {
    if (!drag.active) return;
    clearLongPress();
    drag.active = false;
    hideTrash();
    cancelDrag();
    drag.node = null;
    drag.card = null;
  }

  /* ------------------------------ canvas events --------------------------- */
  /* phones open posters read-only first (no keyboard popping up); desktop keeps the
     fast click-to-edit path. The drawer's Edit button flips either one into edit mode. */
  function posterOpenMode() {
    if (!state.unlocked) return 'view';
    return state.coarse ? 'view' : 'edit';
  }

  function onCanvasClick(e) {
    if (Date.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); return; }
    var target = e.target;
    if (!target || !target.closest) return;
    var poster = target.closest('.poster');
    /* requirement rows: toggle the requirement explicitly. Relying on the label's
       default activation is unreliable because the native checkbox is visually hidden
       (pointer-events:none) and the canvas click handler would otherwise open the drawer. */
    var reqRow = target.closest('.req');
    if (reqRow && poster) {
      e.preventDefault();
      var reqCard = getCard(poster.dataset.id);
      var req = reqCard && reqRow.dataset.reqId ? findReq(reqCard, reqRow.dataset.reqId) : null;
      if (req) toggleRequirement(reqCard.id, req.id, !req.done);
      return;
    }
    if (target.closest('.poster-reqs')) return;
    if (target.closest('input[type="checkbox"]')) return;
    if (target.closest('button, a, select, textarea')) {
      var openBtn = target.closest('[data-action="open"]');
      if (openBtn && poster) { e.preventDefault(); openDrawer(poster.dataset.id, { mode: posterOpenMode() }); }
      return;
    }
    if (poster) { e.preventDefault(); openDrawer(poster.dataset.id, { mode: posterOpenMode() }); }
  }
  function onCanvasChange(e) {
    var target = e.target;
    if (!target || !target.dataset || !target.dataset.reqId) return;
    var poster = target.closest('.poster');
    if (!poster) return;
    var card = getCard(poster.dataset.id);
    var req = card ? findReq(card, target.dataset.reqId) : null;
    if (!state.unlocked) {
      if (target.type === 'checkbox') target.checked = req ? !!req.done : !target.checked;
      if (req) requestWrite(function () { toggleRequirement(card.id, req.id, !req.done); });
      return;
    }
    toggleRequirement(poster.dataset.id, target.dataset.reqId, !!target.checked);
  }
  function onCanvasKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var target = e.target;
    if (!target || !target.classList || !target.classList.contains('poster-title')) return;
    var poster = target.closest('.poster');
    if (!poster) return;
    e.preventDefault();
    openDrawer(poster.dataset.id);
  }

  /* ------------------------------- filters -------------------------------- */
  function chipNodes() {
    var host = ui.filterType;
    if (!host) return [];
    var found = host.querySelectorAll('[data-type], [data-filter-type], [data-type-filter]');
    return Array.prototype.slice.call(found);
  }
  function ensureFilterChips() {
    var host = ui.filterType;
    if (!host) return;
    if (chipNodes().length) return;
    var defs = [
      { v: 'all', label: 'All' },
      { v: 'assignment', label: 'Assignments' },
      { v: 'presentation', label: 'Presentations' },
      { v: 'other', label: 'Other' }
    ];
    host.textContent = '';
    for (var i = 0; i < defs.length; i++) {
      var b = el('button', 'chip is-filter-chip');
      b.type = 'button';
      b.dataset.type = defs[i].v;
      b.textContent = defs[i].label;
      b.setAttribute('aria-pressed', 'false');
      host.appendChild(b);
    }
  }
  function setTypeFilter(value) {
    if (value !== 'assignment' && value !== 'presentation' && value !== 'other') value = 'all';
    state.filters.type = value;
    var chips = chipNodes();
    for (var i = 0; i < chips.length; i++) {
      var v = chips[i].dataset.type || chips[i].dataset.filterType || chips[i].dataset.typeFilter;
      var on = v === value;
      chips[i].classList.toggle('is-active', on);
      chips[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    renderWall();
    state.agendaDirty = true;
    if (state.view === 'agenda') renderAgenda();
  }
  function populateCourseFilter() {
    var sel = ui.filterCourse;
    if (!sel || sel.tagName !== 'SELECT') return;
    var current = sel.value || 'all';
    var courses = [];
    var seen = {};
    for (var i = 0; i < state.cards.length; i++) {
      var c = state.cards[i].course;
      if (!c || seen[c]) continue;
      seen[c] = true;
      courses.push(c);
    }
    courses.sort();
    sel.textContent = '';
    var allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = 'All courses';
    sel.appendChild(allOpt);
    for (var j = 0; j < courses.length; j++) {
      var opt = document.createElement('option');
      opt.value = courses[j];
      opt.textContent = courses[j];
      sel.appendChild(opt);
    }
    if (current !== 'all') {
      var exists = false;
      for (var k = 0; k < sel.options.length; k++) if (sel.options[k].value === current) exists = true;
      sel.value = exists ? current : 'all';
    } else {
      sel.value = 'all';
    }
    state.filters.course = sel.value || 'all';
  }
  function ensureStatusOptions() {
    var sel = ui.filterStatus;
    if (!sel || sel.tagName !== 'SELECT') return;
    var wanted = ['all', 'open', 'done', 'late', 'week'];
    var have = {};
    for (var i = 0; i < sel.options.length; i++) have[sel.options[i].value] = true;
    var missing = false;
    for (var j = 0; j < wanted.length; j++) if (!have[wanted[j]]) missing = true;
    if (!missing) return;
    var current = sel.value || 'all';
    var labels = { all: 'All status', open: 'Open', done: 'Done', late: 'Late', week: 'This week' };
    sel.textContent = '';
    for (var k = 0; k < wanted.length; k++) {
      var opt = document.createElement('option');
      opt.value = wanted[k];
      opt.textContent = labels[wanted[k]];
      sel.appendChild(opt);
    }
    sel.value = have[current] ? current : 'all';
  }
  function setStatusFilter(value) {
    if (['all', 'open', 'done', 'late', 'week'].indexOf(value) === -1) value = 'all';
    state.filters.status = value;
    renderWall();
    state.agendaDirty = true;
    if (state.view === 'agenda') renderAgenda();
  }
  function setCourseFilter(value) {
    state.filters.course = !value || value === 'all' ? 'all' : String(value);
    renderWall();
    state.agendaDirty = true;
    if (state.view === 'agenda') renderAgenda();
  }
  let searchTimer = 0;
  function setSearchQuery(value) {
    state.filters.q = String(value || '');
    renderWall();
    state.agendaDirty = true;
    if (state.view === 'agenda') renderAgenda();
  }

  /* -------------------------------- share --------------------------------- */
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    var ok = false;
    try {
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      ok = document.execCommand('copy');
    } catch (e) { ok = false; }
    if (ta.parentNode) ta.parentNode.removeChild(ta);
    return ok;
  }
  function shareLink() {
    var url = window.location.href;
    var done = function () { toast('Link copied - send it to your class'); };
    var failed = function () {
      var ok = fallbackCopy(url);
      if (ok) done(); else toast('Copy failed - select the address bar instead', 'error');
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(url).then(done, failed);
    } else {
      failed();
    }
  }

  /* ------------------------------- dialogs -------------------------------- */
  function dialogOpen(dlg) { return !!(dlg && (dlg.open || dlg.hasAttribute('open'))); }
  function openDialog(dlg) {
    if (!dlg) return;
    hideTrash();
    if (typeof dlg.showModal === 'function') {
      if (!dlg.open) { try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); } }
    } else {
      dlg.setAttribute('open', '');
    }
  }
  function closeDialog(dlg) {
    if (!dlg) return;
    if (typeof dlg.close === 'function' && dlg.open) {
      try { dlg.close(); } catch (e) { dlg.removeAttribute('open'); }
    } else {
      dlg.removeAttribute('open');
    }
  }
  /* ------------------------------ write gate ------------------------------ */
  function updateLockUi() {
    var locked = !state.unlocked;
    if (!ui.btnLock) return;
    ui.btnLock.setAttribute('aria-pressed', locked ? 'false' : 'true');
    ui.btnLock.setAttribute('aria-label', locked ? 'Writing is locked — unlock to edit' : 'Writing is unlocked — lock it');
    ui.btnLock.classList.toggle('is-unlocked', !locked);
    var label = ui.btnLock.querySelector('.btn-label');
    if (label) label.textContent = locked ? 'Locked' : 'Editing';
  }
  function openUnlock(after) {
    state.pendingWrite = typeof after === 'function' ? after : null;
    if (!ui.unlockDialog) return;
    if (ui.unlockError) ui.unlockError.hidden = true;
    if (ui.unlockInput) ui.unlockInput.value = '';
    openDialog(ui.unlockDialog);
    setTimeout(function () { if (ui.unlockInput) { try { ui.unlockInput.focus(); } catch (e) {} } }, 40);
  }
  function closeUnlock() {
    state.pendingWrite = null;
    closeDialog(ui.unlockDialog);
  }
  function unlockError(message) {
    if (ui.unlockError) {
      ui.unlockError.textContent = message;
      ui.unlockError.hidden = false;
    }
    if (ui.unlockInput) { ui.unlockInput.focus(); ui.unlockInput.select(); }
  }
  function submitUnlock() {
    if (state.mode !== 'http') {
      unlockError('Editing needs the live board — open the VPS link, not a static copy.');
      return;
    }
    var pw = ui.unlockInput ? ui.unlockInput.value : '';
    if (!pw) { unlockError('Enter the class password.'); return; }
    if (ui.unlockSubmit) ui.unlockSubmit.disabled = true;
    fetch('api/auth/unlock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw })
    }).then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
        return { ok: res.ok, status: res.status, body: body };
      });
    }).then(function (r) {
      if (ui.unlockSubmit) ui.unlockSubmit.disabled = false;
      if (!r.ok || !r.body || !r.body.token) {
        var msg = r.status === 429 ? 'Too many attempts — wait a minute.' : 'Wrong password — try again.';
        if (r.status === 503) msg = 'Editing is not configured on this server.';
        unlockError(msg);
        return;
      }
      state.unlocked = true;
      state.writeToken = r.body.token;
      try { sessionStorage.setItem(UNLOCK_KEY, r.body.token); } catch (e) {}
      updateLockUi();
      if (ui.unlockError) ui.unlockError.hidden = true;
      closeDialog(ui.unlockDialog);
      toast('Editing unlocked');
      var fn = state.pendingWrite;
      state.pendingWrite = null;
      if (fn) fn();
    }).catch(function () {
      if (ui.unlockSubmit) ui.unlockSubmit.disabled = false;
      unlockError('Could not reach the server — check your connection.');
    });
  }
  function lockWriting() {
    state.unlocked = false;
    state.writeToken = null;
    state.pendingWrite = null;
    try { sessionStorage.removeItem(UNLOCK_KEY); } catch (e) {}
    updateLockUi();
    if (drawer.id && drawer.mode === 'edit') applyDrawerMode('view');
    toast('Writing locked');
  }
  function requestWrite(fn) {
    if (state.unlocked) { fn(); return; }
    openUnlock(fn);
  }

  function openNameDialog() {
    if (!state.me) return;
    if (ui.nameInput) ui.nameInput.value = state.me.name;
    openDialog(ui.nameDialog);
    if (ui.nameInput) {
      try { ui.nameInput.focus({ preventScroll: true }); ui.nameInput.select(); } catch (e) { try { ui.nameInput.focus(); } catch (e2) {} }
    }
  }
  function saveName() {
    if (!state.me) return;
    var v = ui.nameInput ? str(ui.nameInput.value, 40).trim() : '';
    if (!v) {
      toast('Type a name first', 'error');
      if (ui.nameInput) { try { ui.nameInput.focus(); } catch (e) {} }
      return;
    }
    state.me.name = v;
    writeJSON(IDENTITY_KEY, state.me);
    renderPresence();
    schedulePresence(true);
    closeDialog(ui.nameDialog);
    toast('You are ' + v);
  }
  function openHelp() {
    openDialog(ui.helpDialog);
    if (ui.helpClose) { try { ui.helpClose.focus(); } catch (e) {} }
  }
  function handleEscape() {
    if (drag.active) {
      clearLongPress();
      drag.active = false;
      cancelDrag();
      drag.node = null;
      drag.card = null;
      hideTrash();
      suppressClickUntil = Date.now() + 350;
      return;
    }
    if (dialogOpen(ui.unlockDialog)) { closeUnlock(); return; }
    if (dialogOpen(ui.nameDialog)) { closeDialog(ui.nameDialog); return; }
    if (dialogOpen(ui.helpDialog)) { closeDialog(ui.helpDialog); return; }
    if (drawer.id) { closeDrawer(); return; }
    var a = document.activeElement;
    if (a && a === ui.searchInput) {
      if (a.value) {
        a.value = '';
        setSearchQuery('');
      } else {
        try { a.blur(); } catch (e) {}
      }
    }
  }

  /* ------------------------------- keyboard ------------------------------- */
  function isTypingTarget(target) {
    if (!target || !target.tagName) return false;
    var tag = target.tagName.toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return false;
  }
  function onGlobalKeydown(e) {
    if (e.key === 'Escape' || e.key === 'Esc') { handleEscape(); return; }
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    if (drawer.id || dialogOpen(ui.unlockDialog) || dialogOpen(ui.nameDialog) || dialogOpen(ui.helpDialog)) return;
    var k = e.key;
    if (k === 'n' || k === 'N') { e.preventDefault(); requestWrite(createCard); return; }
    if (k === '/') {
      e.preventDefault();
      if (ui.searchInput) { try { ui.searchInput.focus(); ui.searchInput.select(); } catch (err) { try { ui.searchInput.focus(); } catch (err2) {} } }
      return;
    }
    if (k === '?') { e.preventDefault(); openHelp(); return; }
    if (k === 'g' || k === 'G') { e.preventDefault(); toggleView(); return; }
  }
  function trapDrawerFocus(e) {
    if (e.key !== 'Tab' || !drawer.id || !ui.drawer) return;
    var nodes = ui.drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    var list = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.offsetParent === null && n.getClientRects().length === 0) continue;
      if (n.tagName === 'INPUT' && n.type === 'hidden') continue;
      list.push(n);
    }
    if (!list.length) return;
    var first = list[0];
    var last = list[list.length - 1];
    if (e.shiftKey && (document.activeElement === first || !ui.drawer.contains(document.activeElement))) {
      e.preventDefault();
      try { last.focus(); } catch (err) {}
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      try { first.focus(); } catch (err) {}
    }
  }

  /* ------------------------------ event wiring ---------------------------- */
  function bindEvents() {
    document.addEventListener('keydown', onGlobalKeydown);

    if (ui.btnAdd) ui.btnAdd.addEventListener('click', function (e) { e.preventDefault(); requestWrite(createCard); });
    if (ui.btnLock) ui.btnLock.addEventListener('click', function (e) {
      e.preventDefault();
      if (state.unlocked) lockWriting(); else openUnlock(null);
    });
    if (ui.unlockDialog) {
      var unlockForm = ui.unlockDialog.querySelector('form');
      if (unlockForm) unlockForm.addEventListener('submit', function (e) { e.preventDefault(); submitUnlock(); });
      if (ui.unlockCancel) ui.unlockCancel.addEventListener('click', function (e) { e.preventDefault(); closeUnlock(); });
      ui.unlockDialog.addEventListener('cancel', function () { state.pendingWrite = null; });
    }
    if (ui.btnShare) ui.btnShare.addEventListener('click', function (e) { e.preventDefault(); shareLink(); });
    if (ui.btnHelp) ui.btnHelp.addEventListener('click', function (e) { e.preventDefault(); openHelp(); });
    if (ui.btnMe) ui.btnMe.addEventListener('click', function (e) { e.preventDefault(); openNameDialog(); });
    if (ui.connBadge) ui.connBadge.addEventListener('click', function () {
      if (state.mode === 'offline' || state.conn === 'offline') boot();
    });

    if (ui.viewToggle) {
      ui.viewToggle.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-view]') : null;
        if (!btn) return;
        e.preventDefault();
        setView(btn.dataset.view);
      });
    }
    if (ui.filterType) {
      ui.filterType.addEventListener('click', function (e) {
        var chip = e.target && e.target.closest ? e.target.closest('[data-type], [data-filter-type], [data-type-filter]') : null;
        if (!chip) return;
        e.preventDefault();
        setTypeFilter(chip.dataset.type || chip.dataset.filterType || chip.dataset.typeFilter);
      });
    }
    if (ui.filterCourse) {
      ui.filterCourse.addEventListener('change', function () { setCourseFilter(ui.filterCourse.value); });
    }
    if (ui.filterStatus) {
      ui.filterStatus.addEventListener('change', function () { setStatusFilter(ui.filterStatus.value); });
    }
    if (ui.searchInput) {
      ui.searchInput.addEventListener('input', function () {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { searchTimer = 0; setSearchQuery(ui.searchInput.value); }, 120);
      });
      ui.searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          if (ui.searchInput.value) { ui.searchInput.value = ''; setSearchQuery(''); e.stopPropagation(); }
        }
      });
    }

    if (ui.deadlineRail) {
      ui.deadlineRail.addEventListener('click', function (e) {
        var item = e.target && e.target.closest ? e.target.closest('.rail-item[data-id]') : null;
        if (!item) return;
        e.preventDefault();
        openDrawer(item.dataset.id, { mode: 'view' });
      });
      ui.deadlineRail.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        var item = e.target && e.target.closest ? e.target.closest('.rail-item[data-id]') : null;
        if (!item) return;
        e.preventDefault();
        openDrawer(item.dataset.id, { mode: 'view' });
      });
    }
    if (ui.agendaGroups) {
      ui.agendaGroups.addEventListener('click', function (e) {
        var row = e.target && e.target.closest ? e.target.closest('.agenda-item[data-id]') : null;
        if (!row) return;
        e.preventDefault();
        openDrawer(row.dataset.id, { mode: 'view' });
      });
      ui.agendaGroups.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        var row = e.target && e.target.closest ? e.target.closest('.agenda-item[data-id]') : null;
        if (!row) return;
        e.preventDefault();
        openDrawer(row.dataset.id, { mode: 'view' });
      });
    }

    var canvas = ui.wallCanvas;
    if (canvas) {
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('click', onCanvasClick);
      canvas.addEventListener('change', onCanvasChange);
      canvas.addEventListener('keydown', onCanvasKeydown);
      canvas.addEventListener('dragstart', function (e) { e.preventDefault(); });
      canvas.addEventListener('scroll', function () { schedulePresence(false); }, { passive: true });
    }
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('scroll', function () { schedulePresence(false); }, { passive: true });
    window.addEventListener('resize', function () {
      if (state.view === 'wall') updateEmptyState();
    });
    window.addEventListener('blur', hideTrash);

    if (ui.drawer) {
      ui.drawer.addEventListener('input', drawerOnInput);
      ui.drawer.addEventListener('change', drawerOnInput);
      ui.drawer.addEventListener('focusout', function () {
        if (drawer.saveTimer) { clearTimeout(drawer.saveTimer); drawer.saveTimer = 0; flushDrawerSave(); }
      });
      if (ui.drawerForm) ui.drawerForm.addEventListener('submit', function (e) { e.preventDefault(); });
      if (ui.drawer.tagName === 'FORM') ui.drawer.addEventListener('submit', function (e) { e.preventDefault(); });
    }
    if (ui.drawerReqs) {
      ui.drawerReqs.addEventListener('input', drawerOnReqsInput);
      ui.drawerReqs.addEventListener('change', drawerOnReqsInput);
      ui.drawerReqs.addEventListener('click', drawerOnReqsClick);
    }
    if (ui.drawerColorGroup) {
      ui.drawerColorGroup.addEventListener('click', function (e) {
        var sw = e.target && e.target.closest ? e.target.closest('[data-color]') : null;
        if (!sw || !drawer.id) return;
        e.preventDefault();
        var color = sw.dataset.color;
        if (COLORS.indexOf(color) === -1) return;
        drawer.color = color;
        updateColorSwatches();
        applyDrawerFields();
        scheduleDrawerSave();
      });
    }
    if (ui.drawerEditBtn) ui.drawerEditBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (drawer.mode !== 'view') return;
      requestWrite(function () {
        applyDrawerMode('edit');
        var input = ui.drawerTitleInput;
        if (input) { try { input.focus({ preventScroll: true }); input.select(); } catch (err) {} }
      });
    });
    if (ui.drawerClose) ui.drawerClose.addEventListener('click', function (e) { e.preventDefault(); closeDrawer(); });
    if (ui.drawerBackdrop) ui.drawerBackdrop.addEventListener('click', function (e) { e.preventDefault(); closeDrawer(); });
    if (ui.btnDuplicateCard) ui.btnDuplicateCard.addEventListener('click', function (e) { e.preventDefault(); duplicateCard(); });
    if (ui.btnDeleteCard) ui.btnDeleteCard.addEventListener('click', function (e) { e.preventDefault(); deleteCard(); });
    if (ui.btnAddReq) ui.btnAddReq.addEventListener('click', function (e) { e.preventDefault(); addRequirement(); });

    if (ui.drawer) ui.drawer.addEventListener('keydown', trapDrawerFocus);

    if (ui.nameSave) ui.nameSave.addEventListener('click', function (e) { e.preventDefault(); saveName(); });
    if (ui.nameCancel) ui.nameCancel.addEventListener('click', function (e) { e.preventDefault(); closeDialog(ui.nameDialog); });
    if (ui.nameInput) {
      ui.nameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); saveName(); }
      });
    }
    if (ui.helpClose) ui.helpClose.addEventListener('click', function (e) { e.preventDefault(); closeDialog(ui.helpDialog); });
    [ui.nameDialog, ui.helpDialog].forEach(function (dlg) {
      if (!dlg) return;
      dlg.addEventListener('click', function (e) {
        if (e.target === dlg) closeDialog(dlg);
      });
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); closeDialog(dlg); });
      if (dlg.tagName === 'FORM') dlg.addEventListener('submit', function (e) { e.preventDefault(); });
    });

    if (mqCoarse) {
      var onCoarse = function () { state.coarse = !!mqCoarse.matches; };
      if (typeof mqCoarse.addEventListener === 'function') mqCoarse.addEventListener('change', onCoarse);
      else if (typeof mqCoarse.addListener === 'function') mqCoarse.addListener(onCoarse);
    }
    window.addEventListener('online', function () {
      if (state.mode === 'offline') { boot(); return; }
      if (state.mode === 'supabase') { scheduleSupaReconnect(); flushOutbox(); schedulePresence(true); return; }
      if (state.transport === 'polling') { setConn('polling'); schedulePoll(0); }
      else { setConn('connecting'); if (!es) connectSSE(); }
      flushOutbox();
      schedulePresence(true);
    });
    window.addEventListener('offline', function () {
      if (state.mode === 'http' || state.mode === 'offline') setConn('offline');
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') { stopHeartbeat(); return; }
      startHeartbeat();
      if (state.mode === 'offline') return;
      if (state.mode === 'supabase') { scheduleSupaReconnect(); schedulePresence(true); return; }
      if (state.transport === 'polling') schedulePoll(0);
      else if (!es && state.conn !== 'live') { sseFailures = 0; connectSSE(); }
      flushOutbox();
      schedulePresence(true);
    });
  }

  /* --------------------- backend adapters: HTTP / Supabase ----------------- */
  let supaRetryTimer = 0;

  function fetchStateWithTimeout() {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('timeout'));
      }, STATE_TIMEOUT);
      fetch('api/state', { cache: 'no-store', headers: { accept: 'application/json' } })
        .then(function (res) {
          if (settled) return null;
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (!data || typeof data !== 'object' || !Array.isArray(data.cards)) { reject(new Error('bad state')); return; }
          resolve(data);
        })
        .catch(function (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  function loadScriptOnce(src) {
    return new Promise(function (resolve) {
      var existing = document.querySelector('script[data-mas-supabase]');
      if (existing) {
        if (window.supabase) { resolve(true); return; }
        existing.addEventListener('load', function () { resolve(!!window.supabase); });
        existing.addEventListener('error', function () { resolve(false); });
        return;
      }
      var node = document.createElement('script');
      node.src = src;
      node.async = true;
      node.setAttribute('data-mas-supabase', '1');
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        resolve(!!window.supabase);
      }, SUPABASE_VENDOR_TIMEOUT);
      node.onload = function () { if (settled) return; settled = true; clearTimeout(timer); resolve(!!window.supabase); };
      node.onerror = function () { if (settled) return; settled = true; clearTimeout(timer); resolve(false); };
      document.head.appendChild(node);
    });
  }

  function readSupabaseConfig() {
    return fetch(SUPABASE_CONFIG_URL, { cache: 'no-store', headers: { accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json().then(function (cfg) {
          if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null;
          var url = '', key = '';
          var urlKeys = ['url', 'supabaseUrl', 'SUPABASE_URL'];
          var keyKeys = ['anonKey', 'anon_key', 'supabaseAnonKey', 'SUPABASE_ANON_KEY'];
          for (var i = 0; i < urlKeys.length; i++) {
            var uv = cfg[urlKeys[i]];
            if (typeof uv === 'string' && uv.trim()) url = uv.trim();
          }
          for (var j = 0; j < keyKeys.length; j++) {
            var kv = cfg[keyKeys[j]];
            if (typeof kv === 'string' && kv.trim()) key = kv.trim();
          }
          if (!url || !key) return null;
          if (!/^https?:\/\//i.test(url)) return null;
          return { url: url, anonKey: key };
        }, function () { return null; });
      })
      .catch(function () { return null; });
  }

  var supaConfigPromise = null;
  function getSupabaseConfig() {
    if (!supaConfigPromise) {
      var embedded = window.MAS_SUPABASE_CONFIG;
      if (
        embedded &&
        typeof embedded === 'object' &&
        typeof embedded.url === 'string' &&
        /^https?:\/\//i.test(embedded.url) &&
        typeof embedded.anonKey === 'string' &&
        embedded.anonKey
      ) {
        /* index.html embeds the public config to skip one round trip on first load */
        supaConfigPromise = Promise.resolve({ url: embedded.url, anonKey: embedded.anonKey });
      } else {
        supaConfigPromise = readSupabaseConfig();
      }
    }
    return supaConfigPromise;
  }

  function createSupabaseClient(cfg) {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return false;
    try {
      state.supabase = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
      return !!state.supabase;
    } catch (e) {
      state.supabase = null;
      return false;
    }
  }

  function supaRowsToCards(rows) {
    var out = [];
    if (!Array.isArray(rows)) return out;
    for (var i = 0; i < rows.length && out.length < MAX_CARDS; i++) {
      var row = rows[i];
      if (!row || typeof row !== 'object') continue;
      var raw = row.data;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        raw = { id: row.id };
      } else if (!raw.id && row.id) {
        raw = Object.assign({}, raw, { id: row.id });
      }
      var card = normaliseCard(raw);
      if (card) out.push(card);
    }
    return out;
  }

  function supaLoad() {
    var sb = state.supabase;
    if (!sb) return Promise.reject(new Error('no supabase client'));
    /* both tables are independent: run the two queries in parallel so the first paint
       waits for one round trip instead of two */
    var cardsP = sb.from('cards').select('id,data');
    var boardP = sb.from('board').select('data').eq('id', 1).single();
    return Promise.all([cardsP, boardP]).then(function (results) {
      var cardsRes = results[0];
      var boardRes = results[1];
      if (cardsRes && cardsRes.error) throw cardsRes.error;
      var cards = supaRowsToCards(cardsRes ? cardsRes.data : []);
      var course = null;
      if (boardRes && !boardRes.error && boardRes.data && boardRes.data.data) course = boardRes.data.data;
      return { rev: 0, course: normaliseCourse(course), cards: cards };
    });
  }

  function supaBroadcast(event, payload) {
    var ch = state.supaChannel;
    if (!ch) return;
    try {
      ch.send({ type: 'broadcast', event: event, payload: payload });
    } catch (e) {}
  }

  function supaWrite(op, noEnqueue) {
    var sb = state.supabase;
    if (!sb || !op || typeof op.op !== 'string') return Promise.resolve({ ok: false, error: 'no-client' });
    if (op.op === 'card.upsert' && op.card && op.card.id) {
      supaBroadcast('card.upsert', { card: cloneCard(op.card) });
    } else if (op.op === 'card.delete' && op.id) {
      supaBroadcast('card.delete', { id: op.id });
    }
    var query = null;
    if (op.op === 'card.upsert' && op.card && op.card.id) {
      query = sb.from('cards').upsert({ id: op.card.id, data: cloneCard(op.card), updated_at: new Date().toISOString() });
    } else if (op.op === 'card.delete' && op.id) {
      query = sb.from('cards').delete().eq('id', op.id);
    } else if (op.op === 'course.update' && op.course) {
      query = sb.from('board').update({ data: normaliseCourse(op.course), updated_at: new Date().toISOString() }).eq('id', 1);
    } else {
      return Promise.resolve({ ok: false, error: 'unsupported op' });
    }
    return Promise.resolve(query).then(function (res) {
      if (res && res.error) {
        setSaveState('error');
        if (!noEnqueue) enqueueOp(op);
        return { ok: false, error: (res.error && res.error.message) || 'supabase error' };
      }
      setSaveState('saved');
      return { ok: true };
    }, function (err) {
      setSaveState('error');
      if (!noEnqueue) enqueueOp(op);
      return { ok: false, error: String((err && err.message) || err) };
    });
  }

  function supaTrackSelf() {
    var ch = state.supaChannel;
    var me = state.me;
    if (!ch || !me || typeof ch.track !== 'function') return;
    if (state.presenceAvailable === false) return;
    try {
      var p = ch.track({
        id: me.id, name: me.name, color: me.color,
        x: Math.round(lastPointer.x), y: Math.round(lastPointer.y),
        cardId: drawer.id || null
      });
      if (p && typeof p.catch === 'function') p.catch(function () { degradePresence(); });
    } catch (e) {
      degradePresence();
    }
  }

  function syncSupaPresence() {
    var ch = state.supaChannel;
    if (!ch) return;
    var st = null;
    try { st = typeof ch.presenceState === 'function' ? ch.presenceState() : null; } catch (e) { st = null; }
    if (!st || typeof st !== 'object') { degradePresence(); return; }
    var users = [];
    var keys = Object.keys(st);
    for (var i = 0; i < keys.length && users.length < 60; i++) {
      var metas = st[keys[i]];
      if (!Array.isArray(metas)) continue;
      for (var j = 0; j < metas.length && users.length < 60; j++) {
        var m = metas[j];
        if (!m || typeof m !== 'object') continue;
        users.push({
          id: typeof m.id === 'string' && m.id ? m.id : keys[i],
          name: m.name, color: m.color, x: m.x, y: m.y, cardId: m.cardId
        });
      }
    }
    state.presenceAvailable = true;
    state.users = normaliseUsers(users);
    renderPresence();
  }

  function degradePresence() {
    if (state.presenceAvailable === false) return;
    state.presenceAvailable = false;
    state.users = [];
    renderPresence();
  }

  function supaSubscribe() {
    var sb = state.supabase;
    if (!sb || state.supaChannel) return;
    var me = state.me || { id: 'me' };
    var ch;
    try {
      ch = sb.channel('mas-wall', { config: { presence: { key: me.id } } });
    } catch (e) {
      scheduleSupaReconnect();
      return;
    }
    state.supaChannel = ch;
    try {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, function (payload) {
        if (!payload) return;
        if (payload.eventType === 'DELETE') {
          var oldRow = payload.old || {};
          var id = oldRow.id || (oldRow.data && oldRow.data.id);
          if (id) handleRemoteDelete(String(id));
          return;
        }
        if (payload.new && payload.new.data) handleRemoteUpsert(payload.new.data);
      });
      ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'board' }, function (payload) {
        if (payload && payload.new && payload.new.data) {
          state.course = normaliseCourse(payload.new.data);
          renderChrome();
          queueCacheSave();
        }
      });
      /* instant echo: broadcast the change at the same time as the database write so
         other tabs/devices do not wait for the Postgres replication round trip */
      ch.on('broadcast', { event: 'card.upsert' }, function (msg) {
        if (msg && msg.payload && msg.payload.card) handleRemoteUpsert(msg.payload.card);
      });
      ch.on('broadcast', { event: 'card.delete' }, function (msg) {
        if (msg && msg.payload && msg.payload.id) handleRemoteDelete(String(msg.payload.id));
      });
      ch.on('presence', { event: 'sync' }, function () { syncSupaPresence(); });
      ch.subscribe(function (status) {
        if (status === 'SUBSCRIBED') {
          sseFailures = 0;
          setConn('live');
          supaTrackSelf();
          flushOutbox();
          schedulePresence(true);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConn('connecting');
          scheduleSupaReconnect();
        }
      });
    } catch (e) {
      scheduleSupaReconnect();
    }
  }

  function scheduleSupaReconnect() {
    if (state.mode !== 'supabase' || supaRetryTimer) return;
    supaRetryTimer = setTimeout(function () {
      supaRetryTimer = 0;
      if (state.mode === 'supabase') reconnectSupa();
    }, SUPABASE_RECONNECT_MS);
  }

  function reconnectSupa() {
    var sb = state.supabase;
    if (!sb) { detectSupabase(); return; }
    setConn('connecting');
    if (state.supaChannel) {
      try { sb.removeChannel(state.supaChannel); } catch (e) {}
      state.supaChannel = null;
    }
    supaLoad().then(function (data) {
      applyServerState(data);
      renderAll();
      populateCourseFilter();
      supaSubscribe();
    }).catch(function () {
      scheduleSupaReconnect();
    });
  }

  function goOfflineMode() {
    state.mode = 'offline';
    state.presenceAvailable = false;
    setConn('offline');
    renderPresence();
    if (!state.cards.length) {
      var cached = readCache();
      if (cached) {
        applyServerState(cached);
        renderAll();
        populateCourseFilter();
      }
    }
  }

  function detectSupabase() {
    Promise.all([getSupabaseConfig(), loadScriptOnce(SUPABASE_VENDOR)]).then(function (results) {
      var cfg = results[0];
      var loaded = results[1];
      if (!cfg || !loaded || !createSupabaseClient(cfg)) { goOfflineMode(); return; }
      state.mode = 'supabase';
      supaLoad().then(function (data) {
          applyServerState(data);
          renderAll();
          populateCourseFilter();
          queueCacheSave();
          restartHeartbeat(SUPABASE_TRACK_MS);
          setConn('connecting');
          supaSubscribe();
          flushOutbox();
          schedulePresence(true);
        }).catch(function () {
          setConn('connecting');
          scheduleSupaReconnect();
        });
    });
  }

  /* -------------------------------- boot ---------------------------------- */
  function fetchState() {
    return fetch('api/state', { cache: 'no-store', headers: { accept: 'application/json' } }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }
  function boot() {
    if (state.conn !== 'live') setConn('connecting');
    fetchStateWithTimeout().then(function (data) {
      state.mode = 'http';
      state.transport = 'sse';
      applyServerState(data);
      renderAll();
      populateCourseFilter();
      setConn('live');
      queueCacheSave();
      startTransport();
      flushOutbox();
      schedulePresence(true);
    }).catch(function () {
      detectSupabase();
    });
  }

  function restoreIdentity() {
    var saved = readJSON(IDENTITY_KEY);
    var fallbackId = '';
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') fallbackId = window.crypto.randomUUID();
    } catch (e) { fallbackId = ''; }
    if (!fallbackId) fallbackId = 'u_' + Math.random().toString(36).slice(2, 12);
    var me = {
      id: saved && typeof saved.id === 'string' && saved.id ? saved.id.slice(0, 64) : fallbackId,
      name: saved && typeof saved.name === 'string' && saved.name.trim() ? saved.name.trim().slice(0, 40) : 'Guest ' + (1 + Math.floor(Math.random() * 98)),
      color: saved && /^#[0-9a-fA-F]{6}$/.test(saved.color || '') ? saved.color : USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]
    };
    writeJSON(IDENTITY_KEY, me);
    state.me = me;
  }
  function restoreView() {
    var saved = null;
    try { saved = window.localStorage.getItem(VIEW_KEY); } catch (e) { saved = null; }
    if (saved === 'wall' || saved === 'agenda') {
      state.view = saved;
    } else {
      state.view = window.matchMedia && window.matchMedia('(max-width: 899px)').matches ? 'agenda' : 'wall';
    }
  }
  function exposeApi() {
    try {
      window.MASWALL = {
        version: '1.0.0',
        snapshot: function () {
          return { rev: state.rev, cards: state.cards.length, conn: state.conn, mode: state.mode, transport: state.transport, view: state.view, filters: state.filters, me: state.me };
        },
        cardIds: function () { return state.cards.map(function (c) { return c.id; }); },
        open: function (id) { openDrawer(id); },
        create: function () { return createCard(); },
        setView: function (v) { setView(v); },
        setFilters: function (f) {
          if (!f) return;
          if (f.type) setTypeFilter(f.type);
          if (f.status) setStatusFilter(f.status);
          if (f.q != null) setSearchQuery(f.q);
        },
        card: function (id) { return getCard(id); }
      };
    } catch (e) {}
  }
  function init() {
    cacheDom();
    restoreIdentity();
    restoreView();
    try {
      var savedToken = sessionStorage.getItem(UNLOCK_KEY);
      state.unlocked = !!savedToken;
      state.writeToken = savedToken || null;
    } catch (e) {
      state.unlocked = false;
      state.writeToken = null;
    }
    updateLockUi();
    state.outbox = loadOutbox();
    state.coarse = !!(mqCoarse && mqCoarse.matches);
    try { state.pollForced = /(?:^|[?&])poll=1(?:&|$)/.test(window.location.search); } catch (e) { state.pollForced = false; }
    ensureFilterChips();
    ensureStatusOptions();
    populateCourseFilter();
    bindEvents();
    ensureTrash();
    renderChoiceDefaults();
    var cached = readCache();
    if (cached) {
      applyServerState(cached);
      renderAll();
      populateCourseFilter();
      document.documentElement.dataset.cache = 'hit';
    } else {
      renderAll();
      document.documentElement.dataset.cache = 'miss';
    }
    setView(state.view);
    renderPresence();
    setConn('connecting');
    exposeApi();
    /* warm the Supabase config request in parallel with the local-API probe so static
       hosting does not pay for a sequential round trip after the 404 */
    getSupabaseConfig();
    boot();
    startHeartbeat();
    schedulePresence(true);
  }
  function renderChoiceDefaults() {
    var sel = ui.drawerTypeSelect;
    if (sel && sel.tagName === 'SELECT') {
      var have = {};
      for (var i = 0; i < sel.options.length; i++) have[sel.options[i].value] = true;
      var missing = false;
      for (var j = 0; j < TYPES.length; j++) if (!have[TYPES[j]]) missing = true;
      if (missing) {
        sel.textContent = '';
        var labels = { assignment: 'Assignment', presentation: 'Presentation', other: 'Other' };
        for (var k = 0; k < TYPES.length; k++) {
          var opt = document.createElement('option');
          opt.value = TYPES[k];
          opt.textContent = labels[TYPES[k]];
          sel.appendChild(opt);
        }
      }
    }
    var colors = ui.drawerColorGroup;
    if (colors && !colors.querySelector('[data-color]')) {
      for (var c = 0; c < COLORS.length; c++) {
        var b = el('button', 'swatch swatch-' + COLORS[c]);
        b.type = 'button';
        b.dataset.color = COLORS[c];
        b.setAttribute('aria-label', 'Paper colour: ' + COLORS[c]);
        b.setAttribute('aria-pressed', 'false');
        colors.appendChild(b);
      }
    }
  }

  /* --------------------------------- start -------------------------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
