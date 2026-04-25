require("dotenv").config();

const express        = require("express");
const mongoose       = require("mongoose");
const multer         = require("multer");
const cors           = require("cors");
const jwt            = require("jsonwebtoken");
const bcrypt         = require("bcrypt");
const crypto         = require("crypto");
const session        = require("express-session");
const passport       = require("passport");
const OpenAI         = require("openai");
const path           = require("path");
const fs             = require("fs");
const os             = require("os");
const { S3Client, GetObjectCommand, DeleteObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const http       = require("http");
const WebSocket  = require("ws");

// ── Config ───────────────────────────────────────────────
const PORT       = process.env.PORT       || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "changeme-set-in-env";
const APP_USER   = process.env.APP_USERNAME;
const APP_PASS   = process.env.APP_PASSWORD;
const ESP32_KEY  = process.env.ESP32_API_KEY;
const BUCKET     = process.env.R2_BUCKET;
const R2_PUB     = process.env.R2_PUBLIC_URL;

// ── Services ─────────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const s3 = new S3Client({
  region:   "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// ── Express ───────────────────────────────────────────────
const app = express();
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.use(session({
  secret:            process.env.JWT_SECRET || "changeme",
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: false, maxAge: 5 * 60 * 1000 }, // 5 min — only needed for OAuth handshake
}));
app.use(passport.initialize());
app.use(passport.session());

// ── Serve React frontend ──────────────────────────────────
const DIST = path.join(__dirname, "..", "frontend", "dist");
if (fs.existsSync(DIST)) {
  // Hashed assets (JS/CSS) can be cached forever — filename changes on rebuild
  app.use("/assets", express.static(path.join(DIST, "assets"), {
    maxAge: "1y", immutable: true,
  }));
  // index.html must never be cached so the browser always gets the latest bundle reference
  app.use(express.static(DIST, { setHeaders: (res, filePath) => {
    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    }
  }}));
}

// ── MongoDB ───────────────────────────────────────────────
// Cache the ESP32 user after DB connects — eliminates per-request DB lookup in auth
let esp32User = null;
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB connected");
    esp32User = await User.findOne({ username: APP_USER })
              || await User.findOne({ provider: "local" })
              || await User.findOne();
    console.log(`✅ ESP32 user cached: ${esp32User?.username}`);
  })
  .catch(err => console.error("❌ MongoDB:", err));

// ── Models ────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  username:     { type: String, unique: true, required: true },
  name:         { type: String, default: "" },
  email:        { type: String, default: "" },
  passwordHash: { type: String, default: null },   // null for OAuth users
  provider:     { type: String, default: "local" }, // local | google | github
  providerId:   { type: String, default: null },
  avatar:       { type: String, default: "" },
  apiKey:       { type: String, default: () => crypto.randomBytes(32).toString("hex") },
  createdAt:    { type: Date, default: Date.now },
  lastLogin:    { type: Date },
});
const User = mongoose.model("User", UserSchema);

// ── Init Passport strategies (after User model is defined) ─
require("./config/passport")(User);

const Recording = mongoose.model("Recording", {
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  filename:    String,
  fileUrl:     String,
  transcript:  String,
  title:       String,
  summary:     String,
  tags:        [String],
  actionItems: [String],
  duration:    Number,
  createdAt:   { type: Date, default: Date.now },
});

const Project = mongoose.model("Project", {
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  name:        String,
  emoji:       { type: String, default: "📁" },
  color:       { type: String, default: "#f59e0b" },
  description: { type: String, default: "" },
  tasks: [{
    text:        String,
    done:        { type: Boolean, default: false },
    dueDate:     Date,
    recordingId: String,
    createdAt:   { type: Date, default: Date.now },
  }],
  createdAt: { type: Date, default: Date.now },
});

