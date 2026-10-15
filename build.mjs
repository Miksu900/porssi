import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { scenario, SCENARIOS, STRATS, backtest, efficiencyRatio } from "./src/backtest.mjs";
import { chart, overlaySma, overlayBand, overlayHigh } from "./src/charts.mjs";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("site", "dist", { recursive: true });
rmSync("dist/opeta/oppitunnit.json");
cpSync("src/engine.mjs", "dist/engine.mjs");
cpSync("src/bots.mjs", "dist/bots.mjs");
cpSync("src/autopilot.mjs", "dist/autopilot.mjs");
cpSync("src/coach.mjs", "dist/coach.mjs");

const data = JSON.parse(readFileSync("site/opeta/oppitunnit.json", "utf8"));
const lessons = data.oppitunnit;
const sources = data.lahteet;
const nav = (root) => `<nav class="top"><a class="brand" href="${root}">Demopörssi</a><div><a href="${root}">Etusivu</a><a href="${root}kauppa/">Kauppa</a><a href="${root}opeta/" class="cur">Opeta</a><a href="${root}#palkkiot">Palkkiot</a><a href="${root}#tietoa">Tietoa</a></div></nav>`;
const head = (root, title, desc) => `<!doctype html><html lang="fi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="stylesheet" href="${root}style.css"></head><body class="site"><div class="demo">DEMO – ei oikeaa rahaa, ei oikeita kauppoja</div>${nav(root)}`;
// ---- laskettu data (keksitty, 30 satunnaissiementä per tilanne) ----
const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const cache = {};
function res(sk, strat) {
  const k = sk + "/" + strat;
  if (cache[k]) return cache[k];
  const rs = SEEDS.map((s) => backtest(scenario(sk, 300, s).p, STRATS[strat].f));
  return (cache[k] = { ret: mean(rs.map((r) => r.ret)), trades: mean(rs.map((r) => r.trades)), dd: mean(rs.map((r) => r.maxDD)) });
}
const pc = (v) => `<span class="${v >= 0.05 ? "pos" : v <= -0.05 ? "neg" : ""}">${(v >= 0 ? "+" : "") + v.toFixed(0).replace("-0", "0")} %</span>`;
const num = (v) => v.toFixed(0);
const DATA_NOTE = `<p class="sub">Taulukon luvut on laskettu keksityllä datalla (30 satunnaista hintasarjaa per markkinatilanne, 300 hintapistettä, palkkio 0,05 % per kauppa, vain osto ja myynti, ei vipua). Ne havainnollistavat strategioiden luonnetta eivätkä todista mitään oikeista markkinoista. Menneisyys ei takaa tulevaa.</p>`;

