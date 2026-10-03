const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const validText=value=>!value.includes('\u0000')&&value.isWellFormed();
// PostgreSQL jsonb cannot store NUL or unpaired surrogates; finite numbers preserve JSON meaning.
export function assertJsonValue(value){
  const pending=[[value,0]];let nodes=0;
  while(pending.length){
    const [item,depth]=pending.pop();
    if(++nodes>30000||depth>16)throw new Error('Input nesting or node budget exceeded.');
    if(typeof item==='number'&&!Number.isFinite(item))throw new Error('JSON numbers must be finite.');
    if(typeof item==='string'&&!validText(item))throw new Error('JSON strings must contain valid Unicode without NUL.');
    if(item&&typeof item==='object'){
      for(const [key,child] of Object.entries(item)){
        if(!validText(key))throw new Error('JSON property names must contain valid Unicode without NUL.');
        pending.push([child,depth+1]);
      }
    }
  }
}
export function parseJson(bytes){const value=JSON.parse(decoder.decode(bytes));assertJsonValue(value);return value;}
