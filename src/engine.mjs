// Pörssin ydin: tilauskirja, parinhaku ja saldot.
// Kaikki summat ovat kokonaislukuja (BigInt), jotta pyöristysvirheitä ei synny.
// Hinta = quote-valuutan pienin yksikkö (esim. sentti) yhtä base-valuutan kokonaista yksikköä (1 BTC) kohti.
// Määrä = base-valuutan pienin yksikkö (esim. 1e-8 BTC).

export class ExchangeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const ceilDiv = (a, b) => (a + b - 1n) / b;

/** Muuntaa desimaalimerkkijonon ("0.5") pienimmiksi yksiköiksi. Heittää virheen, jos desimaaleja on liikaa. */
export function toUnits(str, scale) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(str).trim());
  if (!m) throw new ExchangeError("bad_number", `Virheellinen luku: ${str}`);
  const frac = m[2] || "";
  if (frac.length > scale) throw new ExchangeError("too_many_decimals", `Liikaa desimaaleja: ${str}`);
  return BigInt(m[1] + frac.padEnd(scale, "0"));
}

/** Muuntaa yksiköt takaisin merkkijonoksi. */
export function fmtUnits(units, scale, decimals = scale) {
  const neg = units < 0n;
  const u = neg ? -units : units;
  const s = u.toString().padStart(scale + 1, "0");
  const whole = s.slice(0, s.length - scale);
  let frac = s.slice(s.length - scale).padEnd(decimals, "0").slice(0, decimals);
  return (neg ? "-" : "") + whole + (decimals > 0 ? "." + frac : "");
}

