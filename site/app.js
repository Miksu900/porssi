import { Exchange, ExchangeError, toUnits, fmtUnits } from "./engine.mjs";
import { createMarket } from "./bots.mjs";

const ME = "sina";
const $ = (id) => document.getElementById(id);
const EUR = (u, d = 2) => Number(fmtUnits(u, 2, d)).toLocaleString("fi-FI", { minimumFractionDigits: d, maximumFractionDigits: d });
const BTCf = (u, d = 4) => fmtUnits(u, 8, d).replace(".", ",");

let ex, mkt, series = [], side = "buy", type = "limit";

function start() {
  ex = new Exchange();
  mkt = createMarket(ex, { start: 60000 });
  for (let i = 0; i < 60; i++) mkt.tick(); // esikuumennus: jotta kirjassa on heti sisältöä
  ex.deposit(ME, "EUR", toUnits("10000", 2));
  ex.deposit(ME, "BTC", toUnits("0.5", 8));
  series = ex.lastPrice ? [Number(ex.lastPrice) / 100] : [];
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
    const ch = ((series.at(-1) - series[0]) / series[0]) * 100;
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
      t = `Arvo noin ${EUR((p * q) / ex.one)} € · palkkio 0,1–0,2 %`;
    } else if (side === "buy") t = $("budget").value ? "Ostaa parhaaseen hintaan, kunnes summa on käytetty." : "";
    else t = $("qty").value ? "Myy parhaaseen hintaan heti." : "";
  } catch { t = ""; }
  $("est").textContent = t;
}

function draw() {
  const c = $("chart"), g = c.getContext("2d"), W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  if (series.length < 2) return;
  const lo = Math.min(...series), hi = Math.max(...series), pad = (hi - lo || 1) * 0.1;
  const y = (v) => H - 10 - ((v - lo + pad) / (hi - lo + 2 * pad)) * (H - 20);
  const x = (i) => (i / (series.length - 1)) * (W - 8) + 4;
  const up = series.at(-1) >= series[0];
  g.strokeStyle = up ? "#25c28a" : "#f0556a";
  g.lineWidth = 3;
  g.lineJoin = "round";
  g.beginPath();
  series.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
  g.stroke();
  g.fillStyle = "#8b97ad";
  g.font = "20px system-ui";
  g.fillText(hi.toLocaleString("fi-FI", { maximumFractionDigits: 0 }), 6, 22);
  g.fillText(lo.toLocaleString("fi-FI", { maximumFractionDigits: 0 }), 6, H - 6);
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
  if (ex.lastPrice) series.push(Number(ex.lastPrice) / 100);
  if (series.length > 120) series.shift();
  render();
}, 1500);

start();
