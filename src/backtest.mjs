// Yksinkertainen takautuva testaus opetuskäyttöön. Keksityllä datalla ei todisteta mitään oikeista markkinoista.
// Long-only: salkku on joko kokonaan rahassa tai kokonaan omaisuudessa. Palkkio per kauppa (oletus 0,05 %).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Keksityt hintasarjat eri markkinatilanteisiin. Palauttaa { p: hinnat, v: volyymit }. */
export function scenario(name, n = 300, seed = 1) {
  const r = mulberry32(seed);
  const noise = () => (r() + r() + r() - 1.5) / 1.5; // suunnilleen normaali, -1..1
  let p = 100;
  const prices = [], vols = [];
  for (let i = 0; i < n; i++) {
    const x = i / n;
    let drift = 0, vol = 0.02, vm = 1;
    if (name === "nousu") { drift = 0.0016; }
    else if (name === "lasku") { drift = -0.0016; }
    else if (name === "sivuttain") { drift = ((100 - p) / 100) * 0.05; }
    else if (name === "lapimurto") { if (x < 0.55) { drift = ((100 - p) / 100) * 0.08; vol = 0.01; vm = 0.6; } else if (x < 0.7) { drift = 0.012; vol = 0.02; vm = 2.2; } else { drift = 0.0006; vm = 1.1; } }
    else if (name === "romahdus") { if (x < 0.4) drift = 0.002; else if (x < 0.55) { drift = -0.02; vol = 0.03; vm = 2.5; } else { drift = 0.0015; vol = 0.02; } }
    p = Math.max(1, p * (1 + drift + vol * noise()));
    prices.push(p);
    vols.push(Math.max(0.1, vm * (0.6 + r() * 0.8)));
  }
  return { p: prices, v: vols };
}
export const SCENARIOS = { nousu: "Nouseva markkina", lasku: "Laskeva markkina", sivuttain: "Sivuttaismarkkina", lapimurto: "Pitkä tasainen jakso ja läpimurto", romahdus: "Nousu, romahdus ja toipuminen" };

export const sma = (a, i, n) => {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += a[k];
  return s / n;
};
export function rsiAt(a, i, n) {
  if (i < n) return null;
  let up = 0, down = 0;
  for (let k = i - n + 1; k <= i; k++) {
    const d = a[k] - a[k - 1];
    if (d > 0) up += d; else down -= d;
  }
  if (down === 0) return up === 0 ? 50 : 100;
  return 100 - 100 / (1 + up / down);
}

/** Strategiat palauttavat jokaiselle indeksille: true = omistaa, false = rahassa, null = ei muutosta. */
export const STRATS = {
  hold: { name: "Osta ja pidä", f: () => (i) => true },
  ma: {
    name: "MA-leikkaus (10/40)",
    f: (p) => (i) => { const a = sma(p, i, 10), b = sma(p, i, 40); return a === null || b === null ? null : a > b; },
  },
  meanrev: {
    name: "Keskiarvoon palautuminen",
    f: (p) => {
      let pos = false;
      return (i) => {
        const m = sma(p, i, 20);
        if (m === null) return null;
        if (!pos && p[i] <= m * 0.98) pos = true;
        else if (pos && p[i] >= m) pos = false;
        return pos;
      };
    },
  },
  breakout: {
    name: "Läpimurto (30)",
    f: (p) => {
      let pos = false;
      return (i) => {
        if (i < 30) return null;
        const w = p.slice(i - 30, i);
        if (!pos && p[i] > Math.max(...w)) pos = true;
        else if (pos && p[i] < Math.min(...p.slice(i - 15, i))) pos = false;
        return pos;
      };
    },
  },
  rsi: {
    name: "RSI (14, 30/70)",
    f: (p) => {
      let pos = false;
      return (i) => {
        const r = rsiAt(p, i, 14);
        if (r === null) return null;
        if (!pos && r < 30) pos = true;
        else if (pos && r > 70) pos = false;
        return pos;
      };
    },
  },
  combo: {
    name: "Yhdistelmä: trendisuodatin + RSI-lasku",
    f: (p) => {
      let pos = false;
      return (i) => {
        const t = sma(p, i, 50), r = rsiAt(p, i, 14);
        if (t === null || r === null) return null;
        if (!pos && p[i] > t && r < 45) pos = true;
        else if (pos && (r > 60 || p[i] < t * 0.97)) pos = false;
        return pos;
      };
    },
  },
};

export function backtest(prices, strat, fee = 0.0005) {
  const sig = strat(prices);
  let cash = 1, units = 0, pos = false, trades = 0, peak = 1, maxDD = 0;
  const equity = [], marks = [];
  for (let i = 0; i < prices.length; i++) {
    const s = sig(i);
    if (s === true && !pos) { units = (cash * (1 - fee)) / prices[i]; cash = 0; pos = true; trades++; marks.push({ i, type: "buy" }); }
    else if (s === false && pos) { cash = units * prices[i] * (1 - fee); units = 0; pos = false; trades++; marks.push({ i, type: "sell" }); }
    const eq = pos ? units * prices[i] : cash;
    equity.push(eq);
    if (eq > peak) peak = eq;
    maxDD = Math.max(maxDD, (peak - eq) / peak);
  }
  return { ret: (equity.at(-1) - 1) * 100, trades, maxDD: maxDD * 100, equity, marks };
}

/** Efektiivisuussuhde: nettoliike / kokonaisliike. Lähellä 1 = selkeä trendi, lähellä 0 = sivuttais. */
export function efficiencyRatio(p, n) {
  const out = [];
  for (let i = 0; i < p.length; i++) {
    if (i < n) { out.push(null); continue; }
    let path = 0;
    for (let k = i - n + 1; k <= i; k++) path += Math.abs(p[k] - p[k - 1]);
    out.push(path === 0 ? 0 : Math.abs(p[i] - p[i - n]) / path);
  }
  return out;
}
