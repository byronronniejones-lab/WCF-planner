// Static guard for migration 106 — delete_layer_batch SECDEF RPC.
//
// LayerBatchPage.handleDeleteBatch previously did two separate, unaudited raw
// client deletes (layer_housings child clear + layer_batches root). The approved
// server path is this SECURITY DEFINER RPC, which in ONE transaction clears the
// child housings, deletes the batch root, and writes exactly one record.deleted
// layer.batch Activity event. This guard locks the load-bearing shape of the
// migration plus the wrapper/page wiring so the security + audit properties
// can't silently regress.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {describe, it, expect} from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mig = readFileSync(join(root, 'supabase-migrations', '106_delete_layer_batch_rpc.sql'), 'utf8');
const wrapper = readFileSync(join(root, 'src', 'lib', 'layerBatchDeleteApi.js'), 'utf8');
const page = readFileSync(join(root, 'src', 'layer', 'LayerBatchPage.jsx'), 'utf8');

describe('migration 106 — delete_layer_batch RPC shape', () => {
  it('is a SECURITY DEFINER function with a locked public search_path', () => {
    // Parameter is text (the layer_batches.id slug), NOT uuid — slug ids like
    // 'l-26-01' cannot cast to uuid.
    expect(mig).toMatch(/CREATE OR REPLACE FUNCTION public\.delete_layer_batch\s*\(\s*\n?\s*p_batch_id text/);
    expect(mig).toMatch(/SECURITY DEFINER/);
    expect(mig).toMatch(/SET search_path = public/);
  });

  it('requires an authenticated caller (anon rejected)', () => {
    expect(mig).toMatch(/v_caller\s+uuid := auth\.uid\(\)/);
    expect(mig).toMatch(/IF v_caller IS NULL THEN[\s\S]*?authenticated caller required/);
  });

  it('existence-gates the batch so a missing id returns no_batch (no phantom audit)', () => {
    expect(mig).toMatch(/IF NOT FOUND THEN[\s\S]*?'no_batch'/);
  });

  it('clears child housings explicitly first and deletes the batch root in one transaction', () => {
    expect(mig).toMatch(/DELETE FROM public\.layer_housings\s*\n?\s*WHERE batch_id = p_batch_id/);
    expect(mig).toMatch(/DELETE FROM public\.layer_batches WHERE id = p_batch_id/);
    // The housing delete is captured (count + names) for the audit payload.
    expect(mig).toMatch(/housings_cleared/);
    expect(mig).toMatch(/housing_names/);
  });

  it('writes exactly one record.deleted layer.batch Activity event', () => {
    expect(mig).toMatch(/INSERT INTO public\.activity_events/);
    expect(mig).toMatch(/'layer\.batch'/);
    expect(mig).toContain("'record.deleted'");
  });

  it('leaves layer_dailys / egg_dailys intact (history is NOT cascaded)', () => {
    expect(mig).not.toMatch(/DELETE FROM public\.layer_dailys/);
    expect(mig).not.toMatch(/DELETE FROM public\.egg_dailys/);
  });

  it('revokes anon/PUBLIC, grants authenticated, and reloads the PostgREST schema', () => {
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION public\.delete_layer_batch\(text\) FROM PUBLIC, anon/);
    expect(mig).toMatch(/GRANT EXECUTE ON FUNCTION public\.delete_layer_batch\(text\) TO authenticated/);
    expect(mig).toMatch(/NOTIFY pgrst, 'reload schema'/);
  });
});

describe('deleteLayerBatch wrapper wires to the RPC', () => {
  it('calls sb.rpc(delete_layer_batch) with p_batch_id', () => {
    expect(wrapper).toMatch(/export async function deleteLayerBatch/);
    expect(wrapper).toMatch(/sb\.rpc\('delete_layer_batch', \{p_batch_id: batchId\}\)/);
  });

  it('LayerBatchPage delete path uses the wrapper, not the two raw client deletes', () => {
    expect(page).toMatch(/deleteLayerBatch\s*\(/);
    expect(page).toMatch(/import \{deleteLayerBatch\} from '\.\.\/lib\/layerBatchDeleteApi\.js'/);
    // The old raw deletes on both layer tables are gone from the page.
    expect(page).not.toMatch(/from\('layer_housings'\)\.delete\(\)/);
    expect(page).not.toMatch(/from\('layer_batches'\)\.delete\(\)/);
  });

  it('still navigates back to the list after a successful delete', () => {
    expect(page).toMatch(/navigate\('\/layer\/batches'\)/);
  });
});

describe('migration 106 — layer status.changed Activity (retire/un-retire audit)', () => {
  it('LayerBatchPage emits status.changed on a real active<->retired batch flip', () => {
    expect(page).toMatch(/import \{recordFieldChange, recordStatusChange\} from '\.\.\/lib\/activityApi\.js'/);
    expect(page).toMatch(/recordStatusChange\(sb, \{[\s\S]*?entityType: 'layer\.batch'/);
    // Guarded so it only fires on a true transition, not every autosave tick.
    expect(page).toMatch(/priorStatus !== rec\.status/);
  });

  it('LayerHousingPage emits status.changed on retire and on a modal status flip', () => {
    const housing = readFileSync(join(root, 'src', 'layer', 'LayerHousingPage.jsx'), 'utf8');
    expect(housing).toMatch(/import \{recordStatusChange\} from '\.\.\/lib\/activityApi\.js'/);
    // Both the dedicated Retire flow and the edit-modal Status select emit to
    // the layer.housing entity.
    const matches = housing.match(/recordStatusChange\(sb, \{[\s\S]*?entityType: 'layer\.housing'/g) || [];
    expect(matches.length).toBe(2);
    expect(housing).toMatch(/priorStatus !== updated\.status/);
    expect(housing).toMatch(/priorStatus !== rec\.status/);
  });
});
