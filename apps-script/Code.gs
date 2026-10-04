/**
 * Backend for "Mortal Sales": the six department groups (РГ) fight in pairs on the office display, fed by the
 * invoice counts the admin imports about every two hours.
 * Container-bound script (created from the sheet: Extensions > Apps Script) — it still opens the spreadsheet explicitly by ID via getSpreadsheet_().
 *
 * The sheet is the single source of truth, in plain tabs a human can read and fix (column ORDER matters, the
 * header names do not; missing tabs are created with their headers on first use — see ensureSheets_):
 *   "Команда"       ФИО | Подразделение | Активен | За день | За неделю до сегодня    one row per manager
 *   "Подразделения" Код | Название | РГ | Звёзды | Побед | Поражений | Ничьих         one row per department code
 *   "Пары"          № | Слева | Справа                                                 who fights whom
 *   "Снимки"        Импорт | Время | День | ФИО | Подразделение | Счетов | Изменение   every import, append-only
 *   "Дни"           День | Неделя | № в неделе | Время | Подразделение | Счетов | Людей | Среднее | Пара | Итог | Звёзды после   finished days
 *   "Настройки"     Ключ | Значение                                                    counters and the week's state
 *
 * HTTP API (one Web App URL):
 *   GET ?key=<display key>  public aggregates for the screens: period, pairs, groups (stars, staff, sums), managers,
 *                           the last import (day sums before/after) and recent admin "commands". Refused without the key.
 *   POST (JSON, sent as text/plain to avoid a CORS preflight) — every action needs the admin PIN:
 *     login · changePin · getAdminState · saveManager · deleteManager · importRoster · saveDepartment
 *     importSnapshot · listSnapshots · listDays · setPairs · finishDay · newPeriod · setStars · setSettings
 *     setDisplayKey · getDisplayKey · command            (details: apps-script/README.md)
 *
 * The PIN and the display key live ONLY in PropertiesService (a salted hash for the PIN), never in this file
 * and never in the sheet — see setAdminPin_() below, run once manually.
 */

// Deliberately NOT the sheet of the original "sales-vs-dragon" game. Put the ID of the new spreadsheet here.
var SPREADSHEET_ID = 'REPLACE_WITH_NEW_SPREADSHEET_ID';

/** One department code per mascot of the game (game/src/game/config/ropMapping.json). */
var DEPT_CODES = ['СР1', 'СР2', 'СР3', 'СР5', 'СР6', 'СР9'];
var DEFAULT_PAIRS = [['СР1', 'СР3'], ['СР2', 'СР5'], ['СР6', 'СР9']];
/** A star is a day won this week (0..STARS_MAX): the star slots of the screen, and so also the longest match (days per week). */
var STARS_MAX = 5;
var MAX_PAIRS = 3;
var DEFAULT_DAYS_PER_PERIOD = 5;
/** Average invoices per employee that counts as a good result; the screens measure the size of a lead against it. */
var DEFAULT_TARGET_AVG = 1.2;
var MAX_IMPORT_ROWS = 500;
var MAX_COUNT = 100000;

var SCHEMAS = {
  team: { name: 'Команда', headers: ['ФИО', 'Подразделение', 'Активен', 'За день', 'За неделю до сегодня'] },
  depts: { name: 'Подразделения', headers: ['Код', 'Название', 'РГ', 'Звёзды', 'Побед', 'Поражений', 'Ничьих'] },
  pairs: { name: 'Пары', headers: ['№', 'Слева', 'Справа'] },
  snaps: { name: 'Снимки', headers: ['Импорт', 'Время', 'День', 'ФИО', 'Подразделение', 'Счетов', 'Изменение'] },
  days: { name: 'Дни', headers: ['День', 'Неделя', '№ в неделе', 'Время', 'Подразделение', 'Счетов', 'Людей', 'Среднее', 'Пара', 'Итог', 'Звёзды после'] },
  settings: { name: 'Настройки', headers: ['Ключ', 'Значение'] }
};

/** 'salt$sha256hex' of the PIN, written by storePin_(). */
var PIN_HASH_PROPERTY_KEY = 'ADMIN_PIN_HASH';
/** The key the office screens put in their GET (random, set from the admin page). */
var DISPLAY_KEY_PROPERTY_KEY = 'DISPLAY_KEY';
var COMMANDS_PROPERTY_KEY = 'COMMANDS';
var COMMAND_SEQ_PROPERTY_KEY = 'COMMAND_SEQ';
var STATUS_CACHE_KEY = 'status_core_v1';
var STATUS_CACHE_SEC = 10;
/** Script Properties hold 9 KB per value; the command queue is trimmed (oldest first) to stay well below it. */
var COMMANDS_MAX_JSON = 7500;
/** History tabs grow forever: listing reads only this many of the newest rows. */
var HISTORY_SCAN_ROWS = 4000;

/** After this many wrong PINs within PIN_FAILURE_WINDOW_SEC the admin API refuses everything for PIN_LOCK_SEC. */
var MAX_PIN_FAILURES = 5;
var PIN_FAILURE_WINDOW_SEC = 600;
var PIN_LOCK_SEC = 600;

var COMMAND_KEEP = 10;
var COMMAND_MAX_AGE_MS = 10 * 60 * 1000;
var REQUEST_CACHE_SEC = 600;

/** Opening the spreadsheet is the slow part of a request (~0.5 s); do it once per execution, not once per helper. */
var spreadsheet_ = null;
function getSpreadsheet_() {
  if (!spreadsheet_) spreadsheet_ = SpreadsheetApp.openById(SPREADSHEET_ID);
  return spreadsheet_;
}

/**
 * Functions ending in "_" are private: the editor's Run list does not show them. Use the spreadsheet's "Mortal Sales" menu instead
 * (menuSetup / menuSetPin below call these). The admin page can change the PIN and the display key afterwards.
 *  - setup_()        creates every missing tab with its headers and default rows
 *  - setAdminPin_()  legacy: sets the PIN from a literal in the code (prefer the menu; never leave a real PIN in the code)
 */
function setup_() {
  ensureSheets_();
  Logger.log('Tabs are ready: ' + Object.keys(SCHEMAS).map(function (k) { return SCHEMAS[k].name; }).join(', '));
}

