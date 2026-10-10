import math
from features import rule_features
from app import evaluate
import json
from uuid import uuid4
from fastapi.testclient import TestClient
from app import app


def test_repeatable_normalized_features_and_meaningful_rule_difference():
    passed = rule_features(evaluate('pass'))
    blocked = rule_features(evaluate('block'))
    assert len(passed) == 64 and passed == rule_features(evaluate('pass'))
    assert math.isclose(sum(v * v for v in passed), 1, abs_tol=1e-6)
    assert sum(a * b for a, b in zip(passed, passed)) > sum(a * b for a, b in zip(passed, blocked))
    assert all(math.isfinite(v) and 0 <= v <= 1 for v in blocked)


def test_feature_endpoint_is_authenticated_scoped_and_strict(tmp_path, monkeypatch):
    token = tmp_path / 'worker-token'
    token.write_text('a' * 64)
    monkeypatch.setenv('STACK_WORKER_TOKEN_FILE', str(token))
    client = TestClient(app)
    body = {**{key: str(uuid4()) for key in ('runId', 'organizationId', 'projectId')},
            'contentSha256': 'b' * 64, 'result': evaluate('block')}
    headers = {'X-AgentTrust-Worker-Token': 'a' * 64}
    assert client.post('/features', json=body).status_code == 401
    response = client.post('/features', json=body, headers=headers)
    assert response.status_code == 200 and response.json()['runId'] == body['runId']
    assert len(response.json()['vector']) == 64
    assert client.post('/features', json={**body, 'providerUrl': 'http://outside.invalid'}, headers=headers).status_code == 422
    assert client.post('/features', json={**body, 'organizationId': 'foreign'}, headers=headers).status_code == 422
    assert client.post('/features', json={**body, 'result': {**body['result'], 'rules': []}}, headers=headers).status_code == 422
