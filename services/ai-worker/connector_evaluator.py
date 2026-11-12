"""Recorded observations only: literal text, tool allowlists and flat string-object schemas."""
import hashlib
import json
import re
from recorded_evaluator import canonical, text, identifier

CONTRACT = 'recorded-connector-rules-v1'
CASE_CONTRACT = 'recorded-connector-case-v1'
KEY = re.compile(r'^[A-Za-z][A-Za-z0-9_-]{0,63}$')


def fields(value, names, optional=()):
    if not isinstance(value, dict) or not set(names) <= set(value) or set(value) - set(names) - set(optional):
        raise ValueError('Invalid connector fields')


def key(value):
    if not isinstance(value, str) or not KEY.fullmatch(value) or value in ('constructor', 'prototype', '__proto__'):
        raise ValueError('Invalid connector key')
    return value


def flat_schema(value):
    fields(value, ('type', 'properties', 'required', 'additionalProperties'))
    if value['type'] != 'object' or value['additionalProperties'] is not False:
        raise ValueError('Unsupported connector schema')
    props, required = value['properties'], value['required']
    if not isinstance(props, dict) or len(props) > 8 or not isinstance(required, list) or len(required) > 8:
        raise ValueError('Invalid connector schema bounds')
    for name, schema in props.items():
        key(name)
        fields(schema, ('type',), ('enum', 'minLength', 'maxLength'))
        if schema['type'] != 'string':
            raise ValueError('Only flat string properties are supported')
        for name in ('minLength', 'maxLength'):
            if name in schema and (type(schema[name]) is not int or not 0 <= schema[name] <= 512):
                raise ValueError('Invalid connector string length')
        if schema.get('minLength', 0) > schema.get('maxLength', 512):
            raise ValueError('Inconsistent connector string length')
        if 'enum' in schema:
            options = schema['enum']
            if not isinstance(options, list) or not 1 <= len(options) <= 8:
                raise ValueError('Invalid connector enum')
            for option in options:
                text(option, 128)
            if len(set(options)) != len(options):
                raise ValueError('Duplicate connector enum')
    if any(not isinstance(name, str) or name not in props for name in required) or len(set(required)) != len(required):
        raise ValueError('Invalid required connector properties')
    return value


def schema_matches(schema, data):
    flat_schema(schema)
    if not isinstance(data, dict) or len(data) > 8 or set(data) - set(schema['properties']) or any(name not in data for name in schema['required']):
        return False
    for name, value in data.items():
        if not isinstance(value, str):
            return False
        try:
            text(value, 512)
        except ValueError:
            return False
        declared = schema['properties'][name]
        if not declared.get('minLength', 0) <= len(value) <= declared.get('maxLength', 512):
            return False
        if 'enum' in declared and value not in declared['enum']:
            return False
    return True


def observation(value):
    fields(value, ('output', 'toolEvents'))
    if value['output'] is not None:
        text(value['output'], 512)
    events = value['toolEvents']
    if events is not None:
        if not isinstance(events, list) or len(events) > 4:
            raise ValueError('Invalid connector event count')
        for event in events:
            fields(event, ('name', 'args'))
            if event['name'] is not None:
                text(event['name'], 64)
            args = event['args']
            if args is not None:
                if not isinstance(args, dict) or len(args) > 8:
                    raise ValueError('Invalid recorded arguments')
                for name, item in args.items():
                    key(name)
                    text(item, 128)
    return value


