// A pinned historical Console is used only for hosted before/after comparison.
const visualBaseline='74f78759822da9c040d018691004dfd74db00771';
export function workspaceEntry(context:{githubActions?:string;visualCapture?:string;visualLabel?:string;baselineRevision?:string}){
 const before=context.visualCapture==='true'&&context.visualLabel==='before';
 if(before||context.baselineRevision){
  if(!before||context.githubActions!=='true'||context.baselineRevision!==visualBaseline)throw Error('INVALID_HISTORICAL_CONSOLE_CONTEXT');
  return {showcase:false,authenticatedPath:'/'} as const;
 }
 return {showcase:true,authenticatedPath:'/workspace'} as const;
}
