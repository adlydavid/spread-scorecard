// GET /api/data: the months and meta saved by admin uploads, and the monthly targets. The site loads these on top of the
// JSON files that ship in public/data, so an upload shows up for everyone without a redeploy.
import { getStore } from "@netlify/blobs";
import { json } from "../lib/auth.mjs";

export default async () => {
  const store = getStore({ name: "scorecard", consistency: "strong" });
  const { blobs } = await store.list({ prefix: "months/" });
  const months = (await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })))).filter(Boolean);
  const [meta, targets] = await Promise.all([store.get("meta", { type: "json" }), store.get("targets", { type: "json" })]);
  return json(200, { meta, months, targets });
};

export const config = { path: "/api/data" };
