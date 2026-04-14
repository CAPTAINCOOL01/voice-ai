import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const NAV_LINKS = ["Features", "Hardware", "Pricing", "Vision"];

const FEATURES = [
  {
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
      </svg>
    ),
    title: "Web & Hardware Recording",
    desc: "Record from your browser or our dedicated ESP32 device — one button, instant capture.",
  },
  {
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
    title: "AI Transcription",
    desc: "Powered by OpenAI Whisper — accurate transcripts in seconds, in any language.",
  },
  {
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    ),
    title: "Summaries & Action Items",
    desc: "GPT-4 extracts key decisions, tags, and tasks — so you never miss a follow-up.",
  },
  {
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    ),
    title: "Chat With Your Recordings",
    desc: "Ask questions about any recording. Get answers grounded in what was actually said.",
  },
  {
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <line x1="8" y1="21" x2="16" y2="21"/>
        <line x1="12" y1="17" x2="12" y2="21"/>
      </svg>
    ),
    title: "Any Device, Anywhere",
    desc: "Access your entire recording library from any phone, tablet, or laptop worldwide.",
  },
  {
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
    title: "Secure & Private",
    desc: "JWT-authenticated access, encrypted cloud storage. Your data stays yours.",
  },
];

const PLANS = [
  {
    name: "Individual",
    badge: "Most Popular",
    badgeColor: "#f59e0b",
    price: "$29",
    period: "/month",
    tagline: "Your personal AI memory",
    color: "linear-gradient(135deg,#f59e0b,#fb923c)",
    hardware: true,
    features: [
      "VoiceNote AI hardware device included",
      "One-button recording, works offline",
      "Auto-sync when connected to WiFi",
      "AI transcription + summaries",
      "Action item extraction",
      "Chat with any recording",
      "Cloud storage (10 GB)",
      "Access from any device",
    ],
  },
  {
    name: "Corporate Software",
    badge: "Software Only",
    badgeColor: "#6366f1",
    price: "$99",
    period: "/month",
    tagline: "Team-wide voice intelligence",
    color: "linear-gradient(135deg,#6366f1,#8b5cf6)",
    hardware: false,
    features: [
      "Up to 20 team members",
      "Shared recording dashboard",
      "Role-based access control",
      "AI transcription + summaries",
      "Slack & Notion integration",
      "Admin analytics dashboard",
      "Priority AI processing",
      "100 GB cloud storage",
    ],
  },
  {
    name: "Enterprise",
    badge: "Meeting Rooms",
    badgeColor: "#10b981",
    price: "Custom",
    period: "",
    tagline: "Intelligence built into your office",
    color: "linear-gradient(135deg,#10b981,#059669)",
    hardware: true,
    features: [
      "Dedicated mic devices per meeting room",
      "Continuous meeting capture",
      "Auto-generated meeting minutes",
      "Speaker identification",
      "Enterprise SSO (SAML/OKTA)",
      "Unlimited team members",
      "Admin + compliance dashboard",
      "Dedicated onboarding & support",
    ],
  },
];

const PROBLEMS = [
  { icon: "😓", title: "You forget meetings", desc: "By end of day, 70% of what was discussed is gone. Important decisions fade into noise." },
  { icon: "📝", title: "Notes are incomplete", desc: "Manual note-taking splits your focus. You either listen or write — rarely both." },
  { icon: "🎙️", title: "Voice is wasted", desc: "Every conversation holds insight. Today that insight disappears the moment the call ends." },
];