function setAdminPin_() {
  var pin = '0000'; // CHANGE THIS, run once, then remove the literal.
  storePin_(pin);
}

/**
 * When the script is bound to the spreadsheet (Extensions > Apps Script), the sheet gets a "Mortal Sales" menu so that
 * the owner can prepare the tabs and choose the PIN in a Google dialog — the PIN is never typed into the code.
 * (These two are not reachable from the web: only doGet/doPost are.)
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Mortal Sales')
    .addItem('1. Подготовить таблицу', 'menuSetup')
    .addItem('2. Задать PIN администратора', 'menuSetPin')
    .addToUi();
}

function menuSetup() {
  ensureSheets_();
  SpreadsheetApp.getUi().alert('Готово', 'Вкладки созданы: ' + Object.keys(SCHEMAS).map(function (k) { return SCHEMAS[k].name; }).join(', ') + '.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuSetPin() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.prompt('PIN администратора', 'От 4 до 12 цифр. С ним вы входите в админку; запомните его — здесь он не хранится, только его хеш.', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  var pin = String(answer.getResponseText()).trim();
  if (!/^\d{4,12}$/.test(pin)) {
    ui.alert('PIN не сохранён', 'Нужны только цифры, от 4 до 12 штук.', ui.ButtonSet.OK);
    return;
  }
  storePin_(pin);
  ui.alert('PIN сохранён', 'Теперь его можно вводить в админке.', ui.ButtonSet.OK);
}

/* ------------------------------------------------------------------ entry points */

function doGet(e) {
  try {
    var denied = checkDisplayKey_(e && e.parameter ? e.parameter.key : '');
    if (denied) return jsonResponse_(denied);

    var core = readStatusCache_();
    if (!core) {
      // Rebuild under the script lock so that a write in progress (team written, settings not yet) is never half-read.
      // If the lock is busy for too long, serve anyway: a screen would rather show a second-old picture than nothing.
      var lock = LockService.getScriptLock();
      var locked = false;
      try { locked = lock.tryLock(4000); } catch (err) { locked = false; }
      try {
        core = readStatusCache_() || buildStatus_(loadModel_());
        writeStatusCache_(core);
      } finally {
        if (locked) lock.releaseLock();
      }
    }
    core.commands = readRecentCommands_();
    core.serverNow = Date.now();
    return jsonResponse_(core);
  } catch (err) {
    return jsonResponse_({ ok: false, error: 'server_error', detail: String(err) });
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ ok: false, error: 'bad_request', detail: 'body is not JSON' });
  }
  if (!body || typeof body !== 'object') return jsonResponse_({ ok: false, error: 'bad_request', detail: 'body is not an object' });

  try {
    var action = body.action || '';
    var handler = ACTIONS_.hasOwnProperty(action) ? ACTIONS_[action] : null;
    if (!handler) return jsonResponse_({ ok: false, error: 'bad_request', detail: 'unknown action' });

    var denied = authorize_(body.pin);
    if (denied) return jsonResponse_(denied);

    // A retried request (double click, flaky connection) must not run twice.
    var requestId = body.requestId ? String(body.requestId).slice(0, 64) : '';
    var cacheKey = requestId ? 'req_' + action + '_' + requestId : '';
    if (cacheKey) {
      var earlier = CacheService.getScriptCache().get(cacheKey);
      if (earlier) return jsonResponse_(JSON.parse(earlier));
    }

    var result = handler(body);
    if (cacheKey && result.ok) CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), REQUEST_CACHE_SEC);
    return jsonResponse_(result);
  } catch (err) {
    // Not the caller's fault (a missing sheet, a lock that could not be taken, ...): say so, instead of blaming the request.
    return jsonResponse_({ ok: false, error: 'server_error', detail: String(err) });
  }
}

var ACTIONS_ = {
  login: function () { return { ok: true }; },
  changePin: actionChangePin_,
  getAdminState: actionGetAdminState_,
  saveManager: actionSaveManager_,
  deleteManager: actionDeleteManager_,
  importRoster: actionImportRoster_,
  saveDepartment: actionSaveDepartment_,
  importSnapshot: actionImportSnapshot_,
  listSnapshots: actionListSnapshots_,
  listDays: actionListDays_,
  setPairs: actionSetPairs_,
  finishDay: actionFinishDay_,
  newPeriod: actionNewPeriod_,
  setStars: actionSetStars_,
  setSettings: actionSetSettings_,
  setDisplayKey: actionSetDisplayKey_,
  getDisplayKey: actionGetDisplayKey_,
  command: actionCommand_
};

/* ------------------------------------------------------------------ sheets as tables */

/** Creates every missing tab with its headers (and, for departments, pairs and settings, their default rows). */
function ensureSheets_() {
  Object.keys(SCHEMAS).forEach(function (key) { sheetOf_(key); });
}

function createSheet_(key) {
  var sheet = getSpreadsheet_().insertSheet(SCHEMAS[key].name);
  var headers = SCHEMAS[key].headers;
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (sheet.setFrozenRows) sheet.setFrozenRows(1);
  var seed = defaultRows_(key);
  if (seed.length) sheet.getRange(2, 1, seed.length, headers.length).setValues(seed);
  return sheet;
}

function defaultRows_(key) {
  if (key === 'depts') return DEPT_CODES.map(function (code) { return [code, '', '', 0, 0, 0, 0]; });
  if (key === 'pairs') return DEFAULT_PAIRS.map(function (p, i) { return [i + 1, p[0], p[1]]; });
  if (key === 'settings') return settingsRows_(defaultSettings_());
  return [];
}

/** The tab of a table; if somebody deleted or renamed it, it is created again (with its defaults) instead of failing every request. */
function sheetOf_(key) {
  return getSpreadsheet_().getSheetByName(SCHEMAS[key].name) || createSheet_(key);
}

/** Data rows (below the header) as arrays, in sheet order. `tail` = read only that many of the newest rows (history tabs). */
function readRows_(key, tail) {
  var sheet = sheetOf_(key);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var first = tail ? Math.max(2, last - tail + 1) : 2;
  return sheet.getRange(first, 1, last - first + 1, SCHEMAS[key].headers.length).getValues();
}

/** Replaces all data rows of a small table (never deletes sheet rows — only clears cells). */
function writeRows_(key, rows) {
  var sheet = sheetOf_(key);
  var width = SCHEMAS[key].headers.length;
  var last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, width).clearContent();
  if (rows.length > 0) sheet.getRange(2, 1, rows.length, width).setValues(rows);
}

