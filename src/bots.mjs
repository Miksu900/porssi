// Robotit luovat demopörssiin liikettä: satunnaiskävelyhinta ja lepäävät tarjoukset sen ympärillä.
import { ExchangeError } from "./engine.mjs";

export function createMarket(ex, { start = 60000, bots = 5, rnd = Math.random } = {}) {
  let fair = start; // euroa
  const names = Array.from({ length: bots }, (_, i) => `robotti${i + 1}`);
  const topUp = (n) => {
    const b = ex.balances(n);
    if (b.EUR.free < 100000n * 100n) ex.deposit(n, "EUR", 500000n * 100n);
    if (b.BTC.free < 5n * ex.one) ex.deposit(n, "BTC", 20n * ex.one);
  };
  names.forEach(topUp);

  const px = (eur) => BigInt(Math.max(1, Math.round(eur * 100)));
  const btc = (x) => BigInt(Math.max(1, Math.round(x * 1e5))) * 1000n;

  function tick() {
    fair *= Math.exp((rnd() - 0.5) * 0.004);
    for (const n of names) {
      topUp(n);
      // vanhat tarjoukset pois
      for (const o of ex.openOrders(n)) if (rnd() < 0.35) ex.cancelOrder(o.id, n);
      const spread = 0.0005 + rnd() * 0.006;
      try {
        ex.placeOrder({ acct: n, side: "buy", type: "limit", price: px(fair * (1 - spread)), qty: btc(0.01 + rnd() * 0.25) });
        ex.placeOrder({ acct: n, side: "sell", type: "limit", price: px(fair * (1 + spread)), qty: btc(0.01 + rnd() * 0.25) });
        if (rnd() < 0.3) {
          if (rnd() < 0.5) ex.placeOrder({ acct: n, side: "buy", type: "market", quoteBudget: px(100 + rnd() * 3000) });
          else ex.placeOrder({ acct: n, side: "sell", type: "market", qty: btc(0.002 + rnd() * 0.06) });
        }
      } catch (e) {
        if (!(e instanceof ExchangeError)) throw e;
      }
    }
  }
  return { tick, get fair() { return fair; }, names };
}
