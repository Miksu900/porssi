// Käyttäjän oma robotti demossa: hoitaa ostot ja myynnit valitun strategian mukaan.
// Kaikki toiminnot ovat tavallisia markkinatilauksia, joten robotti noudattaa samoja sääntöjä ja palkkioita kuin käyttäjä.
import { ExchangeError } from "./engine.mjs";

export const STRATEGIES = {
  hold: { name: "Osta ja pidä", desc: "Robotti ei tee mitään. Hyvä vertailukohta muille strategioille." },
  dca: { name: "Säännöllinen ostaminen", desc: "Ostaa saman euromäärän aina valitun välin jälkeen hinnasta riippumatta." },
  range: { name: "Hintarajat", desc: "Ostaa, kun hinta putoaa alle ostorajan, ja myy osan, kun hinta nousee yli myyntirajan." },
};

/**
 * params:
 *  dca:   { everyTicks, euros }
 *  range: { buyBelow (€), sellAbove (€), euros (osto), sellFraction (0–1), cooldownTicks }
 */
export function createAutopilot(ex, acct, strategy, params = {}) {
  let ticks = 0;
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
      say(`${why}: osti ${btc(r.order.filled)} BTC (${eur(r.order.spent)} €)`);
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
      say(`${why}: myi ${btc(r.order.filled)} BTC`);
    } catch (e) {
      if (!(e instanceof ExchangeError)) throw e;
      say("Myynti epäonnistui: " + e.message);
    }
  }

  function tick() {
    ticks++;
    if (cooldown > 0) cooldown--;
    const price = ex.lastPrice === null ? null : Number(ex.lastPrice) / 100;
    if (strategy === "dca") {
      if (ticks % Math.max(1, params.everyTicks) === 0) buy(params.euros, "Säännöllinen osto");
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