// ── Multer ────────────────────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_, file, cb) =>
      cb(null, `${Date.now()}${path.extname(file.originalname) || ".webm"}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

// ── R2 helpers ────────────────────────────────────────────
async function uploadToR2(localPath, key, contentType) {
  await new Upload({
    client: s3,
    params: { Bucket: BUCKET, Key: key, Body: fs.createReadStream(localPath), ContentType: contentType },
  }).done();
  if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  return `${R2_PUB}/${key}`;
}

async function downloadFromR2(key, destPath) {
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(destPath);
    Body.pipe(ws);
    ws.on("finish", resolve);
    ws.on("error", reject);
  });
}

async function deleteFromR2(key) {
  try { await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); }
  catch (e) { console.warn("R2 delete warning:", e.message); }
}

function getContentType(filename) {
  return path.extname(filename).toLowerCase() === ".wav" ? "audio/wav" : "audio/webm";
}

// ── Auth middleware ───────────────────────────────────────
async function auth(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  if (apiKey) {
    // Check global ESP32 key from env — attach admin user so req.user._id exists
    if (ESP32_KEY && apiKey === ESP32_KEY) {
      req.user = esp32User;
      if (!req.user) return res.status(500).json({ error: "No user found for ESP32 key" });
      return next();
    }
    // Check per-user API keys in DB
    const userByKey = await User.findOne({ apiKey }).maxTimeMS(8000);
    if (userByKey) { req.user = userByKey; return next(); }
  }
  const token = req.headers.authorization?.split(" ")[1] || req.query.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.userId) {
      req.user = await User.findById(payload.userId);
    }
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// ── AI helpers ────────────────────────────────────────────
async function transcribeAudio(filePath) {
  return openai.audio.transcriptions.create({
    file:        fs.createReadStream(filePath),
    model:       "whisper-1",
    language:    "en",
    temperature: 0,
    prompt:      "This is a personal voice memo about work tasks, meetings, ideas, projects, and to-do items. The speaker may mention names, deadlines, technical terms, or product names. Transcribe every word accurately, including incomplete sentences.",
  });
}

async function generateNotes(text) {
  const SYSTEM_PROMPT = `You are a deterministic meeting intelligence system and note-taker.
Your job is to extract structured, work-related information from voice recording transcripts.
The transcript may contain filler words, informal speech, or background noise — clean it up and extract the full meaning.

## STRICT RULES
1. Output ONLY valid JSON. No markdown fences, no explanation, no commentary outside JSON.
2. Be deterministic — same input must always produce the same output.
3. Do NOT hallucinate. Extract only what is explicitly stated or clearly implied.
4. Do NOT include personal conversations, greetings, jokes, or small talk.
5. If a field has no data, return [] or null. Never omit the field.

## TASK DETECTION (for actionItems)
Extract BOTH explicit and implicit forward-looking tasks:
  EXPLICIT: "Ram will send the report", "Finish the design by Monday"
  IMPLICIT: "We should check the sizing", "Someone needs to follow up with the vendor"
Do NOT extract past regrets ("we should have done that") or pure hypotheticals.

## PRIORITY IN SUMMARY
When writing Next Steps, order by urgency: items with deadlines or urgency words first.`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ai = await openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Analyse this voice recording transcript and return a JSON object with EXACTLY these fields:

"title": string — max 8 words, specific and descriptive (e.g. "Weekly Team Sync Follow-Up Tasks")

"summary": string — plain markdown string structured as follows:

## 🗂️ Overview\\n
2-4 sentences covering what was discussed, decided, or noted. Write in second person ("you discussed", "you mentioned"). Extract as much meaning as possible even from short recordings.\\n\\n
## 💡 Key Points\\n
- Each bullet is 1-2 sentences with context, names, numbers, or deadlines if mentioned.\\n
- Include every distinct topic, idea, or piece of information.\\n
- Do not skip minor points.\\n\\n
## 🔑 Decisions Made\\n
- List every decision with context behind it. Omit this section entirely if no decisions were made.\\n\\n
## ⚠️ Challenges & Concerns\\n
- List problems, blockers, or risks mentioned. Omit entirely if none.\\n\\n
## 🚀 Next Steps\\n
- List every next step or follow-up ordered by urgency (deadlines first).\\n
- Include implied next steps even if not explicitly stated.

"tags": array of 4-8 keyword strings covering topics, people, projects, and domains mentioned

"actionItems": array of concrete actionable tasks. Rules:
  - Include EVERY task — explicit and implicit, do not cap the list
  - Each item must start with a verb and be self-contained (include names, dates, details)
  - Exclude observations, facts, preferences, or general statements
  - Plain text only, no markdown, no bullet prefix
  - Deduplicate — same task mentioned twice appears once
  - Return [] if nothing actionable

Transcript: ${text}` },
        ],
      });
      return JSON.parse(ai.choices[0].message.content);
    } catch (e) {
      if (attempt === 1) throw e;
    }
  }
}

// ════════════════════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════════════════════

