import express from "express";
import path from "node:path";
import { PlannerRepository } from "./repository.js";
import { PostgresPlannerRepository } from "./postgresRepository.js";
import { generateDailyReview } from "./llm.js";
import { sendMail } from "./mailer.js";

export const repo = process.env.DATABASE_URL ? new PostgresPlannerRepository() : new PlannerRepository();

const fallbackHostedUrl = "https://storied-crostata-07e788.netlify.app";
const summaryHour = Number(process.env.DAILY_SUMMARY_HOUR || 21);

export function createApp({ serveStatic = false } = {}) {
  const app = express();

  app.use(express.json());
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && /^http:\/\/(127\.0\.0\.1|localhost):5173$/.test(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.post("/api/login", async (req, res, next) => {
    try {
      const body = parseRequestBody(req.body);
      const email = normalizeEmail(body.email);
      if (!email || isPlaceholderEmail(email)) {
        return res.status(400).json({ error: "Enter a real email address." });
      }
      res.json(await repo.login(email));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/profile", async (req, res, next) => {
    try {
      res.json({ profile: await repo.getProfile(getUserEmail(req)) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/profile", async (req, res, next) => {
    try {
      const profile = validateProfile(parseRequestBody(req.body), getUserEmail(req));
      res.status(201).json({ profile: await repo.saveProfile(profile, getUserEmail(req)) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/entries", async (req, res, next) => {
    try {
      res.json({ entries: await repo.getEntries({ date: req.query.date, userEmail: getUserEmail(req) }) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/entries", async (req, res, next) => {
    try {
      const body = parseRequestBody(req.body);
      const entryBody = normalizeEntryBody(body);
      const userEmail = getUserEmail(req);
      const profile = await repo.getProfile(userEmail);
      const timezone = profile?.timezone || "Asia/Kolkata";
      const now = new Date();
      const date = entryBody.date || formatDate(now, timezone);
      const time = entryBody.time || formatTime(now, timezone);
      if (!entryBody.activity?.trim()) {
        return res.status(400).json({ error: "Activity is required." });
      }

      const entry = await repo.addEntry({
        date,
        time,
        hour: entryBody.hour || time.slice(0, 2),
        activity: entryBody.activity,
        mood: entryBody.mood,
      }, userEmail);
      res.status(201).json({ entry });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/summaries/:date", async (req, res, next) => {
    try {
      const summary = await createAndSendSummary(req.params.date, getUserEmail(req));
      res.json({ summary });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/summaries/:date", async (req, res, next) => {
    try {
      res.json({ summary: await repo.getSummary(req.params.date, getUserEmail(req)) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/insights", async (req, res, next) => {
    try {
      res.json({ insights: await repo.getInsights(getUserEmail(req)) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/reminders/hourly", async (_req, res, next) => {
    try {
      const result = await sendHourlyReminder(new Date(), getUserEmail(_req), true);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.all("/api/cron/hourly", async (req, res, next) => {
    try {
      if (process.env.CRON_SECRET && req.query.secret !== process.env.CRON_SECRET) {
        return res.status(401).json({ error: "Invalid cron secret." });
      }
      const result = await runScheduledJobs(new Date(), { requireTopOfHour: false });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  if (serveStatic) {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message || "Something went wrong." });
  });

  return app;
}

export async function runScheduledJobs(now = new Date(), { requireTopOfHour = true } = {}) {
  const profiles = await repo.getReminderProfiles();
  if (!profiles.length) {
    console.log("[scheduler skipped] No profile.");
    return { skipped: true, reason: "No profile." };
  }

  const results = [];
  for (const profile of profiles) {
    if (!profile?.email) continue;
    results.push(await runScheduledJobsForProfile(profile, now, { requireTopOfHour }));
  }
  return { profiles: results };
}

async function runScheduledJobsForProfile(profile, now, { requireTopOfHour }) {
  const minute = Number(formatParts(now, profile.timezone).minute);
  if (requireTopOfHour && minute !== 0) {
    console.log(`[scheduler skipped] Not the top of the hour. minute="${minute}"`);
    return { email: profile.email, skipped: true, reason: "Not the top of the hour." };
  }

  const hourly = await sendHourlyReminder(now, profile.email);
  const summary = await maybeSendDailySummary(now, profile.timezone, profile.email);
  console.log("[scheduler result]", JSON.stringify({ hourly, summary }));
  return { email: profile.email, hourly, summary };
}

export async function sendHourlyReminder(now, userEmail, force = false) {
  const profile = await repo.getProfile(userEmail);
  if (!profile?.email) {
    console.log("[hourly skipped] No email on profile.");
    return { skipped: true, reason: "No email on profile." };
  }
  if (isPlaceholderEmail(profile.email)) {
    console.log(`[hourly skipped] Placeholder email. to="${profile.email}"`);
    return { skipped: true, reason: "Placeholder email is not eligible for reminders.", to: profile.email };
  }

  const timezone = profile?.timezone || "Asia/Kolkata";
  const date = formatDate(now, timezone);
  const time = formatTime(now, timezone);
  const key = `hourly:${date}:${time.slice(0, 2)}`;
  console.log(`[hourly check] key="${key}" to="${profile.email}" force="${force}"`);
  if (!force && (await repo.hasReminderBeenSent(key, profile.email))) {
    console.log(`[hourly skipped] Already sent. key="${key}"`);
    return { skipped: true, reason: "Already sent.", key };
  }

  const checkInUrl = `${getAppUrl()}/check-in?date=${date}&hour=${time.slice(0, 2)}`;
  await sendMail({
    to: profile.email,
    subject: "What are you doing right now?",
    text: `Log this hour: ${checkInUrl}`,
    html: `<p>What are you doing right now?</p><p><a href="${checkInUrl}">Log this hour</a></p>`,
  });
  await repo.markReminderSent(key, profile.email);
  return { sent: true, checkInUrl, to: profile.email, key };
}

async function maybeSendDailySummary(now, timezone, userEmail) {
  const hour = Number(formatParts(now, timezone).hour);
  if (hour !== summaryHour) return { skipped: true, reason: "Not summary hour." };
  const date = formatDate(now, timezone);
  const key = `summary:${date}`;
  if (await repo.hasReminderBeenSent(key, userEmail)) return { skipped: true, reason: "Summary already sent." };
  const summary = await createAndSendSummary(date, userEmail);
  await repo.markReminderSent(key, userEmail);
  return { sent: true, summary };
}

async function createAndSendSummary(date, userEmail) {
  const profile = await repo.getProfile(userEmail);
  const entries = await repo.getEntries({ date, userEmail });
  const review = await generateDailyReview({ profile, entries, date });
  const text = review.summary;
  const summary = await repo.saveSummary({ date, text, entryCount: entries.length }, userEmail);
  const { memory, insight } = deriveMemoryAndInsight({ profile, entries, summary, review });

  if (memory.length) {
    await repo.saveProfile({ ...profile, memory }, userEmail);
  }
  if (insight) {
    await repo.addInsight({ date, insight }, userEmail);
  }

  if (profile?.email) {
    await sendMail({
      to: profile.email,
      subject: `Your day in review: ${date}`,
      text,
      html: `<pre style="font-family:Inter,Arial,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
    });
  }

  return summary;
}

function validateProfile(body, userEmail = "") {
  const email = normalizeEmail(body.email || userEmail);
  if (isPlaceholderEmail(email)) {
    const error = new Error("Use your real email address, not an example.com test address.");
    error.status = 400;
    throw error;
  }

  const goals = Array.isArray(body.goals) ? body.goals : [];
  const cleanGoals = goals
    .map((goal) => ({
      title: goal.title?.trim() || "",
      achievement: goal.achievement?.trim() || "",
      deadline: goal.deadline || "",
      priority: goal.priority || "Medium",
    }))
    .filter((goal) => goal.title && goal.achievement && goal.deadline);

  if (!cleanGoals.length) {
    const error = new Error("Add at least one goal with achievement criteria and a deadline.");
    error.status = 400;
    throw error;
  }

  return {
    name: body.name || "",
    email,
    timezone: body.timezone || "Asia/Kolkata",
    goals: cleanGoals,
  };
}

function getUserEmail(req) {
  return normalizeEmail(req.headers["x-planner-user"] || req.query.user || "");
}

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function isPlaceholderEmail(email) {
  if (!email) return false;
  const domain = email.split("@").at(-1)?.toLowerCase();
  return ["example.com", "example.org", "example.net"].includes(domain);
}

function deriveMemoryAndInsight({ profile, entries, summary, review }) {
  const existing = Array.isArray(profile?.memory) ? profile.memory : [];
  const next = [...existing];
  const activities = entries.map((entry) => entry.activity).join(" ").toLowerCase();
  const moods = entries.map((entry) => entry.mood).filter(Boolean);

  if (entries.length >= 4) next.push(`You tend to respond well to frequent check-ins; ${entries.length} were logged on ${summary.date}.`);
  if (moods.length) next.push(`Recent energy words you used: ${[...new Set(moods)].slice(0, 4).join(", ")}.`);
  for (const goal of profile?.goals || []) {
    const firstWord = goal.title.toLowerCase().split(/\s+/)[0];
    if (firstWord && activities.includes(firstWord)) {
      next.push(`Your activity on ${summary.date} connected to the goal "${goal.title}".`);
    }
  }
  if (review?.memory) next.push(review.memory);

  const uniqueMemory = [...new Set(next)].slice(-12);
  const insight = review?.insight || (entries.length
    ? `On ${summary.date}, ${entries.length} logged check-in${entries.length === 1 ? "" : "s"} shaped the review. ${summary.text.split("\n")[0]}`
    : `On ${summary.date}, no activities were logged, so the review recommended starting tomorrow with one concrete check-in.`);

  return { memory: uniqueMemory, insight };
}

function getAppUrl() {
  const candidates = [process.env.APP_URL, process.env.URL, process.env.DEPLOY_PRIME_URL, fallbackHostedUrl];
  const usable = candidates.find((url) => url && !(process.env.NETLIFY && isLocalUrl(url)));
  return (usable || "http://127.0.0.1:5173").replace(/\/$/, "");
}

function isLocalUrl(url) {
  return /\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(url);
}

function parseRequestBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  if (Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString("utf8"));
    } catch {
      return {};
    }
  }
  if (typeof body === "object" && typeof body.body === "string" && !body.goals && !body.activity) {
    return parseRequestBody(body.body);
  }
  return body;
}

function normalizeEntryBody(body) {
  return {
    date: body.date || body.Date,
    time: body.time || body.Time,
    hour: body.hour || body.Hour,
    activity: body.activity || body.Activity || body.text || body.Text || body.dictation || body["Dictated Text"] || "",
    mood: body.mood || body.Mood || body.energy || body.Energy || "",
  };
}

function formatDate(date, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatTime(date, timezone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatParts(date, timezone) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const chars = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return chars[char];
  });
}
