// Rebuilds the Bullhorn activity of month docs (calls, visits, job orders, send outs, interviews, deals, starts),
// keeping each month's spread. A port of build() in tools/refresh.py, used by the Bullhorn sync function.

export const MONTHNAME = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// ---- people ----
// Short names are Bullhorn last names, as in tools/refresh.py. Add new staff here.
export const FULL = {Salemi:"Michael Salemi",Wilkinson:"Hannah Wilkinson",Madden:"Paige Madden",Nash:"James Nash",Endres:"Jason Endres",
  "O'Donnell":"Brendan O'Donnell",McCabe:"Charlotte McCabe",LeRoy:"Eli LeRoy",Vaydik:"Bryn Vaydik",Keane:"Gertrude Olivia Keane",
  Gomez:"Zoe Gomez",Lawler:"Ryan Lawler",Sleeper:"Peter Sleeper",Buleha:"Jillian Buleha",Jenkins:"Chris Jenkins",Reyes:"Kenia Reyes",
  House:"House Account",Szemplinski:"Reed Szemplinski",Calabro:"Joseph Calabro",Rogers:"Connor Rogers",Driscoll:"Kyle Driscoll",
  Garrison:"Aaron Garrison",Kyhos:"Justin Kyhos",Daly:"Ian Daly",Halvorsen:"Mary Halvorsen",Campbell:"Camryn Campbell",
  Lindsey:"Samuel Lindsey",Eames:"Allison Eames",Cote:"Davis Cote",Sales:"Zach Sales",Kunuthur:"Siri Kunuthur",Smithwick:"Julie Smithwick"};
export const FORMER = new Set(["Buleha","Jenkins","Reyes","Eames","Cote"]);
export const SALES = new Set(["Salemi","Wilkinson","Madden","Nash","Endres","O'Donnell","McCabe","LeRoy","Vaydik","Keane","Gomez","Lawler","Sleeper","Buleha","Jenkins","Reyes","House"]);
export const RECR = new Set(["Szemplinski","Calabro","Rogers","Driscoll","Garrison","Kyhos","Daly","Halvorsen","Campbell","Lindsey","Eames","Cote","House","Sales"]);
const SYSTEM = new Set(["API", "Account", null, undefined]);
const MIT_AE = "Wilkinson"; // MIT Lincoln Laboratory reqs loaded by the web import belong to Hannah's account

export const CALL_ACTIONS = 'action:(call OR "moat call" OR "recontact call" OR "job qualification call" OR "req qualification call" OR "video call" OR "business conversation")';
export const VISIT_ACTIONS = 'action:("new meeting" OR "existing meeting" OR "in-person meeting" OR meeting)';
export const INTERVIEW_ACTIONS = 'action:("interview" OR "interview prep" OR "interview debrief")';

// ---- dates ----
const DAY = 864e5;
const utc = iso => { const p = iso.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); };
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const pad = n => String(n).padStart(2, "0");
export const addDays = (d, n) => iso(utc(d) + n * DAY);

const etFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
// Bullhorn timestamps are ms; the scorecard counts them by their Eastern date.
export const etDate = ms => etFmt.format(new Date(ms));

// Payroll months: Sunday-Saturday weeks, 5-4-4 per quarter, each quarter starting on the Sunday on or before
// the 1st of Jan/Apr/Jul/Oct (Q2 2026: Mar 29 - May 2, May 3 - May 30, May 31 - Jun 27).
function quarterStart(y, q){ const first = utc(y + "-" + pad(q * 3 + 1) + "-01"); return first - new Date(first).getUTCDay() * DAY; }
export function monthRange(key){
  const [y, m] = key.split("-").map(Number), q = Math.floor((m - 1) / 3), i = (m - 1) % 3;
  const start = quarterStart(y, q) + [0, 35, 63][i] * DAY, weeks = i === 0 ? 5 : 4;
  return { start: iso(start), end: iso(start + (weeks * 7 - 1) * DAY), weeks };
}
const shiftKey = (key, n) => { const [y, m] = key.split("-").map(Number), t = y * 12 + m - 1 + n; return Math.floor(t / 12) + "-" + pad(t % 12 + 1); };
export const prevKey = key => shiftKey(key, -1);

