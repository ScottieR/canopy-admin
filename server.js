import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse simple .env without heavy dependencies
let GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const keyMatch = envContent.match(/^GEMINI_API_KEY=(.+)$/m);
    if (keyMatch) GEMINI_API_KEY = keyMatch[1].trim().replace(/^["']|["']$/g, '');
  }
} catch (e) {
  console.warn("Could not load .env file:", e);
}

let MESHY_API_KEY = process.env.MESHY_API_KEY || '';
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const keyMatch = envContent.match(/^MESHY_API_KEY=(.+)$/m);
    if (keyMatch) MESHY_API_KEY = keyMatch[1].trim().replace(/^["']|["']$/g, '');
  }
} catch (e) {
  // Silent
}

const upload = multer({ dest: '/tmp/uploads/' });

const app = express();
const PORT = 3001;

const DATA_DIR = path.join(__dirname, '../shared');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const PRICING_FILE = path.join(DATA_DIR, 'pricing.json');
const MODELS_FILE = path.join(DATA_DIR, 'models.json');
const ACCESSORIES_FILE = path.join(DATA_DIR, 'accessories.json');

// --- Seed Default Accessories if missing ---
if (!fs.existsSync(ACCESSORIES_FILE)) {
  const defaultAccs = { items: {}, defaults: {} };
  for(let s=1; s<=6; s++) {
    for(let i=1; i<=25; i++) {
       const key = `/accessories/accessories_set_${s}_item_${String(i).padStart(2, '0')}.png`;
       defaultAccs.items[key] = { isVisible: true };
    }
  }
  // Base Defaults
  defaultAccs.defaults = {
    "Coder": ["/accessories/accessories_set_6_item_22.png", "/accessories/accessories_set_1_item_04.png"],
    "Researcher": ["/accessories/accessories_set_4_item_11.png"],
    "Accountant": ["/accessories/accessories_set_2_item_18.png"]
  };
  fs.writeFileSync(ACCESSORIES_FILE, JSON.stringify(defaultAccs, null, 2), 'utf8');
}

app.use(cors());
app.use(express.json());
app.use('/agents', express.static(path.join(__dirname, '../canopy/public/agents')));
app.use('/accessories', express.static(path.join(__dirname, '../canopy/public/accessories')));

// Helper to create CRUD routes for a given file
function createJsonApi(routePath, filePath) {
  app.get(routePath, (req, res) => {
    try {
      if (!fs.existsSync(filePath)) {
        return res.json(routePath === '/api/library' ? [] : {});
      }
      const data = fs.readFileSync(filePath, 'utf8');
      res.json(JSON.parse(data));
    } catch (error) {
      console.error(`Error reading ${filePath}:`, error);
      res.status(500).json({ error: 'Failed to read data' });
    }
  });

  app.post(routePath, (req, res) => {
    try {
      const newData = req.body;
      fs.writeFileSync(filePath, JSON.stringify(newData, null, 2), 'utf8');
      res.json({ success: true });
    } catch (error) {
      console.error(`Error writing ${filePath}:`, error);
      res.status(500).json({ error: 'Failed to save data' });
    }
  });
}

// --- GENERATION ENDPOINT (IP PROTECTED) ---
const MONUMENT_VALLEY_PROMPT = `
Global Aesthetic & Rendering Parameters
To capture the specific "Monument Valley" feel across all assets, every prompt should include these baseline rendering instructions:
Camera/Perspective: Strict isometric perspective (30-degree angle, parallel projection). No perspective distortion or vanishing points.
Lighting: Soft, diffused, multi-directional lighting. No harsh, cast shadows or high-contrast highlights. Use subtle ambient occlusion to separate overlapping shapes.
Textures: Matte, smooth, clay-like, or soft vinyl materials. Completely devoid of realistic textures (no woodgrain, no metallic sheen, no organic grittiness).
Color Palette: Bright but muted pastels (mint green, soft coral, lavender, baby blue, warm cream, butter yellow). Use soft gradient transitions on flat surfaces to create depth without relying on complex textures.

1. The Character: "The Base Lobster"
Geometry: Clean, low-poly but smoothed primitives.
Body Structure: Upright, bipedal stance. The lower half is a simplified, segmented lobster tail that acts as the "legs/base." A blocky or slightly rounded cylindrical main torso.
Appendages: Two smooth, oversized claw arms.
Face: Minimalist. Just two simple, recessed or dark-colored dots for eyes.
Base Color: Neutral, soft terracotta, pale clay, or muted peach.

2. Accessories & Props
Styling: "Chunky," iconographic, and oversized.
Detailing: Strip away realistic details.

3. Habitats & Environments
Bases: For individual neighborhoods: A floating square or hexagonal isometric tile.
`;

function hashStringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
  return '#' + '00000'.substring(0, 6 - c.length) + c;
}

app.post('/api/generate', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

  console.log("Protected Generation Request for:", prompt);

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY missing from .env' });
  }

  const injectedPrompt = `${MONUMENT_VALLEY_PROMPT}

REQUESTED SUBJECT & ACTION:
${prompt}

Output ONLY a raw JSON object (no markdown tags, no backticks) with exactly this structure indicating the visual properties for the 3D renderer based on the prompt's aesthetic feel:
{
  "color": "hex code matching the base lobster color based on the aesthetic",
  "robeColor": "hex code for the secondary clothing/shell",
  "accentColor": "hex code for the bright antennae/claw tips",
  "habitatColor": "hex code for the floor/habitat matching the pastel theme",
  "habitatLabel": "Short 1-2 word label for the environment (e.g., 'Chef Realm')",
  "accessories": ["/models/tophat.glb"] // Optional array of simple iconographic glb paths
}`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: injectedPrompt }] }],
        generationConfig: { temperature: 0.7 }
      })
    });

    if (!response.ok) {
       const text = await response.text();
       console.error("Gemini API Error:", text);
       return res.status(500).json({ error: "Gemini API generation failed" });
    }

    const data = await response.json();
    let textResult = data.candidates[0].content.parts[0].text.trim();
    
    // Strip possible markdown
    if (textResult.startsWith('\`\`\`')) {
      textResult = textResult.replace(/^\`\`\`(?:json)?/i, '').replace(/\`\`\`$/, '').trim();
    }

    const parsedParams = JSON.parse(textResult);

    const aestheticPrompt = `${prompt}, visually matching a cute isometric pastel 3D style monument valley game, vivid colors ${parsedParams.color}, ${parsedParams.habitatLabel}`;
    
    res.json({
      compiledImageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(aestheticPrompt)}?width=600&height=400&nologo=true`,
      dynamicParams: {
        color: parsedParams.color || "#F5E6D8",
        robeColor: parsedParams.robeColor || "#888",
        accentColor: parsedParams.accentColor || "#ccc",
        habitatColor: parsedParams.habitatColor || "#D2D6CR",
        habitatLabel: parsedParams.habitatLabel || "The Void",
        accessories: parsedParams.accessories || []
      }
    });

  } catch (error) {
    console.error("Failed to parse Gemini response:", error);
    res.status(500).json({ error: 'Failed to process AI parameters' });
  }
});

