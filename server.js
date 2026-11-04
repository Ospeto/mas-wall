#!/usr/bin/env node
"use strict";

/*
 * MAS WALL server — zero dependencies, Node >= 18.
 *
 * One process owns everything:
 *   - static file server for public/ (traversal-safe, correct MIME types)
 *   - JSON API: /api/state, /api/health, /api/op, /api/presence
 *   - SSE fan-out on /api/events: hello snapshot, typed change messages, heartbeat
 *   - debounced atomic persistence to data/state.json, seeded from data/seed.json
 *   - graceful shutdown that flushes the last write before exiting
 *
 * Every path is resolved from this file, so the server works from any cwd.
 */

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { URL } = require("node:url");

// ---------------------------------------------------------------- config

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const SEED_FILE = path.join(DATA_DIR, "seed.json");

const PORT = toPort(process.env.PORT, 4321);
const HOST = process.env.HOST || "0.0.0.0";

const MAX_BODY_BYTES = 1.5 * 1024 * 1024;
const MAX_CARDS = 400;
const MAX_TITLE = 200;
const MAX_TEXT = 4000;
const MAX_REQ_TEXT = 200;
const MAX_REQS = 40;

const SAVE_DEBOUNCE_MS = 250;
const SSE_HEARTBEAT_MS = toPositiveInt(process.env.HEARTBEAT_MS, 20000);
const PRESENCE_TTL_MS = 75000;
const PRESENCE_SWEEP_MS = 30000;
const PRESENCE_THROTTLE_MS = 100; // hard ceiling: at most 10 presence broadcasts per second

const DEBUG = process.env.DEBUG === "1" || process.env.MAS_WALL_DEBUG === "1";

// Write access password: the browser unlocks locally, and every write must carry the
// matching x-write-password header. Only the SHA-256 hash is kept here.
const WRITE_HASH = process.env.WRITE_HASH || "5a0e2a5671c5f76a04a307d6a5e41bb2dc84742b8211f06889897fcb4c943ebc";
function writePasswordOk(req) {
  const supplied = req.headers["x-write-password"];
  if (typeof supplied !== "string" || !supplied) return false;
  return crypto.createHash("sha256").update(supplied).digest("hex") === WRITE_HASH;
}

// Client-generated ids are opaque tokens; keep them verbatim (1-64 printable chars)
// so an echo from the server can never fork a poster into a duplicate.
const ID_RE = /^[!-~]{1,64}$/;
const CARD_TYPES = ["assignment", "presentation", "other"];
const CARD_COLORS = ["bone", "blush", "sage", "sky", "butter"];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
};

const NO_CACHE_EXT = [".html", ".css", ".js", ".mjs", ".json", ".webmanifest"];

// ---------------------------------------------------------------- runtime state

let state = null; // { rev, course, cards }
const sseClients = new Set();
const presence = new Map(); // user id -> { id, name, color, x, y, cardId, lastSeen }
let clientSeq = 0;

let changeSeq = 0;
let persistedSeq = 0;
let saveTimer = null;
let retryTimer = null;
let saveChain = Promise.resolve();
let shuttingDown = false;

// ---------------------------------------------------------------- helpers

