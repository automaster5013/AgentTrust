import assert from 'node:assert/strict';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function seededDemoScope(organization){
  assert.ok(uuid(organization?.organizationId)&&uuid(organization?.projectId));
  return {organizationId:organization.organizationId.toLowerCase(),projectId:organization.projectId.toLowerCase()};
}
export function assertDemoSessionScope(me,scope,role){
  assert.equal(me?.role,role);assert.equal(me.organizationId,scope.organizationId);assert.equal(me.projectId,scope.projectId);
}
