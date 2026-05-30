import pg from "pg";

const { Pool } = pg;

export class PostgresPlannerRepository {
  constructor(connectionString = process.env.DATABASE_URL) {
    this.pool = new Pool({
      connectionString,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
    this.ready = this.init();
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS planner_profile (
        id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        profile jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS planner_entries (
        id uuid PRIMARY KEY,
        date text NOT NULL,
        time text NOT NULL,
        hour text NOT NULL,
        activity text NOT NULL,
        mood text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS planner_entries_date_idx ON planner_entries (date);

      CREATE TABLE IF NOT EXISTS planner_summaries (
        date text PRIMARY KEY,
        text text NOT NULL,
        entry_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS planner_sent_reminders (
        key text PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  async getProfile() {
    await this.ready;
    const result = await this.pool.query("SELECT profile FROM planner_profile WHERE id = 1");
    return result.rows[0]?.profile || null;
  }

  async saveProfile(profile) {
    await this.ready;
    const saved = {
      name: profile.name?.trim() || "",
      email: profile.email?.trim() || "",
      timezone: profile.timezone || "Asia/Kolkata",
      goals: profile.goals,
      updatedAt: new Date().toISOString(),
    };

    await this.pool.query(
      `
        INSERT INTO planner_profile (id, profile, updated_at)
        VALUES (1, $1, now())
        ON CONFLICT (id)
        DO UPDATE SET profile = excluded.profile, updated_at = now()
      `,
      [saved],
    );
    return saved;
  }

  async addEntry(entry) {
    await this.ready;
    const saved = {
      id: crypto.randomUUID(),
      date: entry.date,
      time: entry.time,
      hour: entry.hour,
      activity: entry.activity.trim(),
      mood: entry.mood?.trim() || "",
      createdAt: new Date().toISOString(),
    };

    await this.pool.query(
      `
        INSERT INTO planner_entries (id, date, time, hour, activity, mood, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [saved.id, saved.date, saved.time, saved.hour, saved.activity, saved.mood, saved.createdAt],
    );
    return saved;
  }

  async getEntries({ date } = {}) {
    await this.ready;
    const result = date
      ? await this.pool.query(
          `
            SELECT id, date, time, hour, activity, mood, created_at AS "createdAt"
            FROM planner_entries
            WHERE date = $1
            ORDER BY created_at DESC
          `,
          [date],
        )
      : await this.pool.query(`
          SELECT id, date, time, hour, activity, mood, created_at AS "createdAt"
          FROM planner_entries
          ORDER BY created_at DESC
        `);
    return result.rows;
  }

  async saveSummary(summary) {
    await this.ready;
    const saved = {
      date: summary.date,
      text: summary.text,
      entryCount: summary.entryCount,
      createdAt: new Date().toISOString(),
    };
    await this.pool.query(
      `
        INSERT INTO planner_summaries (date, text, entry_count, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (date)
        DO UPDATE SET text = excluded.text, entry_count = excluded.entry_count, created_at = excluded.created_at
      `,
      [saved.date, saved.text, saved.entryCount, saved.createdAt],
    );
    return saved;
  }

  async getSummary(date) {
    await this.ready;
    const result = await this.pool.query(
      `
        SELECT date, text, entry_count AS "entryCount", created_at AS "createdAt"
        FROM planner_summaries
        WHERE date = $1
      `,
      [date],
    );
    return result.rows[0] || null;
  }

  async markReminderSent(key) {
    await this.ready;
    await this.pool.query(
      "INSERT INTO planner_sent_reminders (key) VALUES ($1) ON CONFLICT (key) DO NOTHING",
      [key],
    );
  }

  async hasReminderBeenSent(key) {
    await this.ready;
    const result = await this.pool.query("SELECT key FROM planner_sent_reminders WHERE key = $1", [key]);
    return result.rowCount > 0;
  }
}
