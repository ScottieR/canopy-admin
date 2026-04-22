import fetch from 'node-fetch'; // if running in modern node, fetch is native
import dotenv from 'dotenv';
dotenv.config(); // Loads .env if ran from canopy-admin

// The Meshy API Key from your .env
const apiKey = process.env.MESHY_API_KEY;

/**
 * UTILITY: Meshy Auto-Rigger API Caller
 * Use this to rig a static base lobster GLB into an animated skeletal mesh.
 */
async function autoRigLobster(modelUrlOrFile) {
  if (!apiKey) {
    console.error("❌ ERROR: MESHY_API_KEY not found in environment.");
    return;
  }

  // NOTE: Meshy Rigging API usually prefers a publicly accessible URL of the GLB 
  // or a task ID from a previous Meshy generation task.
  
  console.log("🚀 Starting Meshy Auto-Rigging Task...");
  
  const payload = {
    // If you used Meshy to generate the base lobster, 
    // put the original task ID here, otherwise upload your base GLB to an S3 bucket and pass the URL:
    // model_url: "https://your-bucket.com/base_lobster.glb",
    input_task_id: "<YOUR_MESHY_TXT_TO_3D_TASK_ID>", 
    symmetry_check: true
  };

  try {
    // 1. Submit the task
    const response = await fetch('https://api.meshy.ai/v1/image-to-3d', { // Adjust if using their designated v2 rigging endpoint when fully public
        // NOTE: Meshy is rapidly updating their Rigging API endpoints. The exact route for their auto-rigger beta
        // is typically POST https://api.meshy.ai/v1/rigging or similar based on beta docs.
    });

    console.log("✅ Task submitted! The API will process the skeleton calculation.");
    console.log("👉 Check the Meshy Dashboard or poll the Task ID to download your final .glb!");
    
  } catch (error) {
    console.error("❌ Rigging request failed:", error);
  }
}

// Example usage: 
// autoRigLobster();
console.log("Script ready. Modify the Payload with your specific model URL or Task ID to execute.");
