// Valmentaja: seuraa käyttäjän omia kauppoja, suunnitelmia ja antaa palautetta. Ei tee kauppoja käyttäjän puolesta.

export const REASONS = {
  trend: "Trendin seuraaminen",
  meanrev: "Keskiarvoon palautuminen",
  breakout: "Läpimurto",
  other: "Muu syy",
};

export function createCoach({ startValue, startPrice, startBtc }) {
  const positions = []; // avoimet ostot (FIFO)
  const closed = []; // suljetut osat
  let planned = 0, entries = 0;

  /** Ostettu qty BTC (luku) keskihintaan price. plan: { why, stop, target }. */
  function onBuy(qty, price, plan = {}) {
    entries++;
    if (plan.stop) planned++;
    positions.push({ qty, entry: price, why: plan.why || null, stop: plan.stop || null, target: plan.target || null });
  }

  /** Myyty qty BTC keskihintaan price. Sulkee vanhimmat positiot ensin. */
  function onSell(qty, price) {
    let left = qty;
    while (left > 1e-12 && positions.length) {
      const p = positions[0];
      const q = Math.min(p.qty, left);
      closed.push({ qty: q, entry: p.entry, exit: price, pnl: q * (price - p.entry), why: p.why, hadStop: !!p.stop });
      p.qty -= q;
      left -= q;
      if (p.qty <= 1e-12) positions.shift();
    }
  }

  function alerts(price) {
    const out = [];
    for (const p of positions) {
      if (p.stop && price <= p.stop) out.push(`Tappioraja ${p.stop.toFixed(0)} € saavutettu. Päätä itse: myytkö vai muutatko suunnitelmaa?`);
      else if (p.target && price >= p.target) out.push(`Tavoite ${p.target.toFixed(0)} € saavutettu. Päätä itse: otatko voitot?`);
    }
    return out;
  }

  function stats(price, totalValue) {
    const wins = closed.filter((c) => c.pnl > 0).length;
    const realized = closed.reduce((s, c) => s + c.pnl, 0);
    return {
      entries,
      planned,
      closedCount: closed.length,
      wins,
      winRate: closed.length ? wins / closed.length : null,
      realized,
      you: totalValue - startValue,
      hold: startBtc * (price - startPrice),
    };
  }

  /** Riski prosentteina salkusta: (sisäänmeno - tappioraja) * määrä / salkun arvo. */
  function riskPct(qty, entry, stop, totalValue) {
    if (!stop || !(entry > stop) || !(totalValue > 0)) return null;
    return ((entry - stop) * qty) / totalValue * 100;
  }

  const risks = [];
  function recordRisk(r) {
    if (r !== null) risks.push(r);
  }

  function exercises(price, totalValue) {
    const s = stats(price, totalValue);
    return [
      { text: "Tee kauppa suunnitelmalla (syy ja tappioraja)", done: planned >= 1 },
      { text: "Aseta tappioraja kolmeen ostoon", done: planned >= 3 },
      { text: "Pidä riski alle 2 % salkusta kaikissa suunnitelluissa kaupoissa", done: risks.length >= 1 && risks.every((r) => r <= 2) },
      { text: "Sulje vähintään kolme positiota", done: closed.length >= 3 },
      { text: "Päihitä 'osta ja pidä' -vertailu", done: closed.length >= 1 && s.you > s.hold },
    ];
  }

  return { onBuy, onSell, alerts, stats, riskPct, recordRisk, exercises, positions, closed };
}
