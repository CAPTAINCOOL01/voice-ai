require("dotenv").config();

const express  = require("express");
const mongoose = require("mongoose");
const multer   = require("multer");
const cors     = require("cors");
const jwt      = require("jsonwebtoken");
const OpenAI   = require("openai");
const path     = require("path");
const fs       = require("fs");
const os       = require("os");
const { S3Client, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

// ── Config ───────────────────────────────────────────────
const PORT       = process.env.PORT       || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "changeme-set-in-env";
const APP_USER   = process.env.APP_USERNAME;
const APP_PASS   = process.env.APP_PASSWORD;
const ESP32_KEY  = process.env.ESP32_API_KEY;
const BUCKET     = process.env.R2_BUCKET;
const R2_PUB     = process.env.R2_PUBLIC_URL; // https://pub-xxx.r2.dev

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

// ── Serve React frontend (built files) ────────────────────
const DIST = path.join(__dirname, "..", "frontend", "dist");
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
}

// ── MongoDB ───────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB:", err));

// ── Model ─────────────────────────────────────────────────
const Recording = mongoose.model("Recording", {
  filename:    String,
  fileUrl:     String,   // Cloudflare R2 public URL
  transcript:  String,
  title:       String,
  summary:     String,
  tags:        [String],
  actionItems: [String],
  duration:    Number,
  createdAt:   { type: Date, default: Date.now },
});

// ── Multer — saves to OS temp dir ─────────────────────────
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
    params: {
      Bucket:      BUCKET,
      Key:         key,
      Body:        fs.createReadStream(localPath),
      ContentType: contentType,
    },
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
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (e) {
    console.warn("R2 delete warning:", e.message);
  }
}

function getContentType(filename) {
  return path.extname(filename).toLowerCase() === ".wav" ? "audio/wav" : "audio/webm";
}

// ── Auth middleware ───────────────────────────────────────
// Accepts: ESP32 static API key OR browser JWT
function auth(req, res, next) {
  if (ESP32_KEY && req.headers["x-api-key"] === ESP32_KEY) return next();
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    jwt.verify(token, JWT_SECRET);
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
//  ROUTES
// ════════════════════════════════════════════════════════

// ── POST /auth/login ──────────────────────────────────────
app.post("/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!APP_USER || !APP_PASS) return res.status(500).json({ error: "Auth not configured" });
  if (username !== APP_USER || password !== APP_PASS)
    return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token });
});

// ── POST /upload — transcribe + AI + save ─────────────────
app.post("/upload", auth, upload.single("audio"), async (req, res) => {
  const { path: localPath, filename } = req.file;
  try {
    const duration = parseFloat(req.body.duration) || 0;

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(localPath), model: "whisper-1",
    });
    const text   = transcription.text;
    const parsed = await generateNotes(text);
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

// ── POST /recordings/:id/analyse — run AI on saved file ──
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

    const parsed = await generateNotes(text);
    const updated = await Recording.findByIdAndUpdate(
      req.params.id,
      {
        transcript:  text,
        title:       parsed.title       || recording.title,
        summary:     parsed.summary     || "",
        tags:        Array.isArray(parsed.tags)        ? parsed.tags        : [],
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      },
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    console.error("❌ Analyse:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /recordings ───────────────────────────────────────
app.get("/recordings", auth, async (req, res) => {
  try {
    res.json(await Recording.find().sort({ createdAt: -1 }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /recordings/:id ────────────────────────────────
app.delete("/recordings/:id", auth, async (req, res) => {
  try {
    const recording = await Recording.findByIdAndDelete(req.params.id);
    if (!recording) return res.status(404).json({ error: "Not found" });
    await deleteFromR2(recording.filename);
    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /chat ────────────────────────────────────────────
app.post("/chat", auth, async (req, res) => {
  try {
    const { system, messages } = req.body;
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 1000,
      messages: [
        { role: "system", content: system || "You are a helpful assistant." },
        ...(messages || []),
      ],
    });
    res.json({ content: response.choices[0].message.content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Fallback → React app ──────────────────────────────────
if (fs.existsSync(DIST)) {
  app.use((_, res) => res.sendFile(path.join(DIST, "index.html")));
}

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
