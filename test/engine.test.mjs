import { test } from "node:test";
import assert from "node:assert/strict";
import { Exchange, ExchangeError, toUnits, fmtUnits } from "../src/engine.mjs";

const BTC = (s) => toUnits(s, 8);
const EUR = (s) => toUnits(s, 2);
const mk = (o = {}) => new Exchange({ makerFeeBps: 0n, takerFeeBps: 0n, ...o });
const fund = (ex, a, eur = "100000", btc = "10") => {
  ex.deposit(a, "EUR", EUR(eur));
  ex.deposit(a, "BTC", BTC(btc));
};

test("toUnits / fmtUnits", () => {
  assert.equal(BTC("0.5"), 50000000n);
  assert.equal(fmtUnits(50000000n, 8, 2), "0.50");
  assert.equal(fmtUnits(5n, 8), "0.00000005");
  assert.throws(() => toUnits("0.123", 2), ExchangeError);
  assert.throws(() => toUnits("abc", 2), ExchangeError);
});

test("täysi täsmäys maker-hinnalla", () => {
  const ex = mk();
  fund(ex, "a");
  fund(ex, "b");
  ex.placeOrder({ acct: "a", side: "sell", type: "limit", price: EUR("100"), qty: BTC("1") });
  const r = ex.placeOrder({ acct: "b", side: "buy", type: "limit", price: EUR("110"), qty: BTC("1") });
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].price, EUR("100"));
  assert.equal(r.order.status, "filled");
  const b = ex.balances("b");
  assert.equal(b.EUR.free, EUR("100000") - EUR("100"));
  assert.equal(b.EUR.locked, 0n);
  assert.equal(b.BTC.free, BTC("11"));
  assert.equal(ex.bestAsk(), null);
});

test("osittaistäyttö jättää loput kirjaan", () => {
  const ex = mk();
  fund(ex, "a");
  fund(ex, "b");
  ex.placeOrder({ acct: "a", side: "sell", type: "limit", price: EUR("100"), qty: BTC("1") });
  const r = ex.placeOrder({ acct: "b", side: "buy", type: "limit", price: EUR("100"), qty: BTC("3") });
  assert.equal(r.order.filled, BTC("1"));
  assert.equal(r.order.status, "open");
  assert.equal(ex.bestBid(), EUR("100"));
  assert.equal(ex.balances("b").EUR.locked, EUR("200"));
});

test("hinta-aikajärjestys", () => {
  const ex = mk();
  for (const a of ["a", "b", "c"]) fund(ex, a);
  ex.placeOrder({ acct: "a", side: "sell", type: "limit", price: EUR("101"), qty: BTC("1") });
  ex.placeOrder({ acct: "b", side: "sell", type: "limit", price: EUR("100"), qty: BTC("1") });
  ex.placeOrder({ acct: "a", side: "sell", type: "limit", price: EUR("100"), qty: BTC("1") });
  const r = ex.placeOrder({ acct: "c", side: "buy", type: "limit", price: EUR("101"), qty: BTC("2") });
  assert.deepEqual(r.trades.map((t) => [t.maker, t.price]), [["b", EUR("100")], ["a", EUR("100")]]);
  assert.equal(ex.bestAsk(), EUR("101"));
});

test("hintaparannus palautetaan vapaaksi", () => {
  const ex = mk();
  fund(ex, "a");
  fund(ex, "b");
  ex.placeOrder({ acct: "a", side: "sell", type: "limit", price: EUR("90"), qty: BTC("1") });
  ex.placeOrder({ acct: "b", side: "buy", type: "limit", price: EUR("100"), qty: BTC("1") });
  const b = ex.balances("b");
  assert.equal(b.EUR.locked, 0n);
  assert.equal(b.EUR.free, EUR("100000") - EUR("90"));
});

test("markkinaosto käyttää budjetin ja palauttaa loput", () => {
  const ex = mk();
  fund(ex, "a");
  fund(ex, "b");
  ex.placeOrder({ acct: "a", side: "sell", type: "limit", price: EUR("100"), qty: BTC("1") });
  ex.placeOrder({ acct: "a", side: "sell", type: "limit", price: EUR("200"), qty: BTC("1") });
  const r = ex.placeOrder({ acct: "b", side: "buy", type: "market", quoteBudget: EUR("150") });
  assert.equal(r.trades.length, 2);
  assert.equal(r.trades[0].qty, BTC("1"));
  assert.equal(r.trades[1].qty, BTC("0.25"));
  const b = ex.balances("b");
  assert.equal(b.EUR.locked, 0n);
  assert.equal(b.EUR.free, EUR("100000") - EUR("150"));
  assert.equal(b.BTC.free, BTC("11.25"));
  assert.notEqual(r.order.status, "open");
});