// --- DYNAMIC BOOK MODERATION ---
app.post('/api/agents/add-suggestion', async (req, res) => {
  const { role, bookTitle } = req.body;
  if (!role || !bookTitle) return res.status(400).json({ error: "Missing role or bookTitle" });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY missing" });

  const checkPrompt = `You are a strict content safety moderator for a professional AI workspace product.
The user is attempting to add a book title to a public library of suggestions.
Book title to evaluate: "${bookTitle}"
Target agent role context: "${role}"

Does this title contain obvious explicit content, racism, sexism, excessive violence, extreme political ideology (extremism), or obvious hate speech designed to be offensive? Note: standard timeless literature is usually acceptable unless explicitly controversial or notoriously banned material without merit.
Reply ONLY with the exact word "YES" if it is controversial/offensive/unsafe.
Reply ONLY with the exact word "NO" if it is safe and appropriate to suggest.`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: checkPrompt }] }],
        generationConfig: { temperature: 0.1 }
      })
    });

    if (!response.ok) return res.status(500).json({ error: "Gemini API failed" });
    const data = await response.json();
    let result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase();

    if (result && result.includes("YES")) {
       return res.status(403).json({ error: "Book rejected as unsafe" });
    }

    if (fs.existsSync(AGENTS_FILE)) {
      let agents = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
      if (agents[role]) {
        if (!agents[role].library) agents[role].library = [];
        
        // Deduplicate
        const existing = agents[role].library.find(b => b.title.toLowerCase() === bookTitle.toLowerCase());
        if (!existing) {
          agents[role].library.unshift({ title: bookTitle, author: "Unknown", mode: "Cultural Reference" });
          fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2), "utf8");
        }
      }
    }
    return res.json({ success: true, message: "Added successfully" });
  } catch (e) {
    console.error("Book moderation failed:", e);
    return res.status(500).json({ error: "Moderation connection failed" });
  }
});

// --- DYNAMIC COMPANION TELEMETRY ---
let latestTelemetryPayload = "";
app.post('/api/telemetry/target', (req, res) => {
   if (req.body && req.body.domText) {
      latestTelemetryPayload = req.body.domText;
   }
   res.json({ success: true });
});

app.post('/api/analyze-screen', async (req, res) => {
   if (!GEMINI_API_KEY) return res.status(500).json({ error: "Missing config" });
   if (!latestTelemetryPayload) return res.json({ instruction: "Waiting for the browser to load..." });

   const checkPrompt = `You are a helpful software setup companion UI. The user is currently configuring their Slack App Integration.
Based on the raw text scraped from their current screen (below), determine EXACTLY what they need to do next. 
If they are on the Workspace Selection screen, tell them to select a workspace. 
If they are on the manifest review screen, tell them to hit 'Next' or 'Create'.
If they are on the App-Level Tokens screen, explain how to generate it with the connections:write scope.
If they are on the Bot Token screen (Install App), explain how to grab the xoxb- token.

Rules:
- Give ONE single instruction block. Keep it under 2 sentences. No markdown formatting.

Raw Screen Text:
"""
${latestTelemetryPayload.substring(0, 8000)}
"""`;

   try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: checkPrompt }] }],
        generationConfig: { temperature: 0.1 }
      })
    });
    const data = await response.json();
    let result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "Analyzing screen...";
    return res.json({ instruction: result });
   } catch (e) {
      return res.json({ instruction: "Connection temporarily lost." });
   }
});
createJsonApi('/api/agents', AGENTS_FILE);
createJsonApi('/api/library', LIBRARY_FILE);
createJsonApi('/api/settings', SETTINGS_FILE);
createJsonApi('/api/stats', STATS_FILE);
createJsonApi('/api/pricing', PRICING_FILE);
createJsonApi('/api/models', MODELS_FILE);
createJsonApi('/api/accessories', ACCESSORIES_FILE);