function stratTable(strat) {
  return `<h2 class="dh">Tulokset keksityssä datassa</h2><div class="tblwrap"><table class="dtable"><tr><th>Markkinatilanne</th><th>Tämä strategia</th><th>Osta ja pidä</th><th>Kauppoja</th><th>Pudotus (tämä / osta ja pidä)</th></tr>${Object.entries(SCENARIOS).map(([sk, sn]) => { const r = res(sk, strat), h = res(sk, "hold"); return `<tr><td>${sn}</td><td>${pc(r.ret)}</td><td>${pc(h.ret)}</td><td>${num(r.trades)}</td><td>${num(r.dd)} % / ${num(h.dd)} %</td></tr>`; }).join("")}</table></div>${DATA_NOTE}`;
}
function comboTable() {
  const keys = ["hold", "ma", "breakout", "rsi", "combo"];
  return `<h2 class="dh">Yhdistelmä verrattuna muihin</h2><div class="tblwrap"><table class="dtable"><tr><th>Markkinatilanne</th>${keys.map((k) => `<th>${STRATS[k].name}</th>`).join("")}</tr>${Object.entries(SCENARIOS).map(([sk, sn]) => `<tr><td>${sn}</td>${keys.map((k) => { const r = res(sk, k); return `<td>${pc(r.ret)}<br><span class="sub">pudotus ${num(r.dd)} %</span></td>`; }).join("")}</tr>`).join("")}</table></div>${DATA_NOTE}`;
}
function erTable() {
  const rows = Object.entries(SCENARIOS).map(([sk, sn]) => {
    const vals = SEEDS.map((s) => { const e = efficiencyRatio(scenario(sk, 300, s).p, 20).filter((x) => x !== null); return mean(e); });
    return `<tr><td>${sn}</td><td>${mean(vals).toFixed(2).replace(".", ",")}</td></tr>`;
  });
  return `<h2 class="dh">Efektiivisuussuhde keksityssä datassa</h2><div class="tblwrap"><table class="dtable"><tr><th>Markkinatilanne</th><th>Keskimääräinen suhde (20 pistettä)</th></tr>${rows.join("")}</table></div>${DATA_NOTE}`;
}
function feeTable() {
  const fees = [0.05, 0.1, 0.25, 0.5], counts = [4, 20, 100];
  return `<h2 class="dh">Palkkioiden osuus salkusta kuukaudessa</h2><div class="tblwrap"><table class="dtable"><tr><th>Palkkio per kauppa</th>${counts.map((c) => `<th>${c} kauppaa / kk</th>`).join("")}</tr>${fees.map((f) => `<tr><td>${String(f).replace(".", ",")} %</td>${counts.map((c) => `<td>${(f * c).toFixed(1).replace(".", ",")} %</td>`).join("")}</tr>`).join("")}</table></div><p class="sub">Laskelma olettaa, että jokainen kauppa käyttää koko salkun ja jokainen osto ja myynti lasketaan omaksi kaupakseen. Tarkoitus on havainnollistaa kulujen suuruusluokkaa.</p>`;
}
function riskTable() {
  const rs = [1, 2, 5, 10], ns = [5, 10, 20];
  return `<h2 class="dh">Salkun arvo peräkkäisten tappioiden jälkeen</h2><div class="tblwrap"><table class="dtable"><tr><th>Riski per kauppa</th>${ns.map((n) => `<th>${n} tappiota</th>`).join("")}</tr>${rs.map((r) => `<tr><td>${r} %</td>${ns.map((n) => `<td>${((1 - r / 100) ** n * 100).toFixed(0)} % jäljellä</td>`).join("")}</tr>`).join("")}</table></div><p class="sub">Laskelma olettaa, että jokaisessa tappiossa menetetään täsmälleen riskin verran jäljellä olevasta salkusta.</p>`;
}
function overlaysFor(names, p) {
  const m = { sma10: () => overlaySma(p, 10, "ln-a", "SMA 10"), sma40: () => overlaySma(p, 40, "ln-b", "SMA 40"), sma20: () => overlaySma(p, 20, "ln-a", "SMA 20"), band20: () => overlayBand(p, 20, 0.98, "ln-c", "−2 %"), high30: () => overlayHigh(p, 30, "ln-c", "30 pisteen yläraja") };
  return names.map((n) => m[n]());
}
function charts(l) {
  return (l.kaaviot || []).map((k) => {
    const d = scenario(k.scenario, 300, k.seed);
    const marks = l.strategia && l.strategia !== "hold" ? backtest(d.p, STRATS[l.strategia].f).marks : [];
    const levels = k.levels === "range" ? [{ v: Math.max(...d.p.slice(0, 165)), label: "alueen yläraja" }] : [];
    return chart(d.p, { marks, overlays: overlaysFor(k.overlays || [], d.p), levels, rsi: k.rsi || 0, vols: k.vol ? d.v : null, caption: k.caption + (marks.length ? " Vihreä kolmio = osto, punainen = myynti." : "") });
  }).join("");
}
function deep(l) {
  if (!l.syva) return "";
  return `<div class="deep"><h2 class="dh"><span class="badge${l.tier === "ilmainen" ? " free" : ""}">${l.tier === "ilmainen" ? "Ilmainen syväanalyysi" : "Syväanalyysi"}</span>${esc(l.title)}</h2>${charts(l)}${l.strategia ? stratTable(l.strategia) : ""}${l.er ? erTable() : ""}${l.combo ? comboTable() : ""}${l.kulut ? feeTable() : ""}${l.riski ? riskTable() : ""}${l.tier === "syva" ? TIERNOTE : ""}${l.syva.map((s) => `<h3>${esc(s.h)}</h3>${(s.p || []).map((p) => `<p>${esc(p)}</p>`).join("")}${s.ul ? `<ul>${s.ul.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>` : ""}`).join("")}${l.tier === "syva" ? interest(l.title) : ""}</div>`;
}

