import React from "react";
import { createRoot } from "react-dom/client";
import { Bell, Brain, Check, Clock, Lightbulb, LogOut, Mail, Plus, Send, Sparkles, Target, Trash2, User } from "lucide-react";
import "./styles.css";

const apiBase = import.meta.env.VITE_API_BASE || "";
const savedLoginKey = "dailyPlannerUserEmail";

function App() {
  const [userEmail, setUserEmail] = React.useState(() => localStorage.getItem(savedLoginKey) || "");
  const [profile, setProfile] = React.useState(null);
  const [entries, setEntries] = React.useState([]);
  const [insights, setInsights] = React.useState([]);
  const [summary, setSummary] = React.useState(null);
  const [loading, setLoading] = React.useState(Boolean(userEmail));
  const [notice, setNotice] = React.useState("");
  const [view, setView] = React.useState("planner");
  const today = new Date().toLocaleDateString("en-CA");

  React.useEffect(() => {
    if (!userEmail) {
      setLoading(false);
      return;
    }
    loadAccount(userEmail);
  }, [userEmail, today]);

  React.useEffect(() => {
    if (!profile) return undefined;
    const timer = setInterval(() => {
      const now = new Date();
      if (now.getMinutes() === 0) showBrowserNotification();
    }, 60_000);
    return () => clearInterval(timer);
  }, [profile]);

  async function loadAccount(email) {
    setLoading(true);
    try {
      const loginResult = await fetchJson("/api/login", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setProfile(loginResult.profile);
      if (loginResult.profile) {
        const [entriesResult, insightsResult] = await Promise.all([
          fetchJson(`/api/entries?date=${today}`, {}, email),
          fetchJson("/api/insights", {}, email),
        ]);
        setEntries(entriesResult.entries);
        setInsights(insightsResult.insights);
      }
      localStorage.setItem(savedLoginKey, email);
      setUserEmail(email);
    } catch (error) {
      setNotice(error.message);
      localStorage.removeItem(savedLoginKey);
      setUserEmail("");
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile(nextProfile) {
    try {
      const result = await fetchJson("/api/profile", {
        method: "POST",
        body: JSON.stringify(nextProfile),
      }, userEmail || nextProfile.email);
      setProfile(result.profile);
      setUserEmail(result.profile.email);
      localStorage.setItem(savedLoginKey, result.profile.email);
      const insightsResult = await fetchJson("/api/insights", {}, result.profile.email);
      setInsights(insightsResult.insights);
      setView("planner");
      setNotice("Profile saved. Hourly check-ins are ready.");
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function saveEntry(entry) {
    try {
      const result = await fetchJson("/api/entries", {
        method: "POST",
        body: JSON.stringify(entry),
      }, userEmail);
      setEntries((current) => [result.entry, ...current]);
      setNotice("Logged. Nice and specific.");
    } catch (error) {
      setNotice(error.message);
    }
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
    try {
      const result = await fetchJson("/api/reminders/hourly", { method: "POST" }, userEmail);
      setNotice(result.checkInUrl ? `Test reminder sent to ${result.to}.` : result.reason || "Reminder checked.");
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function generateSummary() {
    try {
      const result = await fetchJson(`/api/summaries/${today}`, { method: "POST" }, userEmail);
      const insightsResult = await fetchJson("/api/insights", {}, userEmail);
      const profileResult = await fetchJson("/api/profile", {}, userEmail);
      setSummary(result.summary);
      setInsights(insightsResult.insights);
      setProfile(profileResult.profile);
    } catch (error) {
      setNotice(error.message);
    }
  }

  function logout() {
    localStorage.removeItem(savedLoginKey);
    setUserEmail("");
    setProfile(null);
    setEntries([]);
    setInsights([]);
    setSummary(null);
    setView("planner");
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

  if (!userEmail) {
    return (
      <main className="shell">
        <Login onLogin={loadAccount} notice={notice} />
      </main>
    );
  }

  return (
    <main className="shell">
      <Header
        profile={profile}
        userEmail={userEmail}
        view={view}
        onView={setView}
        onNotify={requestNotificationAccess}
        onTestReminder={sendTestReminder}
        onLogout={logout}
      />
      {notice ? <div className="notice">{notice}</div> : null}
      {!profile ? (
        <ProfileEditor userEmail={userEmail} onSave={saveProfile} mode="setup" />
      ) : view === "profile" ? (
        <ProfileSection profile={profile} insights={insights} onSave={saveProfile} />
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

function Login({ onLogin, notice }) {
  const [email, setEmail] = React.useState("");

  function submit(event) {
    event.preventDefault();
    onLogin(email.trim().toLowerCase());
  }

  return (
    <section className="loginWrap">
      <form className="panel loginPanel" onSubmit={submit}>
        <div className="sectionTitle">
          <User size={22} />
          <h1>Daily Planner</h1>
        </div>
        <p className="muted">Log in with your reminder email. If it is new, you will set up goals next.</p>
        {notice ? <div className="notice compactNotice">{notice}</div> : null}
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required autoFocus />
        </label>
        <button className="primary" type="submit">
          <Check size={18} />
          Continue
        </button>
      </form>
    </section>
  );
}

function Header({ profile, userEmail, view, onView, onNotify, onTestReminder, onLogout }) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Daily Planner</p>
        <h1>{profile ? `Hello${profile.name ? `, ${profile.name}` : ""}` : "Set up your goals first"}</h1>
        <p className="accountLine">{userEmail}</p>
      </div>
      <div className="toolbar">
        {profile ? (
          <div className="segmented">
            <button className={view === "planner" ? "active" : ""} onClick={() => onView("planner")}>Planner</button>
            <button className={view === "profile" ? "active" : ""} onClick={() => onView("profile")}>Profile</button>
          </div>
        ) : null}
        <button className="iconButton" onClick={onNotify} title="Enable browser notifications" aria-label="Enable notifications">
          <Bell size={19} />
        </button>
        <button className="secondary" onClick={onTestReminder}>
          <Mail size={17} />
          Test reminder
        </button>
        <button className="iconButton" onClick={onLogout} title="Log out" aria-label="Log out">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}

function ProfileEditor({ profile, userEmail, onSave, mode = "edit" }) {
  const [name, setName] = React.useState(profile?.name || "");
  const [email, setEmail] = React.useState(profile?.email || userEmail || "");
  const [timezone, setTimezone] = React.useState(profile?.timezone || "Asia/Kolkata");
  const [goals, setGoals] = React.useState(profile?.goals?.length ? profile.goals : [
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
    onSave({ name, email, timezone, goals, memory: profile?.memory || [] });
  }

  return (
    <section className={mode === "setup" ? "setup" : "profileEdit"}>
      {mode === "setup" ? (
        <div className="panel introPanel">
          <Target size={26} />
          <h2>Profile setup</h2>
          <p>Define your goals, what achievement looks like, deadlines, and priorities. The AI memory and insights will build from your daily reviews.</p>
        </div>
      ) : null}
      <form className="panel formPanel" onSubmit={submit}>
        <div className="fieldGrid">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
          </label>
          <label>
            Email for login and reminders
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
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
              <input value={goal.title} onChange={(event) => updateGoal(index, { title: event.target.value })} placeholder="Lose weight" required />
            </label>
            <label>
              Achievement criteria
              <textarea value={goal.achievement} onChange={(event) => updateGoal(index, { achievement: event.target.value })} placeholder="Lose 6kg while keeping energy stable" required />
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

function ProfileSection({ profile, insights, onSave }) {
  return (
    <section className="profileSection">
      <ProfileEditor profile={profile} onSave={onSave} />
      <div className="profileSide">
        <div className="panel">
          <div className="sectionTitle">
            <Brain size={20} />
            <h2>Memory</h2>
          </div>
          <div className="memoryList">
            {profile.memory?.length ? profile.memory.map((item, index) => (
              <p key={`${item}-${index}`}>{item}</p>
            )) : <p className="muted">Memory builds from end-of-day reviews and logged patterns.</p>}
          </div>
        </div>
        <div className="panel">
          <div className="sectionTitle">
            <Lightbulb size={20} />
            <h2>Insights</h2>
          </div>
          <div className="insightList">
            {insights.length ? insights.map((insight) => (
              <article className="insight" key={insight.id}>
                <time>{insight.date}</time>
                <p>{insight.insight}</p>
              </article>
            )) : <p className="muted">Insights are added after daily reviews.</p>}
          </div>
        </div>
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

async function fetchJson(path, options = {}, userEmail = "") {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (userEmail) headers["X-Planner-User"] = userEmail;
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}

createRoot(document.getElementById("root")).render(<App />);
