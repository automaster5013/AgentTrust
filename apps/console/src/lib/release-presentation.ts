import type {Gate} from './contracts';
export type ReleaseObservation=Pick<Gate,'decision'|'deploymentAllowed'|'policyStatus'>;
export function releasePresentation(gate:ReleaseObservation|null):'allowed'|'blocked'|'unavailable'{
 if(!gate||gate.policyStatus!=='evaluated')return 'unavailable';
 return gate.deploymentAllowed&&gate.decision==='pass'?'allowed':'blocked';
}
