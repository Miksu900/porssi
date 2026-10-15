// SVG-kaaviot opetussivuille (build-aikaan). Data on keksittyä.
import { sma, rsiAt } from "./backtest.mjs";

const W = 640, H = 240, PAD = 6;

function pathOf(vals, x, y) {
  let d = "", open = false;
  vals.forEach((v, i) => {
    if (v === null || v === undefined) { open = false; return; }
    d += (open ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1);
    open = true;
  });
  return d;
}

/**
 * chart(prices, { marks, overlays:[{label,values,cls}], levels:[{v,label}], rsi: n })
 */
export function chart(prices, { marks = [], overlays = [], levels = [], rsi = 0, vols = null, caption = "" } = {}) {
  const n = prices.length;
  const all = [...prices, ...overlays.flatMap((o) => o.values.filter((v) => v != null)), ...levels.map((l) => l.v)];
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.06 || 1;
  const priceH = rsi ? H * 0.68 : vols ? H * 0.74 : H;
  const x = (i) => PAD + (i / (n - 1)) * (W - 2 * PAD);
  const y = (v) => PAD + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (priceH - 2 * PAD);
  let s = `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${caption.replace(/"/g, "&quot;")}">`;
  for (let k = 0; k <= 3; k++) {
    const yy = PAD + (k / 3) * (priceH - 2 * PAD);
    s += `<line class="grid" x1="0" x2="${W}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"/>`;
  }
  for (const l of levels) {
    s += `<line class="lvl" x1="0" x2="${W}" y1="${y(l.v).toFixed(1)}" y2="${y(l.v).toFixed(1)}"/><text class="lt" x="4" y="${(y(l.v) - 4).toFixed(1)}">${l.label}</text>`;
  }
  s += `<path class="ln-p" d="${pathOf(prices, x, y)}"/>`;
  for (const o of overlays) s += `<path class="${o.cls}" d="${pathOf(o.values, x, y)}"/>`;
  for (const m of marks) {
    const cx = x(m.i).toFixed(1), cy = y(prices[m.i]).toFixed(1);
    s += m.type === "buy"
      ? `<path class="mk-buy" d="M${cx} ${cy} l-6 11 h12 z"/>`
      : `<path class="mk-sell" d="M${cx} ${cy} l-6 -11 h12 z"/>`;
  }
  if (rsi) {
    const top = priceH + 10, h = H - top - 4;
    const ry = (v) => top + (1 - v / 100) * h;
    s += `<line class="lvl" x1="0" x2="${W}" y1="${ry(70).toFixed(1)}" y2="${ry(70).toFixed(1)}"/><line class="lvl" x1="0" x2="${W}" y1="${ry(30).toFixed(1)}" y2="${ry(30).toFixed(1)}"/>`;
    const rv = prices.map((_, i) => rsiAt(prices, i, rsi));
    s += `<path class="ln-a" d="${pathOf(rv, x, ry)}"/><text class="lt" x="4" y="${(ry(70) - 3).toFixed(1)}">RSI 70</text><text class="lt" x="4" y="${(ry(30) + 11).toFixed(1)}">RSI 30</text>`;
  }
  if (vols) {
    const top = priceH + 8, h = H - top - 2, vmax = Math.max(...vols);
    const bw = Math.max(1, (W - 2 * PAD) / n - 0.6);
    vols.forEach((v, i) => { const bh = (v / vmax) * h; s += `<rect class="vb" x="${(x(i) - bw / 2).toFixed(1)}" y="${(top + h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}"/>`; });
  }
  s += `</svg><figcaption>${caption}</figcaption></figure>`;
  return s;
}

export const overlaySma = (prices, n, cls, label) => ({ label, cls, values: prices.map((_, i) => sma(prices, i, n)) });
export const overlayBand = (prices, n, f, cls, label) => ({ label, cls, values: prices.map((_, i) => { const m = sma(prices, i, n); return m === null ? null : m * f; }) });
export const overlayHigh = (prices, n, cls, label) => ({ label, cls, values: prices.map((_, i) => (i < n ? null : Math.max(...prices.slice(i - n, i)))) });
