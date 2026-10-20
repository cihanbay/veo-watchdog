/* Veo watchdog — GitHub Actions cron (every 5 min)
   - pings the 3 server /health endpoints
   - auto-fixes: Falix 502 → proxy toggle; Bot-Hosting offline → power start
   - notifies Telegram on state changes (no spam — only transitions)
   - HidenCloud free-slot detector → urgent Telegram ping                 */
const fs = require("fs");

const FALIX_KEY = process.env.FALIX_KEY;     // netcheckgate account
const FALIX_KEY2 = process.env.FALIX_KEY2;   // jahan account
const BH_KEY = process.env.BH_KEY;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT = process.env.TG_CHAT;
const GHTOKEN = process.env.GHTOKEN;
const GHREPO = process.env.GHREPO;

const API = "https://api.uptimerobot.com"; // unused placeholder guard
void API;

function raw(u, o = {}, t = 12000) {
  return fetch(u, { ...o, signal: AbortSignal.timeout(t) });
}
async function jget(u, key) {
  const r = await raw(u, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
  try { return JSON.parse((await r.text()).replace(/^\uFEFF/, "")); } catch { return null; }
}
async function jpost(u, key, body) {
  const r = await raw(u, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try { return JSON.parse((await r.text()).replace(/^\uFEFF/, "")); } catch { return null; }
}
async function tg(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try { await raw(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: TG_CHAT, text }) }); } catch {}
}

async function health(url) {
  try {
    const r = await raw(url + "/health");
    const t = await r.text();
    if (t.startsWith("{")) { const j = JSON.parse(t); if (j.ok) return { ok: true, j }; }
    return { ok: false, why: `HTTP ${r.status}` };
  } catch (e) { return { ok: false, why: e.message || "network" }; }
}

