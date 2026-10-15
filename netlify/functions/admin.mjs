// Admin API for the weekly spread upload.
//   POST /api/login   {user, password}            -> {token, user, exp}
//   GET  /api/log                                  -> recent uploads (signed in)
//   POST /api/upload  {parsed, month, names, file} -> saves the month's spread (signed in)
//   POST /api/revert  {id}                         -> puts a month back the way it was before that upload (signed in)
//   POST /api/targets {from, team, scale5, people} -> saves monthly spread targets that apply from that month on (signed in)
import { getStore } from "@netlify/blobs";
import { login, verify, json } from "../lib/auth.mjs";
import { applySpread, monthSkeleton, validateParsed } from "../../shared/spread-import.js";

const LOG_SIZE = 20;

function nowET(){
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
async function staticJSON(req, path){
  try { const r = await fetch(new URL(path, req.url)); return r.ok ? await r.json() : null; } catch { return null; }
}
// The month as the site shows it now: the last upload if there is one, else the file that ships with the site.
async function currentMonth(store, req, key){
  const saved = await store.get("months/" + key, { type: "json" });
  if (saved) return { doc: saved, source: "upload" };
  const shipped = await staticJSON(req, "/data/months/" + key + ".json");
  return shipped ? { doc: shipped, source: "static" } : { doc: null, source: "none" };
}
async function currentMeta(store, req){
  return (await store.get("meta", { type: "json" })) || (await staticJSON(req, "/data/meta.json")) || {};
}

async function upload(req, store, user){
  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Expected JSON." });
  const { parsed, month, names, file } = body;
  const bad = validateParsed(parsed);
  if (bad) return json(400, { error: bad });
  if (!month || !/^\d{4}-\d{2}$/.test(month.key || "") || !/^\d{4}-\d{2}-\d{2}$/.test(month.start || "") || !/^\d{4}-\d{2}-\d{2}$/.test(month.end || ""))
    return json(400, { error: "Missing payroll month." });

  const cur = await currentMonth(store, req, month.key);
  let doc = cur.doc;
  if (doc){
    if (parsed.weekEnding < doc.start || parsed.weekEnding > doc.end)
      return json(400, { error: `Week ending ${parsed.weekEnding} is outside ${doc.label} (${doc.start} to ${doc.end}).` });
  } else {
    const weeks = Math.round((Date.parse(month.end) - Date.parse(month.start) + 864e5) / (7 * 864e5));
    if (!(parsed.weekEnding >= month.start && parsed.weekEnding <= month.end) || weeks < 4 || weeks > 6)
      return json(400, { error: "The new month's dates don't line up with the week ending." });
    doc = monthSkeleton({ key: month.key, start: month.start, end: month.end, weeks });
  }

  const known = {};
  for (const r of [...(doc.sales || []), ...(doc.recruiting || [])]) known[r.name] = r.full;
  if (names && typeof names === "object")
    for (const [k, v] of Object.entries(names)) if (typeof v === "string" && k.length <= 80 && v.length <= 80 && !known[k]) known[k] = v;
  const next = applySpread(doc, parsed, known);

  const meta = await currentMeta(store, req);
  const we = parsed.weekEnding.split("-");
  const nextMeta = Object.assign({}, meta, {
    generated: nowET(), spreadWeekEnding: parsed.weekEnding,
    spreadReport: `Weekly Spread Dashboard - ${we[1]}.${we[2]}.${we[0].slice(2)}`,
    lastUpload: { at: new Date().toISOString(), by: user, file: String(file || "").slice(0, 120) }
  });

  const log = (await store.get("log", { type: "json" })) || [];
  const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), by: user, file: String(file || "").slice(0, 120),
    key: next.key, label: next.label, weekEnding: parsed.weekEnding, weekOf: parsed.weekOf || null, gp: next.gp, revenue: next.revenue,
    prev: { source: cur.source, doc: cur.source === "upload" ? cur.doc : null, gp: cur.doc ? cur.doc.gp : null, meta } };
  await store.setJSON("months/" + next.key, next);
  await store.setJSON("meta", nextMeta);
  await store.setJSON("log", [entry, ...log].slice(0, LOG_SIZE));
  return json(200, { ok: true, key: next.key, label: next.label, gp: next.gp });
}

