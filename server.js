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
    
    // Ensure backwards compatibility with simple pricing map for older rust backends
    const mappedPricing = {
      "claude-4-6-sonnet": { in: (data["claude-3-5-sonnet-20240620"]?.input_cost_per_token || 0.000003) * 1000000, out: (data["claude-3-5-sonnet-20240620"]?.output_cost_per_token || 0.000015) * 1000000 },
      "gpt-4o-mini": { in: (data["gpt-4o-mini"]?.input_cost_per_token || 0.00000015) * 1000000, out: (data["gpt-4o-mini"]?.output_cost_per_token || 0.0000006) * 1000000 },
      "gpt-4o": { in: (data["gpt-4o"]?.input_cost_per_token || 0.000005) * 1000000, out: (data["gpt-4o"]?.output_cost_per_token || 0.000015) * 1000000 },
      "grok-beta": { in: (data["grok-beta"]?.input_cost_per_token || 0.000005) * 1000000, out: (data["grok-beta"]?.output_cost_per_token || 0.000015) * 1000000 }
    };
    
    let modelList = [
      { id: "gpt-4o-mini", provider: "OpenAI", name: "GPT-4o-mini", description: "Fast & Light", costIn: mappedPricing["gpt-4o-mini"].in, costOut: mappedPricing["gpt-4o-mini"].out, strategy: "light", capabilities: ["chat", "vision"] },
      { id: "claude-4-6-sonnet", provider: "Anthropic", name: "Claude 4.6 Sonnet", description: "Powerful & Deep", costIn: mappedPricing["claude-4-6-sonnet"].in, costOut: mappedPricing["claude-4-6-sonnet"].out, strategy: "heavy", capabilities: ["chat", "vision", "code"] },
      { id: "gpt-4o", provider: "OpenAI", name: "GPT-4o", description: "Versatile & Robust", costIn: mappedPricing["gpt-4o"].in, costOut: mappedPricing["gpt-4o"].out, strategy: "heavy", capabilities: ["chat", "vision"] },
      { id: "grok-beta", provider: "Grok", name: "Grok Beta", description: "Real-time & Edgy", costIn: mappedPricing["grok-beta"].in, costOut: mappedPricing["grok-beta"].out, strategy: "heavy", capabilities: ["chat", "web"] }
    ];

    // Fetch Dynamic Gemini Models exactly from API
    if (GEMINI_API_KEY) {
      try {
        console.log("Fetching live Gemini models from Google API...");
        const gmRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
        if (gmRes.ok) {
           const gmData = await gmRes.json();
           const validGeminis = gmData.models.filter(m => m.name.includes("gemini") && m.supportedGenerationMethods.includes("generateContent"));
           
           for (const m of validGeminis) {
             const cleanId = m.name.replace("models/", ""); // e.g. gemini-1.5-flash
             // Dynamically lookup cost from litellm if it exists, otherwise use fallback
             const litellmCostIn = data[cleanId]?.input_cost_per_token || 0.00000035;
             const litellmCostOut = data[cleanId]?.output_cost_per_token || 0.00000105;
             mappedPricing[cleanId] = { in: litellmCostIn * 1000000, out: litellmCostOut * 1000000 };
             
             modelList.push({
               id: cleanId,
               provider: "Google Gemini",
               name: m.displayName || cleanId,
               description: m.description ? m.description.substring(0, 100) : (cleanId.includes("flash") ? "Rapid Inference" : "High Context"),
               costIn: mappedPricing[cleanId].in,
               costOut: mappedPricing[cleanId].out,
               strategy: cleanId.includes("flash") ? "light" : "heavy",
               capabilities: m.supportedGenerationMethods
             });
           }
        }
      } catch (e) {
        console.error("Could not fetch gemini models, using fallback...");
      }
    }
    
    // If we completely failed to get Gemini models, provide critical fail-safes
    if (!modelList.find(m => m.provider === "Google Gemini")) {
         mappedPricing["gemini-1.5-flash"] = { in: 0.35, out: 1.05 };
         mappedPricing["gemini-1.5-pro"] = { in: 3.50, out: 10.50 };
         modelList.push({ id: "gemini-1.5-flash", provider: "Google Gemini", name: "Gemini 1.5 Flash (Fallback)", description: "Rapid Inference", costIn: 0.35, costOut: 1.05, strategy: "light", capabilities: ["generateContent"] });
         modelList.push({ id: "gemini-1.5-pro", provider: "Google Gemini", name: "Gemini 1.5 Pro (Fallback)", description: "High Context", costIn: 3.50, costOut: 10.50, strategy: "heavy", capabilities: ["generateContent"] });
    }

    fs.writeFileSync(PRICING_FILE, JSON.stringify(mappedPricing, null, 2), "utf8");

    // Default strategy selection dynamically based on new list
    let defaultLight = modelList.find(m => m.strategy === "light" && m.provider === "Google Gemini")?.id || modelList.find(m => m.strategy === "light")?.id || "gpt-4o-mini";
    let defaultHeavy = modelList.find(m => m.id.includes("sonnet"))?.id || modelList.find(m => m.strategy === "heavy")?.id || "gpt-4o";

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
