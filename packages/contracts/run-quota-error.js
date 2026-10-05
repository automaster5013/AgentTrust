import {InputError} from './index.js';

export const runLimits=Object.freeze({active:10,history:10000});
const codes=Object.freeze({active:'run_active_limit',history:'run_history_limit'});
export class RunQuotaError extends InputError {
  #code;
  constructor(reason){
    if(!Object.hasOwn(codes,reason))throw new TypeError('Unknown execution capacity reason.');
    super('Organization execution quota reached.',429);
    this.#code=codes[reason];
  }
  get code(){return this.#code;}
}