function toPort(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function log() {
  console.log("[mas-wall]", ...arguments);
}

function isUnsafeKey(key) {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function copySafe(source) {
  const out = {};
  if (!source || typeof source !== "object" || Array.isArray(source)) return out;
  for (const key of Object.keys(source)) {
    if (isUnsafeKey(key)) continue;
    out[key] = source[key];
  }
  return out;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function str(value, max) {
  let text = "";
  if (typeof value === "string") text = value;
  else if (typeof value === "number" && Number.isFinite(value)) text = String(value);
  else if (typeof value === "boolean") text = String(value);
  if (max && text.length > max) text = text.slice(0, max);
  return text;
}

function num(value, fallback, min, max) {
  let n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) n = fallback;
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}

function int(value, fallback, min, max) {
  return Math.round(num(value, fallback, min, max));
}

function isValidId(value) {
  return typeof value === "string" && ID_RE.test(value);
}

function generateCardId() {
  return "c_" + crypto.randomBytes(4).toString("hex");
}

function generateReqId() {
  return "r_" + crypto.randomBytes(3).toString("hex");
}

function isIsoDate(value) {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function safeDue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (candidate.length === 0 || candidate.length > 40) return null;
  return Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function safeLink(value) {
  const link = str(value, 1000).trim();
  if (!link) return "";
  if (link.indexOf("http://") === 0 || link.indexOf("https://") === 0 || link.indexOf("mailto:") === 0) return link;
  return "";
}

// ---------------------------------------------------------------- normalisation

function emptyState() {
  return {
    rev: 1,
    course: {
      title: "MAS WALL",
      subtitle: "Assignments, presentations & everything due",
      term: "Semester 1 - 2026",
    },
    cards: [],
  };
}

function normalizeRequirements(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < list.length && out.length < MAX_REQS; i += 1) {
    const item = list[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = isValidId(item.id) ? item.id : generateReqId();
    if (seen[id]) continue; // duplicate requirement ids would break the checkbox contract
    seen[id] = true;
    out.push({ id: id, text: str(item.text, MAX_REQ_TEXT), done: item.done === true });
  }
  return out;
}

/*
 * Cards keep every unknown field they arrive with (CONTRACT §3) except height,
 * which is layout-only and must never be persisted. Existing fields are merged
 * over the stored card, so partial updates such as a drag (x/y/z only) are safe.
 */
function normalizeCard(raw, existing, touch) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "card must be an object");
  }
  const base = copySafe(existing);
  const merged = Object.assign(base, copySafe(raw));
  const card = Object.assign({}, merged);
  delete card.height;

  card.id = isValidId(merged.id) ? merged.id : (isValidId(base.id) ? base.id : generateCardId());
  card.title = str(merged.title, MAX_TITLE);
  card.type = CARD_TYPES.indexOf(merged.type) >= 0 ? merged.type : "assignment";
  card.course = str(merged.course, 80);
  card.kind = str(merged.kind, 80);
  card.due = safeDue(merged.due);
  card.weight = str(merged.weight, 24);
  card.brief = str(merged.brief, MAX_TEXT);
  card.notes = str(merged.notes, MAX_TEXT);
  card.link = safeLink(merged.link);
  card.requirements = normalizeRequirements(merged.requirements);
  card.x = Math.round(num(merged.x, 80, 0, 2200));
  card.y = Math.round(num(merged.y, 120, 0, 1600));
  card.w = Math.round(num(merged.w, 360, 300, 460));
  card.rot = Math.round(num(merged.rot, 0, -3, 3) * 1000) / 1000;
  card.z = int(merged.z, 1, 0, 99999);
  card.color = CARD_COLORS.indexOf(merged.color) >= 0 ? merged.color : "bone";
  card.done = merged.done === true;
  card.createdAt = isIsoDate(merged.createdAt) ? merged.createdAt : nowIso();
  card.updatedAt = touch || !isIsoDate(merged.updatedAt) ? nowIso() : merged.updatedAt;
  return card;
}

function normalizeCourse(raw, base) {
  const course = Object.assign({}, base);
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const key of Object.keys(raw)) {
      if (isUnsafeKey(key)) continue;
      course[key] = str(raw[key], 500);
    }
  }
  return course;
}

/*
 * Rebuild a trustworthy state object from whatever is on disk. A single broken
 * card is skipped instead of discarding the whole file, and duplicate ids are
 * collapsed so the client never renders the same poster twice.
 */
