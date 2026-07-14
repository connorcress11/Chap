import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  BookOpen, Users, MessageCircle, ChevronRight, Plus, Copy, Check, Video, ArrowLeft, Send, Flame,
  Search, LogOut, Award, Star, Home, BarChart2, Compass, Crown, UserMinus, DoorOpen, Vote,
} from "lucide-react";
import { supabase } from "./supabaseClient";

const MAX_MEMBERS = 10;
const MAX_GROUPS_PER_USER = 10;
const REACTIONS = ["👍", "❤️", "😂", "😮", "🎉"];

const PALETTES = {
  moss,
  ink,
  rosewood,
  slate,
};
const P = PALETTES.moss;

// ---------- db helpers: reading clubs ----------
const db = {
  async getClubByCode(code) { const { data, error } = await supabase.from("clubs").select("*").eq("code", code).maybeSingle(); if (error) throw error; return data; },
  async listClubs() { const { data, error } = await supabase.from("clubs").select("*").order("created_at", { ascending: false }); if (error) throw error; return data || []; },
  async createClub(club) { const { data, error } = await supabase.from("clubs").insert(club).select().single(); if (error) throw error; return data; },
  async getMemberships(clubId) { const { data, error } = await supabase.from("memberships").select("*, profiles(username)").eq("club_id", clubId); if (error) throw error; return data || []; },
  async joinClub(clubId, userId) { const { error } = await supabase.from("memberships").upsert({ club_id: clubId, user_id: userId, progress: 0 }, { onConflict: "club_id,user_id", ignoreDuplicates: true }); if (error) throw error; },
  async setProgress(clubId, userId, progress) { const { error } = await supabase.from("memberships").update({ progress }).eq("club_id", clubId).eq("user_id", userId); if (error) throw error; },
  async getComments(clubId, idx) { const { data, error } = await supabase.from("comments").select("*, profiles(username)").eq("club_id", clubId).eq("checkpoint_idx", idx).order("created_at"); if (error) throw error; return data || []; },
  async postComment(clubId, idx, userId, body) { const { error } = await supabase.from("comments").insert({ club_id: clubId, checkpoint_idx: idx, user_id: userId, body }); if (error) throw error; },
  async getReactions(commentIds) { if (!commentIds.length) return []; const { data, error } = await supabase.from("reactions").select("*").in("comment_id", commentIds); if (error) throw error; return data || []; },
  async toggleReaction(commentId, userId, emoji, exists) {
    if (exists) { const { error } = await supabase.from("reactions").delete().eq("comment_id", commentId).eq("user_id", userId).eq("emoji", emoji); if (error) throw error; }
    else { const { error } = await supabase.from("reactions").insert({ comment_id: commentId, user_id: userId, emoji }); if (error) throw error; }
  },
  async getCall(clubId, idx) { const { data, error } = await supabase.from("calls").select("*").eq("club_id", clubId).eq("checkpoint_idx", idx).maybeSingle(); if (error) throw error; return data; },
  async saveCall(clubId, idx, note, userId) {
    if (note) { const { error } = await supabase.from("calls").upsert({ club_id: clubId, checkpoint_idx: idx, note, set_by: userId }, { onConflict: "club_id,checkpoint_idx" }); if (error) throw error; }
    else { const { error } = await supabase.from("calls").delete().eq("club_id", clubId).eq("checkpoint_idx", idx); if (error) throw error; }
  },
  async getRatings(clubId) { const { data, error } = await supabase.from("ratings").select("*").eq("club_id", clubId); if (error) throw error; return data || []; },
  async submitRating(clubId, userId, rating) { const { error } = await supabase.from("ratings").upsert({ club_id: clubId, user_id: userId, rating }, { onConflict: "club_id,user_id" }); if (error) throw error; },
  async getBadges(userId) { const { data, error } = await supabase.from("ratings").select("rating, clubs(title, cover_url, code)").eq("user_id", userId); if (error) throw error; return data || []; },
};

// ---------- db helpers: groups ----------
const gdb = {
  async myGroups(userId) {
    const { data, error } = await supabase.from("group_members").select("is_admin, groups(id,name,avatar_url)").eq("user_id", userId);
    if (error) throw error;
    return (data || []).map((r) => ({ ...r.groups, is_admin: r.is_admin }));
  },
  async createGroup(name, avatarUrl, userId) {
    const { data, error } = await supabase.from("groups").insert({ name, avatar_url: avatarUrl || null, created_by: userId }).select().single();
    if (error) throw error;
    await supabase.from("group_members").insert({ group_id: data.id, user_id: userId, is_admin: true });
    return data;
  },
  async getMembers(groupId) {
    const { data, error } = await supabase.from("group_members").select("*, profiles(username, avatar_url)").eq("group_id", groupId);
    if (error) throw error;
    return data || [];
  },
  async createInvite(groupId, userId) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { error } = await supabase.from("group_invites").insert({ code, group_id: groupId, created_by: userId });
    if (error) throw error;
    return code;
  },
  async redeemInvite(code, userId) {
    const { data: invite, error } = await supabase.from("group_invites").select("*, groups(*)").eq("code", code.trim().toUpperCase()).maybeSingle();
    if (error) throw error;
    if (!invite) throw new Error("That invite code doesn't match any group.");
    const members = await gdb.getMembers(invite.group_id);
    if (members.find((m) => m.user_id === userId)) return invite.groups;
    if (members.length >= MAX_MEMBERS) throw new Error("That group is already full.");
    const mine = await gdb.myGroups(userId);
    if (mine.length >= MAX_GROUPS_PER_USER) throw new Error(`You're already in ${MAX_GROUPS_PER_USER} groups, the max.`);
    const { error: joinErr } = await supabase.from("group_members").insert({ group_id: invite.group_id, user_id: userId, is_admin: false });
    if (joinErr) throw joinErr;
    return invite.groups;
  },
  async kick(groupId, userId) { const { error } = await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId); if (error) throw error; },
  async leave(groupId, userId) { const { error } = await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId); if (error) throw error; },
  async getMessages(groupId) {
    const { data, error } = await supabase.from("group_messages").select("*, profiles(username)").eq("group_id", groupId).order("created_at");
    if (error) throw error;
    return data || [];
  },
  async postMessage(groupId, userId, body) { const { error } = await supabase.from("group_messages").insert({ group_id: groupId, user_id: userId, body }); if (error) throw error; },
  async lastRead(groupId, userId) { const { data } = await supabase.from("group_message_reads").select("*").eq("group_id", groupId).eq("user_id", userId).maybeSingle(); return data; },
  async markRead(groupId, userId) { const { error } = await supabase.from("group_message_reads").upsert({ group_id: groupId, user_id: userId, last_read_at: new Date().toISOString() }, { onConflict: "group_id,user_id" }); if (error) throw error; },
  async activePoll(groupId) {
    const { data: poll } = await supabase.from("book_polls").select("*").eq("group_id", groupId).eq("is_open", true).order("created_at", { ascending: false }).maybeSingle();
    if (!poll) return null;
    const { data: options } = await supabase.from("book_poll_options").select("*").eq("poll_id", poll.id);
    const { data: votes } = await supabase.from("book_poll_votes").select("*").in("option_id", (options || []).map((o) => o.id));
    return { ...poll, options: options || [], votes: votes || [] };
  },
  async createPoll(groupId, userId, titles) {
    const { data: poll, error } = await supabase.from("book_polls").insert({ group_id: groupId, created_by: userId }).select().single();
    if (error) throw error;
    const infos = await Promise.all(titles.map((t) => lookupBook(t)));
    const rows = titles.map((t, i) => ({ poll_id: poll.id, title: t, cover_url: infos[i]?.coverUrl || null }));
    const { error: optErr } = await supabase.from("book_poll_options").insert(rows);
    if (optErr) throw optErr;
    return poll;
  },
  async vote(pollOptionIds, chosenOptionId, userId) {
    if (pollOptionIds.length) await supabase.from("book_poll_votes").delete().in("option_id", pollOptionIds).eq("user_id", userId);
    const { error } = await supabase.from("book_poll_votes").insert({ option_id: chosenOptionId, user_id: userId });
    if (error) throw error;
  },
  async closePoll(pollId) { const { error } = await supabase.from("book_polls").update({ is_open: false }).eq("id", pollId); if (error) throw error; },
};

