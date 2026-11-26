/*
 * TEST COPY MARKER (never on the live site).
 *
 * The real website and dashboard talk to Millie's Google Sheet. In this test copy
 * every Sheet link points to PRACTICE_URL instead, and this file answers those
 * requests inside the browser, saving everything in this browser only.
 * Nothing here can reach Millie's Sheet, her menu, or her live website.
 *
 * Setup code for the practice dashboard: Practice-1234
 * To start over with a clean practice copy, open /dashboard.html?reset
 */
(function () {
  var PRACTICE_URL = "https://practice-sheet.invalid/exec";
  var KEY = "missoz-practice-sheet";
  var SETUP_CODE = "Practice-1234";

  function today(offsetDays) {
    var d = new Date(Date.now() - (offsetDays || 0) * 864e5);
    return { date: (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear(), time: d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) };
  }
  function sample() {
    var a = today(0), b = today(1), c = today(2), e = today(3);
    return {
      password: "",
      menu: [], menuVersion: 1,
      text: [],
      voteSetup: { flavors: [], round: "1" },
      submissions: [
        { id: "p1", type: "cake", name: "Sample Customer", email: "sample@example.com", phone: "555-0100", date: a.date, time: a.time, detail: "8-inch cake, qty 1. Pickup Wednesday", note: "Top: Mint Chocolate Chip, bottom: Belgian Dark Chocolate. Text: Happy Birthday", status: "new" },
        { id: "p2", type: "wholesale", name: "Sample Cafe", email: "cafe@example.com", phone: "555-0101", date: b.date, time: b.time, detail: "Wholesale inquiry, about $300 a week", note: "Interested in 3 flavors for our coffee shop", status: "new" },
        { id: "p3", type: "contact", name: "Sample Neighbor", email: "hello@example.com", date: c.date, time: c.time, detail: "", note: "Do you have dairy-free options?", status: "done" },
        { id: "p4", type: "guestbook", name: "Practice Guest", date: e.date, time: e.time, detail: "Best ice cream in Portland!", note: "Best ice cream in Portland!", status: "done" }
      ]
    };
  }

  if (/[?&]reset\b/.test(location.search)) { try { localStorage.removeItem(KEY); localStorage.removeItem("missoz-dash-pass"); sessionStorage.removeItem("missoz-dash-pass"); history.replaceState(null, "", location.pathname); } catch (e) {} }

  var mem = null;
  function load() {
    if (mem) return mem;
    try { mem = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { mem = null; }
    if (!mem) { mem = sample(); save(); }
    return mem;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) {} }
  function reload() { mem = null; return load(); }

  function isOn(d) { return d.on === true || String(d.on).toLowerCase() === "yes"; }
  function siteText(db) { var t = {}; db.text.forEach(function (r) { if (r.text) t[r.key] = r.text; }); return t; }
  function voteRows(db) { return db.submissions.filter(function (s) { return s.type === "vote"; }); }

  function handle(method, params, body) {
    var db = reload();
    var action = method === "GET" ? params.get("action") : body.action;
    var token = method === "GET" ? params.get("token") : body.token;
    var authed = !!db.password && token === db.password;

    // public reads and writes the website makes
    if (action === "site") return { ok: true, menu: db.menu.filter(isOn).map(function (d) { return { category: d.category, name: d.name, description: d.description, price: d.price, crop: d.crop || "", badge: d.badge || "" }; }), text: siteText(db) };
    if (action === "voteResults") {
      var votes = {}; voteRows(db).forEach(function (s) { var f = s.note || ""; votes[f] = (votes[f] || 0) + 1; });
      return { ok: true, votes: votes, flavors: db.voteSetup.flavors, round: db.voteSetup.round };
    }
    if (action === "guestbook") return { ok: true, entries: db.submissions.filter(function (s) { return s.type === "guestbook" && s.status !== "hidden" && s.status !== "deleted"; }).sort(function (a, b) { return (b.status === "pinned") - (a.status === "pinned"); }).map(function (s) { return { id: s.id, name: s.name, note: s.note, when: s.date }; }).reverse() };
    if (action === "addSubmission") {
      var t = today(0), s = body.submission || {};
      db.submissions.push(Object.assign({ id: s.id || "p" + Date.now().toString(36), date: t.date, time: t.time, status: "new" }, s));
      save(); return { ok: true };
    }

    // sign-in
    if (action === "authStatus") return { ok: true, setup: !db.password };
    if (action === "setPassword") {
      if (db.password) return { ok: false, error: "already" };
      if (String(body.code || "").trim() !== SETUP_CODE) return { ok: false, error: "badcode" };
      db.password = String(body.password || "").trim(); save(); return { ok: true };
    }
    if (!db.password) return { ok: false, error: "setup" };
    if (!authed) return { ok: false, error: "unauthorized" };

    // dashboard
    if (action === "state") return { ok: true, menu: db.menu, menuVersion: db.menuVersion, text: db.text, submissions: db.submissions.filter(function (s) { return s.status !== "deleted"; }), voteSetup: db.voteSetup };
    if (action === "seedMenu") { if (!db.menu.length) { db.menu = (body.menu || []).map(function (d) { return Object.assign({}, d, { on: isOn(d) ? "yes" : "no" }); }); db.menuVersion++; save(); } return { ok: true, menu: db.menu, menuVersion: db.menuVersion }; }
    if (action === "saveMenu") {
      if (body.baseVersion && body.baseVersion !== db.menuVersion) return { ok: false, error: "conflict" };
      db.menu = (body.menu || []).map(function (d) { return Object.assign({}, d, { on: isOn(d) ? "yes" : "no" }); });
      db.menuVersion++; save(); return { ok: true, menuVersion: db.menuVersion };
    }
    if (action === "seedText") {
      var have = {}; db.text.forEach(function (r) { have[r.key] = true; });
      (body.fields || []).forEach(function (f) { if (!have[f.key]) db.text.push({ key: f.key, section: f.section, label: f.label, text: "" }); });
      save(); return { ok: true, text: db.text };
    }
    if (action === "saveText") {
      (body.items || []).forEach(function (it) { var row = db.text.find(function (r) { return r.key === it.key; }); if (row) row.text = it.text; else db.text.push({ key: it.key, text: it.text }); });
      save(); return { ok: true, text: db.text };
    }
    if (action === "setStatus") { db.submissions.forEach(function (s) { if (s.id === body.id) s.status = body.status; }); save(); return { ok: true }; }
    if (action === "saveVoteSetup") {
      db.submissions = db.submissions.filter(function (s) { return s.type !== "vote"; });
      db.voteSetup = { flavors: body.flavors || [], round: String((parseInt(db.voteSetup.round, 10) || 0) + 1) };
      save(); return { ok: true, flavors: db.voteSetup.flavors, round: db.voteSetup.round };
    }
    if (action === "resetVotes") { db.submissions = db.submissions.filter(function (s) { return s.type !== "vote"; }); save(); return { ok: true }; }
    return { ok: false, error: "unknown" };
  }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.indexOf(PRACTICE_URL) !== 0) return realFetch(input, init);
    var u = new URL(url), method = ((init && init.method) || "GET").toUpperCase(), body = {};
    if (method === "POST") { try { body = JSON.parse((init && init.body) || "{}"); } catch (e) {} }
    var out = handle(method, u.searchParams, body);
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } })); }, 250);
    });
  };

  // a small label so nobody mistakes this for the real thing.
  // Dashboard: a plain strip above the page, so it never covers a button.
  // Website: a small pill in the corner that taps pass straight through.
  function badge() {
    if (document.getElementById("practice-badge")) return;
    var onDash = /dashboard/.test(location.pathname);
    var b = document.createElement("div");
    b.id = "practice-badge"; b.setAttribute("role", "note");
    b.textContent = onDash ? "TEST COPY, not live. Changes here never reach your real website." : "TEST COPY, not live";
    b.style.cssText = onDash
      ? "display:block;width:100%;background:#2b1a22;color:#fbf2df;font:600 11px/1.3 system-ui,sans-serif;letter-spacing:.06em;text-align:center;padding:7px 12px;box-sizing:border-box"
      : "position:fixed;left:10px;bottom:10px;z-index:99999;pointer-events:none;background:#2b1a22;color:#fbf2df;font:600 11px/1 system-ui,sans-serif;letter-spacing:.08em;padding:7px 10px;border-radius:999px;opacity:.85";
    if (onDash) document.body.insertBefore(b, document.body.firstChild); else document.body.appendChild(b);
  }
  if (document.body) badge(); else document.addEventListener("DOMContentLoaded", badge);
})();
