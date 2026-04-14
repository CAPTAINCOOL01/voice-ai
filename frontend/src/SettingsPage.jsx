import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const API        = import.meta.env.VITE_API_URL ?? (typeof window !== "undefined" ? window.location.origin : "");
const getToken   = () => localStorage.getItem("token");
const clearToken = () => localStorage.removeItem("token");
const authFetch  = (url, opts = {}) =>
  fetch(url, { ...opts, headers: { ...opts.headers, ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) } });

// ── Tiny helpers ──────────────────────────────────────────
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Toast({ msg, type }) {
  if (!msg) return null;
  const bg = type === "error" ? "rgba(239,68,68,.12)" : "rgba(16,185,129,.12)";
  const border = type === "error" ? "rgba(239,68,68,.25)" : "rgba(16,185,129,.25)";
  const color  = type === "error" ? "#f87171" : "#34d399";
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: "10px 16px", fontSize: 13, color, marginBottom: 16 }}>
      {msg}
    </div>
  );
}

function Section({ title, desc, children }) {
  return (
    <div className="settings-section" style={{ background: "#111113", border: "1px solid #1c1c1f", borderRadius: 16, padding: 28, marginBottom: 20 }}>
      <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid #1c1c1f" }}>
        <h3 style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 16, color: "#fff", marginBottom: 4 }}>{title}</h3>
        {desc && <p style={{ fontSize: 13, color: "#52525b" }}>{desc}</p>}
      </div>
      {children}
    </div>
  );
}

function Input({ label, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: "block", fontSize: 12, color: "#a1a1aa", marginBottom: 6 }}>{label}</label>}
      <input
        {...props}
        onFocus={e => { setFocused(true); props.onFocus?.(e); }}
        onBlur={e => { setFocused(false); props.onBlur?.(e); }}
        style={{
          width: "100%", background: "#09090b", border: `1px solid ${focused ? "#f59e0b" : "#27272a"}`,
          borderRadius: 10, padding: "10px 14px", fontSize: 14, color: props.disabled ? "#52525b" : "#fff",
          outline: "none", transition: "border-color 0.2s", ...props.style,
        }}
      />
    </div>
  );
}

function Btn({ children, variant = "primary", loading, style: s, ...props }) {
  const base = { padding: "10px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1, border: "none", fontFamily: "inherit", transition: "opacity 0.2s", ...s };
  const variants = {
    primary:   { background: "linear-gradient(135deg,#f59e0b,#fb923c)", color: "#fff" },
    secondary: { background: "#18181b", border: "1px solid #27272a", color: "#a1a1aa" },
    danger:    { background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.25)", color: "#f87171" },
  };
  return <button {...props} disabled={loading} style={{ ...base, ...variants[variant] }}>{loading ? "Loading…" : children}</button>;
}

// ════════════════════════════════════════════════════════
//  TABS
// ════════════════════════════════════════════════════════

function ProfileTab({ profile, onSaved }) {
  const [name,  setName]  = useState(profile?.name  || "");
  const [email, setEmail] = useState(profile?.email || "");
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setName(profile?.name || ""); setEmail(profile?.email || ""); }, [profile]);

  const save = async () => {
    setSaving(true); setToast(null);
    try {
      const res  = await authFetch(`${API}/api/user/profile`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setToast({ msg: "Profile updated successfully", type: "success" });
      onSaved(data);
    } catch (err) { setToast({ msg: err.message, type: "error" }); }
    finally { setSaving(false); }
  };

  return (
    <>
      <Toast {...(toast || {})} />
      <div className="profile-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Input label="Display name" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
        <Input label="Username" value={profile?.username || ""} disabled />
      </div>
      <Input label="Email address" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" type="email" />
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Btn onClick={save} loading={saving}>Save changes</Btn>
        <span style={{ fontSize: 12, color: "#3f3f46" }}>
          Member since {fmtDate(profile?.createdAt).split(" at")[0]}
        </span>
      </div>
    </>
  );
}