// ---------- helpers ----------
function makeCode() { const words = ["OAK", "FERN", "MOSS", "TIDE", "SAGE", "PLUM", "REED", "DUSK", "IVY", "COAL"]; return `${words[Math.floor(Math.random() * words.length)]}${Math.floor(10 + Math.random() * 90)}`; }
function fmtDate(d) { return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function addDays(dateStr, days) { const d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() + days); return d; }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function buildCheckpoints(club) {
  const { total_units, unit_type, start_date, cadence_days, units_per_cadence } = club;
  const checkpoints = []; let unit = 0, idx = 0;
  while (unit < total_units) {
    const from = unit + 1; const to = Math.min(unit + units_per_cadence, total_units);
    const date = addDays(start_date, idx * cadence_days);
    checkpoints.push({ idx, from, to, date: date.toISOString().slice(0, 10), label: `${unit_type === "pages" ? "Pages" : "Chapters"} ${from}\u2013${to}` });
    unit = to; idx += 1;
  }
  return checkpoints;
}
function currentCheckpointIndex(checkpoints) { const today = todayISO(); let current = 0; for (let i = 0; i < checkpoints.length; i++) if (checkpoints[i].date <= today) current = i; return current; }
async function lookupBook(title) {
  try {
    const res = await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=1&fields=cover_i,number_of_pages_median`);
    const data = await res.json();
    const doc = data.docs && data.docs[0];
    if (!doc) return null;
    return { coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null, pages: doc.number_of_pages_median || null };
  } catch (e) { return null; }
}

// ---------- UI atoms ----------
function Avatar({ name, url, size = 32 }) {
  const colors = ["#8A6D3B", "#4C6B52", "#6B4C6B", "#3B5C8A", "#8A4C4C", "#5C6B3B"];
  const idx = name ? name.charCodeAt(0) % colors.length : 0;
  if (url) return <img src={url} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover" }} />;
  return (
    <div className="flex items-center justify-center rounded-full text-white font-semibold shrink-0" style={{ background: colors[idx], width: size, height: size, fontSize: size * 0.4 }}>
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
function Field({ p, label, children }) { return <div className="mb-4"><label className="sans text-xs font-medium block mb-1.5" style={{ color: p.muted }}>{label}</label>{children}</div>; }

// ---------- App root ----------
export default function App() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle().then(({ data }) => { if (data) setProfile({ id: data.id, username: data.username, avatar_url: data.avatar_url }); });
  }, [session]);

  if (session === undefined) return <div className="min-h-screen flex items-center justify-center sans text-sm" style={{ color: "#8A8069" }}>Loading…</div>;
  if (!session || !profile) return <Auth onAuthed={setProfile} />;
  return <MainShell me={profile} />;
}

// ---------- Auth ----------
function Auth({ onAuthed }) {
  const p = P;
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState(""); const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
  const [err, setErr] = useState(""); const [info, setInfo] = useState(""); const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(""); setInfo("");
    if (!email.trim() || !password.trim() || (mode === "signup" && !username.trim())) { setErr("Fill in every field."); return; }
    setBusy(true);
    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) { setErr(error.message); setBusy(false); return; }
      if (!data.session) { setInfo("Check your email to confirm your account, then sign in."); setBusy(false); return; }
      const { error: profileErr } = await supabase.from("profiles").insert({ id: data.user.id, username: username.trim() });
      if (profileErr) { setErr(profileErr.message.includes("duplicate") ? "That username is taken." : profileErr.message); setBusy(false); return; }
      setBusy(false); onAuthed({ id: data.user.id, username: username.trim() });
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) { setErr(error.message); setBusy(false); return; }
      const { data: prof } = await supabase.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
      setBusy(false);
      if (prof) onAuthed({ id: prof.id, username: prof.username, avatar_url: prof.avatar_url });
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center" style={{ background: p.bg, fontFamily: "Georgia, serif" }}>
      <div className="max-w-xs w-full px-6">
        <div className="flex items-center justify-center rounded-2xl mb-5 mx-auto" style={{ width: 56, height: 56, background: p.accent }}><BookOpen size={26} color={p.accentInk} /></div>
        <h1 className="text-2xl text-center mb-1" style={{ fontWeight: 600 }}>Chapter &amp; Verse</h1>
        <p className="sans text-xs text-center mb-6" style={{ color: p.muted }}>{mode === "signup" ? "Create an account to get started." : "Welcome back."}</p>
        {mode === "signup" && <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className="sans w-full rounded-lg px-3 py-2.5 outline-none border mb-3" style={{ borderColor: p.border, background: p.surface }} />}
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className="sans w-full rounded-lg px-3 py-2.5 outline-none border mb-3" style={{ borderColor: p.border, background: p.surface }} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" className="sans w-full rounded-lg px-3 py-2.5 outline-none border mb-4" style={{ borderColor: p.border, background: p.surface }} />
        {err && <p className="sans text-xs mb-3" style={{ color: "#8A4C4C" }}>{err}</p>}
        {info && <p className="sans text-xs mb-3" style={{ color: p.accent }}>{info}</p>}
        <button onClick={submit} disabled={busy} className="sans w-full font-medium rounded-xl py-3 mb-3" style={{ background: p.accent, color: p.accentInk, opacity: busy ? 0.7 : 1 }}>{busy ? "…"  === "signup" ? "Create account" : "Sign in"}</button>
        <button onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setErr(""); setInfo(""); }} className="sans w-full text-xs text-center" style={{ color: p.muted }}>{mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}</button>
      </div>
    </div>
  );
}

// ---------- Main shell: tab bar + tabs ----------
function MainShell({ me }) {
  const p = P;
  const [tab, setTab] = useState("home");
  const [unreadGroups, setUnreadGroups] = useState(0);
  const [openClub, setOpenClub] = useState(null); // reading-club deep view, overlays Home
  const [openGroup, setOpenGroup] = useState(null); // group detail deep view, overlays Groups/Chats
  const [openGroupChat, setOpenGroupChat] = useState(null); // group chat thread
  const [showProfile, setShowProfile] = useState(false);

  const refreshUnread = useCallback(async () => {
    try {
      const mine = await gdb.myGroups(me.id);
      let count = 0;
      await Promise.all(mine.map(async (g) => {
        const msgs = await gdb.getMessages(g.id);
        if (msgs.length === 0) return;
        const last = await gdb.lastRead(g.id, me.id);
        const lastMsgTime = new Date(msgs[msgs.length - 1].created_at).getTime();
        const lastReadTime = last ? new Date(last.last_read_at).getTime() : 0;
        if (lastMsgTime > lastReadTime) count += 1;
      }));
      setUnreadGroups(count);
    } catch (e) { /* ignore */ }
  }, [me.id]);

  useEffect(() => { refreshUnread(); const t = setInterval(refreshUnread, 8000); return () => clearInterval(t); }, [refreshUnread]);

  return (
    <div className="min-h-screen w-full flex flex-col" style={{ background: p.bg, fontFamily: "'Iowan Old Style','Palatino Linotype',Georgia,serif", color: p.ink }}>
      <style>{`.sans { font-family: 'Avenir Next','Segoe UI',Helvetica,Arial,sans-serif; } input, textarea, select { font-family: inherit; } button { cursor: pointer; transition: transform 0.08s ease; } button:active { transform: scale(0.97); }`}</style>

      <div className="flex-1 overflow-y-auto pb-20">
        {!openClub && !openGroup && !openGroupChat && !showProfile && (
          <div className="max-w-md mx-auto px-6 pt-5 flex items-center justify-between sans text-xs" style={{ color: p.muted }}>
            <button onClick={() => setShowProfile(true)} className="flex items-center gap-1"><Award size={14} /> {me.username}</button>
            <button onClick={() => supabase.auth.signOut()} className="flex items-center gap-1"><LogOut size={14} /> Sign out</button>
          </div>
        )}

        {showProfile ? (
          <Profile p={p} me={me} onBack={() => setShowProfile(false)} />
        ) : openGroupChat ? (
          <GroupChat p={p} group={openGroupChat} me={me} onBack={() => { setOpenGroupChat(null); refreshUnread(); }} />
        ) : openGroup ? (
          <GroupDetail p={p} group={openGroup} me={me} onBack={() => setOpenGroup(null)} onOpenChat={() => setOpenGroupChat(openGroup)} onLeftOrKicked={() => { setOpenGroup(null); refreshUnread(); }} />
        ) : openClub ? (
          <ClubView p={p} code={openClub.code} initialClub={openClub} me={me} onLeave={() => setOpenClub(null)} />
        )  === "home" ? (
          <HomeTab p={p} onOpenClub={setOpenClub} />
        )  === "groups" ? (
          <GroupsTab p={p} me={me} onOpenGroup={setOpenGroup} />
        )  === "chats" ? (
          <ChatsTab p={p} me={me} onOpenChat={setOpenGroupChat} />
        )  === "stats" ? (
          <PlaceholderTab p={p} icon={<BarChart2 size={28} />} title="Stats" note="Personal and group reading stats are coming in the next stage." />
        ) : (
          <PlaceholderTab p={p} icon={<Compass size={28} />} title="Discover" note="Popular books, authors, and open rooms are coming in the next stage." />
        )}
      </div>

      {!openClub && !openGroup && !openGroupChat && !showProfile && (
        <BottomNav p={p} tab={tab} setTab={setTab} unreadGroups={unreadGroups} />
      )}
    </div>
  );
}

function BottomNav({ p, tab, setTab, unreadGroups }) {
  const items = [
    { id: "home", label: "Home", icon: HomeIcon },
    { id: "groups", label: "Groups", icon: Users },
    { id: "stats", label: "Stats", icon: BarChart2 },
    { id: "discover", label: "Discover", icon: Compass },
    { id: "chats", label: "Chats", icon: MessageCircle },
  ];
  return (
    <div className="fixed bottom-0 left-0 right-0 border-t sans" style={{ background: p.surface, borderColor: p.border }}>
      <div className="max-w-md mx-auto flex">
        {items.map((it) => {
          const Icon = it.icon; const active = tab === it.id;
          return (
            <button key={it.id} onClick={() => setTab(it.id)} className="flex-1 flex flex-col items-center gap-1 py-2.5 relative">
              <Icon size={20} color={active ? p.accent : p.muted} />
              {it.id === "chats" && unreadGroups > 0 && (
                <span className="absolute top-1 right-6 rounded-full text-white flex items-center justify-center" style={{ background: "#C0392B", minWidth: 16, height: 16, fontSize: 10, padding: "0 3px" }}>{unreadGroups}</span>
              )}
              <span className="text-[10px]" style={{ color: active ? p.accent : p.muted, fontWeight: active ? 600 : 400 }}>{it.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlaceholderTab({ p, icon, title, note }) {
  return (
    <div className="max-w-md mx-auto px-6 pt-24 flex flex-col items-center text-center">
      <div className="mb-4" style={{ color: p.muted }}>{icon}</div>
      <h2 className="text-xl mb-2" style={{ fontWeight: 600 }}>{title}</h2>
      <p className="sans text-sm" style={{ color: p.muted }}>{note}</p>
    </div>
  );
}

// ---------- Home tab (reading clubs, same) ----------
function HomeTab({ p, onOpenClub }) {
  const [screen, setScreen] = useState("landing");
  if (screen === "create") return <CreateClub p={p} onBack={() => setScreen("landing")} onCreated={onOpenClub} />;
  if (screen === "join") return <JoinClub p={p} onBack={() => setScreen("landing")} onJoined={onOpenClub} />;
  if (screen === "browse") return <BrowseClubs p={p} onBack={() => setScreen("landing")} onJoined={onOpenClub} />;
  return (
    <div className="max-w-md mx-auto px-6 pt-6 pb-10 flex flex-col items-center text-center">
      <h2 className="text-3xl mb-2" style={{ fontWeight: 600, letterSpacing: "-0.01em" }}>Read together, on a pace</h2>
      <p className="sans text-sm mb-8 max-w-xs" style={{ color: p.muted }}>Set a page or chapter target, and talk about each part once everyone's caught up.</p>
      <button onClick={() => setScreen("create")} className="sans w-full font-medium rounded-xl py-3.5 mb-3 flex items-center justify-center gap-2" style={{ background: p.accent, color: p.accentInk }}><Plus size={18} /> Start a new club</button>
      <button onClick={() => setScreen("join")} className="sans w-full font-medium rounded-xl py-3.5 mb-3 flex items-center justify-center gap-2 border" style={{ borderColor: p.border, background: "transparent" }}><Users size={18} /> Join with a code</button>
      <button onClick={() => setScreen("browse")} className="sans w-full font-medium rounded-xl py-3.5 flex items-center justify-center gap-2 border" style={{ borderColor: p.border, background: "transparent" }}><Search size={18} /> Find a club by book</button>
    </div>
  );
}
function BrowseClubs({ p, onBack, onJoined }) {
  const [q, setQ] = useState(""); const [clubs, setClubs] = useState([]); const [counts, setCounts] = useState({}); const [loading, setLoading] = useState(true); const [err, setErr] = useState("");
  const me = useMe();
  useEffect(() => { (async () => { const list = await db.listClubs(); setClubs(list); const c = {}; await Promise.all(list.map(async (club) => { c[club.id] = (await db.getMemberships(club.id)).length; })); setCounts(c); setLoading(false); })(); }, []);
  const filtered = clubs.filter((c) => !q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase()));
  async function join(clubData) { if ((counts[clubData.id] ?? 0) >= MAX_MEMBERS) { setErr(`${clubData.title}'s club is full.`); return; } await db.joinClub(clubData.id, me.id); onJoined(clubData); }
  return (
    <div className="max-w-md mx-auto px-6 pt-6 pb-16">
      <button onClick={onBack} className="sans text-sm flex items-center gap-1 mb-5" style={{ color: p.muted }}><ArrowLeft size={16} /> Back</button>
      <h2 className="text-2xl mb-4" style={{ fontWeight: 600 }}>Find a club</h2>
      <div className="relative mb-5"><Search size={16} style={{ position: "absolute", left: 12, top: 13, color: p.muted }} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by book title" className="sans w-full rounded-lg pl-9 pr-3 py-2.5 outline-none border" style={{ borderColor: p.border, background: p.surface }} /></div>
      {err && <p className="sans text-xs mb-3" style={{ color: "#8A4C4C" }}>{err}</p>}
      {loading && <p className="sans text-sm" style={{ color: p.muted }}>Loading clubs…</p>}
      {!loading && filtered.length === 0 && <p className="sans text-sm" style={{ color: p.muted }}>No clubs match yet — start one!</p>}
      <div className="flex flex-col gap-3">
        {filtered.map((c) => (
          <button key={c.id} onClick={() => join(c)} className="text-left rounded-xl p-3.5 flex gap-3 items-center border" style={{ borderColor: p.border, background: p.surface }}>
            <Cover url={c.cover_url} /><div className="flex-1"><div className="text-sm font-medium">{c.title}</div><div className="sans text-xs" style={{ color: p.muted }}>{counts[c.id] ?? 0}/{MAX_MEMBERS} members · {c.total_units} {c.unit_type}</div></div><ChevronRight size={16} color={p.muted} />
          </button>
        ))}
      </div>
    </div>
  );
}
function CreateClub({ p, onBack, onCreated }) {
  const me = useMe();
  const [title, setTitle] = useState(""); const [unitType, setUnitType] = useState("pages"); const [totalUnits, setTotalUnits] = useState("300"); const [cadence, setCadence] = useState("1"); const [unitsPerCadence, setUnitsPerCadence] = useState("30"); const [startDate, setStartDate] = useState(todayISO()); const [paletteId, setPaletteId] = useState("moss"); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function handleCreate() {
    if (!title.trim() || !totalUnits || !unitsPerCadence) { setErr("Fill in the book title and reading targets."); return; }
    setBusy(true); setErr("");
    let code = makeCode(); let existing = await db.getClubByCode(code); let tries = 0;
    while (existing && tries < 5) { code = makeCode(); existing = await db.getClubByCode(code); tries++; }
    const bookInfo = await lookupBook(title.trim());
    try {
      const clubData = await db.createClub({ code, title: title.trim(), unit_type: unitType, total_units: parseInt(totalUnits, 10), cadence_days: parseInt(cadence, 10), units_per_cadence: parseInt(unitsPerCadence, 10), start_date: startDate, palette_id: paletteId, cover_url: bookInfo?.coverUrl || null, known_pages: bookInfo?.pages || null, created_by: me.id });
      await db.joinClub(clubData.id, me.id); setBusy(false); onCreated(clubData);
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="max-w-md mx-auto px-6 pt-6 pb-16">
      <button onClick={onBack} className="sans text-sm flex items-center gap-1 mb-5" style={{ color: p.muted }}><ArrowLeft size={16} /> Back</button>
      <h2 className="text-2xl mb-1" style={{ fontWeight: 600 }}>Start a club</h2>
      <p className="sans text-sm mb-6" style={{ color: p.muted }}>Up to {MAX_MEMBERS} people. Anyone can find it by book title.</p>
      <Field p={p} label="Book title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Bell Jar" className="sans w-full rounded-lg px-3 py-2.5 outline-none border" style={{ borderColor: p.border, background: p.surface }} /></Field>
      <Field p={p} label="Track by"><div className="flex gap-2">{["pages", "chapters"].map((u) => (<button key={u} onClick={() => setUnitType(u)} className="sans flex-1 rounded-lg py-2.5 text-sm capitalize border" style={{ background === u ? p.accent : "transparent", color === u ? p.accentInk : p.ink, borderColor === u ? p.accent : p.border }}>{u}</button>))}</div></Field>
      <Field p={p} label={`Total ${unitType}`}><input type="number" value={totalUnits} onChange={(e) => setTotalUnits(e.target.value)} className="sans w-full rounded-lg px-3 py-2.5 outline-none border" style={{ borderColor: p.border, background: p.surface }} /></Field>
      <Field p={p} label="Checkpoint cadence"><div className="flex gap-2">{[{ v: "1", l: "Daily" }, { v: "7", l: "Weekly" }].map((c) => (<button key={c.v} onClick={() => setCadence(c.v)} className="sans flex-1 rounded-lg py-2.5 text-sm border" style={{ background === c.v ? p.accent : "transparent", color === c.v ? p.accentInk : p.ink, borderColor === c.v ? p.accent : p.border }}>{c.l}</button>))}</div></Field>
      <Field p={p} label={`${unitType === "pages" ? "Pages" : "Chapters"} per checkpoint`}><input type="number" value={unitsPerCadence} onChange={(e) => setUnitsPerCadence(e.target.value)} className="sans w-full rounded-lg px-3 py-2.5 outline-none border" style={{ borderColor: p.border, background: p.surface }} /></Field>
      <Field p={p} label="Start date"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="sans w-full rounded-lg px-3 py-2.5 outline-none border" style={{ borderColor: p.border, background: p.surface }} /></Field>
      <Field p={p} label="Color theme"><div className="flex gap-2">{Object.keys(PALETTES).map((key) => (<button key={key} onClick={() => setPaletteId(key)} className="w-9 h-9 rounded-full border-2" style={{ background: PALETTES[key].accent, borderColor === key ? PALETTES[key].gold : "transparent" }} />))}</div></Field>
      {err && <p className="sans text-sm mb-3" style={{ color: "#8A4C4C" }}>{err}</p>}
      <button onClick={handleCreate} disabled={busy} className="sans w-full font-medium rounded-xl py-3.5 mt-2 flex items-center justify-center gap-2" style={{ background: p.accent, color: p.accentInk, opacity: busy ? 0.7 : 1 }}>{busy ? "Creating…" : "Create club"} {!busy && <ChevronRight size={18} />}</button>
    </div>
  );
}
function JoinClub({ p, onBack, onJoined }) {
  const me = useMe();
  const [code, setCode] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function handleJoin() {
    if (!code.trim()) { setErr("Enter the club code."); return; }
    setBusy(true); setErr("");
    const upperCode = code.trim().toUpperCase();
    const clubData = await db.getClubByCode(upperCode);
    if (!clubData) { setErr("No club found with that code."); setBusy(false); return; }
    const members = await db.getMemberships(clubData.id);
    if (!members.find((m) => m.user_id === me.id) && members.length >= MAX_MEMBERS) { setErr(`That club is full (${MAX_MEMBERS} max).`); setBusy(false); return; }
    await db.joinClub(clubData.id, me.id); setBusy(false); onJoined(clubData);
  }
  return (
    <div className="max-w-md mx-auto px-6 pt-6 pb-16">
      <button onClick={onBack} className="sans text-sm flex items-center gap-1 mb-5" style={{ color: p.muted }}><ArrowLeft size={16} /> Back</button>
      <h2 className="text-2xl mb-1" style={{ fontWeight: 600 }}>Join a club</h2>
      <p className="sans text-sm mb-6" style={{ color: p.muted }}>Ask whoever started it for the code.</p>
      <Field p={p} label="Club code"><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="OAK42" className="sans w-full rounded-lg px-3 py-2.5 outline-none border tracking-widest" style={{ borderColor: p.border, background: p.surface }} /></Field>
      {err && <p className="sans text-sm mb-3" style={{ color: "#8A4C4C" }}>{err}</p>}
      <button onClick={handleJoin} disabled={busy} className="sans w-full font-medium rounded-xl py-3.5 mt-2 flex items-center justify-center gap-2" style={{ background: p.accent, color: p.accentInk, opacity: busy ? 0.7 : 1 }}>{busy ? "Joining…" : "Join club"} {!busy && <ChevronRight size={18} />}</button>
    </div>
  );
}

// tiny helper hook so the sub-screens above can access `me` without prop-drilling every level
let _meRef = null;
function useMe() { return _meRef; }

function ClubView({ p, code, initialClub, me, onLeave }) {
  _meRef = me;
  const [club] = useState(initialClub); const [members, setMembers] = useState([]); const [ratings, setRatings] = useState([]); const [selectedIdx, setSelectedIdx] = useState(null); const [copied, setCopied] = useState(false); const pollRef = useRef(null);
  const refresh = useCallback(async () => { const [m, r] = await Promise.all([db.getMemberships(club.id), db.getRatings(club.id)]); setMembers(m); setRatings(r); }, [club.id]);
  useEffect(() => { refresh(); pollRef.current = setInterval(refresh, 6000); return () => clearInterval(pollRef.current); }, [refresh]);
  const checkpoints = buildCheckpoints(club);
  if (members.length === 0) return <div className="max-w-md mx-auto px-6 pt-20 sans text-center" style={{ color: p.muted }}>Loading club…</div>;
  const myMembership = members.find((m) => m.user_id === me.id); const myProgress = myMembership?.progress ?? 0; const current = currentCheckpointIndex(checkpoints); const finished = myProgress >= checkpoints.length;
  const ratingVals = ratings.map((r) => r.rating); const avgRating = ratingVals.length ? (ratingVals.reduce((a, b) => a + b, 0) / ratingVals.length).toFixed(1) : null;
  if (selectedIdx !== null) return <Thread p={p} club={club} checkpoint={checkpoints[selectedIdx]} me={me} myProgress={myProgress} unlocked={selectedIdx <= myProgress} onBack={() => setSelectedIdx(null)} onPosted={refresh} />;
  return (
    <div className="max-w-md mx-auto pb-16">
      <div className="px-6 pt-6 pb-5" style={{ borderBottom: `1px solid ${p.border}` }}>
        <div className="flex items-center justify-between mb-4">
          <button onClick={onLeave} className="sans text-sm flex items-center gap-1" style={{ color: p.muted }}><ArrowLeft size={16} /> Leave</button>
          <button onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="sans text-xs flex items-center gap-1.5 px-2.5 py-1 rounded-full border" style={{ borderColor: p.border, color: p.muted }}>{copied ? <Check size={13} /> : <Copy size={13} />} {code}</button>
        </div>
        <div className="flex gap-3 mb-4">
          <Cover url={club.cover_url} size={56} />
          <div><h1 className="text-2xl mb-1" style={{ fontWeight: 600 }}>{club.title}</h1><p className="sans text-xs" style={{ color: p.muted }}>{club.total_units} {club.unit_type} · {club.units_per_cadence}/{club.cadence_days === 1 ? "day" : "week"}{club.known_pages ? ` · ~${club.known_pages}pp` : ""}</p>{avgRating && <p className="sans text-xs flex items-center gap-1 mt-1" style={{ color: p.gold }}><Star size={12} fill={p.gold} color={p.gold} /> {avgRating}/10 club rating ({ratingVals.length})</p>}</div>
        </div>
        <div className="flex items-center gap-1.5 mb-3">{members.map((m) => <Avatar key={m.user_id} name={m.profiles?.username} />)}<span className="sans text-xs ml-auto" style={{ color: p.muted }}>{members.length}/{MAX_MEMBERS}</span></div>
        <ProgressBar p={p} checkpoints={checkpoints} myProgress={myProgress} />
      </div>
      {finished && <div className="px-6 pt-5"><RatingCard p={p} club={club} me={me} existing={ratings.find((r) => r.user_id === me.id)?.rating} onPosted={refresh} /></div>}
      <div className="px-6 pt-5">
        <h3 className="sans text-xs font-semibold tracking-wide mb-3" style={{ color: p.muted }}>CHECKPOINTS</h3>
        <div className="flex flex-col gap-2">
          {checkpoints.map((cp, i) => { const isMyNext = i === myProgress; return (
            <button key={cp.idx} onClick={() => setSelectedIdx(i)} className="text-left rounded-xl px-4 py-3.5 flex items-center gap-3" style={{ background: isMyNext ? p.accent : p.surface, border: `1px solid ${isMyNext ? p.accent : p.border}` }}>
              <div className="flex-1"><div className="flex items-center gap-2 mb-0.5"><span className="sans text-sm font-medium" style={{ color: isMyNext ? p.accentInk : p.ink }}>{cp.label}</span>{isMyNext && <Flame size={13} color={p.gold} />}</div><span className="sans text-xs" style={{ color: isMyNext ? p.accentInk : p.muted, opacity: isMyNext ? 0.85 : 1 }}>{fmtDate(cp.date)}{i > current ? " · upcoming" : ""}</span></div>
              <ChevronRight size={16} color={isMyNext ? p.accentInk : p.muted} />
            </button>
          ); })}
        </div>
      </div>
    </div>
  );
}
function RatingCard({ p, club, me, existing, onPosted }) {
  const [val, setVal] = useState(existing || 8); const [busy, setBusy] = useState(false);
  async function submit() { setBusy(true); await db.submitRating(club.id, me.id, val); setBusy(false); onPosted(); }
  return (
    <div className="rounded-xl p-4 mb-2" style={{ background: p.surface, border: `1px solid ${p.gold}` }}>
      <div className="flex items-center gap-2 mb-2 sans text-xs font-semibold" style={{ color: p.ink }}><Award size={15} color={p.gold} /> You finished the book!</div>
      <p className="sans text-xs mb-3" style={{ color: p.muted }}>Rate it out of 10 — this adds a badge to your profile.</p>
      <div className="flex gap-1 mb-3 flex-wrap">{Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (<button key={n} onClick={() => setVal(n)} className="sans text-xs w-7 h-7 rounded-full" style={{ background === n ? p.gold : "transparent", color === n ? p.ink : p.muted, border: `1px solid ${val === n ? p.gold : p.border}` }}>{n}</button>))}</div>
      <button onClick={submit} disabled={busy} className="sans text-sm w-full rounded-lg py-2.5" style={{ background: p.accent, color: p.accentInk }}>{existing ? "Update rating" : "Submit rating"}</button>
    </div>
  );
}
function ProgressBar({ p, checkpoints, myProgress }) {
  const pct = Math.round((Math.min(myProgress + 1, checkpoints.length) / checkpoints.length) * 100);
  return (<div><div className="flex justify-between sans text-xs mb-1.5" style={{ color: p.muted }}><span>Your progress</span><span>{Math.min(myProgress + 1, checkpoints.length)}/{checkpoints.length}</span></div><div className="w-full rounded-full h-2" style={{ background: p.border }}><div className="h-2 rounded-full" style={{ width: `${pct}%`, background: p.gold }} /></div></div>);
}
function Thread({ p, club, checkpoint, me, myProgress, unlocked, onBack, onPosted }) {
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [comments, setComments] = useState([]); const [reactions, setReactions] = useState([]); const [call, setCall] = useState(null); const [callInput, setCallInput] = useState(""); const isMyCheckpoint = checkpoint.idx === myProgress;
  const load = useCallback(async () => { const [c, cl] = await Promise.all([db.getComments(club.id, checkpoint.idx), db.getCall(club.id, checkpoint.idx)]); setComments(c); setCall(cl); setCallInput(cl?.note || ""); setReactions(await db.getReactions(c.map((x) => x.id))); }, [club.id, checkpoint.idx]);
  useEffect(() => { load(); }, [load]);
  async function postComment() { if (!text.trim()) return; setBusy(true); await db.postComment(club.id, checkpoint.idx, me.id, text.trim()); setText(""); setBusy(false); await load(); onPosted(); }
  async function toggleReaction(commentId, emoji) { const exists = reactions.some((r) => r.comment_id === commentId && r.user_id === me.id && r.emoji === emoji); await db.toggleReaction(commentId, me.id, emoji, exists); await load(); }
  async function markDone() { setBusy(true); await db.setProgress(club.id, me.id, checkpoint.idx + 1); setBusy(false); onPosted(); onBack(); }
  async function saveCall() { await db.saveCall(club.id, checkpoint.idx, callInput.trim(), me.id); await load(); onPosted(); }
  return (
    <div className="max-w-md mx-auto pb-10">
      <div className="px-6 pt-6 pb-4" style={{ borderBottom: `1px solid ${p.border}` }}>
        <button onClick={onBack} className="sans text-sm flex items-center gap-1 mb-4" style={{ color: p.muted }}><ArrowLeft size={16} /> All checkpoints</button>
        <h2 className="text-2xl mb-1" style={{ fontWeight: 600 }}>{checkpoint.label}</h2><p className="sans text-xs" style={{ color: p.muted }}>{fmtDate(checkpoint.date)}</p>
        {isMyCheckpoint && <button onClick={markDone} disabled={busy} className="sans mt-4 w-full rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2" style={{ background: p.gold, color: p.ink }}><Check size={16} /> Mark}
      </div>
      {!unlocked ? (<div className="px-6 pt-10 text-center"><p className="sans text-sm" style={{ color: p.muted }}>This thread unlocks once you mark the previous checkpoint — no spoilers before then.</p></div>) : (
        <>
          <div className="px-6 pt-5">
            <div className="rounded-xl p-4 mb-5" style={{ background: p.surface, border: `1px solid ${p.border}` }}>
              <div className="flex items-center gap-2 mb-2 sans text-xs font-semibold" style={{ color: p.muted }}><Video size={14} /> SYNC CALL (optional)</div>
              <input value={callInput} onChange={(e) => setCallInput(e.target.value)} onBlur={saveCall} placeholder="e.g. Sunday 7pm — link in group chat" className="sans w-full text-sm rounded-lg px-3 py-2 outline-none border" style={{ borderColor: p.border, background: p.bg }} />
            </div>
            <h3 className="sans text-xs font-semibold tracking-wide mb-3" style={{ color: p.muted }}>DISCUSSION {comments.length > 0 && `· ${comments.length}`}</h3>
          </div>
          <div className="px-6 flex flex-col gap-3 mb-4">
            {comments.length === 0 && <p className="sans text-sm" style={{ color: p.muted }}>No comments yet — say something first.</p>}
            {comments.map((c) => (
              <div key={c.id} className="flex gap-2.5">
                <Avatar name={c.profiles?.username} />
                <div className="flex-1 rounded-xl rounded-tl-sm px-3.5 py-2.5" style={{ background: p.surface, border: `1px solid ${p.border}` }}>
                  <div className="flex items-baseline gap-2 mb-0.5"><span className="sans text-xs font-semibold">{c.profiles?.username}</span><span className="sans text-[11px]" style={{ color: p.muted }}>{new Date(c.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div>
                  <p className="text-sm mb-2" style={{ lineHeight: 1.5 }}>{c.body}</p>
                  <div className="flex gap-1 flex-wrap">{REACTIONS.map((emoji) => { const users = reactions.filter((r) => r.comment_id === c.id && r.emoji === emoji); const mine = users.some((r) => r.user_id === me.id); return (<button key={emoji} onClick={() => toggleReaction(c.id, emoji)} className="sans text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ background: mine ? p.gold : p.bg, border: `1px solid ${mine ? p.gold : p.border}` }}>{emoji} {users.length > 0 && <span>{users.length}</span>}</button>); })}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="px-6 pt-2 pb-2">
            <div className="flex items-end gap-2">
              <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="What did you think?" rows={2} className="sans flex-1 text-sm rounded-lg px-3 py-2.5 outline-none border resize-none" style={{ borderColor: p.border, background: p.surface }} />
              <button onClick={postComment} disabled={busy || !text.trim()} className="rounded-lg p-3 shrink-0" style={{ background: p.accent, opacity: busy || !text.trim() ? 0.5 : 1 }}><Send size={16} color={p.accentInk} /></button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Groups tab ----------
function GroupsTab({ p, me, onOpenGroup }) {
  const [screen, setScreen] = useState("list");
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => { setGroups(await gdb.myGroups(me.id)); setLoading(false); }, [me.id]);
  useEffect(() => { refresh(); }, [refresh]);

  if (screen === "create") return <CreateGroup p={p} me={me} onBack={() => setScreen("list")} onCreated={(g) => { refresh(); onOpenGroup(g); }} />;
  if (screen === "join") return <JoinGroup p={p} me={me} onBack={() => setScreen("list")} onJoined={(g) => { refresh(); onOpenGroup(g); }} />;

  return (
    <div className="max-w-md mx-auto px-6 pt-6 pb-10">
      <h2 className="text-2xl mb-1" style={{ fontWeight: 600 }}>Your groups</h2>
      <p className="sans text-sm mb-5" style={{ color: p.muted }}>Up to {MAX_GROUPS_PER_USER} groups, {MAX_MEMBERS} people each.</p>
      <div className="flex gap-2 mb-6">
        <button onClick={() => setScreen("create")} className="sans flex-1 rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2" style={{ background: p.accent, color: p.accentInk }}><Plus size={16} /> Create</button>
        <button onClick={() => setScreen("join")} className="sans flex-1 rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2 border" style={{ borderColor: p.border }}><Users size={16} /> Join by code</button>
      </div>
      {loading && <p className="sans text-sm" style={{ color: p.muted }}>Loading…</p>}
      {!loading && groups.length === 0 && <p className="sans text-sm" style={{ color: p.muted }}>No groups yet — create one or join with an invite code.</p>}
      <div className="flex flex-col gap-3">
        {groups.map((g) => (
          <button key={g.id} onClick={() => onOpenGroup(g)} className="text-left rounded-xl p-3.5 flex gap-3 items-center border" style={{ borderColor: p.border, background: p.surface }}>
            <Avatar name={g.name} url={g.avatar_url} size={40} />
            <div className="flex-1"><div className="text-sm font-medium flex items-center gap-1.5">{g.name} {g.is_admin && <Crown size={13} color={p.gold} />}</div></div>
            <ChevronRight size={16} color={p.muted} />
          </button>
        ))}
      </div>
    </div>
  );
}
function CreateGroup({ p, me, onBack, onCreated }) {
  const [name, setName] = useState(""); const [avatarUrl, setAvatarUrl] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function create() {
    if (!name.trim()) { setErr("Give your group a name."); return; }
    setBusy(true); setErr("");
    try {
      const mine = await gdb.myGroups(me.id);
      if (mine.length >= MAX_GROUPS_PER_USER) { setErr(`You're already in ${MAX_GROUPS_PER_USER} groups, the max.`); setBusy(false); return; }
      const g = await gdb.createGroup(name.trim(), avatarUrl.trim(), me.id);
      setBusy(false); onCreated({ ...g, is_admin: true });
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="max-w-md mx-auto px-6 pt-6 pb-16">
      <button onClick={onBack} className="sans text-sm flex items-center gap-1 mb-5" style={{ color: p.muted }}><ArrowLeft size={16} /> Back</button>
      <h2 className="text-2xl mb-1" style={{ fontWeight: 600 }}>Create a group</h2>
      <p className="sans text-sm mb-6" style={{ color: p.muted }}>You'll be the admin — you can set the pace and manage members.</p>
      <Field p={p} label="Group name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="The Night Owls" className="sans w-full rounded-lg px-3 py-2.5 outline-none border" style={{ borderColor: p.border, background: p.surface }} /></Field>
      <Field p={p} label="Group photo URL (optional for now)"><input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" className="sans w-full rounded-lg px-3 py-2.5 outline-none border" style={{ borderColor: p.border, background: p.surface }} /></Field>
      <p className="sans text-xs mb-4" style={{ color: p.muted }}>Uploading straight from your camera roll is coming in a later stage — for now, paste an image link if you have one.</p>
      {err && <p className="sans text-sm mb-3" style={{ color: "#8A4C4C" }}>{err}</p>}
      <button onClick={create} disabled={busy} className="sans w-full font-medium rounded-xl py-3.5 flex items-center justify-center gap-2" style={{ background: p.accent, color: p.accentInk, opacity: busy ? 0.7 : 1 }}>{busy ? "Creating…" : "Create group"}</button>
    </div>
  );
}
function JoinGroup({ p, me, onBack, onJoined }) {
  const [code, setCode] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function join() {
    if (!code.trim()) { setErr("Enter an invite code."); return; }
    setBusy(true); setErr("");
    try { const g = await gdb.redeemInvite(code, me.id); setBusy(false); onJoined(g); }
    catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="max-w-md mx-auto px-6 pt-6 pb-16">
      <button onClick={onBack} className="sans text-sm flex items-center gap-1 mb-5" style={{ color: p.muted }}><ArrowLeft size={16} /> Back</button>
      <h2 className="text-2xl mb-1" style={{ fontWeight: 600 }}>Join a group</h2>
      <p className="sans text-sm mb-6" style={{ color: p.muted }}>Ask a group admin for their invite code — joining is instant, no approval needed.</p>
      <Field p={p} label="Invite code"><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="AB12CD" className="sans w-full rounded-lg px-3 py-2.5 outline-none border tracking-widest" style={{ borderColor: p.border, background: p.surface }} /></Field>
      {err && <p className="sans text-sm mb-3" style={{ color: "#8A4C4C" }}>{err}</p>}
      <button onClick={join} disabled={busy} className="sans w-full font-medium rounded-xl py-3.5" style={{ background: p.accent, color: p.accentInk, opacity: busy ? 0.7 : 1 }}>{busy ? "Joining…" : "Join group"}</button>
    </div>
  );
}
function GroupDetail({ p, group, me, onBack, onOpenChat, onLeftOrKicked }) {
  const [members, setMembers] = useState([]); const [invite, setInvite] = useState(""); const [poll, setPoll] = useState(null); const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => { setMembers(await gdb.getMembers(group.id)); setPoll(await gdb.activePoll(group.id)); }, [group.id]);
  useEffect(() => { refresh(); }, [refresh]);
  const isAdmin = members.find((m) => m.user_id === me.id)?.is_admin;

  async function makeInvite() { setBusy(true); setInvite(await gdb.createInvite(group.id, me.id)); setBusy(false); }
  async function kick(userId) { await gdb.kick(group.id, userId); refresh(); }
  async function leave() { await gdb.leave(group.id, me.id); onLeftOrKicked(); }

  return (
    <div className="max-w-md mx-auto pb-16">
      <div className="px-6 pt-6 pb-5" style={{ borderBottom: `1px solid ${p.border}` }}>
        <button onClick={onBack} className="sans text-sm flex items-center gap-1 mb-4" style={{ color: p.muted }}><ArrowLeft size={16} /> Back</button>
        <div className="flex gap-3 items-center mb-4">
          <Avatar name={group.name} url={group.avatar_url} size={52} />
          <div><h1 className="text-2xl" style={{ fontWeight: 600 }}>{group.name}</h1><p className="sans text-xs" style={{ color: p.muted }}>{members.length}/{MAX_MEMBERS} members{isAdmin && " · you're admin"}</p></div>
        </div>
        <div className="flex gap-2">
          <button onClick={onOpenChat} className="sans flex-1 rounded-xl py-2.5 text-sm font-medium flex items-center justify-center gap-2" style={{ background: p.accent, color: p.accentInk }}><MessageCircle size={16} /> Open chat</button>
          <button onClick={leave} className="sans rounded-xl py-2.5 px-3 text-sm border flex items-center gap-1" style={{ borderColor: p.border, color: "#8A4C4C" }}><DoorOpen size={16} /> Leave</button>
        </div>
      </div>

      {isAdmin && (
        <div className="px-6 pt-5">
          <div className="rounded-xl p-4 mb-5" style={{ background: p.surface, border: `1px solid ${p.border}` }}>
            <div className="sans text-xs font-semibold mb-2" style={{ color: p.muted }}>INVITE FRIENDS</div>
            {invite ? (
              <div className="flex items-center gap-2"><span className="sans text-lg font-semibold tracking-widest">{invite}</span><button onClick={() => navigator.clipboard?.writeText(invite)} className="sans text-xs flex items-center gap-1 px-2 py-1 rounded-full border" style={{ borderColor: p.border }}><Copy size={12} /> Copy</button></div>
            ) : (
              <button onClick={makeInvite} disabled={busy} className="sans text-sm rounded-lg py-2 px-3" style={{ background: p.accent, color: p.accentInk }}>{busy ? "…" : "Generate invite code"}</button>
            )}
            <p className="sans text-xs mt-2" style={{ color: p.muted }}>Whoever enters this code joins automatically.</p>
          </div>
        </div>
      )}

      <div className="px-6">
        <PollSection p={p} group={group} me={me} isAdmin={isAdmin} poll={poll} onChanged={refresh} />
      </div>

      <div className="px-6 pt-5">
        <h3 className="sans text-xs font-semibold tracking-wide mb-3" style={{ color: p.muted }}>MEMBERS</h3>
        <div className="flex flex-col gap-2">
          {members.map((m) => (
            <div key={m.user_id} className="rounded-xl p-3 flex items-center gap-3" style={{ background: p.surface, border: `1px solid ${p.border}` }}>
              <Avatar name={m.profiles?.username} url={m.profiles?.avatar_url} />
              <span className="sans text-sm flex-1 flex items-center gap-1.5">{m.profiles?.username}{m.is_admin && <Crown size={13} color={p.gold} />}</span>
              {isAdmin && m.user_id !== me.id && <button onClick={() => kick(m.user_id)} className="sans text-xs flex items-center gap-1 px-2 py-1 rounded-full border" style={{ borderColor: p.border, color: "#8A4C4C" }}><UserMinus size={12} /> Kick</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function PollSection({ p, group, me, isAdmin, poll, onChanged }) {
  const [creating, setCreating] = useState(false); const [titlesText, setTitlesText] = useState(""); const [busy, setBusy] = useState(false);

  async function submitPoll() {
    const titles = titlesText.split("\n").map((t) => t.trim()).filter(Boolean);
    if (titles.length < 2) return;
    setBusy(true); await gdb.createPoll(group.id, me.id, titles); setBusy(false); setCreating(false); setTitlesText(""); onChanged();
  }
  async function vote(optionId) { await gdb.vote(poll.options.map((o) => o.id), optionId, me.id); onChanged(); }

  if (!poll) {
    return isAdmin ? (
      <div className="rounded-xl p-4 mb-5" style={{ background: p.surface, border: `1px solid ${p.border}` }}>
        {!creating ? (
          <button onClick={() => setCreating(true)} className="sans text-sm flex items-center gap-2" style={{ color: p.ink }}><Vote size={16} color={p.gold} /> Start a "what next?" poll</button>
        ) : (
          <>
            <div className="sans text-xs font-semibold mb-2" style={{ color: p.muted }}>ONE BOOK TITLE PER LINE (2+)</div>
            <textarea value={titlesText} onChange={(e) => setTitlesText(e.target.value)} rows={4} placeholder={"Circe\nPiranesi\nThe Song of Achilles"} className="sans w-full text-sm rounded-lg px-3 py-2 outline-none border resize-none mb-2" style={{ borderColor: p.border, background: p.bg }} />
            <button onClick={submitPoll} disabled={busy} className="sans text-sm rounded-lg py-2 px-3" style={{ background: p.accent, color: p.accentInk }}>{busy ? "…" : "Start poll"}</button>
          </>
        )}
      </div>
    ) : null;
  }

  const totalVotes = poll.votes.length;
  const myVote = poll.votes.find((v) => v.user_id === me.id)?.option_id;
  return (
    <div className="rounded-xl p-4 mb-5" style={{ background: p.surface, border: `1px solid ${p.gold}` }}>
      <div className="sans text-xs font-semibold mb-3 flex items-center gap-2" style={{ color: p.ink }}><Vote size={15} color={p.gold} /> What should we read next?</div>
      <div className="flex flex-col gap-2">
        {poll.options.map((o) => {
          const count = poll.votes.filter((v) => v.option_id === o.id).length;
          const pct = totalVotes ? Math.round((count / totalVotes) * 100) : 0;
          const mine = myVote === o.id;
          return (
            <button key={o.id} onClick={() => vote(o.id)} className="text-left rounded-lg p-2.5 flex gap-2.5 items-center border relative overflow-hidden" style={{ borderColor: mine ? p.gold : p.border }}>
              <div className="absolute inset-0" style={{ width: `${pct}%`, background: mine ? "#C9A24B33" : "#00000008" }} />
              <Cover url={o.cover_url} size={32} />
              <span className="sans text-sm flex-1 relative">{o.title}</span>
              <span className="sans text-xs relative" style={{ color: p.muted }}>{count} vote{count !== 1 ? "s" : ""}</span>
            </button>
          );
        })}
      </div>
      {isAdmin && <button onClick={() => gdb.closePoll(poll.id).then(onChanged)} className="sans text-xs mt-3" style={{ color: p.muted }}>Close poll</button>}
    </div>
  );
}
function GroupChat({ p, group, me, onBack }) {
  const [messages, setMessages] = useState([]); const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const pollRef = useRef(null);
  const load = useCallback(async () => { setMessages(await gdb.getMessages(group.id)); await gdb.markRead(group.id, me.id); }, [group.id, me.id]);
  useEffect(() => { load(); pollRef.current = setInterval(load, 5000); return () => clearInterval(pollRef.current); }, [load]);
  async function send() { if (!text.trim()) return; setBusy(true); await gdb.postMessage(group.id, me.id, text.trim()); setText(""); setBusy(false); load(); }
  return (
    <div className="max-w-md mx-auto pb-4 flex flex-col" style={{ minHeight: "70vh" }}>
      <div className="px-6 pt-6 pb-3 flex items-center gap-3" style={{ borderBottom: `1px solid ${p.border}` }}>
        <button onClick={onBack} className="sans text-sm flex items-center gap-1" style={{ color: p.muted }}><ArrowLeft size={16} /></button>
        <Avatar name={group.name} url={group.avatar_url} size={32} /><span className="sans text-sm font-semibold">{group.name}</span>
      </div>
      <div className="flex-1 px-6 pt-4 flex flex-col gap-3 overflow-y-auto">
        {messages.length === 0 && <p className="sans text-sm text-center mt-8" style={{ color: p.muted }}>No messages yet — say hi!</p>}
        {messages.map((m) => (
          <div key={m.id} className="flex gap-2.5">
            <Avatar name={m.profiles?.username} size={28} />
            <div className="flex-1 rounded-xl rounded-tl-sm px-3 py-2" style={{ background: p.surface, border: `1px solid ${p.border}` }}>
              <div className="flex items-baseline gap-2 mb-0.5"><span className="sans text-xs font-semibold">{m.profiles?.username}</span><span className="sans text-[11px]" style={{ color: p.muted }}>{new Date(m.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span></div>
              <p className="text-sm" style={{ lineHeight: 1.5 }}>{m.body}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="px-6 pt-3">
        <div className="flex items-end gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the group…" rows={1} className="sans flex-1 text-sm rounded-lg px-3 py-2.5 outline-none border resize-none" style={{ borderColor: p.border, background: p.surface }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button onClick={send} disabled={busy || !text.trim()} className="rounded-lg p-3 shrink-0" style={{ background: p.accent, opacity: busy || !text.trim() ? 0.5 : 1 }}><Send size={16} color={p.accentInk} /></button>
        </div>
      </div>
    </div>
  );
}

// ---------- Chats tab ----------
function ChatsTab({ p, me, onOpenChat }) {
  const [groups, setGroups] = useState([]); const [previews, setPreviews] = useState({}); const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const mine = await gdb.myGroups(me.id);
      setGroups(mine);
      const pv = {};
      await Promise.all(mine.map(async (g) => {
        const msgs = await gdb.getMessages(g.id);
        const last = await gdb.lastRead(g.id, me.id);
        const lastMsg = msgs[msgs.length - 1];
        const unread = lastMsg && (!last || new Date(lastMsg.created_at) > new Date(last.last_read_at));
        pv[g.id] = { lastMsg, unread };
      }));
      setPreviews(pv); setLoading(false);
    })();
  }, [me.id]);

  return (
    <div className="max-w-md mx-auto px-6 pt-6 pb-10">
      <h2 className="text-2xl mb-4" style={{ fontWeight: 600 }}>Chats</h2>
      {loading && <p className="sans text-sm" style={{ color: p.muted }}>Loading…</p>}
      {!loading && groups.length === 0 && <p className="sans text-sm" style={{ color: p.muted }}>Join or create a group to start chatting.</p>}
      <div className="flex flex-col gap-2">
        {groups.map((g) => {
          const pv = previews[g.id];
          return (
            <button key={g.id} onClick={() => onOpenChat(g)} className="text-left rounded-xl p-3.5 flex gap-3 items-center border" style={{ borderColor: p.border, background: p.surface }}>
              <Avatar name={g.name} url={g.avatar_url} size={44} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{g.name}</div>
                <div className="sans text-xs truncate" style={{ color: p.muted }}>{pv?.lastMsg ? `${pv.lastMsg.profiles?.username}: ${pv.lastMsg.body}` : "No messages yet"}</div>
              </div>
              {pv?.unread && <span className="rounded-full" style={{ width: 9, height: 9, background: "#C0392B" }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Profile (badges + clans) ----------
export function Profile({ p, me, onBack }) {
  const [badges, setBadges] = useState(null); const [groups, setGroups] = useState([]);
  useEffect(() => { db.getBadges(me.id).then(setBadges); gdb.myGroups(me.id).then(setGroups); }, [me.id]);
  return (
    <div className="max-w-md mx-auto px-6 pt-6 pb-16">
      <button onClick={onBack} className="sans text-sm flex items-center gap-1 mb-5" style={{ color: p.muted }}><ArrowLeft size={16} /> Back</button>
      <h2 className="text-2xl mb-1" style={{ fontWeight: 600 }}>{me.username}</h2>
      <p className="sans text-sm mb-4" style={{ color: p.muted }}>{badges?.length || 0} books finished</p>
      {groups.length > 0 && (
        <div className="mb-6"><div className="sans text-xs font-semibold mb-2" style={{ color: p.muted }}>YOUR CLANS</div>
          <div className="flex gap-2 flex-wrap">{groups.map((g) => <div key={g.id} className="flex items-center gap-1.5 rounded-full pl-1 pr-3 py-1 border" style={{ borderColor: p.border }}><Avatar name={g.name} url={g.avatar_url} size={22} /><span className="sans text-xs">{g.name}</span></div>)}</div>
        </div>
      )}
      <div className="flex flex-col gap-3">
        {(badges || []).map((b, i) => (
          <div key={i} className="rounded-xl p-3.5 flex gap-3 items-center border" style={{ borderColor: p.border, background: p.surface }}>
            <Cover url={b.clubs?.cover_url} />
            <div className="flex-1"><div className="text-sm font-medium">{b.clubs?.title}</div><div className="sans text-xs flex items-center gap-1" style={{ color: p.muted }}><Star size={12} fill={p.gold} color={p.gold} /> You rated it {b.rating}/10</div></div>
            <Award size={18} color={p.gold} />
          </div>
        ))}
        {badges && badges.length === 0 && <p className="sans text-sm" style={{ color: p.muted }}>No badges yet — finish a book with a club to earn one.</p>}
      </div>
    </div>
  );
}