test("markkinamyynti ilman ostajia peruuntuu", () => {
  const ex = mk();
  fund(ex, "a");
  const r = ex.placeOrder({ acct: "a", side: "sell", type: "market", qty: BTC("1") });
  assert.equal(r.trades.length, 0);
  assert.equal(r.order.status, "cancelled");
  assert.equal(ex.balances("a").BTC.locked, 0n);
});

test("markkinamyynti osittain", () => {
  const ex = mk();
  fund(ex, "a");
  fund(ex, "b");
  ex.placeOrder({ acct: "a", side: "buy", type: "limit", price: EUR("100"), qty: BTC("1") });
  const r = ex.placeOrder({ acct: "b", side: "sell", type: "market", qty: BTC("3") });
  assert.equal(r.order.filled, BTC("1"));
  assert.equal(r.order.status, "partial_cancelled");
  assert.equal(ex.balances("b").BTC.locked, 0n);
  assert.equal(ex.balances("b").BTC.free, BTC("9"));
});

test("peruutus vapauttaa varat", () => {
  const ex = mk();
  fund(ex, "a");
  const { order } = ex.placeOrder({ acct: "a", side: "buy", type: "limit", price: EUR("100"), qty: BTC("2") });
  assert.equal(ex.balances("a").EUR.locked, EUR("200"));
  ex.cancelOrder(order.id, "a");
  assert.equal(ex.balances("a").EUR.locked, 0n);
  assert.equal(ex.bestBid(), null);
  assert.throws(() => ex.cancelOrder(order.id, "a"), /ei ole enää auki/);
  assert.throws(() => ex.cancelOrder(order.id, "x"), ExchangeError);
});

test("riittämätön saldo hylätään eikä muuta mitään", () => {
  const ex = mk();
  fund(ex, "a", "10", "0.1");
  assert.throws(
    () => ex.placeOrder({ acct: "a", side: "buy", type: "limit", price: EUR("100"), qty: BTC("1") }),
    (e) => e.code === "insufficient_funds"
  );
  assert.throws(
    () => ex.placeOrder({ acct: "a", side: "sell", type: "limit", price: EUR("100"), qty: BTC("1") }),
    (e) => e.code === "insufficient_funds"
  );
  assert.equal(ex.balances("a").EUR.free, EUR("10"));
  assert.equal(ex.bids.length + ex.asks.length, 0);
});

test("virheelliset syötteet", () => {
  const ex = mk();
  fund(ex, "a");
  const bad = (o) => assert.throws(() => ex.placeOrder({ acct: "a", ...o }), ExchangeError);
  bad({ side: "x", type: "limit", price: 1n, qty: 1n });
  bad({ side: "buy", type: "stop", price: 1n, qty: 1n });
  bad({ side: "buy", type: "limit", price: 0n, qty: 1n });
  bad({ side: "buy", type: "limit", price: 1n, qty: 0n });
  bad({ side: "buy", type: "market", quoteBudget: 0n });
});

test("oma tilaus ei täsmää itsensä kanssa", () => {
  const ex = mk();
  fund(ex, "a");
  ex.placeOrder({ acct: "a", side: "sell", type: "limit", price: EUR("100"), qty: BTC("1") });
  const r = ex.placeOrder({ acct: "a", side: "buy", type: "limit", price: EUR("100"), qty: BTC("1") });
  assert.equal(r.trades.length, 0);
  assert.equal(ex.bestAsk(), null);
  assert.equal(ex.bestBid(), EUR("100"));
  assert.equal(ex.balances("a").BTC.locked, 0n);
});

test("palkkiot: ostaja maksaa basessa, myyjä quotessa, palkkiotili kerää", () => {
  const ex = new Exchange({ makerFeeBps: 10n, takerFeeBps: 20n });
  fund(ex, "a");
  fund(ex, "b");
  ex.placeOrder({ acct: "a", side: "sell", type: "limit", price: EUR("100"), qty: BTC("1") }); // maker
  ex.placeOrder({ acct: "b", side: "buy", type: "limit", price: EUR("100"), qty: BTC("1") }); // taker
  assert.equal(ex.balances("b").BTC.free, BTC("11") - BTC("0.002"));
  assert.equal(ex.balances("a").EUR.free, EUR("100000") + EUR("100") - EUR("0.10"));
  assert.equal(ex.balances("__fees__").BTC.free, BTC("0.002"));
  assert.equal(ex.balances("__fees__").EUR.free, EUR("0.10"));
});

