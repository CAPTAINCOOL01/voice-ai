/**
 * Auto-download new recordings as soon as they are saved.
 * Saves files with human-readable names: 2026-04-16_09-32-15.wav
 * Run: node watch-recordings.js
 * Leave it running — it polls every 5 seconds.
 */

require("./backend/node_modules/dotenv").config({ path: "./backend/.env" });

const fs   = require("fs");
const path = require("path");

const BACKEND = "https://voice-ai-da3b.onrender.com";
const OUT_DIR = path.join(__dirname, "recordings");
const POLL_MS = 5000;

// Map: server filename → local pretty filename (persisted in a JSON index)
const INDEX_FILE = path.join(OUT_DIR, ".index.json");
let index = {}; // { "1776107224813.wav": "2026-04-14_10-33-44.wav", ... }

function loadIndex() {
  if (fs.existsSync(INDEX_FILE)) {
    try { index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")); } catch {}
  }
}
function saveIndex() {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

// Convert a server filename to a pretty local name
// Server names are either:
//   - Unix ms timestamp: "1776107224813.wav"  → "2026-04-14_10-33-44.wav"
//   - Already pretty:    "2026-04-16_09-32-15.wav" → keep as-is
function prettyName(serverFilename, recCreatedAt) {
  const ext  = path.extname(serverFilename);           // .wav or .webm
  const stem = path.basename(serverFilename, ext);     // e.g. "1776107224813"

  // Already a pretty name (contains dashes and underscores in date pattern)
  if (/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(stem)) return serverFilename;

  // Use createdAt from DB if available, otherwise parse the timestamp from filename
  let date;
  const ts = parseInt(stem, 10);
  if (!isNaN(ts) && ts > 1_000_000_000_000) {
    date = new Date(ts);
  } else if (recCreatedAt) {
    date = new Date(recCreatedAt);
  } else {
    date = new Date();
  }

  // Format as YYYY-MM-DD_HH-MM-SS in local time
  const pad = n => String(n).padStart(2, "0");
  const name = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`
             + `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `${name}${ext}`;
}

// Rename existing files in the recordings folder that are still timestamp-named
function renameExisting() {
  const files = fs.readdirSync(OUT_DIR).filter(f => f !== ".index.json");
  let renamed = 0;
  for (const f of files) {
    const ext  = path.extname(f);
    const stem = path.basename(f, ext);
    if (!/^\d{13}$/.test(stem)) continue; // skip already-pretty names

    const pretty = prettyName(f, null);
    // Make sure no collision
    let finalName = pretty;
    let attempt   = 1;
    while (fs.existsSync(path.join(OUT_DIR, finalName)) && finalName !== f) {
      const s = path.basename(pretty, ext);
      finalName = `${s}_${attempt}${ext}`;
      attempt++;
    }
    if (finalName !== f) {
      fs.renameSync(path.join(OUT_DIR, f), path.join(OUT_DIR, finalName));
      index[f] = finalName;
      renamed++;
    }
  }
  if (renamed > 0) {
    saveIndex();
    console.log(`[RENAME] Renamed ${renamed} existing file(s) to date+time format`);
  }
}

// Set of server filenames already downloaded (by server filename key)
const downloaded = new Set();

function preload() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);
  loadIndex();
  // Mark all server filenames we already have as downloaded
  Object.keys(index).forEach(k => downloaded.add(k));
  // Also mark any pretty-named files not in index (e.g. from ESP32 direct naming)
  const files = fs.readdirSync(OUT_DIR).filter(f => f !== ".index.json");
  files.forEach(f => {
    if (!Object.values(index).includes(f)) {
      // Could be a directly-named file — mark server name == local name
      downloaded.add(f);
    }
  });
  console.log(`[INIT] ${files.length} file(s) already in ./recordings/`);
}

async function getToken() {
  const res = await fetch(`${BACKEND}/auth/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      username: process.env.APP_USERNAME,
      password: process.env.APP_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`Login HTTP ${res.status}`);
  const d = await res.json();
  if (!d.token) throw new Error("No token returned");
  return d.token;
}

async function downloadRec(rec, token) {
  const serverFilename = rec.filename;
  const localFilename  = prettyName(serverFilename, rec.createdAt);

  // Ensure no collision with existing file
  let finalLocal = localFilename;
  let attempt    = 1;
  const ext      = path.extname(localFilename);
  const stem     = path.basename(localFilename, ext);
  while (fs.existsSync(path.join(OUT_DIR, finalLocal))) {
    finalLocal = `${stem}_${attempt}${ext}`;
    attempt++;
  }

  const res = await fetch(`${BACKEND}/recordings/${rec._id}/audio`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Audio HTTP ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(OUT_DIR, finalLocal), buffer);

  // Save mapping so we know this server file is already downloaded
  index[serverFilename] = finalLocal;
  saveIndex();

  return { localFilename: finalLocal, bytes: buffer.length };
}

async function poll(token) {
  try {
    const res  = await fetch(`${BACKEND}/recordings`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) return null; // signal re-login
    const recs = await res.json();

    for (const rec of recs) {
      const sf = rec.filename;
      if (!sf || downloaded.has(sf)) continue;

      downloaded.add(sf); // prevent double-download
      process.stdout.write(`[NEW]  Downloading "${prettyName(sf, rec.createdAt)}"...`);
      try {
        const { localFilename, bytes } = await downloadRec(rec, token);
        const mb = (bytes / 1024 / 1024).toFixed(2);
        console.log(` ✓  ${mb} MB  →  ./recordings/${localFilename}`);
      } catch (err) {
        console.log(` ✗ ${err.message}`);
        downloaded.delete(sf); // retry next poll
      }
    }
  } catch (err) {
    console.error("[POLL] Error:", err.message);
  }
  return token;
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  VoiceNote AI — Auto-download watcher");
  console.log(`  New recordings saved to ./recordings/ every ${POLL_MS/1000}s`);
  console.log("  Press Ctrl+C to stop");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  preload();
  renameExisting(); // rename any old timestamp-named files

  let token;
  try {
    token = await getToken();
    console.log("[AUTH] ✓ Logged in\n");
  } catch (err) {
    console.error("[AUTH] ✗", err.message);
    process.exit(1);
  }

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