/* state persisted as a file in this repo (stops Telegram spam; only transitions alert) */
async function readState() {
  try {
    const r = await raw(`https://api.github.com/repos/${GHREPO}/contents/state.json`, { headers: { Authorization: `Bearer ${GHTOKEN}`, Accept: "application/vnd.github+json" } });
    if (r.status === 404) return {};
    const j = await r.json();
    return JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
  } catch { return {}; }
}
let stateChanged = false;
async function writeState(state) {
  if (!stateChanged) return;
  try {
    const r = await raw(`https://api.github.com/repos/${GHREPO}/contents/state.json`, { headers: { Authorization: `Bearer ${GHTOKEN}`, Accept: "application/vnd.github+json" } });
    const sha = r.status === 200 ? (await r.json()).sha : undefined;
    await raw(`https://api.github.com/repos/${GHREPO}/contents/state.json`, { method: "PUT", headers: { Authorization: `Bearer ${GHTOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" }, body: JSON.stringify({ message: "watchdog state", content: Buffer.from(JSON.stringify(state, null, 2)).toString("base64"), ...(sha ? { sha } : {}) }) });
  } catch {}
}

async function falixToggleProxy(key, sid) {
  const d = await jget(`https://client.falixnodes.net/api/v2/servers/${sid}/proxies`, key);
  const px = d && d.data && d.data[0];
  if (!px) return false;
  try { await jpost(`https://client.falixnodes.net/api/v2/servers/${sid}/proxies/${px.id}`, key, { enabled: false }); } catch {}
  await new Promise((r) => setTimeout(r, 3000));
  try { await jpost(`https://client.falixnodes.net/api/v2/servers/${sid}/proxies/${px.id}`, key, { enabled: true }); } catch {}
  await new Promise((r) => setTimeout(r, 12000));
  return true;
}
async function falixPower(key, sid) {
  const r = await jpost(`https://client.falixnodes.net/api/v2/servers/${sid}/power`, key, { signal: "start" });
  if (r && r.error) return { started: false, why: r.error.code || "unknown" };
  await new Promise((r) => setTimeout(r, 25000));
  return { started: true };
}
async function bhStart() {
  await jpost(`https://bot-hosting.net/api/v1/deployments/${process.env.BH_ID || ""}/power`, BH_KEY, { action: "start", waitSeconds: 0 });
  await new Promise((r) => setTimeout(r, 40000));
}

async function watchServer(name, url, key, sid, state, powerable) {
  let c = await health(url);
  if (!c.ok) {
    await new Promise((r) => setTimeout(r, 25000));
    c = await health(url);
  }
  const st = state[name] || "up";
  if (c.ok) {
    if (st !== "up") { state[name] = "up"; state[name + "Alerted"] = false; stateChanged = true; await tg(`✅ ${name} is back UP (${url})`); }
    return;
  }
  /* heal attempt */
  let fixed = false, manual = null;
  if (powerable === "falix-toggle") {
    await falixToggleProxy(key, sid);
    await new Promise((r) => setTimeout(r, 15000));
    let c2 = await health(url);
    if (!c2.ok) { const p = await falixPower(key, sid); await new Promise((r) => setTimeout(r, 20000)); c2 = await health(url); if (!c2.ok && p && p.why) manual = "needs manual Start on the dashboard (captcha)"; }
    if (c2.ok) fixed = true;
  } else if (powerable === "bh") {
    await bhStart();
    const c2 = await health(url);
    if (c2.ok) fixed = true;
  }
  /* notify on transitions only */
  if (fixed) {
    state[name] = "up"; state[name + "Alerted"] = false; stateChanged = true;
    await tg(`🛠 ${name}: auto-fixed and back UP (${url})`);
  } else if (st !== "down" || !state[name + "Alerted"]) {
    state[name] = "down"; state[name + "Alerted"] = true; stateChanged = true;
    await tg(`🚨 ${name}: DOWN (${c.why})${manual ? " — " + manual : ""} (${url})`);
  }
}

async function runChecks(state) {
  await watchServer("netcheckgate", "https://netcheckgate.falix.org", FALIX_KEY, "3511712", state, "falix-toggle");
  await watchServer("veosmp", "https://veosmp.falix.org", FALIX_KEY2, "3513528", state, "none");
  await watchServer("bot-hosting", "https://79pzovvqil.apps.bot-hosting.cloud", BH_KEY, null, state, "bh");

  /* HidenCloud free-slot detector */
  try {
    const r = await raw("https://dash.hidencloud.com/store/view/349");
    const t = await r.text();
    const valid = t.includes("Location");
    const hasSlot = valid && !t.includes("This location is full and unavailable");
    if (hasSlot && state.hiden !== "open") { state.hiden = "open"; stateChanged = true; await tg("🎯 HidenCloud FREE SLOT AVAILABLE — go now: https://dash.hidencloud.com/store/view/349"); }
    if (!hasSlot && state.hiden === "open") { state.hiden = "closed"; stateChanged = true; }
  } catch {}
}

(async () => {
  if (!FALIX_KEY || !BH_KEY || !TG_TOKEN) { console.log("secrets missing — skipping"); return; }

  /* long-runner: check every 60s for ~4.8h, then exit; cron starts the next loop */
  const state = await readState();
  const started = Date.now();
  const WINDOW = 290 * 60 * 1000;
  let tick = 0;
  while (Date.now() - started < WINDOW) {
    tick++;
    stateChanged = false;
    const state0 = JSON.stringify(state);

    await runChecks(state);

    if (JSON.stringify(state) !== state0) await writeState(state);

    console.log(`tick ${tick} done — next in 60s`);
    const remaining = WINDOW - (Date.now() - started);
    if (remaining > 0) await new Promise((r) => setTimeout(r, Math.min(60000, remaining)));
  }
  await writeState(state);
  console.log("watchdog window complete — cron will restart");
  process.exit(0);
})().catch((e) => { console.error("watchdog error:", e.message); process.exit(0); });
