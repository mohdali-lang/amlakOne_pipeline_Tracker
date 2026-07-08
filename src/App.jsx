import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "./supabaseClient";
import * as api from "./api";

/* ============================================================
   AMLAK ONE — Pipeline & KPI (Supabase edition)
   Role comes from the signed-in user's profile.
   RLS scopes all data: agent=self, leader=team, management=all.
   ============================================================ */

const C = {
  bg: "#141110", bg2: "#1B1714", surf: "#221D18", surf2: "#2A241D", line: "#3A3128",
  gold: "#C9A24B", goldHi: "#E4C56E", text: "#F2ECE0", mut: "#A89C88", mut2: "#7C7263",
  green: "#7BB07A", amber: "#D9AC55", red: "#C77363", blue: "#7FA8C9",
};

const STAGES = ["New Lead", "Contacted", "Qualified", "Meeting Scheduled", "Meeting Done",
  "Viewing", "Proposal Sent", "Negotiation", "Reservation Pending", "Reservation Paid",
  "SPA Pending", "Closed Won", "Closed Lost"];
const OPEN_STAGES = STAGES.slice(0, 11);
const STAGE_PROB = { "New Lead": 5, "Contacted": 10, "Qualified": 20, "Meeting Scheduled": 30,
  "Meeting Done": 40, "Viewing": 50, "Proposal Sent": 60, "Negotiation": 70,
  "Reservation Pending": 80, "Reservation Paid": 90, "SPA Pending": 95, "Closed Won": 100, "Closed Lost": 0 };

const todayISO = api.todayISO;
const fmtAED = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${Math.round(n)}`;
const monthKey = (iso) => (iso || "").slice(0, 7);

function kpiAchievement(entry, defs) {
  if (!entry || !defs.length) return 0;
  let sum = 0;
  defs.forEach((d) => { const a = Number(entry.values?.[d.key] || 0); sum += d.target ? Math.min(a / d.target, 1) : 0; });
  return Math.round((sum / defs.length) * 100);
}

// Sum every KPI across a set of daily entries -> one merged {key: total} object.
function sumEntries(entries) {
  const totals = {};
  entries.forEach((e) => Object.entries(e.values || {}).forEach(([k, v]) => { totals[k] = (totals[k] || 0) + Number(v || 0); }));
  return totals;
}

// Cumulative achievement %: measured against target × number-of-days-logged,
// so an agent who hits target every day stays at 100% instead of drifting over 100.
function cumulativeAchievement(entries, defs) {
  if (!entries.length || !defs.length) return 0;
  const days = entries.length;
  const totals = sumEntries(entries);
  let sum = 0;
  defs.forEach((d) => { const a = Number(totals[d.key] || 0); const tgt = d.target * days; sum += tgt ? Math.min(a / tgt, 1) : 0; });
  return Math.round((sum / defs.length) * 100);
}
const inMonth = (iso, ym) => !ym || (iso || "").slice(0, 7) === ym;
const openValue = (ds) => ds.filter((d) => d.status === "open").reduce((s, d) => s + Number(d.value), 0);
const weighted = (ds) => ds.filter((d) => d.status === "open").reduce((s, d) => s + Number(d.value) * (d.probability / 100), 0);
const wonValue = (ds) => ds.filter((d) => d.status === "won").reduce((s, d) => s + Number(d.value), 0);
const closingThisMonth = (ds) => ds.filter((d) => d.status === "open" && monthKey(d.expected_close) === monthKey(todayISO()));
const toneFor = (p) => (p >= 90 ? C.green : p >= 65 ? C.amber : C.red);

// ---------- atoms ----------
const Stat = ({ label, value, sub, tone }) => (
  <div style={{ background: C.surf, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 16px", flex: 1, minWidth: 130 }}>
    <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: C.mut2, marginBottom: 6 }}>{label}</div>
    <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 26, lineHeight: 1, color: tone || C.text, fontWeight: 600 }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: C.mut, marginTop: 6 }}>{sub}</div>}
  </div>
);
const Bar = ({ pct, tone }) => (
  <div style={{ height: 7, borderRadius: 6, background: C.surf2, overflow: "hidden" }}>
    <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: tone, transition: "width .4s" }} />
  </div>
);
const Chip = ({ children, color }) => (
  <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, background: `${color}22`, color, border: `1px solid ${color}55`, whiteSpace: "nowrap" }}>{children}</span>
);
const Field = ({ label, children }) => (
  <label style={{ display: "block", marginBottom: 11 }}>
    <div style={{ fontSize: 11.5, color: C.mut, marginBottom: 5, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</div>
    {children}
  </label>
);
const Empty = ({ text }) => (
  <div style={{ border: `1px dashed ${C.line}`, borderRadius: 12, padding: 24, textAlign: "center", color: C.mut2, fontSize: 14 }}>{text}</div>
);
const goldBtn = { border: "none", cursor: "pointer", borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700, background: `linear-gradient(135deg,${C.gold},${C.goldHi})`, color: C.bg };
const ghostBtn = { border: `1px solid ${C.line}`, cursor: "pointer", borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 600, background: "transparent", color: C.mut };
const stepBtn = { width: 34, height: 34, flexShrink: 0, borderRadius: 8, border: `1px solid ${C.line}`, background: C.surf2, color: C.gold, fontSize: 18, fontWeight: 700, cursor: "pointer" };
const td = { padding: "10px", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" };

const SectionTitle = ({ children, right }) => (
  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "26px 0 12px", gap: 10 }}>
    <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, fontWeight: 600, margin: 0 }}>{children}</h2>
    {right}
  </div>
);

const FontStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap');
    *{box-sizing:border-box} body{margin:0}
    input,select,button,textarea{font-family:inherit}
    input,select,textarea{background:${C.bg2};border:1px solid ${C.line};color:${C.text};border-radius:9px;padding:9px 11px;font-size:14px;width:100%}
    input:focus,select:focus,textarea:focus{outline:2px solid ${C.gold};border-color:${C.gold}}
    @media (prefers-reduced-motion:reduce){*{transition:none!important}}
  `}</style>
);

