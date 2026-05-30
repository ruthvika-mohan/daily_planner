import OpenAI from "openai";

export async function generateDailySummary({ profile, entries, date }) {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackSummary({ profile, entries, date });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You are a concise daily planning coach. Return practical, kind advice based only on the provided profile goals and activity log.",
      },
      {
        role: "user",
        content: JSON.stringify({ profile, entries, date }, null, 2),
      },
    ],
  });

  return response.output_text;
}

function fallbackSummary({ profile, entries, date }) {
  if (!entries.length) {
    return `No activity was logged for ${date}. Tomorrow, start with one check-in before beginning deep work so the system has a useful baseline.`;
  }

  const goalText = profile?.goals?.map((goal) => goal.title).filter(Boolean).join(", ") || "your goals";
  const activities = entries.map((entry) => entry.activity).join(" ");
  const focusedEntries = entries.filter((entry) =>
    profile?.goals?.some((goal) => activities.toLowerCase().includes(goal.title.toLowerCase().split(" ")[0])),
  );

  return [
    `You logged ${entries.length} check-ins for ${date}.`,
    focusedEntries.length
      ? `Some work appears connected to ${goalText}. Keep placing goal-related work earlier in the day.`
      : `I did not see a clear connection to ${goalText}. Pick one goal and schedule the first hour around it tomorrow.`,
    "Recommendation: write the next concrete action before bed, then use the first hourly check-in to confirm you started it.",
  ].join("\n\n");
}
