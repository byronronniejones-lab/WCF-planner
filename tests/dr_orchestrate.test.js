import {describe, it, expect} from 'vitest';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const O = require('../scripts/lib/dr_orchestrate.cjs');
const L = require('../scripts/lib/dr_layout.cjs');

const RUN = '20260722T120000Z';

/**
 * Build a set of in-memory ops plus a shared timeline that records the order
 * and arguments of every call. No credentials, network, subprocess, or disk.
 * `fail` lets a test make a specific operation fail.
 *   fail.putObject(provider,key) -> truthy to fail that put
 *   fail.stream(obj,provider,destKey) -> truthy to reject that stream
 *   fail.retention(key) -> truthy to fail that retention
 */
function makeOps(fail = {}) {
  const timeline = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const streamCalls = [];
  const retentionCalls = [];
  return {
    timeline,
    streamCalls,
    retentionCalls,
    maxInFlight: () => maxInFlight,
    ops: {
      putObject(provider, key /* body */) {
        timeline.push({op: 'put', provider, key});
        return {ok: !(fail.putObject && fail.putObject(provider, key)), error: 'put failed'};
      },
      async streamObject(obj, provider, destKey) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Yield so concurrent workers actually overlap in the event loop.
        await Promise.resolve();
        streamCalls.push({obj: `${obj.bucket}/${obj.path}`, provider, destKey});
        timeline.push({op: 'stream', provider, destKey});
        inFlight--;
        if (fail.stream && fail.stream(obj, provider, destKey)) throw new Error(`stream ${provider} failed`);
      },
      setB2Retention(key) {
        retentionCalls.push(key);
        timeline.push({op: 'retention', key});
        return {ok: !(fail.retention && fail.retention(key)), error: 'retention failed'};
      },
      sleep: async () => {}, // no real backoff wait under test
    },
  };
}

const payloadFor = () => [
  {provider: 'b2', key: L.databaseKeys(RUN).dump, body: '/enc'},
  {provider: 'r2', key: L.databaseKeys(RUN).dump, body: '/enc'},
];
const manifestsFor = () => [
  {provider: 'b2', key: L.databaseKeys(RUN).manifest, body: '/m'},
  {provider: 'b2', key: L.storageManifestKey(RUN), body: '/m'},
  {provider: 'r2', key: L.databaseKeys(RUN).manifest, body: '/m'},
  {provider: 'r2', key: L.storageManifestKey(RUN), body: '/m'},
];
const objs = (...names) => names.map((n) => ({bucket: 'daily-photos', path: n, size: 10, etag: 'e'}));

describe('orchestrateUpload — happy path', () => {
  it('completes payload, transfers every object to both providers, then manifests', async () => {
    const h = makeOps();
    const res = await O.orchestrateUpload(
      {payload: payloadFor(), storageChanged: objs('a', 'b'), manifests: manifestsFor(), runId: RUN},
      h.ops,
    );
    expect(res.ok).toBe(true);
    expect(res.manifestsUploaded).toBe(true);
    expect(res.transferred).toBe(2);
  });

  it('uploads the database payload BEFORE any storage transfer', async () => {
    const h = makeOps();
    await O.orchestrateUpload(
      {payload: payloadFor(), storageChanged: objs('a'), manifests: manifestsFor(), runId: RUN},
      h.ops,
    );
    const firstStream = h.timeline.findIndex((e) => e.op === 'stream');
    const lastPayloadPut = h.timeline.map((e) => e.op).lastIndexOf('put', firstStream);
    // every payload put precedes the first stream
    const payloadPuts = h.timeline.slice(0, firstStream).filter((e) => e.op === 'put');
    expect(payloadPuts.length).toBe(2);
    expect(lastPayloadPut).toBeLessThan(firstStream);
  });

  it('transfers each object to B2 and R2 with the correct destination keys', async () => {
    const h = makeOps();
    await O.orchestrateUpload({payload: [], storageChanged: objs('a', 'b'), manifests: [], runId: RUN}, h.ops);
    for (const name of ['a', 'b']) {
      const forObj = h.streamCalls.filter((c) => c.obj === `daily-photos/${name}`);
      const providers = forObj.map((c) => c.provider).sort();
      expect(providers).toEqual(['b2', 'r2']);
      expect(forObj.find((c) => c.provider === 'b2').destKey).toBe(L.storageObjectKey('b2', 'daily-photos', name, RUN));
      expect(forObj.find((c) => c.provider === 'r2').destKey).toBe(L.storageObjectKey('r2', 'daily-photos', name, RUN));
    }
  });

  it('sets B2 retention for each transferred object', async () => {
    const h = makeOps();
    await O.orchestrateUpload({payload: [], storageChanged: objs('a', 'b'), manifests: [], runId: RUN}, h.ops);
    expect(h.retentionCalls.sort()).toEqual([
      L.storageObjectKey('b2', 'daily-photos', 'a', RUN),
      L.storageObjectKey('b2', 'daily-photos', 'b', RUN),
    ]);
  });

  it('publishes manifests only after all payloads and transfers complete', async () => {
    const h = makeOps();
    await O.orchestrateUpload(
      {payload: payloadFor(), storageChanged: objs('a'), manifests: manifestsFor(), runId: RUN},
      h.ops,
    );
    const manifestKeys = new Set(manifestsFor().map((m) => m.key));
    const firstManifest = h.timeline.findIndex((e) => e.op === 'put' && manifestKeys.has(e.key));
    const lastStream = h.timeline.map((e) => e.op).lastIndexOf('stream');
    const lastRetention = h.timeline.map((e) => e.op).lastIndexOf('retention');
    expect(firstManifest).toBeGreaterThan(lastStream);
    expect(firstManifest).toBeGreaterThan(lastRetention);
  });
});

