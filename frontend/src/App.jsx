import { useState, useRef, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:5000");

// Auth helpers — token stored in localStorage
const getToken  = ()    => localStorage.getItem("token");
const setToken  = (t)   => localStorage.setItem("token", t);
const clearToken = ()   => localStorage.removeItem("token");
const authFetch = (url, opts = {}) =>
  fetch(url, {
    ...opts,
    headers: { ...opts.headers, ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
  });

// ── Login Page ────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [username,  setUsername]  = useState("");
  const [password,  setPassword]  = useState("");
  const [showPass,  setShowPass]  = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const res  = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      setToken(data.token);
      onLogin();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight:"100vh", background:"#09090b", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap'); *{box-sizing:border-box;margin:0;padding:0}`}</style>
      <div style={{ width:"100%", maxWidth:380, padding:"0 20px" }}>
        {/* Logo */}
        <div style={{ display:"flex", alignItems:"center", gap:10, justifyContent:"center", marginBottom:40 }}>
          <div style={{ width:40, height:40, borderRadius:14, background:"linear-gradient(135deg,#f59e0b,#fb923c)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          <span style={{ fontFamily:"'Sora',sans-serif", fontWeight:800, fontSize:20, color:"#fff" }}>VoiceNote AI</span>
        </div>

        {/* Card */}
        <div style={{ background:"#18181b", border:"1px solid #27272a", borderRadius:20, padding:28 }}>
          <h2 style={{ fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:18, color:"#fff", marginBottom:6 }}>Sign in</h2>
          <p style={{ fontSize:13, color:"#52525b", marginBottom:24 }}>Enter your credentials to access your recordings</p>

          <form onSubmit={submit} style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <div>
              <label style={{ fontSize:12, color:"#a1a1aa", display:"block", marginBottom:6 }}>Username</label>
              <input value={username} onChange={e=>setUsername(e.target.value)} required
                style={{ width:"100%", background:"#09090b", border:"1px solid #27272a", borderRadius:10,
                  padding:"11px 14px", fontSize:14, color:"#fff", outline:"none" }}
                onFocus={e=>e.target.style.borderColor="#f59e0b"}
                onBlur={e=>e.target.style.borderColor="#27272a"}/>
            </div>
            <div>
              <label style={{ fontSize:12, color:"#a1a1aa", display:"block", marginBottom:6 }}>Password</label>
              <div style={{ position:"relative" }}>
                <input type={showPass ? "text" : "password"} value={password} onChange={e=>setPassword(e.target.value)} required
                  style={{ width:"100%", background:"#09090b", border:"1px solid #27272a", borderRadius:10,
                    padding:"11px 42px 11px 14px", fontSize:14, color:"#fff", outline:"none" }}
                  onFocus={e=>e.target.style.borderColor="#f59e0b"}
                  onBlur={e=>e.target.style.borderColor="#27272a"}/>
                <button type="button" onClick={()=>setShowPass(v=>!v)}
                  style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)",
                    background:"none", border:"none", cursor:"pointer", padding:0, color:"#a1a1aa", display:"flex" }}>
                  {showPass ? (
                    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div style={{ background:"rgba(239,68,68,.08)", border:"1px solid rgba(239,68,68,.2)",
                borderRadius:10, padding:"10px 14px", fontSize:12, color:"#f87171" }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              padding:"12px", borderRadius:12, border:"none", cursor: loading ? "default" : "pointer",
              background:"linear-gradient(135deg,#f59e0b,#fb923c)", color:"white",
              fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:14,
              opacity: loading ? 0.7 : 1, marginTop:4,
            }}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          {/* ── OR divider ── */}
          <div style={{ display:"flex", alignItems:"center", gap:12, margin:"20px 0" }}>
            <div style={{ flex:1, height:1, background:"#27272a" }} />
            <span style={{ fontSize:11, color:"#3f3f46", fontWeight:500, letterSpacing:1 }}>OR</span>
            <div style={{ flex:1, height:1, background:"#27272a" }} />
          </div>

          {/* ── Social buttons ── */}
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {/* Google */}
            <button onClick={()=> window.location.href="/auth/google"}
              style={{ width:"100%", padding:"11px 16px", borderRadius:10, border:"1px solid #e5e7eb",
                background:"#fff", color:"#111", fontSize:14, fontWeight:500, cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center", gap:10,
                fontFamily:"'DM Sans',sans-serif", transition:"opacity 0.15s" }}
              onMouseEnter={e=>e.currentTarget.style.opacity="0.9"}
              onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>

            {/* GitHub */}
            <button onClick={()=> window.location.href="/auth/github"}
              style={{ width:"100%", padding:"11px 16px", borderRadius:10, border:"1px solid #30363d",
                background:"#161b22", color:"#fff", fontSize:14, fontWeight:500, cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center", gap:10,
                fontFamily:"'DM Sans',sans-serif", transition:"background 0.15s" }}
              onMouseEnter={e=>e.currentTarget.style.background="#1c2128"}
              onMouseLeave={e=>e.currentTarget.style.background="#161b22"}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/>
              </svg>
              Continue with GitHub
            </button>

            {/* Apple */}
            <button onClick={()=> window.location.href="/auth/apple"}
              style={{ width:"100%", padding:"11px 16px", borderRadius:10, border:"1px solid #3a3a3a",
                background:"#000", color:"#fff", fontSize:14, fontWeight:500, cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center", gap:10,
                fontFamily:"'DM Sans',sans-serif", transition:"background 0.15s" }}
              onMouseEnter={e=>e.currentTarget.style.background="#111"}
              onMouseLeave={e=>e.currentTarget.style.background="#000"}>
              <svg width="16" height="18" viewBox="0 0 814 1000" fill="#fff">
                <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 420.7 0 297.3 0 179.8 0 120.4 13.6 64.4 46.5 17.4 68.6-11.1 111.6-28 151.4-28c99.2 0 166 65.1 212.5 65.1 45.3 0 123.5-69.1 235.2-69.1 37.5 0 139.8 3.8 210.5 99.2zm-244.9-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>
              </svg>
              Continue with Apple
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const fmtTime = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const GRADIENTS = [
  "linear-gradient(135deg,#f59e0b,#fb923c)",
  "linear-gradient(135deg,#8b5cf6,#7c3aed)",
  "linear-gradient(135deg,#10b981,#059669)",
  "linear-gradient(135deg,#3b82f6,#2563eb)",
  "linear-gradient(135deg,#ec4899,#be185d)",
  "linear-gradient(135deg,#14b8a6,#0f766e)",
];

const TAG_COLORS = [
  { bg:"rgba(59,130,246,.15)",  fg:"#60a5fa", bd:"rgba(59,130,246,.25)"  },
  { bg:"rgba(168,85,247,.15)",  fg:"#c084fc", bd:"rgba(168,85,247,.25)"  },
  { bg:"rgba(34,197,94,.15)",   fg:"#4ade80", bd:"rgba(34,197,94,.25)"   },
  { bg:"rgba(20,184,166,.15)",  fg:"#2dd4bf", bd:"rgba(20,184,166,.25)"  },
  { bg:"rgba(245,158,11,.15)",  fg:"#fbbf24", bd:"rgba(245,158,11,.25)"  },
  { bg:"rgba(244,114,182,.15)", fg:"#f472b6", bd:"rgba(244,114,182,.25)" },
];

// ── Animated wave bar ──────────────────────────────────
function WaveBar({ active, i, h = 32 }) {
  return (
    <div style={{
      width: 4, height: h, borderRadius: 3,
      background: active ? "#f59e0b" : "#3f3f46",
      animationName: active ? "waveA" : "waveI",
      animationDuration: active ? "0.75s" : "2s",
      animationDelay: `${(i * 0.06) % 0.8}s`,
      animationIterationCount: "infinite",
      animationTimingFunction: "ease-in-out",
      transformOrigin: "bottom",
      opacity: active ? 1 : 0.4,
      transition: "background 0.4s, opacity 0.4s",
    }} />
  );
}

// ── Tag chip ───────────────────────────────────────────
function Tag({ label, idx }) {
  const c = TAG_COLORS[idx % TAG_COLORS.length];
  return (
    <span style={{ display:"inline-flex", alignItems:"center", padding:"3px 10px", borderRadius:8,
      fontSize:11, fontWeight:500, background:c.bg, color:c.fg, border:`1px solid ${c.bd}` }}>
      {label}
    </span>
  );
}

// ── Full audio player ──────────────────────────────────
function AudioPlayer({ src, large }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProg]   = useState(0);
  const [dur, setDur]         = useState(0);
  const [speed, setSpeed]     = useState(1);
  const [error, setError]     = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!src || !el) return;

    setError(null); setPlaying(false); setProg(0); setDur(0);

    // Pass token as query param — avoids blob URLs entirely
    // Blob URLs cause ERR_REQUEST_RANGE_NOT_SATISFIABLE in Chrome (no range support on blobs)
    const directUrl = `${src}${src.includes("?") ? "&" : "?"}token=${getToken()}`;

    const onTime  = () => setProg(el.currentTime);
    const onMeta  = () => { if (el.duration && isFinite(el.duration)) setDur(el.duration); };
    const onEnded = () => { setPlaying(false); setProg(0); };
    const onErr   = () => {
      const code = el.error?.code;
      if (code === 4) setError("Audio format not supported by browser");
      else if (code === 3) setError("Audio file is corrupt or empty");
      else setError("Could not load audio");
    };

    el.addEventListener("timeupdate",     onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("ended",          onEnded);
    el.addEventListener("error",          onErr);

    el.src = directUrl;
    el.load();

    return () => {
      el.removeEventListener("timeupdate",     onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("ended",          onEnded);
      el.removeEventListener("error",          onErr);
      el.pause();
      el.src = "";
    };
  }, [src]);

  const toggle = () => {
    const el = ref.current; if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { el.play().then(() => setPlaying(true)).catch(e => { setError(`Playback failed: ${e.message}`); setPlaying(false); }); }
  };
  const skip   = (n) => { ref.current.currentTime = Math.min(Math.max(0, ref.current.currentTime + n), dur); };
  const seek   = (e) => { const r = e.currentTarget.getBoundingClientRect(); ref.current.currentTime = ((e.clientX - r.left) / r.width) * dur; };
  const cycleSpeed = () => {
    const speeds = [1, 1.25, 1.5, 2];
    const next   = speeds[(speeds.indexOf(speed) + 1) % speeds.length];
    ref.current.playbackRate = next; setSpeed(next);
  };

  const pct = dur ? (progress / dur) * 100 : 0;

  return (
    <div style={{ background:"#111113", border:"1px solid #27272a", borderRadius:16, padding: large ? 20 : 14 }}>
      <audio ref={ref} preload="auto" />
      {error && (
        <div style={{ textAlign:"center", color:"#f87171", fontSize:12, marginBottom:8 }}>{error}</div>
      )}
      {large && (
        <div style={{ display:"flex", alignItems:"flex-end", gap:2, height:48, justifyContent:"center", marginBottom:16 }}>
          {Array.from({length:36}).map((_,i)=>(
            <WaveBar key={i} active={playing} i={i} h={Math.max(8, Math.sin(i*0.35)*18+22)} />
          ))}
        </div>
      )}
      <div onClick={seek} style={{ height:6, background:"#27272a", borderRadius:3, cursor:"pointer", overflow:"hidden", marginBottom:8, position:"relative" }}>
        <div style={{ position:"absolute", left:0, top:0, height:"100%", width:`${pct}%`,
          background:"linear-gradient(90deg,#f59e0b,#fb923c)", borderRadius:3, transition:"width 0.1s linear" }} />
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#52525b", marginBottom:12 }}>
        <span>{fmtTime(progress)}</span><span>{fmtTime(dur)}</span>
      </div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap: large ? 18 : 12 }}>
        <button onClick={()=>skip(-10)} style={ghostBtn}>
          <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/>
          </svg>
        </button>
        <button onClick={toggle} style={{ ...roundBtn, width: large ? 52 : 40, height: large ? 52 : 40 }}>
          {playing
            ? <svg width={large?18:14} height={large?18:14} fill="white" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            : <svg width={large?20:16} height={large?20:16} fill="white" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>}
        </button>
        <button onClick={()=>skip(10)} style={ghostBtn}>
          <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-3.51"/>
          </svg>
        </button>
        {large && (
          <button onClick={cycleSpeed} style={{ ...ghostBtn, fontSize:11, fontFamily:"'Sora',sans-serif", fontWeight:700,
            width:36, color: speed!==1 ? "#f59e0b" : "#71717a", border:"1px solid #27272a", borderRadius:8, padding:"4px 0" }}>
            {speed}×
          </button>
        )}
      </div>
    </div>
  );
}

