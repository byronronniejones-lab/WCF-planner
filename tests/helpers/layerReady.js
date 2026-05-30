import {expect} from '@playwright/test';

// Layer readiness waiters — block until the specific layer view has actually
// finished its async load, instead of racing per-assertion timeouts against a
// cold Vite compile + the app's farm-data load. Modeled on pigReady.js
// (data-pig-feeders-loaded); see that file for the rationale.
//
// The generous default timeout absorbs the first-hit dev-server compile cost
// without test-only sleeps or --retries.
//
//   data-layer-batches-loaded="true"        — hub finished its dailys/egg load
//   data-layer-batch-record-loaded="true"   — a batch record page resolved its batch
//   data-layer-housing-record-loaded="true" — a housing record page resolved its housing

export async function waitForLayerBatchesHubLoaded(page, timeout = 30_000) {
  await expect(page.locator('[data-layer-batches-loaded="true"]')).toBeVisible({timeout});
}

export async function waitForLayerBatchRecordLoaded(page, timeout = 30_000) {
  await expect(page.locator('[data-layer-batch-record-loaded="true"]')).toBeVisible({timeout});
}

export async function waitForLayerHousingRecordLoaded(page, timeout = 30_000) {
  await expect(page.locator('[data-layer-housing-record-loaded="true"]')).toBeVisible({timeout});
}
