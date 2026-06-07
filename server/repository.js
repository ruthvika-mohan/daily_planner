import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const defaultData = {
  profile: null,
  profiles: {},
  entries: [],
  summaries: [],
  insights: [],
  sentReminders: [],
};

export class PlannerRepository {
  constructor(filePath = path.join(process.cwd(), "data", "planner.json")) {
    this.filePath = filePath;
  }

  async read() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return { ...defaultData, ...JSON.parse(raw) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.write(defaultData);
      return structuredClone(defaultData);
    }
  }

  async write(data) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  async login(email) {
    const profile = await this.getProfile(email);
    return { registered: Boolean(profile), profile };
  }

  async getProfile(userEmail) {
    const data = await this.read();
    const email = normalizeEmail(userEmail);
    return data.profiles[email] || (normalizeEmail(data.profile?.email) === email ? data.profile : null);
  }

  async getReminderProfiles() {
    const data = await this.read();
    const profiles = Object.values(data.profiles || {});
    return profiles.length ? profiles : data.profile ? [data.profile] : [];
  }

  async saveProfile(profile, userEmail = profile.email) {
    const data = await this.read();
    const email = normalizeEmail(profile.email || userEmail);
    const saved = {
      name: profile.name?.trim() || "",
      email,
      timezone: profile.timezone || "Asia/Kolkata",
      goals: profile.goals,
      memory: profile.memory || [],
      updatedAt: new Date().toISOString(),
    };
    data.profiles[email] = saved;
    data.profile = saved;
    await this.write(data);
    return saved;
  }

  async addEntry(entry, userEmail) {
    const data = await this.read();
    const email = normalizeEmail(userEmail);
    const now = new Date();
    const saved = {
      id: crypto.randomUUID(),
      userEmail: email,
      date: entry.date,
      time: entry.time,
      hour: entry.hour,
      activity: entry.activity.trim(),
      mood: entry.mood?.trim() || "",
      createdAt: now.toISOString(),
    };
    data.entries.push(saved);
    await this.write(data);
    return saved;
  }

  async getEntries({ date, userEmail } = {}) {
    const data = await this.read();
    const email = normalizeEmail(userEmail);
    const entries = data.entries.filter((entry) => !entry.userEmail || entry.userEmail === email);
    return date ? entries.filter((entry) => entry.date === date) : entries;
  }

  async saveSummary(summary, userEmail) {
    const data = await this.read();
    const email = normalizeEmail(userEmail);
    const summaries = data.summaries.filter((item) => item.date !== summary.date || item.userEmail !== email);
    summaries.push({ ...summary, userEmail: email, createdAt: new Date().toISOString() });
    data.summaries = summaries;
    await this.write(data);
    return summary;
  }

  async getSummary(date, userEmail) {
    const data = await this.read();
    const email = normalizeEmail(userEmail);
    return data.summaries.find((summary) => summary.date === date && (!summary.userEmail || summary.userEmail === email)) || null;
  }

  async addInsight({ date, insight }, userEmail) {
    const data = await this.read();
    const saved = { id: crypto.randomUUID(), userEmail: normalizeEmail(userEmail), date, insight, createdAt: new Date().toISOString() };
    data.insights.push(saved);
    await this.write(data);
    return saved;
  }

  async getInsights(userEmail) {
    const data = await this.read();
    const email = normalizeEmail(userEmail);
    return data.insights.filter((insight) => insight.userEmail === email).slice(-50).reverse();
  }

  async markReminderSent(key, userEmail) {
    const data = await this.read();
    const scopedKey = `${normalizeEmail(userEmail)}:${key}`;
    if (!data.sentReminders.includes(scopedKey)) {
      data.sentReminders.push(scopedKey);
      data.sentReminders = data.sentReminders.slice(-500);
      await this.write(data);
    }
  }

  async hasReminderBeenSent(key, userEmail) {
    const data = await this.read();
    return data.sentReminders.includes(`${normalizeEmail(userEmail)}:${key}`);
  }
}

function normalizeEmail(email = "") {
  return email.trim().toLowerCase();
}
