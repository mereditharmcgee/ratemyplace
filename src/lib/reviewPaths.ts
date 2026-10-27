// Where the review form sends a writer, and the one place it leaves the page.
//
// LEAF MODULE: no runtime imports. ReviewForm (a React island) imports it, so anything it
// imported would ship to every visitor (`clientLeafModules.test.ts` enforces it).

/** The review form opened on an existing building, at unit details. */
export function existingBuildingReviewPath(buildingId: string, opts?: { partOf?: boolean }): string {
  return '/review/new?building=' + encodeURIComponent(buildingId) + (opts?.partOf ? '&partOf=1' : '');
}

/** The one place the review form leaves the page; tests spy on it. */
export const browserNav = {
  go(url: string): void {
    window.location.href = url;
  },
};
