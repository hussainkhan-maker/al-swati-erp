// Edge Function "invite-user": Super-Admin adds a person (Abu, engineer, supervisor) with a role and their sites.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: u } = await user.auth.getUser();
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: me } = await admin.from("profiles").select("role").eq("id", u?.user?.id ?? "").single();
    if (me?.role !== "admin") return json({ error: "Only Super-Admin can add people" }, 403);

    const { email, name, role, phone, projects = [] } = await req.json();
    if (!email || !name || !["abu", "engineer", "supervisor", "admin"].includes(role)) return json({ error: "Email, name and role are required" }, 400);
    const lang = role === "abu" ? "ar" : role === "supervisor" ? "ur" : "en";

    let id: string | undefined;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error) {
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
      id = list?.users.find((x) => x.email?.toLowerCase() === String(email).toLowerCase())?.id;
      if (!id) return json({ error: created.error.message }, 400);
    } else id = created.data.user.id;

    const { error: pe } = await admin.from("profiles").upsert({ id, name, role, phone, lang, active: true });
    if (pe) return json({ error: pe.message }, 400);
    if (projects.length) await admin.from("project_members").upsert(projects.map((p: string) => ({ project_id: p, user_id: id })));
    return json({ id });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