// Maps a date to its payroll month, using known month docs first so existing boundaries never move.
export function monthKeyer(docs){
  const known = Object.values(docs).filter(d => d && d.start && d.end);
  return day => {
    if (!day) return null;
    const hit = known.find(d => d.start <= day && day <= d.end);
    if (hit) return hit.key;
    const k = day.slice(0, 7);
    for (const c of [k, shiftKey(k, 1), shiftKey(k, -1)]){ const r = monthRange(c); if (r.start <= day && day <= r.end) return c; }
    return null;
  };
}
const saturdayOf = day => { const t = utc(day); return iso(t + (6 - new Date(t).getUTCDay()) * DAY); };

// ---- Bullhorn helpers ----
function ln(p){
  if (!p) return null;
  if (p.firstName === "Webdeveloper" || p.lastName === "API") return "API";
  if (p.firstName === "House" && p.lastName === "Account") return "House";
  return p.lastName ?? null;
}
function aeOfJob(jo){
  if (!jo) return null;
  const o = ln(jo.owner), cl = (jo.clientCorporation && jo.clientCorporation.name) || "";
  if (cl.includes("MIT Lincoln") && !SALES.has(o)) return MIT_AE;
  if (o === "API") return null;
  return o;
}
const name = (p) => ((p && p.firstName) || "").trim() + " " + ((p && p.lastName) || "").trim();
const round2 = v => Math.round(v * 100) / 100;

// The months a sync rebuilds: the previous and current payroll month on `today` (YYYY-MM-DD, Eastern),
// or the given month keys (a backfill).
export function plan(today, docs, keys){
  if (!keys){
    const keyOf = monthKeyer(docs), cur = keyOf(today), prv = keyOf(addDays((docs[cur] || monthRange(cur)).start, -1));
    keys = [prv, cur];
  }
  const months = [...keys].sort().map(k => docs[k] ? { key: k, start: docs[k].start, end: docs[k].end, weeks: docs[k].weeks } : Object.assign({ key: k }, monthRange(k)));
  return { today, months, start: months[0].start, end: months[months.length - 1].end };
}