const roundBtn = {
  width:40, height:40, borderRadius:"50%", border:"none", cursor:"pointer",
  display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
  background:"linear-gradient(135deg,#f59e0b,#fb923c)",
};
const ghostBtn = {
  background:"none", border:"none", cursor:"pointer", color:"#71717a",
  display:"flex", alignItems:"center", justifyContent:"center",
  padding:6, borderRadius:8,
};

// ── Simple markdown renderer ────────────────────────────
function Markdown({ text }) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^###\s/.test(l))      { out.push(<p key={i} style={{ fontWeight:700, fontSize:13, color:"#f59e0b", margin:"10px 0 4px" }}>{l.replace(/^###\s/,"")}</p>); }
    else if (/^##\s/.test(l))  { out.push(<p key={i} style={{ fontWeight:700, fontSize:14, color:"#fbbf24", margin:"12px 0 4px" }}>{l.replace(/^##\s/,"")}</p>); }
    else if (/^#\s/.test(l))   { out.push(<p key={i} style={{ fontWeight:700, fontSize:15, color:"#fbbf24", margin:"14px 0 6px" }}>{l.replace(/^#\s/,"")}</p>); }
    else if (/^[-*]\s/.test(l)){ out.push(<div key={i} style={{ display:"flex", gap:8, margin:"2px 0" }}><span style={{ color:"#f59e0b", flexShrink:0 }}>•</span><span>{renderInline(l.replace(/^[-*]\s/,""))}</span></div>); }
    else if (/^\d+\.\s/.test(l)){ const n=l.match(/^(\d+)\.\s/)[1]; out.push(<div key={i} style={{ display:"flex", gap:8, margin:"2px 0" }}><span style={{ color:"#f59e0b", flexShrink:0, minWidth:16 }}>{n}.</span><span>{renderInline(l.replace(/^\d+\.\s/,""))}</span></div>); }
    else if (l.trim()==="")    { out.push(<div key={i} style={{ height:6 }}/>); }
    else                       { out.push(<p key={i} style={{ margin:"2px 0", lineHeight:1.65 }}>{renderInline(l)}</p>); }
    i++;
  }
  return <div style={{ fontSize:13, color:"#d4d4d8" }}>{out}</div>;
}

function renderInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (/^\*\*/.test(p)) return <strong key={i} style={{ color:"#e4e4e7", fontWeight:700 }}>{p.slice(2,-2)}</strong>;
    if (/^`/.test(p))    return <code key={i} style={{ background:"#27272a", padding:"1px 5px", borderRadius:4, fontSize:12, color:"#fb923c" }}>{p.slice(1,-1)}</code>;
    return p;
  });
}

// ── AI Chat Panel ──────────────────────────────────────
function AIChatPanel({ rec, onAnalyse, analysing }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [streaming, setStreaming] = useState("");
  const [copied, setCopied]     = useState(null);
  const bottomRef               = useRef(null);
  const hasTranscript           = !!rec.transcript;

  const SYSTEM = `You are an intelligent assistant helping a user analyse their voice recording.

Recording title: ${rec.title || "Untitled"}
Date: ${fmtDate(rec.createdAt)}
Duration: ${rec.duration > 0 ? fmtTime(Math.round(rec.duration)) : "unknown"}
${rec.summary ? `\nSummary: ${rec.summary}` : ""}
${rec.tags?.length ? `\nTags: ${rec.tags.join(", ")}` : ""}
${rec.transcript ? `\nFull transcript:\n${rec.transcript}` : "\n(No transcript available yet.)"}

Help the user understand and get value from this recording. Be concise, direct, and conversational.
Format responses clearly — use bullet points and headers where helpful.`;

  const STARTERS = [
    "What were the main decisions made?",
    "List all action items from this recording",
    "Write a one-paragraph executive summary",
    "What questions were left unanswered?",
    "Identify any risks or concerns mentioned",
  ];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming, loading]);

  const copyMsg = (text, idx) => {
    navigator.clipboard.writeText(text).then(() => { setCopied(idx); setTimeout(() => setCopied(null), 2000); });
  };

  const send = async (text) => {
    const userMsg = text || input.trim();
    if (!userMsg || loading) return;
    setInput("");

    const newMessages = [...messages, { role: "user", content: userMsg }];
    setMessages(newMessages);
    setLoading(true);
    setStreaming("");

    try {
      const res = await authFetch(`${API}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: SYSTEM, messages: newMessages }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // SSE format: "data: token\n\n"
        chunk.split("\n").forEach(line => {
          if (line.startsWith("data: ")) {
            const token = line.slice(6);
            if (token === "[DONE]") return;
            full += token;
            setStreaming(full);
          }
        });
      }

      setMessages(prev => [...prev, { role: "assistant", content: full }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Error connecting to AI. Please try again." }]);
    } finally {
      setLoading(false);
      setStreaming("");
    }
  };

  // No transcript gate
  if (!hasTranscript) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      height:"100%", gap:16, padding:20, textAlign:"center" }}>
      <div style={{ width:52, height:52, borderRadius:"50%", background:"rgba(167,139,250,.1)",
        border:"1px solid rgba(167,139,250,.25)", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <svg width="24" height="24" fill="none" stroke="#a78bfa" strokeWidth="1.5" viewBox="0 0 24 24">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
      </div>
      <div>
        <p style={{ fontSize:14, fontWeight:600, color:"#e4e4e7", margin:"0 0 6px" }}>No transcript yet</p>
        <p style={{ fontSize:12, color:"#52525b", margin:0, lineHeight:1.6 }}>
          Run AI analysis first so Ask AI has content to work with.
        </p>
      </div>
      <button onClick={() => onAnalyse(rec._id)} disabled={analysing} style={{
        display:"flex", alignItems:"center", gap:8, padding:"10px 22px",
        borderRadius:12, border:"none", cursor: analysing ? "default" : "pointer",
        background:"linear-gradient(135deg,#a78bfa,#7c3aed)", color:"white",
        fontSize:13, fontWeight:600, fontFamily:"'DM Sans',sans-serif", opacity: analysing ? 0.6 : 1,
      }}>
        {analysing ? "Analysing…" : "✦ Run AI Analysis"}
      </button>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", minHeight:0 }}>

      {/* Starter prompts */}
      {messages.length === 0 && (
        <div style={{ marginBottom:16, animation:"fadeUp 0.25s ease" }}>
          <p style={{ fontSize:11, color:"#52525b", marginBottom:10, fontWeight:500 }}>Ask anything about this recording:</p>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {STARTERS.map((s, i) => (
              <button key={i} onClick={() => send(s)} style={{
                textAlign:"left", padding:"9px 13px", borderRadius:10,
                background:"#18181b", border:"1px solid #27272a",
                color:"#a1a1aa", fontSize:12, cursor:"pointer",
                fontFamily:"'DM Sans',sans-serif", transition:"all 0.15s",
              }}
              onMouseEnter={e=>{ e.currentTarget.style.borderColor="rgba(167,139,250,.4)"; e.currentTarget.style.color="#c4b5fd"; }}
              onMouseLeave={e=>{ e.currentTarget.style.borderColor="#27272a"; e.currentTarget.style.color="#a1a1aa"; }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Message thread */}
      {messages.length > 0 && (
        <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:12, marginBottom:12, minHeight:0 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display:"flex", flexDirection:"column",
              alignItems: m.role === "user" ? "flex-end" : "flex-start",
              animation:"fadeUp 0.2s ease", gap:4 }}>
              <div style={{
                maxWidth:"88%", padding:"10px 14px", borderRadius:14,
                background: m.role === "user" ? "linear-gradient(135deg,#f59e0b,#fb923c)" : "#18181b",
                border: m.role === "assistant" ? "1px solid #27272a" : "none",
                color: m.role === "user" ? "white" : "#d4d4d8",
                lineHeight:1.65,
                borderBottomRightRadius: m.role === "user" ? 4 : 14,
                borderBottomLeftRadius:  m.role === "assistant" ? 4 : 14,
              }}>
                {m.role === "assistant" ? <Markdown text={m.content}/> : <span style={{ fontSize:13 }}>{m.content}</span>}
              </div>
              {m.role === "assistant" && (
                <button onClick={() => copyMsg(m.content, i)} style={{
                  background:"none", border:"none", cursor:"pointer", color: copied===i ? "#a78bfa" : "#3f3f46",
                  fontSize:11, padding:"2px 6px", borderRadius:6, display:"flex", alignItems:"center", gap:4,
                  transition:"color 0.2s",
                }}>
                  {copied===i ? "✓ Copied" : "Copy"}
                </button>
              )}
            </div>
          ))}

          {/* Streaming token display */}
          {loading && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", gap:4, animation:"fadeUp 0.2s ease" }}>
              <div style={{ maxWidth:"88%", padding:"10px 14px", borderRadius:14, borderBottomLeftRadius:4,
                background:"#18181b", border:"1px solid #27272a" }}>
                {streaming
                  ? <Markdown text={streaming + "▌"}/>
                  : <div style={{ display:"flex", gap:5, alignItems:"center" }}>
                      {[0,1,2].map(j=>(
                        <div key={j} style={{ width:6,height:6,borderRadius:"50%",background:"#52525b",
                          animationName:"waveA",animationDuration:"1s",animationDelay:`${j*0.18}s`,
                          animationIterationCount:"infinite",animationTimingFunction:"ease-in-out" }}/>
                      ))}
                    </div>
                }
              </div>
            </div>
          )}

          <div ref={bottomRef}/>
        </div>
      )}

      {/* Input row */}
      <div style={{ display:"flex", gap:8, flexShrink:0, marginTop: messages.length === 0 ? 8 : 0 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask about this recording…"
          disabled={loading}
          style={{
            flex:1, background:"#18181b", border:"1px solid #27272a",
            borderRadius:12, padding:"10px 14px", fontSize:13,
            color:"#d4d4d8", outline:"none", fontFamily:"'DM Sans',sans-serif",
            opacity: loading ? 0.6 : 1,
          }}
          onFocus={e=>e.target.style.borderColor="rgba(167,139,250,.5)"}
          onBlur={e=>e.target.style.borderColor="#27272a"}
        />
        <button onClick={() => send()} disabled={loading || !input.trim()} style={{
          width:42, height:42, borderRadius:12, border:"none", flexShrink:0,
          background: input.trim() && !loading ? "linear-gradient(135deg,#a78bfa,#7c3aed)" : "#27272a",
          cursor: input.trim() && !loading ? "pointer" : "default",
          display:"flex", alignItems:"center", justifyContent:"center", transition:"background 0.2s",
        }}>
          <svg width="16" height="16" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Detail side panel ──────────────────────────────────
function DetailPanel({ rec, recIndex, initialTab, onClose, onAnalyse, analysing }) {
  const [tab, setTab]       = useState(initialTab || "listen");
  const [items, setItems]   = useState(() => (rec.actionItems||[]).map((t,i)=>({id:i,text:t,done:false})));
  const [copied, setCopied] = useState(false);
  const [toast, setToast]   = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(()=>setToast(null), 2500); };
  const toggle = (id) => setItems(p => p.map(x => x.id===id ? {...x, done:!x.done} : x));

  const copyAll = () => {
    const txt = [
      `📝 ${rec.title}`, `📅 ${fmtDate(rec.createdAt)}`, ``,
      `📋 Summary`, rec.summary || "(none)", ``,
      ...(rec.actionItems?.length ? [`✅ Action Items`, ...rec.actionItems.map(a=>`  • ${a}`), ``] : []),
      ...(rec.tags?.length ? [`🏷  Tags: ${rec.tags.join(", ")}`, ``] : []),
      `📜 Transcript`, rec.transcript || "(none)",
    ].join("\n");
    navigator.clipboard.writeText(txt).then(()=>{ setCopied(true); showToast("Copied to clipboard!"); setTimeout(()=>setCopied(false),2500); });
  };

  const downloadTxt = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rec.transcript||""], {type:"text/plain"}));
    a.download = `${rec.title||"transcript"}.txt`; a.click();
    showToast("Transcript downloaded!");
  };

  const downloadAudio = async () => {
    showToast("Preparing download…");
    try {
      const r = await authFetch(`${API}/recordings/${rec._id}/audio`);
      const blob = await r.blob();
      const ext = rec.filename?.endsWith(".wav") ? "wav" : "webm";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${rec.title||"recording"}.${ext}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast("Audio download started!");
    } catch { showToast("Download failed — please try again."); }
  };

  const done     = items.filter(x=>x.done).length;
  const grad     = GRADIENTS[recIndex % GRADIENTS.length];
  const initials = (rec.title||"?").split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase();

  const TABS = [
    { id:"listen",     label:"Listen",     icon:<svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg> },
    { id:"summary",    label:"Summary",    icon:<svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> },
    { id:"actions",    label:"Tasks",      icon:<svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
      badge: items.length > 0 ? `${done}/${items.length}` : null,
      badgeColor: done===items.length && items.length>0 ? "#4ade80" : "#fbbf24" },
    { id:"transcript", label:"Transcript", icon:<svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/></svg> },
    // ── NEW AI CHAT TAB ──
    { id:"ai",         label:"Ask AI",     icon:<svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
      accent: true },
    { id:"share",      label:"Share",      icon:<svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> },
  ];

  return (
    <>
      <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.72)", zIndex:40, backdropFilter:"blur(4px)", WebkitBackdropFilter:"blur(4px)" }} />

      <div className="detail-panel" style={{
        position:"fixed", top:0, right:0, bottom:0, width:"min(540px,100vw)",
        background:"#0d0d0f", borderLeft:"1px solid #27272a",
        zIndex:50, display:"flex", flexDirection:"column", overflow:"hidden",
        animation:"panelIn 0.28s cubic-bezier(0.16,1,0.3,1)",
      }}>

        {/* Header */}
        <div style={{ padding:"20px 20px 14px", borderBottom:"1px solid #1f1f23", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:12 }}>
            <div style={{ width:46, height:46, borderRadius:14, background:grad, display:"flex", alignItems:"center", justifyContent:"center",
              color:"white", fontWeight:700, fontSize:14, fontFamily:"'Sora',sans-serif", flexShrink:0 }}>
              {initials}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <h2 style={{ margin:0, fontSize:16, fontWeight:700, color:"#fff", fontFamily:"'Sora',sans-serif", lineHeight:1.3 }}>
                {rec.title || "Untitled Recording"}
              </h2>
              <p style={{ margin:"4px 0 0", fontSize:12, color:"#52525b" }}>
                {fmtDate(rec.createdAt)}{rec.duration>0 && ` · ${fmtTime(Math.round(rec.duration))}`}
              </p>
            </div>
            <button onClick={onClose} style={{ ...ghostBtn, color:"#71717a", marginTop:-2 }}>
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          {(rec.tags||[]).length > 0 && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {rec.tags.map((t,i)=><Tag key={i} label={t} idx={i}/>)}
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div style={{ display:"flex", borderBottom:"1px solid #1f1f23", flexShrink:0, overflowX:"auto" }}>
          {TABS.map(tb=>(
            <button key={tb.id} onClick={()=>setTab(tb.id)} style={{
              flex:"0 0 auto", display:"flex", alignItems:"center", gap:5,
              padding:"11px 15px", background:"none", border:"none", cursor:"pointer",
              fontSize:12, fontWeight:600, fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap",
              color: tab===tb.id ? (tb.accent ? "#a78bfa" : "#f59e0b") : "#71717a",
              borderBottom: tab===tb.id
                ? `2px solid ${tb.accent ? "#a78bfa" : "#f59e0b"}`
                : "2px solid transparent",
              transition:"color 0.15s",
            }}>
              <span style={{ color: tab===tb.id ? (tb.accent ? "#a78bfa" : "#f59e0b") : "#52525b" }}>{tb.icon}</span>
              {tb.label}
              {tb.badge && (
                <span style={{ background:`${tb.badgeColor}20`, color:tb.badgeColor, borderRadius:999, padding:"1px 6px", fontSize:10 }}>
                  {tb.badge}
                </span>
              )}
              {tb.accent && tab !== tb.id && (
                <span style={{ background:"rgba(167,139,250,.15)", color:"#a78bfa", borderRadius:999, padding:"1px 6px", fontSize:9, fontWeight:700 }}>
                  NEW
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex:1, overflowY: tab === "ai" ? "hidden" : "auto", padding:20, display:"flex", flexDirection:"column", minHeight:0 }}>

          {/* ── LISTEN ── */}
          {tab==="listen" && (
            <div style={{ animation:"fadeUp 0.25s ease" }}>
              <AudioPlayer src={`${API}/recordings/${rec._id}/audio`} large />
              <p style={{ textAlign:"center", fontSize:11, color:"#3f3f46", marginTop:10 }}>
                Click the progress bar to jump · use speed button to go faster
              </p>
            </div>
          )}

          {/* ── SUMMARY ── */}
          {tab==="summary" && (
            <div style={{ animation:"fadeUp 0.25s ease", display:"flex", flexDirection:"column", gap:14 }}>
              {!rec.summary && (
                <div style={{ background:"rgba(245,158,11,.06)", border:"1px solid rgba(245,158,11,.2)",
                  borderRadius:14, padding:20, textAlign:"center" }}>
                  <svg width="28" height="28" fill="none" stroke="#f59e0b" strokeWidth="1.5" viewBox="0 0 24 24"
                    style={{ margin:"0 auto 10px", display:"block" }}>
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                  </svg>
                  <p style={{ fontSize:13, color:"#a1a1aa", margin:"0 0 14px", lineHeight:1.6 }}>
                    This recording hasn't been analysed yet.<br/>Run AI to get a summary, tags, and action items.
                  </p>
                  <button onClick={()=>onAnalyse(rec._id)} disabled={analysing} style={{
                    display:"inline-flex", alignItems:"center", gap:7, padding:"10px 20px",
                    borderRadius:12, border:"none", cursor: analysing ? "default" : "pointer",
                    background:"linear-gradient(135deg,#f59e0b,#fb923c)", color:"white",
                    fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:13,
                    opacity: analysing ? 0.7 : 1, transition:"filter 0.15s",
                  }}>
                    {analysing ? (
                      <><div style={{ width:12, height:12, borderRadius:"50%", border:"2px solid white", borderTopColor:"transparent", animation:"spin 0.7s linear infinite" }}/>Analysing…</>
                    ) : (
                      <><svg width="13" height="13" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>Analyse with AI</>
                    )}
                  </button>
                </div>
              )}
              {rec.summary && (
                <div style={{ background:"rgba(245,158,11,.06)", border:"1px solid rgba(245,158,11,.18)", borderRadius:14, padding:18 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:10 }}>
                    <svg width="13" height="13" fill="none" stroke="#f59e0b" strokeWidth="2" viewBox="0 0 24 24">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                    <span style={{ fontSize:12, fontWeight:700, color:"#f59e0b", fontFamily:"'Sora',sans-serif" }}>AI Summary</span>
                  </div>
                  <p style={{ fontSize:13, color:"#d4d4d8", lineHeight:1.75, margin:0 }}>{rec.summary}</p>
                </div>
              )}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                {[
                  { label:"Duration",     value: rec.duration>0 ? fmtTime(Math.round(rec.duration)) : "—" },
                  { label:"Action items", value: (rec.actionItems||[]).length },
                ].map(s=>(
                  <div key={s.label} style={{ background:"#18181b", border:"1px solid #27272a", borderRadius:12, padding:14 }}>
                    <p style={{ fontSize:10, color:"#52525b", margin:"0 0 4px", fontFamily:"'DM Sans',sans-serif" }}>{s.label}</p>
                    <p style={{ fontSize:22, fontWeight:700, color:"#fff", fontFamily:"'Sora',sans-serif", margin:0 }}>{s.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── TASKS ── */}
          {tab==="actions" && (
            <div style={{ animation:"fadeUp 0.25s ease" }}>
              {items.length === 0 ? (
                <div style={{ textAlign:"center", padding:"48px 0", color:"#52525b" }}>
                  <svg width="40" height="40" fill="none" stroke="#3f3f46" strokeWidth="1.5" viewBox="0 0 24 24" style={{ margin:"0 auto 12px", display:"block" }}>
                    <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                  </svg>
                  <p style={{ fontSize:13 }}>No action items found in this recording.</p>
                </div>
              ) : <>
                <div style={{ marginBottom:16 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#52525b", marginBottom:6 }}>
                    <span>{done} of {items.length} completed</span>
                    <span>{Math.round((done/items.length)*100)}%</span>
                  </div>
                  <div style={{ height:4, background:"#27272a", borderRadius:2, overflow:"hidden" }}>
                    <div style={{ height:"100%", borderRadius:2, width:`${(done/items.length)*100}%`,
                      background:"linear-gradient(90deg,#f59e0b,#fb923c)", transition:"width 0.4s ease" }} />
                  </div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {items.map(item=>(
                    <div key={item.id} onClick={()=>toggle(item.id)} style={{
                      display:"flex", alignItems:"flex-start", gap:12, padding:"12px 14px",
                      borderRadius:12, cursor:"pointer", background:"#18181b", border:"1px solid #27272a",
                      transition:"background 0.15s",
                    }}
                    onMouseEnter={e=>e.currentTarget.style.background="#1e1e22"}
                    onMouseLeave={e=>e.currentTarget.style.background="#18181b"}>
                      <div style={{ width:20, height:20, borderRadius:6, flexShrink:0, marginTop:1,
                        border:`2px solid ${item.done?"#f59e0b":"#3f3f46"}`,
                        background:item.done?"#f59e0b":"transparent",
                        display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.2s" }}>
                        {item.done && <svg width="10" height="10" fill="none" stroke="white" strokeWidth="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>}
                      </div>
                      <span style={{ fontSize:13, color:item.done?"#52525b":"#d4d4d8",
                        textDecoration:item.done?"line-through":"none", lineHeight:1.5, transition:"all 0.2s" }}>
                        {item.text}
                      </span>
                    </div>
                  ))}
                </div>
              </>}
            </div>
          )}

          {/* ── TRANSCRIPT ── */}
          {tab==="transcript" && (
            <div style={{ animation:"fadeUp 0.25s ease" }}>
              <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:12 }}>
                <button onClick={downloadTxt} style={{
                  display:"flex", alignItems:"center", gap:6, padding:"7px 14px",
                  borderRadius:10, background:"#18181b", border:"1px solid #27272a",
                  cursor:"pointer", fontSize:12, color:"#a1a1aa", fontFamily:"'DM Sans',sans-serif",
                  transition:"border-color 0.15s",
                }}
                onMouseEnter={e=>e.currentTarget.style.borderColor="#f59e0b"}
                onMouseLeave={e=>e.currentTarget.style.borderColor="#27272a"}>
                  <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Download .txt
                </button>
              </div>
              {rec.transcript ? (
                <div style={{ background:"#18181b", border:"1px solid #27272a", borderRadius:14, padding:18 }}>
                  {rec.transcript.split(/\n\n+/).map((p,i)=>(
                    <p key={i} style={{ fontSize:13, color:"#a1a1aa", lineHeight:1.85, margin:"0 0 14px" }}>{p}</p>
                  ))}
                </div>
              ) : (
                <p style={{ color:"#52525b", fontSize:13, textAlign:"center", padding:"40px 0" }}>No transcript available.</p>
              )}
            </div>
          )}

          {/* ── ASK AI (NEW) ── */}
          {tab==="ai" && (
            <div style={{ flex:1, display:"flex", flexDirection:"column", minHeight:0, animation:"fadeUp 0.25s ease" }}>
              {/* Header banner */}
              <div style={{ background:"rgba(167,139,250,.08)", border:"1px solid rgba(167,139,250,.2)",
                borderRadius:12, padding:"10px 14px", marginBottom:14, display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
                <div style={{ width:28, height:28, borderRadius:8, background:"rgba(167,139,250,.15)",
                  display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <svg width="14" height="14" fill="none" stroke="#a78bfa" strokeWidth="2" viewBox="0 0 24 24">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                  </svg>
                </div>
                <div>
                  <p style={{ fontSize:12, fontWeight:700, color:"#a78bfa", margin:0, fontFamily:"'Sora',sans-serif" }}>
                    Ask AI about this recording
                  </p>
                  <p style={{ fontSize:11, color:"#52525b", margin:0 }}>
                    {rec.transcript ? "Full transcript loaded as context" : "No transcript — AI will work from available metadata"}
                  </p>
                </div>
              </div>

              {/* Chat component — fills remaining space */}
              <div style={{ flex:1, display:"flex", flexDirection:"column", minHeight:0 }}>
                <AIChatPanel rec={rec} onAnalyse={onAnalyse} analysing={analysing} />
              </div>
            </div>
          )}

          {/* ── SHARE ── */}
          {tab==="share" && (
            <div style={{ animation:"fadeUp 0.25s ease", display:"flex", flexDirection:"column", gap:10 }}>
              <p style={{ fontSize:13, color:"#71717a", marginBottom:6 }}>Export your note in one click.</p>
              {[
                {
                  label:"Copy full note", desc:"Title · summary · tasks · tags · transcript",
                  icon:<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
                  action: copyAll, active: copied, activeLabel:"Copied!",
                },
                {
                  label:"Download transcript (.txt)", desc:"Save the full transcript as a text file",
                  icon:<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
                  action: downloadTxt,
                },
                {
                  label:"Download audio (.webm)", desc:"Save the original audio recording",
                  icon:<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>,
                  action: downloadAudio,
                },
              ].map((item,i)=>(
                <button key={i} onClick={item.action} style={{
                  display:"flex", alignItems:"center", gap:14, padding:"16px 18px",
                  background: item.active ? "rgba(16,185,129,.08)" : "#18181b",
                  border:`1px solid ${item.active ? "rgba(16,185,129,.3)" : "#27272a"}`,
                  borderRadius:14, cursor:"pointer", textAlign:"left", width:"100%", transition:"all 0.2s",
                }}
                onMouseEnter={e=>{ if(!item.active){ e.currentTarget.style.borderColor="rgba(245,158,11,.3)"; e.currentTarget.style.background="#1e1e22"; } }}
                onMouseLeave={e=>{ if(!item.active){ e.currentTarget.style.borderColor="#27272a"; e.currentTarget.style.background="#18181b"; } }}>
                  <div style={{ width:38, height:38, borderRadius:10, flexShrink:0,
                    background: item.active ? "rgba(16,185,129,.15)" : "#27272a",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    color: item.active ? "#4ade80" : "#a1a1aa" }}>
                    {item.icon}
                  </div>
                  <div>
                    <p style={{ margin:0, fontSize:13, fontWeight:600, fontFamily:"'Sora',sans-serif",
                      color: item.active ? "#4ade80" : "#fff" }}>
                      {item.active ? item.activeLabel : item.label}
                    </p>
                    <p style={{ margin:"2px 0 0", fontSize:11, color:"#52525b" }}>{item.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div style={{
          position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)",
          background:"#18181b", border:"1px solid #3f3f46", borderRadius:12,
          padding:"10px 20px", color:"#fff", fontSize:13, fontFamily:"'DM Sans',sans-serif",
          zIndex:999, animation:"fadeUp 0.2s ease", boxShadow:"0 8px 32px rgba(0,0,0,.5)",
          whiteSpace:"nowrap",
        }}>
          {toast}
        </div>
      )}
    </>
  );
}

// ── Recording card ─────────────────────────────────────
function RecordingCard({ rec, recIndex, onOpen, onDelete, onAnalyse, analysing }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const grad     = GRADIENTS[recIndex % GRADIENTS.length];
  const initials = (rec.title||"?").split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase();
  const taskCt   = (rec.actionItems||[]).length;

  const quickBtns = [
    { label:"Listen",     tab:"listen",     color:"#f59e0b" },
    { label:"Transcript", tab:"transcript", color:"#8b5cf6" },
    { label:"Tasks",      tab:"actions",    color:"#10b981" },
    { label:"Ask AI",     tab:"ai",         color:"#a78bfa" },   // ← new quick button
    { label:"Share",      tab:"share",      color:"#3b82f6" },
  ];

  return (
    <div style={{
      background:"#18181b", border:"1px solid #27272a", borderRadius:18, padding:16,
      animation:`fadeUp 0.4s ease both`, cursor:"pointer",
      transition:"transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease",
    }}
    onClick={()=>onOpen("listen")}
    onMouseEnter={e=>{ e.currentTarget.style.transform="translateY(-2px)"; e.currentTarget.style.boxShadow="0 8px 32px rgba(245,158,11,.1)"; e.currentTarget.style.borderColor="rgba(245,158,11,.25)"; }}
    onMouseLeave={e=>{ e.currentTarget.style.transform=""; e.currentTarget.style.boxShadow=""; e.currentTarget.style.borderColor=""; }}>

      <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
        <div style={{ width:42, height:42, borderRadius:13, background:grad, display:"flex", alignItems:"center",
          justifyContent:"center", color:"white", fontWeight:700, fontSize:13,
          fontFamily:"'Sora',sans-serif", flexShrink:0 }}>
          {initials}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <h3 style={{ margin:0, fontSize:14, fontWeight:600, color:"#fff", fontFamily:"'Sora',sans-serif",
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {rec.title || "Untitled Recording"}
          </h3>
          <p style={{ margin:"3px 0 0", fontSize:12, color:"#52525b" }}>
            {fmtDate(rec.createdAt)}{rec.duration>0 && ` · ${fmtTime(Math.round(rec.duration))}`}
          </p>
        </div>
        <button onClick={e=>{ e.stopPropagation(); setConfirmDelete(v=>!v); }} title="Delete recording"
          style={{ background:"none", border:"none", cursor:"pointer", padding:5, borderRadius:8,
            color:"#3f3f46", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center",
            transition:"color 0.15s" }}
          onMouseEnter={e=>e.currentTarget.style.color="#f87171"}
          onMouseLeave={e=>e.currentTarget.style.color="#3f3f46"}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
        <svg width="14" height="14" fill="none" stroke="#3f3f46" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink:0, marginTop:4 }}>
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>

      {confirmDelete && (
        <div onClick={e=>e.stopPropagation()} style={{
          marginTop:10, padding:"10px 14px", borderRadius:12,
          background:"rgba(239,68,68,.07)", border:"1px solid rgba(239,68,68,.2)",
          display:"flex", alignItems:"center", gap:10,
        }}>
          <span style={{ flex:1, fontSize:12, color:"#a1a1aa" }}>Delete this recording and its audio file?</span>
          <button onClick={()=>{ onDelete(rec._id); }} style={{ fontSize:12, fontWeight:700, color:"#f87171", background:"none", border:"none", cursor:"pointer" }}>Yes, delete</button>
          <button onClick={()=>setConfirmDelete(false)} style={{ fontSize:12, color:"#71717a", background:"none", border:"none", cursor:"pointer" }}>Cancel</button>
        </div>
      )}

      {rec.summary && (
        <p style={{ fontSize:12, color:"#71717a", margin:"10px 0 0", lineHeight:1.65,
          display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden" }}>
          {rec.summary}
        </p>
      )}

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:12, paddingTop:12, borderTop:"1px solid #1f1f23" }}>
        <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
          {(rec.tags||[]).map((t,i)=><Tag key={i} label={t} idx={i}/>)}
        </div>
        {taskCt > 0 && (
          <span style={{ fontSize:11, color:"#fbbf24", background:"rgba(245,158,11,.1)",
            border:"1px solid rgba(245,158,11,.2)", borderRadius:8, padding:"2px 8px", whiteSpace:"nowrap", flexShrink:0 }}>
            {taskCt} tasks
          </span>
        )}
      </div>

      <div style={{ display:"flex", gap:6, marginTop:10, flexWrap:"wrap" }} onClick={e=>e.stopPropagation()}>
        {quickBtns.map(btn=>(
          <button key={btn.tab} onClick={e=>{ e.stopPropagation(); onOpen(btn.tab); }} style={{
            fontSize:11, padding:"5px 11px", borderRadius:8,
            border:`1px solid ${btn.color}35`, background:`${btn.color}10`,
            color:btn.color, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontWeight:500,
            transition:"background 0.15s",
          }}
          onMouseEnter={e=>e.currentTarget.style.background=`${btn.color}22`}
          onMouseLeave={e=>e.currentTarget.style.background=`${btn.color}10`}>
            {btn.label}
          </button>
        ))}

        {!rec.transcript && (
          <button onClick={e=>{ e.stopPropagation(); onAnalyse(rec._id); }} disabled={analysing} style={{
            fontSize:11, padding:"5px 11px", borderRadius:8,
            border:"1px solid rgba(245,158,11,.4)", background:"rgba(245,158,11,.12)",
            color:"#fbbf24", cursor: analysing ? "default" : "pointer",
            fontFamily:"'DM Sans',sans-serif", fontWeight:600,
            display:"flex", alignItems:"center", gap:5,
            opacity: analysing ? 0.7 : 1, transition:"background 0.15s",
          }}
          onMouseEnter={e=>{ if(!analysing) e.currentTarget.style.background="rgba(245,158,11,.22)"; }}
          onMouseLeave={e=>e.currentTarget.style.background="rgba(245,158,11,.12)"}>
            {analysing ? (
              <><div style={{ width:9, height:9, borderRadius:"50%", border:"2px solid #fbbf24", borderTopColor:"transparent", animation:"spin 0.7s linear infinite" }}/>Analysing…</>
            ) : (
              <><svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>Analyse with AI</>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Skeleton ───────────────────────────────────────────
function Skeleton() {
  return (
    <div style={{ background:"#18181b", border:"1px solid #27272a", borderRadius:18, padding:16 }}>
      {["75%","50%","90%","40%"].map((w,i)=>(
        <div key={i} style={{ height:i===0?15:11, background:"#27272a", borderRadius:6,
          marginBottom:10, width:w, animation:"shimmer 1.5s ease-in-out infinite" }} />
      ))}
    </div>
  );
}

// ── App ────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(() => {
    // Also check for OAuth token in URL on first render
    const params = new URLSearchParams(window.location.search);
    const oauthToken = params.get("token");
    if (oauthToken) { setToken(oauthToken); window.history.replaceState({}, "", "/app"); return true; }
    return !!getToken();
  });
  // Show error toast if OAuth failed
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err === "apple_coming_soon") { showToast("Apple Sign In is coming soon."); window.history.replaceState({}, "", "/app"); }
    if (err === "oauth_failed")      { showToast("Sign in failed. Please try again."); window.history.replaceState({}, "", "/app"); }
  }, []);

  const [recording, setRecording]     = useState(false);
  const [audioBlob, setAudioBlob]     = useState(null);
  const [audioURL,  setAudioURL]      = useState(null);
  const [timer, setTimer]             = useState(0);
  const [uploading, setUploading]     = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadDone, setUploadDone]   = useState(false);
  const [uploadStage, setUploadStage] = useState("");

  const [recordings, setRecordings]   = useState([]);
  const [loadingRecs, setLoadingRecs] = useState(true);
  const [fetchError,  setFetchError]  = useState(null);
  const [selected, setSelected]       = useState(new Set());
  const [selectMode, setSelectMode]   = useState(false);
  const [deviceOnline, setDeviceOnline] = useState(false);
  const [deviceLastSeen, setDeviceLastSeen] = useState(null);
  const [search, setSearch]           = useState("");
  const [analysingId, setAnalysingId] = useState(null);
  const [activeRec, setActiveRec]     = useState(null);

  const mediaRef    = useRef(null);
  const chunksRef   = useRef([]);
  const timerRef    = useRef(null);
  const durationRef = useRef(0);

  const fetchRecordings = useCallback(async () => {
    try {
      setLoadingRecs(true); setFetchError(null);
      const res  = await authFetch(`${API}/recordings`);
      if (!res.ok) throw new Error("Server error");
      const data = await res.json();
      setRecordings(Array.isArray(data) ? data : []);
    } catch { setFetchError("Cannot connect — make sure server is running on port 5000."); }
    finally   { setLoadingRecs(false); }
  }, []);

  useEffect(()=>{ fetchRecordings(); }, [fetchRecordings]);

  const [deviceRecording, setDeviceRecording] = useState(false);

  // Real-time device status via WebSocket
  useEffect(() => {
    const wsBase = API.replace(/^https/, "wss").replace(/^http/, "ws");
    const token  = getToken();
    let ws, retryTimer;

    function applyState(state) {
      setDeviceOnline(state === "online" || state === "recording");
      setDeviceRecording(state === "recording");
    }

    function connect() {
      ws = new WebSocket(`${wsBase}/ws?token=${token}`);

      ws.onopen = async () => {
        // Also fetch REST fallback to get lastSeen on connect
        try {
          const r = await authFetch(`${API}/device/status`);
          const d = await r.json();
          applyState(d.state);
          setDeviceLastSeen(d.lastSeen);
        } catch {}
      };

      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          applyState(d.state);
          if (d.lastSeen) setDeviceLastSeen(d.lastSeen);
        } catch {}
      };

      ws.onclose = () => {
        applyState("offline");
        // Reconnect after 4s
        retryTimer = setTimeout(connect, 4000);
      };

      ws.onerror = () => ws.close();
    }

    connect();
    return () => { clearTimeout(retryTimer); if (ws) ws.close(); };
  }, []);

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;

  const startRecording = async () => {
    try {
      setAudioBlob(null); setAudioURL(null); setUploadDone(false);
      setUploadError(null); chunksRef.current = []; durationRef.current = 0;
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      const mr = new MediaRecorder(stream, { mimeType:"audio/webm" });
      mr.ondataavailable = e => { if(e.data.size>0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type:"audio/webm" });
        setAudioBlob(blob); setAudioURL(URL.createObjectURL(blob));
        stream.getTracks().forEach(t=>t.stop());
      };
      mr.start(); mediaRef.current = mr; setRecording(true); setTimer(0);
      timerRef.current = setInterval(()=>{ setTimer(t=>{ durationRef.current=t+1; return t+1; }); }, 1000);
    } catch { alert("Microphone access denied. Please allow microphone in your browser settings."); }
  };

  const stopRecording = () => {
    mediaRef.current?.stop(); mediaRef.current = null;
    clearInterval(timerRef.current); setRecording(false);
  };

  const uploadRecording = async () => {
    if (!audioBlob) return;
    setUploading(true); setUploadError(null); setUploadStage("transcribing");
    const stageTimer = setTimeout(()=>setUploadStage("summarising"), 5000);
    try {
      const form = new FormData();
      form.append("audio", audioBlob, "recording.webm");
      form.append("duration", String(durationRef.current));
      const res  = await authFetch(`${API}/upload`, { method:"POST", body:form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setUploadDone(true); setAudioBlob(null); setAudioURL(null); setTimer(0);
      await fetchRecordings();
    } catch (err) { setUploadError(err.message); }
    finally { clearTimeout(stageTimer); setUploading(false); setUploadStage(""); }
  };

  const saveRecording = async () => {
    if (!audioBlob) return;
    setUploading(true); setUploadError(null); setUploadStage("saving");
    try {
      const form = new FormData();
      form.append("audio", audioBlob, "recording.webm");
      form.append("duration", String(durationRef.current));
      const res  = await authFetch(`${API}/save`, { method:"POST", body:form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setUploadDone(true); setAudioBlob(null); setAudioURL(null); setTimer(0);
      await fetchRecordings();
    } catch (err) { setUploadError(err.message); }
    finally { setUploading(false); setUploadStage(""); }
  };

  const deleteRecording = async (id) => {
    try {
      const res = await authFetch(`${API}/recordings/${id}`, { method:"DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setRecordings(prev => prev.filter(r => r._id !== id));
      setSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
      if (activeRec?.rec._id === id) setActiveRec(null);
    } catch (err) { console.error("Delete error:", err); }
  };

  const deleteSelected = async () => {
    if (!selected.size) return;
    if (!window.confirm(`Delete ${selected.size} recording${selected.size>1?"s":""}?`)) return;
    await Promise.all([...selected].map(id => authFetch(`${API}/recordings/${id}`, { method:"DELETE" })));
    setRecordings(prev => prev.filter(r => !selected.has(r._id)));
    if (activeRec && selected.has(activeRec.rec._id)) setActiveRec(null);
    setSelected(new Set());
  };

  const deleteAll = async () => {
    if (!recordings.length) return;
    if (!window.confirm(`Delete all ${recordings.length} recordings? This cannot be undone.`)) return;
    await Promise.all(recordings.map(r => authFetch(`${API}/recordings/${r._id}`, { method:"DELETE" })));
    setRecordings([]);
    setSelected(new Set());
    setActiveRec(null);
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(r => r._id)));
  };

  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()); };

  const analyseRecording = async (id) => {
    setAnalysingId(id);
    try {
      const res  = await authFetch(`${API}/recordings/${id}/analyse`, { method:"POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      setRecordings(prev => prev.map(r => r._id === id ? data : r));
      if (activeRec?.rec._id === id) setActiveRec(prev => ({ ...prev, rec: data }));
    } catch (err) {
      console.error("Analyse error:", err);
      alert("Analysis failed: " + err.message);
    }
    finally { setAnalysingId(null); }
  };

  const filtered = recordings.filter(r =>
    !search ||
    (r.title||"").toLowerCase().includes(search.toLowerCase()) ||
    (r.summary||"").toLowerCase().includes(search.toLowerCase()) ||
    (r.tags||[]).some(t=>t.toLowerCase().includes(search.toLowerCase()))
  );

  const totalMins  = Math.round(recordings.reduce((a,r)=>a+(r.duration||0),0)/60);
  const totalTasks = recordings.reduce((a,r)=>a+(r.actionItems||[]).length,0);

  return (
    <div style={{ minHeight:"100vh", background:"#09090b", fontFamily:"'DM Sans',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap');
        @keyframes waveA   { 0%,100%{transform:scaleY(.2)} 50%{transform:scaleY(1)} }
        @keyframes waveI   { 0%,100%{transform:scaleY(.12)} 50%{transform:scaleY(.35)} }
        @keyframes pulseR  { 0%{transform:scale(1);opacity:.55} 100%{transform:scale(2.2);opacity:0} }
        @keyframes fadeUp  { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes panelIn { from{transform:translateX(100%)} to{transform:translateX(0)} }
        @keyframes panelUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
        @keyframes breathe { 0%,100%{opacity:.45} 50%{opacity:1} }
        @keyframes spin    { to{transform:rotate(360deg)} }
        @keyframes shimmer { 0%,100%{opacity:.4} 50%{opacity:.8} }
        @keyframes recPulse{ 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.4)} 50%{box-shadow:0 0 0 16px rgba(239,68,68,0)} }
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#3f3f46;border-radius:2px}
        button:focus{outline:none} input::placeholder{color:#3f3f46}

        /* ── Mobile ─────────────────────────────── */
        @media(max-width:600px){
          .nav-stats   { display:none !important; }
          .nav-signout span { display:none; }
          .rec-timer   { font-size:52px !important; letter-spacing:-2px !important; }
          .wave-bars   { height:36px !important; }
          .wave-bars > * { width:3px !important; }
          .rec-btn     { width:72px !important; height:72px !important; }
          .main-pad    { padding:20px 14px 100px !important; }
          .recorder-card { padding:24px 16px !important; border-radius:18px !important; }
          .detail-panel {
            position:fixed !important; inset:0 !important;
            width:100% !important; height:100% !important;
            border-radius:0 !important;
            animation:panelUp 0.28s cubic-bezier(.4,0,.2,1) !important;
          }
          .search-row  { flex-direction:column !important; align-items:stretch !important; gap:8px !important; }
          .search-row h2 { font-size:17px !important; }
          .search-controls { width:100% !important; }
          .search-controls input { width:100% !important; flex:1 !important; }
          .rec-actions { max-width:100% !important; }
          .nav-inner   { padding:0 14px !important; }
          .rec-status-badge { font-size:11px !important; }
        }
      `}</style>

      {/* NAVBAR */}
      <header style={{ position:"sticky", top:0, zIndex:20, borderBottom:"1px solid #1a1a1e",
        background:"rgba(9,9,11,.9)", backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)" }}>
        <div className="nav-inner" style={{ maxWidth:820, margin:"0 auto", padding:"0 20px", height:56,
          display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:32, height:32, borderRadius:12, background:"linear-gradient(135deg,#f59e0b,#fb923c)",
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              <svg width="16" height="16" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            </div>
            <span style={{ fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:15, color:"#fff" }}>VoiceNote AI</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:20 }}>
            {recordings.length > 0 && (
              <div className="nav-stats" style={{ display:"flex", gap:16 }}>
                {[{v:recordings.length,l:"notes"},{v:totalMins+"m",l:"recorded"},{v:totalTasks,l:"tasks"}].map(s=>(
                  <div key={s.l} style={{ fontSize:12, color:"#71717a", display:"flex", gap:4, alignItems:"baseline" }}>
                    <span style={{ fontWeight:700, color:"#a1a1aa", fontFamily:"'Sora',sans-serif" }}>{s.v}</span>
                    <span>{s.l}</span>
                  </div>
                ))}
              </div>
            )}
            <a href="/app/settings" style={{
              background:"none", border:"1px solid #27272a", borderRadius:8,
              padding:"5px 10px", color:"#71717a", cursor:"pointer", display:"flex", alignItems:"center",
              transition:"all 0.15s", textDecoration:"none",
            }}
            onMouseEnter={e=>{ e.currentTarget.style.borderColor="#f59e0b"; e.currentTarget.style.color="#f59e0b"; }}
            onMouseLeave={e=>{ e.currentTarget.style.borderColor="#27272a"; e.currentTarget.style.color="#71717a"; }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </a>
            <button className="nav-signout" onClick={()=>{ clearToken(); setAuthed(false); }} style={{
              background:"none", border:"1px solid #27272a", borderRadius:8,
              padding:"5px 11px", fontSize:11, color:"#71717a", cursor:"pointer",
              fontFamily:"'DM Sans',sans-serif", transition:"all 0.15s",
              display:"flex", alignItems:"center", gap:5,
            }}
            onMouseEnter={e=>{ e.currentTarget.style.borderColor="#ef4444"; e.currentTarget.style.color="#f87171"; }}
            onMouseLeave={e=>{ e.currentTarget.style.borderColor="#27272a"; e.currentTarget.style.color="#71717a"; }}>
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="main-pad" style={{ maxWidth:820, margin:"0 auto", padding:"32px 20px 80px" }}>

        {/* RECORDER */}
        <section style={{ marginBottom:48 }}>
          <h2 style={{ fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:20, color:"#fff", marginBottom:20 }}>
            New Recording
          </h2>
          <div className="recorder-card" style={{ background:"#18181b", border:"1px solid #27272a", borderRadius:24,
            padding:"32px 24px", display:"flex", flexDirection:"column", alignItems:"center", gap:24 }}>

            <div style={{
              display:"flex", alignItems:"center", gap:8, padding:"6px 18px",
              borderRadius:999, border:`1px solid ${recording?"rgba(239,68,68,.3)":audioBlob?"rgba(245,158,11,.3)":"#27272a"}`,
              background:recording?"rgba(239,68,68,.08)":audioBlob?"rgba(245,158,11,.08)":"transparent",
              fontSize:12, color:recording?"#f87171":audioBlob?"#fbbf24":"#71717a",
            }}>
              {recording && <span style={{ width:7,height:7,borderRadius:"50%",background:"#ef4444",animation:"breathe 1.5s infinite",display:"inline-block" }}/>}
              {recording ? "Recording in progress…" : audioBlob ? "Recording ready — choose an action below" : "Tap the button to start"}
            </div>

            <span className="rec-timer" style={{ fontFamily:"'Sora',sans-serif", fontWeight:800, fontSize:62, color:"#fff",
              letterSpacing:"-3px", lineHeight:1, fontVariantNumeric:"tabular-nums" }}>
              {fmtTime(timer)}
            </span>

            <div className="wave-bars" style={{ display:"flex", alignItems:"flex-end", gap:2, height:52 }}>
              {Array.from({length:30}).map((_,i)=><WaveBar key={i} active={recording} i={i}/>)}
            </div>

            <div style={{ position:"relative", display:"flex", alignItems:"center", justifyContent:"center" }}>
              {recording && <>
                <div style={{ position:"absolute", width:100, height:100, borderRadius:"50%", background:"rgba(239,68,68,.12)", animation:"pulseR 2s ease-in-out infinite" }}/>
                <div style={{ position:"absolute", width:100, height:100, borderRadius:"50%", background:"rgba(239,68,68,.07)", animation:"pulseR 2s ease-in-out infinite .7s" }}/>
              </>}
              <button className="rec-btn" onClick={recording ? stopRecording : startRecording} disabled={!!audioBlob || uploading}
                style={{
                  position:"relative", zIndex:1, width:88, height:88, borderRadius:"50%", border:"none",
                  cursor: audioBlob||uploading ? "default" : "pointer",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  background: audioBlob||uploading ? "#27272a" : recording ? "#ef4444" : "linear-gradient(135deg,#f59e0b,#fb923c)",
                  boxShadow: recording ? "0 0 40px rgba(239,68,68,.3)" : !audioBlob&&!uploading ? "0 0 40px rgba(245,158,11,.2)" : "none",
                  opacity: (audioBlob||uploading)&&!recording ? 0.3 : 1,
                  transition:"all 0.2s",
                  animation: recording ? "recPulse 2s ease-in-out infinite" : "none",
                }}>
                {recording
                  ? <svg width="28" height="28" fill="white" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                  : <svg width="32" height="32" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                      <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                    </svg>}
              </button>
            </div>

            {audioURL && audioBlob && !uploading && !uploadDone && (
              <div style={{ width:"100%", maxWidth:440, animation:"fadeUp 0.3s ease" }}>
                <p style={{ fontSize:11, color:"#52525b", marginBottom:8, textAlign:"center" }}>Preview your recording before uploading</p>
                <AudioPlayer src={audioURL}/>
              </div>
            )}

            {audioBlob && !uploading && !uploadDone && (
              <div className="rec-actions" style={{ display:"flex", flexDirection:"column", gap:8, width:"100%", maxWidth:400, animation:"fadeUp 0.3s ease" }}>
                <button onClick={uploadRecording} style={{
                  width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                  padding:"13px", borderRadius:14, border:"none", cursor:"pointer",
                  background:"linear-gradient(135deg,#f59e0b,#fb923c)", color:"white",
                  fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:13, transition:"filter 0.15s",
                }}
                onMouseEnter={e=>e.currentTarget.style.filter="brightness(1.1)"}
                onMouseLeave={e=>e.currentTarget.style.filter=""}>
                  <svg width="14" height="14" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                  </svg>
                  Analyse with AI (Whisper + GPT)
                </button>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={saveRecording} style={{
                    flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                    padding:"11px", borderRadius:14, border:"1px solid #3f3f46", background:"transparent",
                    cursor:"pointer", color:"#a1a1aa", fontFamily:"'DM Sans',sans-serif", fontWeight:600, fontSize:12, transition:"all 0.15s",
                  }}
                  onMouseEnter={e=>{ e.currentTarget.style.borderColor="#4ade80"; e.currentTarget.style.color="#4ade80"; }}
                  onMouseLeave={e=>{ e.currentTarget.style.borderColor="#3f3f46"; e.currentTarget.style.color="#a1a1aa"; }}>
                    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                      <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
                    </svg>
                    Save only
                  </button>
                  <button onClick={()=>{ setAudioBlob(null); setAudioURL(null); setTimer(0); }} style={{
                    flex:1, padding:"11px", borderRadius:14, border:"1px solid #3f3f46", background:"transparent",
                    cursor:"pointer", color:"#71717a", fontFamily:"'DM Sans',sans-serif", fontWeight:600, fontSize:12, transition:"all 0.15s",
                  }}
                  onMouseEnter={e=>{ e.currentTarget.style.borderColor="#ef4444"; e.currentTarget.style.color="#f87171"; }}
                  onMouseLeave={e=>{ e.currentTarget.style.borderColor="#3f3f46"; e.currentTarget.style.color="#71717a"; }}>
                    Discard
                  </button>
                </div>
                <p style={{ fontSize:11, color:"#3f3f46", textAlign:"center" }}>
                  "Save only" stores audio without using your OpenAI credits
                </p>
              </div>
            )}

            {uploading && (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12, animation:"fadeUp 0.3s ease" }}>
                <div style={{ display:"flex", gap:3 }}>
                  {Array.from({length:16}).map((_,i)=><WaveBar key={i} active i={i} h={20}/>)}
                </div>
                <p style={{ fontFamily:"'Sora',sans-serif", fontWeight:600, color:"#fff", fontSize:15 }}>
                  {uploadStage==="saving" ? "💾  Saving audio…" : uploadStage==="transcribing" ? "🎙️  Transcribing audio…" : "🧠  Generating AI notes…"}
                </p>
                <p style={{ fontSize:12, color:"#52525b" }}>
                  {uploadStage==="saving" ? "Just a moment…" : "Usually takes 10–20 seconds"}
                </p>
              </div>
            )}

            {uploadDone && (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10, animation:"fadeUp 0.3s ease" }}>
                <div style={{ width:54, height:54, borderRadius:"50%", background:"rgba(16,185,129,.1)",
                  border:"1px solid rgba(16,185,129,.3)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <svg width="26" height="26" fill="none" stroke="#10b981" strokeWidth="2.5" viewBox="0 0 24 24">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <p style={{ fontFamily:"'Sora',sans-serif", fontWeight:700, color:"#fff", fontSize:15 }}>Note saved!</p>
                <button onClick={()=>setUploadDone(false)} style={{ fontSize:12, color:"#f59e0b", background:"none", border:"none", cursor:"pointer" }}>
                  Record another →
                </button>
              </div>
            )}

            {uploadError && (
              <div style={{ background:"rgba(239,68,68,.08)", border:"1px solid rgba(239,68,68,.2)", borderRadius:12,
                padding:"12px 16px", fontSize:12, color:"#f87171", maxWidth:400, width:"100%", animation:"fadeUp 0.3s ease" }}>
                <strong>Error:</strong> {uploadError}
              </div>
            )}
          </div>
        </section>

        {/* RECORDINGS */}
        <section>
          <div className="search-row" style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
            marginBottom:16, gap:12, flexWrap:"wrap" }}>
            <h2 style={{ fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:20, color:"#fff" }}>
              Your Recordings
              {recordings.length>0 && (
                <span style={{ marginLeft:8, fontSize:14, color:"#52525b", fontWeight:500 }}>
                  ({recordings.length})
                </span>
              )}
            </h2>
            <div className="search-controls" style={{ display:"flex", gap:8, alignItems:"center" }}>
              <div style={{ position:"relative", flex:1 }}>
                <svg style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}
                  width="13" height="13" fill="none" stroke="#52525b" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…"
                  style={{ background:"#18181b", border:"1px solid #27272a", borderRadius:10,
                    padding:"8px 10px 8px 30px", fontSize:12, color:"#d4d4d8", outline:"none",
                    width:150, fontFamily:"'DM Sans',sans-serif", transition:"border-color 0.15s" }}
                  onFocus={e=>e.target.style.borderColor="#f59e0b"}
                  onBlur={e=>e.target.style.borderColor="#27272a"}/>
              </div>
              {recordings.length > 0 && !selectMode && (
                <button onClick={()=>setSelectMode(true)} style={{
                  display:"flex", alignItems:"center", gap:5, padding:"8px 14px",
                  borderRadius:999, background:"#18181b", border:"1px solid #27272a",
                  cursor:"pointer", fontSize:12, color:"#71717a", fontFamily:"'DM Sans',sans-serif", transition:"all 0.15s",
                }}
                onMouseEnter={e=>{ e.currentTarget.style.color="#fff"; e.currentTarget.style.borderColor="#3f3f46"; }}
                onMouseLeave={e=>{ e.currentTarget.style.color="#71717a"; e.currentTarget.style.borderColor="#27272a"; }}>
                  Select
                </button>
              )}
              <button onClick={fetchRecordings} disabled={loadingRecs} style={{
                display:"flex", alignItems:"center", gap:5, padding:"8px 12px",
                borderRadius:999, background:"#18181b", border:"1px solid #27272a",
                cursor:"pointer", fontSize:12, color:"#71717a", fontFamily:"'DM Sans',sans-serif", transition:"all 0.15s",
              }}
              onMouseEnter={e=>{ e.currentTarget.style.color="#fff"; e.currentTarget.style.borderColor="#3f3f46"; }}
              onMouseLeave={e=>{ e.currentTarget.style.color="#71717a"; e.currentTarget.style.borderColor="#27272a"; }}>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                  style={{ animation:loadingRecs?"spin 0.8s linear infinite":"none" }}>
                  <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
                Refresh
              </button>
            </div>
          </div>

          {/* Selection action bar — only visible in select mode */}
          {selectMode && (
            <div style={{
              display:"flex", alignItems:"center", gap:8, marginBottom:14, padding:"10px 14px",
              background:"#18181b", border:"1px solid #27272a", borderRadius:14, flexWrap:"wrap",
              animation:"fadeUp 0.2s ease",
            }}>
              {/* Select all toggle */}
              <button onClick={toggleSelectAll} style={{
                display:"flex", alignItems:"center", gap:6, padding:"6px 14px",
                borderRadius:999, background: selected.size===filtered.length ? "rgba(245,158,11,0.12)" : "transparent",
                border: selected.size===filtered.length ? "1px solid rgba(245,158,11,0.4)" : "1px solid #3f3f46",
                color: selected.size===filtered.length ? "#f59e0b" : "#a1a1aa",
                fontSize:12, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", transition:"all 0.15s",
              }}>
                {selected.size===filtered.length ? "✓ All selected" : `Select all (${filtered.length})`}
              </button>

              <span style={{ fontSize:12, color:"#52525b" }}>
                {selected.size > 0 ? `${selected.size} selected` : "None selected"}
              </span>

              <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
                {selected.size > 0 && (
                  <button onClick={deleteSelected} style={{
                    display:"flex", alignItems:"center", gap:6, padding:"7px 16px",
                    borderRadius:999, background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.35)",
                    color:"#f87171", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", transition:"all 0.15s",
                  }}
                  onMouseEnter={e=>{ e.currentTarget.style.background="rgba(239,68,68,0.22)"; }}
                  onMouseLeave={e=>{ e.currentTarget.style.background="rgba(239,68,68,0.12)"; }}>
                    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                    </svg>
                    Delete {selected.size}
                  </button>
                )}
                <button onClick={deleteAll} style={{
                  display:"flex", alignItems:"center", gap:6, padding:"7px 16px",
                  borderRadius:999, background:"rgba(239,68,68,0.07)", border:"1px solid rgba(239,68,68,0.2)",
                  color:"#f87171", fontSize:12, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", transition:"all 0.15s", opacity:0.8
                }}
                onMouseEnter={e=>{ e.currentTarget.style.opacity="1"; e.currentTarget.style.background="rgba(239,68,68,0.15)"; }}
                onMouseLeave={e=>{ e.currentTarget.style.opacity="0.8"; e.currentTarget.style.background="rgba(239,68,68,0.07)"; }}>
                  <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                  Delete all
                </button>
                <button onClick={exitSelectMode} style={{
                  padding:"7px 14px", borderRadius:999, background:"transparent",
                  border:"1px solid #3f3f46", color:"#71717a", fontSize:12, cursor:"pointer",
                  fontFamily:"'DM Sans',sans-serif", transition:"all 0.15s",
                }}
                onMouseEnter={e=>{ e.currentTarget.style.color="#fff"; e.currentTarget.style.borderColor="#52525b"; }}
                onMouseLeave={e=>{ e.currentTarget.style.color="#71717a"; e.currentTarget.style.borderColor="#3f3f46"; }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {fetchError && (
            <div style={{ background:"rgba(239,68,68,.08)", border:"1px solid rgba(239,68,68,.2)",
              borderRadius:14, padding:16, color:"#f87171", fontSize:13, marginBottom:16 }}>
              {fetchError}
            </div>
          )}

          {loadingRecs && (
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <Skeleton/><Skeleton/><Skeleton/>
            </div>
          )}

          {!loadingRecs && !fetchError && recordings.length===0 && (
            <div style={{ textAlign:"center", padding:"64px 0" }}>
              <div style={{ width:64, height:64, borderRadius:20, background:"#18181b", border:"1px solid #27272a",
                display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px" }}>
                <svg width="28" height="28" fill="none" stroke="#52525b" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
                </svg>
              </div>
              <p style={{ fontFamily:"'Sora',sans-serif", fontWeight:600, color:"#52525b", fontSize:15 }}>No recordings yet</p>
              <p style={{ fontSize:13, color:"#3f3f46", marginTop:6 }}>Record something above — AI will turn it into structured notes.</p>
            </div>
          )}

          {!loadingRecs && recordings.length>0 && filtered.length===0 && (
            <div style={{ textAlign:"center", padding:"40px 0", color:"#52525b", fontSize:13 }}>
              No results for "{search}"
            </div>
          )}

          {!loadingRecs && filtered.length>0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {filtered.map((rec,i)=>{
                const isSelected = selected.has(rec._id);
                return (
                  <div key={rec._id} style={{ display:"flex", alignItems:"center", gap:10, transition:"all 0.2s" }}>
                    {/* Custom round checkbox — only shown in select mode */}
                    {selectMode && (
                      <button onClick={()=>toggleSelect(rec._id)} style={{
                        width:24, height:24, borderRadius:"50%", flexShrink:0, cursor:"pointer",
                        border: isSelected ? "2px solid #ef4444" : "2px solid #3f3f46",
                        background: isSelected ? "#ef4444" : "transparent",
                        display:"flex", alignItems:"center", justifyContent:"center",
                        transition:"all 0.15s", padding:0,
                      }}>
                        {isSelected && (
                          <svg width="12" height="12" fill="none" stroke="#fff" strokeWidth="3" viewBox="0 0 24 24">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        )}
                      </button>
                    )}
                    <div style={{ flex:1, minWidth:0,
                      outline: selectMode && isSelected ? "2px solid rgba(239,68,68,0.35)" : "2px solid transparent",
                      borderRadius:16, transition:"outline 0.15s",
                    }}
                    onClick={selectMode ? ()=>toggleSelect(rec._id) : undefined}
                    >
                      <RecordingCard
                        rec={rec}
                        recIndex={recordings.indexOf(rec)}
                        onOpen={selectMode ? ()=>toggleSelect(rec._id) : (tab)=>setActiveRec({ rec, recIndex:recordings.indexOf(rec), tab })}
                        onDelete={deleteRecording}
                        onAnalyse={analyseRecording}
                        analysing={analysingId === rec._id}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {activeRec && (
        <DetailPanel
          rec={activeRec.rec}
          recIndex={activeRec.recIndex}
          initialTab={activeRec.tab}
          onClose={()=>setActiveRec(null)}
          onAnalyse={analyseRecording}
          analysing={analysingId === activeRec.rec._id}
        />
      )}
    </div>
  );
}