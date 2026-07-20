const Database = require('better-sqlite3');
const os = require('os');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(os.homedir(), 'Library/Application Support/Canopy/canopy.db');
console.log("Checking DB at:", dbPath);

if (!fs.existsSync(dbPath)) {
  console.log("DB NOT FOUND");
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

for (let i = 6; i >= 0; i--) {
  const d = new Date();
  d.setDate(d.getDate() - i);
  const dayStr = d.toISOString().split('T')[0];
  
  const usageRows = db.prepare(`
    SELECT c.agent_id, a.name, SUM(length(m.content)) as char_count
    FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    LEFT JOIN agents a ON c.agent_id = a.id
    WHERE m.timestamp LIKE ?
    GROUP BY c.agent_id
  `).all(`${dayStr}%`);
  
  console.log(`${dayStr}:`, usageRows);
}
db.close();
