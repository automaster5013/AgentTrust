import { parentPort, workerData } from 'node:worker_threads';
import { setTimeout } from 'node:timers/promises';
import { boundedOutcome } from '../../packages/evaluator/outcome.js';
import { evaluate, evaluateAsync } from '../../packages/evaluator/index.js';
if (workerData.snapshot.agent.mode === 'slow') await setTimeout(2500);
import { httpsEvidence } from '../../packages/evaluator/https-adapter.js';
const snapshot=workerData.snapshot;
parentPort.postMessage(boundedOutcome(snapshot.agent.mode==='https' ? await evaluateAsync(snapshot,(s,c)=>httpsEvidence(s,c,{organizationId:workerData.organizationId})) : evaluate(snapshot)));