function appendRows_(key, rows) {
  if (rows.length === 0) return;
  var sheet = sheetOf_(key);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, SCHEMAS[key].headers.length).setValues(rows);
}

/* ------------------------------------------------------------------ model */

function num_(value, fallback) {
  var n = Number(value);
  return value === '' || value === null || value === undefined || !isFinite(n) ? fallback : n;
}

/** A number, or NaN: unlike Number(), null / '' / true are not "0" or "1" — an empty cell in an import file must not pass as a count. */
function strictNumber_(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

function isActive_(value) {
  if (value === false) return false;
  return !/^(false|нет|no|0)$/i.test(String(value).trim());
}

function parseJson_(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  try { return JSON.parse(String(value)); } catch (err) { return fallback; }
}

function defaultSettings_() {
  return { PeriodId: 1, PeriodState: 'active', DayIndex: 0, DayId: 1, ImportSeq: 0, DaysPerPeriod: DEFAULT_DAYS_PER_PERIOD, TargetAvg: DEFAULT_TARGET_AVG, PeriodWinners: {}, LastImport: null };
}

function readSettings_() {
  var raw = {};
  readRows_('settings').forEach(function (r) {
    var key = String(r[0]).trim();
    if (key) raw[key] = r[1];
  });
  var d = defaultSettings_();
  return {
    PeriodId: num_(raw.PeriodId, d.PeriodId),
    PeriodState: raw.PeriodState === 'finished' ? 'finished' : 'active',
    DayIndex: num_(raw.DayIndex, d.DayIndex),
    DayId: num_(raw.DayId, d.DayId),
    ImportSeq: num_(raw.ImportSeq, d.ImportSeq),
    DaysPerPeriod: Math.min(STARS_MAX, Math.max(1, Math.floor(num_(raw.DaysPerPeriod, d.DaysPerPeriod)))),
    TargetAvg: num_(raw.TargetAvg, d.TargetAvg) > 0 ? Math.min(50, num_(raw.TargetAvg, d.TargetAvg)) : d.TargetAvg,
    PeriodWinners: parseJson_(raw.PeriodWinners, {}),
    LastImport: parseJson_(raw.LastImport, null)
  };
}

function settingsRows_(s) {
  return [
    ['PeriodId', s.PeriodId], ['PeriodState', s.PeriodState], ['DayIndex', s.DayIndex], ['DayId', s.DayId],
    ['ImportSeq', s.ImportSeq], ['DaysPerPeriod', s.DaysPerPeriod], ['TargetAvg', s.TargetAvg],
    ['PeriodWinners', JSON.stringify(s.PeriodWinners || {})], ['LastImport', s.LastImport ? JSON.stringify(s.LastImport) : '']
  ];
}

function writeSettings_(s) {
  writeRows_('settings', settingsRows_(s));
}

/** Everything the actions work on, read once per request: settings, team, departments (in DEPT_CODES order), pairs. */
function loadModel_() {
  ensureSheets_(); // all six tabs exist after any request, so a person opening the spreadsheet always finds them
  var team = [];
  readRows_('team').forEach(function (r) {
    var name = String(r[0]).trim();
    if (!name) return;
    team.push({ name: name, dept: validDept_(r[1]) || String(r[1]).trim(), active: isActive_(r[2]), day: num_(r[3], 0), prior: num_(r[4], 0) });
  });

  var byCode = {};
  readRows_('depts').forEach(function (r) {
    var code = validDept_(r[0]);
    if (!code) return;
    byCode[code] = {
      code: code, title: String(r[1]).trim(), leader: String(r[2]).trim(),
      stars: Math.min(STARS_MAX, Math.max(0, Math.floor(num_(r[3], 0)))),
      wins: num_(r[4], 0), losses: num_(r[5], 0), draws: num_(r[6], 0)
    };
  });
  var depts = DEPT_CODES.map(function (code) {
    return byCode[code] || { code: code, title: '', leader: '', stars: 0, wins: 0, losses: 0, draws: 0 };
  });

  var pairs = [];
  readRows_('pairs').forEach(function (r) {
    var left = validDept_(r[1]);
    var right = validDept_(r[2]);
    if (!left || !right || left === right) return;
    pairs.push({ id: num_(r[0], pairs.length + 1), left: left, right: right });
  });
  pairs.sort(function (a, b) { return a.id - b.id; });
  // A department fights in at most one pair: a hand-edited sheet that lists it twice must not earn two stars in one day.
  var used = {};
  pairs = pairs.filter(function (p) {
    if (used[p.left] || used[p.right]) return false;
    used[p.left] = true;
    used[p.right] = true;
    return true;
  });

  return { settings: readSettings_(), team: team, depts: depts, pairs: pairs.slice(0, MAX_PAIRS) };
}

function teamRows_(team) {
  return team.map(function (m) { return [m.name, m.dept, m.active, m.day, m.prior]; });
}

function deptRows_(depts) {
  return depts.map(function (d) { return [d.code, d.title, d.leader, d.stars, d.wins, d.losses, d.draws]; });
}

/** Names match regardless of case, "ё"/"е" and runs of spaces — an import file is typed by people and exported by systems. */
function normName_(name) {
  var text = String(name);
  if (text.normalize) text = text.normalize('NFC'); // a letter typed as base + combining mark is the same letter
  return text.replace(/ё/g, 'е').replace(/Ё/g, 'Е').replace(/\s+/g, ' ').trim().toLowerCase();
}

function indexTeam_(team) {
  var index = {};
  team.forEach(function (m) { index[normName_(m.name)] = m; });
  return index;
}

/** Per department: active staff, the day's total, the week's total (today included). */
function totals_(model) {
  var t = {};
  model.depts.forEach(function (d) { t[d.code] = { staff: 0, sum: 0, periodSum: 0 }; });
  model.team.forEach(function (m) {
    if (!m.active || !t[m.dept]) return;
    t[m.dept].staff++;
    t[m.dept].sum += m.day;
    t[m.dept].periodSum += m.prior + m.day;
  });
  return t;
}

/** Average per employee; an empty roster counts as one person (never divides by zero). */
function avg_(sum, staff) {
  return sum / Math.max(1, staff);
}

function round_(n, places) {
  var f = Math.pow(10, places);
  return Math.round(n * f) / f;
}

function daySums_(model) {
  var t = totals_(model);
  var sums = {};
  model.depts.forEach(function (d) { sums[d.code] = t[d.code].sum; });
  return sums;
}

/* ------------------------------------------------------------------ status (public GET) */

function buildStatus_(model) {
  var t = totals_(model);
  var s = model.settings;
  var period = { id: s.PeriodId, dayIndex: s.DayIndex, daysTotal: s.DaysPerPeriod, state: s.PeriodState };
  if (s.PeriodState === 'finished') {
    // Winners are remembered per pair number; if the pairs were changed after the week ended, only winners that still belong to their pair count.
    period.winners = {};
    model.pairs.forEach(function (p) {
      var w = s.PeriodWinners[String(p.id)];
      if (w === 'draw' || w === p.left || w === p.right) period.winners[String(p.id)] = w;
    });
  }

  var managers = [];
  model.team.forEach(function (m) {
    if (m.active && t[m.dept]) managers.push({ name: m.name, rop: m.dept, day: m.day, period: m.prior + m.day });
  });

  return {
    ok: true,
    period: period,
    pairs: model.pairs,
    targetAvg: s.TargetAvg,
    leaders: model.depts.map(function (d) {
      var o = { rop: d.code, stars: d.stars, staff: t[d.code].staff, dayCount: t[d.code].sum, periodCount: t[d.code].periodSum };
      if (d.leader) o.name = d.leader;
      return o;
    }),
    managers: managers,
    lastImport: s.LastImport,
    lastUpdated: new Date().toISOString()
  };
}

function readStatusCache_() {
  var raw = CacheService.getScriptCache().get(STATUS_CACHE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

function writeStatusCache_(core) {
  try { CacheService.getScriptCache().put(STATUS_CACHE_KEY, JSON.stringify(core), STATUS_CACHE_SEC); } catch (err) { /* too big or cache down: just serve uncached */ }
}

/** Every write calls this, so a screen never shows stale numbers for longer than its own poll interval. */
function invalidateStatus_() {
  CacheService.getScriptCache().remove(STATUS_CACHE_KEY);
}

/** Null when the key is right, otherwise the error to send. Without a configured key nothing is served: names are personal data. */
function checkDisplayKey_(key) {
  var stored = PropertiesService.getScriptProperties().getProperty(DISPLAY_KEY_PROPERTY_KEY);
  if (!stored) return { ok: false, error: 'display_key_not_set' };
  if (String(key || '') !== stored) return { ok: false, error: 'bad_display_key' };
  return null;
}

/* ------------------------------------------------------------------ validation */

function badRequest_(field) {
  return { ok: false, error: 'bad_request', field: field };
}

/**
 * Text that ends up in a sheet cell: trimmed, single-line, limited, and never starting with a character a
 * spreadsheet would read as a formula (=, +, -, @). Empty string when unacceptable.
 */
function cleanText_(value, maxLength) {
  var text = String(value === undefined || value === null ? '' : value).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > maxLength || /^[=+\-@]/.test(text)) return '';
  return text;
}

function cleanName_(value) {
  var text = cleanText_(value, 80);
  return text.length >= 2 ? text : '';
}

/**
 * "СР1" however a person typed it into the sheet: with spaces, lower case, or with the Latin look-alikes C and P
 * ("cp1") that are impossible to tell apart by eye. Empty string when it is not one of the department codes.
 */
function validDept_(value) {
  var code = String(value === undefined || value === null ? '' : value).replace(/\s+/g, '').toUpperCase()
    .replace(/[CС]/g, 'С').replace(/[PР]/g, 'Р');
  return DEPT_CODES.indexOf(code) >= 0 ? code : '';
}

function findDept_(model, code) {
  for (var i = 0; i < model.depts.length; i++) if (model.depts[i].code === code) return model.depts[i];
  return null;
}

/* ------------------------------------------------------------------ actions: roster */

function managerView_(m) {
  return { name: m.name, dept: m.dept, active: m.active, day: m.day, prior: m.prior };
}

/** Everything the admin page shows, in one call. */
function actionGetAdminState_() {
  var model = loadModel_();
  return {
    ok: true,
    status: buildStatus_(model),
    team: model.team.map(managerView_),
    depts: model.depts,
    pairs: model.pairs,
    settings: { daysPerPeriod: model.settings.DaysPerPeriod, targetAvg: model.settings.TargetAvg },
    displayKeySet: !!PropertiesService.getScriptProperties().getProperty(DISPLAY_KEY_PROPERTY_KEY)
  };
}

/** Add a manager, or edit one (rename / move to another department / activate or deactivate). */
function actionSaveManager_(body) {
  var name = cleanName_(body.name);
  var dept = validDept_(body.dept);
  if (!name) return badRequest_('name');
  if (!dept) return badRequest_('dept');
  var hasOriginal = body.originalName !== undefined && body.originalName !== null && String(body.originalName).trim() !== '';
  var original = hasOriginal ? cleanName_(body.originalName) : '';
  if (hasOriginal && !original) return badRequest_('originalName');
  var active = body.active === undefined ? true : isActive_(body.active);

  return withLock_(function () {
    var model = loadModel_();
    var index = indexTeam_(model.team);
    var target = hasOriginal ? index[normName_(original)] : null;
    if (hasOriginal && !target) return { ok: false, error: 'not_found' };
    var clash = index[normName_(name)];
    if (clash && clash !== target) return { ok: false, error: 'duplicate_name' };

    if (target) {
      target.name = name;
      target.dept = dept;
      target.active = active;
    } else {
      target = { name: name, dept: dept, active: active, day: 0, prior: 0 };
      model.team.push(target);
    }
    writeRows_('team', teamRows_(model.team));
    invalidateStatus_();
    return { ok: true, manager: managerView_(target) };
  });
}

/** Removes a manager from the roster. Their imports stay in "Снимки"; to keep them in the history of a department, deactivate instead. */
function actionDeleteManager_(body) {
  var name = cleanName_(body.name);
  if (!name) return badRequest_('name');
  return withLock_(function () {
    var model = loadModel_();
    var key = normName_(name);
    var kept = model.team.filter(function (m) { return normName_(m.name) !== key; });
    if (kept.length === model.team.length) return { ok: false, error: 'not_found' };
    writeRows_('team', teamRows_(kept));
    invalidateStatus_();
    return { ok: true };
  });
}

/**
 * Bulk roster from a file: { entries: [{name, dept}], deptTitles?: {code: title}, deactivateMissing? }.
 * New names are added, known names are moved to the department given; nobody is deleted. Counts stay as they are.
 */
function actionImportRoster_(body) {
  var entries = body.entries;
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_IMPORT_ROWS) return badRequest_('entries');
  var clean = [];
  for (var i = 0; i < entries.length; i++) {
    var name = cleanName_(entries[i] && entries[i].name);
    var dept = validDept_(entries[i] && entries[i].dept);
    if (!name || !dept) return { ok: false, error: 'bad_request', field: 'entries', row: i + 1 };
    clean.push({ name: name, dept: dept });
  }
  var titles = body.deptTitles && typeof body.deptTitles === 'object' ? body.deptTitles : {};

  return withLock_(function () {
    var model = loadModel_();
    var index = indexTeam_(model.team);
    var seen = {};
    var added = 0, moved = 0, unchanged = 0, deactivated = 0;
    clean.forEach(function (e) {
      var key = normName_(e.name);
      seen[key] = true;
      var existing = index[key];
      if (!existing) {
        var created = { name: e.name, dept: e.dept, active: true, day: 0, prior: 0 };
        model.team.push(created);
        index[key] = created;
        added++;
      } else if (existing.dept !== e.dept) {
        existing.dept = e.dept;
        moved++;
      } else {
        unchanged++;
      }
    });
    if (body.deactivateMissing) {
      model.team.forEach(function (m) {
        if (!seen[normName_(m.name)] && m.active) { m.active = false; deactivated++; }
      });
    }
    model.depts.forEach(function (d) {
      var title = cleanText_(titles[d.code], 120);
      if (title) d.title = title;
    });
    writeRows_('team', teamRows_(model.team));
    writeRows_('depts', deptRows_(model.depts));
    invalidateStatus_();
    return { ok: true, added: added, moved: moved, unchanged: unchanged, deactivated: deactivated, total: model.team.length };
  });
}

/** A department's display name and its leader's (РГ) name. */
function actionSaveDepartment_(body) {
  var code = validDept_(body.code);
  if (!code) return badRequest_('code');
  var hasTitle = body.title !== undefined;
  var hasLeader = body.leader !== undefined;
  if (!hasTitle && !hasLeader) return badRequest_('title');
  var title = hasTitle ? cleanText_(body.title, 120) : '';
  var leader = hasLeader ? cleanText_(body.leader, 80) : '';
  if (hasTitle && String(body.title).trim() !== '' && !title) return badRequest_('title');
  if (hasLeader && String(body.leader).trim() !== '' && !leader) return badRequest_('leader');

  return withLock_(function () {
    var model = loadModel_();
    var dept = findDept_(model, code);
    if (hasTitle) dept.title = title;
    if (hasLeader) dept.leader = leader;
    writeRows_('depts', deptRows_(model.depts));
    invalidateStatus_();
    return { ok: true, dept: dept };
  });
}

/* ------------------------------------------------------------------ actions: imports */

/**
 * One import: { rows: [{name, count}], addUnknown?: [{name, dept}], allowDecrease? }. `count` is the manager's invoices
 * for the day SO FAR (cumulative). All or nothing: unknown names and counts that went down are refused (with the
 * lists) unless the admin said how to treat them — nothing is written on a refusal.
 */
function actionImportSnapshot_(body) {
  var rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_IMPORT_ROWS) return badRequest_('rows');
  var addUnknown = Array.isArray(body.addUnknown) ? body.addUnknown : [];
  var allowDecrease = body.allowDecrease === true;

  return withLock_(function () {
    var model = loadModel_();
    if (model.settings.PeriodState === 'finished') return { ok: false, error: 'period_finished' };
    var index = indexTeam_(model.team);

    var added = 0;
    for (var a = 0; a < addUnknown.length; a++) {
      var newName = cleanName_(addUnknown[a] && addUnknown[a].name);
      var newDept = validDept_(addUnknown[a] && addUnknown[a].dept);
      if (!newName || !newDept) return { ok: false, error: 'bad_request', field: 'addUnknown', row: a + 1 };
      if (!index[normName_(newName)]) {
        var created = { name: newName, dept: newDept, active: true, day: 0, prior: 0 };
        model.team.push(created);
        index[normName_(newName)] = created;
        added++;
      }
    }

    var entries = {};      // normalized name -> { manager, count } (a name that appears twice: the last one counts)
    var unknown = [];
    var duplicates = [];
    for (var i = 0; i < rows.length; i++) {
      var name = String(rows[i] && rows[i].name !== undefined ? rows[i].name : '').trim();
      var count = strictNumber_(rows[i] && rows[i].count);
      if (!name || !isFinite(count) || count < 0 || count !== Math.floor(count) || count > MAX_COUNT) return { ok: false, error: 'bad_request', field: 'rows', row: i + 1 };
      var key = normName_(name);
      var manager = index[key];
      if (!manager) { if (unknown.indexOf(name) < 0) unknown.push(name); continue; }
      if (entries[key]) duplicates.push(manager.name);
      entries[key] = { manager: manager, count: count };
    }
    if (unknown.length > 0) return { ok: false, error: 'unknown_managers', names: unknown };

    var skipped = [];
    var decreases = [];
    var applying = [];
    Object.keys(entries).forEach(function (key) {
      var entry = entries[key];
      if (!entry.manager.active) { skipped.push(entry.manager.name); return; }
      if (entry.count < entry.manager.day && !allowDecrease) decreases.push({ name: entry.manager.name, from: entry.manager.day, to: entry.count });
      applying.push(entry);
    });
    if (decreases.length > 0) return { ok: false, error: 'count_decreased', items: decreases };

    var before = daySums_(model);
    var now = Date.now();
    var importId = model.settings.ImportSeq + 1;
    var snapshotRows = [];
    var changed = 0;
    applying.forEach(function (entry) {
      var delta = entry.count - entry.manager.day;
      if (delta !== 0) changed++;
      snapshotRows.push([importId, new Date(now), model.settings.DayId, entry.manager.name, entry.manager.dept, entry.count, delta]);
      entry.manager.day = entry.count;
    });
    var after = daySums_(model);

    model.settings.ImportSeq = importId;
    // `round`: the how-many-th import of this game day (the screens announce "Round 1, 2, 3...").
    var previous = model.settings.LastImport;
    var round = previous && previous.dayId === model.settings.DayId ? (Number(previous.round) || 0) + 1 : 1;
    model.settings.LastImport = { id: importId, at: new Date(now).toISOString(), dayId: model.settings.DayId, round: round, before: before, after: after };
    writeRows_('team', teamRows_(model.team));
    appendRows_('snaps', snapshotRows);
    writeSettings_(model.settings);
    invalidateStatus_();
    return { ok: true, importId: importId, applied: applying.length, changed: changed, added: added, skipped: skipped, duplicates: duplicates };
  });
}