const CONTACT = "miika@eduskuntaseuranta.fi"; // vaihda tähän sivuston oma osoite, jos haluat
const FOOT = (root) => `<footer class="wrap"><p>Demopörssi on kehitysvaiheessa oleva harjoitusprojekti. Oikea kaupankäyntipalvelu vaatisi viranomaisluvan, jota tällä sivustolla ei ole.</p><p><a href="${root}yhteistyo/">Yhteistyö ja mainonta</a> · <a href="https://github.com/Miksu900/porssi">Lähdekoodi</a></p></footer>`;
const interest = (what) => `<form class="interest" onsubmit="return false"><label class="chk"><input type="checkbox" class="ik"> Haluan tiedon, kun maksullinen syväanalyysipaketti on valmis</label><a class="btn small ib" href="#" aria-disabled="true">Ilmoita kiinnostus</a><p class="sub">Painike avaa sähköpostin. Lähetät vain tämän viestin: "${what}". Mitään ei osteta eikä rekisteröidä.</p></form><script>(function(){var f=document.currentScript.previousElementSibling;var c=f.querySelector(".ik"),b=f.querySelector(".ib");function u(){b.href=c.checked?"mailto:${CONTACT}?subject="+encodeURIComponent("Kiinnostaa maksullinen syväanalyysipaketti")+"&body="+encodeURIComponent("Haluan tiedon, kun paketti on valmis. (${what})"):"#";b.setAttribute("aria-disabled",c.checked?"false":"true");}c.addEventListener("change",u);b.addEventListener("click",function(e){if(!c.checked){e.preventDefault();c.focus();}});u();})();</script>`;
const TIERNOTE = `<p class="sub tiernote">Tämä syväanalyysi on nyt avoinna kaikille. Osa syväanalyyseistä siirtyy myöhemmin maksullisiksi, ja perusoppitunnit, demo, robotit ja Valmentaja pysyvät ilmaisina.</p>`;

const disc = `<p class="notice">Tämä on opetusta, ei sijoitusneuvontaa. Esimerkit ovat yleisiä eivätkä suosituksia ostaa tai myydä mitään. Kryptovaluuttoihin liittyy suuri riski, ja sijoituksen voi menettää kokonaan.</p>`;

writeFileSync("dist/opeta/index.html", head("../", "Opeta – Demopörssi", "Opetusta kaupankäynnin perusteista ja strategioista.") +
`<section class="wrap block"><h1 class="h1">Opeta</h1><p class="lead">Lyhyitä oppitunteja kaupankäynnin perusteista ja eri strategioista. Jokaisen jälkeen voit kokeilla asiaa demossa valerahalla.</p>${disc}
<p><a class="btn" href="vertailu/">Strategiavertailu eri markkinatilanteissa</a></p><div class="cols">${lessons.map((l, i) => `<a class="card lesson" href="${l.slug}/"><span class="sub">Oppitunti ${i + 1}${l.tier === "ilmainen" ? " · ilmainen syväanalyysi" : l.tier === "syva" ? " · syväanalyysi" : ""}</span><h3>${esc(l.title)}</h3><p>${esc(l.lead)}</p></a>`).join("")}</div></section>${FOOT("../")}</body></html>`);

