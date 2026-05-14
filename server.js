import express from 'express';
import FormData from 'form-data';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
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

let ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const keyMatch = envContent.match(/^ADMIN_API_KEY=(.+)$/m);
    if (keyMatch) ADMIN_API_KEY = keyMatch[1].trim().replace(/^["']|["']$/g, '');
  }
} catch (e) {
  // Silent
}

const upload = multer({ dest: '/tmp/uploads/' });

const app = express();
const PORT = process.env.PORT || 3001;

const DATA_DIR = path.join(__dirname, '../shared');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const PRICING_FILE = path.join(DATA_DIR, 'pricing.json');
const MODELS_FILE = path.join(DATA_DIR, 'models.json');
const ACCESSORIES_FILE = path.join(DATA_DIR, 'accessories.json');
const HABITATS_FILE = path.join(DATA_DIR, 'habitats.json');
const CONNECTORS_FILE = path.join(DATA_DIR, 'connectors.json');
const RELEASES_FILE = path.join(DATA_DIR, 'releases.json');
const RELEASES_DIR = path.join(__dirname, '../shared/public/releases');

// Make sure the on-disk shape exists before any request races against it.
// `releases.json` is the source of truth for the in-app updater — when a
// new build is published we write a row in here and Tauri clients pick it
// up on next launch via `GET /api/updates/:target/:currentVersion`.
if (!fs.existsSync(RELEASES_DIR)) {
  fs.mkdirSync(RELEASES_DIR, { recursive: true });
}
if (!fs.existsSync(RELEASES_FILE)) {
  fs.writeFileSync(RELEASES_FILE, JSON.stringify({ latest: null, releases: [] }, null, 2), 'utf8');
}

// --- Seed Default Accessories if missing ---
if (!fs.existsSync(ACCESSORIES_FILE)) {
  const defaultAccs = { items: {}, defaults: {} };
  for (let s = 1; s <= 6; s++) {
    for (let i = 1; i <= 25; i++) {
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

// Admin API Key Protection for write operations
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    // Whitelist endpoints that are meant for public client telemetry/ingress
    const whitelistedPaths = ['/api/usage'];
    if (whitelistedPaths.includes(req.path)) {
      return next();
    }

    // Only enforce if the key is actually set on the server
    if (ADMIN_API_KEY) {
      const userKey = req.headers['x-admin-key'] || req.query.adminKey;
      if (userKey !== ADMIN_API_KEY) {
        return res.status(401).json({ error: "Unauthorized: Admin access required" });
      }
    }
  }
  next();
});
app.use('/agents', express.static(path.join(__dirname, '../shared/public/agents')));
app.use('/models', express.static(path.join(__dirname, '../shared/public/models')));
app.use('/accessories', express.static(path.join(__dirname, '../shared/public/accessories')));
// Serve the actual update artifacts (`.tar.gz`, `.sig`) that Tauri downloads when
// applying an update. Drop new builds into `shared/public/releases/` and reference
// them by `/releases/<filename>` in `releases.json`.
app.use('/releases', express.static(RELEASES_DIR));

// Helper to create CRUD routes for a given file
if (!fs.existsSync(HABITATS_FILE)) {
  fs.writeFileSync(HABITATS_FILE, JSON.stringify([
    {
      "id": 1,
      "name": "Default Habitat 1",
      "path": "/models/habitats/Habitat_1.glb",
      "type": "glb",
      "placement": { "x": 0, "y": 0, "z": 0, "rotationY": 0 }
    }
  ], null, 2));
}

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

createJsonApi('/api/connectors', CONNECTORS_FILE);

