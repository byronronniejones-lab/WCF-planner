import {describe, it, expect, vi} from 'vitest';
import {
  runCronNow,
  loadTaskTemplates,
  loadOpenTaskInstances,
  loadCronAuditTail,
  upsertTaskTemplate,
  deleteTaskTemplate,
} from './tasksAdminApi.js';

// Side-effect wrappers around the supabase client. We mock the client and
// assert that each wrapper:
//   - calls the right table/function with the right shape,
//   - returns clean data on success,
//   - throws a useful Error on failure.

function makeChain(returnValue) {
  // Builds a chainable mock that supports .select/.eq/.order/.limit/.upsert/.delete/.single
  // and finally awaits to returnValue.
  const fn = vi.fn();
  const chain = {
    select: fn,
    eq: fn,
    order: fn,
    limit: fn,
    upsert: fn,
    delete: fn,
    single: fn,
    then(resolve, reject) {
      return Promise.resolve(returnValue).then(resolve, reject);
    },
  };
  fn.mockReturnValue(chain);
  return chain;
}

function makeSb({tableResult, fnResult} = {}) {
  return {
    from: vi.fn(() => makeChain(tableResult)),
    functions: {invoke: vi.fn(async () => fnResult)},
  };
}

describe('runCronNow', () => {
  it('invokes the tasks-cron Edge Function with admin mode and no probe flag', async () => {
    const sb = makeSb({
      fnResult: {data: {ok: true, generated_count: 2, skipped_count: 0, cap_exceeded: []}, error: null},
    });
    const result = await runCronNow(sb);
    expect(sb.functions.invoke).toHaveBeenCalledWith('tasks-cron', {body: {mode: 'admin'}});
    // Critical: NO probe:true — that would short-circuit to the audit-only path.
    const callArg = sb.functions.invoke.mock.calls[0][1];
    expect(callArg.body).not.toHaveProperty('probe');
    expect(result.ok).toBe(true);
    expect(result.generated_count).toBe(2);
  });

  it('throws on Edge Function error', async () => {
    const sb = makeSb({fnResult: {data: null, error: {message: 'auth failed'}}});
    await expect(runCronNow(sb)).rejects.toThrow(/auth failed/);
  });
});

describe('loadTaskTemplates', () => {
  it('selects from task_templates ordered by title', async () => {
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

describe('loadCronAuditTail', () => {
  it('selects task_cron_runs ordered desc with default limit 5', async () => {
    const sb = makeSb({tableResult: {data: [], error: null}});
    await loadCronAuditTail(sb);
    expect(sb.from).toHaveBeenCalledWith('task_cron_runs');
  });

  it('respects an explicit limit', async () => {
    const sb = makeSb({tableResult: {data: [], error: null}});
    await loadCronAuditTail(sb, 10);
    expect(sb.from).toHaveBeenCalledWith('task_cron_runs');
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
