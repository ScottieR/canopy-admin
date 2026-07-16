import fs from "node:fs";
import path from "node:path";

const allowedKeys = new Set([
  "GEMINI_API_KEY",
  "MESHY_API_KEY",
  "ANTHROPIC_API_KEY",
  "ADMIN_API_KEY",
]);

const key = process.argv[2];
if (!allowedKeys.has(key)) {
  throw new Error(`Unsupported secret name: ${key || "(missing)"}`);
}

const value = fs.readFileSync(0, "utf8").trim();
if (!value || /[\r\n]/.test(value)) {
  throw new Error(`${key} must be a non-empty single-line value`);
}

const envPath = path.resolve(process.cwd(), ".env");
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const lines = existing.split(/\r?\n/).filter(Boolean);
const nextLine = `${key}=${value}`;
const index = lines.findIndex((line) => line.startsWith(`${key}=`));

if (index >= 0) lines[index] = nextLine;
else lines.push(nextLine);

fs.writeFileSync(envPath, `${lines.join("\n")}\n`, { mode: 0o600 });
fs.chmodSync(envPath, 0o600);
