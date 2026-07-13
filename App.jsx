import React, { useState, useEffect, useCallback, useRef } from "react";
import { BookOpen, Users, MessageCircle, ChevronRight, Plus, Copy, Check, Video, ArrowLeft, Send, Flame, Search, LogOut, Award, Star } from "lucide-react";
import { supabase } from "./supabaseClient";

const MAX_MEMBERS = 10;
const REACTIONS = ["👍", "❤️", "😂", "😮", "🎉"];

const PALETTES = {
  moss:     { bg: "#F2ECDD", surface: "#FBF8F0", ink: "#2A2620", muted: "#8A8069", border: "#DDD2B8", accent: "#3B5240", accentInk: "#F2ECDD", gold: "#C9A24B" },
  ink:      { bg: "#E9EDF2", surface: "#F7F9FB", ink: "#1B2430", muted: "#6E7B8C", border: "#CBD5DF", accent: "#28405E", accentInk: "#F2ECDD", gold: "#B98C4A" },
  rosewood: { bg: "#F5EAE7", surface: "#FCF5F3", ink: "#301E1C", muted: "#8F6E68", border: "#E3CBC4", accent: "#7A3B3B", accentInk: "#F5EAE7", gold: "#C4915B" },
  slate:    { bg: "#EAEAEA", surface: "#F6F6F6", ink: "#232323", muted: "#7A7A7A", border: "#D3D3D3", accent: "#3E3E3E", accentInk: "#F0F0F0", gold: "#A08A5E" },
};