export class Exchange {
  constructor({
    base = "BTC",
    quote = "EUR",
    baseScale = 8,
    quoteScale = 2,
    makerFeeBps = 10n,
    takerFeeBps = 20n,
    tick = 1n, // pienin hintaporras (quote-yksikköä)
    lot = 1n, // pienin määräporras (base-yksikköä)
    feeAccount = "__fees__",
    minNotional = 100n, // pienin tilauksen arvo quote-yksikköinä (1 € = 100)
  } = {}) {
    this.minNotional = BigInt(minNotional);
    this.base = base;
    this.quote = quote;
    this.baseScale = baseScale;
    this.quoteScale = quoteScale;
    this.one = 10n ** BigInt(baseScale);
    this.makerFeeBps = BigInt(makerFeeBps);
    this.takerFeeBps = BigInt(takerFeeBps);
    this.tick = BigInt(tick);
    this.lot = BigInt(lot);
    this.feeAccount = feeAccount;
    this.accounts = new Map();
    this.orders = new Map();
    this.bids = []; // hintatasot, paras (korkein) ensin
    this.asks = []; // hintatasot, paras (matalin) ensin
    this.trades = [];
    this.lastPrice = null;
    this.seq = 0n;
    this.listeners = new Set();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  _emit(ev) {
    for (const fn of this.listeners) fn(ev);
  }

  // ---- tilit ----
  _acct(id) {
    let a = this.accounts.get(id);
    if (!a) {
      a = {
        [this.base]: { free: 0n, locked: 0n },
        [this.quote]: { free: 0n, locked: 0n },
      };
      this.accounts.set(id, a);
    }
    return a;
  }

  /** Demohana: lisää valerahaa tilille. */
  deposit(acct, asset, amount) {
    amount = BigInt(amount);
    if (amount <= 0n) throw new ExchangeError("bad_amount", "Summan pitää olla positiivinen");
    if (asset !== this.base && asset !== this.quote) throw new ExchangeError("bad_asset", "Tuntematon valuutta");
    this._acct(acct)[asset].free += amount;
  }

  balances(acct) {
    const a = this._acct(acct);
    return {
      [this.base]: { ...a[this.base] },
      [this.quote]: { ...a[this.quote] },
    };
  }

  totalSupply(asset) {
    let t = 0n;
    for (const a of this.accounts.values()) t += a[asset].free + a[asset].locked;
    return t;
  }

  _lock(acct, asset, amount) {
    const b = this._acct(acct)[asset];
    if (b.free < amount) throw new ExchangeError("insufficient_funds", `Saldo ei riitä (${asset})`);
    b.free -= amount;
    b.locked += amount;
  }
  _spendLocked(acct, asset, amount) {
    this._acct(acct)[asset].locked -= amount;
  }
  _release(order) {
    if (order.locked > 0n) {
      const asset = order.side === "buy" ? this.quote : this.base;
      const b = this._acct(order.acct)[asset];
      b.locked -= order.locked;
      b.free += order.locked;
      order.locked = 0n;
    }
  }
  _credit(acct, asset, amount) {
    this._acct(acct)[asset].free += amount;
  }
  /** Limit-ostotilauksen lukitus pienenee, kun hintaparannus tai täyttö vapauttaa varoja. */
  _trimLock(order) {
    if (order.type !== "limit" || order.side !== "buy") return;
    const need = ceilDiv(order.price * (order.qty - order.filled), this.one);
    if (order.locked > need) {
      const extra = order.locked - need;
      const b = this._acct(order.acct)[this.quote];
      b.locked -= extra;
      b.free += extra;
      order.locked = need;
    }
  }

  // ---- tilauskirja ----
  _levels(side) {
    return side === "buy" ? this.bids : this.asks;
  }
  _better(side, a, b) {
    return side === "buy" ? a > b : a < b;
  }
  _rest(order) {
    const levels = this._levels(order.side);
    let i = 0;
    while (i < levels.length && this._better(order.side, levels[i].price, order.price)) i++;
    if (i < levels.length && levels[i].price === order.price) levels[i].orders.push(order);
    else levels.splice(i, 0, { price: order.price, orders: [order] });
  }
  _removeFromBook(order) {
    const levels = this._levels(order.side);
    const i = levels.findIndex((l) => l.price === order.price);
    if (i < 0) return;
    const idx = levels[i].orders.indexOf(order);
    if (idx >= 0) levels[i].orders.splice(idx, 1);
    if (levels[i].orders.length === 0) levels.splice(i, 1);
  }

  bestBid() {
    return this.bids.length ? this.bids[0].price : null;
  }
  bestAsk() {
    return this.asks.length ? this.asks[0].price : null;
  }

  getBook(depth = 10) {
    const agg = (levels) =>
      levels.slice(0, depth).map((l) => ({
        price: l.price,
        qty: l.orders.reduce((s, o) => s + (o.qty - o.filled), 0n),
        count: l.orders.length,
      }));
    return { bids: agg(this.bids), asks: agg(this.asks) };
  }

  openOrders(acct) {
    return [...this.orders.values()].filter((o) => o.acct === acct && o.status === "open");
  }

  // ---- tilaukset ----
  /**
   * placeOrder({ acct, side: 'buy'|'sell', type: 'limit'|'market', price, qty, quoteBudget })
   * limit: price ja qty pakolliset. market sell: qty. market buy: quoteBudget (käytettävä summa).
   * Palauttaa { order, trades }.
   */
  placeOrder({ acct, side, type, price, qty, quoteBudget }) {
    if (side !== "buy" && side !== "sell") throw new ExchangeError("bad_side", "Puoli on buy tai sell");
    if (type !== "limit" && type !== "market") throw new ExchangeError("bad_type", "Tyyppi on limit tai market");
    const marketBuy = type === "market" && side === "buy";
    if (marketBuy) {
      quoteBudget = BigInt(quoteBudget ?? 0n);
      if (quoteBudget <= 0n) throw new ExchangeError("bad_amount", "Markkinaostoon tarvitaan käytettävä summa");
    } else {
      qty = BigInt(qty ?? 0n);
      if (qty <= 0n || qty % this.lot !== 0n) throw new ExchangeError("bad_qty", "Virheellinen määrä");
    }
    if (type === "limit") {
      price = BigInt(price ?? 0n);
      if (price <= 0n || price % this.tick !== 0n) throw new ExchangeError("bad_price", "Virheellinen hinta");
    } else price = null;

    if (type === "limit" && (price * qty) / this.one < this.minNotional)
      throw new ExchangeError("too_small", "Tilaus on liian pieni");
    if (marketBuy && quoteBudget < this.minNotional) throw new ExchangeError("too_small", "Tilaus on liian pieni");

    const order = {
      id: ++this.seq,
      acct,
      side,
      type,
      price,
      qty: marketBuy ? 0n : qty,
      filled: 0n,
      status: "open",
      locked: 0n,
      spent: 0n,
    };

    // varojen lukitus
    if (marketBuy) {
      this._lock(acct, this.quote, quoteBudget);
      order.locked = quoteBudget;
    } else if (side === "buy") {
      const need = ceilDiv(price * qty, this.one);
      this._lock(acct, this.quote, need);
      order.locked = need;
    } else {
      this._lock(acct, this.base, qty);
      order.locked = qty;
    }

    this.orders.set(order.id, order);
    const trades = this._match(order);

    if (type === "limit") {
      if (order.filled < order.qty) this._rest(order);
      else {
        order.status = "filled";
        this._release(order);
      }
    } else {
      // markkinatilaus ei koskaan jää kirjaan
      const fully = !marketBuy && order.filled === order.qty;
      order.status = fully ? "filled" : order.filled > 0n ? "partial_cancelled" : "cancelled";
      this._release(order);
    }
    this._emit({ type: "order", order: { ...order } });
    return { order: { ...order }, trades };
  }

  _match(taker) {
    const trades = [];
    const oppSide = taker.side === "buy" ? "sell" : "buy";
    const levels = this._levels(oppSide);
    const marketBuy = taker.type === "market" && taker.side === "buy";

    outer: while (levels.length) {
      const level = levels[0];
      if (taker.type === "limit") {
        const crosses = taker.side === "buy" ? level.price <= taker.price : level.price >= taker.price;
        if (!crosses) break;
      }
      while (level.orders.length) {
        const maker = level.orders[0];
        if (maker.acct === taker.acct) {
          // oman tilauksen kanssa ei käydä kauppaa: lepäävä tilaus perutaan
          level.orders.shift();
          maker.status = "cancelled";
          this._release(maker);
          this._emit({ type: "order", order: { ...maker }, reason: "self_trade" });
          continue;
        }
        const execPrice = maker.price;
        const makerRem = maker.qty - maker.filled;
        let fillQty;
        if (marketBuy) {
          const byBudget = (taker.locked * this.one) / execPrice;
          const lotted = byBudget - (byBudget % this.lot);
          fillQty = makerRem < lotted ? makerRem : lotted;
          if (fillQty <= 0n) break outer;
        } else {
          const takerRem = taker.qty - taker.filled;
          fillQty = makerRem < takerRem ? makerRem : takerRem;
        }
        const quoteAmt = (execPrice * fillQty) / this.one;
        // markkinaosto ei saa saada pölymääriä ilmaiseksi (pyöristys alaspäin antaisi 0 hinnan)
        if (marketBuy && quoteAmt <= 0n) break outer;

        const buyer = taker.side === "buy" ? taker : maker;
        const seller = taker.side === "buy" ? maker : taker;
        const buyerFeeBps = buyer === taker ? this.takerFeeBps : this.makerFeeBps;
        const sellerFeeBps = seller === taker ? this.takerFeeBps : this.makerFeeBps;

        // ostaja: maksaa quotea (lukitusta), saa basea miinus palkkio
        buyer.locked -= quoteAmt;
        buyer.spent += quoteAmt;
        this._spendLocked(buyer.acct, this.quote, quoteAmt);
        const feeBase = ceilDiv(fillQty * buyerFeeBps, 10000n);
        this._credit(buyer.acct, this.base, fillQty - feeBase);
        this._credit(this.feeAccount, this.base, feeBase);

        // myyjä: luovuttaa basea (lukitusta), saa quotea miinus palkkio
        seller.locked -= fillQty;
        this._spendLocked(seller.acct, this.base, fillQty);
        let feeQuote = ceilDiv(quoteAmt * sellerFeeBps, 10000n);
        if (feeQuote > quoteAmt) feeQuote = quoteAmt;
        this._credit(seller.acct, this.quote, quoteAmt - feeQuote);
        this._credit(this.feeAccount, this.quote, feeQuote);

        taker.filled += fillQty;
        maker.filled += fillQty;
        const trade = {
          id: ++this.seq,
          price: execPrice,
          qty: fillQty,
          quoteAmt,
          takerSide: taker.side,
          takerOrder: taker.id,
          makerOrder: maker.id,
          taker: taker.acct,
          maker: maker.acct,
        };
        trades.push(trade);
        this.trades.push(trade);
        if (this.trades.length > 5000) this.trades.shift();
        this.lastPrice = execPrice;
        this._emit({ type: "trade", trade });

        this._trimLock(taker);
        this._trimLock(maker);

        if (maker.filled === maker.qty) {
          level.orders.shift();
          maker.status = "filled";
          this._release(maker);
          this._emit({ type: "order", order: { ...maker } });
        }
        if (!marketBuy && taker.filled === taker.qty) break outer;
      }
      if (level.orders.length === 0) levels.shift();
    }
    if (levels.length && levels[0].orders.length === 0) levels.shift();
    return trades;
  }

  cancelOrder(id, acct) {
    const order = this.orders.get(BigInt(id));
    if (!order || order.acct !== acct) throw new ExchangeError("not_found", "Tilausta ei löydy");
    if (order.status !== "open") throw new ExchangeError("not_open", "Tilaus ei ole enää auki");
    this._removeFromBook(order);
    order.status = "cancelled";
    this._release(order);
    this._emit({ type: "order", order: { ...order } });
    return { ...order };
  }
}
