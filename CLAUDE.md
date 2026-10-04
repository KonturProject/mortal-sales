# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Mortal Sales** — a Phaser 4 + Vite + TypeScript browser game for an office display, forked on 2026-09-29 from the live "Отделы против дракона"
(`KonturProject/sales-vs-dragon`, which is a separate, running product — never touch its repo, sheet or Web App from here). Six pixel-art department
mascots (the same heroes) are the leaders (РГ, "группа") of six sales departments; they are set in 3 pairs and fight Mortal-Kombat style in a temple
courtyard, three on each side, seen from a distance. Every import of "invoices from 20 minutes" per manager (about every 2 hours, uploaded through the
admin page) starts a round of fights; the admin ends the *game day* with a button, which plays a finale ("FINISH HER!") and gives a star (one per day won,
at most 5 per leader per week; a week starts with none) to each pair's winner. After 5 days the pair's match goes to the one with more stars. A rating of all managers (absolute invoice counts)
is shown in two side panels. Russian UI everywhere.

**The central rule: fights and day results compare AVERAGE invoices per active employee** (day total / staff of the department), never raw totals — a bigger
department must not win by size. Staff = active managers on the roster (an inactive one — vacation, left — is outside). The managers' own ranking stays absolute.
Everything about this rule lives in `FightPlanner.ts` (the game) and `pairWinner_` / `finishDay` in `apps-script/Code.gs` (the backend) — keep them in step.
How *hard* a fight is depends on the **target** average per employee (1.20, an admin setting `TargetAvg`, delivered as `targetAvg` in the status): the lead is measured in shares of it.

**Documentation** (Russian, kept current — update it with the code): `docs/README.md` is the index — `01-igra` rules and mechanics, `02-arhitektura` technical reference and file map,
`03-admin` the admin's handbook, `04-zapusk` setup/operations/troubleshooting, `05-izmeneniya` change log and open tasks, `06-proverka` QA report (what was verified, 30 bugs found/fixed, what was not).
`docs/superpowers/specs/2026-09-29-mortal-sales-design.md` is the approved design record; `docs/archive/` describes the old dragon game and is historical (except its performance notes in `tech.md`).

## Isolation (don't undo)