function formatTime_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, getSpreadsheet_().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm');
  return String(value);
}

function tail_(rows, limit) {
  return rows.slice(Math.max(0, rows.length - limit)).reverse();
}

function clampLimit_(value) {
  var limit = Math.floor(Number(value));
  if (!isFinite(limit) || limit < 1) limit = 100;
  return Math.min(limit, 500);
}

/** Newest first. Optional { importId } narrows to one import. */
function actionListSnapshots_(body) {
  var limit = clampLimit_(body.limit);
  var wanted = body.importId === undefined ? null : Number(body.importId);
  var sheet = sheetOf_('snaps');
  var rows = readRows_('snaps', HISTORY_SCAN_ROWS).filter(function (r) { return String(r[0]).trim() !== '' && (wanted === null || Number(r[0]) === wanted); });
  return {
    ok: true,
    total: wanted === null ? Math.max(0, sheet.getLastRow() - 1) : rows.length,
    rows: tail_(rows, limit).map(function (r) {
      return { importId: num_(r[0], 0), time: formatTime_(r[1]), dayId: num_(r[2], 0), name: String(r[3]), dept: String(r[4]), count: num_(r[5], 0), delta: num_(r[6], 0) };
    })
  };
}

/** The finished days, newest first. */
function actionListDays_(body) {
  var limit = clampLimit_(body.limit);
  var sheet = sheetOf_('days');
  var rows = readRows_('days', HISTORY_SCAN_ROWS).filter(function (r) { return String(r[0]).trim() !== ''; });
  return {
    ok: true,
    total: Math.max(0, sheet.getLastRow() - 1),
    rows: tail_(rows, limit).map(function (r) {
      return {
        dayId: num_(r[0], 0), periodId: num_(r[1], 0), dayNo: num_(r[2], 0), time: formatTime_(r[3]), dept: String(r[4]),
        sum: num_(r[5], 0), staff: num_(r[6], 0), avg: num_(r[7], 0), pair: r[8] === '' ? null : num_(r[8], 0), outcome: String(r[9]), starsAfter: num_(r[10], 0)
      };
    })
  };
}

