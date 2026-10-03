import { assertJsonValue } from '../contracts/json.js';
export const incomplete=(state,reason)=>({state,results:[],summary:{cases:0,rules:0,pass:0,fail:0,inconclusive:0,passRate:0},gate:{decision:'inconclusive',deploymentAllowed:false,reason}});
export const maximumOutcomeBytes=8*1024*1024;
export function assertOutcomeBudget(outcome){
  assertJsonValue(outcome,{maximumNodes:60000});
  if(Buffer.byteLength(JSON.stringify(outcome),'utf8')>maximumOutcomeBytes)throw new Error('Serialized evaluation result budget exceeded.');
}
export function boundedOutcome(outcome){
  try{assertOutcomeBudget(outcome);return outcome;}
  catch{return incomplete('failed','Evaluation evidence is invalid or exceeded its result budget.');}
}
