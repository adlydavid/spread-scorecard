// Rebuilds past months' Bullhorn activity (including the per-client counts the Primes tab needs) into the site's
// Netlify Blobs store. The regular sync only does the previous and current month. Spread is kept as is.
//
//   NETLIFY_SITE_ID=... NETLIFY_AUTH_TOKEN=... SITE_URL=https://<site>.netlify.app \
//   node --env-file=.env tools/backfill.mjs 2026-01 2026-08
//
// Months are pulled two at a time, so each Bullhorn pull stays small.
import { getStore } from "@netlify/blobs";
import { login, pull } from "../netlify/lib/bullhorn.mjs";
import { currentDocs } from "../netlify/lib/bullhorn-sync.mjs";
import { build, plan, etDate } from "../shared/bullhorn-build.js";

const [from, to] = process.argv.slice(2);
const { NETLIFY_SITE_ID: siteID, NETLIFY_AUTH_TOKEN: token, SITE_URL: origin } = process.env;
if (!/^\d{4}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}$/.test(to || "") || !siteID || !token || !origin){
  console.error("Usage: NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… SITE_URL=… node --env-file=.env tools/backfill.mjs YYYY-MM YYYY-MM"); process.exit(1);
}
const store = getStore({ name: "scorecard", siteID, token, consistency: "strong" });
const { docs } = await currentDocs(store, origin);
const keys = Object.keys(docs).filter(k => k >= from && k <= to).sort();
const today = etDate(Date.now()), session = await login();
for (let i = 0; i < keys.length; i += 2){
  const chunk = keys.slice(i, i + 2);
  const raw = await pull(session, plan(today, docs, chunk));
  const res = build(raw, docs, today, chunk);
  for (const d of Object.values(res.docs)){
    await store.setJSON("months/" + d.key, d);
    const t = (rows, f) => rows.reduce((a, r) => a + (r[f] || 0), 0);
    console.log(d.key, "spread", d.gp, "submittals", t(d.recruiting, "submittals"), "interviews", t(d.sales, "interviews"), "deals", t(d.sales, "deals"), "clients", Object.keys(d.clients).length);
  }
  if (res.warnings.length) console.log("  ", res.warnings.join("; "));
}