test("fuzz: kokonaismäärä säilyy, kirja ei risteä, lukitukset täsmäävät", () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const ex = new Exchange({ makerFeeBps: 10n, takerFeeBps: 25n, lot: 1000n });
  const accts = ["a", "b", "c", "d", "e"];
  for (const a of accts) fund(ex, a, "1000000", "100");
  const sup0 = { EUR: ex.totalSupply("EUR"), BTC: ex.totalSupply("BTC") };
  const ids = [];
  for (let i = 0; i < 4000; i++) {
    const acct = accts[Math.floor(rnd() * accts.length)];
    const r = rnd();
    try {
      if (r < 0.15 && ids.length) {
        const [id, ac] = ids[Math.floor(rnd() * ids.length)];
        ex.cancelOrder(id, ac);
      } else {
        const side = rnd() < 0.5 ? "buy" : "sell";
        const price = BigInt(9000 + Math.floor(rnd() * 200)) * 100n + BigInt(Math.floor(rnd() * 100));
        const qty = BigInt(1 + Math.floor(rnd() * 300)) * 1000000n + BigInt(Math.floor(rnd() * 1000)) * 1000n;
        let o;
        if (r < 0.3) {
          o = side === "buy"
            ? { type: "market", quoteBudget: BigInt(Math.floor(rnd() * 500000)) + 1n }
            : { type: "market", qty };
        } else o = { type: "limit", price, qty };
        const res = ex.placeOrder({ acct, side, ...o });
        if (res.order.status === "open") ids.push([res.order.id, acct]);
      }
    } catch (e) {
      if (!(e instanceof ExchangeError)) throw e;
    }
    if (ex.bestBid() !== null && ex.bestAsk() !== null) assert.ok(ex.bestBid() < ex.bestAsk(), "kirja risteää");
  }
  assert.equal(ex.totalSupply("EUR"), sup0.EUR + 0n);
  assert.equal(ex.totalSupply("BTC"), sup0.BTC);
  // lukitut = avointen tilausten lukitusten summa
  for (const asset of ["EUR", "BTC"]) {
    let locked = 0n;
    for (const a of ex.accounts.values()) {
      assert.ok(a[asset].free >= 0n && a[asset].locked >= 0n);
      locked += a[asset].locked;
    }
    let inOrders = 0n;
    for (const o of ex.orders.values()) {
      assert.ok(o.locked >= 0n);
      if ((o.side === "buy") === (asset === "EUR")) inOrders += o.locked;
    }
    assert.equal(locked, inOrders, `lukitukset ${asset}`);
  }
  assert.ok(ex.trades.length > 100, "fuzz tuotti kauppoja");
});

test("robotit tuottavat kauppoja ja pitävät invariantit", async () => {
  const { createMarket } = await import("../src/bots.mjs");
  const ex = new Exchange();
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const m = createMarket(ex, { rnd });
  for (let i = 0; i < 200; i++) {
    m.tick();
    if (ex.bestBid() !== null && ex.bestAsk() !== null) assert.ok(ex.bestBid() < ex.bestAsk());
  }
  assert.ok(ex.trades.length > 50);
  assert.ok(ex.lastPrice > 0n);
});

test("pölyosto ei anna basea ilmaiseksi", () => {
  const ex = mk();
  fund(ex, "a");
  fund(ex, "b");
  ex.placeOrder({ acct: "a", side: "sell", type: "limit", price: EUR("60000"), qty: BTC("1") });
  assert.throws(() => ex.placeOrder({ acct: "b", side: "buy", type: "market", quoteBudget: 50n }), /liian pieni/);
  const before = ex.balances("b").BTC.free;
  ex.placeOrder({ acct: "b", side: "buy", type: "market", quoteBudget: EUR("1.5") });
  assert.ok(ex.balances("b").BTC.free - before <= BTC("0.00003"));
  assert.ok(ex.trades.length < 5);
});

