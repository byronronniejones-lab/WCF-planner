import {expect} from '@playwright/test';

// waitForPigFeedersLoaded — block until the pig.batch hub/record view has
// actually finished loading feeder data.
//
// Keyed on the `feedersLoaded` readiness signal (PigContext), exposed on the
// view root as data-pig-feeders-loaded="true". This is the reliable
// "pig data is loaded" boundary — past BOTH the app-level "Loading your farm
// data" gate AND the record-page "Loading…" guard. App.loadAllData() flips the
// signal in the same React batch as setFeederGroups, so once the marker reads
// "true" feederGroups is guaranteed populated (no transient empty window).
//
// Replaces the old `#wcf-boot-loader -> 0` wait, which only meant React had
// painted its first frame (often still the "Loading your farm data" screen) —
// leaving specs to race the data load against per-assertion timeouts and flake
// on cold Vite compiles. The generous default timeout absorbs that first-hit
// compile cost without needing test-only sleeps or --retries.
export async function waitForPigFeedersLoaded(page, timeout = 30_000) {
  await expect(page.locator('[data-pig-feeders-loaded="true"]')).toBeVisible({timeout});
}
