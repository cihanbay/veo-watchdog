/* Bot health watchdog — GitHub Actions cron (hourly)
   - pings /health endpoints
   - REPAIR REMOVED by request: alerts only, with manual-start hint
   - notifies Telegram on state changes (10-min dedupe)              */
const fs = require("fs");
void fs;

const FALIX_KEY = process.env.FALIX_KEY;     // netcheckgate account
const BH_KEY = process.env.BH_KEY;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT = process.env.TG_CHAT;
const GHTOKEN = process.env.GHTOKEN;
const GHREPO = process.env.GHREPO;

function raw(u, o = {}, t = 12000) {
  return fetch(u, { ...o, signal: AbortSignal.timeout(t) });
}
async function jget(u, key) {
  const r = await raw(u, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
  try { return JSON.parse((await r.text()).replace(/^\uFEFF/, "")); } catch { return null; }
}
void jget;
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

async function watchServer(name, url, state) {
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
  const nowTs = Date.now();
  const last = state[name + "LastNotify"] || 0;
  if (nowTs - last > 10 * 60 * 1000) {
    state[name] = "down";
    state[name + "Alerted"] = true;
    state[name + "LastNotify"] = nowTs;
    stateChanged = true;
    await tg(`🚨 ${name}: DOWN (${c.why}) — auto-repair disabled; start it manually on the hosting panel (${url})`);
  } else {
    state[name] = "down";
  }
}

async function runChecks(state) {
  await watchServer("netcheckgate", "https://netcheckgate.falix.org", state);
  await watchServer("bot-hosting", "https://79pzovvqil.apps.bot-hosting.cloud", state);
}

(async () => {
  if (!TG_TOKEN || !TG_CHAT) { console.error("secrets missing"); process.exit(1); }
  const state = await readState();
  stateChanged = false;
  const state0 = JSON.stringify(state);
  await runChecks(state);
  if (JSON.stringify(state) !== state0) await writeState(state);
  console.log("watchdog pass complete");
  process.exit(0);
})().catch((e) => { console.error("watchdog error:", e.message); process.exit(1); });
