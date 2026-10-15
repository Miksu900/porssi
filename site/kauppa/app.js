import { Exchange, ExchangeError, toUnits, fmtUnits } from "../engine.mjs";
import { createMarket } from "../bots.mjs";

const ME = "sina";
const $ = (id) => document.getElementById(id);
const EUR = (u, d = 2) => Number(fmtUnits(u, 2, d)).toLocaleString("fi-FI", { minimumFractionDigits: d, maximumFractionDigits: d });
const BTCf = (u, d = 4) => fmtUnits(u, 8, d).replace(".", ",");

let ex, mkt, series = [], side = "buy", type = "limit";

// tallentaa jokaisesta kierroksesta hinnan ja kierroksen volyymin (kynttilöitä varten)
function record(seen) {
  let v = 0n;
  const ts = ex.trades;
  const fresh = ts.filter((t) => t.id > seen);
  for (const t of fresh) v += t.qty;
  if (ex.lastPrice) series.push({ p: Number(ex.lastPrice) / 100, v: Number(v) / 1e8 });
  if (series.length > 600) series.shift();
  return ts.length ? ts[ts.length - 1].id : seen;
}
let seenId = 0;

function start() {
  ex = new Exchange({ makerFeeBps: 0n, takerFeeBps: 5n });
  mkt = createMarket(ex, { start: 60000 });
  series = [];
  for (let i = 0; i < 240; i++) {
    mkt.tick();
    seenId = record(seenId);
  }
  ex.deposit(ME, "EUR", toUnits("10000", 2));
  ex.deposit(ME, "BTC", toUnits("0.5", 8));
  $("price").value = ex.lastPrice ? fmtUnits(ex.lastPrice, 2) : "";
  render();
}

function parse(id, scale) {
  const v = $(id).value.replace(",", ".").trim();
  return toUnits(v, scale);
}

function msg(text, ok) {
  const m = $("msg");
  m.textContent = text;
  m.className = ok ? "ok" : "err";
}

function render() {
  const lp = ex.lastPrice;
  $("last").textContent = lp ? EUR(lp) + " €" : "–";
  if (series.length > 1) {
    const ps = series.map((s) => s.p);
    $("hi").textContent = Math.max(...ps).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    $("lo").textContent = Math.min(...ps).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    $("vol").textContent = series.reduce((s, x) => s + x.v, 0).toLocaleString("fi-FI", { maximumFractionDigits: 2 });
    const ch = ((series.at(-1).p - series[0].p) / series[0].p) * 100;
    $("chg").textContent = (ch >= 0 ? "+" : "") + ch.toFixed(2).replace(".", ",") + " %";
    $("chg").className = "sub " + (ch >= 0 ? "up" : "down");
  }
  const b = ex.balances(ME);
  $("eurF").textContent = EUR(b.EUR.free);
  $("btcF").textContent = BTCf(b.BTC.free, 6);
  $("eurL").textContent = EUR(b.EUR.locked);
  $("btcL").textContent = BTCf(b.BTC.locked, 6);
  const total = lp ? Number(b.EUR.free + b.EUR.locked) / 100 + (Number(b.BTC.free + b.BTC.locked) / 1e8) * (Number(lp) / 100) : 0;
  $("total").textContent = total.toLocaleString("fi-FI", { maximumFractionDigits: 2 });

  const book = ex.getBook(7);
  const max = [...book.bids, ...book.asks].reduce((m, l) => (l.qty > m ? l.qty : m), 1n);
  const rows = (ls, cls) =>
    ls.map((l) => `<div class="row ${cls}" data-p="${fmtUnits(l.price, 2)}"><i style="width:${Number((l.qty * 100n) / max)}%"></i><span>${EUR(l.price)}</span><span>${BTCf(l.qty, 4)}</span></div>`).join("");
  $("asks").innerHTML = rows([...book.asks].reverse(), "ask");
  $("bids").innerHTML = rows(book.bids, "bid");
  const a = ex.bestAsk(), bb = ex.bestBid();
  $("spread").textContent = a && bb ? `Ero: ${EUR(a - bb)} €` : "";

  const open = ex.openOrders(ME);
  $("open").innerHTML = open.length
    ? open.map((o) => `<div class="ord"><span class="${o.side === "buy" ? "up" : "down"}">${o.side === "buy" ? "Osta" : "Myy"} ${BTCf(o.qty - o.filled, 6)} @ ${EUR(o.price)}</span><button data-c="${o.id}">Peru</button></div>`).join("")
    : "Ei avoimia tilauksia.";

  $("trades").innerHTML = ex.trades.slice(-12).reverse().map((t) =>
    `<div><span class="${t.takerSide === "buy" ? "up" : "down"}">${EUR(t.price)}</span><span>${BTCf(t.qty, 4)}</span><span>${t.taker === ME || t.maker === ME ? "sinä" : ""}</span></div>`).join("");
  estimate();
  draw();
}

function estimate() {
  let t = "";
  try {
    if (type === "limit") {
      const p = parse("price", 2), q = parse("qty", 8);
      t = `Arvo noin ${EUR((p * q) / ex.one)} € · palkkio maker 0 % / taker 0,05 %`;
    } else if (side === "buy") t = $("budget").value ? "Ostaa parhaaseen hintaan, kunnes summa on käytetty." : "";
    else t = $("qty").value ? "Myy parhaaseen hintaan heti." : "";
  } catch { t = ""; }
  $("est").textContent = t;
}