// ============================================================
//  ROOT
// ============================================================
export default function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    api.getSession().then((s) => { setSession(s); setBooting(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (booting) return <Center>Loading…</Center>;
  if (!session) return <><FontStyle /><AuthGate /></>;
  return <><FontStyle /><Shell /></>;
}

const Center = ({ children }) => (
  <div style={{ background: C.bg, color: C.mut, minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "'DM Sans',sans-serif" }}>{children}</div>
);

// ============================================================
//  AUTH
// ============================================================
function AuthGate() {
  const [mode, setMode] = useState("signin");   // 'signin' | 'signup'
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [teamId, setTeamId] = useState("");
  const [teams, setTeams] = useState([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const DOMAIN = "@amlakone.ae";

  useEffect(() => { api.getTeams().then(setTeams).catch(() => {}); }, []);

  const submit = async () => {
    setErr(""); setMsg("");
    const mail = email.trim().toLowerCase();
    if (!mail.endsWith(DOMAIN)) return setErr(`Use your ${DOMAIN} email address.`);
    if (mode === "signup") {
      if (!fullName.trim()) return setErr("Please enter your full name.");
      if (pw.length < 6) return setErr("Password must be at least 6 characters.");
      setBusy(true);
      const { data, error } = await api.signUp({ email: mail, password: pw, full_name: fullName.trim(), team_id: teamId });
      setBusy(false);
      if (error) return setErr(error.message);
      if (!data.session) setMsg("Account created. Check your email to confirm, then sign in.");
      // if a session is returned, App's auth listener switches you in automatically
    } else {
      setBusy(true);
      const { error } = await api.signIn(mail, pw);
      setBusy(false);
      if (error) return setErr(error.message);
    }
  };

  const tab = (m, label) => (
    <button onClick={() => { setMode(m); setErr(""); setMsg(""); }}
      style={{ flex: 1, border: "none", cursor: "pointer", borderRadius: 8, padding: "8px 0", fontSize: 13, fontWeight: 600,
        background: mode === m ? `linear-gradient(135deg,${C.gold},${C.goldHi})` : "transparent", color: mode === m ? C.bg : C.mut }}>
      {label}
    </button>
  );

  return (
    <div style={{ background: C.bg, minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "'DM Sans',sans-serif", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22, justifyContent: "center" }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: `linear-gradient(135deg,${C.gold},${C.goldHi})`, display: "grid", placeItems: "center", color: C.bg, fontWeight: 800, fontFamily: "'Playfair Display',serif" }}>A</div>
          <div>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: C.text, fontWeight: 600, lineHeight: 1 }}>Amlak One</div>
            <div style={{ fontSize: 10.5, color: C.mut2, letterSpacing: ".1em", textTransform: "uppercase" }}>Pipeline & KPI Command</div>
          </div>
        </div>
        <div style={{ background: C.surf, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20 }}>
          <div style={{ display: "flex", gap: 4, background: C.bg2, padding: 4, borderRadius: 11, border: `1px solid ${C.line}`, marginBottom: 16 }}>
            {tab("signin", "Sign in")}{tab("signup", "Create account")}
          </div>
          {mode === "signup" && (
            <>
              <Field label="Full name"><input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Ahmed Hassan" /></Field>
              {teams.length > 0 && (
                <Field label="Your team">
                  <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                    <option value="">Select your team…</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </Field>
              )}
            </>
          )}
          <Field label="Company email"><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder={`you${DOMAIN}`} /></Field>
          <Field label="Password"><input value={pw} onChange={(e) => setPw(e.target.value)} type="password" onKeyDown={(e) => e.key === "Enter" && submit()} /></Field>
          {err && <div style={{ color: C.red, fontSize: 13, marginBottom: 10 }}>{err}</div>}
          {msg && <div style={{ color: C.green, fontSize: 13, marginBottom: 10 }}>{msg}</div>}
          <button onClick={submit} disabled={busy} style={{ ...goldBtn, width: "100%", padding: 11, opacity: busy ? 0.6 : 1 }}>
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
          <div style={{ fontSize: 12, color: C.mut2, marginTop: 12, textAlign: "center" }}>
            {mode === "signup" ? "Only @amlakone.ae emails can register." : "New here? Use “Create account”."}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  SHELL — loads data, subscribes, routes by role
// ============================================================
function Shell() {
  const [profile, setProfile] = useState(null);
  const [defs, setDefs] = useState([]);
  const [teams, setTeams] = useState([]);
  const [people, setPeople] = useState([]);
  const [deals, setDeals] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    const [d, e] = await Promise.all([api.getDeals(), api.getEntries()]);
    setDeals(d); setEntries(e);
  }, []);

  useEffect(() => {
    (async () => {
      const [p, kd, tm, pl] = await Promise.all([api.getMyProfile(), api.getKpiDefs(), api.getTeams(), api.getProfiles()]);
      setProfile(p); setDefs(kd); setTeams(tm); setPeople(pl);
      await refetch();
      setLoading(false);
    })();
    const unsub = api.subscribeChanges(() => refetch());
    return unsub;
  }, [refetch]);

  const nameOf = useCallback((id) => people.find((x) => x.id === id)?.full_name || "—", [people]);
  const teamOf = useCallback((id) => teams.find((t) => t.id === id)?.name || "—", [teams]);

  if (loading || !profile) return <Center>Loading command center…</Center>;

  const ctx = { profile, defs, teams, people, deals, entries, nameOf, teamOf, refetch };
  const roleLabel = { agent: "Agent", leader: "Team Leader", management: "Management" }[profile.role];

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: `${C.bg}f2`, backdropFilter: "blur(8px)", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginRight: "auto" }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: `linear-gradient(135deg,${C.gold},${C.goldHi})`, display: "grid", placeItems: "center", color: C.bg, fontWeight: 800, fontFamily: "'Playfair Display',serif" }}>A</div>
            <div>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, fontWeight: 600, lineHeight: 1 }}>{profile.full_name}</div>
              <div style={{ fontSize: 10.5, color: C.mut2, letterSpacing: ".08em", textTransform: "uppercase" }}>{roleLabel}{profile.team_id ? ` · ${teamOf(profile.team_id)}` : ""}</div>
            </div>
          </div>
          <button onClick={() => api.signOut()} style={ghostBtn}>Sign out</button>
        </div>
      </div>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "18px 16px 60px" }}>
        {profile.role === "agent" && <AgentView ctx={ctx} />}
        {profile.role === "leader" && <LeaderView ctx={ctx} />}
        {profile.role === "management" && <MgmtView ctx={ctx} />}
      </div>
    </div>
  );
}

