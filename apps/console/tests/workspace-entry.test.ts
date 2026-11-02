import test from 'node:test';import assert from 'node:assert/strict';
import {workspaceEntry} from '../src/lib/workspace-entry.ts';
const baseline='74f78759822da9c040d018691004dfd74db00771';
test('ordinary and candidate capture always require showcase and workspace callback',()=>{
 for(const value of [{},{githubActions:'true'},{githubActions:'true',visualCapture:'true',visualLabel:'after'}])assert.deepEqual(workspaceEntry(value),{showcase:true,authenticatedPath:'/workspace'});
});
test('only explicitly pinned hosted before image keeps its original root callback',()=>{
 assert.deepEqual(workspaceEntry({githubActions:'true',visualCapture:'true',visualLabel:'before',baselineRevision:baseline}),{showcase:false,authenticatedPath:'/'});
});
test('missing wrong local or candidate historical pins cannot weaken new Console checks',()=>{
 for(const value of [{githubActions:'true',visualCapture:'true',visualLabel:'before'},{githubActions:'true',visualCapture:'true',visualLabel:'before',baselineRevision:'0'.repeat(40)},{visualCapture:'true',visualLabel:'before',baselineRevision:baseline},{githubActions:'true',visualCapture:'true',visualLabel:'after',baselineRevision:baseline},{githubActions:'true',baselineRevision:baseline}])assert.throws(()=>workspaceEntry(value));
});
