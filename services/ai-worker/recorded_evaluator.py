"""Bounded recorded synthetic text, with no provider calls or executable rules."""
import hashlib
import json
import re

CONTRACT = 'recorded-text-rules-v1'
CASE_CONTRACT = 'recorded-text-case-v1'
IDENTIFIER = re.compile(r'^[a-z][a-z0-9-]{0,63}$')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')


def text(value, limit, nonempty=False):
    if not isinstance(value, str) or '\x00' in value or nonempty and not value:
        raise ValueError('Invalid recorded text')
    try:
        if len(value.encode('utf-8', errors='strict')) > limit:
            raise ValueError('Oversized recorded text')
    except UnicodeError as error:
        raise ValueError('Invalid recorded Unicode') from error
    return value


def identifier(value):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ValueError('Invalid recorded identifier')


def validate_definition_case(value):
    if not isinstance(value, dict) or set(value) != {'id', 'scenario', 'required', 'input', 'output', 'rules'}:
        raise ValueError('Invalid recorded case fields')
    identifier(value['id'])
    if value['scenario'] != 'quality' or type(value['required']) is not bool:
        raise ValueError('Invalid recorded case')
    text(value['input'], 512)
    text(value['output'], 512)
    rules = value['rules']
    if not isinstance(rules, list) or not 1 <= len(rules) <= 4:
        raise ValueError('Invalid recorded rule count')
    seen = set()
    for rule in rules:
        if not isinstance(rule, dict) or set(rule) != {'id', 'type', 'required', 'value'}:
            raise ValueError('Invalid recorded rule fields')
        identifier(rule['id'])
        if rule['id'] in seen or rule['type'] not in ('contains', 'not_contains') or type(rule['required']) is not bool:
            raise ValueError('Invalid recorded rule')
        seen.add(rule['id'])
        text(rule['value'], 64, nonempty=True)
    if not any(rule['required'] for rule in rules) or len(canonical(value)) > 2048:
        raise ValueError('Invalid recorded case bounds')
    return value


def sample(value):
    validate_definition_case(value)
    body = {'contract': CASE_CONTRACT, 'case': value}
    return {**body, 'contentSha256': hashlib.sha256(canonical(body)).hexdigest()}


def validate_sample(value):
    if not isinstance(value, dict) or set(value) != {'contract', 'case', 'contentSha256'} or value['contract'] != CASE_CONTRACT:
        raise ValueError('Invalid recorded sample fields')
    expected = sample(value['case'])
    if value != expected:
        raise ValueError('Recorded sample differs')
    return value['case']


def unavailable():
    return {'state': 'failed', 'decision': 'inconclusive', 'rules': [
        {'id': 'recorded-text-execution', 'required': True, 'status': 'inconclusive',
         'reason': 'Recorded text evaluation was unavailable.'}
    ], 'executionEngine': 'python-synthetic'}


def evaluate(value):
    case = validate_sample(value)
    rules = []
    for declared in case['rules']:
        contains = declared['value'] in case['output']
        passed = contains if declared['type'] == 'contains' else not contains
        rules.append({'id': declared['id'], 'required': declared['required'],
                      'status': 'pass' if passed else 'fail',
                      'reason': f"Recorded text {declared['type']} rule {'passed' if passed else 'failed'}."})
    return {'state': 'succeeded', 'decision': 'block' if any(rule['required'] and rule['status'] == 'fail' for rule in rules) else 'pass',
            'rules': rules, 'executionEngine': 'python-synthetic'}