lessons.forEach((l, i) => {
  mkdirSync(`dist/opeta/${l.slug}`, { recursive: true });
  const prev = lessons[i - 1], next = lessons[i + 1];
  writeFileSync(`dist/opeta/${l.slug}/index.html`, head("../../", l.title + " – Demopörssi", l.lead) +
`<article class="wrap block read"><p class="sub"><a href="../">← Kaikki oppitunnit</a> · Oppitunti ${i + 1}/${lessons.length}</p><h1 class="h1">${esc(l.title)}</h1><p class="lead">${esc(l.lead)}</p>
${l.sections.map((s) => `<h2>${esc(s.h)}</h2>${s.p.map((p) => `<p>${esc(p)}</p>`).join("")}`).join("")}
<div class="card try"><h3>Kokeile demossa</h3><p>${esc(l.kokeile)}</p><a class="btn" href="../../kauppa/">Avaa kauppa</a></div>
${deep(l)}<h2>Muista</h2><ul>${l.avain.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>${(l.lahteet || []).length ? `<p class="sub">Lähteet: ${l.lahteet.map((k) => `<a href="${sources[k].u}">${esc(sources[k].t)}</a>`).join(", ")}</p>` : ""}${disc}
<div class="pager">${prev ? `<a href="../${prev.slug}/">← ${esc(prev.title)}</a>` : "<span></span>"}${next ? `<a href="../${next.slug}/">${esc(next.title)} →</a>` : "<span></span>"}</div></article>${FOOT("../../")}</body></html>`);
});
mkdirSync("dist/opeta/vertailu", { recursive: true });
const keys = Object.keys(STRATS);
const matrix = (title, f) => `<h2>${title}</h2><div class="tblwrap"><table class="dtable"><tr><th>Markkinatilanne</th>${keys.map((k) => `<th>${STRATS[k].name}</th>`).join("")}</tr>${Object.entries(SCENARIOS).map(([sk, sn]) => `<tr><td>${sn}</td>${keys.map((k) => `<td>${f(res(sk, k))}</td>`).join("")}</tr>`).join("")}</table></div>`;
writeFileSync("dist/opeta/vertailu/index.html", head("../../", "Strategiavertailu – Demopörssi", "Strategiat rinnakkain eri markkinatilanteissa keksityllä datalla.") +
`<article class="wrap block read"><p class="sub"><a href="../">← Kaikki oppitunnit</a></p><h1 class="h1">Strategiavertailu</h1><p class="lead">Kuusi strategiaa viidessä keksityssä markkinatilanteessa rinnakkain. Tarkoitus on nähdä, että mikään strategia ei toimi kaikkialla.</p>${disc}
${matrix("Tuotto", (r) => pc(r.ret))}${matrix("Suurin pudotus", (r) => num(r.dd) + " %")}${matrix("Kauppojen määrä", (r) => num(r.trades))}${DATA_NOTE}
<h2>Mikä sopii mihinkin?</h2>
<div class="tblwrap"><table class="dtable"><tr><th>Markkinatilanne</th><th>Usein sopii</th><th>Varo</th></tr>
<tr><td>Nouseva trendi</td><td>Osta ja pidä, trendinseuranta, läpimurto</td><td>RSI ja keskiarvoon palautuminen jättävät noususta suuren osan väliin</td></tr>
<tr><td>Laskeva trendi</td><td>Pysyä poissa markkinasta, trendinseurannan poistumissäännöt</td><td>Keskiarvoon palautuminen ja RSI ostavat putoavaa hintaa</td></tr>
<tr><td>Sivuttain</td><td>Keskiarvoon palautuminen, RSI</td><td>Trendinseuranta ja läpimurto tuottavat vääriä signaaleja ja palkkiokuluja</td></tr>
<tr><td>Läpimurto rauhallisen jakson jälkeen</td><td>Läpimurto, trendinseuranta</td><td>Varhainen palautumisstrategia voi ostaa liian aikaisin</td></tr>
<tr><td>Romahdus</td><td>Strategiat, joilla on poistumissääntö</td><td>Osta ja pidä ilman riskinhallintaa, palautumisstrategiat</td></tr></table></div>
<p class="sub">Taulukko on yleistys keksityn datan perusteella, ei sääntö. Oikea markkina voi käyttäytyä toisin.</p>
${interest("Strategiavertailu")}<h2>Miten tätä luetaan</h2><ul><li>Vertaa aina tuottoa ja suurinta pudotusta yhdessä: pieni tuotto pienellä pudotuksella voi olla parempi kuin suuri tuotto suurella pudotuksella.</li><li>Katso kauppojen määrää: paljon kauppoja tarkoittaa paljon palkkioita ja paljon päätöksiä.</li><li>Huomaa, että yksikään strategia ei voita kaikissa markkinatilanteissa. Siksi markkinatilan tunnistaminen ja strategioiden yhdistäminen ovat osa taitoa.</li></ul></article>${FOOT("../../")}</body></html>`);

mkdirSync("dist/yhteistyo", { recursive: true });
writeFileSync("dist/yhteistyo/index.html", head("../", "Yhteistyö ja mainonta – Demopörssi", "Miten sivustoa rahoitetaan ja miten yhteistyö merkitään.") +
`<article class="wrap prose"><h1>Yhteistyö ja mainonta</h1>
<p class="lead">Tämä sivusto on vielä pieni. Tähän on kirjattu etukäteen, miten yhteistyö hoidetaan, jotta lukija tietää aina, kuka sisällön takana on.</p>
<h2>Mitä pysyy ilmaisena</h2><ul><li>Perusoppitunnit ja strategioiden esittelyt</li><li>Demopörssi, robotit ja Valmentaja</li><li>Seitsemän ilmaista syväanalyysia</li></ul>
<h2>Mitä voi tulla maksulliseksi</h2><p>Osa syväanalyyseista (merkitty sivustolla) voi myöhemmin siirtyä maksulliseen pakettiin. Mitään maksua ei vielä ole, eikä sivustolla oteta vastaan maksuja. Kiinnostusta mitataan vapaaehtoisella sähköpostiviestillä.</p>
<h2>Säännöt yhteistyölle</h2><ul><li>Mainos ja yhteistyö merkitään aina selvästi sanalla "Mainos" tai "Yhteistyössä".</li><li>Oppitunteja ei kirjoiteta sponsorin ohjeilla, eikä sponsoroitua sisältöä esitetä neutraalina opetuksena.</li><li>Oppitunneissa ei ole kumppanilinkkejä eikä kehotuksia ostaa tiettyä kryptovarausta tai palvelua.</li><li>Sivusto ei anna sijoitusneuvontaa. Sisältö on opetusta, ja esimerkit käyttävät keksittyä dataa.</li><li>Kryptoalan mainontaa koskevat säännöt tarkistetaan ennen kuin yhtään sellaista mainosta julkaistaan.</li></ul>
<h2>Ota yhteyttä</h2><p><a href="mailto:${CONTACT}">${CONTACT}</a></p></article>${FOOT("../")}</body></html>`);
console.log("dist valmis,", lessons.length, "oppituntia");
