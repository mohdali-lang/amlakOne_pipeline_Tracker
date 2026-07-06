import { supabase } from "./supabaseClient";

// Row Level Security scopes every SELECT automatically:
// agents get their own rows, leaders get their team, management gets all.
// So the same calls work for every role — no client-side role filtering needed for security.

export const todayISO = () => new Date().toISOString().slice(0, 10);

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}
export async function signOut() {
  return supabase.auth.signOut();
}
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getMyProfile() {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", u.user.id).single();
  return data;
}

export async function getKpiDefs() {
  const { data } = await supabase.from("kpi_defs").select("*").order("sort");
  return data || [];
}

export async function getTeams() {
  const { data } = await supabase.from("teams").select("*").order("name");
  return data || [];
}

export async function getProfiles() {
  const { data } = await supabase.from("profiles").select("*").eq("active", true).order("full_name");
  return data || [];
}

export async function getDeals() {
  const { data } = await supabase.from("deals").select("*").order("updated_at", { ascending: false });
  return data || [];
}

export async function getEntries(date = todayISO()) {
  const { data } = await supabase.from("kpi_entries").select("*").eq("entry_date", date);
  return data || [];
}

export async function upsertEntry(agentId, values, date = todayISO()) {
  const { data, error } = await supabase
    .from("kpi_entries")
    .upsert({ agent_id: agentId, entry_date: date, values }, { onConflict: "agent_id,entry_date" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function saveDeal(deal) {
  const row = { ...deal };
  if (!row.id) delete row.id;
  const { data, error } = await supabase.from("deals").upsert(row).select().single();
  if (error) throw error;
  return data;
}

export async function deleteDeal(id) {
  const { error } = await supabase.from("deals").delete().eq("id", id);
  if (error) throw error;
}

// Live updates: refetch whenever deals or entries change anywhere in scope.
export function subscribeChanges(onChange) {
  const ch = supabase
    .channel("pipeline-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "deals" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "kpi_entries" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(ch);
}