function normalizeState(raw, source) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(source + " is not a JSON object");
  }
  if (!Array.isArray(raw.cards)) {
    throw new Error(source + " has no cards array");
  }
  const base = emptyState();
  const rev = Number(raw.rev);
  base.rev = Number.isFinite(rev) && rev >= 1 ? Math.floor(rev) : 1;
  base.course = normalizeCourse(raw.course, base.course);

  const cards = [];
  const seen = Object.create(null);
  for (const rawCard of raw.cards) {
    if (!rawCard || typeof rawCard !== "object" || Array.isArray(rawCard)) continue;
    let card;
    try {
      card = normalizeCard(rawCard, null, false);
    } catch (err) {
      continue;
    }
    if (seen[card.id]) continue;
    seen[card.id] = true;
    cards.push(card);
    if (cards.length >= MAX_CARDS) break;
  }
  base.cards = cards;
  return base;
}

function publicState() {
  return { rev: state.rev, course: state.course, cards: state.cards };
}

// ---------------------------------------------------------------- persistence

function markStateChanged() {
  changeSeq += 1;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    saveTimer = null;
    void persistState();
  }, SAVE_DEBOUNCE_MS);
}

async function writeStateFile() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const payload = JSON.stringify(state, null, 2);
  const tmp = path.join(DATA_DIR, ".state-" + process.pid + "-" + crypto.randomBytes(4).toString("hex") + ".tmp");
  const handle = await fsp.open(tmp, "w");
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync(); // durable before the rename makes it visible
  } finally {
    await handle.close();
  }
  try {
    await fsp.rename(tmp, STATE_FILE); // atomic swap: readers never see a half-written file
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(function () {});
    throw err;
  }
}

function scheduleRetry() {
  if (shuttingDown || retryTimer) return;
  retryTimer = setTimeout(function () {
    retryTimer = null;
    void persistState();
  }, 1000);
  retryTimer.unref();
}

async function runSaveLoop() {
  do {
    const seq = changeSeq;
    await writeStateFile();
    persistedSeq = seq;
  } while (changeSeq !== persistedSeq);
}

/*
 * Serialised writes: one save at a time, newest state wins, failures retried.
 * The loop re-checks changeSeq so a change that lands mid-write is never lost.
 */
function persistState() {
  saveChain = saveChain
    .then(runSaveLoop)
    .catch(function (err) {
      console.error("[mas-wall] could not save data/state.json: " + (err && err.message));
      scheduleRetry();
    });
  return saveChain;
}

async function flushState() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  await saveChain;
  if (changeSeq !== persistedSeq) await persistState();
  await saveChain;
}

/*
 * Seed/repair on boot: prefer a valid data/state.json, otherwise copy the seed.
 * A corrupt state file is moved aside rather than silently overwritten.
 */
async function loadState() {
  let reason = "";
  try {
    const text = await fsp.readFile(STATE_FILE, "utf8");
    state = normalizeState(JSON.parse(text), "data/state.json");
    return { seeded: false, reason: "" };
  } catch (err) {
    reason = err && err.message ? err.message : String(err);
    if (!err || err.code !== "ENOENT") {
      const backup = STATE_FILE + ".corrupt-" + Date.now();
      try {
        await fsp.rename(STATE_FILE, backup);
        log("data/state.json was unreadable (" + reason + "); moved it to " + path.basename(backup));
      } catch (renameErr) {
        log("data/state.json was unreadable (" + reason + ")");
      }
    }
  }

  try {
    const seedText = await fsp.readFile(SEED_FILE, "utf8");
    state = normalizeState(JSON.parse(seedText), "data/seed.json");
    return { seeded: true, reason: reason };
  } catch (err) {
    console.error("[mas-wall] could not load data/seed.json: " + (err && err.message ? err.message : err));
    state = emptyState();
    return { seeded: true, reason: reason };
  }
}

// ---------------------------------------------------------------- SSE

function sseSend(client, payload, eventName) {
  const res = client.res;
  if (res.writableEnded || res.destroyed) {
    dropClient(client, "closed");
    return false;
  }
  let frame = "";
  if (eventName) frame += "event: " + eventName + "\n";
  frame += "data: " + JSON.stringify(payload) + "\n\n";
  try {
    res.write(frame);
    return true;
  } catch (err) {
    dropClient(client, "write-error");
    return false;
  }
}

