// Billing surface — Plans page, Usage page, header AI-Minutes pill,
// and the ProcessingStateBanner shown inside DetailPanel when a recording is
// unprocessed / blocked-by-quota / mid-job.
//
// Standalone: does not import from App.jsx. Re-declares API + authFetch so
// the two files stay decoupled.

import { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:5000");

const getToken   = () => localStorage.getItem("token");
const authFetch  = async (url, opts = {}) => {
  const token = getToken();
  const res = await fetch(url, {
    ...opts,
    headers: { ...opts.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (res.status === 401 && token) { localStorage.removeItem("token"); window.location.reload(); }
  return res;
};

// ── Shared style tokens (mirrors App.jsx palette) ──
const BG        = "#09090b";
const CARD      = "#18181b";
const CARD_DEEP = "#0d0d0f";
const BORDER    = "#27272a";
const TEXT      = "#fafafa";
const TEXT_DIM  = "#a1a1aa";
const TEXT_MUTE = "#52525b";
const ACCENT    = "#f59e0b";
const ACCENT2   = "#fb923c";

// ─────────────────────────────────────────────────────────
// AiMinutesPill — small header widget showing "120N · 60P"
// ─────────────────────────────────────────────────────────
export function AiMinutesPill({ onClick, refreshKey }) {
  const [bal, setBal] = useState({ normalMinutesBalance: 0, premiumMinutesBalance: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await authFetch(`${API}/api/wallets`);
        if (!r.ok) throw new Error();
        const d = await r.json();
        if (!cancelled) setBal(d);
      } catch (_) { /* silent — pill just shows 0/0 */ }
      finally     { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const n = bal.normalMinutesBalance  || 0;
  const p = bal.premiumMinutesBalance || 0;
  const low = n < 10 && p < 5;

  return (
    <button
      onClick={onClick}
      title="AI Minutes remaining — click for details"
      style={{
        display:"flex", alignItems:"center", gap:8, padding:"6px 12px",
        borderRadius:20, cursor:"pointer",
        background: low ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.08)",
        border:     `1px solid ${low ? "rgba(239,68,68,0.25)" : "rgba(245,158,11,0.25)"}`,
        fontSize:12, fontWeight:600, color: low ? "#f87171" : ACCENT,
        fontFamily:"'DM Sans',sans-serif",
      }}
    >
      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
      {loading ? "…" : <>
        <span>{n}<span style={{ opacity:0.6, marginLeft:2 }}>N</span></span>
        <span style={{ opacity:0.4 }}>·</span>
        <span>{p}<span style={{ opacity:0.6, marginLeft:2 }}>P</span></span>
      </>}
    </button>
  );
}

// ─────────────────────────────────────────────────────────
// ProcessingStateBanner — replaces the tabs body in DetailPanel when
// the recording hasn't been processed yet or was blocked by quota.
// ─────────────────────────────────────────────────────────
export function ProcessingStateBanner({ rec, onProcessed, onGoToPlans }) {
  const [est,        setEst]        = useState(null);
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState(null);
  const [pollStatus, setPollStatus] = useState(rec.processingStatus);

  const isBlocked  = pollStatus === "blocked_by_quota";
  const isFailed   = pollStatus === "failed";
  const isRunning  = pollStatus === "processing" || pollStatus === "reserved";
  const isPending  = pollStatus === "pending" || !pollStatus;

  // Fetch estimate once (billable minutes + per-wallet sufficiency).
  useEffect(() => {
    (async () => {
      try {
        const r = await authFetch(`${API}/api/recordings/${rec._id}/estimate`);
        if (r.ok) setEst(await r.json());
      } catch (_) {}
    })();
  }, [rec._id]);

  // Poll job status every 3s while active.
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(async () => {
      try {
        const r = await authFetch(`${API}/api/recordings/${rec._id}/job/status`);
        if (!r.ok) return;
        const d = await r.json();
        setPollStatus(d.processingStatus);
        if (d.processingStatus === "completed" && onProcessed) onProcessed();
      } catch (_) {}
    }, 3000);
    return () => clearInterval(id);
  }, [isRunning, rec._id, onProcessed]);

  async function pick(mode) {
    setBusy(true); setError(null);
    try {
      const r = await authFetch(`${API}/api/recordings/${rec._id}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const d = await r.json();
      if (r.status === 402) {
        setError(`Insufficient ${d.wallet} AI Minutes. You need ${d.requested}, have ${d.available}.`);
      } else if (!r.ok) {
        setError(d.error || "Something went wrong");
      } else {
        setPollStatus("processing");
      }
    } catch (err) { setError(err.message); }
    finally      { setBusy(false); }
  }

  const cardBase = {
    background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16,
    padding: 20, display:"flex", flexDirection:"column", gap: 14,
    fontFamily:"'DM Sans',sans-serif",
  };

  if (isRunning) {
    return (
      <div style={{ padding: 24, display:"flex", flexDirection:"column", gap: 16, alignItems:"center", color: TEXT_DIM }}>
        <div style={{ width: 44, height: 44, borderRadius:"50%", border:`3px solid ${BORDER}`, borderTopColor: ACCENT,
          animation:"spin 0.8s linear infinite" }}/>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ fontSize:14, fontWeight:600, color: TEXT }}>
          {rec.processingMode === "premium" ? "Premium" : "Normal"} processing in progress…
        </div>
        <div style={{ fontSize:12, color: TEXT_MUTE, textAlign:"center", maxWidth: 320 }}>
          Transcribing and generating your report. This usually takes 15-30 seconds. You can close this panel — the recording will update when ready.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, display:"flex", flexDirection:"column", gap: 16 }}>
      {isBlocked && (
        <div style={{ padding:14, borderRadius:12, background:"rgba(239,68,68,0.08)",
          border:"1px solid rgba(239,68,68,0.25)", color:"#fca5a5", fontSize:13, lineHeight:1.55, fontFamily:"'DM Sans',sans-serif" }}>
          <div style={{ fontWeight:700, marginBottom:4, color:"#f87171" }}>Recording uploaded — add AI Minutes to process it.</div>
          <div style={{ color:"#fca5a5", opacity:0.85 }}>{rec.blockedReason || "Your wallet doesn't have enough minutes for this recording."}</div>
        </div>
      )}
      {isFailed && (
        <div style={{ padding:14, borderRadius:12, background:"rgba(239,68,68,0.08)",
          border:"1px solid rgba(239,68,68,0.25)", color:"#fca5a5", fontSize:13 }}>
          Last processing attempt failed. {rec.blockedReason && `(${rec.blockedReason})`} You can try again — pick a mode below.
        </div>
      )}
      {isPending && !isBlocked && !isFailed && (
        <div style={{ padding:14, borderRadius:12, background: CARD_DEEP,
          border:`1px solid ${BORDER}`, color: TEXT_DIM, fontSize:13 }}>
          Choose how to process this recording.
        </div>
      )}

      {/* Normal card */}
      <ModeCard
        title="Normal AI Notes"
        subtitle="Best for everyday meetings."
        features={[
          "Accurate AI transcription",
          "Speaker labels",
          "Detailed notes",
          "Decisions and action items",
          "Topic clarification",
          "Helpful examples",
          "One visual when useful",
        ]}
        minutesText={est ? `Uses ${est.normalMinutes} Normal AI Minutes` : "Loading estimate…"}
        sufficient={est?.sufficientNormal}
        buttonLabel="Use Normal AI Minutes"
        onClick={() => pick("normal")}
        disabled={busy}
        accent={ACCENT}
      />

      {/* Premium card */}
      <ModeCard
        title="Premium Meeting Intelligence"
        subtitle="Best for important client, sales and management meetings."
        features={[
          "Sarvam premium transcription",
          "Better Indian-language & code-mixed handling",
          "Speaker diarisation",
          "Claude Opus executive analysis",
          "Customer objections & commitments",
          "Risks and unresolved issues",
          "Detailed explanations and examples",
          "Two to five visual diagrams",
          "Premium PDF report",
        ]}
        minutesText={est ? `Uses ${est.premiumMinutes} Premium AI Minutes` : "Loading estimate…"}
        sufficient={est?.sufficientPremium}
        buttonLabel="Use Premium AI Minutes"
        onClick={() => pick("premium")}
        disabled={busy}
        accent="#a78bfa"
        premium
      />

      {error && (
        <div style={{ padding:12, borderRadius:10, background:"rgba(239,68,68,0.08)",
          border:"1px solid rgba(239,68,68,0.25)", color:"#fca5a5", fontSize:12 }}>{error}</div>
      )}

      <button onClick={onGoToPlans} style={{
        padding:"10px 14px", borderRadius:10, background:"transparent",
        border:`1px solid ${BORDER}`, color: TEXT_DIM, fontSize:13, fontWeight:500,
        cursor:"pointer", fontFamily:"'DM Sans',sans-serif", marginTop:4,
      }}>View Weekly Plans →</button>
    </div>
  );
}

function ModeCard({ title, subtitle, features, minutesText, sufficient, buttonLabel, onClick, disabled, accent, premium }) {
  return (
    <div style={{
      background: CARD, border:`1px solid ${premium ? "rgba(167,139,250,0.25)" : BORDER}`, borderRadius:16,
      padding:18, display:"flex", flexDirection:"column", gap:12, fontFamily:"'DM Sans',sans-serif",
      background: premium ? "linear-gradient(180deg, rgba(167,139,250,0.04), transparent)" : CARD,
    }}>
      <div>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}>
          <div style={{ fontSize:15, fontWeight:700, color: TEXT }}>{title}</div>
          {premium && (
            <span style={{ padding:"2px 8px", borderRadius:6, background:"rgba(167,139,250,0.15)",
              border:"1px solid rgba(167,139,250,0.3)", fontSize:10, fontWeight:700, color:"#c4b5fd", letterSpacing:0.4 }}>PREMIUM</span>
          )}
        </div>
        <div style={{ fontSize:12, color: TEXT_MUTE }}>{subtitle}</div>
      </div>
      <ul style={{ margin:0, padding:0, listStyle:"none", display:"flex", flexDirection:"column", gap:6 }}>
        {features.map((f,i) => (
          <li key={i} style={{ fontSize:12, color: TEXT_DIM, display:"flex", alignItems:"flex-start", gap:8, lineHeight:1.5 }}>
            <svg width="12" height="12" style={{ flexShrink:0, marginTop:3, color: accent }} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div style={{ fontSize:11, color: TEXT_MUTE, marginTop:4 }}>{minutesText}</div>
      <button onClick={onClick} disabled={disabled || sufficient === false}
        style={{
          padding:"10px 14px", borderRadius:10, border:"none", cursor:(disabled || sufficient === false) ? "not-allowed" : "pointer",
          background: sufficient === false ? BORDER : `linear-gradient(135deg, ${accent}, ${premium ? "#8b5cf6" : ACCENT2})`,
          color: sufficient === false ? TEXT_MUTE : "white",
          fontSize:13, fontWeight:700, fontFamily:"'DM Sans',sans-serif",
          opacity: disabled ? 0.6 : 1,
        }}>
        {sufficient === false ? "Insufficient minutes" : buttonLabel}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// PlansPage — three plan cards driven by GET /api/plans
// ─────────────────────────────────────────────────────────
export function PlansPage({ onBack }) {
  const [plans,   setPlans]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(null);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await authFetch(`${API}/api/plans`);
        if (!r.ok) throw new Error("Failed to load plans");
        const d = await r.json();
        setPlans(d.plans || []);
      } catch (err) { setError(err.message); }
      finally      { setLoading(false); }
    })();
  }, []);

  async function subscribe(planCode) {
    setBusy(planCode); setError(null);
    try {
      const r = await authFetch(`${API}/api/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to start subscription");
      if (d.shortUrl) window.location.href = d.shortUrl;
      else setError("Subscription created but no checkout URL returned. Contact support.");
    } catch (err) { setError(err.message); }
    finally      { setBusy(null); }
  }

  return (
    <div style={{ padding:"28px 20px 60px", maxWidth: 1000, margin:"0 auto", fontFamily:"'DM Sans',sans-serif" }}>
      <button onClick={onBack} style={{
        background:"none", border:`1px solid ${BORDER}`, color: TEXT_DIM, padding:"6px 12px",
        borderRadius:10, cursor:"pointer", fontSize:12, marginBottom:20, display:"flex", alignItems:"center", gap:6 }}>
        ← Back
      </button>
      <h1 style={{ fontFamily:"'Sora',sans-serif", fontWeight:800, fontSize:26, color: TEXT, marginBottom:6 }}>Weekly Plans</h1>
      <p style={{ color: TEXT_DIM, fontSize:14, marginBottom:28 }}>Pay weekly. Cancel any time. Prices exclude GST.</p>

      {loading && <div style={{ color: TEXT_MUTE }}>Loading plans…</div>}
      {error   && <div style={{ padding:14, borderRadius:12, background:"rgba(239,68,68,0.08)",
        border:"1px solid rgba(239,68,68,0.25)", color:"#fca5a5", fontSize:13, marginBottom:20 }}>{error}</div>}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:18 }}>
        {plans.map(p => {
          const isPremiumOnly = p.premiumMinutesGranted > 0 && p.normalMinutesGranted === 0;
          const isComplete   = p.premiumMinutesGranted > 0 && p.normalMinutesGranted > 0;
          const accent = isComplete ? "#f59e0b" : isPremiumOnly ? "#a78bfa" : "#60a5fa";
          return (
            <div key={p.code} style={{
              background: CARD, border:`1px solid ${BORDER}`, borderRadius:18,
              padding:24, display:"flex", flexDirection:"column", gap:14,
              boxShadow: isComplete ? "0 0 0 1px rgba(245,158,11,0.25)" : "none",
            }}>
              {isComplete && (
                <span style={{ alignSelf:"flex-start", padding:"2px 10px", borderRadius:20,
                  background:"rgba(245,158,11,0.12)", color: ACCENT, fontSize:10, fontWeight:700, letterSpacing:0.5 }}>MOST POPULAR</span>
              )}
              <div>
                <h3 style={{ fontFamily:"'Sora',sans-serif", fontWeight:700, fontSize:17, color: TEXT, marginBottom:4 }}>{p.name}</h3>
                <p style={{ fontSize:12, color: TEXT_MUTE, minHeight:32 }}>{p.description}</p>
              </div>
              <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                <span style={{ fontFamily:"'Sora',sans-serif", fontWeight:800, fontSize:32, color: TEXT }}>₹{p.priceInr}</span>
                <span style={{ fontSize:13, color: TEXT_MUTE }}>/ week</span>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {p.normalMinutesGranted  > 0 && <Line accent={accent}>{p.normalMinutesGranted} Normal AI Minutes</Line>}
                {p.premiumMinutesGranted > 0 && <Line accent={accent}>{p.premiumMinutesGranted} Premium AI Minutes</Line>}
                <Line accent={accent}>Cancel any time</Line>
                <Line accent={accent}>No rollover</Line>
              </div>
              <button onClick={() => subscribe(p.code)} disabled={busy === p.code}
                style={{
                  padding:"11px 14px", borderRadius:10, border:"none", cursor: busy === p.code ? "wait" : "pointer",
                  background: `linear-gradient(135deg, ${accent}, ${isComplete ? ACCENT2 : accent})`,
                  color:"white", fontSize:14, fontWeight:700, fontFamily:"'DM Sans',sans-serif", marginTop:6,
                }}>
                {busy === p.code ? "Redirecting to Razorpay…" : "Buy"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Line({ children, accent }) {
  return (
    <div style={{ fontSize:13, color: TEXT_DIM, display:"flex", alignItems:"flex-start", gap:8 }}>
      <svg width="14" height="14" style={{ flexShrink:0, marginTop:3, color: accent }} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <span>{children}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// UsagePage — wallets, current subscription, ledger history
// ─────────────────────────────────────────────────────────
export function UsagePage({ onBack, onGoToPlans }) {
  const [bal,   setBal]   = useState(null);
  const [subs,  setSubs]  = useState([]);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [w, s, l] = await Promise.all([
        authFetch(`${API}/api/wallets`).then(r => r.json()),
        authFetch(`${API}/api/subscriptions/me`).then(r => r.json()),
        authFetch(`${API}/api/usage/ledger?limit=100`).then(r => r.json()),
      ]);
      setBal(w);
      setSubs(s.subscriptions || []);
      setLedger(l.entries || []);
    } catch (_) { /* silent */ }
    finally     { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function cancel(id) {
    if (!confirm("Cancel this subscription at the end of the current period?")) return;
    try {
      const r = await authFetch(`${API}/api/subscriptions/${id}/cancel`, { method: "POST" });
      if (!r.ok) throw new Error("Cancel failed");
      reload();
    } catch (err) { alert(err.message); }
  }

  const activeSub = subs.find(s => s.status === "active" || s.status === "created" || s.status === "authenticated");

  return (
    <div style={{ padding:"28px 20px 60px", maxWidth: 900, margin:"0 auto", fontFamily:"'DM Sans',sans-serif" }}>
      <button onClick={onBack} style={{
        background:"none", border:`1px solid ${BORDER}`, color: TEXT_DIM, padding:"6px 12px",
        borderRadius:10, cursor:"pointer", fontSize:12, marginBottom:20 }}>← Back</button>
      <h1 style={{ fontFamily:"'Sora',sans-serif", fontWeight:800, fontSize:26, color: TEXT, marginBottom:20 }}>Your AI Minutes</h1>

      {/* Balances */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:14, marginBottom:28 }}>
        <BalanceCard label="Normal AI Minutes"  value={bal?.normalMinutesBalance  ?? 0} loading={loading} accent={ACCENT}/>
        <BalanceCard label="Premium AI Minutes" value={bal?.premiumMinutesBalance ?? 0} loading={loading} accent="#a78bfa"/>
      </div>

      {/* Subscription */}
      <div style={{ background: CARD, border:`1px solid ${BORDER}`, borderRadius:16, padding:20, marginBottom:28 }}>
        <div style={{ fontSize:14, fontWeight:700, color: TEXT, marginBottom:12 }}>Subscription</div>
        {activeSub ? (
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap" }}>
            <div>
              <div style={{ fontSize:13, color: TEXT_DIM }}>Status: <span style={{ color:"#4ade80", fontWeight:600 }}>{activeSub.status}</span></div>
              {activeSub.currentPeriodEnd && (
                <div style={{ fontSize:12, color: TEXT_MUTE, marginTop:4 }}>
                  Next renewal: {new Date(activeSub.currentPeriodEnd).toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" })}
                </div>
              )}
            </div>
            <button onClick={() => cancel(activeSub._id)} style={{
              padding:"8px 14px", borderRadius:10, background:"transparent",
              border:"1px solid rgba(239,68,68,0.3)", color:"#f87171", fontSize:12, cursor:"pointer", fontWeight:600 }}>
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap" }}>
            <div style={{ fontSize:13, color: TEXT_DIM }}>No active subscription. You're on the free trial.</div>
            <button onClick={onGoToPlans} style={{
              padding:"8px 14px", borderRadius:10,
              background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`,
              border:"none", color:"white", fontSize:12, fontWeight:700, cursor:"pointer" }}>
              View Weekly Plans
            </button>
          </div>
        )}
      </div>

      {/* Ledger */}
      <div style={{ background: CARD, border:`1px solid ${BORDER}`, borderRadius:16, padding:20 }}>
        <div style={{ fontSize:14, fontWeight:700, color: TEXT, marginBottom:14 }}>Recent activity</div>
        {loading && <div style={{ color: TEXT_MUTE, fontSize:13 }}>Loading…</div>}
        {!loading && ledger.length === 0 && <div style={{ color: TEXT_MUTE, fontSize:13 }}>No activity yet.</div>}
        {!loading && ledger.length > 0 && (
          <div style={{ display:"flex", flexDirection:"column" }}>
            {ledger.map(e => (
              <div key={e._id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                padding:"10px 0", borderBottom:`1px solid ${BORDER}`, gap:12 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize:13, color: TEXT, fontWeight:600, textTransform:"capitalize" }}>
                    {e.transactionType.replace(/_/g, " ")}
                  </div>
                  <div style={{ fontSize:11, color: TEXT_MUTE, marginTop:2 }}>
                    {new Date(e.createdAt).toLocaleString("en-IN", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" })}
                    {e.note && ` · ${e.note}`}
                  </div>
                </div>
                <div style={{ fontSize:13, fontWeight:700,
                  color: e.minutes >= 0 ? "#4ade80" : (e.status === "pending" ? "#fbbf24" : "#f87171") }}>
                  {e.minutes >= 0 ? "+" : ""}{e.minutes}
                  <span style={{ fontSize:10, marginLeft:4, opacity:0.6, textTransform:"uppercase" }}>{e.walletType.slice(0,1)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BalanceCard({ label, value, loading, accent }) {
  return (
    <div style={{ background: CARD, border:`1px solid ${BORDER}`, borderRadius:16, padding:20 }}>
      <div style={{ fontSize:11, color: TEXT_MUTE, textTransform:"uppercase", letterSpacing:0.6, marginBottom:8 }}>{label}</div>
      <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
        <span style={{ fontFamily:"'Sora',sans-serif", fontWeight:800, fontSize:36, color: accent }}>
          {loading ? "—" : value}
        </span>
        <span style={{ fontSize:12, color: TEXT_MUTE }}>min</span>
      </div>
    </div>
  );
}
