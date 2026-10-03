const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const validText=value=>!value.includes('\u0000')&&value.isWellFormed();
// PostgreSQL jsonb cannot store NUL or unpaired surrogates; finite numbers preserve JSON meaning.
export function assertJsonValue(value,{maximumNodes=30000}={}){
  if(!Number.isInteger(maximumNodes)||maximumNodes<1||maximumNodes>60000)throw new Error('Invalid JSON node budget.');
  const pending=[[value,0]];let nodes=0;
  while(pending.length){
    const [item,depth]=pending.pop();
    if(++nodes>maximumNodes||depth>16)throw new Error('Input nesting or node budget exceeded.');
    if(typeof item==='number'&&!Number.isFinite(item))throw new Error('JSON numbers must be finite.');
    if(typeof item==='string'&&!validText(item))throw new Error('JSON strings must contain valid Unicode without NUL.');
    if(item&&typeof item==='object'){
      const remaining=maximumNodes-nodes-pending.length;
      if(Array.isArray(item)&&item.length>remaining)throw new Error('Input nesting or node budget exceeded.');
      const keys=Object.keys(item);if(keys.length>remaining)throw new Error('Input nesting or node budget exceeded.');
      for(const key of keys){
        if(!validText(key))throw new Error('JSON property names must contain valid Unicode without NUL.');
        pending.push([item[key],depth+1]);
      }
    }
  }
}
export function parseJson(bytes){const value=JSON.parse(decoder.decode(bytes));assertJsonValue(value);return value;}
