/** Only an exact evaluation ID may enter the existing scoped detail route. */
export function evaluationLookupId(value:string):string{
 const id=value.trim().toLowerCase();
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw Error('INVALID_EVALUATION_LOOKUP_ID');
 return id;
}
