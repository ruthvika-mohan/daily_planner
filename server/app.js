import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PlannerRepository } from "./repository.js";
import { PostgresPlannerRepository } from "./postgresRepository.js";
import { generateDailySummary } from "./llm.js";
import { sendMail } from "./mailer.js";

export const repo = process.env.DATABASE_URL ? new PostgresPlannerRepository() : new PlannerRepository();

const appUrl = process.env.APP_URL || "http://127.0.0.1:5173";
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

  app.get("/api/profile", async (_req, res, next) => {
    try {
      res.json({ profile: await repo.getProfile() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/profile", async (req, res, next) => {
    try {
      const profile = validateProfile(req.body);
      res.status(201).json({ profile: await repo.saveProfile(profile) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/entries", async (req, res, next) => {
    try {
      res.json({ entries: await repo.getEntries({ date: req.query.date }) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/entries", async (req, res, next) => {
    try {
      const profile = await repo.getProfile();
      const timezone = profile?.timezone || "Asia/Kolkata";
      const now = new Date();
      const date = req.body.date || formatDate(now, timezone);
      const time = req.body.time || formatTime(now, timezone);
      if (!req.body.activity?.trim()) {
        return res.status(400).json({ error: "Activity is required." });
      }

      const entry = await repo.addEntry({
        date,
        time,
        hour: req.body.hour || time.slice(0, 2),
        activity: req.body.activity,
        mood: req.body.mood,
      });
      res.status(201).json({ entry });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/summaries/:date", async (req, res, next) => {
    try {
      const summary = await createAndSendSummary(req.params.date);
      res.json({ summary });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/summaries/:date", async (req, res, next) => {
    try {
      res.json({ summary: await repo.getSummary(req.params.date) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/reminders/hourly", async (_req, res, next) => {
    try {
      const result = await sendHourlyReminder(new Date(), true);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  if (serveStatic) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const distPath = path.join(__dirname, "..", "dist");
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

export async function runScheduledJobs(now = new Date()) {
  const profile = await repo.getProfile();
  if (!profile) return { skipped: true, reason: "No profile." };

  const minute = Number(formatParts(now, profile.timezone).minute);
  if (minute !== 0) return { skipped: true, reason: "Not the top of the hour." };

  const hourly = await sendHourlyReminder(now);
  const summary = await maybeSendDailySummary(now, profile.timezone);
  return { hourly, summary };
}

export async function sendHourlyReminder(now, force = false) {
  const profile = await repo.getProfile();
  if (!profile?.email && !force) return { skipped: true, reason: "No email on profile." };

  const timezone = profile?.timezone || "Asia/Kolkata";
  const date = formatDate(now, timezone);
  const time = formatTime(now, timezone);
  const key = `hourly:${date}:${time.slice(0, 2)}`;
  if (!force && (await repo.hasReminderBeenSent(key))) return { skipped: true, reason: "Already sent." };

  const checkInUrl = `${appUrl}/check-in?date=${date}&hour=${time.slice(0, 2)}`;
  await sendMail({
    to: profile.email,
    subject: "What are you doing right now?",
    text: `Log this hour: ${checkInUrl}`,
    html: `<p>What are you doing right now?</p><p><a href="${checkInUrl}">Log this hour</a></p>`,
  });
  await repo.markReminderSent(key);
  return { sent: true, checkInUrl };
}

async function maybeSendDailySummary(now, timezone) {
  const hour = Number(formatParts(now, timezone).hour);
  if (hour !== summaryHour) return { skipped: true, reason: "Not summary hour." };
  const date = formatDate(now, timezone);
  const key = `summary:${date}`;
  if (await repo.hasReminderBeenSent(key)) return { skipped: true, reason: "Summary already sent." };
  const summary = await createAndSendSummary(date);
  await repo.markReminderSent(key);
  return { sent: true, summary };
}

async function createAndSendSummary(date) {
  const profile = await repo.getProfile();
  const entries = await repo.getEntries({ date });
  const text = await generateDailySummary({ profile, entries, date });
  const summary = await repo.saveSummary({ date, text, entryCount: entries.length });

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

function validateProfile(body) {
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
    email: body.email || "",
    timezone: body.timezone || "Asia/Kolkata",
    goals: cleanGoals,
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