app.post('/api/connectors/generate', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY missing from .env' });

  const aiPrompt = `You are a strict configuration generator for a React application.
The user wants to create a new integration/connector for their AI agent based on this prompt: "${prompt}"

Output ONLY a raw JSON object (no markdown tags, no backticks) with this exact structure:
{
  "id": "a short unique lowercase identifier (e.g. 'twitter')",
  "name": "The display name (e.g. 'Twitter / X')",
  "subtitle": "A short 1 sentence description of what the agent can do with it",
  "icon": "A generic lucide-react icon name in lowercase (e.g. 'twitter', 'message-circle', 'calendar', 'cloud', 'database', 'link')",
  "isGlobal": boolean (true if it connects once for the whole system, false if each agent needs its own account/connection),
  "isVisible": true,
  "needsCompanion": boolean (true if it needs an oauth/api token setup chat window),
  "type": "The connector type. Must be either 'api_token', 'oauth', or 'web_credential' (if it's a website login with username/password)"
}`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: aiPrompt }] }],
        generationConfig: { temperature: 0.2 }
      })
    });

    if (!response.ok) return res.status(500).json({ error: "Gemini API failed" });
    const data = await response.json();
    let textResult = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "{}";

    if (textResult.startsWith('\`\`\`')) {
      textResult = textResult.replace(/^\`\`\`(?:json)?/i, '').replace(/\`\`\`$/, '').trim();
    }

    const newConnector = JSON.parse(textResult);

    // Save to connectors.json
    let connectors = [];
    if (fs.existsSync(CONNECTORS_FILE)) {
      connectors = JSON.parse(fs.readFileSync(CONNECTORS_FILE, 'utf8'));
    }
    connectors.push(newConnector);
    fs.writeFileSync(CONNECTORS_FILE, JSON.stringify(connectors, null, 2), 'utf8');

    // If needsCompanion is true, we scaffold a companion window component
    if (newConnector.needsCompanion) {
      const companionName = newConnector.id.charAt(0).toUpperCase() + newConnector.id.slice(1) + 'Companion.tsx';
      const companionPath = path.join(__dirname, '../canopy/src/components/Companion', companionName);
      if (!fs.existsSync(companionPath)) {
        const template = `import { useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export function \${companionName.replace('.tsx','')} () {
  const searchParams = new URLSearchParams(window.location.search);
  const agentId = searchParams.get("agentId") || "global";
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<"idle"|"testing"|"success"|"error">("idle");

  const handleConnect = async () => {
     setStatus("testing");
     try {
       await invoke("store_batch_secrets_cmd", {
         secrets: { [\`agent_\${agentId}_\${newConnector.id}_token\`]: token }
       });
       setStatus("success");
       setTimeout(async () => {
          await emit("companion-finished", { type: "\${newConnector.id}" });
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          await getCurrentWindow().close();
       }, 2000);
     } catch (e) {
       setStatus("error");
     }
  };

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", background: "var(--surface-card)", minHeight: "100vh", color: "var(--text-main)" }}>
      <h2 style={{marginTop: 0}}>Setup \${newConnector.name}</h2>
      <p style={{fontSize: 13, color: "var(--text-sub)", marginBottom: 24}}>\${newConnector.subtitle}</p>
      
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>API Token</label>
        <input 
          type="password"
          value={token}
          onChange={e => setToken(e.target.value)}
          style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border-subtle)", boxSizing: "border-box" }}
        />
      </div>

      <button 
        onClick={handleConnect}
        disabled={!token || status === "testing" || status === "success"}
        style={{ width: "100%", padding: "10px", background: status === "success" ? "#34A853" : "#3c6663", color: "white", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer" }}
      >
        {status === "idle" ? "Connect" : status === "testing" ? "Connecting..." : status === "success" ? "Connected!" : "Failed - Try Again"}
      </button>
    </div>
  );
}
`;
        fs.writeFileSync(companionPath, template, 'utf8');
      }
    }

    res.json(newConnector);
  } catch (error) {
    console.error("Failed to generate connector:", error);
    res.status(500).json({ error: 'Failed to process AI request' });
  }
});

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
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`, {
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
import Database from 'better-sqlite3';

function getProvider(modelId) {
  if (!modelId) return 'other';
  const mid = modelId.toLowerCase();
  if (mid.includes('gpt')) return 'openai';
  if (mid.includes('claude')) return 'anthropic';
  if (mid.includes('gemini')) return 'google';
  if (mid.includes('grok')) return 'xai';
  return 'other';
}

function getRealStats() {
  const dbPath = path.join(os.homedir(), 'Library/Application Support/Canopy/canopy.db');
  console.log(`[TELEMETRY] Querying database at: ${dbPath}`);

  try {
    if (!fs.existsSync(dbPath)) {
      console.error(`[TELEMETRY] Database file NOT FOUND at: ${dbPath}`);
      return null;
    }
    const db = new Database(dbPath, { readonly: true });

    // 1. Active agents today
    const todayStr = new Date().toISOString().split('T')[0];
    const activeAgentsRow = db.prepare(`
      SELECT count(DISTINCT c.agent_id) as count
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.timestamp LIKE ?
    `).get(`${todayStr}%`);

    // 1b. Total agents created (ever)
    const totalCreatedRow = db.prepare(`SELECT count(*) as count FROM agents`).get();

    // 1c. Total agents active (not deleted or paused)
    const totalActiveRow = db.prepare(`SELECT count(*) as count FROM agents WHERE status = 'active' AND paused = 0`).get();

    // 2. Token usage by provider (7 days)
    const tokenUsageData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().split('T')[0];
      const dayLabel = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];

      const usageRows = db.prepare(`
        SELECT c.agent_id, a.personality_json, SUM(length(m.content)) as char_count
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        LEFT JOIN agents a ON c.agent_id = a.id
        WHERE m.timestamp LIKE ?
        GROUP BY c.agent_id
      `).all(`${dayStr}%`);

      const dayUsage = { day: dayLabel, google: 0, openai: 0, anthropic: 0, xai: 0, other: 0 };
      usageRows.forEach(row => {
        let provider = 'other';
        if (row.personality_json) {
          try {
            const personality = JSON.parse(row.personality_json);
            provider = getProvider(personality.active_model || personality.model);
          } catch (e) { }
        }
        const tokens = Math.floor(parseInt(row.char_count || 0, 10) / 4);
        dayUsage[provider] += tokens;
      });
      tokenUsageData.push(dayUsage);
    }

    // 3. Persona Adoption (Downloads vs Usage)
    const usageByPersona = db.prepare(`
      SELECT a.role as name, COUNT(m.id) as count
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      JOIN agents a ON c.agent_id = a.id
      GROUP BY a.role
      ORDER BY count DESC
    `).all();

    const downloadsByPersona = db.prepare(`
      SELECT role as name, count(*) as count
      FROM agents
      GROUP BY role
      ORDER BY count DESC
    `).all();

    db.close();
    const activeCount = parseInt(activeAgentsRow?.count || 0, 10);
    console.log(`[TELEMETRY] Extracted usage for ${todayStr}. Active: ${activeCount}`);

    return {
      activeAgentsDaily: activeCount,
      totalAgentsCreated: parseInt(totalCreatedRow?.count || 0, 10),
      totalAgentsActive: parseInt(totalActiveRow?.count || 0, 10),
      tokenUsageData,
      personaAdoptionData: { usage: usageByPersona, downloads: downloadsByPersona },
      lastSync: new Date().toISOString()
    };
  } catch (e) {
    console.error("[TELEMETRY] Fatal error querying Canopy database:", e);
    return null;
  }
}

app.get('/api/stats', (req, res) => {
  const real = getRealStats();
  if (real) return res.json(real);

  // If we get here, DB is missing or failed - return empty real structure
  res.status(503).json({
    error: "Canopy database unreachable",
    tokenUsageData: [],
    personaAdoptionData: { usage: [], downloads: [] }
  });
});
createJsonApi('/api/pricing', PRICING_FILE);
createJsonApi('/api/models', MODELS_FILE);
createJsonApi('/api/accessories', ACCESSORIES_FILE);
createJsonApi('/api/habitats', HABITATS_FILE);

// ─── Tauri Updater endpoints ─────────────────────────────────────────────────
//
// Wired into `tauri.conf.json` -> `plugins.updater.endpoints`. The Tauri client
// hits `/api/updates/:target/:currentVersion` on launch; we either return the
// update manifest (HTTP 200, JSON described at https://v2.tauri.app/plugin/updater/)
// or HTTP 204 No Content meaning "you're up to date".
//
// New builds are registered by POSTing to `/api/releases` with the version,
// notes, and per-target { signature, url }. The signature must be the
// *contents* of the `.sig` file Tauri writes next to the bundle when
// TAURI_SIGNING_PRIVATE_KEY is set during `tauri build`. Storage shape:
//
//   releases.json = { latest: "0.2.0", releases: [ { version, pub_date,
//     notes, platforms: { "darwin-aarch64": { signature, url }, ... } } ] }

// Simple X.Y.Z comparator — returns 1 if a > b, -1 if a < b, 0 if equal.
// Good enough for our versioning; if we ever ship pre-release tags we should
// pull in `semver` instead.
function compareVersions(a, b) {
  const parse = v => String(v || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 > b1 ? 1 : -1;
  if (a2 !== b2) return a2 > b2 ? 1 : -1;
  if (a3 !== b3) return a3 > b3 ? 1 : -1;
  return 0;
}

function readReleases() {
  try {
    if (!fs.existsSync(RELEASES_FILE)) return { latest: null, releases: [] };
    return JSON.parse(fs.readFileSync(RELEASES_FILE, 'utf8'));
  } catch (e) {
    console.error("Failed to read releases.json:", e);
    return { latest: null, releases: [] };
  }
}

function writeReleases(data) {
  fs.writeFileSync(RELEASES_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Tauri updater poll endpoint — public (read-only, no admin key required).
// Tauri targets look like: darwin-aarch64, darwin-x86_64, windows-x86_64,
// linux-x86_64. We respond 204 if the client is on the latest version or
// newer, otherwise return the manifest for the latest release that has a
// build for the requested target.
app.get('/api/updates/:target/:currentVersion', (req, res) => {
  const { target, currentVersion } = req.params;
  const data = readReleases();

  if (!data.latest || !data.releases?.length) {
    return res.status(204).send();
  }

  // Pick the highest version that has an artifact for the requested target.
  // (If the user's on macOS Intel and we only published an Apple Silicon build
  // for the new version, they shouldn't get prompted.)
  const candidates = data.releases
    .filter(r => r.platforms && r.platforms[target])
    .sort((a, b) => compareVersions(b.version, a.version));

  const latest = candidates[0];
  if (!latest) {
    return res.status(204).send();
  }

  if (compareVersions(currentVersion, latest.version) >= 0) {
    return res.status(204).send();
  }

  res.json({
    version: latest.version,
    notes: latest.notes || "",
    pub_date: latest.pub_date,
    platforms: {
      [target]: latest.platforms[target],
    },
  });
});

// List releases — handy for the admin UI / debugging.
app.get('/api/releases', (req, res) => {
  res.json(readReleases());
});

// Register a new release. Admin-key protected (the global write guard above
// already enforces this for POST when ADMIN_API_KEY is set).
//
// Body shape:
//   { version: "0.2.0",
//     notes:   "What changed",
//     pub_date: "2026-05-13T14:00:00Z",   // optional, defaults to now
//     platforms: {
//       "darwin-aarch64": { signature: "<.sig contents>", url: "/releases/Canopy_0.2.0_aarch64.app.tar.gz" },
//       ...
//     } }
app.post('/api/releases', (req, res) => {
  const { version, notes, pub_date, platforms } = req.body || {};

  if (!version || typeof version !== 'string') {
    return res.status(400).json({ error: "version is required (string, e.g. '0.2.0')" });
  }
  if (!platforms || typeof platforms !== 'object' || !Object.keys(platforms).length) {
    return res.status(400).json({ error: "platforms is required (object keyed by Tauri target, e.g. 'darwin-aarch64')" });
  }
  for (const [tgt, p] of Object.entries(platforms)) {
    if (!p || typeof p.signature !== 'string' || typeof p.url !== 'string') {
      return res.status(400).json({ error: `platforms.${tgt} must be { signature: string, url: string }` });
    }
  }

  const data = readReleases();
  // Replace if a row for this exact version already exists — re-publishing a
  // version is a normal flow when you fix a signature, change notes, etc.
  data.releases = (data.releases || []).filter(r => r.version !== version);
  data.releases.push({
    version,
    notes: notes || "",
    pub_date: pub_date || new Date().toISOString(),
    platforms,
  });

  // Recompute `latest` as the highest version across remaining releases.
  data.latest = data.releases
    .map(r => r.version)
    .sort(compareVersions)
    .reverse()[0] || null;

  writeReleases(data);
  res.json({ success: true, latest: data.latest, count: data.releases.length });
});

// Delete a release (e.g. you published a broken signature and want to roll back).
app.delete('/api/releases/:version', (req, res) => {
  const { version } = req.params;
  const data = readReleases();
  const before = data.releases?.length || 0;
  data.releases = (data.releases || []).filter(r => r.version !== version);
  if (data.releases.length === before) {
    return res.status(404).json({ error: `version ${version} not found` });
  }
  data.latest = data.releases.map(r => r.version).sort(compareVersions).reverse()[0] || null;
  writeReleases(data);
  res.json({ success: true, latest: data.latest });
});

app.post('/api/usage', (req, res) => {
  const { agentId, role, tokensIn, tokensOut, messagesHandled, tasksToday } = req.body;
  if (!agentId) return res.status(400).json({ error: "agentId is required" });

  try {
    let stats = {};
    if (fs.existsSync(STATS_FILE)) {
      stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    }

    if (!stats[agentId]) {
      stats[agentId] = {
        role: role || 'Unknown',
        tasks_today: 0,
        messages_handled: 0,
        total_tokens_in: 0,
        total_tokens_out: 0,
        last_seen: new Date().toISOString()
      };
    }

    const s = stats[agentId];
    s.role = role || s.role;
    s.tasks_today = tasksToday !== undefined ? tasksToday : s.tasks_today;
    s.messages_handled = messagesHandled !== undefined ? messagesHandled : s.messages_handled;
    s.total_tokens_in += tokensIn || 0;
    s.total_tokens_out += tokensOut || 0;
    s.last_seen = new Date().toISOString();

    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    res.json({ success: true });
  } catch (e) {
    console.error("Failed to update stats:", e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    if (!fs.existsSync(STATS_FILE)) return res.json({ tokenUsageData: [], personaAdoptionData: { usage: [], downloads: [] }, activeAgentsDaily: 0 });

    const rawStats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    const agents = fs.existsSync(AGENTS_FILE) ? JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8')) : {};

    // Aggregate data
    const agentIds = Object.keys(rawStats);
    const activeAgentsDaily = agentIds.length;

    // Build persona adoption (by usage count)
    const personaUsage = {};
    let totalIn = 0;
    let totalOut = 0;

    agentIds.forEach(id => {
      const s = rawStats[id];
      const role = s.role || agents[id]?.description || "Unknown";
      personaUsage[role] = (personaUsage[role] || 0) + (s.messages_handled || 0);
      totalIn += s.total_tokens_in || 0;
      totalOut += s.total_tokens_out || 0;
    });

    const personaAdoptionData = {
      usage: Object.entries(personaUsage).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      downloads: Object.entries(agents).map(([id, a]) => ({ name: a.description || id, count: 1 })).slice(0, 5) // Mock downloads for now
    };

    // Build token usage (mock historical for UI vibe, using real totals for the last point)
    const tokenUsageData = [
      { day: 'Start', google: 0, openai: 0, anthropic: 0, xai: 0, other: 0 },
      {
        day: new Date().toLocaleDateString('en-US', { weekday: 'short' }),
        google: Math.floor(totalOut * 0.4),
        openai: Math.floor(totalOut * 0.3),
        anthropic: Math.floor(totalOut * 0.2),
        xai: Math.floor(totalOut * 0.05),
        other: Math.floor(totalOut * 0.05)
      }
    ];

    res.json({
      tokenUsageData,
      personaAdoptionData,
      activeAgentsDaily,
      totalAgentsCreated: activeAgentsDaily,
      totalAgentsActive: activeAgentsDaily,
      lastSync: new Date().toISOString()
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});


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
      in: (data[bareKey]?.input_cost_per_token || fallbackIn) * 1000000,
      out: (data[bareKey]?.output_cost_per_token || fallbackOut) * 1000000,
    });

    const mappedPricing = {
      "anthropic/claude-sonnet-4-6": litellmPrice("claude-sonnet-4-6", 0.000003, 0.000015),
      "anthropic/claude-haiku-4-5-20251001": litellmPrice("claude-haiku-4-5-20251001", 0.0000008, 0.000004),
      "anthropic/claude-opus-4-6": litellmPrice("claude-opus-4-6", 0.000015, 0.000075),
      "openai/gpt-4o": litellmPrice("gpt-4o", 0.0000025, 0.00001),
      "openai/gpt-4o-mini": litellmPrice("gpt-4o-mini", 0.00000015, 0.0000006),
      "openai/o4-mini": litellmPrice("o4-mini", 0.0000011, 0.0000044),
      "xai/grok-beta": litellmPrice("grok-beta", 0.000005, 0.000015),
    };

    let modelList = [
      // Anthropic
      { id: "anthropic/claude-sonnet-4-6", provider: "Anthropic", name: "Claude Sonnet 4.6", description: "Fast & highly capable", costIn: mappedPricing["anthropic/claude-sonnet-4-6"].in, costOut: mappedPricing["anthropic/claude-sonnet-4-6"].out, strategy: "heavy", status: "stable", rawVariable: "claude-sonnet-4-6" },
      { id: "anthropic/claude-haiku-4-5", provider: "Anthropic", name: "Claude Haiku 4.5", description: "Fastest Anthropic model", costIn: mappedPricing["anthropic/claude-haiku-4-5-20251001"].in, costOut: mappedPricing["anthropic/claude-haiku-4-5-20251001"].out, strategy: "light", status: "stable", rawVariable: "claude-haiku-4-5" },
      { id: "anthropic/claude-opus-4-6", provider: "Anthropic", name: "Claude Opus 4.6", description: "Most capable Anthropic", costIn: mappedPricing["anthropic/claude-opus-4-6"].in, costOut: mappedPricing["anthropic/claude-opus-4-6"].out, strategy: "heavy", status: "stable", rawVariable: "claude-opus-4-6" },
      // OpenAI
      { id: "openai/gpt-4o", provider: "OpenAI", name: "GPT-4o", description: "Flagship multimodal", costIn: mappedPricing["openai/gpt-4o"].in, costOut: mappedPricing["openai/gpt-4o"].out, strategy: "heavy", status: "stable", rawVariable: "gpt-4o" },
      { id: "openai/gpt-4o-mini", provider: "OpenAI", name: "GPT-4o Mini", description: "Fast & affordable", costIn: mappedPricing["openai/gpt-4o-mini"].in, costOut: mappedPricing["openai/gpt-4o-mini"].out, strategy: "light", status: "stable", rawVariable: "gpt-4o-mini" },
      { id: "openai/o4-mini", provider: "OpenAI", name: "o4-mini", description: "Fast reasoning model", costIn: mappedPricing["openai/o4-mini"].in, costOut: mappedPricing["openai/o4-mini"].out, strategy: "heavy", status: "stable", rawVariable: "o4-mini" },
      { id: "xai/grok-beta", provider: "xAI", name: "Grok Beta", description: "Real-time web access", costIn: mappedPricing["xai/grok-beta"].in, costOut: mappedPricing["xai/grok-beta"].out, strategy: "heavy", status: "stable", rawVariable: "grok-beta" },
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
      { bare: "gemini-3-flash-preview", name: "Gemini 3 Flash", strategy: "light", costIn: 0.15, costOut: 0.6, description: "Preview — successor to 2.5 Flash" },
      { bare: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite", strategy: "light", costIn: 0.075, costOut: 0.3, description: "Preview — successor to 2.5 Flash Lite" },
      { bare: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", strategy: "heavy", costIn: 1.25, costOut: 5.0, description: "Preview — successor to 2.5 Pro" },
      // Gemini 2.5 — Stable GA, shutdown not before June 2026
      { bare: "gemini-2.5-flash", name: "Gemini 2.5 Flash", strategy: "light", costIn: 0.15, costOut: 0.6, description: "Stable — recommended default" },
      { bare: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", strategy: "light", costIn: 0.075, costOut: 0.3, description: "Stable — fastest/cheapest" },
      { bare: "gemini-2.5-pro", name: "Gemini 2.5 Pro", strategy: "heavy", costIn: 1.25, costOut: 10.0, description: "Stable — flagship model" },
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
              const costIn = (data[`gemini/${bareName}`]?.input_cost_per_token || data[bareName]?.input_cost_per_token) * 1000000;
              const costOut = (data[`gemini/${bareName}`]?.output_cost_per_token || data[bareName]?.output_cost_per_token) * 1000000;
              if (costIn) canonical.costIn = costIn;
              if (costOut) canonical.costOut = costOut;
            }
          }
        }
      } catch (e) {
        console.warn("Live Gemini pricing fetch failed — using estimate costs:", e.message);
      }
    }

    // Step 4: Add canonical Gemini models to the list. Do not skip deprecated ones entirely, pass them through as deprecated so the UI can audit them.
    for (const { bare, name, strategy, costIn, costOut, description } of CANONICAL_GEMINI) {
      const isDeprecated = deprecatedBareNames.has(bare);
      const status = isDeprecated ? "deprecated" : (bare.includes("preview") ? "preview" : "stable");

      const fullId = `google/${bare}`;
      if (!isDeprecated) {
        mappedPricing[fullId] = { in: costIn, out: costOut };
      }
      modelList.push({ id: fullId, provider: "Google Gemini", name, description, costIn, costOut, strategy, status, rawVariable: bare });
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
  } catch (e) {
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

  const injectedPrompt = `You are an AI generating prompts for a 3D asset generator.
The user will provide an object idea. You must generate exactly 4 distinct visual variations/styles of THAT specific object. Do NOT break the request into sub-components.
Output ONLY a JSON array of 4 strings, where each string is a highly descriptive prompt for the 3D prop requested.
Keep them simple, blocky, pastel colored, isometric. The item should be floating on a white background, no ground or platform or rock object below it.
User Request: ${prompt}`;

  try {
    let items = [prompt];
    if (GEMINI_API_KEY) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`, {
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

    // Convert to pollinations images with a local proxy to avoid broken external links
    const images = items.map(item => {
      const fullPrompt = `${item}, single isolated object floating in empty space, pure solid white background, NO base, NO platform, NO ground, NO shadow below, NO pedestal, low poly primitive shapes, smooth lighting, pastel colors, 3d game asset, cute`;
      const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;
      return {
        prompt: item,
        url: `http://localhost:3001/api/proxy-image?url=${encodeURIComponent(pollinationsUrl)}`,
        originalUrl: pollinationsUrl
      };
    });
    res.json({ success: true, items: images });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Generation failed' });
  }
});

let proxyQueue = Promise.resolve();

app.get('/api/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).send('Missing url');

  const processRequest = async () => {
    // Hard wait of 5 seconds before EVERY request to comply with pollinations rate limits
    await new Promise(r => setTimeout(r, 5000));

    const MAX_RETRIES = 5;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          if (response.status === 429 || response.status >= 500) {
            throw new Error(`External fetch failed: ${response.status}`);
          } else {
            throw new Error(`External fetch failed fatally: ${response.status}`);
          }
        }

        const buffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type') || 'image/jpeg';

        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=3600');
        return res.send(Buffer.from(buffer));
      } catch (e) {
        if (i === MAX_RETRIES - 1 || e.message.includes("fatally")) {
          console.error("Proxy error after retries:", e.message);
          return res.status(500).send('Image proxy failed');
        }
        console.warn(`[Proxy] Retry ${i+1}/${MAX_RETRIES} for ${imageUrl.substring(0, 50)}...`);
        // Exponential backoff
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
      }
    }
  };

  // Add to global promise queue to prevent pollinations.ai 429 errors from parallel generation
  proxyQueue = proxyQueue.then(processRequest).catch(() => {});
});

