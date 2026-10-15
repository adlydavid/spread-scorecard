// Scheduled Bullhorn sync: weekdays at about 7am and 6pm Eastern (cron is UTC).
import { getStore } from "@netlify/blobs";
import { runSync } from "../lib/bullhorn-sync.mjs";

export default async () => {
  const store = getStore({ name: "scorecard", consistency: "strong" });
  const res = await runSync(store, process.env.URL, "schedule");
  console.log("Bullhorn sync:", JSON.stringify(res.skipped || res.months));
};

export const config = { schedule: "0 11,22 * * 1-5" };
