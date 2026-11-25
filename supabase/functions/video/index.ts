// Edge Function "video": videos on autopilot (Growth → Videos).
//  Twice a week Claude (a scheduled task with the Higgsfield connector) makes the pictures and clips and writes the plan into
//  video_ideas with status "rendering". The autopilot workflow asks "waiting" every 30 minutes and then starts the GitHub
//  workflow "Video", which takes the plan ("claim"), renders the MP4 (video/render.py), uploads it ("upload_url") and reports
//  ("done"): status "review". The owner watches it in Growth → Videos and presses Approve ("approve"): the video goes to YouTube
//  at once, private, set to go public at the next slot (Sunday or Wednesday, 7 pm Riyadh): status "scheduled", and "tick" marks
//  it "posted" when that time has passed. TikTok lets only apps it has approved post, so the owner posts there himself.
//  • "waiting" / "tick" (public, from the autopilot): how many plans wait (a number only); scheduled → posted, retry YouTube.
//  • "claim" / "upload_url" / "done" (only the "Video" workflow of this repository: GitHub signs each run, checked below).
//  • "link" / "approve" / "redo" / "retry" (Super-Admin, Growth → Videos).
//  • "yt_status" / "yt_start" / "yt_finish" / "yt_disconnect" (Super-Admin): the owner's own "Connect YouTube" (upload only).
// Nothing goes public without the owner's Approve.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-github-oidc" };
const URL_ = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const REPO = "hussainkhan-maker/al-swati-erp", AUDIENCE = "al-swati-video";
const GH_JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
// The same Google sign-in client as Search Console (seo function); the secret lives only in the server's secrets.
const G_CLIENT = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "479124517333-jc3h1mj0gr1hstpkf8aorg2jof0efa04.apps.googleusercontent.com";
const G_SECRET = Deno.env.get("GOOGLE_OAUTH_SECRET") ?? "";
const APP_URL = "https://hussainkhan-maker.github.io/al-swati-erp/";
const YT_SCOPE = "openid email https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";
const SLOTS = [0, 3], SLOT_HOUR_UTC = 16;   // Sunday and Wednesday, 16:00 UTC = 7 pm Riyadh
const STALE_MIN = 40, MAX_TRIES = 3;          // a render that has not reported for 40 minutes is taken again, 3 times at most
const H = 3600e3;
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const clean = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, n);

async function isAdmin(req: Request) {
  const u = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data } = await u.auth.getUser();
  if (!data?.user) return false;
  const { data: prof } = await db.from("profiles").select("role, active").eq("id", data.user.id).single();
  return prof?.role === "admin" && !!prof?.active;
}
/** Only a run of .github/workflows/video.yml on main of this repository: GitHub signs a token for each run. */
async function isWorker(req: Request) {
  const tok = req.headers.get("x-github-oidc") || "";
  if (!tok) return false;
  try {
    const { payload: p } = await jwtVerify(tok, GH_JWKS, { issuer: "https://token.actions.githubusercontent.com", audience: AUDIENCE });
    return p.repository === REPO && p.ref === "refs/heads/main" && String(p.job_workflow_ref || p.workflow_ref || "").startsWith(REPO + "/.github/workflows/video.yml@");
  } catch { return false; }
}

// ───────── the render queue ─────────
const staleBefore = () => new Date(Date.now() - STALE_MIN * 60e3).toISOString();
async function waiting() {
  const { count } = await db.from("video_ideas").select("id", { count: "exact", head: true }).eq("status", "rendering").lt("render_tries", MAX_TRIES)
    .or(`render_started.is.null,render_started.lt.${staleBefore()}`);
  return count ?? 0;
}
async function claim() {
  const { data } = await db.from("video_ideas").select("id, plan, render_tries").eq("status", "rendering").lt("render_tries", MAX_TRIES)
    .or(`render_started.is.null,render_started.lt.${staleBefore()}`).order("created_at").limit(1);
  const v = data?.[0];
  if (!v) return { job: null };
  const { data: got } = await db.from("video_ideas").update({ render_started: new Date().toISOString(), render_tries: (v.render_tries || 0) + 1, render_error: null })
    .eq("id", v.id).eq("status", "rendering").select("id").maybeSingle();
  return got ? { job: { id: v.id, plan: v.plan } } : { job: null };
}
async function done(p: any) {
  const { data: v } = await db.from("video_ideas").select("id, status, render_tries").eq("id", p.id).maybeSingle();
  if (!v || v.status !== "rendering") return { ok: false, error: "not rendering" };
  if (p.ok) {
    await db.from("video_ideas").update({ status: "review", video_path: `${v.id}.mp4`, video_seconds: Number(p.seconds) || null, render_error: null, updated_at: new Date().toISOString() }).eq("id", v.id);
  } else {
    const failed = (v.render_tries || 0) >= MAX_TRIES;
    await db.from("video_ideas").update({ render_error: clean(p.error, 1000), render_started: failed ? undefined : null, ...(failed ? { status: "failed" } : {}), updated_at: new Date().toISOString() }).eq("id", v.id);
  }
  return { ok: true };
}