// ── POST /auth/login ──────────────────────────────────────
app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });

  try {
    let user = await User.findOne({ username });

    if (!user) {
      // Auto-migrate env credentials → first time creates DB user
      if (APP_USER && APP_PASS && username === APP_USER && password === APP_PASS) {
        const passwordHash = await bcrypt.hash(password, 10);
        user = await User.create({
          username,
          name: "Admin",
          email: "",
          passwordHash,
          apiKey: ESP32_KEY || crypto.randomBytes(32).toString("hex"),
        });
        console.log("✅ User auto-created from env credentials");
      } else {
        return res.status(401).json({ error: "Invalid credentials" });
      }
    } else {
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return res.status(401).json({ error: "Invalid credentials" });
    }

    await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });
    const token = jwt.sign({ username, userId: user._id.toString() }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token });
  } catch (err) {
    console.error("❌ Login:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Device heartbeat state (in-memory) ───────────────────
// ── Device state machine ──────────────────────────────────
// States: "offline" | "online" | "recording"
let deviceState        = "offline";
let deviceLastSeen     = null;
let recordingEndedAt   = null;
let deviceBattery      = null;   // 0-100 percentage, null = unknown

function setDeviceState(newState) {
  if (deviceState === newState) return;
  if (deviceState === "recording" && newState !== "recording") {
    recordingEndedAt = Date.now();
  }
  deviceState = newState;
  broadcast({ state: newState, lastSeen: deviceLastSeen, battery: deviceBattery });
  console.log(`[DEVICE] State → ${newState}`);
}

// Auto-offline: only when "online" and no ping for 4s
// After recording ends, give 20s grace (upload blocks heartbeats)
setInterval(() => {
  if (deviceState !== "online") return;
  const sinceLastSeen    = deviceLastSeen ? Date.now() - deviceLastSeen.getTime() : Infinity;
  const sinceRecordingEnd = recordingEndedAt ? Date.now() - recordingEndedAt : Infinity;
  const timeout          = sinceRecordingEnd < 30000 ? 30000 : 15000;
  if (sinceLastSeen > timeout) setDeviceState("offline");
}, 500);

// POST /device/heartbeat — called by ESP32 every 1.5s (pauses during recording)
app.post("/device/heartbeat", auth, (req, res) => {
  deviceLastSeen = new Date();
  const status   = req.body?.status;
  const legacy   = req.body?.recording;
  const battery  = req.body?.battery;

  if (battery !== undefined && battery !== null) {
    deviceBattery = Math.max(0, Math.min(100, Number(battery)));
  }

  if      (status === "recording")                   setDeviceState("recording");
  else if (status === "idle" || status === "online") setDeviceState("online");
  else if (legacy === true)                          setDeviceState("recording");
  else if (legacy === false)                         setDeviceState("online");
  else                                               setDeviceState("online");

  // Always broadcast latest battery even if state didn't change
  broadcast({ state: deviceState, lastSeen: deviceLastSeen, battery: deviceBattery });

  res.json({ status: "ok" });
});

// GET /device/status — REST fallback for initial page load
app.get("/device/status", auth, (req, res) => {
  res.json({ state: deviceState, lastSeen: deviceLastSeen, battery: deviceBattery });
});

// ── OAuth helper — issue JWT and redirect to frontend ────
function oauthSuccess(user, res) {
  const token = jwt.sign({ username: user.username, userId: user._id.toString() }, JWT_SECRET, { expiresIn: "30d" });
  res.redirect(`/app?token=${token}`);
}

// ── Google OAuth ──────────────────────────────────────────
app.get("/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);
app.get("/auth/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/app?error=oauth_failed" }),
  (req, res) => oauthSuccess(req.user, res)
);

// ── GitHub OAuth ──────────────────────────────────────────
app.get("/auth/github",
  passport.authenticate("github", { scope: ["user:email"] })
);
app.get("/auth/github/callback",
  passport.authenticate("github", { session: false, failureRedirect: "/app?error=oauth_failed" }),
  (req, res) => oauthSuccess(req.user, res)
);

// ── Apple (placeholder — implement when Apple Dev account ready) ──
app.get("/auth/apple", (req, res) => {
  res.redirect("/app?error=apple_coming_soon");
});

// ════════════════════════════════════════════════════════
//  USER / SETTINGS ROUTES
// ════════════════════════════════════════════════════════

// ── GET /api/user/profile ─────────────────────────────────
app.get("/api/user/profile", auth, async (req, res) => {
  if (!req.user) return res.status(404).json({ error: "User not found" });
  const u = req.user;
  res.json({
    username:  u.username,
    name:      u.name,
    email:     u.email,
    createdAt: u.createdAt,
    lastLogin: u.lastLogin,
  });
});

// ── PUT /api/user/profile ─────────────────────────────────
app.put("/api/user/profile", auth, async (req, res) => {
  if (!req.user) return res.status(404).json({ error: "User not found" });
  const { name, email } = req.body;
  const updated = await User.findByIdAndUpdate(
    req.user._id, { name: name || "", email: email || "" }, { new: true }
  );
  res.json({ username: updated.username, name: updated.name, email: updated.email });
});

// ── PUT /api/user/password ────────────────────────────────
app.put("/api/user/password", auth, async (req, res) => {
  if (!req.user) return res.status(404).json({ error: "User not found" });
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Both passwords required" });
  if (newPassword.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  const valid = await bcrypt.compare(currentPassword, req.user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await User.findByIdAndUpdate(req.user._id, { passwordHash });
  res.json({ status: "ok" });
});

// ── GET /api/user/api-key ─────────────────────────────────
app.get("/api/user/api-key", auth, async (req, res) => {
  if (!req.user) return res.status(404).json({ error: "User not found" });
  res.json({ apiKey: req.user.apiKey });
});

// ── POST /api/user/api-key — regenerate ──────────────────
app.post("/api/user/api-key", auth, async (req, res) => {
  if (!req.user) return res.status(404).json({ error: "User not found" });
  const newKey = crypto.randomBytes(32).toString("hex");
  await User.findByIdAndUpdate(req.user._id, { apiKey: newKey });
  res.json({ apiKey: newKey });
});

// ── DELETE /api/user/data — delete all recordings ─────────
app.delete("/api/user/data", auth, async (req, res) => {
  try {
    const recordings = await Recording.find({ userId: req.user._id });
    await Promise.all(recordings.map(r => deleteFromR2(r.filename)));
    await Recording.deleteMany({ userId: req.user._id });
    res.json({ status: "ok", deleted: recordings.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
//  PROJECT ROUTES
// ════════════════════════════════════════════════════════

app.get("/projects", auth, async (req, res) => {
  const projects = await Project.find({ userId: req.user._id }).sort({ createdAt: -1 });
  res.json(projects);
});

app.post("/projects", auth, async (req, res) => {
  const { name, emoji, color, description } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  const p = await Project.create({ userId: req.user._id, name, emoji: emoji||"📁", color: color||"#f59e0b", description: description||"" });
  res.json(p);
});

app.put("/projects/:id", auth, async (req, res) => {
  const p = await Project.findOneAndUpdate({ _id: req.params.id, userId: req.user._id }, req.body, { new: true });
  if (!p) return res.status(404).json({ error: "Not found" });
  res.json(p);
});

app.delete("/projects/:id", auth, async (req, res) => {
  await Project.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  res.json({ ok: true });
});

app.post("/projects/:id/tasks", auth, async (req, res) => {
  const { text, dueDate, recordingId } = req.body;
  const p = await Project.findOne({ _id: req.params.id, userId: req.user._id });
  if (!p) return res.status(404).json({ error: "Not found" });
  p.tasks.push({ text, dueDate: dueDate ? new Date(dueDate) : undefined, recordingId });
  await p.save();
  res.json(p);
});

app.put("/projects/:id/tasks/:taskId", auth, async (req, res) => {
  const p = await Project.findOne({ _id: req.params.id, userId: req.user._id });
  if (!p) return res.status(404).json({ error: "Not found" });
  const task = p.tasks.id(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  Object.assign(task, req.body);
  await p.save();
  res.json(p);
});

app.delete("/projects/:id/tasks/:taskId", auth, async (req, res) => {
  const p = await Project.findOne({ _id: req.params.id, userId: req.user._id });
  if (!p) return res.status(404).json({ error: "Not found" });
  p.tasks.pull({ _id: req.params.taskId });
  await p.save();
  res.json(p);
});

// ════════════════════════════════════════════════════════
//  RECORDING ROUTES
// ════════════════════════════════════════════════════════

// ── Shared processing pipeline (used by /upload and /upload/finalize) ──
async function processAudioFile(localPath, filename, userId, duration) {
  const transcription = await transcribeAudio(localPath);
  const text   = transcription.text;
  const parsed = await generateNotes(text);
  const fileUrl = await uploadToR2(localPath, filename, getContentType(filename));
  const recording = await Recording.create({
    userId,
    filename, fileUrl,
    transcript:  text,
    title:       parsed.title       || "Untitled Recording",
    summary:     parsed.summary     || "",
    tags:        Array.isArray(parsed.tags)        ? parsed.tags        : [],
    actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
    duration,
  });
  return recording;
}

// ── POST /upload/chunk — receive one chunk of a large file ─
app.post("/upload/chunk", auth, upload.single("chunk"), async (req, res) => {
  try {
    const { sessionId, chunkIndex, totalChunks } = req.body;
    if (!sessionId || chunkIndex === undefined || !req.file) {
      return res.status(400).json({ error: "Missing chunk data" });
    }
    const sessionDir = path.join(os.tmpdir(), `chunks_${sessionId}`);
    fs.mkdirSync(sessionDir, { recursive: true });
    const dest = path.join(sessionDir, `chunk_${String(Number(chunkIndex)).padStart(5, "0")}`);
    // Use copyFile+unlink instead of rename — rename fails across filesystem boundaries on some hosts
    fs.copyFileSync(req.file.path, dest);
    fs.unlinkSync(req.file.path);
    console.log(`📦 Chunk ${chunkIndex}/${Number(totalChunks)-1} saved: ${dest}`);
    res.json({ ok: true, chunkIndex: Number(chunkIndex), totalChunks: Number(totalChunks) });
  } catch (err) {
    console.error("❌ Chunk upload:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /upload/finalize — merge chunks and process ───────
app.post("/upload/finalize", auth, async (req, res) => {
  const { sessionId, filename, totalChunks, duration } = req.body;
  const sessionDir = path.join(os.tmpdir(), `chunks_${sessionId}`);
  const safeFilename = (filename || "recording.wav").replace(/[^a-zA-Z0-9._-]/g, "_");
  const mergedPath  = path.join(os.tmpdir(), `${Date.now()}_${safeFilename}`);
  try {
    const files = fs.existsSync(sessionDir) ? fs.readdirSync(sessionDir).sort() : [];
    console.log(`🔀 Finalize: sessionDir=${sessionDir}, found=${files.length}, expected=${totalChunks}`);
    if (files.length !== Number(totalChunks)) {
      return res.status(400).json({ error: `Expected ${totalChunks} chunks, got ${files.length}` });
    }
    // Stream-merge chunks in order — avoids loading entire file into memory
    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(mergedPath);
      writeStream.on("error", reject);
      writeStream.on("finish", resolve);
      const pipeNext = (i) => {
        if (i >= files.length) { writeStream.end(); return; }
        const readStream = fs.createReadStream(path.join(sessionDir, files[i]));
        readStream.on("error", reject);
        readStream.on("end", () => pipeNext(i + 1));
        readStream.pipe(writeStream, { end: false });
      };
      pipeNext(0);
    });
    fs.rmSync(sessionDir, { recursive: true, force: true });
    console.log(`✅ Merged ${files.length} chunks → ${mergedPath} (${fs.statSync(mergedPath).size} bytes)`);

    const recording = await processAudioFile(
      mergedPath,
      safeFilename,
      req.user._id,
      parseFloat(duration) || 0
    );
    res.json({ status: "ok", recording });
  } catch (err) {
    if (fs.existsSync(mergedPath)) fs.unlinkSync(mergedPath);
    if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
    console.error("❌ Finalize error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /upload — transcribe + AI + save ─────────────────
app.post("/upload", auth, upload.single("audio"), async (req, res) => {
  const { path: localPath, filename } = req.file;
  try {
    const duration = parseFloat(req.body.duration) || 0;
    const recording = await processAudioFile(localPath, filename, req.user._id, duration);
    res.json({ status: "ok", recording });
  } catch (err) {
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    console.error("❌ Upload:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /upload/presign — return a presigned R2 PUT URL ───
app.get("/upload/presign", auth, async (req, res) => {
  try {
    const { filename, contentType } = req.query;
    if (!filename) return res.status(400).json({ error: "filename required" });
    const key = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const command = new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      ContentType: contentType || "audio/wav",
    });
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
    res.json({ url, key });
  } catch (err) {
    console.error("❌ Presign:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /upload/process — process a file already in R2 ───
app.post("/upload/process", auth, async (req, res) => {
  const { key, duration } = req.body;
  if (!key) return res.status(400).json({ error: "key required" });
  const tmpPath = path.join(os.tmpdir(), `${Date.now()}_${path.basename(key)}`);
  try {
    await downloadFromR2(key, tmpPath);
    const transcription = await transcribeAudio(tmpPath);
    const text   = transcription.text;
    const parsed = await generateNotes(text);
    const fileUrl = `${R2_PUB}/${key}`;
    const recording = await Recording.create({
      userId:      req.user._id,
      filename:    key,
      fileUrl,
      transcript:  text,
      title:       parsed.title       || "Untitled Recording",
      summary:     parsed.summary     || "",
      tags:        Array.isArray(parsed.tags)        ? parsed.tags        : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      duration:    parseFloat(duration) || 0,
    });
    res.json({ status: "ok", recording });
  } catch (err) {
    console.error("❌ Process:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
});

// ── POST /save — audio only, no AI ───────────────────────
app.post("/save", auth, upload.single("audio"), async (req, res) => {
  const { path: localPath, filename } = req.file;
  const fileSizeBytes = fs.statSync(localPath).size;
  const duration = parseFloat(req.body.duration) || 0;
  console.log(`📥 /save received: ${filename}, size=${fileSizeBytes} bytes, duration=${duration}s`);

  // Respond immediately so ESP32 doesn't hit Render's 30s idle timeout
  // while we wait for R2 upload + MongoDB save
  res.json({ status: "ok" });

  // Background processing — client already got 200, ESP32 won't wait
  try {
    const fileUrl = await uploadToR2(localPath, filename, getContentType(filename));
    console.log(`☁️  Uploaded to R2: ${filename}`);

    // Save immediately with placeholder title so recording appears in UI right away
    const title = `Recording – ${new Date().toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })}`;
    const recording = await Recording.create({
      userId: req.user._id,
      filename, fileUrl, transcript: "", title,
      summary: "", tags: [], actionItems: [], duration,
    });
    console.log(`✅ Saved to DB: ${filename} (id=${recording._id})`);

    // Auto-analyse: transcribe + generate notes without user needing to click
    console.log(`🎙️  Auto-analysing ${filename}...`);
    const transcription = await transcribeAudio(localPath);
    const text = transcription.text;
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);

    if (text && text.trim().length > 0) {
      console.log(`✅ Whisper (${text.length} chars): "${text.substring(0, 80)}..."`);
      const parsed = await generateNotes(text);
      await Recording.findByIdAndUpdate(recording._id, {
        transcript:  text,
        title:       parsed.title       || title,
        summary:     parsed.summary     || "",
        tags:        Array.isArray(parsed.tags)        ? parsed.tags        : [],
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      });
      console.log(`✅ Auto-analysis complete for ${recording._id}`);
    } else {
      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
      console.warn(`⚠️  Whisper returned empty transcript for ${filename}`);
    }
  } catch (err) {
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    console.error("❌ Save/analyse (background):", err);
  }
});

// ── POST /recordings/:id/analyse ─────────────────────────
app.post("/recordings/:id/analyse", auth, async (req, res) => {
  try {
    const recording = await Recording.findOne({ _id: req.params.id, userId: req.user._id });
    if (!recording) return res.status(404).json({ error: "Not found" });

    console.log(`🔍 Analyse: ${recording._id}, filename=${recording.filename}`);

    // Step 1: Download from R2
    const tmpPath = path.join(os.tmpdir(), recording.filename);
    await downloadFromR2(recording.filename, tmpPath);
    const dlSize = fs.statSync(tmpPath).size;
    console.log(`📥 Downloaded from R2: ${dlSize} bytes`);

    if (dlSize < 1000) {
      fs.unlinkSync(tmpPath);
      return res.status(400).json({ error: `Audio file too small (${dlSize} bytes) — recording may be empty` });
    }

    // Step 2: Check OpenAI key
    if (!process.env.OPENAI_API_KEY) {
      fs.unlinkSync(tmpPath);
      return res.status(500).json({ error: "OPENAI_API_KEY not set on server" });
    }

    // Step 3: Transcribe with Whisper
    console.log(`🎙️  Sending ${dlSize} bytes to Whisper...`);
    const transcription = await transcribeAudio(tmpPath);
    const text = transcription.text;
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    console.log(`✅ Whisper transcript (${text.length} chars): "${text.substring(0, 80)}..."`);

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Whisper returned empty transcript — audio may be silence or noise" });
    }

    // Step 4: Generate notes
    console.log(`🧠 Generating AI notes...`);
    const parsed = await generateNotes(text);
    const updated = await Recording.findByIdAndUpdate(
      req.params.id,
      { transcript: text, title: parsed.title || recording.title, summary: parsed.summary || "",
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [] },
      { new: true }
    );
    console.log(`✅ Analysis complete for ${recording._id}`);
    res.json(updated);
  } catch (err) {
    console.error("❌ Analyse error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /debug/recording/:id — check file at every stage ──
app.get("/debug/recording/:id", auth, async (req, res) => {
  try {
    const recording = await Recording.findOne({ _id: req.params.id, userId: req.user._id });
    if (!recording) return res.status(404).json({ error: "Not found in DB" });

    // Check R2
    let r2Size = null, r2Error = null, wavHeaderValid = false;
    try {
      const { Body, ContentLength } = await s3.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: recording.filename })
      );
      // Read first 44 bytes to check WAV header
      const chunks = [];
      let read = 0;
      for await (const chunk of Body) {
        chunks.push(chunk);
        read += chunk.length;
        if (read >= 44) break;
      }
      const header = Buffer.concat(chunks).slice(0, 44);
      wavHeaderValid = header.slice(0,4).toString() === "RIFF" && header.slice(8,12).toString() === "WAVE";
      const sampleRate  = header.readUInt32LE(24);
      const bitsPerSamp = header.readUInt16LE(34);
      const channels    = header.readUInt16LE(22);
      r2Size = ContentLength;
      res.json({
        db: {
          id:       recording._id,
          filename: recording.filename,
          duration: recording.duration,
          fileUrl:  recording.fileUrl,
          hasTranscript: !!recording.transcript,
        },
        r2: {
          exists:       true,
          sizeBytes:    r2Size,
          wavHeaderOk:  wavHeaderValid,
          sampleRate,
          bitsPerSample: bitsPerSamp,
          channels,
        },
        openaiKeySet: !!process.env.OPENAI_API_KEY,
      });
    } catch (e) {
      r2Error = e.message;
      res.json({
        db: { id: recording._id, filename: recording.filename, duration: recording.duration },
        r2: { exists: false, error: r2Error },
        openaiKeySet: !!process.env.OPENAI_API_KEY,
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /recordings/:id/audio — proxy from R2 ────────────
app.get("/recordings/:id/audio", auth, async (req, res) => {
  try {
    const recording = await Recording.findOne({ _id: req.params.id, userId: req.user._id });
    if (!recording) return res.status(404).json({ error: "Not found" });

    const { Body } = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: recording.filename })
    );

    // Buffer the full file so Express can serve range requests (needed for audio seeking)
    const chunks = [];
    for await (const chunk of Body) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const contentType = getContentType(recording.filename);
    const total = buffer.length;
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const [startStr, endStr] = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(startStr, 10);
      const end   = endStr ? parseInt(endStr, 10) : total - 1;
      if (start >= total || end >= total) {
        res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
        return;
      }
      res.status(206);
      res.setHeader("Content-Range",  `bytes ${start}-${end}/${total}`);
      res.setHeader("Content-Length", end - start + 1);
      res.setHeader("Content-Type",   contentType);
      res.setHeader("Accept-Ranges",  "bytes");
      res.end(buffer.slice(start, end + 1));
    } else {
      res.setHeader("Content-Type",   contentType);
      res.setHeader("Content-Length", total);
      res.setHeader("Accept-Ranges",  "bytes");
      res.end(buffer);
    }
  } catch (err) {
    console.error("❌ Audio proxy:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /recordings ───────────────────────────────────────
app.get("/recordings", auth, async (req, res) => {
  try { res.json(await Recording.find({ userId: req.user._id }).sort({ createdAt: -1 })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /recordings/:id ────────────────────────────────
app.delete("/recordings/:id", auth, async (req, res) => {
  try {
    const recording = await Recording.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!recording) return res.status(404).json({ error: "Not found" });
    await deleteFromR2(recording.filename);
    res.json({ status: "ok" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /recordings/:id ─────────────────────────────────
app.patch("/recordings/:id", auth, async (req, res) => {
  try {
    const { title, summary, tags, actionItems } = req.body;
    const recording = await Recording.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id }, { title, summary, tags, actionItems }, { new: true }
    );
    if (!recording) return res.status(404).json({ error: "Not found" });
    res.json(recording);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /recordings/:id/action-items/:index ───────────
app.delete("/recordings/:id/action-items/:index", auth, async (req, res) => {
  try {
    const recording = await Recording.findOne({ _id: req.params.id, userId: req.user._id });
    if (!recording) return res.status(404).json({ error: "Not found" });
    const idx = parseInt(req.params.index, 10);
    if (isNaN(idx) || idx < 0 || idx >= recording.actionItems.length)
      return res.status(400).json({ error: "Invalid index" });
    recording.actionItems.splice(idx, 1);
    await recording.save();
    res.json(recording);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /chat — non-streaming fallback ──────────────────
app.post("/chat", auth, async (req, res) => {
  try {
    const { system, messages } = req.body;
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", max_tokens: 1000,
      messages: [
        { role: "system", content: system || "You are a helpful assistant." },
        ...(messages || []),
      ],
    });
    res.json({ content: response.choices[0].message.content });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /chat/stream — SSE streaming response ────────────
app.post("/chat/stream", auth, async (req, res) => {
  const { system, messages } = req.body;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const tools = [{
    type: "function",
    function: {
      name: "add_task_to_project",
      description: "Add a task to one of the user's projects",
      parameters: {
        type: "object",
        properties: {
          project_id:  { type: "string", description: "The _id of the project" },
          task_text:   { type: "string", description: "The task description" },
          due_date:    { type: "string", description: "Optional ISO due date (YYYY-MM-DD)" },
        },
        required: ["project_id", "task_text"],
      },
    },
  }];

  try {
    const allMessages = [
      { role: "system", content: system || "You are a helpful assistant." },
      ...(messages || []),
    ];

    // First pass — may trigger a tool call
    const firstRes = await openai.chat.completions.create({
      model: "gpt-4o-mini", max_tokens: 1200, stream: false,
      messages: allMessages,
      tools,
      tool_choice: "auto",
    });

    const firstMsg = firstRes.choices[0].message;

    if (firstMsg.tool_calls && firstMsg.tool_calls.length > 0) {
      const toolCall = firstMsg.tool_calls[0];
      const args = JSON.parse(toolCall.function.arguments);

      // Execute the tool
      let toolResult = "";
      try {
        const p = await Project.findOne({ _id: args.project_id, userId: req.user._id });
        if (!p) throw new Error("Project not found");
        p.tasks.push({ text: args.task_text, dueDate: args.due_date ? new Date(args.due_date) : undefined });
        await p.save();
        toolResult = `Task "${args.task_text}" added to project "${p.name}".`;
      } catch (e) {
        toolResult = `Failed to add task: ${e.message}`;
      }

      // Signal frontend to refresh
      res.write(`data: [TOOL_RESULT:${toolResult}]\n\n`);

      // Second pass with tool result — stream the final response
      const secondMessages = [
        ...allMessages,
        firstMsg,
        { role: "tool", tool_call_id: toolCall.id, content: toolResult },
      ];
      const stream2 = await openai.chat.completions.create({
        model: "gpt-4o-mini", max_tokens: 600, stream: true,
        messages: secondMessages,
      });
      for await (const chunk of stream2) {
        const token = chunk.choices[0]?.delta?.content || "";
        if (token) res.write(`data: ${token}\n\n`);
      }
    } else {
      // No tool call — stream from scratch
      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini", max_tokens: 1200, stream: true,
        messages: allMessages,
        tools,
        tool_choice: "none",
      });
      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || "";
        if (token) res.write(`data: ${token}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
  } catch (err) {
    res.write(`data: Error: ${err.message}\n\n`);
  } finally {
    res.end();
  }
});

// ── Fallback → React app ──────────────────────────────────
if (fs.existsSync(DIST)) {
  app.use((_, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.join(DIST, "index.html"));
  });
}

// ── HTTP + WebSocket server ───────────────────────────────
const server = http.createServer(app);
const wss    = new WebSocket.Server({ noServer: true });

// Only upgrade /ws path — everything else stays as normal HTTP
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/ws") { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
});

// Authenticate WS connection via token in query string: ?token=xxx
wss.on("connection", (ws, req) => {
  const url   = new URL(req.url, "http://localhost");
  const token = url.searchParams.get("token");
  try { jwt.verify(token, JWT_SECRET); } catch {
    ws.close(1008, "Unauthorized"); return;
  }
  // Send current state immediately on connect
  ws.send(JSON.stringify({ state: deviceState, lastSeen: deviceLastSeen, battery: deviceBattery }));
  ws.on("error", () => {}); // suppress unhandled errors
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

// Give ESP32 uploads up to 90s to process; prevents silent hangs on Render cold-starts
server.timeout = 90000;
server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
