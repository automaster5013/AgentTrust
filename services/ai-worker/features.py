"""Versioned lexical rule features; these are not learned semantic embeddings."""
import hashlib
import math
import re

VERSION = 'rule-features-v1'
DIMENSIONS = 64


def rule_features(result: dict) -> list[float]:
    vector = [0.0] * DIMENSIONS

    def add(token: str, weight: float):
        position = int.from_bytes(hashlib.sha256(token.encode('utf-8')).digest()[:4], 'big') % DIMENSIONS
        vector[position] += weight

    add('state:' + result['state'], 3)
    add('decision:' + result['decision'], 5)
    for rule in result['rules']:
        add('rule:' + rule['id'], 3)
        add('status:' + rule['status'], 5)
        add('required:' + str(rule['required']), 2)
        for token in re.findall(r'[a-z0-9]+', rule['reason'].lower()):
            add('text:' + token, 1)
    length = math.sqrt(sum(value * value for value in vector))
    if not length:
        raise ValueError('Empty feature vector')
    return [round(value / length, 8) for value in vector]