// --- BACKGROUND PRICING & MODELS CRON ---
async function syncPricingAndModels() {
  console.log("Syncing LLM pricing from LiteLLM and Models from Providers...");
  try {
    const res = await fetch("https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json");
    if (!res.ok) throw new Error("Failed to fetch LiteLLM pricing");
    const data = await res.json();
    
    // All model IDs use "provider/model-name" format matching OpenClaw's expectation.
    // LiteLLM pricing keys use the bare model name (no prefix), so we look them up
    // by bare name but store results under the prefixed key.
    const litellmPrice = (bareKey, fallbackIn, fallbackOut) => ({
      in:  (data[bareKey]?.input_cost_per_token  || fallbackIn)  * 1000000,
      out: (data[bareKey]?.output_cost_per_token || fallbackOut) * 1000000,
    });

    const mappedPricing = {
      "anthropic/claude-sonnet-4-6":        litellmPrice("claude-sonnet-4-6",        0.000003,    0.000015),
      "anthropic/claude-haiku-4-5-20251001": litellmPrice("claude-haiku-4-5-20251001",0.0000008,   0.000004),
      "anthropic/claude-opus-4-6":           litellmPrice("claude-opus-4-6",           0.000015,    0.000075),
      "openai/gpt-4o":                       litellmPrice("gpt-4o",                    0.0000025,   0.00001),
      "openai/gpt-4o-mini":                  litellmPrice("gpt-4o-mini",               0.00000015,  0.0000006),
      "openai/o4-mini":                      litellmPrice("o4-mini",                   0.0000011,   0.0000044),
      "xai/grok-beta":                       litellmPrice("grok-beta",                 0.000005,    0.000015),
    };

    let modelList = [
      { id: "anthropic/claude-sonnet-4-6",        provider: "Anthropic",     name: "Claude Sonnet 4.6",  description: "Fast & highly capable",      costIn: mappedPricing["anthropic/claude-sonnet-4-6"].in,        costOut: mappedPricing["anthropic/claude-sonnet-4-6"].out,        strategy: "heavy" },
      { id: "anthropic/claude-haiku-4-5-20251001", provider: "Anthropic",    name: "Claude Haiku 4.5",   description: "Fastest Anthropic model",     costIn: mappedPricing["anthropic/claude-haiku-4-5-20251001"].in, costOut: mappedPricing["anthropic/claude-haiku-4-5-20251001"].out, strategy: "light" },
      { id: "anthropic/claude-opus-4-6",           provider: "Anthropic",    name: "Claude Opus 4.6",    description: "Most capable Anthropic",      costIn: mappedPricing["anthropic/claude-opus-4-6"].in,           costOut: mappedPricing["anthropic/claude-opus-4-6"].out,           strategy: "heavy" },
      { id: "openai/gpt-4o",                       provider: "OpenAI",       name: "GPT-4o",             description: "Flagship multimodal",         costIn: mappedPricing["openai/gpt-4o"].in,                       costOut: mappedPricing["openai/gpt-4o"].out,                       strategy: "heavy" },
      { id: "openai/gpt-4o-mini",                  provider: "OpenAI",       name: "GPT-4o Mini",        description: "Fast & affordable",           costIn: mappedPricing["openai/gpt-4o-mini"].in,                  costOut: mappedPricing["openai/gpt-4o-mini"].out,                  strategy: "light" },
      { id: "openai/o4-mini",                      provider: "OpenAI",       name: "o4-mini",            description: "Fast reasoning model",        costIn: mappedPricing["openai/o4-mini"].in,                      costOut: mappedPricing["openai/o4-mini"].out,                      strategy: "heavy" },
      { id: "xai/grok-beta",                       provider: "xAI",          name: "Grok Beta",          description: "Real-time web access",        costIn: mappedPricing["xai/grok-beta"].in,                       costOut: mappedPricing["xai/grok-beta"].out,                       strategy: "heavy" },
    ];

    // ── Gemini model list — source of truth: https://ai.google.dev/gemini-api/docs/deprecations ──
    //
    // Strategy: fetch the deprecations page to build a live blocklist of deprecated/shutdown
    // model IDs, then use our canonical known-good list filtered through that blocklist.
    // This is deterministic: the deprecations page is always the authority, not our assumptions.

    // Step 1: Fetch the deprecations page and extract deprecated/shutdown bare model IDs.
    let deprecatedBareNames = new Set();
    try {
      console.log("Fetching Gemini deprecations page for authoritative model status...");
      const depRes = await fetch("https://ai.google.dev/gemini-api/docs/deprecations");
      if (depRes.ok) {
        const depHtml = await depRes.text();
        // Extract model IDs from the page — they appear as gemini-X.X-xxx patterns in code/table cells.
        // We extract ALL mentions, then only treat ones in "Deprecated" or "Shutdown" context as blocked.
        // Simple heuristic: any gemini-* bare name that appears near "Deprecated" within 500 chars.
        const deprecatedSection = depHtml.replace(/<[^>]+>/g, ' '); // strip HTML tags
        // Find lines/blocks containing "Deprecated" or "shutdown" date columns
        const modelPattern = /gemini-[\w.\-]+/gi;
        const allMatches = [...deprecatedSection.matchAll(modelPattern)].map(m => m[0].toLowerCase());
        // Known stable models from the deprecations page (not in the deprecated section)
        const knownStable = new Set([
          "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash-image",
          "gemini-2.5-pro",
          "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview",
          "gemini-3.1-flash-image-preview", "gemini-3.1-pro-preview",
          "gemini-3.1-flash-live-preview", "gemini-3.1-flash-tts-preview",
        ]);
        // Anything returned by the page that is NOT in knownStable is suspect — add to blocklist.
        // This catches dated previews like -preview-04-17, -preview-05-06 etc.
        for (const name of new Set(allMatches)) {
          if (!knownStable.has(name) && name.startsWith("gemini-")) {
            deprecatedBareNames.add(name);
          }
        }
        console.log(`Deprecations page parsed. Blocking ${deprecatedBareNames.size} deprecated/unknown model IDs.`);
      }
    } catch (e) {
      console.warn("Could not fetch deprecations page — proceeding with hardcoded blocklist:", e.message);
      // Hardcoded blocklist based on deprecations page read April 2026
      for (const name of [
        "gemini-2.0-flash", "gemini-2.0-flash-001", "gemini-2.0-flash-lite",
        "gemini-2.0-flash-lite-001", "gemini-2.0-flash-lite-preview",
        "gemini-2.0-flash-lite-preview-02-05", "gemini-2.0-flash-preview-image-generation",
        "gemini-2.5-flash-preview-04-17", "gemini-2.5-flash-preview-05-20",
        "gemini-2.5-flash-preview-09-25", "gemini-2.5-flash-lite-preview-09-2025",
        "gemini-2.5-flash-image-preview",
        "gemini-2.5-pro-preview-03-25", "gemini-2.5-pro-preview-05-06", "gemini-2.5-pro-preview-06-05",
        "gemini-3-pro-preview",
      ]) { deprecatedBareNames.add(name); }
    }

    // Step 2: Canonical Gemini model list — stable + preview, per deprecations page.
    // Costs are estimates; the live Google API fetch below will overwrite with real pricing.
    const CANONICAL_GEMINI = [
      // Gemini 3.x — Preview, no shutdown date announced
      { bare: "gemini-3-flash-preview",        name: "Gemini 3 Flash",        strategy: "light",  costIn: 0.15,  costOut: 0.6,  description: "Preview — successor to 2.5 Flash" },
      { bare: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite", strategy: "light",  costIn: 0.075, costOut: 0.3,  description: "Preview — successor to 2.5 Flash Lite" },
      { bare: "gemini-3.1-pro-preview",        name: "Gemini 3.1 Pro",        strategy: "heavy",  costIn: 1.25,  costOut: 5.0,  description: "Preview — successor to 2.5 Pro" },
      // Gemini 2.5 — Stable GA, shutdown not before June 2026
      { bare: "gemini-2.5-flash",              name: "Gemini 2.5 Flash",      strategy: "light",  costIn: 0.15,  costOut: 0.6,  description: "Stable — recommended default" },
      { bare: "gemini-2.5-flash-lite",         name: "Gemini 2.5 Flash Lite", strategy: "light",  costIn: 0.075, costOut: 0.3,  description: "Stable — fastest/cheapest" },
      { bare: "gemini-2.5-pro",                name: "Gemini 2.5 Pro",        strategy: "heavy",  costIn: 1.25,  costOut: 10.0, description: "Stable — flagship model" },
    ];

    // Step 3: Fetch live pricing from Google API (if key available) to update costs.
    // Filter any model the deprecations page marks as deprecated/shutdown.
    if (GEMINI_API_KEY) {
      try {
        console.log("Fetching live Gemini models from Google API for pricing update...");
        const gmRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
        if (gmRes.ok) {
          const gmData = await gmRes.json();
          for (const m of (gmData.models || [])) {
            const bareName = m.name.replace("models/", "");
            // Skip anything deprecated, non-generative, or not a text/chat model
            if (deprecatedBareNames.has(bareName)) continue;
            if (!m.supportedGenerationMethods?.includes("generateContent")) continue;
            if (bareName.includes("embedding") || bareName.includes("aqa") ||
                bareName.includes("tts") || bareName.includes("image") ||
                bareName.includes("live") || bareName.includes("robotics") ||
                bareName.includes("computer-use")) continue;
            // Update pricing in canonical list if this model is there
            const canonical = CANONICAL_GEMINI.find(c => c.bare === bareName);
            if (canonical) {
              const costIn  = (data[`gemini/${bareName}`]?.input_cost_per_token  || data[bareName]?.input_cost_per_token)  * 1000000;
              const costOut = (data[`gemini/${bareName}`]?.output_cost_per_token || data[bareName]?.output_cost_per_token) * 1000000;
              if (costIn)  canonical.costIn  = costIn;
              if (costOut) canonical.costOut = costOut;
            }
          }
        }
      } catch (e) {
        console.warn("Live Gemini pricing fetch failed — using estimate costs:", e.message);
      }
    }

    // Step 4: Add canonical Gemini models to the list (skip any blocked by deprecations page).
    for (const { bare, name, strategy, costIn, costOut, description } of CANONICAL_GEMINI) {
      if (deprecatedBareNames.has(bare)) {
        console.warn(`Skipping ${bare} — marked deprecated/unknown on deprecations page`);
        continue;
      }
      const fullId = `google/${bare}`;
      mappedPricing[fullId] = { in: costIn, out: costOut };
      modelList.push({ id: fullId, provider: "Google Gemini", name, description, costIn, costOut, strategy });
    }

    fs.writeFileSync(PRICING_FILE, JSON.stringify(mappedPricing, null, 2), "utf8");

    // Defaults: stable 2.5 Flash as the safe default; 2.5 Pro for heavy tasks.
    // (Not 3.x preview — those require LiteLLM container support confirmation first.)
    const PREFERRED_HEAVY = "anthropic/claude-sonnet-4-6";
    const PREFERRED_LIGHT = "google/gemini-2.5-flash";
    let defaultHeavy = modelList.find(m => m.id === PREFERRED_HEAVY)?.id
      || modelList.find(m => m.id.includes("claude") && m.id.includes("sonnet"))?.id
      || modelList.find(m => m.strategy === "heavy")?.id
      || PREFERRED_HEAVY;
    let defaultLight = modelList.find(m => m.id === PREFERRED_LIGHT)?.id
      || modelList.find(m => m.id === "google/gemini-2.5-flash-lite")?.id
      || modelList.find(m => m.provider === "Google Gemini" && m.strategy === "light")?.id
      || PREFERRED_LIGHT;

    const modelStrategies = {
      models: modelList,
      strategies: {
        heavy: ["Researcher", "Coder", "Architect", "Financial", "Accountant", "Business Strategist", "Investment Manager", "Strategist", "Engineer", "Data Analyst"],
        defaultHeavyModel: defaultHeavy,
        defaultLightModel: defaultLight
      }
    };
    fs.writeFileSync(MODELS_FILE, JSON.stringify(modelStrategies, null, 2), "utf8");
    
    console.log("Successfully synced local pricing.json and dynamic models.json oracles!");
    return { success: true, count: modelList.length };
  } catch(e) {
    console.error("Pricing/Model sync failed:", e);
    return { success: false, error: e.message };
  }
}

app.post('/api/sync-models', async (req, res) => {
  const result = await syncPricingAndModels();
  res.json(result);
});

// --- NEW STUDIO ROUTES ---
app.post('/api/generate-accessories-2d', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

  const injectedPrompt = `You are a 3D prop extractor. 
Extract individual accessories/items from the following user request.
Output ONLY a JSON array of strings, where each string is a highly descriptive prompt for an isometric monument valley style 3D prop, isolated on a solid white background.
Keep them simple, blocky, pastel colored, isometric.
User Request: ${prompt}`;

  try {
    let items = [prompt];
    if (GEMINI_API_KEY) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: injectedPrompt }] }] })
      });
      if (response.ok) {
        let textResult = (await response.json()).candidates[0].content.parts[0].text.trim();
        if (textResult.startsWith('\`\`\`')) {
          textResult = textResult.replace(/^\`\`\`(?:json)?/i, '').replace(/\`\`\`$/, '').trim();
        }
        items = JSON.parse(textResult);
      }
    }
    
    // Convert to pollinations images
    const images = items.map(item => ({
      prompt: item,
      url: `https://image.pollinations.ai/prompt/${encodeURIComponent(item + ", isolated on solid pure white background, low poly primitive shapes, smooth lighting, pastel colors, 3d game asset, monument valley style, cute")}?width=512&height=512&nologo=true`
    }));
    res.json({ success: true, items: images });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Generation failed' });
  }
});