// raw: {js, jo, pl, mt, iv, calls} arrays of Bullhorn records (calls: Note records with dateAdded and commentingPerson).
// docs: {key: month doc} as the scorecard shows them now. Returns {docs: {key: new doc}, warnings: [...]}.
export function build(raw, docs, today, onlyKeys){
  const p = plan(today, docs, onlyKeys), keys = p.months.map(m => m.key), inKeys = k => keys.includes(k);
  const keyOf = monthKeyer(Object.assign({}, docs, Object.fromEntries(p.months.map(m => [m.key, m]))));
  const keyOfMs = ms => ms ? keyOf(etDate(ms)) : null;
  const full = Object.assign({}, FULL);
  for (const d of Object.values(docs)) for (const r of [...(d.sales || []), ...(d.recruiting || [])]) if (r.name !== "_other" && !full[r.name]) full[r.name] = r.full;
  for (const r of [...raw.js, ...raw.jo, ...raw.pl, ...raw.mt])
    for (const pp of [r.sendingUser, r.jobOrder && r.jobOrder.owner, r.owner, r.commentingPerson]){
      const l = ln(pp);
      if (l && !full[l] && !SYSTEM.has(l) && pp.firstName) full[l] = name(pp).trim();
    }

  const C = () => Object.fromEntries(keys.map(k => [k, {}]));
  const inc = (t, k, n) => { t[k][n] = (t[k][n] || 0) + 1; };
  const jobs = C(), sendouts = C(), subs = C(), visits = C(), dealsAe = C(), dealsRc = C(), starts = C(), ivAe = C(), ivRc = C(), calls = C();
  const dealList = Object.fromEntries(keys.map(k => [k, []]));
  // per client company (Bullhorn ClientCorporation id), for the Primes section
  const clients = Object.fromEntries(keys.map(k => [k, {}]));
  const byClient = (k, corp, f) => {
    if (!corp || corp.id == null) return;
    const c = clients[k][corp.id] || (clients[k][corp.id] = { name: (corp.name || "").trim(), jobOrders: 0, visits: 0, submittals: 0, interviews: 0, deals: 0 });
    c[f]++;
  };

  for (const r of raw.jo){ const k = keyOfMs(r.dateAdded); if (inKeys(k)){ inc(jobs, k, aeOfJob(r) || "_other"); byClient(k, r.clientCorporation, "jobOrders"); } }
  for (const r of raw.js){
    if (r.status === "New Lead") continue;
    const k = keyOfMs(r.dateAdded); if (!inKeys(k)) continue;
    inc(sendouts, k, aeOfJob(r.jobOrder) || "_other");
    const s = ln(r.sendingUser); inc(subs, k, SYSTEM.has(s) ? "_other" : s);
    byClient(k, (r.jobOrder || {}).clientCorporation, "submittals");
  }
  for (const r of raw.mt){
    if ((r.personReference || {})._subtype !== "ClientContact") continue;
    const k = keyOfMs(r.dateAdded); if (!inKeys(k)) continue;
    inc(visits, k, ln(r.commentingPerson) || "_other");
    const cc = ((r.clientContacts || {}).data || [])[0];
    byClient(k, cc && cc.clientCorporation, "visits");
  }
  for (const r of raw.calls){ const k = keyOfMs(r.dateAdded), n = ln(r.commentingPerson); if (inKeys(k) && n) inc(calls, k, n); }
  const recOfPl = r => {
    const s = ln((r.jobSubmission || {}).sendingUser); if (s && !SYSTEM.has(s)) return s;
    const o = ln((r.candidate || {}).owner); return o && !SYSTEM.has(o) ? o : "_other";
  };
  for (const r of raw.pl){
    const k = keyOfMs(r.dateAdded);
    if (inKeys(k)){
      const ae = aeOfJob(r.jobOrder) || "_other", rc = recOfPl(r), jo = r.jobOrder || {};
      inc(dealsAe, k, ae); inc(dealsRc, k, rc); byClient(k, jo.clientCorporation, "deals");
      dealList[k].push({ candidate: name(r.candidate).trim(), client: (jo.clientCorporation || {}).name ?? null, title: jo.title ?? null,
        ae, recruiter: rc, start: r.dateBegin ? etDate(r.dateBegin) : null, status: r.status ?? null, added: etDate(r.dateAdded) });
    }
    const ks = keyOfMs(r.dateBegin);
    if (inKeys(ks) && r.status !== "Never Started") inc(starts, ks, aeOfJob(r.jobOrder) || "_other");
  }
  // Interviews: once per candidate per week, credited to the latest submission's recruiter and AE (or the note's author).
  const byCand = {};
  for (const r of raw.js){ const c = (r.candidate || {}).id; if (c) (byCand[c] || (byCand[c] = [])).push(r); }
  const seen = new Set();
  let withoutSubmission = 0;
  for (const r of [...raw.iv].sort((a, b) => a.dateAdded - b.dateAdded)){
    const pr = r.personReference || {};
    if (pr._subtype !== "Candidate") continue;
    const day = etDate(r.dateAdded), sk = pr.id + "|" + saturdayOf(day);
    if (seen.has(sk)) continue;
    seen.add(sk);
    const k = keyOf(day); if (!inKeys(k)) continue;
    const cands = (byCand[pr.id] || []).filter(s => s.dateAdded <= r.dateAdded + 3 * DAY);
    const author = ln(r.commentingPerson);
    let rc, ae;
    if (cands.length){ const s = cands.reduce((a, b) => b.dateAdded > a.dateAdded ? b : a); rc = ln(s.sendingUser); ae = aeOfJob(s.jobOrder); byClient(k, (s.jobOrder || {}).clientCorporation, "interviews"); }
    else { withoutSubmission++; rc = SALES.has(author) ? null : author; ae = SALES.has(author) ? author : null; }
    inc(ivRc, k, rc && !SYSTEM.has(rc) ? rc : (author || "_other"));
    inc(ivAe, k, ae || "_other");
  }

  const warnings = [], out = {};
  const people = new Set();
  for (const k of keys) for (const t of [subs[k], jobs[k], visits[k], dealsRc[k]]) for (const [n, v] of Object.entries(t)) if (v && !SYSTEM.has(n) && n !== "_other") people.add(n);
  const notInFull = [...people].filter(n => !(n in FULL) && !FORMER.has(n)).sort();
  if (notInFull.length) warnings.push("Not on the roster in shared/bullhorn-build.js: " + notInFull.join(", "));

  const sum = (t, names) => Object.entries(t).reduce((a, [n, v]) => a + (names(n) ? v : 0), 0);
  for (const m of p.months){
    const k = m.key, old = docs[k] || {};
    const spAe = {}, spRm = {};
    for (const r of old.sales || []) if (r.spread != null) spAe[r.name] = r.spread;
    for (const r of old.recruiting || []) if (r.spread != null) spRm[r.name] = r.spread;
    const hasSp = !!old.spread;
    const cnt = (t, n) => t[k][n] || 0;

    const names = new Set([...SALES, ...Object.keys(spAe)]);
    const rows = [];
    for (const n of [...names].sort(cmp)){
      if (n === "Perm" || n === "_other") continue;
      const row = { name: n, full: full[n] || n, former: FORMER.has(n), spread: hasSp ? round2(spAe[n] || 0) : null, calls: cnt(calls, n),
        visits: cnt(visits, n), jobOrders: cnt(jobs, n), sendOuts: cnt(sendouts, n), interviews: cnt(ivAe, n), deals: cnt(dealsAe, n), starts: cnt(starts, n) };
      if (["spread","calls","visits","jobOrders","sendOuts","interviews","deals","starts"].some(f => row[f])) rows.push(row);
    }
    const notName = n => !names.has(n);
    const oth = { name: "_other", full: "Unassigned / system-owned", former: false, spread: null, calls: 0, visits: cnt(visits, "_other"),
      jobOrders: sum(jobs[k], notName), sendOuts: sum(sendouts[k], notName), interviews: sum(ivAe[k], notName), deals: sum(dealsAe[k], notName), starts: sum(starts[k], notName) };
    if (["jobOrders","sendOuts","interviews","deals","starts"].some(f => oth[f])) rows.push(oth);

    const rnames = new Set([...RECR, ...Object.keys(spRm), ...Object.entries(subs[k]).filter(([n, v]) => v >= 3 && n !== "_other").map(([n]) => n)]);
    const rrows = [];
    for (const n of [...rnames].sort(cmp)){
      if (n === "Perm" || n === "_other") continue;
      const row = { name: n, full: full[n] || n, former: FORMER.has(n), ae: SALES.has(n) && n !== "House", spread: hasSp ? round2(spRm[n] || 0) : null,
        calls: cnt(calls, n), submittals: cnt(subs, n), interviews: cnt(ivRc, n), placements: cnt(dealsRc, n) };
      if (["spread","calls","submittals","interviews","placements"].some(f => row[f])) rrows.push(row);
    }
    const rOther = n => !rnames.has(n) || n === "_other";
    const roth = { name: "_other", full: "Other / unassigned", former: false, ae: false, spread: null, calls: 0,
      submittals: sum(subs[k], rOther), interviews: sum(ivRc[k], rOther), placements: sum(dealsRc[k], rOther) };
    if (["submittals","interviews","placements"].some(f => roth[f])) rrows.push(roth);

    const mo = +k.slice(5);
    const doc = { key: k, label: MONTHNAME[mo - 1] + " " + k.slice(0, 4), short: MONTHNAME[mo - 1].slice(0, 3), start: m.start, end: m.end,
      weeks: m.weeks, spread: hasSp, gp: hasSp && old.gp != null ? round2(old.gp) : null, revenue: hasSp && old.revenue != null ? round2(old.revenue) : null,
      sales: rows, recruiting: rrows, deals: dealList[k].sort((a, b) => a.added < b.added ? -1 : a.added > b.added ? 1 : 0) };
    if (old.spreadWeeks) doc.spreadWeeks = old.spreadWeeks;
    doc.clients = clients[k];
    out[k] = doc;
  }
  return { docs: out, warnings, interviewsWithoutSubmission: withoutSubmission, plan: p };
}