function broadcast(payload) {
  for (const client of Array.from(sseClients)) sseSend(client, payload);
}

function dropClient(client, reason) {
  if (!sseClients.has(client)) return;
  sseClients.delete(client);
  try {
    client.res.end();
  } catch (err) {
    /* the socket is already gone */
  }
  if (DEBUG) log("SSE -1 (" + reason + "), " + sseClients.size + " open");
}

function openEventStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });
  if (res.socket) {
    res.socket.setNoDelay(true);
    res.socket.setTimeout(0);
  }
  const client = { id: ++clientSeq, res: res, since: Date.now() };
  sseClients.add(client);
  // hello carries the full snapshot, so a fresh tab renders without a second request
  sseSend(client, { type: "hello", state: publicState(), users: presenceUsers() }, "hello");
  req.on("close", function () {
    dropClient(client, "close");
  });
  res.on("error", function () {
    dropClient(client, "error");
  });
  if (DEBUG) log("SSE client #" + client.id + " connected (" + sseClients.size + " open)");
}

// ---------------------------------------------------------------- presence

function presenceUsers() {
  const users = [];
  for (const user of presence.values()) {
    users.push({ id: user.id, name: user.name, color: user.color, x: user.x, y: user.y, cardId: user.cardId });
  }
  return users;
}

let presenceTimer = null;
let lastPresenceBroadcast = 0;

function broadcastPresence() {
  lastPresenceBroadcast = Date.now();
  if (sseClients.size === 0) return;
  broadcast({ type: "presence", users: presenceUsers() });
}

/*
 * Presence pings are chatty (every client, every 25s, plus on scroll), so the
 * fan-out is coalesced to at most one message per PRESENCE_THROTTLE_MS.
 */
function schedulePresenceBroadcast() {
  const elapsed = Date.now() - lastPresenceBroadcast;
  if (elapsed >= PRESENCE_THROTTLE_MS) {
    broadcastPresence();
    return;
  }
  if (presenceTimer) return;
  presenceTimer = setTimeout(function () {
    presenceTimer = null;
    broadcastPresence();
  }, PRESENCE_THROTTLE_MS - elapsed);
  presenceTimer.unref();
}

function prunePresence() {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  let removed = 0;
  for (const [id, user] of presence) {
    if (user.lastSeen < cutoff) {
      presence.delete(id);
      removed += 1;
    }
  }
  return removed;
}

// ---------------------------------------------------------------- HTTP helpers

function sendJson(res, status, payload, extraHeaders) {
  if (res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  res.writeHead(status, headers);
  res.end(body);
}

function sendText(res, status, text) {
  if (res.writableEnded || res.destroyed) return;
  const body = text + "\n";
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function sendEmpty(res, status) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { "Cache-Control": "no-store", "Content-Length": 0 });
  res.end();
}

function requireMethod(req, res, method) {
  if (req.method === method) return true;
  res.setHeader("Allow", method);
  sendJson(res, 405, { ok: false, error: "method not allowed" });
  return false;
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    let settled = false;
    const chunks = [];
    function fail(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }
    req.on("data", function (chunk) {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        // Drain rather than destroy so the 413 response can still be delivered.
        fail(new HttpError(413, "payload too large (max 1.5 MB)"));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function () {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", function (err) {
      fail(err);
    });
    req.on("aborted", function () {
      fail(new HttpError(400, "request aborted"));
    });
  });
}

async function readJsonBody(req) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    req.resume();
    throw new HttpError(413, "payload too large (max 1.5 MB)");
  }
  const raw = await readBody(req, MAX_BODY_BYTES);
  if (!raw || raw.trim().length === 0) throw new HttpError(400, "empty body");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new HttpError(400, "invalid JSON");
  }
}

// ---------------------------------------------------------------- operations

