import "dotenv/config";
import { createApp, runScheduledJobs } from "./app.js";

const port = Number(process.env.PORT || 4000);
const app = createApp({ serveStatic: process.env.NODE_ENV === "production" });

app.listen(port, () => {
  console.log(`Planner API listening on http://127.0.0.1:${port}`);
});

setInterval(async () => {
  try {
    await runScheduledJobs();
  } catch (error) {
    console.error("Scheduler error", error);
  }
}, 60_000);
