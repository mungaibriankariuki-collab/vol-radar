"use strict";
const $ = (id) => document.getElementById(id);
const CATS = ["All", "Starred", "Stocks", "Bonds", "FX", "Metals", "Energy", "Crypto"];
const DEFAULTS = { tv: 10, theme: "dark", warnAt: 1.2, notify: false, starred: [], acct: "", risk: 1, stop: 2, sel: "SPY", cat: "All", status: "", sort: "jump" };

const store = {
  get() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("volradar") || "{}") }; } catch { return { ...DEFAULTS }; } },
  set(p) { Object.assign(S, p); try { localStorage.setItem("volradar", JSON.stringify(S)); } catch {} },
};
const S = store.get();
let DATA = null;

// ---------- helpers ----------
const pct = (x, d = 1) => `${x.toFixed(d)}%`;
const money = (x) => "$" + Math.round(x).toLocaleString();
const status = (m) => { const r = m.forecast / m.vol_month; return r > S.warnAt ? "warn" : r < 0.95 ? "calm" : "steady"; };
const statusLabel = { warn: "Warning", calm: "Calmer", steady: "Steady" };
const size = (m) => (m.trend || 0) * Math.min(S.tv / m.forecast, 4);
const fmtSize = (x) => (x > 0 ? "+" : "") + x.toFixed(2) + "×";
const market = () => DATA.markets.find((m) => m.ticker === S.sel) || DATA.markets[0];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- theme ----------
function applyTheme() {
  const dark = S.theme === "dark" || (S.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]').content = dark ? "#0B0F17" : "#F4F6FA";
  document.querySelectorAll("#theme button").forEach((b) => b.classList.toggle("on", b.dataset.v === S.theme));
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

// ---------- navigation ----------
function go(name) {
  document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== "s-" + name));
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.go === name));
  if (name === "market") renderMarket();
  if (name === "size") renderSize();
  scrollTo(0, 0);
  history.replaceState(null, "", "#" + name);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]");
  if (b) go(b.dataset.go);
});

