import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

const app = express();
const PORT = 3001;

const DATA_DIR = path.join(__dirname, '../shared');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const PRICING_FILE = path.join(DATA_DIR, 'pricing.json');
const MODELS_FILE = path.join(DATA_DIR, 'models.json');

app.use(cors());
app.use(express.json());
app.use('/agents', express.static(path.join(__dirname, '../canopy/public/agents')));

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

    res.json({
      compiledImageUrl: `https://placehold.co/600x400/${(parsedParams.robeColor || '#218380').replace('#', '')}/FFFFFF.png?text=Generated+Concept:+${encodeURIComponent(prompt.substring(0, 15))}`,
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

// --- BACKGROUND PRICING CRON ---
async function syncPricing() {
  console.log("Syncing LLM pricing from LiteLLM...");
  try {
    const res = await fetch("https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json");
    if (!res.ok) throw new Error("Failed to fetch LiteLLM pricing");
    const data = await res.json();
    
    // Ensure backwards compatibility with simple pricing map for older rust backends
    const mappedPricing = {
      "claude-4-6-sonnet": { in: (data["claude-3-5-sonnet-20240620"]?.input_cost_per_token || 0.000003) * 1000000, out: (data["claude-3-5-sonnet-20240620"]?.output_cost_per_token || 0.000015) * 1000000 },
      "gpt-4o-mini": { in: (data["gpt-4o-mini"]?.input_cost_per_token || 0.00000015) * 1000000, out: (data["gpt-4o-mini"]?.output_cost_per_token || 0.0000006) * 1000000 },
      "gpt-4o": { in: (data["gpt-4o"]?.input_cost_per_token || 0.000005) * 1000000, out: (data["gpt-4o"]?.output_cost_per_token || 0.000015) * 1000000 },
      "gemini-1.5-pro": { in: (data["gemini-1.5-pro"]?.input_cost_per_token || 0.0000035) * 1000000, out: (data["gemini-1.5-pro"]?.output_cost_per_token || 0.0000105) * 1000000 },
      "gemini-1.5-flash": { in: (data["gemini-1.5-flash"]?.input_cost_per_token || 0.00000035) * 1000000, out: (data["gemini-1.5-flash"]?.output_cost_per_token || 0.00000105) * 1000000 }
    };
    fs.writeFileSync(PRICING_FILE, JSON.stringify(mappedPricing, null, 2), "utf8");

    // NEW: Comprehensive Model UI & Strategy structure compiled here from Oracle
    const modelStrategies = {
      models: [
        { id: "gpt-4o-mini", provider: "OpenAI", name: "GPT-4o-mini", description: "Fast & Light", costIn: mappedPricing["gpt-4o-mini"].in, costOut: mappedPricing["gpt-4o-mini"].out, strategy: "light" },
        { id: "claude-4-6-sonnet", provider: "Anthropic", name: "Claude 4.6 Sonnet", description: "Powerful & Deep", costIn: mappedPricing["claude-4-6-sonnet"].in, costOut: mappedPricing["claude-4-6-sonnet"].out, strategy: "heavy" },
        { id: "gpt-4o", provider: "OpenAI", name: "GPT-4o", description: "Versatile & Robust", costIn: mappedPricing["gpt-4o"].in, costOut: mappedPricing["gpt-4o"].out, strategy: "heavy" },
        { id: "gemini-1.5-pro", provider: "Google Gemini", name: "Gemini 1.5 Pro", description: "High Context", costIn: mappedPricing["gemini-1.5-pro"].in, costOut: mappedPricing["gemini-1.5-pro"].out, strategy: "heavy" },
        { id: "gemini-1.5-flash", provider: "Google Gemini", name: "Gemini 1.5 Flash", description: "Rapid Inference", costIn: mappedPricing["gemini-1.5-flash"].in, costOut: mappedPricing["gemini-1.5-flash"].out, strategy: "light" }
      ],
      strategies: {
        heavy: ["Researcher", "Coder", "Architect", "Financial", "Accountant", "Business Strategist", "Investment Manager", "Strategist", "Engineer", "Data Analyst"],
        defaultHeavyModel: "claude-4-6-sonnet",
        defaultLightModel: "gpt-4o-mini"
      }
    };
    fs.writeFileSync(MODELS_FILE, JSON.stringify(modelStrategies, null, 2), "utf8");
    
    console.log("Successfully synced local pricing.json and models.json oracles!");
  } catch(e) {
    console.error("Pricing sync failed:", e);
  }
}

// Sync on boot, then every 24 hours
syncPricing();
setInterval(syncPricing, 24 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Admin Server API running on http://localhost:${PORT}`);
});
