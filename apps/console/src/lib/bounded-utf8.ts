export class BoundedTextError extends Error{
 readonly code:'BYTE_LIMIT'|'INVALID_UTF8';
 constructor(code:'BYTE_LIMIT'|'INVALID_UTF8'){super(code);this.code=code}
}
/** Bound decoded HTTP bytes before allocation; preserve fatal stream errors. */
export async function boundedUtf8(body:ReadableStream<Uint8Array>|null,limit:number,signal?:AbortSignal):Promise<string>{
 if(!Number.isSafeInteger(limit)||limit<1||limit>1048576)throw Error('INVALID_TEXT_LIMIT');
 signal?.throwIfAborted();
 if(!body)return '';
 const reader=body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
 const abort=()=>{void reader.cancel().catch(()=>{})};signal?.addEventListener('abort',abort,{once:true});
 try{
  for(;;){
   const next=await reader.read();signal?.throwIfAborted();if(next.done)break;
   bytes+=next.value.byteLength;
   if(bytes>limit){void reader.cancel().catch(()=>{});throw new BoundedTextError('BYTE_LIMIT')}
   chunks.push(next.value);
  }
 }finally{signal?.removeEventListener('abort',abort);reader.releaseLock()}
 const merged=new Uint8Array(bytes);let offset=0;
 for(const chunk of chunks){merged.set(chunk,offset);offset+=chunk.byteLength}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(merged)}catch{throw new BoundedTextError('INVALID_UTF8')}
}
