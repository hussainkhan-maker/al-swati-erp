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
    // Only an ACTIVE Super-Admin may add people or reset passwords (a switched-off admin can still sign in, but not do this).
    const { data: me } = await admin.from("profiles").select("role, active").eq("id", u?.user?.id ?? "").single();
    if (me?.role !== "admin" || !me?.active) return json({ error: "Only Super-Admin can add people" }, 403);

    const body = await req.json();
    const pwOk = (p: unknown) => typeof p === "string" && p.length >= 10;

    // Forgot password: Super-Admin sets a new starting password; the person chooses their own at the next sign-in.
    if (body.action === "reset") {
      if (!body.user_id || !pwOk(body.password)) return json({ error: "A new password of 10 or more characters is required" }, 400);
      const { data: r, error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password, user_metadata: { temp_password: true } });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").update({ must_change: true }).eq("id", body.user_id); // nothing opens until they choose their own
      return json({ id: body.user_id, email: r.user?.email });
    }

    const { email, name, role, phone, projects = [], password } = body;
    if (!email || !name || !["abu", "engineer", "supervisor", "admin"].includes(role)) return json({ error: "Email, name and role are required" }, 400);
    if (!pwOk(password)) return json({ error: "A starting password of 10 or more characters is required" }, 400);
    const lang = role === "abu" ? "ar" : role === "supervisor" ? "ur" : "en";

    let id: string | undefined;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { temp_password: true } });
    if (created.error) {
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
      id = list?.users.find((x) => x.email?.toLowerCase() === String(email).toLowerCase())?.id;
      if (!id) return json({ error: created.error.message }, 400);
      await admin.auth.admin.updateUserById(id, { password, user_metadata: { temp_password: true } });
    } else id = created.data.user.id;

    const { error: pe } = await admin.from("profiles").upsert({ id, name, role, phone, lang, active: true, must_change: true });
    if (pe) return json({ error: pe.message }, 400);
    if (projects.length) await admin.from("project_members").upsert(projects.map((p: string) => ({ project_id: p, user_id: id })));
    return json({ id, email });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
