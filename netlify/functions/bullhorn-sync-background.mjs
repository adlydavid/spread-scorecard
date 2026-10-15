// POST /.netlify/functions/bullhorn-sync-background (signed in): runs a Bullhorn sync now.
// A background function, so the pull (about 10-15 seconds) isn't cut off; it answers 202 at once and
// the admin panel polls GET /api/bullhorn for the result.
import { getStore } from "@netlify/blobs";
import { verify } from "../lib/auth.mjs";
import { runSync } from "../lib/bullhorn-sync.mjs";

export default async (req) => {
  const user = verify(req);
  if (!user || req.method !== "POST") return;
  const store = getStore({ name: "scorecard", consistency: "strong" });
  try { await runSync(store, process.env.URL || new URL(req.url).origin, user); }
  catch (err) { console.error("Bullhorn sync failed:", err); }
};