/* ------------------------------------------------------------------ actions: pairs, day, week */

/** { pairs: [{left, right}, ...] } — up to MAX_PAIRS, every department at most once. */
function actionSetPairs_(body) {
  var pairs = body.pairs;
  if (!Array.isArray(pairs) || pairs.length < 1 || pairs.length > MAX_PAIRS) return badRequest_('pairs');
  var used = {};
  var rows = [];
  for (var i = 0; i < pairs.length; i++) {
    var left = validDept_(pairs[i] && pairs[i].left);
    var right = validDept_(pairs[i] && pairs[i].right);
    if (!left || !right || left === right || used[left] || used[right]) return { ok: false, error: 'bad_request', field: 'pairs', row: i + 1 };
    used[left] = true;
    used[right] = true;
    rows.push([i + 1, left, right]);
  }
  return withLock_(function () {
    writeRows_('pairs', rows);
    invalidateStatus_();
    return { ok: true, pairs: rows.map(function (r) { return { id: r[0], left: r[1], right: r[2] }; }) };
  });
}

/** Who wins a pair: the higher AVERAGE per employee ('draw' when level). */
function pairWinner_(pair, totals) {
  var l = totals[pair.left];
  var r = totals[pair.right];
  var la = avg_(l.sum, l.staff);
  var ra = avg_(r.sum, r.staff);
  return Math.abs(la - ra) < 1e-9 ? 'draw' : la > ra ? pair.left : pair.right;
}