// Python's default string sort (by code point), so row order matches refresh.py.
function cmp(a, b){ return a < b ? -1 : a > b ? 1 : 0; }

// ---- Recontacting ----
// Last attempted contact: the newest outreach note, reached or not (calls, voicemails, texts, emails, InMails, meetings).
// Last note of substance: the newest conversation note with something written in it, skipping dialer logs
// ("[cc:…]", "Outbound Call <name> <number>"), voicemails, and admin notes (submissions, onboarding, placed).
export const ATTEMPT_ACTIONS = new Set(["call","outbound call","o/b","left message","recontact call","in-person recontact","text","email","linkedin inmail",
  "video call","moat call","business conversation","inbound call","i/b","in-person meeting","existing meeting","new meeting","meeting","out of office event","interview prep","interview debrief"]);
export const SUBSTANCE_ACTIONS = new Set(["recontact call","in-person recontact","business conversation","call","outbound call","inbound call","video call","moat call",
  "in-person meeting","existing meeting","new meeting","meeting","out of office event","interview debrief","interview prep","text"]);
export function plainNote(html){
  return String(html || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\[cc:[^\]]*\]/gi, " ").replace(/\s+/g, " ").trim();
}
const AUTO_LOG = /^(outbound|inbound) call\b.*\+?\d[\d\s()-]{6,}/i;
export function contactSummary(notes){
  const brief = n => ({ id: n.id, date: etDate(n.dateAdded), action: n.action || null, by: n.commentingPerson ? name(n.commentingPerson).trim() : null });
  let attempt = null, substance = null;
  for (const n of [...notes].sort((a, b) => b.dateAdded - a.dateAdded)){
    const a = String(n.action || "").trim().toLowerCase();
    if (!attempt && ATTEMPT_ACTIONS.has(a)) attempt = brief(n);
    if (!substance && SUBSTANCE_ACTIONS.has(a)){
      const t = plainNote(n.comments);
      if (t.length >= 40 && !AUTO_LOG.test(t)) substance = Object.assign(brief(n), { text: t.length > 1500 ? t.slice(0, 1497) + "…" : t });
    }
    if (attempt && substance) break;
  }
  return { attempt, substance };
}