describe('orchestrateUpload — failure semantics', () => {
  it('B2 success then R2 failure rejects the run and skips manifests', async () => {
    const h = makeOps({stream: (_o, provider) => provider === 'r2'});
    const res = await O.orchestrateUpload(
      {payload: [], storageChanged: objs('a'), manifests: manifestsFor(), runId: RUN},
      h.ops,
    );
    expect(res.ok).toBe(false);
    expect(res.failedAt).toBe('storage');
    expect(res.manifestsUploaded).toBe(false);
    // no manifest put happened
    const manifestKeys = new Set(manifestsFor().map((m) => m.key));
    expect(h.timeline.some((e) => e.op === 'put' && manifestKeys.has(e.key))).toBe(false);
  });

  it('a retention failure rejects the run', async () => {
    const h = makeOps({retention: () => true});
    const res = await O.orchestrateUpload(
      {payload: [], storageChanged: objs('a'), manifests: manifestsFor(), runId: RUN},
      h.ops,
    );
    expect(res.ok).toBe(false);
    expect(res.failedAt).toBe('storage');
    expect(res.manifestsUploaded).toBe(false);
  });

  it('a payload failure aborts before any storage transfer or manifest', async () => {
    const h = makeOps({putObject: (provider) => provider === 'r2'});
    const res = await O.orchestrateUpload(
      {payload: payloadFor(), storageChanged: objs('a'), manifests: manifestsFor(), runId: RUN},
      h.ops,
    );
    expect(res.ok).toBe(false);
    expect(res.failedAt).toBe('payload');
    expect(h.timeline.some((e) => e.op === 'stream')).toBe(false);
  });

  it('a manifest failure is reported and does not claim success', async () => {
    const manifestKey = L.storageManifestKey(RUN);
    const h = makeOps({putObject: (_p, key) => key === manifestKey});
    const res = await O.orchestrateUpload(
      {payload: payloadFor(), storageChanged: objs('a'), manifests: manifestsFor(), runId: RUN},
      h.ops,
    );
    expect(res.ok).toBe(false);
    expect(res.failedAt).toBe('manifest');
    expect(res.manifestsUploaded).toBe(false);
  });

  it('transferred count increments only after BOTH providers succeed', async () => {
    // r2 fails for object 'a' but not 'b'
    const h = makeOps({stream: (o, provider) => o.path === 'a' && provider === 'r2'});
    const res = await O.orchestrateUpload(
      {payload: [], storageChanged: objs('a', 'b'), manifests: [], runId: RUN},
      h.ops,
    );
    expect(res.ok).toBe(false);
    // 'b' fully succeeded, 'a' did not -> exactly one counted
    expect(res.transferred).toBe(1);
  });

  it('does not upload the manifest after any object failure', async () => {
    const h = makeOps({stream: (o) => o.path === 'a'});
    const res = await O.orchestrateUpload(
      {payload: [], storageChanged: objs('a', 'b', 'c'), manifests: manifestsFor(), runId: RUN},
      h.ops,
    );
    expect(res.ok).toBe(false);
    expect(res.manifestsUploaded).toBe(false);
    const manifestKeys = new Set(manifestsFor().map((m) => m.key));
    expect(h.timeline.some((e) => e.op === 'put' && manifestKeys.has(e.key))).toBe(false);
  });
});