function outcomeLabel_(code, winner) {
  if (winner === null) return '—';
  if (winner === 'draw') return 'ничья';
  return winner === code ? 'победа' : 'поражение';
}

/**
 * Ends the day: decides every pair by the average invoices per employee, gives a star to each winner, archives the
 * day, rolls today's counts into the week's, zeroes the day and — after the last day of the week — decides the
 * match of each pair (more stars wins; level on stars: the higher weekly average). The displays play the result
 * as a `finale` command; the recorded numbers do not depend on any display being open.
 */
function actionFinishDay_() {
  return withLock_(function () {
    var model = loadModel_();
    var s = model.settings;
    if (s.PeriodState === 'finished') return { ok: false, error: 'period_finished' };
    if (model.pairs.length === 0) return { ok: false, error: 'no_pairs' };

    var t = totals_(model);
    var now = Date.now();
    var dayNo = s.DayIndex + 1;
    var results = [];
    var outcomeByDept = {};

    model.pairs.forEach(function (pair) {
      var winner = pairWinner_(pair, t);
      var left = findDept_(model, pair.left);
      var right = findDept_(model, pair.right);
      var starsBefore = {};
      starsBefore[pair.left] = left.stars;
      starsBefore[pair.right] = right.stars;
      if (winner === 'draw') {
        left.draws++;
        right.draws++;
      } else {
        var winnerDept = winner === pair.left ? left : right;
        var loserDept = winner === pair.left ? right : left;
        winnerDept.wins++;
        loserDept.losses++;
        winnerDept.stars = Math.min(STARS_MAX, winnerDept.stars + 1);
      }
      var starsAfter = {};
      starsAfter[pair.left] = left.stars;
      starsAfter[pair.right] = right.stars;
      outcomeByDept[pair.left] = { pairId: pair.id, winner: winner };
      outcomeByDept[pair.right] = { pairId: pair.id, winner: winner };
      results.push({
        pairId: pair.id, left: pair.left, right: pair.right, winner: winner,
        leftAvg: round_(avg_(t[pair.left].sum, t[pair.left].staff), 4), rightAvg: round_(avg_(t[pair.right].sum, t[pair.right].staff), 4),
        leftSum: t[pair.left].sum, rightSum: t[pair.right].sum, leftStaff: t[pair.left].staff, rightStaff: t[pair.right].staff,
        starsBefore: starsBefore, starsAfter: starsAfter
      });
    });

    var dayRows = model.depts.map(function (d) {
      var o = outcomeByDept[d.code];
      return [s.DayId, s.PeriodId, dayNo, new Date(now), d.code, t[d.code].sum, t[d.code].staff, round_(avg_(t[d.code].sum, t[d.code].staff), 4),
        o ? o.pairId : '', outcomeLabel_(d.code, o ? o.winner : null), d.stars];
    });

    // Today's counts become part of the week; the new day starts from zero.
    model.team.forEach(function (m) { m.prior += m.day; m.day = 0; });

    s.DayIndex = dayNo;
    s.DayId += 1;
    var periodFinished = dayNo >= s.DaysPerPeriod;
    var matchWinners = {};
    if (periodFinished) {
      model.pairs.forEach(function (pair) {
        var l = findDept_(model, pair.left);
        var r = findDept_(model, pair.right);
        var winner;
        if (l.stars !== r.stars) {
          winner = l.stars > r.stars ? pair.left : pair.right;
        } else {
          var la = avg_(t[pair.left].periodSum, t[pair.left].staff);
          var ra = avg_(t[pair.right].periodSum, t[pair.right].staff);
          winner = Math.abs(la - ra) < 1e-9 ? 'draw' : la > ra ? pair.left : pair.right;
        }
        matchWinners[String(pair.id)] = winner;
      });
      s.PeriodState = 'finished';
      s.PeriodWinners = matchWinners;
    }

    var finale = { dayNo: dayNo, results: results, periodFinished: periodFinished };
    if (periodFinished) finale.matchWinners = matchWinners;

    writeRows_('team', teamRows_(model.team));
    writeRows_('depts', deptRows_(model.depts));
    appendRows_('days', dayRows);
    writeSettings_(s);
    pushCommand_('finale', finale);
    invalidateStatus_();
    return { ok: true, dayNo: dayNo, results: results, periodFinished: periodFinished, matchWinners: matchWinners };
  });
}