function SecurityTab() {
  const [form,  setForm]  = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [show, setShow] = useState(false);

  const change = async () => {
    if (form.newPassword !== form.confirmPassword) return setToast({ msg: "New passwords don't match", type: "error" });
    if (form.newPassword.length < 6) return setToast({ msg: "Password must be at least 6 characters", type: "error" });
    setSaving(true); setToast(null);
    try {
      const res  = await authFetch(`${API}/api/user/password`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setToast({ msg: "Password changed successfully", type: "success" });
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err) { setToast({ msg: err.message, type: "error" }); }
    finally { setSaving(false); }
  };

  const field = (label, key) => (
    <div style={{ marginBottom: 14, position: "relative" }}>
      <label style={{ display: "block", fontSize: 12, color: "#a1a1aa", marginBottom: 6 }}>{label}</label>
      <div style={{ position: "relative" }}>
        <input type={show ? "text" : "password"} value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
          style={{ width: "100%", background: "#09090b", border: "1px solid #27272a", borderRadius: 10, padding: "10px 42px 10px 14px", fontSize: 14, color: "#fff", outline: "none" }}
          onFocus={e => e.target.style.borderColor = "#f59e0b"}
          onBlur={e  => e.target.style.borderColor = "#27272a"} />
        <button type="button" onClick={() => setShow(v => !v)}
          style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#52525b", display: "flex", padding: 0 }}>
          {show
            ? <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            : <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          }
        </button>
      </div>
    </div>
  );

  return (
    <>
      <Toast {...(toast || {})} />
      {field("Current password", "currentPassword")}
      {field("New password", "newPassword")}
      {field("Confirm new password", "confirmPassword")}
      <Btn onClick={change} loading={saving}>Update password</Btn>
    </>
  );
}

function ApiKeyTab({ profile }) {
  const [apiKey,    setApiKey]    = useState("");
  const [revealed,  setRevealed]  = useState(false);
  const [copying,   setCopying]   = useState(false);
  const [regen,     setRegen]     = useState(false);
  const [toast,     setToast]     = useState(null);
  const [showWarn,  setShowWarn]  = useState(false);

  useEffect(() => {
    authFetch(`${API}/api/user/api-key`)
      .then(r => r.json())
      .then(d => { if (d.apiKey) setApiKey(d.apiKey); });
  }, []);

  const copy = async () => {
    await navigator.clipboard.writeText(apiKey);
    setCopying(true); setTimeout(() => setCopying(false), 1500);
  };

  const regenerate = async () => {
    setRegen(true); setToast(null); setShowWarn(false);
    try {
      const res  = await authFetch(`${API}/api/user/api-key`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setApiKey(data.apiKey);
      setRevealed(true);
      setToast({ msg: "New API key generated. Update your ESP32 firmware.", type: "success" });
    } catch (err) { setToast({ msg: err.message, type: "error" }); }
    finally { setRegen(false); }
  };

  const masked = apiKey ? apiKey.slice(0, 8) + "••••••••••••••••••••••••" : "";

  return (
    <>
      <Toast {...(toast || {})} />
      <p style={{ fontSize: 13, color: "#71717a", marginBottom: 16, lineHeight: 1.7 }}>
        This key authenticates your ESP32 hardware device. Add it to your firmware as <code style={{ background: "#18181b", padding: "2px 6px", borderRadius: 4, fontSize: 12, color: "#f59e0b" }}>ESP32_API_KEY</code> and send it as the <code style={{ background: "#18181b", padding: "2px 6px", borderRadius: 4, fontSize: 12, color: "#f59e0b" }}>X-Api-Key</code> header.
      </p>

      <div style={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, marginBottom: 16, fontFamily: "monospace" }}>
        <span style={{ flex: 1, fontSize: 14, color: "#a1a1aa", letterSpacing: 1, wordBreak: "break-all" }}>
          {apiKey ? (revealed ? apiKey : masked) : "Loading…"}
        </span>
        <button onClick={() => setRevealed(v => !v)} style={{ background: "none", border: "none", cursor: "pointer", color: "#52525b", padding: 4, display: "flex" }}>
          {revealed
            ? <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            : <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          }
        </button>
        <button onClick={copy} style={{ background: "none", border: "none", cursor: "pointer", color: copying ? "#10b981" : "#52525b", padding: 4, display: "flex" }}>
          {copying
            ? <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            : <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          }
        </button>
      </div>

      {!showWarn
        ? <Btn variant="secondary" onClick={() => setShowWarn(true)}>Regenerate API key</Btn>
        : (
          <div style={{ background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.2)", borderRadius: 10, padding: 16 }}>
            <p style={{ fontSize: 13, color: "#fbbf24", marginBottom: 12 }}>
              ⚠️ This will invalidate your current key. Your ESP32 device will stop syncing until you update the firmware.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <Btn onClick={regenerate} loading={regen} style={{ background: "linear-gradient(135deg,#f59e0b,#fb923c)", color: "#fff" }}>Yes, regenerate</Btn>
              <Btn variant="secondary" onClick={() => setShowWarn(false)}>Cancel</Btn>
            </div>
          </div>
        )
      }

      <div style={{ marginTop: 24, padding: 16, background: "#0a0a0d", border: "1px solid #1c1c1f", borderRadius: 10 }}>
        <p style={{ fontSize: 12, color: "#52525b", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Firmware snippet</p>
        <pre style={{ fontSize: 12, color: "#a1a1aa", lineHeight: 1.8, margin: 0 }}>{`#define ESP32_API_KEY "${revealed ? apiKey : "your-api-key-here"}"

// In sendToBackend():
client.printf("X-Api-Key: %s\\r\\n", ESP32_API_KEY);`}</pre>
      </div>
    </>
  );
}

function DataTab({ onDeleted }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirm,     setConfirm]     = useState("");
  const [deleting,    setDeleting]    = useState(false);
  const [toast,       setToast]       = useState(null);

  const deleteAll = async () => {
    setDeleting(true); setToast(null);
    try {
      const res  = await authFetch(`${API}/api/user/data`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setToast({ msg: `Deleted ${data.deleted} recording${data.deleted !== 1 ? "s" : ""} successfully`, type: "success" });
      setShowConfirm(false); setConfirm("");
      onDeleted();
    } catch (err) { setToast({ msg: err.message, type: "error" }); }
    finally { setDeleting(false); }
  };

  return (
    <>
      <Toast {...(toast || {})} />

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16, background: "#0a0a0d", border: "1px solid #1c1c1f", borderRadius: 10 }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 4 }}>AI Processing</p>
            <p style={{ fontSize: 13, color: "#52525b" }}>Allow AI to process your voice recordings</p>
          </div>
          <div style={{ width: 44, height: 24, background: "linear-gradient(135deg,#f59e0b,#fb923c)", borderRadius: 12, position: "relative", cursor: "pointer" }}>
            <div style={{ position: "absolute", right: 3, top: 3, width: 18, height: 18, background: "#fff", borderRadius: "50%" }} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16, background: "#0a0a0d", border: "1px solid #1c1c1f", borderRadius: 10 }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 4 }}>Permanent Audio Storage</p>
            <p style={{ fontSize: 13, color: "#52525b" }}>Keep audio files after processing</p>
          </div>
          <div style={{ width: 44, height: 24, background: "linear-gradient(135deg,#f59e0b,#fb923c)", borderRadius: 12, position: "relative", cursor: "pointer" }}>
            <div style={{ position: "absolute", right: 3, top: 3, width: 18, height: 18, background: "#fff", borderRadius: "50%" }} />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 24, padding: 20, background: "rgba(239,68,68,.04)", border: "1px solid rgba(239,68,68,.15)", borderRadius: 12 }}>
        <h4 style={{ fontFamily: "'Sora',sans-serif", fontSize: 15, fontWeight: 700, color: "#f87171", marginBottom: 8 }}>Danger Zone</h4>
        <p style={{ fontSize: 13, color: "#71717a", marginBottom: 16, lineHeight: 1.7 }}>
          Permanently delete all your recordings, transcripts, and AI-generated notes. This action cannot be undone.
        </p>

        {!showConfirm
          ? <Btn variant="danger" onClick={() => setShowConfirm(true)}>Delete all data</Btn>
          : (
            <div>
              <p style={{ fontSize: 13, color: "#f87171", marginBottom: 10 }}>
                Type <strong>DELETE</strong> to confirm:
              </p>
              <input value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="DELETE"
                style={{ background: "#09090b", border: "1px solid rgba(239,68,68,.3)", borderRadius: 8, padding: "8px 12px", fontSize: 14, color: "#fff", outline: "none", marginBottom: 12, width: "100%", maxWidth: 200 }} />
              <div style={{ display: "flex", gap: 10 }}>
                <Btn variant="danger" loading={deleting} onClick={deleteAll}
                  style={{ opacity: confirm !== "DELETE" ? 0.4 : 1, cursor: confirm !== "DELETE" ? "not-allowed" : "pointer" }}>
                  Delete everything
                </Btn>
                <Btn variant="secondary" onClick={() => { setShowConfirm(false); setConfirm(""); }}>Cancel</Btn>
              </div>
            </div>
          )
        }
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════
//  MAIN SETTINGS PAGE
// ════════════════════════════════════════════════════════
const TABS = [
  { id: "profile",  label: "Profile",  icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
  { id: "security", label: "Security", icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> },
  { id: "apikey",   label: "API Key",  icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> },
  { id: "data",     label: "Data & Privacy", icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const [tab,     setTab]     = useState("profile");
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Redirect to login if not authed
  useEffect(() => {
    if (!getToken()) { navigate("/app"); return; }
    authFetch(`${API}/api/user/profile`)
      .then(r => { if (r.status === 401) { clearToken(); navigate("/app"); return null; } return r.json(); })
      .then(d => { if (d) setProfile(d); })
      .finally(() => setLoading(false));
  }, []);

  const signOut = () => { clearToken(); navigate("/app"); };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#09090b", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 32, height: 32, border: "3px solid #27272a", borderTopColor: "#f59e0b", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#09090b", color: "#fff", fontFamily: "'DM Sans',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        *{box-sizing:border-box;margin:0;padding:0}

        /* ── Mobile ─────────────────────────────── */
        @media(max-width:600px){
          .settings-nav        { padding:0 14px !important; }
          .settings-nav-title  { display:none !important; }
          .settings-outer      { padding:20px 14px 60px !important; }
          .settings-header h1  { font-size:22px !important; }
          .settings-header     { margin-bottom:20px !important; }
          .settings-layout     { grid-template-columns:1fr !important; gap:0 !important; }
          .settings-sidebar    {
            position:static !important;
            border-radius:12px !important;
            padding:4px !important;
            margin-bottom:16px !important;
            display:flex !important;
            flex-direction:row !important;
            overflow-x:auto !important;
            gap:4px !important;
          }
          .settings-sidebar .sidebar-account { display:none !important; }
          .settings-sidebar .sidebar-divider  { display:none !important; }
          .settings-tab-btn    {
            flex-shrink:0 !important;
            width:auto !important;
            padding:8px 12px !important;
            font-size:12px !important;
            border-radius:8px !important;
            margin-bottom:0 !important;
            white-space:nowrap !important;
          }
          .settings-tab-btn .tab-label { display:inline !important; }
          .profile-grid        { grid-template-columns:1fr !important; }
          .settings-section    { padding:18px !important; border-radius:12px !important; }
        }
      `}</style>

      {/* ── Top nav ── */}
      <nav className="settings-nav" style={{ height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", borderBottom: "1px solid #18181b", position: "sticky", top: 0, background: "rgba(9,9,11,0.9)", backdropFilter: "blur(12px)", zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button onClick={() => navigate("/app")} style={{ background: "none", border: "none", cursor: "pointer", color: "#71717a", display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: 0 }}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
            Dashboard
          </button>
          <span className="settings-nav-title" style={{ color: "#27272a" }}>／</span>
          <span className="settings-nav-title" style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>Settings</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#f59e0b,#fb923c)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff" }}>
            {(profile?.name || profile?.username || "?")[0].toUpperCase()}
          </div>
          <button onClick={signOut} style={{ background: "none", border: "1px solid #27272a", borderRadius: 8, padding: "6px 14px", color: "#71717a", fontSize: 13, cursor: "pointer" }}>Sign out</button>
        </div>
      </nav>

      <div className="settings-outer" style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
        {/* ── Header ── */}
        <div className="settings-header" style={{ marginBottom: 32 }}>
          <h1 style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 28, marginBottom: 6 }}>Account Settings</h1>
          <p style={{ color: "#52525b", fontSize: 14 }}>Manage your profile, security, and device configuration.</p>
        </div>

        <div className="settings-layout" style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 24, alignItems: "start" }}>
          {/* ── Sidebar tabs ── */}
          <div className="settings-sidebar" style={{ background: "#111113", border: "1px solid #1c1c1f", borderRadius: 14, padding: 8, position: "sticky", top: 80 }}>
            {TABS.map(t => (
              <button className="settings-tab-btn" key={t.id} onClick={() => setTab(t.id)} style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, textAlign: "left",
                background: tab === t.id ? "rgba(245,158,11,0.1)" : "transparent",
                color: tab === t.id ? "#f59e0b" : "#71717a",
                transition: "all 0.15s",
                marginBottom: 2,
              }}>
                <span style={{ color: tab === t.id ? "#f59e0b" : "#3f3f46" }}>{t.icon}</span>
                <span className="tab-label">{t.label}</span>
              </button>
            ))}

            <div className="sidebar-divider" style={{ height: 1, background: "#1c1c1f", margin: "8px 0" }} />

            <div className="sidebar-account" style={{ padding: "10px 14px" }}>
              <p style={{ fontSize: 11, color: "#3f3f46", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Account</p>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#a1a1aa" }}>{profile?.name || profile?.username}</p>
              {profile?.lastLogin && (
                <p style={{ fontSize: 11, color: "#3f3f46", marginTop: 4 }}>
                  Last login<br />{fmtDate(profile.lastLogin)}
                </p>
              )}
            </div>
          </div>

          {/* ── Content ── */}
          <div>
            {tab === "profile" && (
              <Section title="Profile Information" desc="Update your display name and email address.">
                <ProfileTab profile={profile} onSaved={setProfile} />
              </Section>
            )}
            {tab === "security" && (
              <Section title="Change Password" desc="Use a strong password with at least 6 characters.">
                <SecurityTab />
              </Section>
            )}
            {tab === "apikey" && (
              <Section title="ESP32 API Key" desc="Used to authenticate your hardware recording device.">
                <ApiKeyTab profile={profile} />
              </Section>
            )}
            {tab === "data" && (
              <Section title="Data & Privacy" desc="Control how your data is stored and processed.">
                <DataTab onDeleted={() => {}} />
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
