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
    // Check global ESP32 key from env — attach admin user so req.user._id exists
    if (ESP32_KEY && apiKey === ESP32_KEY) {
      req.user = await User.findOne({ username: APP_USER }) || await User.findOne({ provider: "local" }) || await User.findOne();
      if (!req.user) return res.status(500).json({ error: "No user found for ESP32 key" });
      return next();
    }
    // Check per-user API keys in DB
    const userByKey = await User.findOne({ apiKey });
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
// ── Device state machine ──────────────────────────────────
// States: "offline" | "online" | "recording"
let deviceState     = "offline";
let deviceLastSeen  = null;

function setDeviceState(newState) {
  if (deviceState === newState) return; // no change, no broadcast
  deviceState = newState;
  broadcast({ state: newState, lastSeen: deviceLastSeen });
  console.log(`[DEVICE] State → ${newState}`);
}

// Auto-offline: if no ping for 10s, mark offline
setInterval(() => {
  if (deviceState !== "offline" && deviceLastSeen && Date.now() - deviceLastSeen.getTime() > 10000) {
    setDeviceState("offline");
  }
}, 2000);

// POST /device/heartbeat — called by ESP32 every 2s (pauses during recording)
app.post("/device/heartbeat", auth, (req, res) => {
  deviceLastSeen = new Date();
  const status   = req.body?.status; // "online" | "recording" | "idle"
  const legacy   = req.body?.recording; // backwards compat with old firmware

  if      (status === "recording")         setDeviceState("recording");
  else if (status === "idle" || status === "online") setDeviceState("online");
  else if (legacy === true)                setDeviceState("recording");
  else if (legacy === false)               setDeviceState("online");
  else                                     setDeviceState("online"); // bare ping = online

  res.json({ status: "ok" });
});

// GET /device/status — REST fallback for initial page load
app.get("/device/status", auth, (req, res) => {
  res.json({ state: deviceState, lastSeen: deviceLastSeen });
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
      userId: req.user._id,
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
    const fileSizeBytes = fs.statSync(localPath).size;
    const duration = parseFloat(req.body.duration) || 0;
    console.log(`📥 /save received: ${filename}, size=${fileSizeBytes} bytes, duration=${duration}s, user=${req.user._id}`);

    // Validate minimum file size (at least 44 bytes header + some audio)
    if (fileSizeBytes < 1000) {
      console.warn(`⚠️  File too small (${fileSizeBytes} bytes) — likely empty recording`);
    }

    const fileUrl = await uploadToR2(localPath, filename, getContentType(filename));
    console.log(`☁️  Uploaded to R2: ${filename}`);

    const title = `Recording – ${new Date().toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })}`;
    const recording = await Recording.create({
      userId: req.user._id,
      filename, fileUrl, transcript: "", title,
      summary: "", tags: [], actionItems: [], duration,
    });
    console.log(`✅ Saved to DB: ${recording._id}, filename=${filename}`);
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
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath), model: "whisper-1",
    });
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
  ws.send(JSON.stringify({ state: deviceState, lastSeen: deviceLastSeen }));
  ws.on("error", () => {}); // suppress unhandled errors
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
