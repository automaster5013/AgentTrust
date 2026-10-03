import { parentPort, workerData } from 'node:worker_threads';
import { setTimeout } from 'node:timers/promises';
import { evaluate } from '../../packages/evaluator/index.js';
if (workerData.snapshot.agent.mode === 'slow') await setTimeout(2500);
parentPort.postMessage(evaluate(workerData.snapshot));
