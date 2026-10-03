import Ajv from 'ajv';

export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const ajv = new Ajv({ strict: true, allErrors: true });
const text = { type: 'string', minLength: 1, maxLength: 10000 };
const rule = {
  type: 'object', additionalProperties: false, required: ['id', 'type'],
  properties: {
    id: { ...text, maxLength: 80 }, type: { enum: ['contains', 'not_contains', 'json_schema', 'allowed_tools'] },
    required: { type: 'boolean' }, value: text, schema: { type: 'object' },
    allowed: { type: 'array', maxItems: 20, uniqueItems: true, items: { ...text, maxLength: 80 } },
    argumentSchemas: { type: 'object', maxProperties: 20, additionalProperties: { type: 'object' } }
  }
};
const schemas = {
  agent: { type: 'object', additionalProperties: false, required: ['name', 'mode'], properties: {
    endpointHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, connectorId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,80}$' }, name: { ...text, maxLength: 100 }, mode: { enum: ['compliant', 'regression', 'forbidden_tool', 'error', 'missing_evidence', 'unsafe_output', 'slow', 'https'] }
  } },
  dataset: { type: 'object', additionalProperties: false, required: ['name', 'cases'], properties: {
    name: { ...text, maxLength: 100 }, cases: { type: 'array', minItems: 1, maxItems: 100, items: {
      type: 'object', additionalProperties: false, required: ['id', 'input', 'mock', 'rules'], properties: {
        id: { ...text, maxLength: 80 }, input: text,
        mock: { type: 'object', additionalProperties: false, required: ['output', 'toolEvents'], properties: {
          output: { type: 'string', maxLength: 10000 }, toolEvents: { type: 'array', maxItems: 20, items: {
            type: 'object', additionalProperties: false, required: ['name', 'args'], properties: {
              name: { ...text, maxLength: 80 }, args: { type: 'object', maxProperties: 20 }
            }
          } }
        } },
        rules: { type: 'array', minItems: 1, maxItems: 20, items: rule }
      }
    } }
  } },
  policy: { type: 'object', additionalProperties: false, required: ['name', 'minimumPassRate'], properties: {
    name: { ...text, maxLength: 100 }, minimumPassRate: { type: 'number', minimum: 0, maximum: 1 },
    requiresManualApproval:{type:'boolean'},manualApprovalTtlSeconds:{type:'integer',minimum:60,maximum:86400}
  } },
  run: { type: 'object', additionalProperties: false, required: ['agentVersionId', 'datasetVersionId', 'policyVersionId'], properties: {
    agentVersionId: { ...text, maxLength: 80 }, datasetVersionId: { ...text, maxLength: 80 }, policyVersionId: { ...text, maxLength: 80 },
    timeoutMs: { type: 'integer', minimum: 100, maximum: 120000 }, caseBudget: { type: 'integer', minimum: 1, maximum: 100 }, maxAttempts: { type: 'integer', minimum: 1, maximum: 5 }
  } }
};
const validators = Object.fromEntries(Object.entries(schemas).map(([key, schema]) => [key, ajv.compile(schema)]));

// Deliberately bounded JSON Schema subset: no references, regex, custom code or remote resolution.
export function compileEvidenceSchema(schema, depth = 0) {
  const allowed = ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems'];
  function inspect(node, level) {
    if (!node || typeof node !== 'object' || Array.isArray(node) || level > 6) throw new InputError('Schema must be an object with depth <= 6.');
    if (Object.keys(node).some(key => !allowed.includes(key))) throw new InputError('Unsupported JSON Schema keyword.');
    if (node.type && !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(node.type)) throw new InputError('Unsupported schema type.');
    if (node.additionalProperties !== undefined && typeof node.additionalProperties !== 'boolean') throw new InputError('additionalProperties must be boolean.');
    if (node.properties) {
      if (typeof node.properties !== 'object' || Array.isArray(node.properties) || Object.keys(node.properties).length > 30) throw new InputError('Invalid schema properties.');
      for (const child of Object.values(node.properties)) inspect(child, level + 1);
    }
    if (node.items) inspect(node.items, level + 1);
    if (node.enum && (!Array.isArray(node.enum) || node.enum.length > 30)) throw new InputError('Schema enum is too large.');
  }
  inspect(schema, depth);
  try { return new Ajv({ strict: true, allErrors: true }).compile(schema); }
  catch { throw new InputError('Invalid evidence JSON Schema.'); }
}

export function validate(kind, value) {
  const pending = [[value, 0]]; let nodes = 0;
  while (pending.length) {
    const [item, depth] = pending.pop();
    if (++nodes > 30000 || depth > 16) throw new InputError('Input nesting or node budget exceeded.');
    if (item && typeof item === 'object') for (const child of Object.values(item)) pending.push([child, depth + 1]);
  }
  if (!validators[kind]?.(value)) throw new InputError(`Invalid ${kind}: ${ajv.errorsText(validators[kind]?.errors)}`);
  if(kind==='policy'&&value.manualApprovalTtlSeconds!==undefined&&value.requiresManualApproval!==true)throw new InputError('Approval validity requires a manual approval policy.');
  if (kind === 'agent' && (value.mode === 'https') !== (value.connectorId !== undefined && value.endpointHash !== undefined)) throw new InputError('HTTPS agents require a connectorId and endpointHash; mock agents cannot use connection fields.');
  if (kind === 'agent' && value.mode !== 'https' && (value.connectorId !== undefined || value.endpointHash !== undefined)) throw new InputError('Mock agents cannot use connection fields.');
  if (kind === 'dataset') {
    const caseIds = new Set();
    for (const c of value.cases) {
      if (caseIds.has(c.id)) throw new InputError('Duplicate case id.');
      caseIds.add(c.id);
      if (!c.rules.some(r => r.required !== false)) throw new InputError('Each case needs a required rule.');
      const ids = new Set();
      for (const r of c.rules) {
        if (ids.has(r.id)) throw new InputError('Duplicate rule id.');
        ids.add(r.id);
        const expected = { contains: ['value'], not_contains: ['value'], json_schema: ['schema'], allowed_tools: ['allowed', 'argumentSchemas'] }[r.type];
        if (expected.some(k => r[k] === undefined && k !== 'argumentSchemas')) throw new InputError(`Missing rule configuration for ${r.type}.`);
        for (const k of ['value', 'schema', 'allowed', 'argumentSchemas']) if (r[k] !== undefined && !expected.includes(k)) throw new InputError('Irrelevant rule configuration.');
        if (r.schema) compileEvidenceSchema(r.schema);
        for (const [name, schema] of Object.entries(r.argumentSchemas || {})) {
          if (!r.allowed.includes(name)) throw new InputError('Argument schema references an unallowed tool.');
          compileEvidenceSchema(schema);
        }
      }
    }
  }
  return structuredClone(value);
}
