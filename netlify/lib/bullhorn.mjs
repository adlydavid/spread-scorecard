// Bullhorn REST client for the sync. Credentials come from environment variables
// (BULLHORN_CLIENT_ID, BULLHORN_CLIENT_SECRET, BULLHORN_USERNAME, BULLHORN_PASSWORD), never the site's JavaScript.
import { VISIT_ACTIONS, INTERVIEW_ACTIONS, addDays } from "../../shared/bullhorn-build.js";

const PAGE = 500;

export function configured(){
  const e = process.env;
  return !!(e.BULLHORN_CLIENT_ID && e.BULLHORN_CLIENT_SECRET && e.BULLHORN_USERNAME && e.BULLHORN_PASSWORD);
}

async function getJSON(url, init){
  const r = await fetch(url, init);
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = null; }
  if (!r.ok || !data) throw new Error(`Bullhorn ${r.status}: ${(data && (data.errorMessage || data.error_description || data.error)) || text.slice(0, 200)}`);
  return data;
}

// OAuth: authorize with the API user's password -> code -> access token -> REST session (BhRestToken + restUrl).
export async function login(){
  const e = process.env;
  const info = await getJSON(`https://rest.bullhornstaffing.com/rest-services/loginInfo?username=${encodeURIComponent(e.BULLHORN_USERNAME)}`);
  const q = new URLSearchParams({ client_id: e.BULLHORN_CLIENT_ID, response_type: "code", action: "Login", username: e.BULLHORN_USERNAME, password: e.BULLHORN_PASSWORD });
  const a = await fetch(`${info.oauthUrl}/authorize?${q}`, { redirect: "manual" });
  const code = new URL(a.headers.get("location") || "", "https://x").searchParams.get("code");
  if (!code) throw new Error("Bullhorn sign-in failed: check BULLHORN_USERNAME and BULLHORN_PASSWORD.");
  const tok = await getJSON(`${info.oauthUrl}/token?` + new URLSearchParams({ grant_type: "authorization_code", code, client_id: e.BULLHORN_CLIENT_ID, client_secret: e.BULLHORN_CLIENT_SECRET }), { method: "POST" });
  const s = await getJSON(`${info.restUrl}/login?version=2.0&access_token=${encodeURIComponent(tok.access_token)}`);
  return { restUrl: s.restUrl, token: s.BhRestToken };
}

// Pages through /search (Lucene, has a total) or /query (where clause, no total) until every record is in.
// Bullhorn can return fewer than asked (to-many fields cap a page at 200), so the next page starts after
// what actually came back, and only a total (or an empty or short page without one) ends it.
async function all(s, kind, entity, params){
  const out = new Map();
  for (let start = 0; ; ){
    const q = new URLSearchParams(Object.assign({}, params, { count: PAGE, start, BhRestToken: s.token }));
    const d = await getJSON(`${s.restUrl}${kind}/${entity}?${q}`);
    const got = d.data || [];
    for (const r of got) out.set(r.id, r);
    start += got.length;
    if (!got.length || (d.total != null ? start >= d.total : got.length < 200)) break; // no total: a page under 200 is the last
  }
  return [...out.values()];
}
const search = (s, entity, query, fields) => all(s, "search", entity, { query, fields, sort: "dateAdded" });
const query = (s, entity, where, fields) => all(s, "query", entity, { where, fields, orderBy: "id" });

const USER = "id,firstName,lastName";
const JOB = `id,title,owner(${USER}),clientCorporation(id,name)`;
const NOTE = `id,action,dateAdded,commentingPerson(${USER}),personReference(${USER})`;
const lucene = (a, b) => `dateAdded:[${a.replace(/-/g, "")} TO ${b.replace(/-/g, "")}}`;
const ms = day => Date.parse(day + "T00:00:00Z");

// Everything the builder needs for the months in `plan` (from shared/bullhorn-build.js), fetched in parallel.
// Windows are a day wider than the months; the builder files records by their Eastern date.
export async function pull(s, plan){
  const a = addDays(plan.start, -1), b = addDays(plan.end, 2), lookback = addDays(plan.start, -180);
  // Calls aren't pulled: most Nooks dials never reach Bullhorn, so a Bullhorn call count would be misleading.
  const calls = [];
  const [js, jo, pl, mt, iv] = await Promise.all([
    // submissions go back further so interviews can be matched to the submission that led to them
    query(s, "JobSubmission", `dateAdded>=${ms(lookback)}`, `id,dateAdded,status,sendingUser(${USER}),jobOrder(${JOB}),candidate(${USER})`),
    query(s, "JobOrder", `isDeleted=false AND dateAdded>=${ms(a)}`, `id,dateAdded,status,employmentType,numOpenings,title,owner(${USER}),clientCorporation(id,name),isOpen`),
    query(s, "Placement", `dateAdded>=${ms(a)} OR dateBegin>=${ms(a)}`,
      `id,dateAdded,dateBegin,dateEnd,status,employmentType,payRate,clientBillRate,jobOrder(${JOB}),jobSubmission(id,sendingUser(${USER})),candidate(id,firstName,lastName,owner(${USER})),owner(${USER})`),
    // visits carry the contact's company, for the per-client counts (Primes)
    search(s, "Note", `${VISIT_ACTIONS} AND isDeleted:false AND ${lucene(a, b)}`, NOTE + ",clientContacts(id,clientCorporation(id,name))"),
    search(s, "Note", `${INTERVIEW_ACTIONS} AND isDeleted:false AND ${lucene(a, b)}`, NOTE)
  ]);
  return { js, jo, pl, mt, iv, calls };
}

// Placements by id (the Placement IDs on the spread report's Detail sheet), with candidate and client.
export async function placementsById(s, ids){
  const out = [];
  for (let i = 0; i < ids.length; i += 100){
    const q = new URLSearchParams({ fields: "id,status,dateBegin,dateEnd,employmentType,payRate,clientBillRate,candidate(id,firstName,lastName),jobOrder(id,title,clientCorporation(id,name))", BhRestToken: s.token });
    const d = await getJSON(`${s.restUrl}entity/Placement/${ids.slice(i, i + 100).join(",")}?${q}`).catch(err => {
      if (/40[04]/.test(err.message)) return { data: [] }; // a batch with a deleted placement; fall back to one at a time below
      throw err;
    });
    const got = Array.isArray(d.data) ? d.data : d.data ? [d.data] : [];
    if (!got.length && ids.length > 1)
      for (const id of ids.slice(i, i + 100)){ const one = await getJSON(`${s.restUrl}entity/Placement/${id}?${q}`).catch(() => null); if (one && one.data) got.push(one.data); }
    out.push(...got);
  }
  return out;
}

// A candidate's latest notes, newest first.
export async function candidateNotes(s, candidateId, count = 50){
  const q = new URLSearchParams({ fields: `id,action,dateAdded,comments,commentingPerson(${USER})`, count, orderBy: "-dateAdded", BhRestToken: s.token });
  const d = await getJSON(`${s.restUrl}entity/Candidate/${candidateId}/notes?${q}`);
  return d.data || [];
}

// Runs fn over items, a few at a time.
export async function pool(items, size, fn){
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (next < items.length){ const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}