const CANDLE = 4; // kierrosta per kynttilä
function draw() {
  const c = $("chart"), g = c.getContext("2d"), W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  const cs = [];
  for (let i = 0; i < series.length; i += CANDLE) {
    const part = series.slice(i, i + CANDLE);
    cs.push({ o: part[0].p, c: part.at(-1).p, h: Math.max(...part.map((x) => x.p)), l: Math.min(...part.map((x) => x.p)), v: part.reduce((s, x) => s + x.v, 0) });
  }
  const view = cs.slice(-48);
  if (view.length < 2) return;
  const axisW = 78, chartH = H * 0.78, volTop = H * 0.82;
  const lo0 = Math.min(...view.map((k) => k.l)), hi0 = Math.max(...view.map((k) => k.h));
  const pad = (hi0 - lo0 || 1) * 0.08, lo = lo0 - pad, hi = hi0 + pad;
  const y = (v) => 6 + (1 - (v - lo) / (hi - lo)) * (chartH - 12);
  const slot = (W - axisW) / view.length;
  g.font = "20px ui-monospace, Menlo, Consolas, monospace";
  g.textBaseline = "middle";
  // ruudukko ja hinta-akseli
  g.strokeStyle = "#1c2638"; g.lineWidth = 1; g.fillStyle = "#6f7c93";
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4, yy = y(v);
    g.beginPath(); g.moveTo(0, yy); g.lineTo(W - axisW, yy); g.stroke();
    g.fillText(v.toLocaleString("fi-FI", { maximumFractionDigits: 0 }), W - axisW + 8, yy);
  }
  const vmax = Math.max(...view.map((k) => k.v), 1e-9);
  view.forEach((k, i) => {
    const x = i * slot + slot / 2, upc = k.c >= k.o, col = upc ? "#26d19a" : "#ff5c70";
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, y(k.h)); g.lineTo(x, y(k.l)); g.stroke();
    const top = y(Math.max(k.o, k.c)), bh = Math.max(2, Math.abs(y(k.o) - y(k.c)));
    g.fillRect(x - slot * 0.32, top, slot * 0.64, bh);
    g.globalAlpha = 0.35;
    const vh = (k.v / vmax) * (H - volTop - 4);
    g.fillRect(x - slot * 0.32, H - vh - 2, slot * 0.64, vh);
    g.globalAlpha = 1;
  });
  // viimeisen hinnan viiva
  const last = view.at(-1).c, ly = y(last), upL = last >= view.at(-1).o;
  g.setLineDash([6, 6]); g.strokeStyle = upL ? "#26d19a" : "#ff5c70"; g.beginPath(); g.moveTo(0, ly); g.lineTo(W - axisW, ly); g.stroke(); g.setLineDash([]);
  g.fillStyle = upL ? "#26d19a" : "#ff5c70"; g.fillRect(W - axisW, ly - 14, axisW, 28);
  g.fillStyle = "#04140e"; g.fillText(last.toLocaleString("fi-FI", { maximumFractionDigits: 0 }), W - axisW + 8, ly);
}

function setSide(s) {
  side = s;
  document.querySelectorAll("#side button").forEach((b) => b.classList.toggle("on", b.dataset.s === s));
  const go = $("go");
  go.className = "go " + s;
  go.textContent = s === "buy" ? "Osta BTC" : "Myy BTC";
  layout();
}
function setType(t) {
  type = t;
  document.querySelectorAll("#type button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  layout();
}
function layout() {
  $("lPrice").hidden = type !== "limit";
  const mb = type === "market" && side === "buy";
  $("lBudget").hidden = !mb;
  $("lQty").hidden = mb;
  estimate();
}

document.addEventListener("click", (e) => {
  const sb = e.target.closest("#side button"); if (sb) setSide(sb.dataset.s);
  const tb = e.target.closest("#type button"); if (tb) setType(tb.dataset.t);
  const cb = e.target.closest("[data-c]");
  if (cb) { try { ex.cancelOrder(cb.dataset.c, ME); msg("Tilaus peruttu.", true); } catch (er) { msg(er.message); } render(); }
  const row = e.target.closest(".row[data-p]");
  if (row) { $("price").value = row.dataset.p; estimate(); }
});
document.addEventListener("input", estimate);
$("reset").addEventListener("click", () => { start(); msg("Aloitettu alusta: 10 000 € ja 0,5 BTC valerahaa.", true); });

$("f").addEventListener("submit", (e) => {
  e.preventDefault();
  try {
    const o = { acct: ME, side, type };
    if (type === "limit") { o.price = parse("price", 2); o.qty = parse("qty", 8); }
    else if (side === "buy") o.quoteBudget = parse("budget", 2);
    else o.qty = parse("qty", 8);
    const r = ex.placeOrder(o);
    const filled = r.order.filled;
    msg(filled > 0n ? `Toteutui ${BTCf(filled, 6)} BTC.` : "Tilaus jätetty kirjaan.", true);
  } catch (er) {
    msg(er instanceof ExchangeError ? er.message : "Tarkista luvut.");
  }
  render();
});

setInterval(() => {
  mkt.tick();
  seenId = record(seenId);
  render();
}, 1500);

start();
