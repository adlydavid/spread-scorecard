// Weekly Spread Dashboard import, shared by the admin page (preview) and the Netlify functions (save).
// Mirrors parse_mtd() and the spread part of build() in tools/refresh.py.

export const MONTHNAME = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const SKIP = new Set(["Perm", "Grand Total", ""]);

// ---- payroll months ----
// Shelley's payroll months are Sunday–Saturday weeks in a 5-4-4 pattern per quarter (April runs to May 2),
// so a month comes from the scorecard's own calendar, or for a new month from the sheet's "Week X of Y".
const DAY = 864e5;
function utc(iso){ const p = iso.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
function iso(ms){ return new Date(ms).toISOString().slice(0, 10); }
function pad(n){ return String(n).padStart(2, "0"); }

// known: [{key, start, end}] for months the scorecard already has. Returns {key, start, end, weeks, isNew} or {error}.
export function payrollMonth(p, known){
  const we = p.weekEnding;
  const hit = known.find(m => m.start <= we && we <= m.end);
  if (hit) return { key: hit.key, start: hit.start, end: hit.end, weeks: Math.round((utc(hit.end) - utc(hit.start) + DAY) / (7 * DAY)), isNew: false };
  let y = +we.slice(0, 4), mi = +we.slice(5, 7) - 1;
  if (p.month){
    const sm = MONTHNAME.indexOf(p.month);
    if (sm === 11 && mi === 0) y--; else if (sm === 0 && mi === 11) y++;
    mi = sm;
  }
  const key = y + "-" + pad(mi + 1);
  const same = known.find(m => m.key === key);
  if (same) return { error: "Week ending " + we + " is outside " + key + " (" + same.start + " to " + same.end + ")." };
  const prev = known.filter(m => m.end < we).sort((a, b) => a.end < b.end ? 1 : -1)[0];
  let start, weeks;
  if (p.weekOf){ weeks = p.weekOf[1]; start = iso(utc(we) - (p.weekOf[0] * 7 - 1) * DAY); }
  else if (prev){ weeks = [5, 4, 4][mi % 3]; start = iso(utc(prev.end) + DAY); }
  else return { error: "Can't tell which payroll weeks " + key + " covers: the sheet has no \"Week X of Y\"." };
  if (weeks < 4 || weeks > 6) return { error: "Unexpected month length: " + weeks + " weeks." };
  return { key, start, end: iso(utc(start) + (weeks * 7 - 1) * DAY), weeks, isNew: true,
    gap: prev && iso(utc(prev.end) + DAY) !== start ? "The new month starts " + start + ", but " + prev.key + " ends " + prev.end + "." : null };
}
export function monthSkeleton(pm){
  const [y, m] = pm.key.split("-").map(Number);
  return { key: pm.key, label: MONTHNAME[m - 1] + " " + y, short: MONTHNAME[m - 1].slice(0, 3), start: pm.start, end: pm.end,
    weeks: pm.weeks, spread: false, gp: null, revenue: null, sales: [], recruiting: [], deals: [] };
}

// ---- reading the sheet ----
// Picks the "Dashboard - Month To Date" sheet, or the first sheet with a "Week Ending" row.
export function pickSheet(names, rowsOf){
  const named = names.find(n => /dashboard\s*-\s*month\s*to\s*date/i.test(n));
  if (named) return named;
  return names.find(n => rowsOf(n).some(r => r.some(c => String(c).trim() === "Week Ending"))) || null;
}

function num(v){
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(n) ? n : NaN;
}
function dateCell(v){
  if (v instanceof Date) return iso(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  if (typeof v === "number") return iso(Date.UTC(1899, 11, 30) + Math.round(v) * DAY); // Excel serial date
  const s = String(v).trim(), us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) return iso(Date.UTC(us[3].length === 2 ? 2000 + +us[3] : +us[3], us[1] - 1, +us[2]));
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

// rows: the sheet as an array of row arrays (cell values). Labels can sit in any column; values are read
// relative to the label, matching the layout refresh.py reads (label, then week ending/month/amounts to its right).
export function parseDashboard(rows){
  const res = { ae: {}, rm: {}, warnings: [] };
  let mode = null, text = "";
  for (const row of rows){
    const c = row.map(x => x == null ? "" : (typeof x === "string" ? x.trim() : x));
    text += c.join("\t") + "\n";
    const at = label => c.findIndex(x => x === label);
    let i;
    if (!res.weekEnding && (i = at("Week Ending")) >= 0 && c.length > i + 4){
      const we = dateCell(c[i + 1]), rev = num(c[i + 2]), gp = num(c[i + 4]);
      if (we && Number.isFinite(rev) && Number.isFinite(gp)){ res.weekEnding = we; res.revenue = rev; res.gp = gp; }
    }
    if (!res.month && (i = at("Month")) >= 0 && MONTHNAME.includes(String(c[i + 1]))) res.month = c[i + 1];
    if ((i = at("Recruiter")) >= 0 && /Gross Profit/i.test(String(c[i + 2]))){ mode = { key: "rm", col: i }; continue; }
    if ((i = at("AE")) >= 0 && /Gross Profit/i.test(String(c[i + 2]))){ mode = { key: "ae", col: i }; continue; }
    if (mode){
      const name = String(c[mode.col] ?? "").trim(), v = num(c[mode.col + 2]);
      if (!name){ continue; }
      if (name === "Grand Total"){ res[mode.key + "Total"] = v; mode = null; continue; }
      if (!Number.isFinite(v)){ mode = null; continue; }
      res[mode.key][name] = (res[mode.key][name] || 0) + v;
    }
  }
  const wk = text.match(/Week (\d+) of (\d+)/);
  if (wk) res.weekOf = [+wk[1], +wk[2]];
  if (!res.weekEnding) res.warnings.push("Couldn't find the Week Ending row with revenue and gross profit.");
  if (!Object.keys(res.ae).length) res.warnings.push("Couldn't find the AE gross profit table.");
  if (!Object.keys(res.rm).length) res.warnings.push("Couldn't find the Recruiter gross profit table.");
  return res;
}

// ---- applying spread to a month ----
// Sheet names are usually last names (as refresh.py assumes); full names and last words also match.
export function nameResolver(knownFull){
  const byName = new Map(), byLower = new Map(), byLast = new Map();
  for (const [name, full] of Object.entries(knownFull)){
    byName.set(name, name); byLower.set(name.toLowerCase(), name); byLower.set(String(full).toLowerCase(), name);
    const last = String(full).trim().split(/\s+/).pop().toLowerCase();
    byLast.set(last, byLast.has(last) && byLast.get(last) !== name ? null : name);
  }
  return raw => {
    const n = String(raw).trim(), l = n.toLowerCase();
    const hit = byName.get(n) || byLower.get(l) || byLast.get(l.split(/\s+/).pop()) || null;
    return hit ? { name: hit, matched: true } : { name: n, matched: false };
  };
}

function round2(v){ return Math.round(v * 100) / 100; }

// Returns a new month doc with this report's spread: every person gets their sheet amount (0 if absent),
// and people on the sheet without a row yet get one with zero activity.
export function applySpread(doc, p, knownFull){
  const out = JSON.parse(JSON.stringify(doc));
  const resolve = nameResolver(knownFull);
  const sides = [["sales", p.ae, { calls: 0, visits: 0, jobOrders: 0, sendOuts: 0, interviews: 0, deals: 0, starts: 0 }],
                 ["recruiting", p.rm, { ae: false, calls: 0, submittals: 0, interviews: 0, placements: 0 }]];
  for (const [side, sheet, blank] of sides){
    const amounts = new Map();
    for (const [raw, v] of Object.entries(sheet)){
      if (SKIP.has(String(raw).trim())) continue;
      const r = resolve(raw); amounts.set(r.name, (amounts.get(r.name) || 0) + v);
    }
    const rows = out[side] || (out[side] = []);
    for (const row of rows) if (row.name !== "_other") row.spread = round2(amounts.get(row.name) || 0);
    for (const [name, v] of amounts){
      if (rows.some(r => r.name === name)) continue;
      const other = rows.findIndex(r => r.name === "_other");
      const row = Object.assign({ name, full: knownFull[name] || name, former: false, spread: round2(v) }, blank);
      if (other >= 0) rows.splice(other, 0, row); else rows.push(row);
    }
  }
  out.spread = true; out.gp = round2(p.gp); out.revenue = round2(p.revenue);
  if (p.weekOf) out.spreadWeeks = p.weekOf; else delete out.spreadWeeks;
  return out;
}

// Server-side check of what the browser sent; returns an error message or null.
export function validateParsed(p){
  if (!p || typeof p !== "object") return "Missing report data.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.weekEnding || "") || isNaN(utc(p.weekEnding))) return "Week ending date is missing or invalid.";
  for (const f of ["gp", "revenue"]) if (!Number.isFinite(p[f])) return "Revenue or gross profit is missing.";
  for (const f of ["ae", "rm"]){
    const t = p[f];
    if (!t || typeof t !== "object" || Array.isArray(t)) return "The " + f.toUpperCase() + " table is missing.";
    const e = Object.entries(t);
    if (e.length > 300) return "Too many names in the " + f.toUpperCase() + " table.";
    for (const [k, v] of e) if (k.length > 80 || !Number.isFinite(v)) return "Bad entry in the " + f.toUpperCase() + " table: " + k.slice(0, 40);
  }
  if (p.weekOf && !(Array.isArray(p.weekOf) && p.weekOf.length === 2 && p.weekOf.every(Number.isInteger))) return "Bad week-of value.";
  return null;
}