// ---------- db helpers (all real Supabase calls) ----------
const db = {
  async getClubByCode(code) {
    const { data, error } = await supabase.from("clubs").select("*").eq("code", code).maybeSingle();
    if (error) throw error;
    return data;
  },
  async listClubs() {
    const { data, error } = await supabase.from("clubs").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async createClub(club) {
    const { data, error } = await supabase.from("clubs").insert(club).select().single();
    if (error) throw error;
    return data;
  },
  async getMemberships(clubId) {
    const { data, error } = await supabase.from("memberships").select("*, profiles(username)").eq("club_id", clubId);
    if (error) throw error;
    return data || [];
  },
  async joinClub(clubId, userId) {
    const { error } = await supabase.from("memberships").upsert(
      { club_id: clubId, user_id: userId, progress: 0 },
      { onConflict: "club_id,user_id", ignoreDuplicates: true }
    );
    if (error) throw error;
  },
  async setProgress(clubId, userId, progress) {
    const { error } = await supabase.from("memberships").update({ progress }).eq("club_id", clubId).eq("user_id", userId);
    if (error) throw error;
  },
  async getComments(clubId, idx) {
    const { data, error } = await supabase
      .from("comments")
      .select("*, profiles(username)")
      .eq("club_id", clubId)
      .eq("checkpoint_idx", idx)
      .order("created_at");
    if (error) throw error;
    return data || [];
  },
  async postComment(clubId, idx, userId, body) {
    const { error } = await supabase.from("comments").insert({ club_id: clubId, checkpoint_idx: idx, user_id: userId, body });
    if (error) throw error;
  },
  async getReactions(commentIds) {
    if (!commentIds.length) return [];
    const { data, error } = await supabase.from("reactions").select("*").in("comment_id", commentIds);
    if (error) throw error;
    return data || [];
  },
  async toggleReaction(commentId, userId, emoji, exists) {
    if (exists) {
      const { error } = await supabase.from("reactions").delete().eq("comment_id", commentId).eq("user_id", userId).eq("emoji", emoji);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("reactions").insert({ comment_id: commentId, user_id: userId, emoji });
      if (error) throw error;
    }
  },
  async getCall(clubId, idx) {
    const { data, error } = await supabase.from("calls").select("*").eq("club_id", clubId).eq("checkpoint_idx", idx).maybeSingle();
    if (error) throw error;
    return data;
  },
  async saveCall(clubId, idx, note, userId) {
    if (note) {
      const { error } = await supabase.from("calls").upsert({ club_id: clubId, checkpoint_idx: idx, note, set_by: userId }, { onConflict: "club_id,checkpoint_idx" });
      if (error) throw error;
    } else {
      const { error } = await supabase.from("calls").delete().eq("club_id", clubId).eq("checkpoint_idx", idx);
      if (error) throw error;
    }
  },
  async getRatings(clubId) {
    const { data, error } = await supabase.from("ratings").select("*").eq("club_id", clubId);
    if (error) throw error;
    return data || [];
  },
  async submitRating(clubId, userId, rating) {
    const { error } = await supabase.from("ratings").upsert({ club_id: clubId, user_id: userId, rating }, { onConflict: "club_id,user_id" });
    if (error) throw error;
  },
  async getBadges(userId) {
    const { data, error } = await supabase.from("ratings").select("rating, clubs(title, cover_url, code)").eq("user_id", userId);
    if (error) throw error;
    return data || [];
  },
};

// ---------- helpers ----------
function makeCode() {
  const words = ["OAK", "FERN", "MOSS", "TIDE", "SAGE", "PLUM", "REED", "DUSK", "IVY", "COAL"];
  return `${words[Math.floor(Math.random() * words.length)]}${Math.floor(10 + Math.random() * 90)}`;
}
function fmtDate(d) { return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function addDays(dateStr, days) { const d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() + days); return d; }
function todayISO() { return new Date().toISOString().slice(0, 10); }

function buildCheckpoints(club) {
  const { total_units, unit_type, start_date, cadence_days, units_per_cadence } = club;
  const checkpoints = [];
  let unit = 0, idx = 0;
  while (unit < total_units) {
    const from = unit + 1;
    const to = Math.min(unit + units_per_cadence, total_units);
    const date = addDays(start_date, idx * cadence_days);
    checkpoints.push({ idx, from, to, date: date.toISOString().slice(0, 10), label: `${unit_type === "pages" ? "Pages" : "Chapters"} ${from}\u2013${to}` });
    unit = to; idx += 1;
  }
  return checkpoints;
}
function currentCheckpointIndex(checkpoints) {
  const today = todayISO(); let current = 0;
  for (let i = 0; i < checkpoints.length; i++) if (checkpoints[i].date <= today) current = i;
  return current;
}
async function lookupBook(title) {
  try {
    const res = await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=1&fields=cover_i,number_of_pages_median`);
    const data = await res.json();
    const doc = data.docs && data.docs[0];
    if (!doc) return null;
    return {
      coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
      pages: doc.number_of_pages_median || null,
    };
  } catch (e) { return null; }
}

// ---------- UI atoms ----------
function Avatar({ name }) {
  const colors = ["#8A6D3B", "#4C6B52", "#6B4C6B", "#3B5C8A", "#8A4C4C", "#5C6B3B"];
  const idx = name ? name.charCodeAt(0) % colors.length : 0;
  return (
    <div className="flex items-center justify-center rounded-full text-white font-semibold shrink-0" style={{ background: colors[idx], width: 32, height: 32, fontSize: 13 }}>
      {name ? name.slice(0, 2).toUpperCase() : "??"}
    </div>
  );
}
function Cover({ url, size = 44 }) {
  return url ? (
    <img src={url} alt="" style={{ width: size, height: size * 1.45, objectFit: "cover", borderRadius: 4, boxShadow: "0 2px 6px rgba(0,0,0,0.2)" }} />
  ) : (
    <div style={{ width: size, height: size * 1.45, borderRadius: 4, background: "#D8CDAE", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <BookOpen size={size * 0.4} color="#8A8069" />
    </div>
  );
}
function Field({ p, label, children }) {
  return <div className="mb-4"><label className="sans text-xs font-medium block mb-1.5" style={{ color: p.muted }}>{label}</label>{children}</div>;
}

// ---------- App ----------
export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  const [profile, setProfile] = useState(null); // { id, username }
  const [screen, setScreen] = useState("home");
  const [club, setClub] = useState(null);
  const [clubCode, setClubCode] = useState(null);
  const [p, setP] = useState(PALETTES.moss);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle().then(({ data }) => {
      if (data) setProfile({ id: data.id, username: data.username });
    });
  }, [session]);

  useEffect(() => { setP(club?.palette_id ? PALETTES[club.palette_id] || PALETTES.moss : PALETTES.moss); }, [club]);

  if (session === undefined) return <div className="min-h-screen flex items-center justify-center sans text-sm" style={{ color: "#8A8069" }}>Loading…</div>;
  if (!session || !profile) return <Auth p={PALETTES.moss} onAuthed={setProfile} />;

  return (
    <div className="min-h-screen w-full" style={{ background: p.bg, fontFamily: "'Iowan Old Style','Palatino Linotype',Georgia,serif", color: p.ink }}>
      <style>{`.sans { font-family: 'Avenir Next','Segoe UI',Helvetica,Arial,sans-serif; } input, textarea, select { font-family: inherit; } button { cursor: pointer; }`}</style>

      {screen !== "club" && (
        <div className="max-w-md mx-auto px-6 pt-5 flex items-center justify-between sans text-xs" style={{ color: p.muted }}>
          <span>Signed in as <b style={{ color: p.ink }}>{profile.username}</b></span>
          <div className="flex items-center gap-3">
            <button onClick={() => setScreen("profile")} className="flex items-center gap-1"><Award size={14} /> Badges</button>
            <button onClick={() => supabase.auth.signOut()} className="flex items-center gap-1"><LogOut size={14} /> Sign out</button>
          </div>
        </div>
      )}

      {screen === "home" && <Home p={p} onCreate={() => setScreen("create")} onJoin={() => setScreen("join")} onBrowse={() => setScreen("browse")} />}
      {screen === "create" && <CreateClub p={p} me={profile} onBack={() => setScreen("home")} onCreated={(c) => { setClubCode(c.code); setClub(c); setScreen("club"); }} />}
      {screen === "join" && <JoinClub p={p} me={profile} onBack={() => setScreen("home")} onJoined={(c) => { setClubCode(c.code); setClub(c); setScreen("club"); }} />}
      {screen === "browse" && <Browse p={p} me={profile} onBack={() => setScreen("home")} onJoined={(c) => { setClubCode(c.code); setClub(c); setScreen("club"); }} />}
      {screen === "profile" && <Profile p={p} me={profile} onBack={() => setScreen("home")} />}
      {screen === "club" && club && <ClubView p={p} code={clubCode} initialClub={club} me={profile} onLeave={() => { setScreen("home"); setClub(null); setClubCode(null); }} />}
    </div>
  );
}

// ---------- Auth ----------
function Auth({ p, onAuthed }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(""); setInfo("");
    if (!email.trim() || !password.trim() || (mode === "signup" && !username.trim())) { setErr("Fill in every field."); return; }
    setBusy(true);
    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) { setErr(error.message); setBusy(false); return; }
      if (!data.session) {
        setInfo("Check your email to confirm your account, then sign in.");
        setBusy(false);
        return;
      }
      const { error: profileErr } = await supabase.from("profiles").insert({ id: data.user.id, username: username.trim() });
      if (profileErr) { setErr(profileErr.message.includes("duplicate") ? "That username is taken." : profileErr.message); setBusy(false); return; }
      setBusy(false);
      onAuthed({ id: data.user.id, username: username.trim() });
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) { setErr(error.message); setBusy(false); return; }
      const { data: prof } = await supabase.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
      setBusy(false);
      if (prof) onAuthed({ id: prof.id, username: prof.username });
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center" style={{ background: p.bg, fontFamily: "Georgia, serif" }}>
      <div className="max-w-xs w-full px-6">
        <div className="flex items-center justify-center rounded-2xl mb-5 mx-auto" style={{ width: 56, height: 56, background: p.accent }}>
          <BookOpen size={26} color={p.accentInk} />
        </div>
        <h1 className="text-2xl text-center mb-1" style={{ fontWeight: 600 }}>Chapter &amp; Verse</h1>
        <p className="sans text-xs text-center mb-6" style={{ color: p.muted }}>{mode === "signup" ? "Create an account to get started." : "Welcome back."}</p>

        {mode === "signup" && (
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username"
            className="sans w-full rounded-lg px-3 py-2.5 outline-none border mb-3" style={{ borderColor: p.border, background: p.surface }} />
        )}
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email"
          className="sans w-full rounded-lg px-3 py-2.5 outline-none border mb-3" style={{ borderColor: p.border, background: p.surface }} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password"
          className="sans w-full rounded-lg px-3 py-2.5 outline-none border mb-4" style={{ borderColor: p.border, background: p.surface }} />

        {err && <p className="sans text-xs mb-3" style={{ color: "#8A4C4C" }}>{err}</p>}
        {info && <p className="sans text-xs mb-3" style={{ color: p.accent }}>{info}</p>}

        <button onClick={submit} disabled={busy} className="sans w-full font-medium rounded-xl py-3 mb-3" style={{ background: p.accent, color: p.accentInk, opacity: busy ? 0.7 : 1 }}>
          {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
        <button onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setErr(""); setInfo(""); }} className="sans w-full text-xs text-center" style={{ color: p.muted }}>
          {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </div>
    </div>
  );
}

// ---------- Home ----------
function Home({ p, onCreate, onJoin, onBrowse }) {
  return (
    <div className="max-w-md mx-auto px-6 pt-10 pb-10 flex flex-col items-center text-center">
      <h2 className="text-3xl mb-2" style={{ fontWeight: 600, letterSpacing: "-0.01em" }}>Read together, on a pace</h2>
      <p className="sans text-sm mb-8 max-w-xs" style={{ color: p.muted }}>Set a page or chapter target, and talk about each part once everyone's caught up.</p>
      <button onClick={onCreate} className="sans w-full font-medium rounded-xl py-3.5 mb-3 flex items-center justify-center gap-2" style={{ background: p.accent, color: p.accentInk }}><Plus size={18} /> Start a new club</button>
      <button onClick={onJoin} className="sans w-full font-medium rounded-xl py-3.5 mb-3 flex items-center justify-center gap-2 border" style={{ borderColor: p.border, background: "transparent" }}><Users size={18} /> Join with a code</button>
      <button onClick={onBrowse} className="sans w-full font-medium rounded-xl py-3.5 flex items-center justify-center gap-2 border" style={{ borderColor: p.border, background: "transparent" }}><Search size={18} /> Find a club by book</button>
    </div>
  );
}

// ---------- Browse ----------
function Browse({ p, me, onBack, onJoined }) {
  const [q, setQ] = useState("");
  const [clubs, setClubs] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const list = await db.listClubs();
      setClubs(list);
      const c = {};
      await Promise.all(list.map(async (club) => { c[club.id] = (await db.getMemberships(club.id)).length; }));
      setCounts(c);
      setLoading(false);
    })();
  }, []);

  const filtered = clubs.filter((c) => !q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase()));

  async function join(clubData) {
    const count = counts[clubData.id] ?? 0;
    if (count >= MAX_MEMBERS) { setErr(`${clubData.title}'s club is full (${MAX_MEMBERS} max).`); return; }
    await db.joinClub(clubData.id, me.id);
    onJoined(clubData);
  }

  return (
    <div className="max-w-md mx-auto px-6 pt-6 pb-16">
      <button onClick={onBack} className="sans text-sm flex items-center gap-1 mb-5" style={{ color: p.muted }}><ArrowLeft size={16} /> Back</button>
      <h2 className="text-2xl mb-4" style={{ fontWeight: 600 }}>Find a club</h2>
      <div className="relative mb-5">
        <Search size={16} style={{ position: "absolute", left: 12, top: 13, color: p.muted }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by book title" className="sans w-full rounded-lg pl-9 pr-3 py-2.5 outline-none border" style={{ borderColor: p.border, background: p.surface }} />
      </div>
      {err && <p className="sans text-xs mb-3" style={{ color: "#8A4C4C" }}>{err}</p>}
      {loading && <p className="sans text-sm" style={{ color: p.muted }}>Loading clubs…</p>}
      {!loading && filtered.length === 0 && <p className="sans text-sm" style={{ color: p.muted }}>No clubs match yet — start one!</p>}
      <div className="flex flex-col gap-3">
        {filtered.map((c) => (
          <button key={c.id} onClick={() => join(c)} className="text-left rounded-xl p-3.5 flex gap-3 items-center border" style={{ borderColor: p.border, background: p.surface }}>
            <Cover url={c.cover_url} />
            <div className="flex-1">
              <div className="text-sm font-medium">{c.title}</div>
              <div className="sans text-xs" style={{ color: p.muted }}>{counts[c.id] ?? 0}/{MAX_MEMBERS} members · {c.total_units} {c.unit_type}</div>
            </div>
            <ChevronRight size={16} color={p.muted} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- Create ----------
function CreateClub({ p, me, onBack, onCreated }) {
  const [title, setTitle] = useState("");
  const [unitType, setUnitType] = useState("pages");
  const [totalUnits, setTotalUnits] = useState("300");
  const [cadence, setCadence] = useState("1");
  const [unitsPerCadence, setUnitsPerCadence] = useState("30");
  const [startDate, setStartDate] = useState(todayISO());
  const [paletteId, setPaletteId] = useState("moss");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleCreate() {
    if (!title.trim() || !totalUnits || !unitsPerCadence) { setErr("Fill in the book title and reading targets."); return; }
    setBusy(true); setErr("");
    let code = makeCode();
    let existing = await db.getClubByCode(code);
    let tries = 0;
    while (existing && tries < 5) { code = makeCode(); existing = await db.getClubByCode(code); tries++; }
    const bookInfo = await lookupBook(title.trim());
    try {
      const clubData = await db.createClub({
        code, title: title.trim(), unit_type: unitType,
        total_units: parseInt(totalUnits, 10), cadence_days: parseInt(cadence, 10),
        units_per_cadence: parseInt(unitsPerCadence, 10), start_date: startDate,
        palette_id: paletteId, cover_url: bookInfo?.coverUrl || null, known_pages: bookInfo?.pages || null,
        created_by: me.id,
      });
      await db.joinClub(clubData.id, me.id);
      setBusy(false);
      onCreated(clubData);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div className="max-w-md mx-auto px-6 pt-6 pb-16">
      <button onClick={onBack} className="sans text-sm flex items-center gap-1 mb-5" style={{ color: p.muted }}><ArrowLeft size={16} /> Back</button>
      <h2 className="text-2xl mb-1" style={{ fontWeight: 600 }}>Start a club</h2>
      <p className="sans text-sm mb-6" style={{ color: p.muted }}>Up to {MAX_MEMBERS} people. Anyone can find it by book title.</p>

      <Field p={p} label="Book title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Bell Jar" className="sans w-full rounded-lg px-3 py-2.5 outline-none border" style={{ borderColor: p.border, background: p.surface }} />
      </Field>
      <Field p={p} label="Track by">
        <div className="flex gap-2">
          {["pages", "chapters"].map((u) => (
            <button key={u} onClick={() => setUnitType(u)} className="sans flex-1 rounded-lg py-2.5 text-sm capitalize border"
              style={{ background: unitType === u ? p.accent : "transparent", color: unitType === u ? p.accentInk : p.ink, borderColor: unitType === u ? p.accent : p.border }}>{u}</button>
          ))}
        </div>
      </Field>
      <Field p={p} label={`Total ${unitType}`}>
        <input type="number" value={totalUnits} onChange={(e) => setTotalUnits(e.target.value)} className="sans w-full rounded-lg px-3 py-2.5 outline-none border" style={{ borderColor: p.border, background: p.surface }} />
      </Field>
      <Field p={p} label="Checkpoint cadence">
        <div className="flex gap-2">
          {[{ v: "1", l: "Daily" }, { v: "7", l: "Weekly" }].map((c) => (
            <button key={c.v} onClick={() => setCadence(c.v)} className="sans flex-1 rounded-lg py-2.5 text-sm border"
              style={{ background: cadence === c.v ? p.accent : "transparent", color: cadence === c.v ? p.accentInk : p.ink, borderColor: cadence === c.v ? p.accent : p.border }}>{c.l}</button>
          ))}
        </div>
      </Field>
      <Field p={p} label={`${unitType === "pages" ? "Pages" : "Chapters"} per checkpoint`}>
        <input type="number" value={unitsPerCadence} onChange={(e) => setUnitsPerCadence(e.target.value)} className="sans w-full rounded-lg px-3 py-2.5 outline-none border" style={{ borderColor: p.border, background: p.surface }} />
      </Field>
      <Field p={p} label="Start date">
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="sans w-full rounded-lg px-3 py-2.5 outline-none border" style={{ borderColor: p.border, background: p.surface }} />
      </Field>
      <Field p={p} label="Color theme">
        <div className="flex gap-2">
          {Object.keys(PALETTES).map((key) => (
            <button key={key} onClick={() => setPaletteId(key)} className="w-9 h-9 rounded-full border-2" style={{ background: PALETTES[key].accent, borderColor: paletteId === key ? PALETTES[key].gold : "transparent" }} />
          ))}
        </div>
      </Field>

      {err && <p className="sans text-sm mb-3" style={{ color: "#8A4C4C" }}>{err}</p>}
      <button onClick={handleCreate} disabled={busy} className="sans w-full font-medium rounded-xl py-3.5 mt-2 flex items-center justify-center gap-2" style={{ background: p.accent, color: p.accentInk, opacity: busy ? 0.7 : 1 }}>
        {busy ? "Creating…" : "Create club"} {!busy && <ChevronRight size={18} />}
      </button>
    </div>
  );
}

// ---------- Join ----------
function JoinClub({ p, me, onBack, onJoined }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleJoin() {
    if (!code.trim()) { setErr("Enter the club code."); return; }
    setBusy(true); setErr("");
    const upperCode = code.trim().toUpperCase();
    const clubData = await db.getClubByCode(upperCode);
    if (!clubData) { setErr("No club found with that code."); setBusy(false); return; }
    const members = await db.getMemberships(clubData.id);
    if (!members.find((m) => m.user_id === me.id) && members.length >= MAX_MEMBERS) {
      setErr(`That club is full (${MAX_MEMBERS} max).`); setBusy(false); return;
    }
    await db.joinClub(clubData.id, me.id);
    setBusy(false);
    onJoined(clubData);
  }

  return (
    <div className="max-w-md mx-auto px-6 pt-6 pb-16">
      <button onClick={onBack} className="sans text-sm flex items-center gap-1 mb-5" style={{ color: p.muted }}><ArrowLeft size={16} /> Back</button>
      <h2 className="text-2xl mb-1" style={{ fontWeight: 600 }}>Join a club</h2>
      <p className="sans text-sm mb-6" style={{ color: p.muted }}>Ask whoever started it for the code.</p>
      <Field p={p} label="Club code">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="OAK42" className="sans w-full rounded-lg px-3 py-2.5 outline-none border tracking-widest" style={{ borderColor: p.border, background: p.surface }} />
      </Field>
      {err && <p className="sans text-sm mb-3" style={{ color: "#8A4C4C" }}>{err}</p>}
      <button onClick={handleJoin} disabled={busy} className="sans w-full font-medium rounded-xl py-3.5 mt-2 flex items-center justify-center gap-2" style={{ background: p.accent, color: p.accentInk, opacity: busy ? 0.7 : 1 }}>
        {busy ? "Joining…" : "Join club"} {!busy && <ChevronRight size={18} />}
      </button>
    </div>
  );
}

// ---------- Profile ----------
function Profile({ p, me, onBack }) {
  const [badges, setBadges] = useState(null);
  useEffect(() => { db.getBadges(me.id).then(setBadges); }, [me.id]);

  return (
    <div className="max-w-md mx-auto px-6 pt-6 pb-16">
      <button onClick={onBack} className="sans text-sm flex items-center gap-1 mb-5" style={{ color: p.muted }}><ArrowLeft size={16} /> Back</button>
      <h2 className="text-2xl mb-1" style={{ fontWeight: 600 }}>{me.username}</h2>
      <p className="sans text-sm mb-6" style={{ color: p.muted }}>{badges?.length || 0} books finished</p>
      <div className="flex flex-col gap-3">
        {(badges || []).map((b, i) => (
          <div key={i} className="rounded-xl p-3.5 flex gap-3 items-center border" style={{ borderColor: p.border, background: p.surface }}>
            <Cover url={b.clubs?.cover_url} />
            <div className="flex-1">
              <div className="text-sm font-medium">{b.clubs?.title}</div>
              <div className="sans text-xs flex items-center gap-1" style={{ color: p.muted }}><Star size={12} fill={p.gold} color={p.gold} /> You rated it {b.rating}/10</div>
            </div>
            <Award size={18} color={p.gold} />
          </div>
        ))}
        {badges && badges.length === 0 && <p className="sans text-sm" style={{ color: p.muted }}>No badges yet — finish a book with a club to earn one.</p>}
      </div>
    </div>
  );
}

// ---------- Club view ----------
function ClubView({ p, code, initialClub, me, onLeave }) {
  const [club] = useState(initialClub);
  const [members, setMembers] = useState([]);
  const [ratings, setRatings] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef(null);

  const refresh = useCallback(async () => {
    const [m, r] = await Promise.all([db.getMemberships(club.id), db.getRatings(club.id)]);
    setMembers(m); setRatings(r);
  }, [club.id]);

  useEffect(() => { refresh(); pollRef.current = setInterval(refresh, 6000); return () => clearInterval(pollRef.current); }, [refresh]);

  const checkpoints = buildCheckpoints(club);
  if (members.length === 0) return <div className="max-w-md mx-auto px-6 pt-20 sans text-center" style={{ color: p.muted }}>Loading club…</div>;

  const myMembership = members.find((m) => m.user_id === me.id);
  const myProgress = myMembership?.progress ?? 0;
  const current = currentCheckpointIndex(checkpoints);
  const finished = myProgress >= checkpoints.length;
  const ratingVals = ratings.map((r) => r.rating);
  const avgRating = ratingVals.length ? (ratingVals.reduce((a, b) => a + b, 0) / ratingVals.length).toFixed(1) : null;

  if (selectedIdx !== null) {
    return <Thread p={p} club={club} checkpoint={checkpoints[selectedIdx]} me={me} myProgress={myProgress}
      unlocked={selectedIdx <= myProgress} onBack={() => setSelectedIdx(null)} onPosted={refresh} />;
  }

  return (
    <div className="max-w-md mx-auto pb-16">
      <div className="px-6 pt-6 pb-5" style={{ borderBottom: `1px solid ${p.border}` }}>
        <div className="flex items-center justify-between mb-4">
          <button onClick={onLeave} className="sans text-sm flex items-center gap-1" style={{ color: p.muted }}><ArrowLeft size={16} /> Leave</button>
          <button onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="sans text-xs flex items-center gap-1.5 px-2.5 py-1 rounded-full border" style={{ borderColor: p.border, color: p.muted }}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {code}
          </button>
        </div>
        <div className="flex gap-3 mb-4">
          <Cover url={club.cover_url} size={56} />
          <div>
            <h1 className="text-2xl mb-1" style={{ fontWeight: 600 }}>{club.title}</h1>
            <p className="sans text-xs" style={{ color: p.muted }}>
              {club.total_units} {club.unit_type} · {club.units_per_cadence}/{club.cadence_days === 1 ? "day" : "week"}
              {club.known_pages ? ` · ~${club.known_pages}pp` : ""}
            </p>
            {avgRating && <p className="sans text-xs flex items-center gap-1 mt-1" style={{ color: p.gold }}><Star size={12} fill={p.gold} color={p.gold} /> {avgRating}/10 club rating ({ratingVals.length})</p>}
          </div>
        </div>

        <div className="flex items-center gap-1.5 mb-3">
          {members.map((m) => <Avatar key={m.user_id} name={m.profiles?.username} />)}
          <span className="sans text-xs ml-auto" style={{ color: p.muted }}>{members.length}/{MAX_MEMBERS}</span>
        </div>

        <ProgressBar p={p} checkpoints={checkpoints} myProgress={myProgress} />
      </div>

      {finished && (
        <div className="px-6 pt-5">
          <RatingCard p={p} club={club} me={me} existing={ratings.find((r) => r.user_id === me.id)?.rating} onPosted={refresh} />
        </div>
      )}

      <div className="px-6 pt-5">
        <h3 className="sans text-xs font-semibold tracking-wide mb-3" style={{ color: p.muted }}>CHECKPOINTS</h3>
        <div className="flex flex-col gap-2">
          {checkpoints.map((cp, i) => {
            const isMyNext = i === myProgress;
            return (
              <button key={cp.idx} onClick={() => setSelectedIdx(i)} className="text-left rounded-xl px-4 py-3.5 flex items-center gap-3"
                style={{ background: isMyNext ? p.accent : p.surface, border: `1px solid ${isMyNext ? p.accent : p.border}` }}>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="sans text-sm font-medium" style={{ color: isMyNext ? p.accentInk : p.ink }}>{cp.label}</span>
                    {isMyNext && <Flame size={13} color={p.gold} />}
                  </div>
                  <span className="sans text-xs" style={{ color: isMyNext ? p.accentInk : p.muted, opacity: isMyNext ? 0.85 : 1 }}>{fmtDate(cp.date)}{i > current ? " · upcoming" : ""}</span>
                </div>
                <ChevronRight size={16} color={isMyNext ? p.accentInk : p.muted} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RatingCard({ p, club, me, existing, onPosted }) {
  const [val, setVal] = useState(existing || 8);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    await db.submitRating(club.id, me.id, val);
    setBusy(false);
    onPosted();
  }

  return (
    <div className="rounded-xl p-4 mb-2" style={{ background: p.surface, border: `1px solid ${p.gold}` }}>
      <div className="flex items-center gap-2 mb-2 sans text-xs font-semibold" style={{ color: p.ink }}><Award size={15} color={p.gold} /> You finished the book!</div>
      <p className="sans text-xs mb-3" style={{ color: p.muted }}>Rate it out of 10 — this adds a badge to your profile.</p>
      <div className="flex gap-1 mb-3 flex-wrap">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button key={n} onClick={() => setVal(n)} className="sans text-xs w-7 h-7 rounded-full"
            style={{ background: val === n ? p.gold : "transparent", color: val === n ? p.ink : p.muted, border: `1px solid ${val === n ? p.gold : p.border}` }}>{n}</button>
        ))}
      </div>
      <button onClick={submit} disabled={busy} className="sans text-sm w-full rounded-lg py-2.5" style={{ background: p.accent, color: p.accentInk }}>
        {existing ? "Update rating" : "Submit rating"}
      </button>
    </div>
  );
}

function ProgressBar({ p, checkpoints, myProgress }) {
  const pct = Math.round((Math.min(myProgress + 1, checkpoints.length) / checkpoints.length) * 100);
  return (
    <div>
      <div className="flex justify-between sans text-xs mb-1.5" style={{ color: p.muted }}><span>Your progress</span><span>{Math.min(myProgress + 1, checkpoints.length)}/{checkpoints.length}</span></div>
      <div className="w-full rounded-full h-2" style={{ background: p.border }}><div className="h-2 rounded-full" style={{ width: `${pct}%`, background: p.gold }} /></div>
    </div>
  );
}

// ---------- Thread ----------
function Thread({ p, club, checkpoint, me, myProgress, unlocked, onBack, onPosted }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [call, setCall] = useState(null);
  const [callInput, setCallInput] = useState("");
  const isMyCheckpoint = checkpoint.idx === myProgress;

  const load = useCallback(async () => {
    const [c, cl] = await Promise.all([db.getComments(club.id, checkpoint.idx), db.getCall(club.id, checkpoint.idx)]);
    setComments(c); setCall(cl); setCallInput(cl?.note || "");
    const r = await db.getReactions(c.map((x) => x.id));
    setReactions(r);
  }, [club.id, checkpoint.idx]);

  useEffect(() => { load(); }, [load]);

  async function postComment() {
    if (!text.trim()) return;
    setBusy(true);
    await db.postComment(club.id, checkpoint.idx, me.id, text.trim());
    setText(""); setBusy(false);
    await load(); onPosted();
  }

  async function toggleReaction(commentId, emoji) {
    const exists = reactions.some((r) => r.comment_id === commentId && r.user_id === me.id && r.emoji === emoji);
    await db.toggleReaction(commentId, me.id, emoji, exists);
    await load();
  }

  async function markDone() {
    setBusy(true);
    await db.setProgress(club.id, me.id, checkpoint.idx + 1);
    setBusy(false); onPosted(); onBack();
  }

  async function saveCall() {
    await db.saveCall(club.id, checkpoint.idx, callInput.trim(), me.id);
    await load(); onPosted();
  }

  return (
    <div className="max-w-md mx-auto pb-10">
      <div className="px-6 pt-6 pb-4" style={{ borderBottom: `1px solid ${p.border}` }}>
        <button onClick={onBack} className="sans text-sm flex items-center gap-1 mb-4" style={{ color: p.muted }}><ArrowLeft size={16} /> All checkpoints</button>
        <h2 className="text-2xl mb-1" style={{ fontWeight: 600 }}>{checkpoint.label}</h2>
        <p className="sans text-xs" style={{ color: p.muted }}>{fmtDate(checkpoint.date)}</p>
        {isMyCheckpoint && (
          <button onClick={markDone} disabled={busy} className="sans mt-4 w-full rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2" style={{ background: p.gold, color: p.ink }}><Check size={16} /> Mark as read</button>
        )}
      </div>

      {!unlocked ? (
        <div className="px-6 pt-10 text-center"><p className="sans text-sm" style={{ color: p.muted }}>This thread unlocks once you mark the previous checkpoint as read — no spoilers before then.</p></div>
      ) : (
        <>
          <div className="px-6 pt-5">
            <div className="rounded-xl p-4 mb-5" style={{ background: p.surface, border: `1px solid ${p.border}` }}>
              <div className="flex items-center gap-2 mb-2 sans text-xs font-semibold" style={{ color: p.muted }}><Video size={14} /> SYNC CALL (optional)</div>
              <input value={callInput} onChange={(e) => setCallInput(e.target.value)} onBlur={saveCall} placeholder="e.g. Sunday 7pm — link in group chat"
                className="sans w-full text-sm rounded-lg px-3 py-2 outline-none border" style={{ borderColor: p.border, background: p.bg }} />
            </div>
            <h3 className="sans text-xs font-semibold tracking-wide mb-3" style={{ color: p.muted }}>DISCUSSION {comments.length > 0 && `· ${comments.length}`}</h3>
          </div>

          <div className="px-6 flex flex-col gap-3 mb-4">
            {comments.length === 0 && <p className="sans text-sm" style={{ color: p.muted }}>No comments yet — say something first.</p>}
            {comments.map((c) => (
              <div key={c.id} className="flex gap-2.5">
                <Avatar name={c.profiles?.username} />
                <div className="flex-1 rounded-xl rounded-tl-sm px-3.5 py-2.5" style={{ background: p.surface, border: `1px solid ${p.border}` }}>
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className="sans text-xs font-semibold">{c.profiles?.username}</span>
                    <span className="sans text-[11px]" style={{ color: p.muted }}>{new Date(c.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  </div>
                  <p className="text-sm mb-2" style={{ lineHeight: 1.5 }}>{c.body}</p>
                  <div className="flex gap-1 flex-wrap">
                    {REACTIONS.map((emoji) => {
                      const users = reactions.filter((r) => r.comment_id === c.id && r.emoji === emoji);
                      const mine = users.some((r) => r.user_id === me.id);
                      return (
                        <button key={emoji} onClick={() => toggleReaction(c.id, emoji)} className="sans text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1"
                          style={{ background: mine ? p.gold : p.bg, border: `1px solid ${mine ? p.gold : p.border}` }}>
                          {emoji} {users.length > 0 && <span>{users.length}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="px-6 sticky bottom-0 pt-2 pb-2" style={{ background: p.bg }}>
            <div className="flex items-end gap-2">
              <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="What did you think?" rows={2}
                className="sans flex-1 text-sm rounded-lg px-3 py-2.5 outline-none border resize-none" style={{ borderColor: p.border, background: p.surface }} />
              <button onClick={postComment} disabled={busy || !text.trim()} className="rounded-lg p-3 shrink-0" style={{ background: p.accent, opacity: busy || !text.trim() ? 0.5 : 1 }}><Send size={16} color={p.accentInk} /></button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
