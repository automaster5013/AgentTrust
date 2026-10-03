import { randomUUID, createHash } from 'node:crypto';
import { validate, InputError } from '../../packages/contracts/index.js';
import { evaluate } from '../../packages/evaluator/index.js';
import { sampleDataset, modes } from '../../packages/contracts/samples.js';

function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export class Store {
  constructor({ limit = 500 } = {}) {
    this.limit = limit;
    this.versions = { agent: new Map(), dataset: new Map(), policy: new Map() };
    this.runs = new Map(); this.keys = new Map();
    for (const [mode, name] of modes) this.createVersion('agent', { name, mode });
    this.createVersion('dataset', sampleDataset);
    this.createVersion('policy', { name: '필수 검증 전체 통과', minimumPassRate: 1 });
  }
  createVersion(kind, input) {
    const data = validate(kind, input);
    if (this.versions[kind].size >= this.limit) throw new InputError('Local session capacity reached. Restart to reset.', 429);
    const version = freeze({ ...data, id: randomUUID(), contentHash: hash(data), createdAt: new Date().toISOString() });
    this.versions[kind].set(version.id, version);
    return structuredClone(version);
  }
  catalog() {
    return Object.fromEntries(Object.entries(this.versions).map(([kind, map]) => [kind, [...map.values()].map(v => ({ id: v.id, name: v.name, contentHash: v.contentHash, mode: v.mode, cases: v.cases?.length }))]));
  }
  createRun(input, key) {
    const request = validate('run', input);
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(key)) throw new InputError('Idempotency-Key must contain 8-100 letters, digits, underscores or hyphens.');
    const fingerprint = hash(request);
    if (this.keys.has(key)) {
      const previous = this.keys.get(key);
      if (previous.fingerprint !== fingerprint) throw new InputError('Idempotency key conflicts with another request.', 409);
      return { run: this.getRun(previous.id), replay: true };
    }
    if (this.runs.size >= this.limit) throw new InputError('Local session capacity reached. Restart to reset.', 429);
    const snapshot = {};
    for (const kind of ['agent', 'dataset', 'policy']) {
      const version = this.versions[kind].get(request[`${kind}VersionId`]);
      if (!version) throw new InputError(`Unknown ${kind} version.`, 404);
      snapshot[kind] = structuredClone(version);
    }
    freeze(snapshot);
    const run = { id: randomUUID(), ...request, createdAt: new Date().toISOString(), state: 'queued', snapshot, snapshotHash: hash(snapshot), results: [], gate: { decision: 'inconclusive', deploymentAllowed: false, reason: 'Evaluation has not completed.' } };
    this.runs.set(run.id, run); this.keys.set(key, { fingerprint, id: run.id });
    setImmediate(() => this.execute(run.id));
    return { run: structuredClone(run), replay: false };
  }
  execute(id) {
    const run = this.runs.get(id);
    if (!run || run.state !== 'queued') return;
    run.state = 'running';
    try { Object.assign(run, evaluate(run.snapshot)); }
    catch { Object.assign(run, { state: 'failed', gate: { decision: 'inconclusive', deploymentAllowed: false, reason: 'Evaluation could not complete.' } }); }
    run.completedAt = new Date().toISOString();
    run.resultHash = hash({ results: run.results, gate: run.gate });
    freeze(run);
  }
  getRun(id) {
    if (!this.runs.has(id)) throw new InputError('Run not found.', 404);
    return structuredClone(this.runs.get(id));
  }
  listRuns() {
    return [...this.runs.values()].reverse().map(({ id, state, createdAt, gate, snapshot, summary }) => ({ id, state, createdAt, gate, summary, agentName: snapshot.agent.name, datasetName: snapshot.dataset.name }));
  }
}