// ───────── YouTube ─────────
const yLink = async () => (await db.from("youtube_link").select("*").eq("id", 1).maybeSingle()).data || null;
const saveYLink = async (patch: Record<string, unknown>) => { await db.from("youtube_link").upsert({ id: 1, ...patch, updated_at: new Date().toISOString() }); };
async function gToken(params: Record<string, string>) {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: G_CLIENT, client_secret: G_SECRET, ...params }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Google sign-in " + r.status + ": " + String(j.error_description || j.error || "").slice(0, 160));
  return j;
}
async function ytToken() {
  const L = await yLink();
  if (!L?.refresh_token) throw new Error('YouTube is not connected: press "Connect YouTube" in Growth → Videos.');
  try { return (await gToken({ grant_type: "refresh_token", refresh_token: L.refresh_token })).access_token as string; }
  catch (e) { await saveYLink({ last_error: String((e as Error).message).slice(0, 300) }); throw new Error('YouTube sign-in stopped working: press "Connect YouTube" again. ' + (e as Error).message); }
}
async function ytStart() {
  if (!G_SECRET) throw new Error("One step is left: the Google client secret must be saved in Supabase (Edge Functions → Secrets → GOOGLE_OAUTH_SECRET).");
  const state = "y." + b64url(crypto.getRandomValues(new Uint8Array(16))), verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  await saveYLink({ pkce: JSON.stringify({ state, verifier }), pkce_expires: new Date(Date.now() + 15 * 60e3).toISOString() });
  const q = new URLSearchParams({ client_id: G_CLIENT, redirect_uri: APP_URL, response_type: "code", scope: YT_SCOPE, state, code_challenge: challenge,
    code_challenge_method: "S256", access_type: "offline", prompt: "consent select_account" });
  return { url: "https://accounts.google.com/o/oauth2/v2/auth?" + q };
}
async function ytFinish(p: any) {
  if (p.error) throw new Error("Google: " + clean(p.error_description || p.error, 200));
  const L = await yLink(), k = L?.pkce ? JSON.parse(L.pkce) : null;
  if (!k || k.state !== p.state || !L?.pkce_expires || Date.parse(L.pkce_expires) < Date.now()) throw new Error('This YouTube sign-in has expired. Press "Connect YouTube" again.');
  const j = await gToken({ grant_type: "authorization_code", code: clean(p.code, 2000), code_verifier: k.verifier, redirect_uri: APP_URL });
  if (!j.refresh_token) throw new Error('Google did not give a lasting sign-in. Press "Connect YouTube" again.');
  if (!/youtube\.upload/.test(String(j.scope || ""))) throw new Error('YouTube upload was not allowed. Press "Connect YouTube" again and tick every box.');
  let account = "";
  try { const x = String(j.id_token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); account = JSON.parse(atob(x + "===".slice((x.length + 3) % 4))).email || ""; } catch { /* no email */ }
  const r = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { authorization: "Bearer " + j.access_token } });
  const ch = (await r.json().catch(() => ({})))?.items?.[0];
  if (!r.ok) throw new Error("YouTube " + r.status + ': the YouTube Data API may be switched off in Google Cloud for this sign-in client. Turn on "YouTube Data API v3" there and connect again.');
  if (!ch) throw new Error(`${account || "This Google account"} has no YouTube channel. Choose the AL-Swati channel when Google asks.`);
  await saveYLink({ account, channel_id: ch.id, channel_title: ch.snippet?.title || "", refresh_token: j.refresh_token, pkce: null, pkce_expires: null, connected_at: new Date().toISOString(), last_error: null });
  return { done: true, channel: ch.snippet?.title || ch.id, account };
}
/** The next free slot (Sunday or Wednesday 7 pm Riyadh) at least 30 minutes away. */
async function nextSlot(skipId: string) {
  const { data } = await db.from("video_ideas").select("publish_at").in("status", ["scheduled", "approved"]).neq("id", skipId).not("publish_at", "is", null);
  const taken = new Set((data || []).map((r: any) => new Date(r.publish_at).toISOString()));
  for (let d = 0; d < 60; d++) {
    const t = new Date(Date.now() + d * 24 * H); t.setUTCHours(SLOT_HOUR_UTC, 0, 0, 0);
    if (SLOTS.includes(t.getUTCDay()) && t.getTime() > Date.now() + 30 * 60e3 && !taken.has(t.toISOString())) return t.toISOString();
  }
  throw new Error("no free slot in the next 60 days");
}
const noAngles = (s: string) => s.replace(/[<>]/g, "");
async function ytUpload(v: any, publishAt: string | null) {
  const token = await ytToken();
  const { data: blob, error } = await db.storage.from("videos").download(v.video_path);
  if (error || !blob) throw new Error("the video file is missing: " + (error?.message || ""));
  const tags = String(v.youtube_tags || "").split(",").map((t) => noAngles(t).trim()).filter(Boolean);
  while (tags.join(",").length > 450) tags.pop();
  const meta = {
    snippet: { title: noAngles(clean(v.youtube_title || v.title_ar || "AL-Swati", 100)), description: noAngles(clean(v.youtube_description, 4900)), tags, categoryId: "27", defaultLanguage: "ar", defaultAudioLanguage: "ar" },
    status: { privacyStatus: publishAt ? "private" : "public", ...(publishAt ? { publishAt } : {}), selfDeclaredMadeForKids: false, containsSyntheticMedia: true, embeddable: true, license: "youtube" },
  };
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json; charset=UTF-8", "x-upload-content-type": "video/mp4", "x-upload-content-length": String(blob.size) },
    body: JSON.stringify(meta) });
  if (!init.ok) throw new Error("YouTube " + init.status + ": " + (await init.text()).slice(0, 300));
  const put = await fetch(init.headers.get("location")!, { method: "PUT", headers: { "content-type": "video/mp4" }, body: blob });
  const j = await put.json().catch(() => ({}));
  if (!put.ok || !j.id) throw new Error("YouTube upload " + put.status + ": " + JSON.stringify(j).slice(0, 300));
  return j.id as string;
}
/** Approve: to YouTube now, public at the next slot (or at once with when = "now"). Failures stay "approved" and are retried. */
async function publish(id: string, when: string) {
  const { data: v } = await db.from("video_ideas").select("*").eq("id", id).maybeSingle();
  if (!v) throw new Error("video not found");
  if (!["review", "approved"].includes(v.status)) throw new Error("this video is " + v.status);
  if (!v.video_path) throw new Error("this video has no file yet");
  const publishAt = when === "now" ? null : (v.publish_at && Date.parse(v.publish_at) > Date.now() + 30 * 60e3 ? v.publish_at : await nextSlot(v.id));
  const now = new Date().toISOString();
  await db.from("video_ideas").update({ status: "approved", approved_at: v.approved_at || now, publish_at: publishAt || now, review_note: null, updated_at: now }).eq("id", v.id);
  try {
    const yid = v.youtube_id || await ytUpload(v, publishAt);
    await db.from("video_ideas").update({ status: publishAt ? "scheduled" : "posted", youtube_id: yid, youtube_url: "https://youtube.com/shorts/" + yid, youtube_error: null,
      ...(publishAt ? {} : { posted_at: now }), updated_at: new Date().toISOString() }).eq("id", v.id);
    return { ok: true, youtube_url: "https://youtube.com/shorts/" + yid, publish_at: publishAt || now };
  } catch (e) {
    const m = String((e as Error).message).slice(0, 500);
    await db.from("video_ideas").update({ youtube_error: m, updated_at: new Date().toISOString() }).eq("id", v.id);
    return { ok: false, error: m, publish_at: publishAt || now };
  }
}
async function tick() {
  const now = new Date().toISOString(), out: string[] = [];
  const { data: due } = await db.from("video_ideas").update({ status: "posted", updated_at: now }).eq("status", "scheduled").lte("publish_at", now).select("id");
  for (const r of due || []) { await db.from("video_ideas").update({ posted_at: now }).eq("id", r.id).is("posted_at", null); out.push("posted " + r.id); }
  // an approved video whose YouTube upload failed: try again (once an hour, while YouTube is connected)
  const L = await yLink();
  if (L?.refresh_token) {
    const { data: again } = await db.from("video_ideas").select("id, publish_at, updated_at").eq("status", "approved").not("youtube_error", "is", null).lt("updated_at", new Date(Date.now() - H).toISOString()).limit(2);
    for (const r of again || []) { const x = await publish(r.id, r.publish_at && Date.parse(r.publish_at) > Date.now() + 30 * 60e3 ? "slot" : "now"); out.push("retry " + r.id + ": " + (x.ok ? "ok" : x.error)); }
  }
  return { ok: true, done: out };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, st = 200) => new Response(JSON.stringify(b), { status: st, headers: { ...cors, "content-type": "application/json" } });
  try {
    const p = await req.json().catch(() => ({}));
    if (p.action === "waiting") return json({ waiting: await waiting() });
    if (p.action === "tick") return json(await tick());
    if (["claim", "upload_url", "done"].includes(p.action)) {
      if (!(await isWorker(req))) return json({ error: "Only the Video workflow of " + REPO }, 403);
      if (p.action === "claim") return json(await claim());
      if (p.action === "done") return json(await done(p));
      const { data: v } = await db.from("video_ideas").select("id, status").eq("id", p.id).maybeSingle();
      if (!v || v.status !== "rendering") return json({ error: "not rendering" }, 409);
      const { data, error } = await db.storage.from("videos").createSignedUploadUrl(`${v.id}.mp4`, { upsert: true });
      if (error) throw new Error(error.message);
      return json({ url: data.signedUrl });
    }
    if (!(await isAdmin(req))) return json({ error: "Only Super-Admin" }, 403);
    if (p.action === "link") {
      const { data: v } = await db.from("video_ideas").select("video_path, title_en").eq("id", p.id).maybeSingle();
      if (!v?.video_path) return json({ error: "no video file yet" }, 404);
      const name = "al-swati-" + String(v.title_en || "video").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) + ".mp4";
      const { data, error } = await db.storage.from("videos").createSignedUrl(v.video_path, 3600, p.download ? { download: name } : undefined);
      if (error) throw new Error(error.message);
      return json({ url: data.signedUrl });
    }
    if (p.action === "approve") return json(await publish(String(p.id), p.when === "now" ? "now" : "slot"));
    if (p.action === "redo") { // a new version: Claude reads the note on its next run and makes the pictures and clips again
      const { error } = await db.from("video_ideas").update({ status: "idea", review_note: clean(p.note, 1000) || "Make a new version.", render_tries: 0, render_error: null, render_started: null, updated_at: new Date().toISOString() })
        .eq("id", p.id).in("status", ["review", "failed", "rendering"]);
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }
    if (p.action === "retry") { // the render failed 3 times: try once more
      const { error } = await db.from("video_ideas").update({ status: "rendering", render_tries: 0, render_error: null, render_started: null, updated_at: new Date().toISOString() }).eq("id", p.id).eq("status", "failed");
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }
    if (p.action === "yt_status") {
      const L = await yLink();
      return json({ linked: !!L?.refresh_token, channel: L?.channel_title || null, account: L?.account || null, error: L?.last_error || null, ready: !!G_SECRET });
    }
    if (p.action === "yt_start") return json(await ytStart());
    if (p.action === "yt_finish") return json(await ytFinish(p));
    if (p.action === "yt_disconnect") {
      const L = await yLink();
      if (L?.refresh_token) await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(L.refresh_token), { method: "POST" }).catch(() => {});
      await saveYLink({ refresh_token: null, account: null, channel_id: null, channel_title: null, last_error: null });
      return json({ ok: true });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e).slice(0, 500) }, 500);
  }
});