app.post('/api/meshy-task', async (req, res) => {
  const { imageUrl } = req.body;
  if (!imageUrl) return res.status(400).json({ error: 'No image URL provided' });
  if (!MESHY_API_KEY) return res.status(400).json({ error: 'MESHY_API_KEY is not configured in .env. Setup required.' });

  try {
    const response = await fetch('https://api.meshy.ai/openapi/v1/image-to-3d', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MESHY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image_url: imageUrl,
        enable_pbr: true,
      })
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Meshy API failed');
    res.json({ success: true, taskId: data.result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed to start Meshy task' });
  }
});

app.get('/api/meshy-check/:taskId', async (req, res) => {
  const { taskId } = req.params;
  if (!MESHY_API_KEY) return res.status(400).json({ error: 'MESHY_API_KEY is not configured' });

  try {
    const response = await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`, {
      headers: { 'Authorization': `Bearer ${MESHY_API_KEY}` }
    });
    const data = await response.json();
    
    if (data.status === 'SUCCEEDED') {
      const glbUrl = data.model_urls.glb;
      const download = await fetch(glbUrl);
      const buffer = Buffer.from(await download.arrayBuffer());
      const fileName = `meshy_${taskId}.glb`;
      const savePath = path.join(__dirname, '../canopy/public/accessories', fileName);
      fs.writeFileSync(savePath, buffer);
      
      if (fs.existsSync(ACCESSORIES_FILE)) {
         const accData = JSON.parse(fs.readFileSync(ACCESSORIES_FILE, 'utf8'));
         accData.items[`/accessories/${fileName}`] = { isVisible: true, generatedFrom: data.image_url };
         fs.writeFileSync(ACCESSORIES_FILE, JSON.stringify(accData, null, 2));
      }
      return res.json({ success: true, status: data.status, glbPath: `/accessories/${fileName}` });
    }
    
    res.json({ success: true, status: data.status, progress: data.progress });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Check failed' });
  }
});

app.post('/api/upload-bulk', upload.array('files'), (req, res) => {
  try {
    const uploadedFiles = [];
    if (!fs.existsSync(ACCESSORIES_FILE)) return res.status(500).json({error: 'Accessories JSON missing'});
    const accData = JSON.parse(fs.readFileSync(ACCESSORIES_FILE, 'utf8'));

    for (const file of req.files) {
       const ext = path.extname(file.originalname).toLowerCase();
       const fileName = `upload_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;
       const savePath = path.join(__dirname, '../canopy/public/accessories', fileName);
       fs.renameSync(file.path, savePath);
       
       const relativePath = `/accessories/${fileName}`;
       accData.items[relativePath] = { isVisible: true, manualUpload: true };
       uploadedFiles.push(relativePath);
    }
    
    fs.writeFileSync(ACCESSORIES_FILE, JSON.stringify(accData, null, 2));
    res.json({ success: true, files: uploadedFiles });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to upload files' });
  }
});


// Sync on boot, then every 7 days (weekly)
syncPricingAndModels();
setInterval(syncPricingAndModels, 7 * 24 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Admin Server API running on http://localhost:${PORT}`);
});
