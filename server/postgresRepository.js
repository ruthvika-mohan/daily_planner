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
      CREATE TABLE IF NOT EXISTS planner_profiles_v2 (
        email text PRIMARY KEY,
        profile jsonb NOT NULL,
        memory jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS planner_entries_v2 (
        id uuid PRIMARY KEY,
        user_email text NOT NULL REFERENCES planner_profiles_v2(email) ON DELETE CASCADE,
        date text NOT NULL,
        time text NOT NULL,
        hour text NOT NULL,
        activity text NOT NULL,
        mood text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS planner_entries_v2_user_date_idx ON planner_entries_v2 (user_email, date);

      CREATE TABLE IF NOT EXISTS planner_summaries_v2 (
        user_email text NOT NULL REFERENCES planner_profiles_v2(email) ON DELETE CASCADE,
        date text NOT NULL,
        text text NOT NULL,
        entry_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_email, date)
      );

      CREATE TABLE IF NOT EXISTS planner_sent_reminders_v2 (
        user_email text NOT NULL REFERENCES planner_profiles_v2(email) ON DELETE CASCADE,
        key text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_email, key)
      );

      CREATE TABLE IF NOT EXISTS planner_insights_v2 (
        id uuid PRIMARY KEY,
        user_email text NOT NULL REFERENCES planner_profiles_v2(email) ON DELETE CASCADE,
        date text NOT NULL,
        insight text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

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
    await this.migrateLegacyProfile();
  }

  async migrateLegacyProfile() {
    const legacy = await this.pool.query("SELECT profile FROM planner_profile WHERE id = 1");
    const profile = legacy.rows[0]?.profile;
    if (!profile?.email) return;
    await this.pool.query(
      `
        INSERT INTO planner_profiles_v2 (email, profile, memory, updated_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (email) DO NOTHING
      `,
      [profile.email.toLowerCase(), { ...profile, email: profile.email.toLowerCase() }, profile.memory || []],
    );
  }

  async login(email) {
    await this.ready;
    const normalized = normalizeEmail(email);
    const result = await this.pool.query("SELECT profile, memory FROM planner_profiles_v2 WHERE email = $1", [normalized]);
    const row = result.rows[0];
    return { registered: Boolean(row), profile: row ? { ...row.profile, memory: row.memory || [] } : null };
  }

  async getProfile(userEmail) {
    await this.ready;
    const normalized = normalizeEmail(userEmail);
    const result = await this.pool.query("SELECT profile, memory FROM planner_profiles_v2 WHERE email = $1", [normalized]);
    const row = result.rows[0];
    return row ? { ...row.profile, memory: row.memory || [] } : null;
  }

  async getReminderProfiles() {
    await this.ready;
    const result = await this.pool.query("SELECT profile, memory FROM planner_profiles_v2 ORDER BY updated_at DESC");
    return result.rows.map((row) => ({ ...row.profile, memory: row.memory || [] }));
  }

  async saveProfile(profile, userEmail = profile.email) {
    await this.ready;
    const email = normalizeEmail(profile.email || userEmail);
    const saved = {
      name: profile.name?.trim() || "",
      email,
      timezone: profile.timezone || "Asia/Kolkata",
      goals: profile.goals,
      memory: profile.memory || [],
      updatedAt: new Date().toISOString(),
    };

    await this.pool.query(
      `
        INSERT INTO planner_profiles_v2 (email, profile, memory, updated_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (email)
        DO UPDATE SET profile = excluded.profile, memory = excluded.memory, updated_at = now()
      `,
      [email, saved, saved.memory],
    );
    return saved;
  }

  async addEntry(entry, userEmail) {
    await this.ready;
    const email = normalizeEmail(userEmail);
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
        INSERT INTO planner_entries_v2 (id, user_email, date, time, hour, activity, mood, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [saved.id, email, saved.date, saved.time, saved.hour, saved.activity, saved.mood, saved.createdAt],
    );
    return saved;
  }

  async getEntries({ date, userEmail } = {}) {
    await this.ready;
    const email = normalizeEmail(userEmail);
    const result = date
      ? await this.pool.query(
          `
            SELECT id, date, time, hour, activity, mood, created_at AS "createdAt"
            FROM planner_entries_v2
            WHERE user_email = $1 AND date = $2
            ORDER BY created_at DESC
          `,
          [email, date],
        )
      : await this.pool.query(`
          SELECT id, date, time, hour, activity, mood, created_at AS "createdAt"
          FROM planner_entries_v2
          WHERE user_email = $1
          ORDER BY created_at DESC
        `, [email]);
    return result.rows;
  }

  async saveSummary(summary, userEmail) {
    await this.ready;
    const email = normalizeEmail(userEmail);
    const saved = {
      date: summary.date,
      text: summary.text,
      entryCount: summary.entryCount,
      createdAt: new Date().toISOString(),
    };
    await this.pool.query(
      `
        INSERT INTO planner_summaries_v2 (user_email, date, text, entry_count, created_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_email, date)
        DO UPDATE SET text = excluded.text, entry_count = excluded.entry_count, created_at = excluded.created_at
      `,
      [email, saved.date, saved.text, saved.entryCount, saved.createdAt],
    );
    return saved;
  }

  async getSummary(date, userEmail) {
    await this.ready;
    const email = normalizeEmail(userEmail);
    const result = await this.pool.query(
      `
        SELECT date, text, entry_count AS "entryCount", created_at AS "createdAt"
        FROM planner_summaries_v2
        WHERE user_email = $1 AND date = $2
      `,
      [email, date],
    );
    return result.rows[0] || null;
  }

  async addInsight({ date, insight }, userEmail) {
    await this.ready;
    const email = normalizeEmail(userEmail);
    const saved = { id: crypto.randomUUID(), date, insight, createdAt: new Date().toISOString() };
    await this.pool.query(
      "INSERT INTO planner_insights_v2 (id, user_email, date, insight, created_at) VALUES ($1, $2, $3, $4, $5)",
      [saved.id, email, saved.date, saved.insight, saved.createdAt],
    );
    return saved;
  }

  async getInsights(userEmail) {
    await this.ready;
    const email = normalizeEmail(userEmail);
    const result = await this.pool.query(
      `SELECT id, date, insight, created_at AS "createdAt"
       FROM planner_insights_v2
       WHERE user_email = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [email],
    );
    return result.rows;
  }

  async markReminderSent(key, userEmail) {
    await this.ready;
    const email = normalizeEmail(userEmail);
    await this.pool.query(
      "INSERT INTO planner_sent_reminders_v2 (user_email, key) VALUES ($1, $2) ON CONFLICT (user_email, key) DO NOTHING",
      [email, key],
    );
  }

  async hasReminderBeenSent(key, userEmail) {
    await this.ready;
    const email = normalizeEmail(userEmail);
    const result = await this.pool.query("SELECT key FROM planner_sent_reminders_v2 WHERE user_email = $1 AND key = $2", [email, key]);
    return result.rowCount > 0;
  }
}

function normalizeEmail(email = "") {
  return email.trim().toLowerCase();
}