// ---- Primes: federal clients with someone billing ----
// Groups the report's Federal rows by Bullhorn company, using each row's Placement ID. Report clients that share
// a Bullhorn company (BAE Space and BAE - GEO are both under the BAE Systems records) become one group, since
// Bullhorn can't tell their activity apart.
export function primeGroups(detail, placements, mtdClients){
  const pl = Object.fromEntries(placements.map(p => [p.id, p]));
  const fed = detail.filter(d => /^federal$/i.test(d.lob || ""));
  const parent = {}, find = x => parent[x] === x ? x : (parent[x] = find(parent[x])), join = (a, b) => { parent[find(a)] = find(b); };
  const corpOf = d => { const p = pl[d.placementId]; return p && p.jobOrder && p.jobOrder.clientCorporation; };
  for (const d of fed){
    const c = "s:" + d.client; parent[c] = parent[c] || c;
    const corp = corpOf(d); if (corp){ const k = "c:" + corp.id; parent[k] = parent[k] || k; join(c, k); }
  }
  const groups = {};
  for (const d of fed){
    const g = groups[find("s:" + d.client)] || (groups[find("s:" + d.client)] = { clients: [], corps: {}, hc: 0, revenue: 0, gp: 0, hours: 0, people: 0, unmatched: 0 });
    if (g.clients.indexOf(d.client) < 0) g.clients.push(d.client);
    const corp = corpOf(d); if (corp) g.corps[corp.id] = (corp.name || "").trim(); else g.unmatched++;
    g.hc += d.hc || 0; g.revenue += d.revenue; g.gp += d.gp; g.hours += d.hours || 0; g.people++;
  }
  const mtd = Object.fromEntries((mtdClients || []).map(c => [c.client, c]));
  // a company that also has Commercial rows (ServiceNow) has activity Bullhorn can't split by line of business
  const commercialCorps = new Set(detail.filter(d => !/^federal$/i.test(d.lob || "")).map(d => { const c = corpOf(d); return c && c.id; }).filter(Boolean));
  return Object.values(groups).map(g => {
    const m = g.clients.map(c => mtd[c]).filter(Boolean);
    return { name: g.clients.join(" / "), clients: g.clients, corps: Object.entries(g.corps).map(([id, n]) => ({ id: +id, name: n })),
      hc: g.hc, people: g.people, weeklyRevenue: round2(g.revenue), weeklyGp: round2(g.gp), hours: g.hours,
      mtdGp: m.length ? round2(m.reduce((a, c) => a + c.gp, 0)) : null, unmatched: g.unmatched,
      sharedWithCommercial: Object.keys(g.corps).some(id => commercialCorps.has(+id)) };
  }).sort((a, b) => b.weeklyGp - a.weeklyGp);
}
