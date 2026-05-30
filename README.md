# Daily Planner

A simple React planner that asks what you are doing every hour, stores date/time/activity entries locally, and sends an end-of-day review with optional LLM coaching.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## What It Does

- Profile setup comes first: goals, achievement criteria, target dates, and priorities.
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

## Hosted Deployment

The app supports hosted PostgreSQL storage with `DATABASE_URL`. If `DATABASE_URL` is present, it stores profile, activity logs, summaries, and sent-reminder markers in Postgres. If it is absent, it uses local `data/planner.json`.

One simple path is Render:

1. Push this project to GitHub.
2. Create a new Render Blueprint from the repository, using `render.yaml`.
3. Set `APP_URL` to the deployed web service URL.
4. Add the same SMTP variables from your local `.env`.
5. Add `OPENAI_API_KEY` if you want LLM-based daily coaching.
6. Deploy.

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
