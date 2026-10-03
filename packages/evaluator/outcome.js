import { assertJsonValue } from '../contracts/json.js';
export const incomplete=(state,reason)=>({state,results:[],summary:{cases:0,rules:0,pass:0,fail:0,inconclusive:0,passRate:0},gate:{decision:'inconclusive',deploymentAllowed:false,reason}});
export function boundedOutcome(outcome){
  try{assertJsonValue(outcome,{maximumNodes:60000});return outcome;}
  catch{return incomplete('failed','Evaluation evidence is invalid or exceeded its result budget.');}
}