// ============================================================
//  AGENT
// ============================================================
function AgentView({ ctx }) {
  const { profile, defs, deals, entries, refetch } = ctx;
  const me = profile.id;
  const today = todayISO();
  const myDeals = deals.filter((d) => d.agent_id === me);
  const entry = entries.find((e) => e.agent_id === me && e.entry_date === today) || { agent_id: me, entry_date: today, values: {} };
  const [local, setLocal] = useState(entry.values);
  const [dealModal, setDealModal] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setLocal(entry.values || {}); }, [entries]); // eslint-disable-line

  const commit = async (values) => { setSaving(true); try { await api.upsertEntry(me, values); await refetch(); } finally { setSaving(false); } };
  const setKpi = (k, v) => { const nv = { ...local, [k]: Math.max(0, Number(v) || 0) }; setLocal(nv); commit(nv); };
  const step = (k, d) => setKpi(k, Number(local[k] || 0) + d);
  const achv = kpiAchievement({ values: local }, defs);
  // cumulative across all the agent's logged days (today's live edits included)
  const myEntries = entries.filter((e) => e.agent_id === me);
  const cumEntries = [{ values: local }, ...myEntries.filter((e) => e.entry_date !== today)];
  const cumAchv = cumulativeAchievement(cumEntries, defs);

  const onSave = async (deal) => { await api.saveDeal({ ...deal, agent_id: me }); await refetch(); setDealModal(null); };
  const onDelete = async (id) => { await api.deleteDeal(id); await refetch(); setDealModal(null); };

  return (
    <div>
      <div style={{ fontSize: 12, color: C.mut2 }}>{today}{saving && " · saving…"}</div>
      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <Stat label="KPI (cumulative)" value={`${cumAchv}%`} sub={`${cumEntries.filter((e) => Object.keys(e.values || {}).length).length} days logged`} tone={toneFor(cumAchv)} />
        <Stat label="Today's KPI" value={`${achv}%`} sub="vs daily target" tone={toneFor(achv)} />
        <Stat label="Pipeline value" value={`AED ${fmtAED(openValue(myDeals))}`} sub={`${myDeals.filter((d) => d.status === "open").length} open`} tone={C.gold} />
        <Stat label="Weighted forecast" value={`AED ${fmtAED(weighted(myDeals))}`} sub="value × probability" tone={C.goldHi} />
        <Stat label="Closing this month" value={closingThisMonth(myDeals).length} sub={`AED ${fmtAED(closingThisMonth(myDeals).reduce((s, d) => s + Number(d.value), 0))}`} />
      </div>

      <SectionTitle>Today's activity</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
        {defs.map((d) => {
          const a = Number(local[d.key] || 0);
          const pct = d.target ? Math.round(Math.min(a / d.target, 1) * 100) : 0;
          return (
            <div key={d.key} style={{ background: C.surf, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{d.label}</div>
                <div style={{ fontSize: 11, color: C.mut2 }}>target {d.target}{d.unit || ""}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <button onClick={() => step(d.key, d.unit === "%" ? -100 : -1)} style={stepBtn}>–</button>
                <input value={a} onChange={(e) => setKpi(d.key, e.target.value)} style={{ textAlign: "center", fontWeight: 700, fontSize: 16, padding: 6 }} inputMode="numeric" />
                <button onClick={() => step(d.key, d.unit === "%" ? 100 : 1)} style={stepBtn}>+</button>
              </div>
              <Bar pct={pct} tone={toneFor(pct)} />
            </div>
          );
        })}
      </div>

      <SectionTitle right={<button onClick={() => setDealModal({ status: "open", stage: "New Lead", probability: 5, value: 0, client: "" })} style={goldBtn}>+ Add deal</button>}>My pipeline</SectionTitle>
      {myDeals.length === 0 && <Empty text="No deals yet. Add your first lead to start tracking." />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {myDeals.map((d) => <DealRow key={d.id} d={d} onClick={() => setDealModal(d)} />)}
      </div>
      {dealModal && <DealModal deal={dealModal} onSave={onSave} onDelete={onDelete} onClose={() => setDealModal(null)} />}
    </div>
  );
}

function DealRow({ d, sub, onClick }) {
  const col = d.status === "won" ? C.green : d.status === "lost" ? C.red : C.blue;
  return (
    <button onClick={onClick} style={{ textAlign: "left", cursor: onClick ? "pointer" : "default", width: "100%", background: C.surf, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 150px", minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.client || "—"}{sub && <span style={{ color: C.mut, fontWeight: 400 }}> · {sub}</span>}</div>
        <div style={{ fontSize: 12, color: C.mut }}>{d.project} · {d.unit}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 16, color: C.gold, fontWeight: 600 }}>AED {fmtAED(Number(d.value))}</div>
        <div style={{ fontSize: 11, color: C.mut2 }}>{d.probability}% likely</div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flex: "1 1 100%", justifyContent: "space-between" }}>
        <Chip color={col}>{d.stage}</Chip>
        {d.manager_support && <Chip color={C.amber}>Needs manager</Chip>}
        {d.next_followup && <span style={{ fontSize: 11, color: C.mut2, marginLeft: "auto" }}>next: {d.next_followup}</span>}
      </div>
    </button>
  );
}

