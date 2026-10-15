// Admin panel on the scorecard: sign in, see which week/month the next report covers, drop the
// Weekly Spread Dashboard, preview the change, publish, undo. main.js loads this module on demand.
import * as XLSX from "xlsx";
import { parseDashboard, pickSheet, payrollMonth, monthSkeleton, applySpread, nameResolver, MONTHNAME } from "../shared/spread-import.js";

const fmt = new Intl.NumberFormat("en-US");
const money = v => v == null ? "—" : (v < 0 ? "−$" : "$") + fmt.format(Math.abs(Math.round(v)));
const dateLabel = (s, year) => { const p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("en-US", year ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" }); };
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

let dlg = null, body = null, opts = {}, session = null, MONTHS = {}, META = null, NAMES = {}, TARGETS = null;

export function readSession(){
  try { const s = JSON.parse(sessionStorage.getItem("ss-admin")); return s && s.exp * 1000 > Date.now() ? s : null; } catch (e) { return null; }
}
function setSession(s){
  session = s;
  try { if (s) sessionStorage.setItem("ss-admin", JSON.stringify(s)); else sessionStorage.removeItem("ss-admin"); } catch (e) {}
  if (opts.onSession) opts.onSession(s);
}

// opts: {opener, onSession(session), onChange(), onView(key)}
export function openAdmin(o){
  opts = o || {};
  session = readSession();
  if (!dlg) build();
  dlg.showModal();
  draw();
}

function build(){
  dlg = el("dialog", "drawer adrawer"); dlg.setAttribute("aria-labelledby", "apTitle");
  dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => { if (opts.opener && opts.opener.isConnected) opts.opener.focus(); });
  const pin = el("div", "pin");
  const hd = el("header", "phead"), ht = el("div");
  ht.appendChild(el("div", "eyebrow", "Admin"));
  const h2 = el("h2", null, "Weekly spread upload"); h2.id = "apTitle"; ht.appendChild(h2);
  hd.appendChild(ht);
  const x = el("button", "pclose", "×"); x.type = "button"; x.setAttribute("aria-label", "Close"); x.addEventListener("click", () => dlg.close()); hd.appendChild(x);
  pin.appendChild(hd);
  body = el("div", "apbody"); pin.appendChild(body);
  dlg.appendChild(pin);
  document.body.appendChild(dlg);
  // a file dropped beside the drop zone shouldn't make the browser open it
  dlg.addEventListener("dragover", e => e.preventDefault());
  dlg.addEventListener("drop", e => e.preventDefault());
}

// ---- API ----
async function api(path, init = {}){
  const headers = { "content-type": "application/json" };
  if (session) headers.authorization = "Bearer " + session.token;
  let r;
  try { r = await fetch(path, Object.assign({ headers, cache: "no-store" }, init)); }
  catch (e) { throw new Error("Couldn't reach the server. Check your connection."); }
  const data = await r.json().catch(() => null);
  if (!data) throw new Error(r.status === 404 || r.status === 200 ? "The upload service isn't running here. Locally, start the site with npm run dev:netlify." : "The server sent an unexpected response (" + r.status + ").");
  if (r.status === 401 && path !== "/api/login"){ setSession(null); draw(); throw new Error(data.error); }
  if (!r.ok) throw new Error(data.error || "Something went wrong (" + r.status + ").");
  return data;
}

// Same data the scorecard shows: shipped JSON files plus anything uploaded.
async function loadData(){
  const idx = await fetch("data/index.json", { cache: "no-store" }).then(r => r.json());
  const [meta, docs, live] = await Promise.all([
    fetch("data/meta.json", { cache: "no-store" }).then(r => r.ok ? r.json() : null),
    Promise.all(idx.months.map(k => fetch("data/months/" + k + ".json", { cache: "no-store" }).then(r => r.json()))),
    fetch("/api/data", { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null)
  ]);
  MONTHS = {}; NAMES = {};
  docs.concat(live ? live.months : []).forEach(d => { MONTHS[d.key] = d; });
  META = (live && live.meta) || meta;
  TARGETS = (live && live.targets) || null;
  Object.values(MONTHS).forEach(d => ["sales", "recruiting"].forEach(s => (d[s] || []).forEach(r => { if (r.name !== "_other") NAMES[r.name] = r.full; })));
}
const known = () => Object.values(MONTHS).map(d => ({ key: d.key, start: d.start, end: d.end }));
function weekOfMonth(we){
  const pm = payrollMonth({ weekEnding: we }, known());
  if (pm.error || pm.isNew) return null;
  // the week ending is the last day of its week: Sunday start + 6 days, so days through it / 7 = week number
  return { label: MONTHS[pm.key].label, n: Math.round(((Date.parse(we) - Date.parse(pm.start)) / 864e5 + 1) / 7), of: pm.weeks };
}

// ---- views ----
function draw(){
  body.textContent = "";
  if (!session) return drawLogin();
  const bar = el("div", "apbar");
  bar.appendChild(el("span", "who", "Signed in as " + session.user));
  const out = el("button", "field small", "Sign out"); out.type = "button";
  out.addEventListener("click", () => { setSession(null); draw(); });
  bar.appendChild(out); body.appendChild(bar);

  const ctx = el("section", "psec apctx"); body.appendChild(ctx);
  const up = el("section", "psec");
  up.appendChild(dropZone());
  const pv = el("div", "appreview"); pv.id = "apPreview"; up.appendChild(pv);
  body.appendChild(up);
  const tg = el("section", "psec aptg"); body.appendChild(tg);
  const hist = el("section", "psec");
  const hh = el("h3", null, "Recent uploads"); hh.appendChild(el("span", "hint", "Undo puts a month back the way it was before that upload")); hist.appendChild(hh);
  const tb = el("div", "tablebox"), t = el("table", "num alog"), th = el("thead"), hr = el("tr");
  ["Uploaded", "File", "Month", "Report", "Spread", ""].forEach(h => hr.appendChild(el("th", null, h)));
  th.appendChild(hr); t.appendChild(th);
  const lb = el("tbody"); lb.id = "apLog"; t.appendChild(lb); tb.appendChild(t); hist.appendChild(tb);
  body.appendChild(hist);

  loadData().then(() => { drawContext(ctx); drawTargets(tg); }).catch(() => { ctx.textContent = "Couldn't load the current data."; });
  loadLog();
}

// What's on the scorecard now, and which week/month the next report should be.
function drawContext(box){
  box.textContent = "";
  box.appendChild(el("h3", null, "This week"));
  const grid = el("div", "apnow");
  const card = (lab, val, note) => { const d = el("div"); d.appendChild(el("div", "lab", lab)); d.appendChild(el("div", "val", val)); if (note) d.appendChild(el("div", "note", note)); grid.appendChild(d); };
  if (META && META.spreadWeekEnding){
    const cur = weekOfMonth(META.spreadWeekEnding), next = addDays(META.spreadWeekEnding, 7), nx = weekOfMonth(next);
    card("On the scorecard now", "Week ending " + dateLabel(META.spreadWeekEnding), cur ? cur.label + " · week " + cur.n + " of " + cur.of + (cur.n === cur.of ? " (full month)" : " (month to date)") : null);
    card("Next report", "Week ending " + dateLabel(next), nx ? nx.label + " · week " + nx.n + " of " + nx.of + (nx.n === nx.of ? " (closes the month)" : "") : "Starts a new payroll month");
  } else card("On the scorecard now", "No spread report yet", null);
  if (META && META.lastUpload) card("Last upload", new Date(META.lastUpload.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }), "by " + META.lastUpload.by);
  box.appendChild(grid);
}

// ---- monthly targets ----
// Each save is a version that applies from the chosen month until a later version.
const monthLabel = k => MONTHNAME[+k.slice(5) - 1] + " " + k.slice(0, 4);
function versionAt(key){ let v = null; ((TARGETS && TARGETS.versions) || []).forEach(x => { if (x.from <= key) v = x; }); return v; }
function parseAmount(raw){
  const t = String(raw).trim().toLowerCase().replace(/[$,\s]/g, "");
  if (!t) return null;
  const m = t.match(/^(\d+(?:\.\d+)?)([km]?)$/);
  return m ? Math.round(parseFloat(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1)) : NaN;
}
const amountText = v => v == null ? "" : "$" + fmt.format(v);
// current people on each side (latest month, not former, no house/unassigned) plus anyone who already has a target
function roster(side){
  const keys = Object.keys(MONTHS).sort(), latest = MONTHS[keys[keys.length - 1]], names = {};
  (latest[side] || []).forEach(r => { if (r.name !== "_other" && r.name !== "House" && !r.former) names[r.name] = r.full; });
  ((TARGETS && TARGETS.versions) || []).forEach(v => Object.keys((v.people || {})[side] || {}).forEach(n => { names[n] = NAMES[n] || n; }));
  return Object.entries(names).sort((a, b) => a[1].localeCompare(b[1]));
}

function drawTargets(box, notice){
  box.textContent = "";
  const h = el("h3", null, "Monthly targets"); h.appendChild(el("span", "hint", "Spread goals shown on the scorecard")); box.appendChild(h);
  const keys = Object.keys(MONTHS).sort(), latest = keys[keys.length - 1], now = versionAt(latest);
  box.appendChild(el("p", "pnote", now
    ? "In use: " + (now.team != null ? money(now.team) + " team target per 4-week month" + (now.scale5 ? " (×1.25 for 5-week months)" : "") : "per-person targets only") + ", since " + monthLabel(now.from) + "."
    : "No targets yet. Nothing about targets shows on the scorecard until you save one."));

  const f = el("form", "tform"); f.noValidate = true;
  const row = el("div", "trow");
  const fromL = el("label", null, "Applies from"), sel = el("select", "field");
  keys.slice().reverse().forEach(k => { const o = el("option", null, MONTHS[k].label); o.value = k; sel.appendChild(o); });
  sel.value = latest; fromL.appendChild(sel); row.appendChild(fromL);
  const teamL = el("label", null, "Team target per month"), team = el("input", "field");
  team.inputMode = "decimal"; team.placeholder = "e.g. 600k"; team.autocomplete = "off"; teamL.appendChild(team); row.appendChild(teamL);
  f.appendChild(row);
  const sc = el("label", "check"), cb = el("input"); cb.type = "checkbox";
  sc.appendChild(cb); sc.appendChild(document.createTextNode(" Amounts are for a 4-week month; scale 5-week months up ×1.25"));
  f.appendChild(sc);

  const det = el("details", "tpeople"); det.appendChild(el("summary", null, "Per-person targets (optional)"));
  const inputs = { sales: [], recruiting: [] };
  [["sales", "Account managers"], ["recruiting", "Recruiters"]].forEach(([side, title]) => {
    const g = el("div", "tgrid"); g.appendChild(el("h4", null, title));
    roster(side).forEach(([name, full]) => {
      const l = el("label", null, full), i = el("input", "field");
      i.inputMode = "decimal"; i.placeholder = "—"; i.autocomplete = "off"; i.dataset.name = name;
      l.appendChild(i); g.appendChild(l); inputs[side].push(i);
    });
    det.appendChild(g);
  });
  f.appendChild(det);

  const fill = v => {
    team.value = amountText(v && v.team); cb.checked = v ? v.scale5 !== false : true;
    let any = false;
    ["sales", "recruiting"].forEach(side => inputs[side].forEach(i => { const a = v && v.people && v.people[side] ? v.people[side][i.dataset.name] : null; i.value = amountText(a); if (a != null) any = true; }));
    det.open = any;
  };
  fill(versionAt(sel.value));
  sel.addEventListener("change", () => fill(versionAt(sel.value)));

  const bar = el("div", "pbar");
  const go = el("button", "field primary", "Save targets"); go.type = "submit";
  const msg = el("span", "pmsg"); msg.setAttribute("role", "status");
  if (notice) msg.textContent = notice;
  bar.appendChild(go); bar.appendChild(msg); f.appendChild(bar);
  f.addEventListener("submit", async e => {
    e.preventDefault(); msg.className = "pmsg"; msg.textContent = "";
    const bad = [];
    const read = i => { const v = parseAmount(i.value); i.setAttribute("aria-invalid", Number.isNaN(v) ? "true" : "false"); if (Number.isNaN(v)) bad.push(i); return v; };
    const people = { sales: {}, recruiting: {} };
    const teamV = read(team);
    ["sales", "recruiting"].forEach(side => inputs[side].forEach(i => { const v = read(i); if (v != null && !Number.isNaN(v)) people[side][i.dataset.name] = v; }));
    if (bad.length){ msg.className = "pmsg bad"; msg.textContent = "Use amounts like 600k, $600,000 or 1.2m."; if (bad[0] !== team) det.open = true; bad[0].focus(); return; }
    go.disabled = true; msg.textContent = "Saving…";
    try {
      const r = await api("/api/targets", { method: "POST", body: JSON.stringify({ from: sel.value, team: teamV, scale5: cb.checked, people }) });
      TARGETS = r.targets;
      if (opts.onChange) opts.onChange();
      drawTargets(box, "Saved. The scorecard shows these targets from " + monthLabel(sel.value) + " on.");
    } catch (err) { msg.className = "pmsg bad"; msg.textContent = err.message; go.disabled = false; }
  });
  box.appendChild(f);
}

function drawLogin(){
  const sec = el("section", "psec");
  const f = el("form", "login"); f.setAttribute("autocomplete", "on");
  f.appendChild(el("p", "pnote", "Sign in to upload the Weekly Spread Dashboard from the Monday email."));
  const field = (label, id, type, ac) => { const l = el("label", null, label), i = el("input", "field"); i.id = id; i.required = true; i.type = type; i.autocomplete = ac; i.name = ac; l.appendChild(i); f.appendChild(l); return i; };
  const u = field("Username", "apUser", "text", "username"), p = field("Password", "apPass", "password", "current-password");
  const go = el("button", "field primary", "Sign in"); go.type = "submit"; f.appendChild(go);
  const err = el("p", "aerr"); err.setAttribute("role", "alert"); f.appendChild(err);
  f.addEventListener("submit", async e => {
    e.preventDefault(); go.disabled = true; err.textContent = "";
    try { const r = await api("/api/login", { method: "POST", body: JSON.stringify({ user: u.value.trim(), password: p.value }) }); setSession(r); draw(); }
    catch (x) { err.textContent = x.message; go.disabled = false; p.select(); }
  });
  sec.appendChild(f); body.appendChild(sec);
  setTimeout(() => u.focus(), 0);
}

function dropZone(){
  const drop = el("div", "drop"); drop.tabIndex = 0; drop.setAttribute("role", "button");
  drop.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4m0 0l-4 4m4-4l4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  drop.appendChild(el("strong", null, "Drag this week's Excel file here"));
  drop.appendChild(el("span", null, "or click to choose it · .xlsx, .xlsm or .xls"));
  const input = el("input"); input.type = "file"; input.accept = ".xlsx,.xlsm,.xls"; input.hidden = true; input.id = "apFile"; drop.appendChild(input);
  drop.addEventListener("click", e => { if (e.target !== input) input.click(); });
  drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " "){ e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => { if (input.files[0]) readFile(input.files[0]); input.value = ""; });
  ["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  return drop;
}

function problem(title, text){ const d = el("div", "empty"); d.appendChild(el("strong", null, title)); d.appendChild(document.createTextNode(text)); return d; }

async function readFile(file){
  const out = document.getElementById("apPreview"); out.textContent = "";
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) return out.appendChild(problem("That isn't an Excel file", "Choose the .xlsx attachment from the Weekly Spread Dashboard email."));
  if (file.size > 15e6) return out.appendChild(problem("That file is too large", "The weekly dashboard is usually well under 1 MB."));
  let wb;
  try { wb = XLSX.read(await file.arrayBuffer(), { type: "array" }); }
  catch (e) { return out.appendChild(problem("Couldn't open the file", "It may be damaged or password-protected. Save it again from Excel and retry.")); }
  const rowsOf = n => {
    const ws = wb.Sheets[n]; if (!ws || !ws["!ref"]) return [];
    const range = XLSX.utils.decode_range(ws["!ref"]); range.s.c = 0; range.s.r = 0; // keep column A so offsets match the sheet
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", range });
  };
  const sheet = pickSheet(wb.SheetNames, rowsOf);
  if (!sheet) return out.appendChild(problem("Couldn't find the dashboard sheet", "Looked for a sheet named \"Dashboard - Month To Date\" or one with a \"Week Ending\" row. Sheets in this file: " + wb.SheetNames.join(", ") + "."));
  await loadData().catch(() => {});
  preview(out, file, sheet, parseDashboard(rowsOf(sheet)));
}

