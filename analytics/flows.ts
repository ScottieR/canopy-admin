// app-analytics kit v8: shared by every app. Only FUNNELS, FEATURES and ACTIVATION are this app's to edit.
/**
 * This app's key flows, measured by server/flow-metrics.ts and reported under
 * `flows` in /api/stats. See the skill's references/app-metrics.md.
 */
import type { Activation, Feature, Funnel } from "./server/flow-metrics";

/**
 * Ordered journeys: each step is an event, optionally narrowed by screen (`path`) or props (`where`).
 *
 * The add-agent wizard is Canopy's one multi-step journey, and a new install opens straight into it.
 * Naming the agent, its look, the brain and skills detours and the channel step can all be skipped or
 * are reached only by choice, so they aren't steps here. (Declared 2026-10-12.)
 */
export const FUNNELS: Funnel[] = [
  {
    key: "onboarding",
    label: "First agent",
    steps: [
      { key: "wizard", label: "Opened the wizard", event: "pageview", path: "/onboarding" },
      { key: "discovery", label: "Said what they need", event: "onboarding_step_completed", where: { step: "discovery" } },
      { key: "powerup", label: "Finished power-up", event: "onboarding_step_completed", where: { step: "powerup" } },
      { key: "deployed", label: "Deployed the agent", event: "agent_created" },
      { key: "first_reply", label: "Got a first reply", event: "reply_received" },
    ],
  },
];

/** Key features: one event each (narrowed with `path` or `where` if needed). `dayProp` is for daily habits. */
export const FEATURES: Feature[] = [
  { key: "agents", label: "Agents", event: "agent_created" },
  { key: "chat", label: "Agent chat", event: "reply_received" },
  { key: "forums", label: "Forums", event: "forum_created" },
  { key: "connections", label: "Skills & Access", event: "connection_added" },
  { key: "companions", label: "Shared agents", event: "companion_paired" },
  { key: "publishing", label: "Published pages", event: "artifact_published" },
];

/**
 * The one event that means a new person got what the app is for: their agent answered them.
 * The stats then show how many new users reach it, how fast, and whether those who
 * do on their first day come back more than those who don't.
 */
export const ACTIVATION: Activation | null = { label: "Got a reply from an agent", event: "reply_received" };
