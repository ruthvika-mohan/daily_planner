import OpenAI from "openai";

export async function generateDailyReview({ profile, entries, date }) {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackReview({ profile, entries, date });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [
            "You are a direct, evidence-based daily goals coach.",
            "Be honest about whether the user's day helped or hurt their stated goals.",
            "Do not over-praise. If the day was weak for a goal, say that plainly but constructively.",
            "Do not give generic wellness advice. Every suggestion must connect to logged activities, constraints, timing, energy, or missed opportunities from the day.",
            "Never suggest obvious advice like 'eat more protein' unless the log specifically mentions food/protein/calories and the advice is contextual.",
            "If the day appears busy, suggest low-friction alternatives such as a 10-minute walk, pre-decided meal, ordering a goal-aligned option, or moving the workout to a known open window.",
            "Return valid JSON only with keys: summary, insight, memory.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            date,
            goals: profile?.goals || [],
            existingMemory: Array.isArray(profile?.memory) ? profile.memory : [],
            entries,
            outputRequirements: {
              summary:
                "A concise review with headings: Goal score, What helped, What hurt, Best adjustment for tomorrow. Include a 0-10 score for progress toward each goal.",
              insight:
                "One blunt but useful sentence about what today reveals about the user's behavior or constraints.",
              memory:
                "One reusable pattern about the user to remember. Empty string if there is no reliable pattern.",
            },
          }),
        },
      ],
    });

    return parseReview(response.output_text, { profile, entries, date });
  } catch (error) {
    console.error(`[llm fallback] ${error.message}`);
    return fallbackReview({ profile, entries, date });
  }
}

export async function generateDailySummary(input) {
  const review = await generateDailyReview(input);
  return review.summary;
}

function parseReview(raw, fallbackInput) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.summary && parsed?.insight !== undefined && parsed?.memory !== undefined) {
      return {
        summary: formatReviewValue(parsed.summary),
        insight: formatReviewValue(parsed.insight),
        memory: formatMemoryValue(parsed.memory),
      };
    }
  } catch {
    // Fall through to a safe review if the model returns non-JSON.
  }
  const fallback = fallbackReview(fallbackInput);
  return { ...fallback, summary: raw?.trim() || fallback.summary };
}

export function formatReviewValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map(formatReviewValue).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, entry]) => {
        const formatted = formatReviewValue(entry);
        if (!formatted) return "";
        return `${formatHeading(key)}: ${formatted}`;
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return String(value).trim();
}

function formatMemoryValue(value) {
  const formatted = formatReviewValue(value);
  return formatted.replace(/\n+/g, " ").trim();
}

function formatHeading(value) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function fallbackReview({ profile, entries, date }) {
  const goals = profile?.goals || [];
  if (!entries.length) {
    return {
      summary: [
        `Goal score: ${goals.length ? goals.map((goal) => `${goal.title}: 0/10`).join("; ") : "0/10"}`,
        "What helped: No logged activity, so there is no evidence of goal progress.",
        "What hurt: The day is invisible to the planner, which usually means the goal was not actively managed.",
        "Best adjustment for tomorrow: Log the first check-in before noon and choose one concrete action that directly supports the highest-priority goal.",
      ].join("\n\n"),
      insight: `On ${date}, there was no logged evidence of progress toward the stated goals.`,
      memory: "",
    };
  }

  const activityText = entries.map((entry) => `${entry.activity} ${entry.mood || ""}`).join(" ").toLowerCase();
  const busy = /class|meeting|work|errand|laundry|clean|commute|travel|appointment|busy/.test(activityText);
  const tired = /tired|exhausted|low|drained|sleepy/.test(activityText);

  const goalScores = goals.map((goal) => {
    const terms = [goal.title, goal.achievement]
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 3);
    const matches = terms.filter((term) => activityText.includes(term)).length;
    const score = Math.min(10, matches * 2);
    return `${goal.title}: ${score}/10`;
  });

  const adjustment = busy
    ? "Best adjustment for tomorrow: Treat busy days as requiring a fallback plan: one short workout/walk window and one pre-decided meal option before the day starts."
    : tired
      ? "Best adjustment for tomorrow: Put the goal action earlier, before energy drops, and make the minimum version small enough to do while tired."
      : "Best adjustment for tomorrow: Put one goal-linked action on the calendar and log whether it happened, not just general activity.";

  return {
    summary: [
      `Goal score: ${goalScores.length ? goalScores.join("; ") : "No goals configured"}`,
      `What helped: You logged ${entries.length} check-in${entries.length === 1 ? "" : "s"}, which gives enough signal to inspect the day.`,
      goals.some((goal) => activityText.includes(goal.title.toLowerCase().split(/\s+/)[0]))
        ? "What hurt: Some activity may relate to a goal, but the log does not clearly show completion of the goal's success criteria."
        : "What hurt: The logged day does not show clear progress against the goal success criteria.",
      adjustment,
    ].join("\n\n"),
    insight: busy
      ? `Busy-day constraint detected on ${date}; your plan needs fallback actions that fit around obligations, not ideal-day advice.`
      : `On ${date}, the log did not clearly prove progress toward the stated goal criteria.`,
    memory: busy ? "Busy days need pre-decided fallback actions for goals." : "",
  };
}