function DealModal({ deal, onSave, onDelete, onClose }) {
  const [d, setD] = useState({ objection: "", blocker: "", next_action: "", manager_support: false, unit: "", project: "", client: "", last_contact: todayISO(), next_followup: todayISO(), expected_close: "", ...deal });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setD((p) => ({ ...p, [k]: v }));
  const onStage = (s) => setD((p) => ({ ...p, stage: s, probability: STAGE_PROB[s], status: s === "Closed Won" ? "won" : s === "Closed Lost" ? "lost" : "open" }));
  const save = async () => { setBusy(true); try { await onSave(d); } finally { setBusy(false); } };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.bg2, border: `1px solid ${C.line}`, borderRadius: "18px 18px 0 0", width: "100%", maxWidth: 560, maxHeight: "92vh", overflowY: "auto", padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontFamily: "'Playfair Display',serif", margin: 0, fontSize: 19 }}>{deal.id ? "Edit deal" : "New deal"}</h3>
          <button onClick={onClose} style={{ ...ghostBtn, padding: "6px 10px" }}>Close</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
          <Field label="Client name"><input value={d.client} onChange={(e) => set("client", e.target.value)} /></Field>
          <Field label="Project"><input value={d.project} onChange={(e) => set("project", e.target.value)} /></Field>
          <Field label="Unit"><input value={d.unit} onChange={(e) => set("unit", e.target.value)} /></Field>
          <Field label="Deal value (AED)"><input value={d.value} inputMode="numeric" onChange={(e) => set("value", Math.max(0, Number(e.target.value) || 0))} /></Field>
          <Field label="Pipeline stage"><select value={d.stage} onChange={(e) => onStage(e.target.value)}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Probability %"><input value={d.probability} inputMode="numeric" onChange={(e) => set("probability", Math.min(100, Math.max(0, Number(e.target.value) || 0)))} /></Field>
          <Field label="Last contact"><input type="date" value={d.last_contact || ""} onChange={(e) => set("last_contact", e.target.value)} /></Field>
          <Field label="Next follow-up"><input type="date" value={d.next_followup || ""} onChange={(e) => set("next_followup", e.target.value)} /></Field>
          <Field label="Expected close"><input type="date" value={d.expected_close || ""} onChange={(e) => set("expected_close", e.target.value)} /></Field>
          <Field label="Main objection"><input value={d.objection} onChange={(e) => set("objection", e.target.value)} /></Field>
        </div>
        <Field label="What is stopping the deal?"><textarea rows={2} value={d.blocker} onChange={(e) => set("blocker", e.target.value)} /></Field>
        <Field label="Next action"><input value={d.next_action} onChange={(e) => set("next_action", e.target.value)} /></Field>
        <label style={{ display: "flex", alignItems: "center", gap: 9, margin: "6px 0 16px", cursor: "pointer" }}>
          <input type="checkbox" checked={!!d.manager_support} onChange={(e) => set("manager_support", e.target.checked)} style={{ width: 18, height: 18 }} />
          <span style={{ fontSize: 14 }}>Flag for manager support</span>
        </label>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={save} disabled={busy} style={{ ...goldBtn, flex: 1, padding: 11, opacity: busy ? 0.6 : 1 }}>{busy ? "Saving…" : "Save deal"}</button>
          {deal.id && <button onClick={() => onDelete(d.id)} style={{ ...ghostBtn, color: C.red, borderColor: `${C.red}55` }}>Delete</button>}
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  TEAM LEADER
// ============================================================
function LeaderView({ ctx }) {
  const { defs, deals, entries, people, profile } = ctx;
  const today = todayISO();
  const [tab, setTab] = useState("team");   // 'team' | 'mine'
  const [openAgent, setOpenAgent] = useState(null);

  const roster = people.filter((p) => p.team_id === profile.team_id && p.role === "agent");
  const rows = roster.map((a) => {
    const agentEntries = entries.filter((e) => e.agent_id === a.id);
    const entry = agentEntries.find((e) => e.entry_date === today);
    const ds = deals.filter((d) => d.agent_id === a.id);
    return { a, achv: cumulativeAchievement(agentEntries, defs), open: openValue(ds), wtd: weighted(ds), flags: ds.filter((d) => d.manager_support).length, hasEntry: !!entry };
  });
  const teamDeals = deals.filter((d) => roster.some((a) => a.id === d.agent_id));
  const avgAchv = Math.round(rows.reduce((s, r) => s + r.achv, 0) / (rows.length || 1));

  const segBtn = (k, label) => (
    <button onClick={() => setTab(k)} style={{ flex: 1, border: "none", cursor: "pointer", borderRadius: 8, padding: "8px 0", fontSize: 13, fontWeight: 600,
      background: tab === k ? `linear-gradient(135deg,${C.gold},${C.goldHi})` : "transparent", color: tab === k ? C.bg : C.mut }}>{label}</button>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 4, background: C.surf, padding: 4, borderRadius: 11, border: `1px solid ${C.line}`, marginBottom: 14, maxWidth: 320 }}>
        {segBtn("mine", "My work")}{segBtn("team", "My team")}
      </div>

      {tab === "mine" ? <AgentView ctx={ctx} /> : (
        <>
          <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
            <Stat label="Team pipeline" value={`AED ${fmtAED(openValue(teamDeals))}`} tone={C.gold} />
            <Stat label="Weighted forecast" value={`AED ${fmtAED(weighted(teamDeals))}`} tone={C.goldHi} />
            <Stat label="Avg team KPI" value={`${avgAchv}%`} tone={toneFor(avgAchv)} />
            <Stat label="Support flags" value={rows.reduce((s, r) => s + r.flags, 0)} sub="deals needing you" tone={C.amber} />
          </div>

          <SectionTitle>Agent scorecard <span style={{ fontSize: 12, color: C.mut2, fontFamily: "'DM Sans',sans-serif" }}>· tap an agent for detail</span></SectionTitle>
          {rows.length === 0 && <Empty text="No agents assigned to your team yet." />}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((r) => (
              <button key={r.a.id} onClick={() => setOpenAgent(r.a)} style={{ textAlign: "left", cursor: "pointer", width: "100%", color: C.text, background: C.surf, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 600, flex: "1 1 120px" }}>{r.a.full_name}{!r.hasEntry && <span style={{ fontSize: 11, color: C.red, marginLeft: 8 }}>· no entry today</span>}</div>
                  <div style={{ fontSize: 12, color: C.mut }}>Pipeline <b style={{ color: C.gold }}>AED {fmtAED(r.open)}</b></div>
                  <div style={{ fontSize: 12, color: C.mut }}>Weighted <b style={{ color: C.goldHi }}>AED {fmtAED(r.wtd)}</b></div>
                  {r.flags > 0 && <Chip color={C.amber}>{r.flags} flag{r.flags > 1 ? "s" : ""}</Chip>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 9 }}>
                  <div style={{ flex: 1 }}><Bar pct={r.achv} tone={toneFor(r.achv)} /></div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: toneFor(r.achv), width: 42, textAlign: "right" }}>{r.achv}%</div>
                </div>
              </button>
            ))}
          </div>

          <SectionTitle>Deals needing your support</SectionTitle>
          {teamDeals.filter((d) => d.manager_support).length === 0
            ? <Empty text="No open support requests. Team is unblocked." />
            : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {teamDeals.filter((d) => d.manager_support).map((d) => (
                <DealRow key={d.id} d={d} sub={ctx.nameOf(d.agent_id)} />
              ))}
            </div>}

          <SectionTitle>Team pipeline by stage</SectionTitle>
          <StageBoard deals={teamDeals} />
        </>
      )}

      {openAgent && <AgentDetail agent={openAgent} ctx={ctx} onClose={() => setOpenAgent(null)} />}
    </div>
  );
}

