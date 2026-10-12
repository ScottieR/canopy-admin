// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.

/**
 * What a model costs, in US dollars per million tokens, at list price.
 *
 * Checked against https://platform.claude.com/docs/en/about-claude/pricing on
 * 2026-10-05, and Google's models against https://ai.google.dev/gemini-api/docs/pricing
 * and https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing
 * on 2026-10-08 (standard tier; where an introductory price runs out, the standard one). A model that isn't listed is never treated as free: its calls are
 * costed at the highest price in this table and marked as an estimate, so the
 * totals err high until its real price is added. Look the price up on the
 * provider's own pricing page; never guess one.
 */
export interface ModelPrice {
  input: number;
  output: number;
  /** Reading a prompt from the cache */
  cacheRead: number;
  /** Writing a prompt to the 5-minute cache, and to the 1-hour cache */
  cacheWrite: number;
  cacheWrite1h: number;
}

export const AI_PRICES_CHECKED = "2026-10-05";

const claude = (input: number, output: number, cacheRead = input * 0.1): ModelPrice => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 1.25,
  cacheWrite1h: input * 2,
});

/**
 * Gemini: one rate for input (text, image, audio), one for output. Google lists no cache-write charge
 * and these apps don't use explicit caching, so cached input is costed as ordinary input (erring high).
 */
const gemini = (input: number, output: number): ModelPrice => ({ input, output, cacheRead: input, cacheWrite: input, cacheWrite1h: input });

/** Keyed by model id without its date suffix: claude-haiku-4-5-20251001 is priced as claude-haiku-4-5. */
export const AI_PRICES: Record<string, ModelPrice> = {
  "claude-fable-5-1": claude(10, 50, 0.25),
  "claude-mythos-5-1": claude(10, 50, 0.25),
  "claude-fable-5": claude(10, 50),
  "claude-mythos-5": claude(10, 50),
  "claude-opus-5-5": claude(4, 20, 0.2),
  "claude-opus-5": claude(5, 25),
  "claude-opus-4-8": claude(5, 25),
  "claude-opus-4-7": claude(5, 25),
  "claude-opus-4-6": claude(5, 25),
  "claude-opus-4-5": claude(5, 25),
  "claude-opus-4-1": claude(15, 75),
  "claude-opus-4": claude(15, 75),
  "claude-sonnet-5-5": claude(2, 10),
  "claude-sonnet-5": claude(2, 10),
  "claude-sonnet-4-6": claude(3, 15),
  "claude-sonnet-4-5": claude(3, 15),
  "claude-sonnet-4": claude(3, 15),
  "claude-haiku-4-5": claude(1, 5),
  "claude-3-5-haiku": claude(0.8, 4),
  // Standard from 2027-01-01; the introductory 0.75 / 3.75 runs to 2026-12-31 (Agent Platform pricing)
  "gemini-3.8-flash": gemini(1.5, 7.5),
  "gemini-3.5-flash-lite": gemini(0.3, 2.5),
  // Output is mostly image tokens, priced at the image-output rate (text output is 3.00)
  "gemini-3.1-flash-image": gemini(0.5, 60),
};

export interface Tokens {
  /** Input that was neither read from nor written to the cache */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** Written to the 5-minute cache, and to the 1-hour cache */
  cacheWriteTokens: number;
  cacheWrite1hTokens: number;
}

/**
 * The price for a model id, ignoring a cloud prefix (anthropic., models/), a date suffix (-20251001,
 * @20251001) and a preview or release tag (-preview, -preview-09-2026, -latest, -001). Null when it isn't listed.
 */
export function priceFor(model: string): ModelPrice | null {
  const id = model
    .toLowerCase()
    .replace(/^(anthropic\.|models\/)/, "")
    .replace(/[-@]\d{8}$/, "")
    .replace(/-(preview(-[\w-]+)?|latest|\d{3})$/, "");
  return AI_PRICES[id] ?? null;
}

const kinds = ["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h"] as const;
/** The dearest listed rate of each kind: what an unlisted model is costed at */
const HIGHEST = Object.fromEntries(kinds.map((k) => [k, Math.max(...Object.values(AI_PRICES).map((p) => p[k]))])) as unknown as ModelPrice;

/** Dollars for these tokens. `estimated` when the model has no price here and the highest listed rates were used. */
export function costOf(model: string, t: Partial<Tokens>): { usd: number; estimated: boolean } {
  const listed = priceFor(model);
  const p = listed ?? HIGHEST;
  const usd =
    ((t.inputTokens ?? 0) * p.input +
      (t.outputTokens ?? 0) * p.output +
      (t.cacheReadTokens ?? 0) * p.cacheRead +
      (t.cacheWriteTokens ?? 0) * p.cacheWrite +
      (t.cacheWrite1hTokens ?? 0) * p.cacheWrite1h) /
    1e6;
  return { usd, estimated: !listed };
}