def definition_case(value):
    fields(value, ('id', 'scenario', 'required', 'input', 'evidence', 'rules'))
    identifier(value['id'])
    if value['scenario'] != 'quality' or type(value['required']) is not bool:
        raise ValueError('Invalid connector case')
    text(value['input'], 512)
    observation(value['evidence'])
    rules = value['rules']
    if not isinstance(rules, list) or not 1 <= len(rules) <= 4:
        raise ValueError('Invalid connector rule count')
    seen = set()
    for rule in rules:
        if not isinstance(rule, dict):
            raise ValueError('Invalid connector rule')
        identifier(rule.get('id'))
        if rule['id'] in seen or type(rule.get('required')) is not bool:
            raise ValueError('Invalid connector rule identity')
        seen.add(rule['id'])
        kind = rule.get('type')
        if kind in ('contains', 'not_contains'):
            fields(rule, ('id', 'type', 'required', 'value'))
            text(rule['value'], 64, nonempty=True)
        elif kind == 'json_schema':
            fields(rule, ('id', 'type', 'required', 'schema'))
            flat_schema(rule['schema'])
        elif kind == 'allowed_tools':
            fields(rule, ('id', 'type', 'required', 'allowed'), ('argumentSchemas',))
            allowed = rule['allowed']
            if not isinstance(allowed, list) or len(allowed) > 4:
                raise ValueError('Invalid tool allowlist')
            for item in allowed:
                key(item)
            if len(set(allowed)) != len(allowed):
                raise ValueError('Duplicate allowed tool')
            schemas = rule.get('argumentSchemas', {})
            if not isinstance(schemas, dict) or set(schemas) - set(allowed):
                raise ValueError('Invalid argument schemas')
            for schema in schemas.values():
                flat_schema(schema)
        else:
            raise ValueError('Unsupported connector rule')
    if not any(rule['required'] for rule in rules) or len(canonical(value)) > 3072:
        raise ValueError('Connector case exceeds limits')
    return value


def sample(value):
    body = {'contract': CASE_CONTRACT, 'case': definition_case(value)}
    return {**body, 'contentSha256': hashlib.sha256(canonical(body)).hexdigest()}


def validate_sample(value):
    fields(value, ('contract', 'case', 'contentSha256'))
    if value['contract'] != CASE_CONTRACT or value != sample(value['case']):
        raise ValueError('Connector sample differs')
    return value['case']


def unique_object(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise ValueError('Duplicate JSON property')
        result[name] = value
    return result


def rule_status(rule, evidence):
    kind = rule['type']
    if kind == 'allowed_tools':
        events = evidence['toolEvents']
        if events is None:
            return 'inconclusive'
        for event in events:
            if event['name'] is None or event['args'] is None:
                return 'inconclusive'
            if event['name'] not in rule['allowed']:
                return 'fail'
            schema = rule.get('argumentSchemas', {}).get(event['name'])
            if schema is not None and not schema_matches(schema, event['args']):
                return 'fail'
        return 'pass'
    output = evidence['output']
    if output is None:
        return 'inconclusive'
    if kind in ('contains', 'not_contains'):
        present = rule['value'] in output
        return 'pass' if present == (kind == 'contains') else 'fail'
    try:
        data = json.loads(output, object_pairs_hook=unique_object, parse_constant=lambda _: None)
        return 'pass' if schema_matches(rule['schema'], data) else 'fail'
    except (ValueError, TypeError, RecursionError):
        return 'fail'


def evaluate(value):
    case = validate_sample(value)
    rules = [{'id': rule['id'], 'required': rule['required'], 'status': rule_status(rule, case['evidence']),
              'reason': 'Recorded connector ' + rule['type'] + ' rule evaluated.'} for rule in case['rules']]
    required = [rule for rule in rules if rule['required']]
    decision = 'block' if any(rule['status'] == 'fail' for rule in required) else 'inconclusive' if any(rule['status'] == 'inconclusive' for rule in required) else 'pass'
    return {'state': 'succeeded', 'decision': decision, 'rules': rules, 'executionEngine': 'python-synthetic'}


def unavailable():
    return {'state': 'failed', 'decision': 'inconclusive', 'rules': [
        {'id': 'recorded-connector-execution', 'required': True, 'status': 'inconclusive',
         'reason': 'Recorded connector evaluation was unavailable.'}], 'executionEngine': 'python-synthetic'}