async function uploadToPublicBridge(localPath) {
  const fullPath = path.join(__dirname, '../shared/public', localPath);
  if (!fs.existsSync(fullPath)) throw new Error("Local file not found at: " + fullPath);

  console.log(`[BRIDGE] Uploading local asset to public bridge: ${localPath}`);

  try {
    const fileBuffer = fs.readFileSync(fullPath);
    const fileName = path.basename(localPath);

    const formData = new globalThis.FormData();
    const blob = new globalThis.Blob([fileBuffer], { type: 'image/png' });
    formData.append('reqtype', 'fileupload');
    formData.append('fileToUpload', blob, fileName);

    // catbox.moe is a reliable public file host
    const response = await fetch('https://catbox.moe/user/api.php', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bridge API (catbox.moe) responded with ${response.status}: ${errorText}`);
    }

    const publicUrl = (await response.text()).trim();
    if (!publicUrl.startsWith('http')) {
      throw new Error("Temporary bridge upload (catbox.moe) failed: " + publicUrl);
    }

    console.log(`[BRIDGE] Asset bridged successfully: ${publicUrl}`);
    return publicUrl;
  } catch (err) {
    console.error("[BRIDGE] Upload failed:", err);
    throw err;
  }
}

const taskIdToPath = new Map();

app.post('/api/meshy-task', async (req, res) => {
  const { imageUrl } = req.body;
  if (!imageUrl) return res.status(400).json({ error: 'No image URL provided' });
  if (!MESHY_API_KEY) return res.status(400).json({ error: 'MESHY_API_KEY is not configured in .env.' });

  try {
    let targetUrl = imageUrl;

    // Handle relative paths by bridging them to a public URL
    if (imageUrl.startsWith('/')) {
      try {
        targetUrl = await uploadToPublicBridge(imageUrl);
      } catch (bridgeErr) {
        console.error("[MESHY] Bridge failed:", bridgeErr);
        return res.status(500).json({ error: "Failed to make local asset public for Meshy: " + bridgeErr.message });
      }
    }

    console.log(`[MESHY] Starting task for URL: ${targetUrl}`);

    const response = await fetch('https://api.meshy.ai/openapi/v1/image-to-3d', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MESHY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image_url: targetUrl,
        enable_pbr: true,
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("[MESHY] API Error Response:", data);
      throw new Error(data.message || data.error?.message || 'Meshy API rejected the request');
    }

    const taskId = data.result;
    taskIdToPath.set(taskId, imageUrl);

    // Immediately download the original PNG so it appears in the catalog instantly while the 3D model bakes
    try {
      const trueUrl = imageUrl.includes('/api/proxy-image?url=') ? decodeURIComponent(imageUrl.split('url=')[1]) : imageUrl;
      // Also handle direct pollinations url if bypassed proxy
      const finalUrl = trueUrl.includes('localhost:') ? decodeURIComponent(trueUrl.split('url=')[1]) : trueUrl;
      
      const imgRes = await fetch(finalUrl);
      if (imgRes.ok) {
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
        const pngSavePath = path.join(__dirname, '../shared/public/accessories', `meshy_${taskId}.png`);
        fs.writeFileSync(pngSavePath, imgBuffer);
      }
    } catch (e) {
      console.error("[MESHY] Failed to download PNG upfront:", e);
    }

    console.log("[MESHY] Task started successfully:", taskId);
    res.json({ success: true, taskId });
  } catch (e) {
    console.error("[MESHY] Fatal handler error:", e);
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
      const originalPath = taskIdToPath.get(taskId);
      const glbUrl = data.model_urls.glb;
      const download = await fetch(glbUrl);
      const buffer = Buffer.from(await download.arrayBuffer());

      let fileName = `meshy_${taskId}.glb`;
      if (originalPath && originalPath.includes('.') && !originalPath.includes('pollinations.ai') && !originalPath.startsWith('http')) {
        // Use original base name but with .glb extension for local files
        const derivedName = path.basename(originalPath.split('?')[0]).replace(/\.[^/.]+$/, "") + ".glb";
        if (derivedName.length < 100) {
          fileName = derivedName;
        }
      }

      const savePath = path.join(__dirname, '../shared/public/accessories', fileName);
      fs.writeFileSync(savePath, buffer);

      console.log(`[MESHY] Saved GLB to: ${savePath}`);

      taskIdToPath.delete(taskId);
      return res.json({ success: true, status: data.status, glbPath: `/accessories/${fileName}` });
    }

    res.json({ success: true, status: data.status, progress: data.progress });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Check failed' });
  }
});

app.post('/api/upload-agent-image', upload.single('image'), (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No image provided' });
    const ext = path.extname(file.originalname).toLowerCase();
    const fileName = `upload_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;
    const savePath = path.join(__dirname, '../shared/public/agents', fileName);
    fs.renameSync(file.path, savePath);

    res.json({ success: true, imagePath: `/agents/${fileName}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

app.post('/api/upload-bulk', upload.array('files'), (req, res) => {
  try {
    const uploadedFiles = [];
    if (!fs.existsSync(ACCESSORIES_FILE)) return res.status(500).json({ error: 'Accessories JSON missing' });
    const accData = JSON.parse(fs.readFileSync(ACCESSORIES_FILE, 'utf8'));

    for (const file of req.files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const fileName = `upload_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;
      const savePath = path.join(__dirname, '../shared/public/accessories', fileName);
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

// --- Serve built frontend in production ---
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Fallback for SPA routing - MUST be after all API and static asset routes
app.get('*all', (req, res) => {
  const url = req.url.split('?')[0].split('#')[0];
  const isHtml = req.headers.accept?.includes('text/html');
  const isFile = url.includes('.');

  if (isHtml && !isFile) {
    const indexPath = path.join(__dirname, 'dist/index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('Not Found (Admin Frontend not built or Vite not running)');
    }
  } else {
    res.status(404).json({ error: 'Not Found' });
  }
});

// Bind to 0.0.0.0 so the same code works locally AND inside Cloud Run.
// Cloud Run's health checks come in via the container's external interface;
// binding to 127.0.0.1 only would make the service unreachable from the
// outside and the container would fail to come up.
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Admin Server API running on http://${HOST}:${PORT}`);
});
