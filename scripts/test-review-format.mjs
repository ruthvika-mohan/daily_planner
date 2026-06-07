import { formatReviewValue, generateDailyReview } from "../server/llm.js";

const objectSummary = {
  goal_score: {
    lose_weight: "2/10",
    fde_blogs: "0/10",
  },
  what_helped: ["You logged food honestly.", "You attended class."],
  what_hurt: "No workout and calories unclear.",
  best_adjustment_for_tomorrow: {
    busy_day: "Use a 10-minute walk and a pre-decided dinner.",
  },
};

const formatted = formatReviewValue(objectSummary);
assertNoObjectObject(formatted);
assertIncludes(formatted, "Goal score:");
assertIncludes(formatted, "Lose weight: 2/10");
assertIncludes(formatted, "Best adjustment for tomorrow:");

const review = await generateDailyReview({
  date: "2026-06-07",
  profile: {
    goals: [
      {
        title: "Lose weight",
        achievement: "Goal weight 73kg; close Apple circles; eat less than 1500 calories",
        priority: "High",
      },
    ],
  },
  entries: [
    {
      activity: "Class, shortcuts, lunch with rice and no protein, activity rings steps 2076 exercise 0",
      mood: "Neutral",
    },
  ],
});

assertNoObjectObject(review.summary);
assertIncludes(review.summary, "Goal score:");
console.log("review format tests passed");

function assertNoObjectObject(value) {
  if (value.includes("[object Object]")) {
    throw new Error(`Unexpected object string in output:\n${value}`);
  }
}

function assertIncludes(value, expected) {
  if (!value.includes(expected)) {
    throw new Error(`Expected output to include "${expected}". Received:\n${value}`);
  }
}
