/**
 * Auto-download new recordings as soon as they are saved.
 * Run: node watch-recordings.js
 * Leave it running — it polls every 5 seconds.
 */

// Use backend's node_modules so no separate install needed
const Module = require("module");
const origLoad = Module._resolveFilename;
Module._resolveFilename = function(req, parent, isMain, options) {
  try { return origLoad.call(this, req, parent, isMain, options); }
  catch(e) { return origLoad.call(this, req, { ...parent, filename: require("path").join(__dirname, "backend", "server.js") }, isMain, options); }
};

require("./backend/node_modules/dotenv").config({ path: "./backend/.env" });

const { S3Client, GetObjectCommand } = require("./backend/node_modules/@aws-sdk/client-s3");
const fs   = require("fs");
const path = require("path");

const s3 = new S3Client({
  region:   "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BACKEND  = "https://voice-ai-da3b.onrender.com";
const API_KEY  = process.env.ESP32_API_KEY; // reuse same key for simplicity
const OUT_DIR  = path.join(__dirname, "recordings");
const POLL_MS  = 5000; // check every 5 seconds

// Track which recording IDs we've already downloaded
const downloaded = new Set();

// Pre-populate with already-existing files so we don't re-download on startup
function preloadExisting() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);
  const existing = fs.readdirSync(OUT_DIR);
  existing.forEach(f => downloaded.add(f));
  console.log(`[INIT] Found ${existing.length} existing file(s) in ./recordings/`);
}

async function fetchRecordings(token) {
  const res = await fetch(`${BACKEND}/recordings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function downloadFile(filename, token) {
  const destPath = path.join(OUT_DIR, filename);

  // Download audio via backend proxy (auth required)
  // Find recording ID first
  const listRes = await fetch(`${BACKEND}/recordings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const recs = await listRes.json();
  const rec  = recs.find(r => r.filename === filename);
  if (!rec) return;

  const res = await fetch(`${BACKEND}/recordings/${rec._id}/audio`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Audio fetch HTTP ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return buffer.length;
}

async function getToken() {
  // Login with APP_USERNAME / APP_PASSWORD from .env
  const res = await fetch(`${BACKEND}/auth/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      username: process.env.APP_USERNAME,
      password: process.env.APP_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`Login failed: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.token) throw new Error("No token in login response");
  return data.token;
}

async function poll(token) {
  try {
    const recs = await fetchRecordings(token);
    for (const rec of recs) {
      const filename = rec.filename;
      if (!filename || downloaded.has(filename)) continue;

      // New recording found
      downloaded.add(filename); // mark immediately to avoid double-download
      const sizeMB = "?";
      process.stdout.write(`[NEW]  ${filename} — downloading...`);
      try {
        const bytes = await downloadFile(filename, token);
        const mb = (bytes / 1024 / 1024).toFixed(2);
        console.log(` ✓ saved (${mb} MB) → ./recordings/${filename}`);
      } catch (err) {
        console.log(` ✗ failed: ${err.message}`);
        downloaded.delete(filename); // retry next poll
      }
    }
  } catch (err) {
    if (err.message.includes("401") || err.message.includes("Invalid token")) {
      console.log("[AUTH] Token expired — re-logging in...");
      return null; // signal to re-login
    }
    console.error("[POLL] Error:", err.message);
  }
  return token;
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  VoiceNote AI — Auto-download watcher");
  console.log(`  Polling every ${POLL_MS / 1000}s — press Ctrl+C to stop`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  preloadExisting();

  let token;
  try {
    token = await getToken();
    console.log("[AUTH] ✓ Logged in\n");
  } catch (err) {
    console.error("[AUTH] ✗", err.message);
    process.exit(1);
  }

  // Run immediately then on interval
  token = await poll(token);

  setInterval(async () => {
    if (!token) {
      try { token = await getToken(); console.log("[AUTH] ✓ Re-logged in"); }
      catch (e) { console.error("[AUTH] ✗", e.message); return; }
    }
    token = await poll(token);
  }, POLL_MS);
}

main();