/** A new week: no stars yet, counters of the week and the day back to zero, the match running again. */
function actionNewPeriod_() {
  return withLock_(function () {
    var model = loadModel_();
    var s = model.settings;
    s.PeriodId += 1;
    s.PeriodState = 'active';
    s.DayIndex = 0;
    s.PeriodWinners = {};
    model.depts.forEach(function (d) { d.stars = 0; d.wins = 0; d.losses = 0; d.draws = 0; });
    model.team.forEach(function (m) { m.day = 0; m.prior = 0; });
    writeRows_('team', teamRows_(model.team));
    writeRows_('depts', deptRows_(model.depts));
    writeSettings_(s);
    invalidateStatus_();
    return { ok: true, periodId: s.PeriodId };
  });
}

/** Manual correction of a department's stars (a misclick on "finish the day", a day that does not count, ...). */
function actionSetStars_(body) {
  var code = validDept_(body.rop);
  var stars = strictNumber_(body.stars);
  if (!code) return badRequest_('rop');
  if (!isFinite(stars) || stars < 0 || stars > STARS_MAX || stars !== Math.floor(stars)) return badRequest_('stars');
  return withLock_(function () {
    var model = loadModel_();
    findDept_(model, code).stars = stars;
    writeRows_('depts', deptRows_(model.depts));
    invalidateStatus_();
    return { ok: true, rop: code, stars: stars };
  });
}

/** { daysPerPeriod?, targetAvg? } — days in the week (1..10) and the target average of invoices per employee (0..50). */
function actionSetSettings_(body) {
  var hasDays = body.daysPerPeriod !== undefined;
  var hasTarget = body.targetAvg !== undefined;
  if (!hasDays && !hasTarget) return badRequest_('daysPerPeriod');
  var days = hasDays ? strictNumber_(body.daysPerPeriod) : 0;
  var target = hasTarget ? strictNumber_(body.targetAvg) : 0;
  if (hasDays && (!isFinite(days) || days < 1 || days > STARS_MAX || days !== Math.floor(days))) return badRequest_('daysPerPeriod');
  if (hasTarget && (!isFinite(target) || target <= 0 || target > 50)) return badRequest_('targetAvg');
  return withLock_(function () {
    var s = readSettings_();
    if (hasDays) s.DaysPerPeriod = days;
    if (hasTarget) s.TargetAvg = round_(target, 2);
    writeSettings_(s);
    invalidateStatus_();
    return { ok: true, daysPerPeriod: s.DaysPerPeriod, targetAvg: s.TargetAvg };
  });
}

/* ------------------------------------------------------------------ display key */

function newKey_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 28);
}

/** { key? } — sets the key the office screens must send; without one a random key is generated and returned. */
function actionSetDisplayKey_(body) {
  var key = body.key === undefined || body.key === null || String(body.key) === '' ? newKey_() : String(body.key);
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(key)) return badRequest_('key');
  return withLock_(function () {
    PropertiesService.getScriptProperties().setProperty(DISPLAY_KEY_PROPERTY_KEY, key);
    invalidateStatus_();
    return { ok: true, key: key };
  });
}

function actionGetDisplayKey_() {
  var key = PropertiesService.getScriptProperties().getProperty(DISPLAY_KEY_PROPERTY_KEY);
  return { ok: true, key: key || null };
}

/* ------------------------------------------------------------------ commands (visual only) */

/**
 * Asks every display to play an animation. Purely visual: nothing in the sheet changes. The queue lives in Script
 * Properties; each display runs every command once, in id order (see readRecentCommands_).
 *   fight {pairId, leftAvg, rightAvg, sample?}   a demo round of one pair at these averages per employee
 *   finale                                        a demo of the day's finale with today's numbers (no stars change)
 *   confetti | celebrate
 */
