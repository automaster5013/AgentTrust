import { createHash } from 'node:crypto';
import { canonical } from '../contracts/hash.js';

// Preserve the historical canonical-array hash while retaining only one row.
export async function fingerprintRows(rows) {
  const sha=createHash('sha256');let count=0;sha.update('[');
  for await(const row of rows){if(count)sha.update(',');sha.update(JSON.stringify(canonical(row)));count++;}
  sha.update(']');return {count,hash:sha.digest('hex')};
}
