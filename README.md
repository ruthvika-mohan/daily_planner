# Daily Planner

A simple React planner that asks what you are doing every hour, stores date/time/activity entries locally, and sends an end-of-day review with optional LLM coaching.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## What It Does

- Login starts with your reminder email. New emails go through profile setup; returning emails load their existing goals and data.
- Profile setup comes first: goals, achievement criteria, target dates, and priorities.
- The Profile tab lets you edit profile details, add or remove goals, inspect AI memory, and review insights from past daily reviews.
- Hourly check-ins can arrive through browser notifications when the app is open.
- Email reminders are sent hourly when SMTP is configured in `.env`.
- Reminder links open `/check-in` in the React app.
- Activity is stored in `data/planner.json` as date, time, hour, activity, and mood.
- End-of-day summaries are generated automatically at `DAILY_SUMMARY_HOUR`.
- If `OPENAI_API_KEY` is set, the summary uses an LLM. Otherwise it uses a local fallback.

## Email Setup

Copy `.env.example` to `.env`, fill in SMTP settings, and restart the dev server. For Gmail, use an app password rather than your account password.

## Production

```bash
npm run build
NODE_ENV=production npm start
```

## Hosted Deployment: Free-Friendly Netlify

The app supports hosted PostgreSQL storage with `DATABASE_URL`. If `DATABASE_URL` is present, it stores profile, activity logs, summaries, and sent-reminder markers in Postgres. If it is absent, it uses local `data/planner.json`.

The lowest-cost setup is:

1. Deploy the app on Netlify Free.
2. Store data in a free external Postgres database, such as Neon or Supabase.
3. Let Netlify Scheduled Functions call the reminder job every hour.

Netlify setup:

1. Push this project to GitHub.
2. In Netlify, choose "Add new site" then "Import an existing project".
3. Select the GitHub repo.
4. Build command: `npm run build`
5. Publish directory: `dist`
6. Functions directory: `netlify/functions`
7. Add environment variables:

```env
APP_URL=https://your-netlify-site.netlify.app
DATABASE_URL=postgres://...
DATABASE_SSL=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=you@example.com
SMTP_PASS=app-password
MAIL_FROM=Daily Planner <you@example.com>
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
DAILY_SUMMARY_HOUR=21
```

After the first deploy, update `APP_URL` to the final Netlify URL and redeploy.

Render is still supported, but Render may require a paid always-on service or paid Postgres depending on the selected plan. For a personal planner, Netlify plus external Postgres is usually the better free-tier path.

For other hosts, create a Node web service with:

```bash
npm install
npm run build
npm start
```

Then provide these environment variables:

```env
NODE_ENV=production
PORT=4000
APP_URL=https://your-deployed-app-url
DATABASE_URL=postgres://...
SMTP_HOST=...
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM=Daily Planner <you@example.com>
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
```
