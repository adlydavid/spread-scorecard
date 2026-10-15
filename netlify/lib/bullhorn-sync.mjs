// Pulls Bullhorn activity for the previous and current payroll month and saves the rebuilt months in Netlify Blobs,
// where the site loads them on top of public/data (same store as the weekly spread uploads). Spread is kept as is.
import { login, pull, configured, placementsById, candidateNotes, pool } from "./bullhorn.mjs";
import { build, plan, etDate, contactSummary, primeGroups } from "../../shared/bullhorn-build.js";

const STALE_MS = 10 * 60e3; // a "running" status older than this is a sync that died

async function staticJSON(origin, path){
  if (!origin) return null;
  try { const r = await fetch(new URL(path, origin)); return r.ok ? await r.json() : null; } catch { return null; }
}

// The months as the site shows them now: shipped files, overlaid with uploads and earlier syncs.
export async function currentDocs(store, origin){
  const docs = {};
  const idx = await staticJSON(origin, "/data/index.json");
  const shipped = await Promise.all(((idx && idx.months) || []).map(k => staticJSON(origin, "/data/months/" + k + ".json")));
  for (const d of shipped) if (d && d.key) docs[d.key] = d;
  const { blobs } = await store.list({ prefix: "months/" });
  for (const d of await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })))) if (d && d.key) docs[d.key] = d;
  const meta = (await store.get("meta", { type: "json" })) || (await staticJSON(origin, "/data/meta.json")) || {};
  return { docs, meta };
}

export async function syncStatus(store){ return (await store.get("bullhornSync", { type: "json" })) || null; }

// origin: the site's URL, to read the shipped data files. by: who started it ("schedule" or the admin's name).
export async function runSync(store, origin, by){
  if (!configured()) throw new Error("Bullhorn isn't set up. Add BULLHORN_CLIENT_ID, BULLHORN_CLIENT_SECRET, BULLHORN_USERNAME and BULLHORN_PASSWORD in Netlify's environment variables.");
  const prev = await syncStatus(store);
  if (prev && prev.running && Date.now() - Date.parse(prev.startedAt) < STALE_MS) return { skipped: "A sync is already running." };
  const startedAt = new Date().toISOString();
  await store.setJSON("bullhornSync", Object.assign({}, prev, { running: true, startedAt, by }));
  try {
    const today = etDate(Date.now());
    const { docs, meta } = await currentDocs(store, origin);
    if (!Object.keys(docs).length) throw new Error("Couldn't read the scorecard's current months.");
    const session = await login();
    const raw = await pull(session, plan(today, docs));
    const res = build(raw, docs, today);
    for (const d of Object.values(res.docs)) await store.setJSON("months/" + d.key, d);
    await store.setJSON("meta", Object.assign({}, meta, { bullhornAsOf: today, interviewsWithoutSubmission: res.interviewsWithoutSubmission }));
    const months = Object.values(res.docs).map(d => {
      const tot = (rows, f) => rows.reduce((a, r) => a + (r[f] || 0), 0);
      return { key: d.key, label: d.label, submittals: tot(d.recruiting, "submittals"), interviews: tot(d.sales, "interviews"),
        placements: tot(d.sales, "deals"), starts: tot(d.sales, "starts"), jobOrders: tot(d.sales, "jobOrders") };
    });
    const warnings = res.warnings.slice();
    let roster = null;
    try { roster = await syncRoster(store, session, today, raw.pl); }
    catch (err){ warnings.push("Recontacting and Primes didn't update: " + String(err.message || err).slice(0, 200)); }
    const status = { running: false, ok: true, startedAt, at: new Date().toISOString(), by, today, months, warnings, roster,
      records: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.length])) };
    await store.setJSON("bullhornSync", status);
    return status;
  } catch (err){
    const status = Object.assign({}, prev, { running: false, ok: false, startedAt, failedAt: new Date().toISOString(), by, error: String(err.message || err).slice(0, 300) });
    await store.setJSON("bullhornSync", status);
    throw err;
  }
}