Own repo `KonturProject/mortal-sales` (public, `origin`; `main` starts from one squashed commit — the full local history is on branch `master` and is NOT to be pushed: an early commit holds a name-like
string in a test fixture). `npm run deploy` runs `game/tools/deploy-guard.mjs` first (refuses a missing remote or anything containing "sales-vs-dragon") and publishes `dist` to `gh-pages`
(site https://konturproject.github.io/mortal-sales/). `game/public/config.json` holds the Web App URL of the new Apps Script (`useMock: false`; public on purpose — it answers nothing without the display key).
The repo's `Code.gs` keeps the placeholder `SPREADSHEET_ID`: the deployed copy (container-bound script of the new sheet "Mortal Sales - данные", deployed by hand) has the real one, and the PIN is set from the sheet's menu
"Mortal Sales" — neither is ever committed.
**Employee data never goes into git**: `*.xlsx/*.xls/*.csv` are ignored, mock data (`tools/make-mock-status.mjs`, `apps-script/test/mock-roster.json`) is
invented. The announcer clips and the fight theme in `game/public/assets/audio/` ARE committed and published on Pages — the owner decided so
(2026-10-04, non-commercial office display). The owner drops raw files into the git-ignored `sounds/` (and art into `game/assets-source/animation and new model/`)
while you work: read `git status` before every commit and stage by path.

## Commands

All from `game/` (the Vite project; the repo root is a wrapper).

```bash
npm run dev                 # dev server http://127.0.0.1:8080 (bound to IPv4 on purpose: "localhost" can resolve to ::1 only and the preview pane can't reach it)
npm run build               # production build to game/dist: two entries, index.html (game) + admin.html
npx tsc --noEmit -p tsconfig.json
npm run test:fight          # node --test, 33 tests: FightPlanner, pure game logic (FightPairs, names), admin file parsers (node >= 22.18 runs the .ts directly — so the pure modules import with explicit .ts and `import type`; the parser tests also read the real xlsx files from the repo root when present)
npm run test:backend        # node --test, 50 tests: the real apps-script/Code.gs against fake Google services
npm run serve-dist          # the production build under /mortal-sales/ like GitHub Pages (http://127.0.0.1:8090/mortal-sales/) — run `npm run build` first
npm run mock-backend        # Code.gs on http://127.0.0.1:8787/exec (PIN 1234, display key mock-display-key-1234, 65 invented managers, in memory)
node tools/make-mock-status.mjs   # regenerate public/assets/mock/mock-status.json and apps-script/test/mock-roster.json (invented names)
python tools/build-sprites.py     # hero sprites from assets-source/character-refs + "animation and new model" (Pillow); output is byte-identical to what is shipped.
                                  # New poses: add (file, factor) to HEROES; tune the factor on a contact sheet (head/crown = the standing sprite's), bump `hits` in heroRoster.json
```

Try the whole thing locally: `npm run mock-backend`, then game `http://127.0.0.1:8080/?backend=http://127.0.0.1:8787/exec#key=mock-display-key-1234` and admin
`http://127.0.0.1:8080/admin.html?backend=http://127.0.0.1:8787/exec` (`?backend=` works in dev builds only). `tsc` + the two test suites are the automated checks;
anything visual needs the browser (see Verification).

## Architecture

**Data flow**: Google Sheet (tabs `Команда`, `Подразделения`, `Пары`, `Снимки`, `Дни`, `Настройки` — see `apps-script/README.md`) ← Apps Script Web App
(`apps-script/Code.gs`, deployed by hand) ← admin page (`src-admin/`, PIN) for every change; the game only reads. `DataPollingService` polls `GET ?key=<display key>`
every 15 s (hedged fetch for Apps Script's slow tail, one poll in flight, baseline on the first poll), applies it to `GameState` and emits on the `EventBus`:
`FIGHT_ROUND` (a new import id: pairs whose day sums grew — `systems/FightPairs.ts`), `FINALE` (a backend `finale` command), `ADMIN_COMMAND` (demo/visual commands), `DATA_UPDATED`, `FETCH_ERROR`.
Arena → HUD events: `FIGHT_START`/`FINALE_START` (the arena *really* begins; the first events may wait in its queue), `BLOW`, `FIGHT_END`, `FINALE_PAIR`, `FINALE_END` (always sent, in a `finally`). `process()` order matters: apply state → detect fight → dispatch commands → `DATA_UPDATED`.
The display key (`#key=` in the page URL, remembered in localStorage) is required by the backend: the status holds names and results.

**Two parallel scenes**, both launched from `Preloader`, talking only through the EventBus: `ArenaScene` (fighters, background, queue of rounds/finales) and
`HUDScene` (three `PairLifebar` rows with `StarRow`s on top, `ManagerBoard` panels, day counter, FIGHT!/finale titles, connection + mute). `fitCameraToGame(this)` first
in every scene's create (render scale below). Layout constants are all in `core/Constants.ts` (`ARENA.LANES`, `FIGHT`, `FINALE`, `LIFEBAR`, `BOARD`, `MATCH`).

**Arena**: pair i stands in lane i (back/middle/front, smaller/higher → bigger/lower for the distant view); the pair's first leader on the left, the second mirrored on the right.
The background `bg_arena.jpg` has only ~20 % floor, hence the narrow lanes and the rating panels on the sky; retune `ARENA.LANES` if the background changes. The three pairs
meet at different x (`clashX`) so neighbours don't stand on each other. `Fighter` (`objects/Fighter.ts`) is a feet-anchored container; every move is a Promise that resolves when it
has *landed* (a strike: at contact): `walkTo/stepIn/goHome`, `strike(target, kind, onImpact)`, `react(kind, push)` (`flinch/stagger/stun/knockdown/launch`), `getUp`, `celebrate`, `bow`,
`stayDown`. **One move at a time**: every move starts with `halt()` (kills the container's and the sprite's tweens, resets the sprite pivot, takes a new `epoch`) and every `await` goes through
`step()`/`rest()`, which return false when another move took over — an interrupted move must then return, or its tail would swap the pose and start a tween in the middle of the new move. Moves use art from the hero's pools when it exists (`RosterConfig.poseKeys`: `hit1..N` (heroRoster.json `hits`) = attack, plus the hand-maintained `config/heroMoves.json` for kick/heavy/hurt/stun/knockdown/fly/ko/win
— a hit pose listed there as `kick`/`heavy` is preferred for that blow; Grinch: kick = hit2, heavy = hit3 (jump), Scrooge: heavy = hit2 (money-bag swing);
with optional `_L` left-facing variants) and fall back to plain tweens (recoil, squash, topple about the feet, spin about the body centre). `core/Async.ts` has `sleep`, `tweenTo`
(resolves even if the tween is killed — never `await` a raw tween), `hitStop`. Right-hand fighters are mirrored (`flipX`); a hand-drawn `_L` texture wins when listed.
A toppled body reaches a body length beyond its feet: `Fighter.lieX` keeps it inside the walls.

**Fight mechanics** (`systems/FightPlanner.ts`, pure, tuning in `FIGHT_TUNING`): `D = min(1, |a−b| / target)` of the two AVERAGES (so 1.92 vs 2.42 with a 1.20 target is 42 % of the target = domination), damped by evidence `min(1, sample/10)` (sample = raw invoices of both
groups), leader blows `2 + round(6·D_eff)`, trailing side `max(1, round(nL·(1−D_eff)^1.6))` (both always fight), four tiers (even / upper hand = stun / domination = knockdown / rout = launch across the
arena with screen shake and hit-stop). `FightDirector` turns a plan into choreography per pair; `ArenaScene` runs the pairs of a round side by side and queues rounds/finales one after another.
The finale: per pair "FINISH HER!", two blows and a heavy one that launches the loser; at the landing `FINALE_PAIR` makes the HUD light the winner's next star (`StarRow.earnStar`)
and the announcer says "Fatality" ("Flawless victory" when the loser had no invoices that day). After the last day the matches are decided;
the arena then shows the verdict statically (winners labelled, losers down) — also when a display is opened after the week ended.

**Sound** (`systems/Audio.ts`, one Web Audio graph under the mute button — muted by default, the speaker icon bottom-right turns it on and it is remembered):
synthesized effects (hits, falls, the star chime) plus recorded clips (`CLIP_FILES`: fetched at start, decoded once the AudioContext exists, played from their first audible
sample — the files carry ~0.3–0.7 s of silence). A real round opens with "РАУНД N" + "Round one/two/three" (N = `lastImport.round`, the import's number in the game day,
from the backend; rounds after 3 get only the title), and `FIGHT.ROUND_INTRO_MS` later "FIGHT!" — the arena waits the same time before the fighters move. Both waits use the
wall clock (`wallSleep`): the scene clock leaps when PowerSaver lifts the frame-rate limit, the voices do not. The fight theme (`theme.mp3`, 74 s loop) is held by every round
and finale (`holdTheme`/`releaseTheme`, a counter), ducks under the announcer, fades out 2.5 s after the last release and resumes where it stopped. A missing clip falls back
to the synthesized stinger (or silence).

**Baseline & staleness gotchas** (all deliberate): the first poll after page load only sets the baseline — no fight, no finale replay, commands older than `POLL.COMMAND_MAX_AGE_MS` by the
*backend's* clock are dropped. `HUDScene` keeps a pair's lifebars (`lockForRound`) and stars (`holdStars`) at the "before" picture while the round/finale animates, because the poll that carries the
event also carries the new numbers; the `FINALE` command is dispatched before `DATA_UPDATED` for exactly this reason. Both holds are **counters** (a round and a finale can overlap), and the HUD's
"current round / finale" is set when the arena *starts* it, not when the event arrives. `ArenaScene.syncWithState` skips re-seating while anything is queued; a pair only fights if
`seatedPair()` says both leaders really stand opposite each other. `DataPollingService.start()` keeps retrying `config.json` (a kiosk may boot before its network); status answers and finales that
are malformed are refused (`isUsableStatus` / `isUsableFinale`).

**Render scale / performance** (`core/Quality.ts`, `core/PowerSaver.ts`, unchanged from the original game): the canvas buffer is `GAME.RENDER_SCALE`× the logical 1280×720, chosen per device;
every `add.text` style needs `resolution: GAME.RENDER_SCALE` (use `hudText()` in `core/TextStyles.ts`); `PowerSaver` drops to 10 fps when nothing moves (wakes on `FIGHT_ROUND`/`FIGHT_START`/`FINALE`/`FINALE_START`/`ADMIN_COMMAND`).
The game runs on weak office laptops: **no endless tweens, no per-object random timers** — everything is a finite tween or a static pose (rating page turns are a timer + a short fade).
URL overrides for testing: `?quality=low|high`, `?scale=1.25`, `?fps=30`, `?idlefps=5`. **No glow/shadow effects on characters** (a brief tint flash on a hit is fine).

**Admin** (`src-admin/`, plain DOM, no Phaser; tabs in `tabs/`): День и неделя (standings, finish day, new week, manual stars, days per week) · Загрузка данных (file/paste → preview with checks → import) ·
Сотрудники (roster: move department, activate/deactivate, rename, delete, add, import roster from file) · Пары и отделы · История · Анимации (demo fight/finale/confetti) · Доступ (display key, PIN).
`parse.ts` (pure, tested) turns xlsx/CSV/pasted text into rows; `readFile.ts` reads .xlsx with `read-excel-file/universal` in the browser (nothing is uploaded except the checked import).
Everything shown comes from a sheet: build DOM with `h()` (text nodes), never `innerHTML`. The PIN lives in memory only.

**Backend** (`apps-script/Code.gs`): the sheet is the source of truth; all writes under a script lock and idempotent on `requestId`; the public GET is cached 10 s and every write drops the cache;
PIN = salted hash in Script Properties with lockout after 5 tries; user text is rejected if it starts with `= + - @` (formula injection); counts must be whole numbers ≥ 0 (`strictNumber_`: null/'' are not 0);
department codes are accepted however typed (`validDept_`: spaces, Latin look-alikes); the command queue is trimmed to stay under the 9 KB property limit; the status is rebuilt under the lock; an import is all-or-nothing
(unknown names / decreases are refused with lists unless the admin decided). Never delete whole sheet rows. Departments are fixed to the six codes of the game's mascots
(`DEPT_CODES` ↔ `config/ropMapping.json`). `Code.gs` is deployed by hand; test it first with `npm run test:backend`.

## Debug hooks (`window.__debug`, dev builds only)

Call `__debug.poller.stop()` first, or the next poll overwrites what you inject. `fight(pairId, leftAvg, rightAvg, sample?)` (demo round), `plan(a, b, {sample, target})`,
`importCounts({'СР1': 12, ...})` (a real import through the pipeline: day TOTALS), `finishDay({1: 'СР1', 2: 'draw'})` (a real, non-demo finale + new state), `finale({...})` (demo finale), `newWeek()`,
`command(type, args)`, `injectStatus(status)`, `arena()` (the scene: `fighters` map), `power()`, `audio`, plus `EventBus`/`GameEvents`/`GameState`/`game`.

## Verification

Visual/animation changes: start the dev server, `__debug.poller.stop()`, drive the event with the hooks above and confirm — screenshots of fast animations are unreliable, so also read state
(`arena().fighters.get('СР1').x/angle`, `hud.lifebars[i].left.stars.value`) or sample it with `setInterval`; slow time with `scene.tweens.timeScale = scene.time.timeScale = 0.3` to catch a pose.
A Vite reload (HMR) wipes your injected state and listeners — wait for it before injecting. The full chain (admin import → fights → finish day → finale) was verified on the mock backend with the real xlsx files.
`npx tsc --noEmit` catches type errors but proves nothing about runtime behaviour.
A hidden tab (the desktop app's pane when the window is minimised or the screen locked: `document.hidden`) pauses the game loop and throttles timers — the picture
freezes mid-animation. Then drive a headless Chrome (puppeteer-core with the installed chrome.exe, `--autoplay-policy=no-user-gesture-required`) and take timed screenshots.

Dev-only URL parameters: `?backend=<url>` (talk to the mock backend) and `?pollms=2000` (poll every 2 s instead of 15).

## Open items

Extra poses from the user (hurt/stun/knockdown/fly/ko/win art; more attacks), (`assets-source/new-game/README.md`), tuning `FIGHT_TUNING` thresholds on real numbers, a full pass of the admin flow on the real backend (finish day / new week on a copy of the sheet first).
Ideas: undo for "finish day".