function upsertCard(rawCard) {
  if (!rawCard || typeof rawCard !== "object" || Array.isArray(rawCard)) {
    throw new HttpError(400, "card must be an object");
  }
  const index = state.cards.findIndex(function (card) {
    return card.id === rawCard.id;
  });
  const existing = index >= 0 ? state.cards[index] : null;
  if (!existing && state.cards.length >= MAX_CARDS) {
    throw new HttpError(409, "card limit reached (" + MAX_CARDS + ")");
  }
  const card = normalizeCard(rawCard, existing, true);
  if (index >= 0) state.cards[index] = card;
  else state.cards.push(card);
  state.rev += 1;
  markStateChanged();
  broadcast({ type: "card.upsert", card: card, rev: state.rev });
}

function deleteCard(id) {
  if (!isValidId(id)) throw new HttpError(400, "id must be a string");
  const index = state.cards.findIndex(function (card) {
    return card.id === id;
  });
  if (index < 0) throw new HttpError(404, "card not found");
  state.cards.splice(index, 1);
  state.rev += 1;
  markStateChanged();
  broadcast({ type: "card.delete", id: id, rev: state.rev });
}

function updateCourse(rawCourse) {
  if (!rawCourse || typeof rawCourse !== "object" || Array.isArray(rawCourse)) {
    throw new HttpError(400, "course must be an object");
  }
  const keys = Object.keys(rawCourse);
  if (keys.length === 0) throw new HttpError(400, "course is empty");
  const next = Object.assign({}, state.course);
  for (const key of keys) {
    if (isUnsafeKey(key)) continue;
    const value = rawCourse[key];
    if (value === undefined) continue;
    if (value === null) {
      delete next[key];
      continue;
    }
    next[key] = str(value, 500);
  }
  state.course = next;
  state.rev += 1;
  markStateChanged();
  broadcast({ type: "course.update", course: state.course, rev: state.rev });
}

async function handleOp(req, res) {
  if (!writePasswordOk(req)) {
    log("POST /api/op rejected: write password required");
    throw new HttpError(401, "write password required");
  }
  const body = await readJsonBody(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "body must be a JSON object");
  }
  const op = typeof body.op === "string" ? body.op.trim() : "";
  if (!op) throw new HttpError(400, "missing op");
  try {
    switch (op) {
      case "card.upsert":
        upsertCard(body.card);
        break;
      case "card.delete":
        deleteCard(body.id);
        break;
      case "course.update":
        updateCourse(body.course);
        break;
      default:
        throw new HttpError(400, "unknown op: " + op);
    }
  } catch (err) {
    if (err instanceof HttpError) log("POST /api/op " + op + " rejected: " + err.message);
    throw err;
  }
  log("POST /api/op " + op + " rev " + state.rev);
  sendJson(res, 200, { ok: true, rev: state.rev });
}

async function handlePresence(req, res) {
  const body = await readJsonBody(req);
  const user = body && typeof body === "object" && !Array.isArray(body) ? body.user : null;
  if (!user || typeof user !== "object" || Array.isArray(user)) {
    throw new HttpError(400, "user must be an object");
  }
  if (!isValidId(user.id)) throw new HttpError(400, "user.id must be a string");
  presence.set(user.id, {
    id: user.id,
    name: str(user.name, 40) || "Guest",
    color: str(user.color, 24) || "bone",
    x: Math.round(num(user.x, 0, -10000, 10000)),
    y: Math.round(num(user.y, 0, -10000, 10000)),
    cardId: isValidId(user.cardId) ? user.cardId : null,
    lastSeen: Date.now(),
  });
  schedulePresenceBroadcast();
  sendEmpty(res, 204);
}

// ---------------------------------------------------------------- static files

