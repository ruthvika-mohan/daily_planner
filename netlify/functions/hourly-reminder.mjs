import "dotenv/config";
import { schedule } from "@netlify/functions";
import { runScheduledJobs } from "../../server/app.js";

export const handler = schedule("0 * * * *", async () => {
  console.log("[netlify hourly-reminder] invoked");
  const result = await runScheduledJobs(new Date(), { requireTopOfHour: false });
  console.log("[netlify hourly-reminder] result", JSON.stringify(result));
  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
});
