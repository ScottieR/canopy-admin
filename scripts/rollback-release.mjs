#!/usr/bin/env node
// Roll back a bad desktop release.
//
// Usage:
//   node scripts/rollback-release.mjs <bad-version>          # remove from manifest
//   ADMIN_API_KEY=... node scripts/rollback-release.mjs <bad-version> --live
//
// What it does:
//   1. Removes <bad-version> from shared/releases.json and recomputes `latest`,
//      so clients that haven't updated yet stop being offered the bad build.
//   2. With --live (and ADMIN_API_KEY set), also DELETEs the release on the
//      running server for instant effect (no redeploy wait).
//
// Then commit and push so the durable manifest matches:
//   git add shared/releases.json
//   git commit -m "[ROLLBACK] Remove desktop vX.Y.Z"
//   git push origin main && git push origin main:production
//
// NOTE: users who already installed the bad version will NOT downgrade —
// Tauri only updates forward. To repair them, publish a new higher version
// from the last good commit (e.g. tag v0.2.2 on the v0.2.1 code).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASES = path.join(__dirname, '..', 'shared', 'releases.json');
const SERVER = 'https://canopy-admin-418538192879.us-central1.run.app';

const version = process.argv[2];
const live = process.argv.includes('--live');
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/rollback-release.mjs <bad-version> [--live]');
  process.exit(1);
}

const cmp = (a, b) => {
  const p = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0);
  const [a1, a2, a3] = p(a), [b1, b2, b3] = p(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
};

const data = JSON.parse(fs.readFileSync(RELEASES, 'utf8'));
const before = data.releases.length;
data.releases = data.releases.filter((r) => r.version !== version);
if (data.releases.length === before) {
  console.warn(`Version ${version} was not in the manifest.`);
}
data.latest = data.releases.map((r) => r.version).sort(cmp).reverse()[0] || null;
fs.writeFileSync(RELEASES, JSON.stringify(data, null, 2) + '\n');
console.log(`releases.json: removed ${version}, latest is now ${data.latest}`);

if (live) {
  const key = process.env.ADMIN_API_KEY;
  if (!key) {
    console.error('--live requires ADMIN_API_KEY in the environment');
    process.exit(1);
  }
  const res = await fetch(`${SERVER}/api/releases/${version}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Key': key },
  });
  console.log(`Live server: ${res.status} ${await res.text()}`);
}

console.log('\nNow commit + push so the change is durable:');
console.log('  git add shared/releases.json');
console.log(`  git commit -m "[ROLLBACK] Remove desktop v${version}"`);
console.log('  git push origin main && git push origin main:production');