function actionCommand_(body) {
  var type = String(body.type || '');
  var args;
  if (type === 'fight') {
    var a = body.args || {};
    var pairId = strictNumber_(a.pairId);
    var leftAvg = strictNumber_(a.leftAvg);
    var rightAvg = strictNumber_(a.rightAvg);
    if (!isFinite(pairId) || pairId < 1 || pairId > MAX_PAIRS || pairId !== Math.floor(pairId) || !isFinite(leftAvg) || !isFinite(rightAvg) || leftAvg < 0 || rightAvg < 0 || leftAvg > 1000 || rightAvg > 1000) return badRequest_('args');
    args = { pairId: pairId, leftAvg: leftAvg, rightAvg: rightAvg };
    if (a.sample !== undefined) {
      var sample = strictNumber_(a.sample);
      if (!isFinite(sample) || sample < 0 || sample > 100000) return badRequest_('args');
      args.sample = sample;
    }
  } else if (type === 'finale') {
    args = demoFinale_(loadModel_());
  } else if (type === 'confetti' || type === 'celebrate') {
    args = {};
  } else {
    return badRequest_('type');
  }
  return withLock_(function () {
    return { ok: true, id: pushCommand_(type, args) };
  });
}

/** What a finale would look like with today's numbers — flagged `demo`, so the screens leave stars and bars alone. */
function demoFinale_(model) {
  var t = totals_(model);
  return {
    dayNo: model.settings.DayIndex + 1,
    periodFinished: false,
    demo: true,
    results: model.pairs.map(function (pair) {
      var left = findDept_(model, pair.left);
      var right = findDept_(model, pair.right);
      var before = {};
      before[pair.left] = left.stars;
      before[pair.right] = right.stars;
      return {
        pairId: pair.id, left: pair.left, right: pair.right, winner: pairWinner_(pair, t),
        leftAvg: round_(avg_(t[pair.left].sum, t[pair.left].staff), 4), rightAvg: round_(avg_(t[pair.right].sum, t[pair.right].staff), 4),
        leftSum: t[pair.left].sum, rightSum: t[pair.right].sum, leftStaff: t[pair.left].staff, rightStaff: t[pair.right].staff,
        starsBefore: before, starsAfter: before
      };
    })
  };
}

/** Appends to the command queue and returns the new id. Callers hold the script lock. */
function pushCommand_(type, args) {
  var props = PropertiesService.getScriptProperties();
  var seq = (Number(props.getProperty(COMMAND_SEQ_PROPERTY_KEY)) || 0) + 1;
  var now = Date.now();
  var queue = readCommandQueue_().filter(function (c) { return now - c.issuedAt <= COMMAND_MAX_AGE_MS; });
  queue.push({ id: seq, type: type, args: args, issuedAt: now });
  queue = queue.slice(-COMMAND_KEEP);
  // Several finales in a row are big (a few KB each); a property holds 9 KB: drop the oldest rather than fail the day.
  while (queue.length > 1 && JSON.stringify(queue).length > COMMANDS_MAX_JSON) queue.shift();
  props.setProperty(COMMANDS_PROPERTY_KEY, JSON.stringify(queue));
  props.setProperty(COMMAND_SEQ_PROPERTY_KEY, String(seq));
  return seq;
}

function readCommandQueue_() {
  var raw = PropertiesService.getScriptProperties().getProperty(COMMANDS_PROPERTY_KEY);
  if (!raw) return [];
  try {
    var list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

/** What the displays see on their normal poll: only commands still fresh enough to be worth playing. */
function readRecentCommands_() {
  var now = Date.now();
  return readCommandQueue_().filter(function (c) { return now - c.issuedAt <= COMMAND_MAX_AGE_MS; });
}

/* ---------------------------------------------------------------------- PIN */

function actionChangePin_(body) {
  var newPin = String(body.newPin === undefined ? '' : body.newPin);
  if (!/^[0-9]{4,12}$/.test(newPin)) return badRequest_('newPin');
  if (newPin === String(body.pin)) return badRequest_('newPin_same');
  return withLock_(function () {
    storePin_(newPin);
    return { ok: true };
  });
}

/** Returns null when the PIN is right, otherwise the error response to send. Counts failures and locks out guessing. */
function authorize_(pin) {
  var lockedFor = lockRemainingSec_();
  if (lockedFor > 0) return { ok: false, error: 'locked', retryAfterSec: lockedFor };

  if (!verifyPin_(pin)) {
    recordPinFailure_();
    lockedFor = lockRemainingSec_();
    return lockedFor > 0 ? { ok: false, error: 'locked', retryAfterSec: lockedFor } : { ok: false, error: 'invalid_pin' };
  }
  CacheService.getScriptCache().remove('pin_fails');
  return null;
}

function verifyPin_(pin) {
  if (pin === undefined || pin === null) return false;
  var text = String(pin);
  if (text.length === 0 || text.length > 32) return false;

  var stored = PropertiesService.getScriptProperties().getProperty(PIN_HASH_PROPERTY_KEY);
  if (!stored) return false;
  var parts = stored.split('$');
  return parts.length === 2 && hashPin_(parts[0], text) === parts[1];
}

function hashPin_(salt, pin) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function storePin_(pin) {
  var props = PropertiesService.getScriptProperties();
  var salt = Utilities.getUuid();
  props.setProperty(PIN_HASH_PROPERTY_KEY, salt + '$' + hashPin_(salt, String(pin)));
  CacheService.getScriptCache().remove('pin_fails');
  CacheService.getScriptCache().remove('pin_lock_until');
}

function lockRemainingSec_() {
  var until = Number(CacheService.getScriptCache().get('pin_lock_until')) || 0;
  return until > Date.now() ? Math.ceil((until - Date.now()) / 1000) : 0;
}

function recordPinFailure_() {
  var cache = CacheService.getScriptCache();
  var fails = (Number(cache.get('pin_fails')) || 0) + 1;
  if (fails >= MAX_PIN_FAILURES) {
    cache.put('pin_lock_until', String(Date.now() + PIN_LOCK_SEC * 1000), PIN_LOCK_SEC + 60);
    cache.remove('pin_fails');
  } else {
    cache.put('pin_fails', String(fails), PIN_FAILURE_WINDOW_SEC);
  }
}

/* ------------------------------------------------------------------ plumbing */

/** Serialises writers (two admins clicking at once must not both read the same counters / interleave rows). */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
