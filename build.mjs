import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("site", "dist", { recursive: true });
cpSync("src/engine.mjs", "dist/engine.mjs");
cpSync("src/bots.mjs", "dist/bots.mjs");
cpSync("src/autopilot.mjs", "dist/autopilot.mjs");

const lessons = JSON.parse(readFileSync("site/opeta/oppitunnit.json", "utf8"));
const nav = (root) => `<nav class="top"><a class="brand" href="${root}">Demopörssi</a><div><a href="${root}">Etusivu</a><a href="${root}kauppa/">Kauppa</a><a href="${root}opeta/" class="cur">Opeta</a><a href="${root}#palkkiot">Palkkiot</a><a href="${root}#tietoa">Tietoa</a></div></nav>`;
const head = (root, title, desc) => `<!doctype html><html lang="fi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="stylesheet" href="${root}style.css"></head><body class="site"><div class="demo">DEMO – ei oikeaa rahaa, ei oikeita kauppoja</div>${nav(root)}`;
const disc = `<p class="notice">Tämä on opetusta, ei sijoitusneuvontaa. Esimerkit ovat yleisiä eivätkä suosituksia ostaa tai myydä mitään. Kryptovaluuttoihin liittyy suuri riski, ja sijoituksen voi menettää kokonaan.</p>`;

writeFileSync("dist/opeta/index.html", head("../", "Opeta – Demopörssi", "Opetusta kaupankäynnin perusteista ja strategioista.") +
`<section class="wrap block"><h1 class="h1">Opeta</h1><p class="lead">Lyhyitä oppitunteja kaupankäynnin perusteista ja eri strategioista. Jokaisen jälkeen voit kokeilla asiaa demossa valerahalla.</p>${disc}
<div class="cols">${lessons.map((l, i) => `<a class="card lesson" href="${l.slug}/"><span class="sub">Oppitunti ${i + 1}</span><h3>${esc(l.title)}</h3><p>${esc(l.lead)}</p></a>`).join("")}</div></section></body></html>`);

lessons.forEach((l, i) => {
  mkdirSync(`dist/opeta/${l.slug}`, { recursive: true });
  const prev = lessons[i - 1], next = lessons[i + 1];
  writeFileSync(`dist/opeta/${l.slug}/index.html`, head("../../", l.title + " – Demopörssi", l.lead) +
`<article class="wrap block read"><p class="sub"><a href="../">← Kaikki oppitunnit</a> · Oppitunti ${i + 1}/${lessons.length}</p><h1 class="h1">${esc(l.title)}</h1><p class="lead">${esc(l.lead)}</p>
${l.sections.map((s) => `<h2>${esc(s.h)}</h2>${s.p.map((p) => `<p>${esc(p)}</p>`).join("")}`).join("")}
<div class="card try"><h3>Kokeile demossa</h3><p>${esc(l.kokeile)}</p><a class="btn" href="../../kauppa/">Avaa kauppa</a></div>
<h2>Muista</h2><ul>${l.avain.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>${disc}
<div class="pager">${prev ? `<a href="../${prev.slug}/">← ${esc(prev.title)}</a>` : "<span></span>"}${next ? `<a href="../${next.slug}/">${esc(next.title)} →</a>` : "<span></span>"}</div></article></body></html>`);
});
console.log("dist valmis,", lessons.length, "oppituntia");