const STEPS = [
  { n: "01", title: "Record", desc: "Press one button on the device or hit record in the browser. That's it." },
  { n: "02", title: "Upload", desc: "The file syncs automatically to your secure cloud dashboard." },
  { n: "03", title: "AI Processes", desc: "Whisper transcribes. GPT-4 extracts summaries, tags, and action items." },
  { n: "04", title: "Structured Output", desc: "A fully organised note ready to share, search, or chat with." },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMenuOpen(false);
  };

  return (
    <div style={{ background: "#09090b", color: "#fff", fontFamily: "'DM Sans', sans-serif", overflowX: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@700;800;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        ::selection { background: rgba(245,158,11,0.3); }
        @keyframes fadeUp { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:translateY(0); } }
        @keyframes float { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-10px); } }
        @keyframes glow { 0%,100% { opacity:0.5; } 50% { opacity:1; } }
        .fade-up { animation: fadeUp 0.7s ease both; }
        .plan-card:hover { transform: translateY(-6px); transition: transform 0.3s ease; }
        .feat-card:hover { border-color: #f59e0b44 !important; background: #1c1c1f !important; }
        .nav-link { cursor:pointer; color:#a1a1aa; font-size:14px; font-weight:500; transition:color 0.2s; }
        .nav-link:hover { color:#fff; }
        @media (max-width: 768px) {
          .hero-btns { flex-direction: column !important; }
          .plans-grid { grid-template-columns: 1fr !important; }
          .features-grid { grid-template-columns: 1fr !important; }
          .problems-grid { grid-template-columns: 1fr !important; }
          .steps-grid { grid-template-columns: 1fr 1fr !important; }
          .hero-title { font-size: 38px !important; }
          .nav-desktop { display: none !important; }
          .nav-mobile-btn { display: flex !important; }
        }
      `}</style>

      {/* ── Navbar ── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        padding: "0 24px", height: 64,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: scrolled ? "rgba(9,9,11,0.9)" : "transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        borderBottom: scrolled ? "1px solid #18181b" : "none",
        transition: "all 0.3s ease",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg,#f59e0b,#fb923c)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          <span style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 17, color: "#fff" }}>VoiceNote AI</span>
        </div>

        <div className="nav-desktop" style={{ display: "flex", gap: 32 }}>
          {NAV_LINKS.map(l => (
            <span key={l} className="nav-link" onClick={() => scrollTo(l.toLowerCase())}>{l}</span>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => navigate("/app")} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #27272a", background: "transparent", color: "#a1a1aa", fontSize: 14, fontWeight: 500, cursor: "pointer", transition: "all 0.2s" }}
            onMouseEnter={e => { e.target.style.borderColor = "#f59e0b"; e.target.style.color = "#fff"; }}
            onMouseLeave={e => { e.target.style.borderColor = "#27272a"; e.target.style.color = "#a1a1aa"; }}>
            Sign in
          </button>
          <button onClick={() => scrollTo("pricing")} style={{ padding: "8px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#f59e0b,#fb923c)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            Get Started
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "120px 24px 80px", position: "relative", overflow: "hidden" }}>
        {/* Background glow */}
        <div style={{ position: "absolute", top: "20%", left: "50%", transform: "translateX(-50%)", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,158,11,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />

        <div style={{ maxWidth: 800, position: "relative" }}>
          <div className="fade-up" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 100, padding: "6px 16px", fontSize: 13, color: "#f59e0b", fontWeight: 500, marginBottom: 28 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", animation: "glow 2s infinite" }} />
            Now available — hardware + software bundle
          </div>

          <h1 className="fade-up hero-title" style={{ fontFamily: "'Sora',sans-serif", fontWeight: 900, fontSize: 64, lineHeight: 1.1, letterSpacing: "-2px", marginBottom: 24, animationDelay: "0.1s" }}>
            Your AI-powered<br />
            <span style={{ background: "linear-gradient(135deg,#f59e0b,#fb923c)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              voice memory system
            </span>
          </h1>

          <p className="fade-up" style={{ fontSize: 20, color: "#71717a", lineHeight: 1.7, maxWidth: 560, margin: "0 auto 40px", animationDelay: "0.2s" }}>
            Record anything. Let AI turn your conversations into structured notes, summaries, and action items — instantly.
          </p>

          <div className="fade-up hero-btns" style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", animationDelay: "0.3s" }}>
            <button onClick={() => navigate("/app")} style={{ padding: "14px 32px", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#f59e0b,#fb923c)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "'Sora',sans-serif" }}>
              Start for free →
            </button>
            <button onClick={() => scrollTo("pricing")} style={{ padding: "14px 32px", borderRadius: 12, border: "1px solid #27272a", background: "transparent", color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
              View Plans
            </button>
          </div>

          {/* Hero device mockup */}
          <div className="fade-up" style={{ marginTop: 64, animationDelay: "0.4s" }}>
            <div style={{ background: "#111113", border: "1px solid #27272a", borderRadius: 20, padding: "24px 32px", display: "inline-block", textAlign: "left", animation: "float 4s ease-in-out infinite" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#f59e0b,#fb923c)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="16" height="16" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>Team Standup — Apr 14</div>
                  <div style={{ fontSize: 11, color: "#52525b" }}>Just now • 00:03:42</div>
                </div>
                <div style={{ marginLeft: "auto", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: "#10b981", fontWeight: 600 }}>AI Ready</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {["standup","product","action items"].map(t => (
                  <span key={t} style={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#a1a1aa" }}>{t}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Problem ── */}
      <section id="features" style={{ padding: "80px 24px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <p style={{ color: "#f59e0b", fontSize: 13, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>The Problem</p>
          <h2 style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 40, letterSpacing: "-1px" }}>Conversations disappear</h2>
          <p style={{ color: "#71717a", fontSize: 16, marginTop: 12, maxWidth: 500, margin: "12px auto 0" }}>Every day, valuable insights vanish the moment a meeting ends.</p>
        </div>
        <div className="problems-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          {PROBLEMS.map(p => (
            <div key={p.title} style={{ background: "#111113", border: "1px solid #1c1c1f", borderRadius: 16, padding: 28 }}>
              <div style={{ fontSize: 36, marginBottom: 16 }}>{p.icon}</div>
              <h3 style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 10 }}>{p.title}</h3>
              <p style={{ color: "#71717a", fontSize: 14, lineHeight: 1.7 }}>{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Solution ── */}
      <section style={{ padding: "80px 24px", background: "#0a0a0d" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <p style={{ color: "#f59e0b", fontSize: 13, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>How It Works</p>
            <h2 style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 40, letterSpacing: "-1px" }}>Four steps to never forget again</h2>
          </div>
          <div className="steps-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
            {STEPS.map((s, i) => (
              <div key={s.n} style={{ position: "relative" }}>
                {i < STEPS.length - 1 && (
                  <div style={{ position: "absolute", top: 20, left: "60%", width: "80%", height: 1, background: "linear-gradient(90deg,#27272a,transparent)", zIndex: 0 }} />
                )}
                <div style={{ position: "relative", zIndex: 1 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg,#f59e0b22,#fb923c22)", border: "1px solid #f59e0b33", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                    <span style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 13, color: "#f59e0b" }}>{s.n}</span>
                  </div>
                  <h3 style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 17, marginBottom: 8 }}>{s.title}</h3>
                  <p style={{ color: "#71717a", fontSize: 14, lineHeight: 1.7 }}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section style={{ padding: "80px 24px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <p style={{ color: "#f59e0b", fontSize: 13, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>Features</p>
          <h2 style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 40, letterSpacing: "-1px" }}>Everything you need</h2>
        </div>
        <div className="features-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {FEATURES.map(f => (
            <div key={f.title} className="feat-card" style={{ background: "#111113", border: "1px solid #1c1c1f", borderRadius: 16, padding: 24, transition: "all 0.2s", cursor: "default" }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "#f59e0b", marginBottom: 16 }}>
                {f.icon}
              </div>
              <h3 style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 8 }}>{f.title}</h3>
              <p style={{ color: "#71717a", fontSize: 14, lineHeight: 1.7 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Hardware ── */}
      <section id="hardware" style={{ padding: "80px 24px", background: "#0a0a0d" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, alignItems: "center" }}>
          <div>
            <p style={{ color: "#f59e0b", fontSize: 13, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", marginBottom: 16 }}>Hardware Device</p>
            <h2 style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 40, letterSpacing: "-1px", marginBottom: 20, lineHeight: 1.2 }}>
              One button.<br />Total recall.
            </h2>
            <p style={{ color: "#71717a", fontSize: 16, lineHeight: 1.8, marginBottom: 32 }}>
              Our custom ESP32-based recording device fits in your pocket. Press the button — it records. No app, no phone, no friction. When it reconnects to WiFi, everything uploads and gets processed automatically.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                ["🔴", "One-button recording", "Press to start, press to stop. Dead simple."],
                ["📡", "Automatic WiFi sync", "Recordings upload when back in range."],
                ["🔋", "Battery powered", "Carry it anywhere — meetings, walks, calls."],
                ["🔒", "Secure API key auth", "Only your dashboard can receive recordings."],
              ].map(([icon, title, desc]) => (
                <div key={title} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 20, marginTop: 2 }}>{icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 3 }}>{title}</div>
                    <div style={{ color: "#71717a", fontSize: 14 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Device visual */}
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div style={{ width: 220, height: 340, background: "#111113", border: "1px solid #27272a", borderRadius: 32, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, position: "relative", boxShadow: "0 0 80px rgba(245,158,11,0.06)" }}>
              <div style={{ position: "absolute", top: 20, width: 40, height: 4, background: "#27272a", borderRadius: 2 }} />
              <div style={{ width: 80, height: 80, borderRadius: "50%", background: "linear-gradient(135deg,#f59e0b,#fb923c)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 40px rgba(245,158,11,0.3)", animation: "float 3s ease-in-out infinite" }}>
                <svg width="32" height="32" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
                </svg>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "#52525b", marginBottom: 4 }}>VoiceNote Device</div>
                <div style={{ fontSize: 11, color: "#3f3f46" }}>v1.0 · ESP32</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[1,2,3].map(i => (
                  <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i === 1 ? "#10b981" : "#27272a" }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" style={{ padding: "80px 24px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <p style={{ color: "#f59e0b", fontSize: 13, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>Pricing</p>
          <h2 style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 40, letterSpacing: "-1px", marginBottom: 14 }}>Choose your plan</h2>
          <p style={{ color: "#71717a", fontSize: 16 }}>From personal use to enterprise meeting rooms.</p>
        </div>
        <div className="plans-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          {PLANS.map((plan, i) => (
            <div key={plan.name} className="plan-card" style={{
              background: "#111113",
              border: i === 0 ? "1px solid rgba(245,158,11,0.3)" : "1px solid #1c1c1f",
              borderRadius: 20, padding: 28,
              position: "relative",
              transition: "transform 0.3s ease",
            }}>
              {i === 0 && (
                <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "linear-gradient(135deg,#f59e0b,#fb923c)", borderRadius: 100, padding: "4px 16px", fontSize: 12, fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }}>
                  Most Popular
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <h3 style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 18 }}>{plan.name}</h3>
                <span style={{ background: `${plan.badgeColor}18`, border: `1px solid ${plan.badgeColor}33`, borderRadius: 6, padding: "3px 10px", fontSize: 11, color: plan.badgeColor, fontWeight: 600 }}>{plan.badge}</span>
              </div>
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontFamily: "'Sora',sans-serif", fontWeight: 900, fontSize: 40, background: plan.color, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{plan.price}</span>
                <span style={{ color: "#52525b", fontSize: 14 }}>{plan.period}</span>
              </div>
              <p style={{ color: "#71717a", fontSize: 14, marginBottom: 24 }}>{plan.tagline}</p>
              <div style={{ width: "100%", height: 1, background: "#1c1c1f", marginBottom: 24 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
                {plan.features.map(f => (
                  <div key={f} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <svg width="16" height="16" fill="none" stroke={plan.badgeColor} strokeWidth="2.5" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 2 }}>
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <span style={{ fontSize: 14, color: "#a1a1aa", lineHeight: 1.5 }}>{f}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => navigate("/app")} style={{
                width: "100%", padding: "12px", borderRadius: 12, border: "none", cursor: "pointer",
                background: i === 0 ? "linear-gradient(135deg,#f59e0b,#fb923c)" : "#18181b",
                color: i === 0 ? "#fff" : "#a1a1aa",
                border: i === 0 ? "none" : "1px solid #27272a",
                fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 14,
                transition: "all 0.2s",
              }}>
                {plan.price === "Custom" ? "Contact Sales" : "Get Started"}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ── Vision ── */}
      <section id="vision" style={{ padding: "100px 24px", background: "#0a0a0d", textAlign: "center" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <p style={{ color: "#f59e0b", fontSize: 13, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", marginBottom: 20 }}>Our Vision</p>
          <h2 style={{ fontFamily: "'Sora',sans-serif", fontWeight: 900, fontSize: 48, letterSpacing: "-2px", lineHeight: 1.15, marginBottom: 24 }}>
            Build a world where<br />
            <span style={{ background: "linear-gradient(135deg,#f59e0b,#fb923c)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              no conversation is ever lost.
            </span>
          </h2>
          <p style={{ color: "#71717a", fontSize: 18, lineHeight: 1.8, maxWidth: 600, margin: "0 auto" }}>
            We believe every idea spoken aloud deserves to be remembered. VoiceNote AI bridges the gap between human conversation and structured knowledge — for individuals, teams, and enterprises.
          </p>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section style={{ padding: "80px 24px", textAlign: "center" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", background: "#111113", border: "1px solid #27272a", borderRadius: 24, padding: "56px 40px" }}>
          <h2 style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 36, letterSpacing: "-1px", marginBottom: 16 }}>
            Start using VoiceNote AI
          </h2>
          <p style={{ color: "#71717a", fontSize: 16, marginBottom: 32, lineHeight: 1.7 }}>
            Join the future of voice-powered productivity. Set up in minutes.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => navigate("/app")} style={{ padding: "14px 32px", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#f59e0b,#fb923c)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "'Sora',sans-serif" }}>
              Get started free →
            </button>
            <button onClick={() => scrollTo("pricing")} style={{ padding: "14px 32px", borderRadius: 12, border: "1px solid #27272a", background: "transparent", color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
              Book a demo
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ padding: "32px 24px", borderTop: "1px solid #18181b", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 24, height: 24, borderRadius: 7, background: "linear-gradient(135deg,#f59e0b,#fb923c)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="11" height="11" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          <span style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 14, color: "#fff" }}>VoiceNote AI</span>
        </div>
        <p style={{ fontSize: 13, color: "#3f3f46" }}>© 2026 VoiceNote AI. All rights reserved.</p>
        <div style={{ display: "flex", gap: 20 }}>
          {["Privacy", "Terms", "Contact"].map(l => (
            <span key={l} style={{ fontSize: 13, color: "#52525b", cursor: "pointer" }}>{l}</span>
          ))}
        </div>
      </footer>
    </div>
  );
}