async function revert(req, store, user){
  const { id } = (await req.json().catch(() => ({}))) || {};
  const log = (await store.get("log", { type: "json" })) || [];
  const entry = log.find(e => e.id === id);
  if (!entry) return json(404, { error: "That upload isn't in the history." });
  if (entry.reverted) return json(409, { error: "Already undone." });
  if (log.find(e => e.key === entry.key && !e.reverted) !== entry)
    return json(409, { error: `A later upload for ${entry.label} exists. Undo that one first.` });
  if (entry.prev.source === "upload") await store.setJSON("months/" + entry.key, entry.prev.doc);
  else await store.delete("months/" + entry.key); // back to the file that ships with the site, or no month at all
  await store.setJSON("meta", entry.prev.meta || {});
  entry.reverted = { at: new Date().toISOString(), by: user };
  await store.setJSON("log", log);
  return json(200, { ok: true });
}

// Targets are kept as versions, each applying from a payroll month until the next version.
// team and people amounts are per 4-week month; with scale5 a 5-week month's target is ×1.25.
async function saveTargets(req, store, user){
  const b = (await req.json().catch(() => null)) || {};
  if (!/^\d{4}-\d{2}$/.test(b.from || "")) return json(400, { error: "Choose the month the targets start from." });
  const amount = v => v === null || v === undefined || v === "" ? null : (Number.isFinite(v) && v >= 0 && v < 1e9 ? Math.round(v) : NaN);
  const team = amount(b.team);
  if (Number.isNaN(team)) return json(400, { error: "The team target must be a positive amount." });
  const people = { sales: {}, recruiting: {} };
  for (const side of ["sales", "recruiting"]){
    const t = (b.people && b.people[side]) || {};
    if (typeof t !== "object" || Array.isArray(t) || Object.keys(t).length > 200) return json(400, { error: "Bad per-person targets." });
    for (const [name, v] of Object.entries(t)){
      const a = amount(v);
      if (name.length > 80 || Number.isNaN(a)) return json(400, { error: "Bad target for " + name.slice(0, 40) + "." });
      if (a != null) people[side][name] = a;
    }
  }
  const doc = (await store.get("targets", { type: "json" })) || { versions: [] };
  const version = { from: b.from, team, scale5: b.scale5 !== false, people, at: new Date().toISOString(), by: user };
  doc.versions = doc.versions.filter(v => v.from !== b.from).concat(version).sort((x, y) => x.from < y.from ? -1 : 1);
  await store.setJSON("targets", doc);
  return json(200, { ok: true, targets: doc });
}

export default async (req) => {
  const path = new URL(req.url).pathname;
  const store = getStore({ name: "scorecard", consistency: "strong" });

  if (path === "/api/login" && req.method === "POST"){
    const { user, password } = (await req.json().catch(() => ({}))) || {};
    const r = login(user || "", password || "");
    if (r.error){ await new Promise(res => setTimeout(res, 600)); return json(r.status, { error: r.error }); } // slows down guessing
    return json(200, r);
  }

  const user = verify(req);
  if (!user) return json(401, { error: "Please sign in again." });
  if (path === "/api/log" && req.method === "GET"){
    const log = (await store.get("log", { type: "json" })) || [];
    return json(200, { log: log.map(({ prev, ...e }) => Object.assign(e, { prevGp: prev ? prev.gp : null, prevSource: prev ? prev.source : null })) });
  }
  if (path === "/api/upload" && req.method === "POST") return upload(req, store, user);
  if (path === "/api/revert" && req.method === "POST") return revert(req, store, user);
  if (path === "/api/targets" && req.method === "POST") return saveTargets(req, store, user);
  return json(404, { error: "Not found." });
};

export const config = { path: ["/api/login", "/api/log", "/api/upload", "/api/revert", "/api/targets"] };
