// What a building pin on /map says, as pure decisions so they can be unit tested without
// Google Maps. `BuildingMap.tsx` draws the pin and asks these for the score text inside it
// and for the marker's title, which Google uses as both the hover tooltip and the
// accessible name (the marker's aria-label).
//
// WCAG 2.5.3 Label in Name: a control's accessible name must contain the text it shows,
// best at the start. A pin shows its score ("1.1"), so its title starts with that same
// string, then the band label and the address. Both come from `markerScoreText`, so what the
// pin draws and what it is called cannot drift apart. A title of the address alone was
// flagged on /map as axe's label-content-name-mismatch in November 2026. The cluster badge
// follows the same rule in mapCluster.ts.
//
// Leaf module: no runtime imports. It is imported by the map island.

/** The text drawn inside a building pin: the score to one decimal, or "?" with no score. */
export function markerScoreText(score: number | null): string {
  return score === null ? '?' : score.toFixed(1);
}

/**
 * Hover title and accessible name for a building pin: the score the pin shows, its band
 * label, then the address ("1.1 Poor, 3368 Washington Street"). `bandLabel` is the label
 * the pin's InfoWindow shows for the same score. With no score the pin shows "?", which is
 * a symbol rather than a word, so the name is the label and the address alone
 * ("No reviews, 17 Elmira Street").
 */
export function markerTitle(address: string, score: number | null, bandLabel: string): string {
  const lead = score === null ? bandLabel : `${markerScoreText(score)} ${bandLabel}`;
  return `${lead}, ${address}`;
}