test("autopilotti: säännöllinen osto ostaa välein ja kunnioittaa saldoa", async () => {
  const { createAutopilot } = await import("../src/autopilot.mjs");
  const ex = mk();
  fund(ex, "mm", "1000000", "100");
  ex.deposit("u", "EUR", EUR("300"));
  ex.placeOrder({ acct: "mm", side: "sell", type: "limit", price: EUR("100"), qty: BTC("50") });
  ex.placeOrder({ acct: "mm", side: "buy", type: "limit", price: EUR("99"), qty: BTC("1") });
  const ap = createAutopilot(ex, "u", "dca", { everyTicks: 2, euros: 100 });
  for (let i = 0; i < 20; i++) ap.tick();
  assert.equal(ex.balances("u").BTC.free, BTC("3")); // 3 × 100 € = 300 €, sitten saldo loppu
  assert.equal(ex.balances("u").EUR.free, 0n);
  assert.ok(ap.log.some((l) => l.includes("jäi väliin")));
});

test("autopilotti: hintarajat ostaa halvalla ja myy kalliilla", async () => {
  const { createAutopilot } = await import("../src/autopilot.mjs");
  const ex = mk();
  fund(ex, "mm", "1000000", "100");
  fund(ex, "u", "1000", "1");
  fund(ex, "t", "100000", "10");
  const post = (side, p) => ex.placeOrder({ acct: "mm", side, type: "limit", price: EUR(p), qty: BTC("10") });
  post("sell", "90"); post("buy", "89");
  ex.placeOrder({ acct: "t", side: "buy", type: "market", quoteBudget: EUR("1") }); // lastPrice 90
  const ap = createAutopilot(ex, "u", "range", { buyBelow: 95, sellAbove: 120, euros: 100, sellFraction: 0.5, cooldownTicks: 0 });
  ap.tick();
  assert.ok(ex.balances("u").BTC.free > BTC("1"));
  const before = ex.balances("u").BTC.free;
  ex.placeOrder({ acct: "mm", side: "buy", type: "limit", price: EUR("130"), qty: BTC("1") });
  ex.placeOrder({ acct: "t", side: "sell", type: "market", qty: BTC("0.5") }); // lastPrice 130
  ap.tick();
  assert.ok(ex.balances("u").BTC.free < before);
});

test("sma ja rsi", async () => {
  const { sma, rsi } = await import("../src/autopilot.mjs");
  assert.equal(sma([1, 2, 3, 4], 2), 3.5);
  assert.equal(sma([1], 2), null);
  assert.equal(rsi([1, 2, 3, 4, 5, 6], 5), 100);
  assert.equal(rsi([6, 5, 4, 3, 2, 1], 5), 0);
  assert.equal(Math.round(rsi([1, 2, 1, 2, 1, 2], 5)), 60);
});

test("autopilotti: MA-leikkaus ostaa nousussa ja myy laskussa", async () => {
  const { createAutopilot } = await import("../src/autopilot.mjs");
  const ex = mk();
  fund(ex, "mm", "10000000", "1000");
  fund(ex, "t", "10000000", "1000");
  fund(ex, "u", "10000", "5");
  const setPrice = (p) => {
    ex.placeOrder({ acct: "mm", side: "sell", type: "limit", price: EUR(p), qty: BTC("1") });
    ex.placeOrder({ acct: "t", side: "buy", type: "market", quoteBudget: EUR(p) });
  };
  setPrice(100);
  ex.placeOrder({ acct: "mm", side: "buy", type: "limit", price: EUR("50"), qty: BTC("3") });
  ex.placeOrder({ acct: "mm", side: "sell", type: "limit", price: EUR("500"), qty: BTC("5") });
  const ap = createAutopilot(ex, "u", "ma", { fast: 2, slow: 4, euros: 1000 });
  for (const p of [80, 85, 90, 95, 100, 105]) { setPrice(p); ap.tick(); } // nousu asettaa tilan
  for (const p of [100, 95, 90, 80, 70, 60]) { setPrice(p); ap.tick(); } // lasku → myynti
  assert.ok(ex.balances("u").BTC.free < BTC("5"), "myi laskussa");
  const btcAfterSell = ex.balances("u").BTC.free;
  for (const p of [65, 80, 100, 120, 140, 160]) { setPrice(p); ap.tick(); } // nousu → osto
  assert.ok(ex.balances("u").BTC.free > btcAfterSell, "osti nousussa");
});
