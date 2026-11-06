# CONTRACT — MAS WALL (collaborative poster-wall dashboard)

Read this whole file before writing anything. It is the single source of truth for
data shape, HTTP/SSE protocol, DOM hooks, file ownership and acceptance criteria.
Do not change anything in this file without Lead approval. Do not edit files outside
your assigned scope.

## 1. Product

A shareable, real-time collaborative board for a Master's cohort ("MAS") to track
assignments and presentations. It looks like a studio wall of wheat-pasted posters,
not like a SaaS admin table. Anyone who opens the link can add/edit/drag posters and
tick requirements. Changes sync live to every open tab; state persists to disk.

Design read: "student poster wall / risograph studio", dark gallery wall + paper
posters, huge condensed display type, mono metadata, one vermilion accent, playful
but legible. No gradient slop, no glassmorphism-on-everything, no rounded-card
template look, no emoji. MOTION moderate (hover lift, drag tilt, drawer slide),
respect prefers-reduced-motion.

## 2. Stack + file ownership (disjoint writes)

Zero npm dependencies. Node >= 18 built-in http only. Vanilla JS/CSS, no build step.

| Path | Owner | Notes |
|---|---|---|
| server.js | backend | static server + JSON API + SSE + persistence |
| README.md | backend | run/share/deploy instructions |
| public/index.html | visual | full app skeleton, exact IDs from §6 |
| public/styles.css | visual | all styling, tokens from §7 |
| public/preview.html | visual | optional static design prototype, same CSS |
| public/fonts/* | visual | self-hosted woff2 + @font-face |
| public/app.js | interactions | all client behaviour (§8) |
| data/seed.json | Lead | seed content, server copies to data/state.json on first boot |
| data/state.json | server runtime (gitignored) | live state |
| docs/CONTRACT.md | Lead | this file |
| qa/* | QA | screenshots, test scripts, reports |

Never edit a file you do not own. If you need a change in another owner's file,
message the Lead instead.

## 3. State model

```json
{
  "rev": 42,
  "course": {
    "title": "MAS WALL",
    "subtitle": "Assignments, presentations & everything due",
    "term": "Semester 1 · 2026",
    "papers": { "MAS 601": "blush", "MAS 602": "sage" }
  },
  "cards": [Card]
}
```

Card:
```json
{
  "id": "c_ab12cd34",
  "title": "Seminar presentation: Reading the Moving Image",
  "type": "assignment | presentation | other",
  "course": "MAS 601",
  "kind": "Seminar presentation",
  "due": "2026-11-09T23:59:00+06:30",
  "weight": "20%",
  "brief": "12-minute seminar talk on one sequence...",
  "requirements": [{"id": "r1", "text": "12 min talk + 3 min Q&A", "done": false}],
  "notes": "Free text",
  "link": "https://...",
  "x": 70, "y": 90, "w": 360, "rot": -1.4, "z": 1,
  "color": "bone | blush | sage | sky | butter | kraft | lilac",
  "mode": "group | individual",
  "done": false,
  "createdAt": "2026-11-04T12:00:00.000Z",
  "updatedAt": "2026-11-04T12:00:00.000Z"
}
```
- `due` may be null. ISO 8601 with offset. Display in Asia/Rangoon (UTC+06:30).
- `x,y` are pixels inside #wallCanvas (logical canvas 2200 x 1600, scrollable).
- `w` is width in px (300–460). Card height is auto; never persist height.
- `rot` is degrees, keep -3..3. `z` stacking order. `color` controls paper tint.
- Paper colour follows the course. `course.papers` is the source of truth: a map of
  upper-case course code -> one of the seven paper names. A missing code is assigned
  deterministically (djb2 preference, linear probe over colours already in use, codes
  iterated sorted) and persisted with one `course.update`; guests compute the same map
  and never write. Entries are never deleted, so adding courses cannot recolour old ones.
  `color` is the fallback for course-less cards; the drawer disables the swatches when
  a course is set.
- Server may add/normalise fields but must preserve unknown card fields it receives.
- Limits: 400 cards, title <= 200 chars, brief/notes <= 4000, requirement text <= 200,
  max 40 requirements per card.

## 4. HTTP API (server.js, port from `process.env.PORT || 4321`)

- `GET /` -> public/index.html
- static files under public/ only (reject path traversal, correct MIME for
  html/css/js/json/woff2/png/svg/ico)
- `GET /api/state` -> `{rev, course, cards}`
- `GET /api/health` -> `{ok:true, rev, cards, clients}`
- `GET /api/events` -> SSE, `Content-Type: text/event-stream`, no cache, CORS n/a.
  - on connect: send event `hello` with data `{type:"hello", state:{rev,course,cards}, users:[User]}`
  - then one default-message JSON per change:
    - `{type:"card.upsert", card, rev}`
    - `{type:"card.delete", id, rev}`
    - `{type:"course.update", course, rev}`
    - `{type:"presence", users:[User]}`
  - heartbeat comment `": ping\\n\\n"` every 20s; remove dead clients on close/error.
- `POST /api/op` JSON body, 1.5 MB cap, returns `{ok:true, rev}` or 4xx
  `{ok:false, error:"message"}`. Ops:
  - `{"op":"card.upsert","card":{...}}` (create if id unknown; generate id, createdAt/updatedAt)
  - `{"op":"card.delete","id":"..."}`
  - `{"op":"course.update","course":{"title":"..."}}` (shallow merge)
  - unknown op -> 400
- `POST /api/presence` body `{"user":{"id","name","color","x","y","cardId"}}` ->
  204; update map, broadcast presence (throttle broadcast to <= 10/s total).
  Prune users not seen for 75s; broadcast presence every 30s and on join/leave.
- Static fallback 404 for non-API paths; API 404 JSON.
- Persistence: load data/state.json if valid, else copy data/seed.json. Debounced
  atomic save (tmp file + rename) 250ms after change; flush on SIGINT/SIGTERM.
- Log one line per op (method, op, rev) and startup:

```
MAS WALL
  Local    http://localhost:4321
  Wi-Fi    http://<lan-ip>:4321   <- share this with classmates
```

- No auth by design (anyone with link can edit). Note it in README.

## 5. Seed data (Lead-owned data/seed.json)

Server must also serve an offline-safe fallback? No: client offline uses localStorage
cache only. `data/seed.json` stays server-side and is never exposed over HTTP.

## 6. index.html skeleton — required IDs (visual owns markup, keep these exact)

```
body
  #app
    header#masthead .masthead
      .brand: #brandMark ("MAS"), #wallTitle, #wallSubtitle
      #wallTerm, #wallStats (e.g. "8 posters · 3 done")
      #presenceList, #presenceCount, #btnMe (your name/avatar)
      button#btnShare, button#btnAdd, button#btnHelp
    section#deadlineStrip: #deadlineRail (rail items injected)
    div#toolbar .toolbar
      #filterType (chips), select#filterCourse, select#filterStatus,
      input#searchInput, #viewToggle buttons [data-view="wall"][data-view="agenda"],
      #connBadge
    main#stage .stage
      section#wallView: div#wallCanvas (posters injected here) + #wallEmpty
      section#agendaView[hidden]: #agendaGroups
    aside#drawer[aria-hidden="true"] (full drawer form, ids in §6.2)
    div#toasts[aria-live="polite"]
    dialog#nameDialog with #nameInput, #nameSave, #nameCancel
    dialog#helpDialog with #helpClose, keyboard shortcut list
    script[src="/app.js"][defer]
```
Visual may add wrappers/decoration but must not rename or remove these IDs, and
app.js must render correctly into them. #wallCanvas must have `position: relative`.

### 6.1 Card DOM contract (app.js builds it, styles.css styles it)

```html
<article class="poster" data-id data-type data-color
         style="left:Xpx;top:Ypx;width:Wpx;--rot:Rdeg;--z:Z">
  <div class="poster-tape" aria-hidden="true"></div>
  <header class="poster-head">
    <span class="poster-kicker"><span class="poster-course">MAS 601</span><span class="poster-kind">Seminar</span></span>
    <button class="poster-open" data-action="open" aria-label="Open details">⋯</button>
  </header>
  <h2 class="poster-title" tabindex="0">Title</h2>
  <div class="poster-due" data-urgency="late|today|soon|week|later|done">
    <span class="due-day">09</span><span class="due-month">NOV</span>
    <span class="due-count">in 5 days</span>
  </div>
  <p class="poster-brief">one-line clamp</p>
  <ul class="poster-reqs">
    <li class="req">
      <label><input type="checkbox" data-req-id="r1"><span class="req-box"></span><span class="req-text">…</span></label>
    </li>
  </ul>
  <footer class="poster-foot">
    <span class="poster-weight">20%</span>
    <span class="poster-progress" style="--p:60"><span class="ring"></span><span class="poster-pct">3/5</span></span>
  </footer>
</article>
```
- Whole card is the drag target; clicks on buttons/checkbox/link must not start a drag.
- Add class `is-done` on article when card.done. Add `is-dragging` while dragging.
- Hidden state uses `[hidden]`, never display:none inline.

### 6.2 Drawer IDs (static markup, app.js fills)

#drawerKicker, #drawerTitleInput, #drawerTypeSelect, #drawerCourseInput,
#drawerKindInput, #drawerModeSelect, #drawerDueDate, #drawerDueTime, #drawerWeightInput,
#drawerBriefInput, #drawerNotesInput, #drawerLinkInput, #drawerColorGroup
(buttons `[data-color]`), #drawerDoneToggle, #drawerDueBadge, #drawerProgress,
#drawerReqs, #btnAddReq, #btnDuplicateCard, #btnDeleteCard, #drawerSaveState,
#drawerClose, #drawerBackdrop, #drawerTitle (dialog accessible name).
Drawer edits autosave (debounce 350ms) via `card.upsert`; no Save button.

## 7. Visual tokens (visual owns exact CSS; these are the direction)

- Dark wall #1B1915 (warm graphite), subtle 40px grid + paper grain overlay.
- Poster papers: bone #EFE8D8, blush #F2D8CE, sage #D9E2CE, sky #D7E2E8,
  butter #F0E3BB, kraft #E6D5B8, lilac #DED7E6; all with ink #171410 and a hairline
  rule. Colour is a course key, not decoration: seven papers cover a seven-course term.
- Accent vermilion #E8451F (primary actions, today/late), secondary teal #1F6B5E
  used sparingly. UI text on wall: #F4EEE2 / #A79E8C.
- Fonts self-hosted woff2 in public/fonts + @font-face + system fallback:
  - display: Anton (all-caps masthead, big due day numbers) — use sparingly
  - UI/body: Archivo (or Archivo variable) 400/600/800
  - mono: JetBrains Mono (dates, counts, kickers, labels)
  Download from Google Fonts css2 endpoint with a browser UA, keep total <= 400 KB.
  No runtime CDN font requests, no @import of external CSS.
- Sharp-ish corners (2-4px), hard paper shadows, 1px ink rules, tape strip on cards,
  slight rotation. No purple, no glass cards, no gradients as decoration.
- Layout: masthead (brand left, stats+presence+actions right), deadline rail as a
  scrollable filmstrip of the next 8 deadlines, toolbar with filter chips, course/status
  selects and search, freeform canvas stage, right drawer 420px (full-screen < 900px).
  The chrome condenses on stage scroll (masthead 88->58px, rail 124->72px).
  Agenda: at >=1200px a two-column layout — deadline groups left, a sticky course
  overview (overdue/this-week/done counts, per-course paper swatch, poster count and
  requirement progress; course rows double as filters) right. Single column below.
- Responsive: <900px agenda default, toolbar becomes two rows (the filter strip scrolls
  horizontally), drawer full-screen, no horizontal page overflow; canvas still
  pannable/scrollable on desktop and phones (rail hidden in the mobile agenda view).
- Presentation: P (or the Present button) enters a read-only presenter — fullscreen when
  allowed, chrome hidden, whole-wall overview first; arrow keys/Space step through the
  visible posters in due order (done last), O returns to overview, Esc/P exits and
  restores the previous transform and scroll. HUD bottom-centre, no edits in mode.
- States: loading, empty, offline banner, toasts, hover/active/focus-visible,
  reduced-motion. Contrast: body text >= 4.5:1.
- Navigation: Fit control / F key zooms the wall out so every poster is in view
  (scale floor 0.16 on narrow stages, 0.35 on desktop); arrow keys nudge a focused
  poster 10px (Shift 40px) for keyboard users.
- Motion: 160–220ms cubic-bezier(.2,.7,.2,1); poster hover lift 3px; drag tilt to 0;
  drawer transform slide; toast fade; no infinite decorative animation.

## 8. app.js responsibilities (interactions)

1. Boot: fetch /api/state; connect EventSource /api/events; reconnect with backoff
   (1s -> 8s, cap); header connBadge state live|connecting|offline; localStorage cache
   `mas-wall:v1` used when server unreachable (offline edits local-only + banner).
2. Render: masthead stats, deadline rail (next 8 not-done, sorted), cards, agenda view,
   filters/search (type, course, status, text; status = all|open|done|late|week),
   view toggle, empty state.
3. Drag: pointer events on .poster, transform via left/top, 8px snap, clamp inside
   canvas, z-index top while dragging, persist x/y/z on pointerup (card.upsert).
   Disable drag for coarse pointers (matchMedia '(pointer: coarse)') and while a
   dialog/drawer is open? (drawer open is fine; drag disabled inside form controls).
4. Create: #btnAdd -> card at viewport center with defaults, open drawer, focus title.
   Keyboard "n" also creates.
5. Drawer: open card, bind fields, autosave debounce, requirements add/remove/toggle,
   due date+time <-> ISO (+06:30 when no offset), delete with confirm, duplicate.
   Esc closes; focus trap basics; return focus to card.
6. Requirement checkbox on card toggles => card.upsert (optimistic) + recompute progress,
   done state auto when all requirements done? No: `done` only via drawer toggle.
7. Presence: assign me id (crypto.randomUUID) + name (localStorage, default "Guest N"),
   color from palette; send on load, name change, every 25s, and after drag/scroll
   (throttle 150ms); render avatars; show "N online".
8. Share: #btnShare copies URL (navigator.clipboard with fallback), toast; if
   `navigator.share` available offer native share via long-press? Just copy.
9. Keyboard: n=new, /=search, Esc=close, ?=help, g=wall/agenda toggle. Don't fire in
   inputs/contenteditable.
10. Robustness: escape all user text (textContent, never innerHTML with user data),
    preserve local state on SSE error, no duplicate cards on repeated events, ignore
    echo of own writes safely (upsert by id).
11. Never call the API with more than ~6 req/s per user; debounce text edits.

## 9. Acceptance criteria (QA verifies)

1. `node server.js` starts; /api/state returns 8 seed cards; page renders all of them.
2. In two browser contexts, adding a card / ticking a requirement / dragging a card in
   one appears in the other within ~1s without reload.
3. Reload keeps every change (state.json persisted).
4. Due urgency labels correct for late / today / soon / later; date visible on card
   and in drawer; requirements readable on card and editable in drawer.
5. Drag works with mouse, persists after reload, card cannot be lost outside canvas.
6. Filters, search, agenda/wall toggle, add, delete, duplicate, done toggle work.
7. 1440px, 1024px and 390px screenshots: no overlap/clipping/overflow problems, drawer
   usable on mobile.
8. No console errors; localStorage offline fallback works when server is stopped.
9. README explains: run, share on Wi-Fi, deploy, where data lives, that edits are open.

## 10. Verification cheatsheet

```bash
PORT=4399 node server.js &
curl -s localhost:4399/api/health
curl -s -X POST localhost:4399/api/op -H 'content-type: application/json' \
  -d '{"op":"card.upsert","card":{"id":"c_test","title":"Test","type":"assignment","course":"MAS 000","x":100,"y":100,"w":320,"rot":0,"color":"bone","requirements":[]}}'
```
Screenshot (Chrome is installed):
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --hide-scrollbars --no-first-run --user-data-dir=/tmp/mas-chrome \
  --window-size=1440,1000 --virtual-time-budget=4000 \
  --screenshot=qa/home-1440.png http://127.0.0.1:4399/
```
Always stop test servers when done, and never bind port 4321 in tests.
