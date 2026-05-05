import {describe, it, expect, vi} from 'vitest';
import {
  loadTaskTemplates,
  loadOpenTaskInstances,
  upsertTaskTemplate,
  deleteTaskTemplate,
  createOneTimeTaskInstance,
} from './tasksAdminApi.js';

// Side-effect wrappers around the supabase client. We mock the client and
// assert that each wrapper:
//   - calls the right table with the right shape,
//   - returns clean data on success,
//   - throws a useful Error on failure.
//
// C1.1 product-correction: runCronNow + loadCronAuditTail were removed.
// createOneTimeTaskInstance was added for the New Task one-time path.

function makeChain(returnValue) {
  // Chainable mock supporting .select/.eq/.order/.limit/.upsert/.insert/.delete/.single
  // that finally awaits to returnValue.
  const fn = vi.fn();
  const chain = {
    select: fn,
    eq: fn,
    order: fn,
    limit: fn,
    upsert: fn,
    insert: fn,
    delete: fn,
    single: fn,
    maybeSingle: fn,
    then(resolve, reject) {
      return Promise.resolve(returnValue).then(resolve, reject);
    },
  };
  fn.mockReturnValue(chain);
  return chain;
}

function makeSb({tableResult, tableResults} = {}) {
  // tableResults (array) — consumed in order, one per from() call. Falls
  // back to tableResult (scalar) for tests that only do one DB op.
  if (Array.isArray(tableResults)) {
    let i = 0;
    return {from: vi.fn(() => makeChain(tableResults[i++]))};
  }
  return {from: vi.fn(() => makeChain(tableResult))};
}

describe('loadTaskTemplates', () => {
  it('selects from task_templates', async () => {
    const sb = makeSb({tableResult: {data: [{id: 'tt-1', title: 'A'}], error: null}});
    const out = await loadTaskTemplates(sb);
    expect(sb.from).toHaveBeenCalledWith('task_templates');
    expect(out).toEqual([{id: 'tt-1', title: 'A'}]);
  });

  it('returns [] when data is null', async () => {
    const sb = makeSb({tableResult: {data: null, error: null}});
    expect(await loadTaskTemplates(sb)).toEqual([]);
  });

  it('throws on db error', async () => {
    const sb = makeSb({tableResult: {data: null, error: {message: 'rls denied'}}});
    await expect(loadTaskTemplates(sb)).rejects.toThrow(/rls denied/);
  });
});

describe('loadOpenTaskInstances', () => {
  it('selects task_instances filtered to status=open', async () => {
    const sb = makeSb({tableResult: {data: [{id: 'ti-1', status: 'open'}], error: null}});
    const out = await loadOpenTaskInstances(sb);
    expect(sb.from).toHaveBeenCalledWith('task_instances');
    expect(out).toHaveLength(1);
  });
});

describe('upsertTaskTemplate / deleteTaskTemplate', () => {
  it('upsert returns the persisted row', async () => {
    const sb = makeSb({tableResult: {data: {id: 'tt-1'}, error: null}});
    const out = await upsertTaskTemplate(sb, {id: 'tt-1', title: 'X'});
    expect(out).toEqual({id: 'tt-1'});
  });

  it('delete throws on error', async () => {
    const sb = makeSb({tableResult: {error: {message: 'fk constraint'}}});
    await expect(deleteTaskTemplate(sb, 'tt-1')).rejects.toThrow(/fk constraint/);
  });
});

describe('createOneTimeTaskInstance', () => {
  it('inserts into task_instances and returns the persisted row', async () => {
    const sb = makeSb({
      tableResult: {data: {id: 'ti-1', status: 'open', submission_source: 'admin_manual'}, error: null},
    });
    const out = await createOneTimeTaskInstance(sb, {
      id: 'ti-1',
      template_id: null,
      assignee_profile_id: '00000000-0000-0000-0000-000000000001',
      due_date: '2026-05-10',
      title: 'Refill mineral',
      submission_source: 'admin_manual',
      status: 'open',
    });
    expect(sb.from).toHaveBeenCalledWith('task_instances');
    expect(out.submission_source).toBe('admin_manual');
  });

  it('throws on insert error', async () => {
    const sb = makeSb({tableResult: {data: null, error: {message: 'check_violation'}}});
    await expect(createOneTimeTaskInstance(sb, {id: 'ti-2', submission_source: 'admin_manual'})).rejects.toThrow(
      /check_violation/,
    );
  });

  it('treats 23505 unique_violation as idempotent replay and returns the existing row', async () => {
    // First DB call: insert raises 23505 because the row already landed
    // on a prior attempt (same id). Second DB call: select the existing
    // row and hand it back to the caller as if the insert had succeeded.
    const existing = {
      id: 'ti-replay',
      template_id: null,
      submission_source: 'admin_manual',
      status: 'open',
      title: 'Refill mineral',
    };
    const sb = makeSb({
      tableResults: [
        {data: null, error: {code: '23505', message: 'duplicate key value violates unique constraint'}},
        {data: existing, error: null},
      ],
    });
    const out = await createOneTimeTaskInstance(sb, {id: 'ti-replay', submission_source: 'admin_manual'});
    expect(out).toEqual(existing);
    expect(sb.from).toHaveBeenCalledTimes(2);
    expect(sb.from).toHaveBeenNthCalledWith(1, 'task_instances');
    expect(sb.from).toHaveBeenNthCalledWith(2, 'task_instances');
  });
});
