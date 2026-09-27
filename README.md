# Bridge Builder 3D

Een 3D bruggenbouw-spel in de browser (Three.js). Bouw een brug over de kloof,
blijf binnen het budget en kijk of het voertuig veilig aan de overkant komt.

## Starten

```bash
npm install
npm run dev      # ontwikkelserver op http://localhost:5173
npm run build    # productie-build in dist/
npm test         # headless fysica-checks (goede bruggen houden, slechte storten in)
```

## Besturing

| Actie | Invoer |
| --- | --- |
| Balk bouwen | Klik op een geel ankerpunt of knooppunt, klik daarna op het eindpunt (ketting gaat door) |
| Stoppen met bouwen | `Esc` of rechtsklik |
| Verwijderen | `Shift` + klik, of het gereedschap *Verwijderen* (`X`) |
| Materiaal kiezen | `1` Wegdek, `2` Hout, `3` Staal, `4` Kabel |
| Ongedaan maken / opnieuw | `Ctrl+Z` / `Ctrl+Y` |
| Testen / stoppen | `Spatie` |
| Camera | Rechtermuis draaien, middelste muis schuiven, scrollen zoomen (tijdens test: linkermuis draaien) |
| Slow-mo, belasting, volgen, vooraanzicht | `S`, `B`, `F`, `V` |

## Hoe het werkt

- **Fysica** (`src/sim.js`): de brug is een 2D-vakwerk dat met *small-step XPBD*
  wordt gesimuleerd (24 substappen per frame). Elke balk is een axiale veer met
  stijfheid `EA / L`; kabels werken alleen op trek. Een balk breekt zodra de kracht
  boven de maximale kracht van het materiaal komt. Het voertuig belast de
  wegdekbalken via zijn twee assen.
- **Weergave** (`src/bridgeView.js`): het 2D-ontwerp wordt in 3D getoond als
  wegdek plus twee identieke zijvakwerken. Tijdens het testen kleuren balken van
  groen naar rood op basis van belasting.
- **Levels** (`src/levels.js`) en **materialen** (`src/materials.js`) zijn
  eenvoudige datastructuren; voeg er gerust zelf aan toe. Draai daarna `npm test`
  om te controleren dat de balans nog klopt.

Ontwerpen en voltooide levels worden in `localStorage` bewaard.
