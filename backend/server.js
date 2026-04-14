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
const { S3Client, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

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
  app.use(express.static(DIST));
}

// ── MongoDB ───────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
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

// ── Multer ────────────────────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_, file, cb) =>
      cb(null, `${Date.now()}${path.extname(file.originalname) || ".webm"}`),
  }),
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
    // Check global ESP32 key from env
    if (ESP32_KEY && apiKey === ESP32_KEY) return next();
    // Check per-user API keys in DB
    const userByKey = await User.findOne({ apiKey });
    if (userByKey) { req.user = userByKey; return next(); }
  }
  const token = req.headers.authorization?.split(" ")[1];
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
async function generateNotes(text) {
  const ai = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Turn transcripts into structured notes. Respond with valid JSON only." },
      { role: "user",   content: `Return JSON with exactly: title (max 8 words), summary (2-3 sentences), tags (array of 3 words), actionItems (array of up to 4 tasks, empty if none).\n\nTranscript: ${text}` },
    ],
    response_format: { type: "json_object" },
  });
  return JSON.parse(ai.choices[0].message.content);
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
let deviceLastSeen = null; // updated whenever ESP32 pings

// POST /device/heartbeat — called by ESP32 every 2s
app.post("/device/heartbeat", auth, (req, res) => {
  deviceLastSeen = new Date();
  res.json({ status: "ok" });
});

// GET /device/status — polled by frontend
app.get("/device/status", auth, (req, res) => {
  const online = deviceLastSeen && (Date.now() - deviceLastSeen.getTime()) < 6000; // 6s timeout
  res.json({ online: !!online, lastSeen: deviceLastSeen });
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
    const recordings = await Recording.find();
    await Promise.all(recordings.map(r => deleteFromR2(r.filename)));
    await Recording.deleteMany({});
    res.json({ status: "ok", deleted: recordings.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
//  RECORDING ROUTES
// ════════════════════════════════════════════════════════

// ── POST /upload — transcribe + AI + save ─────────────────
app.post("/upload", auth, upload.single("audio"), async (req, res) => {
  const { path: localPath, filename } = req.file;
  try {
    const duration = parseFloat(req.body.duration) || 0;
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(localPath), model: "whisper-1",
    });
    const text    = transcription.text;
    const parsed  = await generateNotes(text);
    const fileUrl = await uploadToR2(localPath, filename, getContentType(filename));
    const recording = await Recording.create({
      filename, fileUrl,
      transcript:  text,
      title:       parsed.title       || "Untitled Recording",
      summary:     parsed.summary     || "",
      tags:        Array.isArray(parsed.tags)        ? parsed.tags        : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      duration,
    });
    res.json({ status: "ok", recording });
  } catch (err) {
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    console.error("❌ Upload:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /save — audio only, no AI ───────────────────────
app.post("/save", auth, upload.single("audio"), async (req, res) => {
  const { path: localPath, filename } = req.file;
  try {
    const duration = parseFloat(req.body.duration) || 0;
    const fileUrl  = await uploadToR2(localPath, filename, getContentType(filename));
    const title    = `Recording – ${new Date().toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })}`;
    const recording = await Recording.create({
      filename, fileUrl, transcript: "", title,
      summary: "", tags: [], actionItems: [], duration,
    });
    res.json({ status: "ok", recording });
  } catch (err) {
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    console.error("❌ Save:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /recordings/:id/analyse ─────────────────────────
app.post("/recordings/:id/analyse", auth, async (req, res) => {
  try {
    const recording = await Recording.findById(req.params.id);
    if (!recording) return res.status(404).json({ error: "Not found" });
    const tmpPath = path.join(os.tmpdir(), recording.filename);
    await downloadFromR2(recording.filename, tmpPath);
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath), model: "whisper-1",
    });
    const text = transcription.text;
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    const parsed  = await generateNotes(text);
    const updated = await Recording.findByIdAndUpdate(
      req.params.id,
      { transcript: text, title: parsed.title || recording.title, summary: parsed.summary || "",
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [] },
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    console.error("❌ Analyse:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /recordings/:id/audio — proxy from R2 ────────────
app.get("/recordings/:id/audio", auth, async (req, res) => {
  try {
    const recording = await Recording.findById(req.params.id);
    if (!recording) return res.status(404).json({ error: "Not found" });
    const { Body, ContentType, ContentLength } = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: recording.filename })
    );
    res.setHeader("Content-Type", ContentType || getContentType(recording.filename));
    if (ContentLength) res.setHeader("Content-Length", ContentLength);
    res.setHeader("Accept-Ranges", "bytes");
    Body.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /recordings ───────────────────────────────────────
app.get("/recordings", auth, async (req, res) => {
  try { res.json(await Recording.find().sort({ createdAt: -1 })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /recordings/:id ────────────────────────────────
app.delete("/recordings/:id", auth, async (req, res) => {
  try {
    const recording = await Recording.findByIdAndDelete(req.params.id);
    if (!recording) return res.status(404).json({ error: "Not found" });
    await deleteFromR2(recording.filename);
    res.json({ status: "ok" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /recordings/:id ─────────────────────────────────
app.patch("/recordings/:id", auth, async (req, res) => {
  try {
    const { title, summary, tags, actionItems } = req.body;
    const recording = await Recording.findByIdAndUpdate(
      req.params.id, { title, summary, tags, actionItems }, { new: true }
    );
    if (!recording) return res.status(404).json({ error: "Not found" });
    res.json(recording);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /chat ────────────────────────────────────────────
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

// ── Fallback → React app ──────────────────────────────────
if (fs.existsSync(DIST)) {
  app.use((_, res) => res.sendFile(path.join(DIST, "index.html")));
}

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
