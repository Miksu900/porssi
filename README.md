# porssi
## Demopörssi (vaihe 1)

Selaimessa toimiva kryptopörssin demo **valerahalla**. Ei talletuksia, ei oikeita varoja, ei asiakasvaroja hallussa.

- `src/engine.mjs` – tilauskirja ja täsmäysmoottori (BigInt-kokonaisluvut, hinta-aikajärjestys, varojen lukitus, palkkiot, itsekaupan esto)
- `src/bots.mjs` – robotit, jotka luovat demomarkkinan
- `site/` – puhelinkäyttöliittymä
- `test/` – testit (`npm test`), mukana satunnaistesti, joka tarkistaa ettei rahaa synny tai katoa

Huom. oikea pörssi (oikeat talletukset) vaatisi kryptovarapalveluntarjoajan luvan (MiCA/CASP). Sitä ei ole, eikä tätä demoa saa markkinoida oikeana kaupankäyntinä.
