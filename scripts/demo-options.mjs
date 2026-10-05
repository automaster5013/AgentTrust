import assert from 'node:assert/strict';

// Select an existing local seed only; never create a tenant or relax its limits.
export function parseDemoOptions(args,booleanFlags=[]){
 const options={organizationIndex:0},seen=new Set();
 for(let i=0;i<args.length;i++){
  const flag=args[i];assert.ok(!seen.has(flag));seen.add(flag);
  if(flag==='--organization-index'){
   const value=args[++i];assert.ok(typeof value==='string'&&/^(0|[1-9][0-9]?)$/.test(value));options.organizationIndex=Number(value);
  }else{assert.ok(booleanFlags.includes(flag));options[flag]=true;}
 }
 return options;
}
