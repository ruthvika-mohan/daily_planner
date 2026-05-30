import React from "react";
import { createRoot } from "react-dom/client";
import { Bell, Check, Clock, Mail, Plus, Send, Sparkles, Target, Trash2 } from "lucide-react";
import "./styles.css";

const apiBase = import.meta.env.VITE_API_BASE || "http://127.0.0.1:4000";

function App() {
  const [profile, setProfile] = React.useState(null);
  const [entries, setEntries] = React.useState([]);
  const [summary, setSummary] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [notice, setNotice] = React.useState("");
  const today = new Date().toLocaleDateString("en-CA");

  React.useEffect(() => {
    Promise.all([fetchJson("/api/profile"), fetchJson(`/api/entries?date=${today}`)])
      .then(([profileResult, entriesResult]) => {
        setProfile(profileResult.profile);
        setEntries(entriesResult.entries);
      })
      .finally(() => setLoading(false));
  }, [today]);

  React.useEffect(() => {
    if (!profile) return undefined;
    const timer = setInterval(() => {
      const now = new Date();
      if (now.getMinutes() === 0) {
        showBrowserNotification();
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [profile]);

  async function saveProfile(nextProfile) {
    const result = await fetchJson("/api/profile", {
      method: "POST",
      body: JSON.stringify(nextProfile),
    });
    setProfile(result.profile);
    setNotice("Profile saved. Hourly check-ins are ready.");
  }

  async function saveEntry(entry) {
    const result = await fetchJson("/api/entries", {
      method: "POST",
      body: JSON.stringify(entry),
    });
    setEntries((current) => [result.entry, ...current]);
    setNotice("Logged. Nice and specific.");
  }

  async function requestNotificationAccess() {
    if (!("Notification" in window)) {
      setNotice("This browser does not support notifications.");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotice(permission === "granted" ? "Browser notifications enabled." : "Notifications were not enabled.");
  }

  async function sendTestReminder() {
    const result = await fetchJson("/api/reminders/hourly", { method: "POST" });
    setNotice(result.checkInUrl ? "Test reminder created. Email sends when SMTP is configured." : "Reminder checked.");
  }

  async function generateSummary() {
    const result = await fetchJson(`/api/summaries/${today}`, { method: "POST" });
    setSummary(result.summary);
  }

  function showBrowserNotification() {
    if ("Notification" in window && Notification.permission === "granted") {
      const notification = new Notification("What are you doing right now?", {
        body: "Open the planner and log this hour.",
      });
      notification.onclick = () => {
        window.focus();
        window.location.href = `/check-in?date=${today}`;
      };
    }
  }

  if (loading) return <main className="shell loading">Loading planner...</main>;

  return (
    <main className="shell">
      <Header profile={profile} onNotify={requestNotificationAccess} onTestReminder={sendTestReminder} />
      {notice ? <div className="notice">{notice}</div> : null}
      {!profile ? (
        <ProfileSetup onSave={saveProfile} />
      ) : (
        <Dashboard
          profile={profile}
          entries={entries}
          summary={summary}
          onEntry={saveEntry}
          onGenerateSummary={generateSummary}
        />
      )}
    </main>
  );
}

function Header({ profile, onNotify, onTestReminder }) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Daily Planner</p>
        <h1>{profile ? `Hello${profile.name ? `, ${profile.name}` : ""}` : "Set up your goals first"}</h1>
      </div>
      <div className="toolbar">
        <button className="iconButton" onClick={onNotify} title="Enable browser notifications" aria-label="Enable notifications">
          <Bell size={19} />
        </button>
        <button className="secondary" onClick={onTestReminder}>
          <Mail size={17} />
          Test reminder
        </button>
      </div>
    </header>
  );
}

function ProfileSetup({ onSave }) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [timezone, setTimezone] = React.useState("Asia/Kolkata");
  const [goals, setGoals] = React.useState([
    { title: "", achievement: "", deadline: "", priority: "High" },
  ]);

  function updateGoal(index, patch) {
    setGoals((current) => current.map((goal, goalIndex) => (goalIndex === index ? { ...goal, ...patch } : goal)));
  }

  function removeGoal(index) {
    setGoals((current) => current.filter((_, goalIndex) => goalIndex !== index));
  }

  function submit(event) {
    event.preventDefault();
    onSave({ name, email, timezone, goals });
  }

  return (
    <section className="setup">
      <div className="panel introPanel">
        <Target size={26} />
        <h2>Profile setup</h2>
        <p>
          Define what you are trying to achieve, what “done” looks like, when it matters, and which goals deserve
          priority. The end-of-day review uses this to coach your next day.
        </p>
      </div>
      <form className="panel formPanel" onSubmit={submit}>
        <div className="fieldGrid">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
          </label>
          <label>
            Email for reminders
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
          </label>
          <label>
            Timezone
            <input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Kolkata" />
          </label>
        </div>
        <div className="goalsHeader">
          <h2>Goals</h2>
          <button type="button" className="secondary" onClick={() => setGoals([...goals, { title: "", achievement: "", deadline: "", priority: "Medium" }])}>
            <Plus size={17} />
            Add goal
          </button>
        </div>
        {goals.map((goal, index) => (
          <div className="goalEditor" key={index}>
            <label>
              Goal
              <input value={goal.title} onChange={(event) => updateGoal(index, { title: event.target.value })} placeholder="Ship portfolio site" required />
            </label>
            <label>
              Achievement criteria
              <textarea value={goal.achievement} onChange={(event) => updateGoal(index, { achievement: event.target.value })} placeholder="Published with 3 case studies and analytics installed" required />
            </label>
            <div className="inlineFields">
              <label>
                Achieve by
                <input type="date" value={goal.deadline} onChange={(event) => updateGoal(index, { deadline: event.target.value })} required />
              </label>
              <label>
                Priority
                <select value={goal.priority} onChange={(event) => updateGoal(index, { priority: event.target.value })}>
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
              </label>
              {goals.length > 1 ? (
                <button type="button" className="iconButton danger" onClick={() => removeGoal(index)} title="Remove goal" aria-label="Remove goal">
                  <Trash2 size={18} />
                </button>
              ) : null}
            </div>
          </div>
        ))}
        <button className="primary" type="submit">
          <Check size={18} />
          Save profile
        </button>
      </form>
    </section>
  );
}

function Dashboard({ profile, entries, summary, onEntry, onGenerateSummary }) {
  return (
    <section className="dashboard">
      <CheckInForm onEntry={onEntry} />
      <div className="panel">
        <div className="sectionTitle">
          <Sparkles size={20} />
          <h2>Goals</h2>
        </div>
        <div className="goalList">
          {profile.goals.map((goal, index) => (
            <article className="goalCard" key={`${goal.title}-${index}`}>
              <div>
                <strong>{goal.title}</strong>
                <p>{goal.achievement}</p>
              </div>
              <span>{goal.priority}</span>
              <time>{goal.deadline}</time>
            </article>
          ))}
        </div>
      </div>
      <ActivityLog entries={entries} />
      <div className="panel summaryPanel">
        <div className="sectionTitle">
          <Send size={20} />
          <h2>End-of-day review</h2>
        </div>
        <button className="primary" onClick={onGenerateSummary}>
          <Sparkles size={18} />
          Generate review
        </button>
        {summary ? <pre>{summary.text}</pre> : <p className="muted">A summary is mailed automatically at your configured hour when email is set up.</p>}
      </div>
    </section>
  );
}

function CheckInForm({ onEntry }) {
  const params = new URLSearchParams(window.location.search);
  const [activity, setActivity] = React.useState("");
  const [mood, setMood] = React.useState("");
  const hour = params.get("hour") || new Date().getHours().toString().padStart(2, "0");
  const date = params.get("date") || new Date().toLocaleDateString("en-CA");

  function submit(event) {
    event.preventDefault();
    onEntry({ date, hour, activity, mood });
    setActivity("");
    setMood("");
  }

  return (
    <form className="panel checkIn" onSubmit={submit}>
      <div className="sectionTitle">
        <Clock size={20} />
        <h2>{date} · {hour}:00</h2>
      </div>
      <label>
        What did you do this hour?
        <textarea value={activity} onChange={(event) => setActivity(event.target.value)} placeholder="Be concrete: worked on API auth, reviewed notes, walked, etc." required autoFocus />
      </label>
      <label>
        Mood or energy
        <input value={mood} onChange={(event) => setMood(event.target.value)} placeholder="Focused, tired, distracted..." />
      </label>
      <button className="primary" type="submit">
        <Check size={18} />
        Log activity
      </button>
    </form>
  );
}

function ActivityLog({ entries }) {
  return (
    <div className="panel">
      <div className="sectionTitle">
        <Clock size={20} />
        <h2>Today’s activity</h2>
      </div>
      <div className="timeline">
        {entries.length ? entries.map((entry) => (
          <article className="entry" key={entry.id}>
            <time>{entry.time || `${entry.hour}:00`}</time>
            <div>
              <p>{entry.activity}</p>
              {entry.mood ? <span>{entry.mood}</span> : null}
            </div>
          </article>
        )) : <p className="muted">No check-ins logged yet today.</p>}
      </div>
    </div>
  );
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}

createRoot(document.getElementById("root")).render(<App />);
