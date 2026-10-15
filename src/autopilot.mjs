// Käyttäjän oma robotti demossa: hoitaa ostot ja myynnit valitun strategian mukaan.
// Kaikki toiminnot ovat tavallisia markkinatilauksia, joten robotti noudattaa samoja sääntöjä ja palkkioita kuin käyttäjä.
import { ExchangeError } from "./engine.mjs";

export const STRATEGIES = {
  hold: { name: "Osta ja pidä", desc: "Robotti ei tee mitään. Hyvä vertailukohta muille strategioille." },
  dca: { name: "Säännöllinen ostaminen", desc: "Ostaa saman euromäärän aina valitun välin jälkeen hinnasta riippumatta." },
  range: { name: "Hintarajat", desc: "Ostaa, kun hinta putoaa alle ostorajan, ja myy osan, kun hinta nousee yli myyntirajan." },
  ma: { name: "Liukuvien keskiarvojen leikkaus", desc: "Ostaa, kun nopea keskiarvo nousee hitaan yläpuolelle, ja myy kun se putoaa sen alle. Seuraa trendiä." },
  meanrev: { name: "Keskiarvoon palautuminen", desc: "Ostaa, kun hinta on pudonnut selvästi keskiarvonsa alle, ja myy kun se on noussut selvästi sen yli. Olettaa, että hinta palaa keskiarvoon." },
  breakout: { name: "Läpimurto", desc: "Ostaa, kun hinta ylittää viimeaikaisen ylärajan, ja myy kun se alittaa viimeaikaisen alarajan." },
  rsi: { name: "RSI-indikaattori", desc: "Ostaa, kun RSI-arvo on matala (ylimyyty), ja myy kun se on korkea (yliostettu)." },
};

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
export function sma(prices, n) {
  return prices.length < n ? null : avg(prices.slice(-n));
}
/** RSI (Wilderin yksinkertaistettu keskiarvoversio): 100 - 100/(1+RS), RS = keskimääräinen nousu / keskimääräinen lasku. */
export function rsi(prices, n) {
  if (prices.length < n + 1) return null;
  const w = prices.slice(-(n + 1));
  let up = 0, down = 0;
  for (let i = 1; i < w.length; i++) {
    const d = w[i] - w[i - 1];
    if (d > 0) up += d; else down -= d;
  }
  if (down === 0) return up === 0 ? 50 : 100;
  return 100 - 100 / (1 + up / down);
}

/**
 * params:
 *  dca:   { everyTicks, euros }
 *  range: { buyBelow (€), sellAbove (€), euros (osto), sellFraction (0–1), cooldownTicks }
 */
export function createAutopilot(ex, acct, strategy, params = {}, seed = []) {
  let ticks = 0;
  const hist = [...seed];
  let prevRel = null;
  let cooldown = 0;
  const log = [];
  const say = (text) => {
    log.unshift(text);
    if (log.length > 20) log.pop();
  };
  const eur = (u) => (Number(u) / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const btc = (u) => (Number(u) / 1e8).toLocaleString("fi-FI", { maximumFractionDigits: 6 });

  function buy(euros, why) {
    const budget = BigInt(Math.round(euros * 100));
    const free = ex.balances(acct)[ex.quote].free;
    const use = budget < free ? budget : free;
    if (use < ex.minNotional) return say("Osto jäi väliin: vapaa saldo ei riitä.");
    try {
      const r = ex.placeOrder({ acct, side: "buy", type: "market", quoteBudget: use });
      say(r.order.filled > 0n ? `${why}: osti ${btc(r.order.filled)} BTC (${eur(r.order.spent)} €)` : `${why}: ei toteutunut, kirjassa ei ollut myyjiä`);
    } catch (e) {
      if (!(e instanceof ExchangeError)) throw e;
      say("Osto epäonnistui: " + e.message);
    }
  }
  function sell(fraction, why) {
    const free = ex.balances(acct)[ex.base].free;
    let qty = (free * BigInt(Math.round(fraction * 1000))) / 1000n;
    qty -= qty % ex.lot;
    if (qty <= 0n) return say("Myynti jäi väliin: ei myytävää.");
    try {
      const r = ex.placeOrder({ acct, side: "sell", type: "market", qty });
      say(r.order.filled > 0n ? `${why}: myi ${btc(r.order.filled)} BTC` : `${why}: ei toteutunut, kirjassa ei ollut ostajia`);
    } catch (e) {
      if (!(e instanceof ExchangeError)) throw e;
      say("Myynti epäonnistui: " + e.message);
    }
  }

  function tick() {
    ticks++;
    if (cooldown > 0) cooldown--;
    const price = ex.lastPrice === null ? null : Number(ex.lastPrice) / 100;
    const before = [...hist];
    if (price !== null) hist.push(price);
    if (hist.length > 1000) hist.shift();
    if (strategy === "dca") {
      if (ticks % Math.max(1, params.everyTicks) === 0) buy(params.euros, "Säännöllinen osto");
    } else if (strategy === "ma" && price !== null) {
      const f = sma(hist, params.fast), sl = sma(hist, params.slow);
      if (f !== null && sl !== null) {
        const rel = f > sl ? 1 : f < sl ? -1 : 0;
        if (prevRel !== null && rel !== prevRel && rel !== 0) {
          if (rel > 0) buy(params.euros, "Nopea keskiarvo ylitti hitaan");
          else sell(1, "Nopea keskiarvo alitti hitaan");
        }
        if (rel !== 0) prevRel = rel;
      }
    } else if (strategy === "meanrev" && price !== null && cooldown === 0) {
      const m = sma(hist, params.period);
      if (m !== null) {
        const dev = price / m - 1;
        if (dev <= -params.threshold) { buy(params.euros, `Hinta ${(dev * 100).toFixed(2)} % keskiarvon alla`); cooldown = 5; }
        else if (dev >= params.threshold) { sell(params.sellFraction ?? 0.5, `Hinta ${(dev * 100).toFixed(2)} % keskiarvon yllä`); cooldown = 5; }
      }
    } else if (strategy === "breakout" && price !== null && cooldown === 0) {
      if (before.length >= params.window) {
        const w = before.slice(-params.window);
        if (price > Math.max(...w)) { buy(params.euros, "Hinta ylitti ylärajan"); cooldown = 5; }
        else if (price < Math.min(...w)) { sell(1, "Hinta alitti alarajan"); cooldown = 5; }
      }
    } else if (strategy === "rsi" && price !== null && cooldown === 0) {
      const r = rsi(hist, params.period);
      if (r !== null) {
        if (r <= params.low) { buy(params.euros, `RSI ${r.toFixed(0)} (matala)`); cooldown = 5; }
        else if (r >= params.high) { sell(params.sellFraction ?? 0.5, `RSI ${r.toFixed(0)} (korkea)`); cooldown = 5; }
      }
    } else if (strategy === "range" && price !== null && cooldown === 0) {
      if (price <= params.buyBelow) {
        buy(params.euros, `Hinta ${price.toFixed(0)} € alle ostorajan`);
        cooldown = params.cooldownTicks ?? 5;
      } else if (price >= params.sellAbove) {
        sell(params.sellFraction ?? 0.25, `Hinta ${price.toFixed(0)} € yli myyntirajan`);
        cooldown = params.cooldownTicks ?? 5;
      }
    }
  }
  return { tick, log, strategy, params };
}