describe('orchestrateUpload — concurrency and retry', () => {
  it('never exceeds the configured concurrency limit', async () => {
    const h = makeOps();
    const many = objs(...Array.from({length: 20}, (_, i) => `obj-${i}`));
    await O.orchestrateUpload({payload: [], storageChanged: many, manifests: [], runId: RUN, concurrency: 4}, h.ops);
    expect(h.maxInFlight()).toBeLessThanOrEqual(4);
  });

  it('retries a transient failure and ultimately succeeds', async () => {
    let attempts = 0;
    const ops = {
      putObject: () => ({ok: true}),
      async streamObject() {
        attempts++;
        if (attempts < 2) throw new Error('transient');
      },
      setB2Retention: () => ({ok: true}),
      sleep: async () => {},
    };
    const res = await O.orchestrateUpload(
      {payload: [], storageChanged: objs('a'), manifests: [], runId: RUN, retryAttempts: 3},
      ops,
    );
    expect(res.ok).toBe(true);
    expect(attempts).toBeGreaterThanOrEqual(2);
  });

  it('rejects after retry exhaustion', async () => {
    let attempts = 0;
    const ops = {
      putObject: () => ({ok: true}),
      async streamObject() {
        attempts++;
        throw new Error('always fails');
      },
      setB2Retention: () => ({ok: true}),
      sleep: async () => {},
    };
    const res = await O.orchestrateUpload(
      {payload: [], storageChanged: objs('a'), manifests: [], runId: RUN, retryAttempts: 3},
      ops,
    );
    expect(res.ok).toBe(false);
    expect(attempts).toBe(3); // exactly the configured attempts, no infinite loop
  });

  it('database-only skips storage transfer entirely', async () => {
    const h = makeOps();
    const res = await O.orchestrateUpload(
      {
        payload: payloadFor(),
        storageChanged: objs('a', 'b'),
        manifests: manifestsFor(),
        runId: RUN,
        databaseOnly: true,
      },
      h.ops,
    );
    expect(res.ok).toBe(true);
    expect(res.transferred).toBe(0);
    expect(h.timeline.some((e) => e.op === 'stream')).toBe(false);
  });
});

describe('orchestrateUpload — fail closed on bad dependencies', () => {
  it('throws when the ops object is missing entirely', async () => {
    await expect(O.orchestrateUpload({payload: [], storageChanged: [], manifests: []}, undefined)).rejects.toThrow(
      /ops object is required/,
    );
  });

  it('throws when a required operation is absent', async () => {
    const incomplete = {putObject: () => ({ok: true}), streamObject: async () => {}, sleep: async () => {}};
    await expect(
      O.orchestrateUpload({payload: [], storageChanged: objs('a'), manifests: []}, incomplete),
    ).rejects.toThrow(/missing required operation "setB2Retention"/);
  });
});

describe('child registry — cancellation terminates children', () => {
  it('tracks children and kills them all on demand', () => {
    const reg = O.createChildRegistry();
    const kills = [];
    const mkChild = () => ({kill: (sig) => kills.push(sig), on: () => {}});
    reg.track(mkChild());
    reg.track(mkChild());
    expect(reg.size()).toBe(2);
    reg.killAll();
    expect(kills).toEqual(['SIGKILL', 'SIGKILL']);
    expect(reg.size()).toBe(0);
  });

  it('a killed child that throws does not stop the others being killed', () => {
    const reg = O.createChildRegistry();
    const killed = [];
    reg.track({
      kill: () => {
        throw new Error('already dead');
      },
      on: () => {},
    });
    reg.track({kill: () => killed.push('second'), on: () => {}});
    expect(() => reg.killAll()).not.toThrow();
    expect(killed).toEqual(['second']);
  });

  it('drops a child from tracking when it closes', () => {
    const reg = O.createChildRegistry();
    let closeHandler;
    reg.track({kill: () => {}, on: (evt, cb) => (closeHandler = cb)});
    expect(reg.size()).toBe(1);
    closeHandler();
    expect(reg.size()).toBe(0);
  });
});

describe('cleanup — kills children before removing files, once', () => {
  it('invokes child termination BEFORE work-dir removal', () => {
    const order = [];
    const cleanup = O.createCleanup({
      killChildren: () => order.push('kill'),
      removeWorkDir: () => order.push('rm'),
    });
    cleanup();
    expect(order).toEqual(['kill', 'rm']);
  });

  it('is idempotent: a second call does nothing', () => {
    let kills = 0;
    let rms = 0;
    const cleanup = O.createCleanup({killChildren: () => kills++, removeWorkDir: () => rms++});
    cleanup();
    cleanup();
    cleanup();
    expect(kills).toBe(1);
    expect(rms).toBe(1);
  });

  it('fails closed when an effect is missing', () => {
    expect(() => O.createCleanup({killChildren: () => {}})).toThrow(/required/);
  });
});
