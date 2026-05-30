import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const defaultData = {
  profile: null,
  entries: [],
  summaries: [],
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

  async getProfile() {
    const data = await this.read();
    return data.profile;
  }

  async saveProfile(profile) {
    const data = await this.read();
    data.profile = {
      name: profile.name?.trim() || "",
      email: profile.email?.trim() || "",
      timezone: profile.timezone || "Asia/Kolkata",
      goals: profile.goals,
      updatedAt: new Date().toISOString(),
    };
    await this.write(data);
    return data.profile;
  }

  async addEntry(entry) {
    const data = await this.read();
    const now = new Date();
    const saved = {
      id: crypto.randomUUID(),
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

  async getEntries({ date } = {}) {
    const data = await this.read();
    return date ? data.entries.filter((entry) => entry.date === date) : data.entries;
  }

  async saveSummary(summary) {
    const data = await this.read();
    const summaries = data.summaries.filter((item) => item.date !== summary.date);
    summaries.push({ ...summary, createdAt: new Date().toISOString() });
    data.summaries = summaries;
    await this.write(data);
    return summary;
  }

  async getSummary(date) {
    const data = await this.read();
    return data.summaries.find((summary) => summary.date === date) || null;
  }

  async markReminderSent(key) {
    const data = await this.read();
    if (!data.sentReminders.includes(key)) {
      data.sentReminders.push(key);
      data.sentReminders = data.sentReminders.slice(-500);
      await this.write(data);
    }
  }

  async hasReminderBeenSent(key) {
    const data = await this.read();
    return data.sentReminders.includes(key);
  }
}