// Read-only drill-down: an agent's deals + day-by-day KPI history for the month.
function AgentDetail({ agent, ctx, onClose }) {
  const { defs, deals, entries } = ctx;
  const ym = todayISO().slice(0, 7);
  const myEntries = entries.filter((e) => e.agent_id === agent.id && (e.entry_date || "").slice(0, 7) === ym)
    .sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
  const myDeals = deals.filter((d) => d.agent_id === agent.id);
  const cum = cumulativeAchievement(myEntries, defs);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.bg2, border: `1px solid ${C.line}`, borderRadius: "18px 18px 0 0", width: "100%", maxWidth: 720, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 18px 10px", borderBottom: `1px solid ${C.line}`, position: "sticky", top: 0, background: C.bg2, borderRadius: "18px 18px 0 0", flexShrink: 0 }}>
          <h3 style={{ fontFamily: "'Playfair Display',serif", margin: 0, fontSize: 20, color: C.text }}>{agent.full_name}</h3>
          <button onClick={onClose} style={{ ...ghostBtn, padding: "6px 12px" }}>Close</button>
        </div>
        <div style={{ overflowY: "auto", WebkitOverflowScrolling: "touch", padding: 18 }}>
        <div style={{ fontSize: 12, color: C.mut2, marginBottom: 14 }}>{ym} · cumulative KPI {cum}% · {myEntries.length} days logged</div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <Stat label="Pipeline" value={`AED ${fmtAED(openValue(myDeals))}`} tone={C.gold} />
          <Stat label="Weighted" value={`AED ${fmtAED(weighted(myDeals))}`} tone={C.goldHi} />
          <Stat label="Won" value={`AED ${fmtAED(wonValue(myDeals))}`} tone={C.green} />
        </div>

        <SectionTitle>Daily KPI history · {ym}</SectionTitle>
        {myEntries.length === 0 ? <Empty text="No KPI entries logged this month." /> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 520 }}>
              <thead><tr style={{ color: C.mut2, textAlign: "left", fontSize: 10.5, textTransform: "uppercase" }}>
                <th style={{ ...td, position: "sticky", left: 0, background: C.bg2 }}>Date</th>
                {defs.map((d) => <th key={d.key} style={{ ...td, textAlign: "center" }} title={d.label}>{d.label.split(" ")[0]}</th>)}
              </tr></thead>
              <tbody>{myEntries.map((e) => (
                <tr key={e.id || e.entry_date}>
                  <td style={{ ...td, position: "sticky", left: 0, background: C.bg2, fontWeight: 600 }}>{e.entry_date.slice(5)}</td>
                  {defs.map((d) => {
                    const v = Number(e.values?.[d.key] || 0);
                    const hit = d.target ? v >= d.target : false;
                    return <td key={d.key} style={{ ...td, textAlign: "center", color: hit ? C.green : v ? C.text : C.mut2 }}>{v || "·"}</td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

        <SectionTitle>Deals</SectionTitle>
        {myDeals.length === 0 ? <Empty text="No deals yet." /> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {myDeals.map((d) => <DealRow key={d.id} d={d} />)}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  MANAGEMENT
// ============================================================
function MgmtView({ ctx }) {
  const { defs, deals, entries, people, teams, nameOf, teamOf } = ctx;
  const today = todayISO();

  // ---- filters: team, agent, month ----
  const [fTeam, setFTeam] = useState("");
  const [fAgent, setFAgent] = useState("");
  const [fMonth, setFMonth] = useState("");
  const months = Array.from(new Set(entries.map((e) => (e.entry_date || "").slice(0, 7)).concat(deals.map((d) => (d.expected_close || "").slice(0, 7))).filter(Boolean))).sort().reverse();

  const agentsInScope = people.filter((p) => p.role === "agent" && (!fTeam || p.team_id === fTeam) && (!fAgent || p.id === fAgent));
  const scopeIds = new Set(agentsInScope.map((a) => a.id));
  const fDeals = deals.filter((d) => scopeIds.has(d.agent_id) && (!fMonth || inMonth(d.expected_close, fMonth)));
  const fEntries = entries.filter((e) => scopeIds.has(e.agent_id) && inMonth(e.entry_date, fMonth));

  const clearFilters = () => { setFTeam(""); setFAgent(""); setFMonth(""); };
  const filtered = fTeam || fAgent || fMonth;

  const teamRows = teams.filter((t) => !fTeam || t.id === fTeam).map((t) => {
    const roster = agentsInScope.filter((a) => a.team_id === t.id);
    const ds = fDeals.filter((d) => roster.some((a) => a.id === d.agent_id));
    const rEntries = fEntries.filter((e) => roster.some((a) => a.id === e.agent_id));
    const achvs = roster.map((a) => cumulativeAchievement(rEntries.filter((e) => e.agent_id === a.id), defs));
    return { t, agents: roster.length, open: openValue(ds), wtd: weighted(ds), closing: closingThisMonth(ds).length, achv: Math.round(achvs.reduce((s, x) => s + x, 0) / (achvs.length || 1)) };
  }).filter((r) => r.agents > 0);
  const agentRows = agentsInScope.map((a) => {
    const ds = fDeals.filter((d) => d.agent_id === a.id);
    return { a, team: teamOf(a.team_id), open: openValue(ds), wtd: weighted(ds), won: wonValue(ds), achv: cumulativeAchievement(fEntries.filter((e) => e.agent_id === a.id), defs) };
  }).sort((x, y) => y.wtd - x.wtd);

  const totals = sumEntries(fEntries);
  const sumK = (k) => Number(totals[k] || 0);
  const funnel = [
    { l: "New leads", v: sumK("newLeads") }, { l: "Qualified", v: sumK("qualified") },
    { l: "Meetings", v: sumK("meetingsDone") }, { l: "Viewings", v: sumK("viewings") },
    { l: "Reservations", v: sumK("reservations") },
  ];
  const fMax = Math.max(...funnel.map((f) => f.v), 1);
  const totClosing = closingThisMonth(fDeals);
  const scopeNote = filtered
    ? [fTeam && teamOf(fTeam), fAgent && nameOf(fAgent), fMonth].filter(Boolean).join(" · ")
    : "all agents · all time";

  const exportCSV = () => {
    const cols = ["deal_id", "agent", "team", "client", "project", "unit", "value_aed", "stage", "probability", "status", "expected_close", "objection", "manager_support"];
    const lines = [cols.join(",")];
    fDeals.forEach((d) => lines.push([d.id, nameOf(d.agent_id), teamOf(people.find((p) => p.id === d.agent_id)?.team_id), d.client, d.project, d.unit, d.value, d.stage, d.probability, d.status, d.expected_close, (d.objection || "").replace(/,/g, ";"), d.manager_support ? "YES" : ""].map((x) => `"${x ?? ""}"`).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "amlak_pipeline_export.csv"; a.click();
  };

  const selStyle = { width: "auto", minWidth: 130, padding: "8px 10px", fontSize: 13 };

  return (
    <div>
      {/* ---- Filter bar ---- */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: C.surf, border: `1px solid ${C.line}`, borderRadius: 12, padding: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 11, color: C.mut2, textTransform: "uppercase", letterSpacing: ".08em", marginRight: 2 }}>Filter</span>
        <select value={fTeam} onChange={(e) => { setFTeam(e.target.value); setFAgent(""); }} style={selStyle}>
          <option value="">All teams</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={fAgent} onChange={(e) => setFAgent(e.target.value)} style={selStyle}>
          <option value="">All agents</option>
          {people.filter((p) => p.role === "agent" && (!fTeam || p.team_id === fTeam)).map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
        </select>
        <select value={fMonth} onChange={(e) => setFMonth(e.target.value)} style={selStyle}>
          <option value="">All months</option>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {filtered && <button onClick={clearFilters} style={{ ...ghostBtn, padding: "7px 12px" }}>Clear</button>}
        <span style={{ fontSize: 12, color: C.mut, marginLeft: "auto" }}>{scopeNote}</span>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
        <Stat label="Total pipeline" value={`AED ${fmtAED(openValue(fDeals))}`} sub={`${fDeals.filter((d) => d.status === "open").length} open deals`} tone={C.gold} />
        <Stat label="Weighted forecast" value={`AED ${fmtAED(weighted(fDeals))}`} sub="prob-adjusted" tone={C.goldHi} />
        <Stat label="Closing this month" value={`AED ${fmtAED(totClosing.reduce((s, d) => s + Number(d.value), 0))}`} sub={`${totClosing.length} deals`} tone={C.blue} />
        <Stat label="Won" value={`AED ${fmtAED(wonValue(fDeals))}`} sub={`${fDeals.filter((d) => d.status === "won").length} closed`} tone={C.green} />
      </div>

      <SectionTitle right={<button onClick={exportCSV} style={ghostBtn}>Export CSV</button>}>By team</SectionTitle>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560, fontSize: 13.5 }}>
          <thead><tr style={{ color: C.mut2, textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>
            {["Team", "Agents", "Pipeline", "Weighted", "Closing", "KPI"].map((h) => <th key={h} style={{ padding: "8px 10px", borderBottom: `1px solid ${C.line}` }}>{h}</th>)}
          </tr></thead>
          <tbody>{teamRows.map((r) => (
            <tr key={r.t.id}>
              <td style={td}>{r.t.name}</td><td style={td}>{r.agents}</td>
              <td style={{ ...td, color: C.gold, fontWeight: 600 }}>AED {fmtAED(r.open)}</td>
              <td style={{ ...td, color: C.goldHi }}>AED {fmtAED(r.wtd)}</td>
              <td style={td}>{r.closing}</td>
              <td style={td}><span style={{ color: toneFor(r.achv), fontWeight: 700 }}>{r.achv}%</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <SectionTitle>Today's activity funnel</SectionTitle>
      <div style={{ background: C.surf, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16 }}>
        {funnel.map((f, i) => (
          <div key={f.l} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: i < funnel.length - 1 ? 10 : 0 }}>
            <div style={{ width: 92, fontSize: 13, color: C.mut }}>{f.l}</div>
            <div style={{ flex: 1, height: 26, background: C.surf2, borderRadius: 7, overflow: "hidden" }}>
              <div style={{ width: `${(f.v / fMax) * 100}%`, height: "100%", background: `linear-gradient(90deg,${C.gold},${C.goldHi})`, borderRadius: 7, minWidth: f.v ? 28 : 0 }} />
            </div>
            <div style={{ width: 40, textAlign: "right", fontWeight: 700 }}>{f.v}</div>
          </div>
        ))}
      </div>

      <SectionTitle>Agent leaderboard · by weighted forecast</SectionTitle>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600, fontSize: 13.5 }}>
          <thead><tr style={{ color: C.mut2, textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>
            {["#", "Agent", "Team", "Pipeline", "Weighted", "Won", "KPI"].map((h) => <th key={h} style={{ padding: "8px 10px", borderBottom: `1px solid ${C.line}` }}>{h}</th>)}
          </tr></thead>
          <tbody>{agentRows.map((r, i) => (
            <tr key={r.a.id}>
              <td style={{ ...td, color: C.mut2 }}>{i + 1}</td>
              <td style={{ ...td, fontWeight: 600 }}>{r.a.full_name}</td>
              <td style={{ ...td, color: C.mut }}>{r.team}</td>
              <td style={{ ...td, color: C.gold }}>AED {fmtAED(r.open)}</td>
              <td style={{ ...td, color: C.goldHi, fontWeight: 600 }}>AED {fmtAED(r.wtd)}</td>
              <td style={{ ...td, color: C.green }}>AED {fmtAED(r.won)}</td>
              <td style={td}><span style={{ color: toneFor(r.achv), fontWeight: 700 }}>{r.achv}%</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <SectionTitle>Pipeline by stage · company</SectionTitle>
      <StageBoard deals={deals} />
    </div>
  );
}

function StageBoard({ deals }) {
  const byStage = OPEN_STAGES.map((s) => {
    const ds = deals.filter((d) => d.stage === s && d.status === "open");
    return { s, count: ds.length, value: ds.reduce((a, d) => a + Number(d.value), 0) };
  }).filter((x) => x.count > 0);
  const max = Math.max(...byStage.map((x) => x.value), 1);
  if (byStage.length === 0) return <Empty text="No open deals in pipeline." />;
  return (
    <div style={{ background: C.surf, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16 }}>
      {byStage.map((x, i) => (
        <div key={x.s} style={{ marginBottom: i < byStage.length - 1 ? 12 : 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 5 }}>
            <span>{x.s} <span style={{ color: C.mut2 }}>· {x.count}</span></span>
            <span style={{ color: C.gold, fontWeight: 600 }}>AED {fmtAED(x.value)}</span>
          </div>
          <Bar pct={(x.value / max) * 100} tone={C.gold} />
        </div>
      ))}
    </div>
  );
}