async function serveStatic(pathname, req, res) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (err) {
    sendText(res, 400, "Bad request");
    return;
  }

  const segments = decoded.split("/");
  for (const segment of segments) {
    if (segment === ".." || segment.indexOf("\\") >= 0 || segment.indexOf(String.fromCharCode(0)) >= 0) {
      sendText(res, 404, "Not found");
      return;
    }
  }

  const cleaned = segments.filter(function (segment) { return segment.length > 0; }).join("/");
  const resolved = path.resolve(PUBLIC_DIR, cleaned);
  const publicRoot = path.resolve(PUBLIC_DIR);
  if (resolved !== publicRoot && resolved.indexOf(publicRoot + path.sep) !== 0) {
    sendText(res, 404, "Not found");
    return;
  }

  let filePath = resolved;
  let stats = null;
  try {
    stats = await fsp.stat(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(resolved, "index.html");
      stats = await fsp.stat(filePath);
    }
  } catch (err) {
    if (cleaned === "favicon.ico") {
      sendEmpty(res, 204); // browsers ask for this even when the app has no icon
      return;
    }
    sendText(res, 404, "Not found");
    return;
  }
  if (!stats.isFile()) {
    sendText(res, 404, "Not found");
    return;
  }

  // Final guard: a symlink inside public/ must not point anywhere outside it.
  try {
    const real = await fsp.realpath(filePath);
    const realRoot = await fsp.realpath(publicRoot);
    if (real !== realRoot && real.indexOf(realRoot + path.sep) !== 0) {
      sendText(res, 404, "Not found");
      return;
    }
    filePath = real;
  } catch (err) {
    sendText(res, 404, "Not found");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || "application/octet-stream";
  const cache = NO_CACHE_EXT.indexOf(extension) >= 0 ? "no-cache" : "public, max-age=86400";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stats.size,
    "Cache-Control": cache,
    "Last-Modified": stats.mtime.toUTCString(),
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath);
  stream.on("error", function () {
    if (!res.headersSent) sendText(res, 500, "Read error");
    else res.destroy();
  });
  res.on("close", function () {
    stream.destroy();
  });
  stream.pipe(res);
}

// ---------------------------------------------------------------- API routing

async function handleApi(req, res, pathname) {
  if (pathname === "/api/state") {
    if (!requireMethod(req, res, "GET")) return;
    sendJson(res, 200, publicState());
    return;
  }
  if (pathname === "/api/health") {
    if (!requireMethod(req, res, "GET")) return;
    sendJson(res, 200, { ok: true, rev: state.rev, cards: state.cards.length, clients: sseClients.size });
    return;
  }
  if (pathname === "/api/events") {
    if (!requireMethod(req, res, "GET")) return;
    openEventStream(req, res);
    return;
  }
  if (pathname === "/api/op") {
    if (!requireMethod(req, res, "POST")) return;
    await handleOp(req, res);
    return;
  }
  if (pathname === "/api/presence") {
    if (!requireMethod(req, res, "POST")) return;
    await handlePresence(req, res);
    return;
  }
  sendJson(res, 404, { ok: false, error: "unknown API endpoint" });
}

async function handleRequest(req, res) {
  const method = req.method || "GET";
  let pathname = "/";
  try {
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
    pathname = url.pathname;
  } catch (err) {
    sendText(res, 400, "Bad request");
    return;
  }

  try {
    if (pathname.indexOf("/api/") === 0) {
      await handleApi(req, res, pathname);
      return;
    }
    if (method !== "GET" && method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      sendText(res, 405, "Method not allowed");
      return;
    }
    await serveStatic(pathname, req, res);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error("[mas-wall] " + method + " " + pathname + " failed:", err);
    if (res.headersSent) {
      try {
        res.end();
      } catch (endErr) {
        /* socket already closed */
      }
      return;
    }
    const headers = status === 413 ? { Connection: "close" } : undefined;
    sendJson(res, status, { ok: false, error: status >= 500 ? "internal server error" : err.message }, headers);
  }
}

// ---------------------------------------------------------------- startup

function lanAddress() {
  const interfaces = os.networkInterfaces();
  const found = [];
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] || []) {
      const family = info.family;
      if (family !== "IPv4" && family !== 4) continue;
      if (info.internal) continue;
      found.push(info.address);
    }
  }
  const pick = function (prefix) {
    return found.find(function (address) {
      return address.indexOf(prefix) === 0;
    });
  };
  return pick("192.168.") || pick("10.") || pick("172.") || found[0] || null;
}