// From the latest spread report's consultants: the federal clients (Primes) and each consultant's last contact
// (Recontacting). Placement IDs on the report tie each row to its Bullhorn candidate and client company.
async function syncRoster(store, session, today, recentPlacements){
  const report = await store.get("report", { type: "json" });
  if (!report || !report.detail || !report.detail.length) return null;
  const ids = [...new Set(report.detail.map(d => d.placementId).filter(Boolean))];
  const placements = await placementsById(session, ids);
  const byId = Object.fromEntries(placements.map(p => [p.id, p]));
  await store.setJSON("primes", { weekEnding: report.weekEnding, at: new Date().toISOString(), groups: primeGroups(report.detail, placements, report.clients) });

  const cands = [...new Set(placements.map(p => p.candidate && p.candidate.id).filter(Boolean))];
  const notes = {};
  await pool(cands, 8, async c => { notes[c] = await candidateNotes(session, c); });
  const rows = report.detail.map(d => {
    const p = byId[d.placementId], cid = p && p.candidate && p.candidate.id;
    const c = cid ? contactSummary(notes[cid] || []) : { attempt: null, substance: null };
    return { placementId: d.placementId, candidateId: cid || null, name: (d.first + " " + d.last).trim(), client: d.client, lob: d.lob,
      ae: d.ae, recruiter: d.recruiter, start: d.start, type: d.type, inBullhorn: !!cid, attempt: c.attempt, substance: c.substance };
  });
  await store.setJSON("recontact", { asOf: today, at: new Date().toISOString(), weekEnding: report.weekEnding, rows });
  await store.setJSON("forecast", Object.assign({ asOf: today, at: new Date().toISOString() }, forecastInputs(report, byId, recentPlacements || [], today)));
  return { consultants: rows.length, matched: rows.filter(r => r.inBullhorn).length };
}

// Inputs for the Spread tab's forecast (the projection itself is worked out in the page, so its assumptions show there).
// Ends: consultants on the report whose Bullhorn placement ends after the report's week, within 26 weeks; each
// takes that week's revenue and GP off. Starts: placements beginning after the report's week that aren't on it yet,
// at their Bullhorn bill and pay rates for 40 hours, with the report's typical burden.
const HORIZON_DAYS = 182;
const isoMs = ms => ms ? etDate(ms) : null;
function forecastInputs(report, byId, recent, today){
  const we = report.weekEnding, until = new Date(Date.parse(we) + HORIZON_DAYS * 864e5).toISOString().slice(0, 10);
  const onReport = new Set(report.detail.map(d => d.placementId).filter(Boolean));
  const ends = [];
  for (const d of report.detail){
    const p = byId[d.placementId], end = p && isoMs(p.dateEnd);
    if (end && end > we && end <= until)
      ends.push({ placementId: d.placementId, name: (d.first + " " + d.last).trim(), client: d.client, lob: d.lob, ae: d.ae, recruiter: d.recruiter,
        end, status: p.status || null, weeklyRevenue: d.revenue, weeklyGp: d.gp });
  }
  // the report's burden by kind: third party (a small fee) or W2 (taxes and benefits); medians, so one odd row doesn't skew it
  const median = a => { const x = a.filter(v => v != null).sort((p, q) => p - q); return x.length ? x[Math.floor(x.length / 2)] : null; };
  const third = d => /third|3rd|c2c|1099|corp/i.test((d.type || "") + " " + (d.thirdParty ? "third" : ""));
  const burden = { w2: median(report.detail.filter(d => !third(d)).map(d => d.burden)) ?? 0.18, third: median(report.detail.filter(third).map(d => d.burden)) ?? 0.04 };
  const starts = [], perm = [];
  for (const p of recent){
    const begin = isoMs(p.dateBegin);
    if (!begin || begin <= we || begin > until || onReport.has(p.id) || p.status === "Never Started") continue;
    const jo = p.jobOrder || {}, cand = p.candidate || {}, type = p.employmentType || "";
    const row = { placementId: p.id, name: ((cand.firstName || "").trim() + " " + (cand.lastName || "").trim()).trim(), client: ((jo.clientCorporation || {}).name || "").trim(),
      title: (jo.title || "").trim(), begin, end: isoMs(p.dateEnd), status: p.status || null, employmentType: type, bill: p.clientBillRate ?? null, pay: p.payRate ?? null };
    if (/perm|direct/i.test(type)){ perm.push(row); continue; } // a one-time fee, not weekly spread
    const b = /third|1099|c2c|corp/i.test(type) ? burden.third : burden.w2;
    if (row.bill != null && row.pay != null){ row.burden = b; row.weeklyRevenue = Math.round(row.bill * 40 * 100) / 100; row.weeklyGp = Math.round((row.bill - row.pay * (1 + b)) * 40 * 100) / 100; }
    starts.push(row);
  }
  starts.sort((a, b) => a.begin < b.begin ? -1 : 1); ends.sort((a, b) => a.end < b.end ? -1 : 1);
  return { weekEnding: we, until, base: { revenue: report.weekly ? report.weekly.revenue : null, gp: report.weekly ? report.weekly.gp : null, hc: report.detail.reduce((a, d) => a + (d.hc || 0), 0) },
    burden, hoursPerWeek: 40, ends, starts, perm };
}