function preview(out, file, sheet, p){
  out.textContent = "";
  const errors = p.warnings.filter(w => /Couldn't find/.test(w));
  if (errors.length) return out.appendChild(problem("This doesn't look like the Weekly Spread Dashboard", errors.join(" ") + " (Sheet read: " + sheet + ".)"));
  const pm = payrollMonth(p, known());
  if (pm.error) return out.appendChild(problem("Couldn't place this report in a payroll month", pm.error));
  const cur = MONTHS[pm.key] || null, base = cur || monthSkeleton(pm);
  const next = applySpread(base, p, NAMES);
  const partial = p.weekOf && p.weekOf[0] < p.weekOf[1];

  const checks = [], add = (ok, text) => checks.push([ok, text]);
  add(true, "Read sheet “" + sheet + "” from " + file.name);
  const near = (a, b) => Math.abs(a - b) < 1.5;
  const sum = t => Object.values(t).reduce((s, v) => s + v, 0);
  const aeT = p.aeTotal ?? sum(p.ae), rmT = p.rmTotal ?? sum(p.rm);
  add(near(aeT, p.gp), "Account manager spread totals " + money(aeT) + (near(aeT, p.gp) ? ", matching" : ", but") + " company gross profit " + money(p.gp));
  add(near(rmT, p.gp), "Recruiter spread totals " + money(rmT) + (near(rmT, p.gp) ? ", matching" : ", but") + " company gross profit " + money(p.gp));
  if (pm.isNew) add(null, "Adds " + next.label + " (" + dateLabel(pm.start) + " – " + dateLabel(pm.end, true) + "). Bullhorn activity for it isn't loaded yet, so only spread will show.");
  if (pm.gap) add(false, pm.gap);
  if (cur && cur.spread) add(null, "Replaces the spread now shown for " + cur.label + ": " + money(cur.gp) + (cur.spreadWeeks ? " (week " + cur.spreadWeeks[0] + " of " + cur.spreadWeeks[1] + ")" : ""));
  const older = cur && cur.spreadWeeks && p.weekOf && p.weekOf[0] < cur.spreadWeeks[0];
  if (older) add(false, "This report (week " + p.weekOf[0] + ") is older than the one already shown (week " + cur.spreadWeeks[0] + ").");
  else if (META && META.spreadWeekEnding && p.weekEnding < META.spreadWeekEnding) add(null, "The latest report on the scorecard is for the week ending " + dateLabel(META.spreadWeekEnding) + "; this one is older. That's fine for correcting a past month.");
  if (p.month && p.month !== next.label.split(" ")[0]) add(false, "The sheet's Month cell says " + p.month + ", but the week ending falls in " + next.label + ".");
  const resolve = nameResolver(NAMES), fresh = [];
  [p.ae, p.rm].forEach(t => Object.keys(t).forEach(n => { if (n !== "Perm" && !resolve(n).matched && fresh.indexOf(n) < 0) fresh.push(n); }));
  if (fresh.length) add(false, "New name" + (fresh.length > 1 ? "s" : "") + " not on the scorecard yet, added as new rows: " + fresh.join(", "));
  p.warnings.forEach(w => add(false, w));

  const card = el("div", "pcard");
  const head = el("div", "phd"), t = el("div");
  t.appendChild(el("div", "eyebrow", "Preview")); t.appendChild(el("h2", null, next.label));
  t.appendChild(el("div", "sub", "Week ending " + dateLabel(p.weekEnding, true) + (p.weekOf ? " · week " + p.weekOf[0] + " of " + p.weekOf[1] + (partial ? " (month to date)" : " (full month)") : "")));
  head.appendChild(t);
  const k = el("div", "pk");
  [["Gross profit", money(p.gp)], ["Revenue", money(p.revenue)], ["Margin", p.revenue ? (p.gp / p.revenue * 100).toFixed(1) + "%" : "—"]].forEach(([l, v]) => {
    const d = el("div"); d.appendChild(el("div", "lab", l)); d.appendChild(el("div", "val num", v)); k.appendChild(d);
  });
  head.appendChild(k); card.appendChild(head);
  const ul = el("ul", "checks");
  checks.forEach(([ok, text]) => { const li = el("li", ok === true ? "ok" : ok === false ? "warn" : "info"); li.appendChild(el("span", "ic", ok === true ? "✓" : ok === false ? "!" : "i")); li.appendChild(el("span", null, text)); ul.appendChild(li); });
  card.appendChild(ul);
  const grid = el("div", "pgrid");
  grid.appendChild(changeTable("Account managers", base.sales || [], next.sales, p.ae.Perm));
  grid.appendChild(changeTable("Recruiters", base.recruiting || [], next.recruiting, p.rm.Perm));
  card.appendChild(grid);

  const bar = el("div", "pbar");
  const go = el("button", "field primary", "Publish to the scorecard"); go.type = "button";
  const cancel = el("button", "field", "Cancel"); cancel.type = "button";
  const msg = el("span", "pmsg"); msg.setAttribute("role", "status");
  cancel.addEventListener("click", () => { out.textContent = ""; });
  go.addEventListener("click", async () => {
    go.disabled = cancel.disabled = true; msg.className = "pmsg"; msg.textContent = "Publishing…";
    try {
      const r = await api("/api/upload", { method: "POST", body: JSON.stringify({
        parsed: { weekEnding: p.weekEnding, revenue: p.revenue, gp: p.gp, month: p.month || null, weekOf: p.weekOf || null, ae: p.ae, rm: p.rm },
        month: { key: pm.key, start: pm.start, end: pm.end }, names: NAMES, file: file.name }) });
      out.textContent = "";
      const ok = el("div", "done"); ok.appendChild(el("strong", null, r.label + " is live: " + money(r.gp) + " spread"));
      const view = el("button", "field small", "View " + r.label.split(" ")[0] + " on the scorecard"); view.type = "button";
      view.addEventListener("click", () => { dlg.close(); if (opts.onView) opts.onView(r.key); });
      ok.appendChild(view); out.appendChild(ok);
      if (opts.onChange) opts.onChange();
      await loadData(); drawContext(document.querySelector(".adrawer .apctx")); loadLog();
    } catch (err) { msg.className = "pmsg bad"; msg.textContent = err.message; go.disabled = cancel.disabled = false; }
  });
  bar.appendChild(go); bar.appendChild(cancel); bar.appendChild(msg); card.appendChild(bar);
  out.appendChild(card);
  card.scrollIntoView({ block: "start", behavior: "smooth" });
}

// Before/after spread for one side, biggest amounts first; unchanged zero rows are left out.
// perm: the sheet's Perm line, which (as in refresh.py) isn't credited to anyone but is part of gross profit.
function changeTable(title, before, after, perm){
  const prev = {}; before.forEach(r => { prev[r.name] = r.spread; });
  const rows = after.filter(r => r.name !== "_other" && (r.spread || prev[r.name])).sort((a, b) => (b.spread || 0) - (a.spread || 0));
  const box = el("div");
  box.appendChild(el("h3", null, title));
  const tb = el("div", "tablebox"), t = el("table", "num"), th = el("thead"), hr = el("tr");
  ["Name", "Now", "After", "Change"].forEach(h => hr.appendChild(el("th", null, h)));
  th.appendChild(hr); t.appendChild(th);
  const tbody = el("tbody");
  let sb = 0, sa = 0;
  rows.forEach(r => {
    const was = prev[r.name], tr = el("tr");
    const nm = el("td", null, r.full); if (!(r.name in NAMES)) nm.appendChild(el("span", "tag", "new")); tr.appendChild(nm);
    tr.appendChild(el("td", was == null ? "zero" : null, was == null ? "—" : money(was)));
    tr.appendChild(el("td", null, money(r.spread)));
    const d = (r.spread || 0) - (was || 0);
    tr.appendChild(el("td", Math.abs(d) < 1 ? "zero" : d > 0 ? "up" : "down", Math.abs(d) < 1 ? "—" : (d > 0 ? "+" : "−") + money(Math.abs(d))));
    tbody.appendChild(tr); sb += was || 0; sa += r.spread || 0;
  });
  if (perm){
    const pr = el("tr", "perm"); pr.appendChild(el("td", null, "Perm (not credited to a person)")); pr.appendChild(el("td", "zero", "")); pr.appendChild(el("td", null, money(perm))); pr.appendChild(el("td", "zero", ""));
    tbody.appendChild(pr); sa += perm;
  }
  const hadSpread = before.some(r => r.spread != null);
  const tot = el("tr", "total"); ["Total", hadSpread ? money(sb) : "—", money(sa), ""].forEach(x => tot.appendChild(el("td", null, x))); tbody.appendChild(tot);
  t.appendChild(tbody); tb.appendChild(t); box.appendChild(tb);
  return box;
}

async function loadLog(){
  const tbody = document.getElementById("apLog"); if (!tbody) return;
  const note = text => { tbody.textContent = ""; const tr = el("tr"), td = el("td", "zero", text); td.colSpan = 6; tr.appendChild(td); tbody.appendChild(tr); };
  let log;
  try { log = (await api("/api/log")).log; } catch (err) { return note(err.message); }
  if (!log.length) return note("No uploads yet. The scorecard is showing the data that ships with the site.");
  tbody.textContent = "";
  const latest = {};
  log.forEach(e => { if (!e.reverted && !latest[e.key]) latest[e.key] = e.id; });
  log.forEach(e => {
    const tr = el("tr", e.reverted ? "undone" : null);
    tr.appendChild(el("td", null, new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })));
    const f = el("td", "file", e.file || "—"); f.title = (e.file || "") + (e.by ? " · uploaded by " + e.by : ""); tr.appendChild(f);
    tr.appendChild(el("td", null, e.label));
    tr.appendChild(el("td", null, "w/e " + dateLabel(e.weekEnding) + (e.weekOf ? " · wk " + e.weekOf[0] + "/" + e.weekOf[1] : "")));
    tr.appendChild(el("td", null, (e.prevGp != null ? money(e.prevGp) + " → " : "") + money(e.gp)));
    const act = el("td");
    if (e.reverted) act.appendChild(el("span", "tag", "undone"));
    else if (latest[e.key] === e.id){
      const b = el("button", "field small", "Undo"); b.type = "button";
      b.addEventListener("click", async () => {
        if (!b.dataset.armed){ b.dataset.armed = "1"; b.textContent = "Confirm undo"; b.classList.add("danger"); setTimeout(() => { if (b.isConnected && b.dataset.armed){ delete b.dataset.armed; b.textContent = "Undo"; b.classList.remove("danger"); } }, 5000); return; }
        b.disabled = true; b.textContent = "Undoing…";
        try {
          await api("/api/revert", { method: "POST", body: JSON.stringify({ id: e.id }) });
          if (opts.onChange) opts.onChange();
          await loadData(); drawContext(document.querySelector(".adrawer .apctx")); loadLog();
        } catch (err) { b.disabled = false; b.textContent = "Undo"; act.appendChild(el("div", "pmsg bad", err.message)); }
      });
      act.appendChild(b);
    }
    tr.appendChild(act); tbody.appendChild(tr);
  });
}