function printBanner() {
  const localUrl = "http://localhost:" + PORT;
  const lan = lanAddress();
  console.log("MAS WALL");
  console.log("  Local    " + localUrl);
  if (HOST === "127.0.0.1" || HOST === "localhost") {
    console.log("  Wi-Fi    (not exposed - HOST=" + HOST + ")");
  } else if (lan) {
    console.log("  Wi-Fi    http://" + lan + ":" + PORT + "   <- share this with classmates");
  } else {
    console.log("  Wi-Fi    http://localhost:" + PORT + "   <- no LAN address found");
  }
  console.log("");
}

function startServer() {
  const server = http.createServer(function (req, res) {
    handleRequest(req, res).catch(function (err) {
      console.error("[mas-wall] unhandled request error:", err);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: "internal server error" });
      else res.destroy();
    });
  });

  server.headersTimeout = 20000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 65000;

  server.on("clientError", function (err, socket) {
    if (!socket.writable || err.code === "ECONNRESET") {
      socket.destroy();
      return;
    }
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  server.on("error", function (err) {
    if (err && err.code === "EADDRINUSE") {
      console.error("[mas-wall] port " + PORT + " is already in use; try PORT=4399 node server.js");
    } else {
      console.error("[mas-wall] server error:", err);
    }
    process.exit(1);
  });

  // SSE heartbeat: keeps proxies/NAT from dropping idle connections and lets
  // dead clients be detected. Contract §4: comment frame every 20s.
  const heartbeat = setInterval(function () {
    for (const client of Array.from(sseClients)) {
      const res = client.res;
      if (res.writableEnded || res.destroyed) {
        dropClient(client, "dead");
        continue;
      }
      try {
        res.write(": ping\n\n");
      } catch (err) {
        dropClient(client, "heartbeat-error");
      }
    }
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref();

  // Presence sweep: prune silent users, then broadcast the roster (contract §4).
  const sweep = setInterval(function () {
    prunePresence();
    broadcastPresence();
  }, PRESENCE_SWEEP_MS);
  sweep.unref();

  async function shutdown(signal) {
    if (shuttingDown) process.exit(0);
    shuttingDown = true;
    log(signal + " received - flushing state and closing");
    clearInterval(heartbeat);
    clearInterval(sweep);
    if (presenceTimer) {
      clearTimeout(presenceTimer);
      presenceTimer = null;
    }
    for (const client of Array.from(sseClients)) {
      try {
        client.res.end();
      } catch (err) {
        /* already gone */
      }
    }
    sseClients.clear();
    server.close();
    if (server.closeIdleConnections) server.closeIdleConnections();
    try {
      await flushState();
    } catch (err) {
      console.error("[mas-wall] final save failed:", err);
    }
    if (server.closeAllConnections) server.closeAllConnections();
    process.exit(0);
  }

  process.on("SIGINT", function () {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", function () {
    void shutdown("SIGTERM");
  });

  server.listen(PORT, HOST, function () {
    printBanner();
  });
}

// ---------------------------------------------------------------- main

/*
 * A malformed request, a broken pipe or a disk hiccup must never take the
 * shared wall down for everybody; log loudly and keep serving.
 */
process.on("uncaughtException", function (err) {
  console.error("[mas-wall] uncaught exception (still serving):", err);
});
process.on("unhandledRejection", function (err) {
  console.error("[mas-wall] unhandled rejection (still serving):", err);
});

loadState()
  .then(function (result) {
    // Always write back on boot: creates data/state.json from the seed on first
    // run, and persists migrated/normalised fields on later runs.
    markStateChanged();
    startServer();
  })
  .catch(function (err) {
    console.error("[mas-wall] failed to initialise:", err);
    process.exit(1);
  });
