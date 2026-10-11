import type {GateCheck} from './gate-check-contracts.ts';
/** Conservative remaining observation lifetime, including request/verification elapsed time. */
export function gateCheckRemaining(check:GateCheck,wallNow:number,requestStarted:number,monotonicNow:number):number{
 if(![check.checkedAtEpochMillis,check.expiresAtEpochMillis,wallNow,requestStarted,monotonicNow].every(Number.isFinite)||requestStarted<0||monotonicNow<requestStarted)throw Error('INVALID_GATE_CHECK_CLOCK');
 const signedLifetime=check.expiresAtEpochMillis-check.checkedAtEpochMillis;
 if(signedLifetime<=0||signedLifetime>30000)throw Error('INVALID_GATE_CHECK_LIFETIME');
 return Math.max(0,Math.min(check.expiresAtEpochMillis-wallNow,signedLifetime-(monotonicNow-requestStarted)));
}