// ---------- today ----------
function renderToday() {
  const ms = DATA.markets;
  const gen = new Date(DATA.generated.replace("Z", ":00Z"));
  $("updated").textContent = `Next 5 days · updated ${gen.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${gen.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  const counts = { calm: 0, steady: 0, warn: 0 };
  ms.forEach((m) => counts[status(m)]++);
  $("tiles").innerHTML = ["calm", "steady", "warn"].map((k) =>
    `<button class="tile ${k}${S.status === k ? " sel" : ""}" data-st="${k}"><span class="sub">${{ calm: "Calmer", steady: "Steady", warn: "Warnings" }[k]}</span><b>${counts[k]}</b></button>`).join("");
  const warns = ms.filter((m) => status(m) === "warn").sort((a, b) => b.forecast / b.vol_month - a.forecast / a.vol_month).slice(0, 3);
  $("alert").innerHTML = warns.length ? `<div class="alert"><b>Turbulence ahead</b>${warns.map((m) =>
    `<button data-tk="${esc(m.ticker)}">${esc(m.name)}</button> ${pct(m.vol_month, 0)} → ${pct(m.forecast, 0)}`).join(" · ")}</div>` : "";
  $("chips").innerHTML = CATS.map((c) => `<button class="chip${S.cat === c ? " on" : ""}" data-cat="${c}">${c}</button>`).join("");
  renderList();
}
function renderList() {
  const q = $("search").value.trim().toLowerCase();
  let ms = DATA.markets.filter((m) =>
    (S.cat === "All" || (S.cat === "Starred" ? S.starred.includes(m.ticker) : m.cat === S.cat)) &&
    (!S.status || status(m) === S.status) &&
    (!q || [m.name, m.ticker, m.sym, m.cat].join(" ").toLowerCase().includes(q)));
  const key = { jump: (m) => -(m.forecast / m.vol_month), fc: (m) => -m.forecast, name: (m) => m.name };
  ms.sort((a, b) => { const x = key[S.sort](a), y = key[S.sort](b); return x < y ? -1 : x > y ? 1 : 0; });
  $("list").innerHTML = ms.length ? ms.map((m) => {
    const st = status(m), sz = size(m);
    return `<div class="row" data-tk="${esc(m.ticker)}">
      <div><div class="nm"><span class="dot ${st}"></span>${esc(m.name)}</div><div class="meta">${esc(m.sym || m.ticker)} · ${statusLabel[st]}</div></div>
      <div class="fc">${pct(m.forecast)}<small>was ${pct(m.vol_month)}</small></div>
      <span class="pill ${sz > 0 ? "up" : sz < 0 ? "down" : "flat"}">${fmtSize(sz)}</span></div>`;
  }).join("") : `<div class="empty">${S.cat === "Starred" ? "Star a market on its detail page to see it here." : "No markets match."}</div>`;
}
$("tiles").addEventListener("click", (e) => { const t = e.target.closest("[data-st]"); if (t) { store.set({ status: S.status === t.dataset.st ? "" : t.dataset.st }); renderToday(); } });
$("chips").addEventListener("click", (e) => { const c = e.target.closest("[data-cat]"); if (c) { store.set({ cat: c.dataset.cat }); renderToday(); } });
$("search").addEventListener("input", renderList);
$("sort").addEventListener("change", (e) => { store.set({ sort: e.target.value }); renderList(); });
document.addEventListener("click", (e) => {
  const r = e.target.closest("[data-tk]");
  if (r && DATA) { store.set({ sel: r.dataset.tk }); go("market"); }
});

// ---------- market ----------
function renderMarket() {
  if (!DATA) return;
  const m = market(), st = status(m), sz = size(m);
  $("mName").textContent = m.name;
  $("mSub").textContent = [m.sym, m.ticker, "data to " + new Date(m.data_to).toLocaleDateString(undefined, { day: "numeric", month: "short" })].filter(Boolean).join(" · ");
  $("mFc").textContent = pct(m.forecast);
  $("mStatus").className = "pill " + (st === "warn" ? "warn" : st === "calm" ? "up" : "flat");
  $("mStatus").textContent = statusLabel[st];
  $("mTrend").className = "pill " + (m.trend > 0 ? "up" : m.trend < 0 ? "down" : "flat");
  $("mTrend").textContent = m.trend > 0 ? "12-month trend up" : m.trend < 0 ? "12-month trend down" : "No trend yet";
  const ch = (m.forecast / m.vol_month - 1) * 100;
  $("mVs").textContent = `Last month ${pct(m.vol_month)} · ${ch >= 0 ? "+" : ""}${ch.toFixed(0)}%`;
  $("mDay").textContent = "±" + pct(m.forecast / Math.sqrt(252), 2);
  $("mWeek").textContent = "±" + pct(m.forecast * Math.sqrt(5 / 252), 2);
  $("mSize").textContent = fmtSize(sz);
  $("mSize").className = "val " + (sz > 0 ? "up" : sz < 0 ? "down" : "");
  $("mMix").textContent = m.ai_weight >= 1 ? "AI only" : m.ai_weight <= 0 ? "Linear only" : `AI ${Math.round(m.ai_weight * 100)}%`;
  const starred = S.starred.includes(m.ticker);
  $("star").classList.toggle("on", starred);
  $("star").setAttribute("aria-label", starred ? "Remove from starred" : "Add to starred");
  drawChart(m);
}
$("star").addEventListener("click", () => {
  const t = market().ticker;
  store.set({ starred: S.starred.includes(t) ? S.starred.filter((x) => x !== t) : [...S.starred, t] });
  renderMarket();
});
function drawChart(m) {
  const svg = $("chart"), W = Math.max(260, svg.clientWidth || 320), H = 170, L = 30, R = 8, T = 10, B = 20;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const { d, f, a } = m.hist, n = d.length;
  const vals = [...f, ...a.filter((v) => v != null)];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.12 || 1; lo = Math.max(0, lo - pad); hi += pad;
  const x = (i) => L + (i / (n - 1)) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const segs = []; let cur = [];
  a.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`); });
  if (cur.length) segs.push(cur);
  const ticks = [lo, (lo + hi) / 2, hi];
  const fmtD = (s) => new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  svg.innerHTML =
    ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width="1"/><text class="chart-axis" x="${L - 5}" y="${y(t) + 3}" text-anchor="end">${t.toFixed(0)}%</text>`).join("") +
    segs.map((s) => `<polyline points="${s.join(" ")}" stroke="var(--faint)" stroke-width="1.4"/>`).join("") +
    `<polyline points="${f.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}" stroke="var(--accent)" stroke-width="2.2"/>` +
    `<circle cx="${x(n - 1)}" cy="${y(f[n - 1])}" r="4.5" fill="var(--accent)" stroke="var(--s1)" stroke-width="2"/>` +
    `<text class="chart-axis" x="${L}" y="${H - 5}">${fmtD(d[0])}</text><text class="chart-axis" x="${W - R}" y="${H - 5}" text-anchor="end">${fmtD(d[n - 1])}</text>`;
  $("chartRange").textContent = "last 90 days";
}
addEventListener("resize", () => { if (!$("s-market").hidden && DATA) drawChart(market()); });

// ---------- size ----------
function renderSize() {
  if (!DATA) return;
  const sel = $("cMarket");
  if (!sel.options.length) sel.innerHTML = [...DATA.markets].sort((a, b) => a.name.localeCompare(b.name)).map((m) => `<option value="${esc(m.ticker)}">${esc(m.name)}${m.sym ? " · " + esc(m.sym) : ""}</option>`).join("");
  sel.value = market().ticker;
  $("cAcct").value = S.acct; $("cRisk").value = S.risk; $("cStop").value = S.stop;
  calc();
}
function calc() {
  const m = market(), acct = parseFloat($("cAcct").value), risk = +$("cRisk").value, stopX = +$("cStop").value;
  $("cRiskO").textContent = risk + "%";
  $("cStopO").textContent = stopX.toFixed(1) + "× typical day";
  const stop = (stopX * m.forecast) / Math.sqrt(252);
  $("oStop").textContent = pct(stop, 2);
  const ok = acct > 0;
  $("cErr").hidden = ok || $("cAcct").value === "";
  if (!ok) { ["oRisk", "oLev", "oPos", "oStrat"].forEach((k) => ($(k).textContent = "–")); return; }
  const atRisk = (acct * risk) / 100, pos = atRisk / (stop / 100);
  $("oRisk").textContent = money(atRisk);
  $("oPos").textContent = money(pos);
  $("oLev").textContent = (pos / acct).toFixed(2) + "×";
  const sz = size(m);
  $("oStrat").textContent = sz === 0 ? "No trend yet" : `${sz > 0 ? "Buy" : "Sell"} ${money(Math.abs(sz) * acct)}`;
}
$("cMarket").addEventListener("change", (e) => { store.set({ sel: e.target.value }); calc(); });
$("cAcct").addEventListener("input", (e) => { store.set({ acct: e.target.value }); calc(); });
$("cRisk").addEventListener("input", (e) => { store.set({ risk: +e.target.value }); calc(); });
$("cStop").addEventListener("input", (e) => { store.set({ stop: +e.target.value }); calc(); });

// ---------- settings ----------
function renderSettings() {
  $("tv").value = S.tv; $("tvO").textContent = S.tv + "%";
  $("warnAt").value = String(S.warnAt);
  $("notify").setAttribute("aria-pressed", String(S.notify));
  if (DATA) $("trained").textContent = new Date(DATA.trained_through).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  applyTheme();
}
$("tv").addEventListener("input", (e) => { store.set({ tv: +e.target.value }); $("tvO").textContent = S.tv + "%"; if (DATA) renderToday(); });
$("theme").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { store.set({ theme: b.dataset.v }); applyTheme(); } });
$("warnAt").addEventListener("change", (e) => { store.set({ warnAt: +e.target.value }); if (DATA) renderToday(); });
$("notify").addEventListener("click", async () => {
  let on = !S.notify;
  if (on && "Notification" in window && Notification.permission !== "granted") on = (await Notification.requestPermission()) === "granted";
  store.set({ notify: on }); renderSettings();
});
function maybeNotify() {
  if (!S.notify || !("Notification" in window) || Notification.permission !== "granted") return;
  const key = "volradar-notified-" + DATA.generated;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch {}
  const w = DATA.markets.filter((m) => status(m) === "warn");
  if (!w.length) return;
  const body = w.slice(0, 4).map((m) => `${m.name} ${pct(m.vol_month, 0)} → ${pct(m.forecast, 0)}`).join(", ");
  navigator.serviceWorker?.ready.then((r) => r.showNotification("Vol radar: turbulence ahead", { body, icon: "icons/icon-192.png", tag: "volradar" }))
    .catch(() => new Notification("Vol radar: turbulence ahead", { body }));
}
let installEvt = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("install").hidden = false; });
$("install").addEventListener("click", async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("install").hidden = true; });

// ---------- data ----------
async function load(force) {
  $("refresh").classList.add("spin");
  try {
    const r = await fetch("data/forecast.json" + (force ? "?t=" + Date.now() : ""), { cache: force ? "no-store" : "default" });
    if (!r.ok) throw new Error(r.status);
    DATA = await r.json();
    renderToday(); renderSettings();
    if (!$("s-market").hidden) renderMarket();
    if (!$("s-size").hidden) renderSize();
    maybeNotify();
  } catch (err) {
    $("updated").textContent = DATA ? "Couldn't refresh. Showing the last forecast." : "Couldn't load forecasts. Check your connection and refresh.";
  } finally {
    $("refresh").classList.remove("spin");
  }
}
$("refresh").addEventListener("click", () => load(true));

applyTheme(); renderSettings();
$("sort").value = S.sort;
const start = location.hash.slice(1);
load(false).then(() => { if (["market", "size", "settings"].includes(start)) go(start); });
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
