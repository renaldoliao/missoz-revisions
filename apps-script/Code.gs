/**
 * Miss Oz TEST database: the link between the TEST Google Sheet and the test website.
 * Paste into the TEST Sheet only: Extensions > Apps Script.
 * This works only with the Sheet it is pasted into, so it can never touch Millie's real Sheet.
 *
 * Same requests as the live dashboard uses: site, state, authStatus, setPassword,
 * voteResults, guestbook, addSubmission, setStatus, seedMenu, saveMenu, seedText,
 * saveText, saveVoteSetup, resetVotes.
 */
var SETUP_CODE = 'Practice-1234';
var MENU_COLS = ['id', 'category', 'name', 'description', 'price', 'on', 'photo', 'crop', 'badge'];
var TEXT_COLS = ['key', 'section', 'label', 'text'];
var SUB_COLS = ['id', 'type', 'name', 'email', 'phone', 'date', 'time', 'detail', 'note', 'status', 'source'];
var TZ = 'America/Los_Angeles';

function doGet(e) { return out(handle_('GET', e.parameter || {}, {})); }
function doPost(e) {
  var body = {};
  try { body = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) {}
  return out(handle_('POST', {}, body));
}
function out(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function handle_(method, q, b) {
  var action = method === 'GET' ? q.action : b.action;
  var token = method === 'GET' ? q.token : b.token;
  try {
    // public: what the website reads and sends
    if (action === 'site') return { ok: true, menu: readRows_('Menu', MENU_COLS).filter(isOn_), text: siteText_() };
    if (action === 'voteResults') return voteResults_();
    if (action === 'guestbook') {
      return { ok: true, entries: readRows_('Submissions', SUB_COLS).filter(function (s) { return s.type === 'guestbook'; })
        .map(function (s) { return { id: s.id, name: s.name, note: s.note, when: s.date }; }).reverse() };
    }
    if (action === 'addSubmission') return withLock_(function () { return addSubmission_(b.submission || {}); });

    // sign-in
    var props = PropertiesService.getScriptProperties();
    var hash = props.getProperty('PASS_HASH');
    if (action === 'authStatus') return { ok: true, setup: !hash };
    if (action === 'setPassword') {
      if (hash) return { ok: false, error: 'already' };
      if (locked_()) return { ok: false, error: 'locked' };
      if (String(b.code || '').trim() !== SETUP_CODE) { miss_(); return { ok: false, error: 'badcode' }; }
      var pw = String(b.password || '').trim();
      if (pw.length < 8) return { ok: false, error: 'short' };
      var salt = Utilities.getUuid();
      props.setProperties({ PASS_SALT: salt, PASS_HASH: sha_(salt + pw) });
      return { ok: true };
    }
    if (!hash) return { ok: false, error: 'setup' };
    if (locked_()) return { ok: false, error: 'locked' };
    if (!token || sha_(props.getProperty('PASS_SALT') + String(token).trim()) !== hash) { miss_(); return { ok: false, error: 'unauthorized' }; }

    // dashboard (signed in)
    if (action === 'state') {
      return { ok: true, menu: readRows_('Menu', MENU_COLS), menuVersion: menuVersion_(), text: readRows_('Website Text', TEXT_COLS),
        submissions: readRows_('Submissions', SUB_COLS), voteSetup: voteSetup_() };
    }
    return withLock_(function () {
      if (action === 'seedMenu') {
        if (!readRows_('Menu', MENU_COLS).length) { writeRows_('Menu', MENU_COLS, (b.menu || []).map(normMenu_)); bump_(); }
        return { ok: true, menu: readRows_('Menu', MENU_COLS), menuVersion: menuVersion_() };
      }
      if (action === 'saveMenu') {
        if (b.baseVersion && Number(b.baseVersion) !== menuVersion_()) return { ok: false, error: 'conflict' };
        writeRows_('Menu', MENU_COLS, (b.menu || []).map(normMenu_));
        return { ok: true, menuVersion: bump_() };
      }
      if (action === 'seedText') {
        var rows = readRows_('Website Text', TEXT_COLS), have = {};
        rows.forEach(function (r) { have[r.key] = true; });
        (b.fields || []).forEach(function (f) { if (!have[f.key]) rows.push({ key: f.key, section: f.section, label: f.label, text: '' }); });
        writeRows_('Website Text', TEXT_COLS, rows);
        return { ok: true, text: rows };
      }
      if (action === 'saveText') {
        var t = readRows_('Website Text', TEXT_COLS), changed = [];
        (b.items || []).forEach(function (it) {
          var row = t.filter(function (r) { return r.key === it.key; })[0];
          if (row && it.before != null && String(row.text) !== String(it.before)) { changed.push(it.key); return; }
          if (row) row.text = it.text; else t.push({ key: it.key, section: '', label: '', text: it.text });
        });
        if (changed.length) return { ok: false, error: 'conflict', keys: changed };
        writeRows_('Website Text', TEXT_COLS, t);
        return { ok: true, text: t };
      }
      if (action === 'setStatus') {
        var subs = readRows_('Submissions', SUB_COLS);
        subs.forEach(function (s) { if (s.id === b.id) s.status = b.status; });
        writeRows_('Submissions', SUB_COLS, subs);
        return { ok: true };
      }
      if (action === 'saveVoteSetup') {
        clearVotes_();
        var flavors = (b.flavors || []).slice(0, 3).map(function (f) { return [f.name || '', f.note || '', f.image || '']; });
        var sh = sheet_('Vote Setup');
        sh.getRange(2, 1, 3, 3).clearContent();
        if (flavors.length) sh.getRange(2, 1, flavors.length, 3).setValues(flavors);
        var round = String((parseInt(sh.getRange('E2').getValue(), 10) || 0) + 1);
        sh.getRange('E2').setValue(round);
        return { ok: true, flavors: voteSetup_().flavors, round: round };
      }
      if (action === 'resetVotes') { clearVotes_(); return { ok: true }; }
      return { ok: false, error: 'unknown' };
    });
  } catch (err) {
    return { ok: false, error: 'server', message: String(err) };
  }
}

// ---------- helpers ----------
function sheet_(name) { return SpreadsheetApp.getActive().getSheetByName(name); }
function readRows_(name, cols) {
  var sh = sheet_(name), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, cols.length).getDisplayValues()
    .filter(function (r) { return r.join('') !== ''; })
    .map(function (r) { var o = {}; cols.forEach(function (c, i) { o[c] = r[i]; }); return o; });
}
function writeRows_(name, cols, rows) {
  var sh = sheet_(name), last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, cols.length).clearContent();
  if (!rows.length) return;
  var values = rows.map(function (o) { return cols.map(function (c) { return o[c] == null ? '' : String(o[c]); }); });
  sh.getRange(2, 1, values.length, cols.length).setNumberFormat('@').setValues(values);
}
function normMenu_(d) {
  var on = d.on === true || String(d.on).toLowerCase() === 'yes';
  return { id: d.id, category: d.category, name: d.name, description: d.description, price: d.price, on: on ? 'yes' : 'no', photo: d.photo || '', crop: d.crop || '', badge: d.badge || '' };
}
function isOn_(d) { return String(d.on).toLowerCase() === 'yes'; }
function siteText_() {
  var t = {};
  readRows_('Website Text', TEXT_COLS).forEach(function (r) { if (r.text) t[r.key] = r.text; });
  return t;
}
function voteSetup_() {
  var sh = sheet_('Vote Setup');
  var flavors = sh.getRange(2, 1, 3, 3).getDisplayValues()
    .filter(function (r) { return r[0]; })
    .map(function (r) { return { name: r[0], note: r[1], image: r[2] }; });
  return { flavors: flavors, round: sh.getRange('E2').getDisplayValue() };
}
function voteResults_() {
  var votes = {};
  readRows_('Submissions', SUB_COLS).forEach(function (s) { if (s.type === 'vote') { var f = s.note || ''; votes[f] = (votes[f] || 0) + 1; } });
  var v = voteSetup_();
  return { ok: true, votes: votes, flavors: v.flavors, round: v.round };
}
function clearVotes_() {
  writeRows_('Submissions', SUB_COLS, readRows_('Submissions', SUB_COLS).filter(function (s) { return s.type !== 'vote'; }));
}
function addSubmission_(s) {
  var now = new Date();
  var row = {
    id: String(s.id || ('w-' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 6))).slice(0, 40),
    type: String(s.type || '').slice(0, 20), name: String(s.name || '').slice(0, 80), email: String(s.email || '').slice(0, 120),
    phone: String(s.phone || '').slice(0, 40), date: Utilities.formatDate(now, TZ, 'M/d/yyyy'), time: Utilities.formatDate(now, TZ, 'h:mm a'),
    detail: String(s.detail || '').slice(0, 500), note: String(s.note || '').slice(0, 2000), status: 'new', source: String(s.source || 'website').slice(0, 20)
  };
  var sh = sheet_('Submissions');
  sh.getRange(sh.getLastRow() + 1, 1, 1, SUB_COLS.length).setNumberFormat('@').setValues([SUB_COLS.map(function (c) { return row[c]; })]);
  return { ok: true };
}
function menuVersion_() { return Number(PropertiesService.getScriptProperties().getProperty('MENU_VERSION') || 1); }
function bump_() { var v = menuVersion_() + 1; PropertiesService.getScriptProperties().setProperty('MENU_VERSION', String(v)); return v; }
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try { return fn(); } finally { lock.releaseLock(); }
}
function sha_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join('');
}
function locked_() { return Number(CacheService.getScriptCache().get('MISSES') || 0) >= 5; }
function miss_() {
  var c = CacheService.getScriptCache(), n = Number(c.get('MISSES') || 0) + 1;
  c.put('MISSES', String(n), 900);
}

/** Run this by hand to clear the test password and start the sign-in over. */
function resetTestPassword() {
  PropertiesService.getScriptProperties().deleteProperty('PASS_HASH');
  PropertiesService.getScriptProperties().deleteProperty('PASS_SALT');
}
