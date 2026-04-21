import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Load keys securely
let MESHY_API_KEY = process.env.MESHY_API_KEY || '';
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const keyMatch = envContent.match(/^MESHY_API_KEY=(.+)$/m);
    if (keyMatch) MESHY_API_KEY = keyMatch[1].trim().replace(/^["']|["']$/g, '');
  }
} catch (e) {
  console.warn("Could not load .env file:", e);
}

if (!MESHY_API_KEY) {
  console.error("No MESHY_API_KEY found in .env!");
  process.exit(1);
}

const HEADERS = {
  'Authorization': `Bearer ${MESHY_API_KEY}`,
  'Content-Type': 'application/json'
};

const DATA_DIR = path.join(__dirname, '../shared');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const AGENTS_IMG_DIR = path.join(__dirname, '../canopy/public/agents');
const MODELS_OUT_DIR = path.join(__dirname, '../canopy/public/models/lobsters');

// Ensure output dir exists
if (!fs.existsSync(MODELS_OUT_DIR)) {
  fs.mkdirSync(MODELS_OUT_DIR, { recursive: true });
}

// 2. Poll waiting helper
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function getTaskStatus(taskId) {
  const url = `https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`;
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) {
    throw new Error(`Failed to check status: ${response.statusText} ${await response.text()}`);
  }
  return await response.json();
}

async function downloadBinary(url, outputPath) {
  console.log(`Downloading GLB from: ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(buffer));
  console.log(`Successfully saved to ${outputPath}`);
}

async function generateMeshForRole(role) {
  const pngPath = path.join(AGENTS_IMG_DIR, `${role}.png`);
  if (!fs.existsSync(pngPath)) {
    console.log(`[SKIP] No source image found for role: ${role} (${pngPath})`);
    return;
  }

  const glbPath = path.join(MODELS_OUT_DIR, `${role}.glb`);
  if (fs.existsSync(glbPath)) {
    console.log(`[PASS] GLB already exists for role: ${role}`);
    return;
  }

  console.log(`[BUILD] Missing GLB for role '${role}'. Calling Meshy API...`);
  
  // Encode base64 data URI
  const imageBuffer = fs.readFileSync(pngPath);
  const base64Str = imageBuffer.toString('base64');
  const dataUri = `data:image/png;base64,${base64Str}`;

  // Start Generation
  const reqBody = {
    image_url: dataUri,
    enable_pbr: true,
  };

  const response = await fetch('https://api.meshy.ai/openapi/v1/image-to-3d', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(reqBody)
  });

  if (!response.ok) {
    console.error(`[ERROR] Meshy API rejected job for ${role}:`, await response.text());
    return;
  }

  const data = await response.json();
  const taskId = data.result;

  console.log(`[TASK] ${taskId} generated. Polling for completion... (This will take ~2-5 minutes)`);

  let completed = false;
  let attempts = 0;
  while (!completed && attempts < 100) {
    await delay(15000); // Poll every 15 seconds
    attempts++;
    
    try {
      const statusRes = await getTaskStatus(taskId);
      console.log(`[STATUS] Status: ${statusRes.status} | Progress: ${statusRes.progress}%`);
      
      if (statusRes.status === "SUCCEEDED") {
        console.log(`[SUCCESS] Meshy complete! Extracting model...`);
        const modelUrl = statusRes.model_urls.glb;
        await downloadBinary(modelUrl, glbPath);
        completed = true;
      } else if (statusRes.status === "FAILED") {
        console.error(`[ERROR] Meshy task failed:`, statusRes.task_error);
        completed = true;
      }
    } catch (e) {
      console.warn("[WARN] Polling failed, retrying in 15s...", e.message);
    }
  }
}

async function run() {
  if (!fs.existsSync(AGENTS_FILE)) {
    console.error(`Agents file not found at ${AGENTS_FILE}`);
    process.exit(1);
  }

  const agentsDb = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
  const roles = Object.keys(agentsDb);

  console.log(`Found ${roles.length} agent roles. Scanning for missing glb assets...`);

  const targetRole = process.argv[2];

  if (targetRole && roles.includes(targetRole)) {
    console.log(`Running exclusively for targeted role: ${targetRole}`);
    await generateMeshForRole(targetRole);
  } else {
    for (const role of roles) {
      await generateMeshForRole(role);
    }
  }

  console.log("Sync complete.");
}

run();
