from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from app import app, evaluate


@pytest.fixture
def client(tmp_path, monkeypatch):
    path = tmp_path / 'worker-token'
    path.write_text('a' * 64)
    monkeypatch.setenv('STACK_WORKER_TOKEN_FILE', str(path))
    return TestClient(app)


def request():
    return {'scenario': 'pass', **{key: str(uuid4()) for key in ('runId', 'organizationId', 'projectId')}}


def test_required_failures_never_pass():
    assert evaluate('block')['decision'] == 'block'
    assert evaluate('missing_evidence')['decision'] == 'inconclusive'
    assert evaluate('error')['state'] == 'failed'


def test_auth_scope_and_strict_body(client):
    body = request()
    assert client.post('/evaluate', json=body).status_code == 401
    headers = {'X-AgentTrust-Worker-Token': 'a' * 64}
    response = client.post('/evaluate', json=body, headers=headers)
    assert response.status_code == 200
    assert response.json()['organizationId'] == body['organizationId']
    assert response.json()['result']['executionEngine'] == 'python-synthetic'
    assert client.post('/evaluate', json={**body, 'providerUrl': 'https://outside.invalid'}, headers=headers).status_code == 422
    assert client.post('/evaluate', json={**body, 'runId': 'foreign'}, headers=headers).status_code == 422


def test_body_bound_and_media_type(client):
    assert client.post('/evaluate', content=b'x' * 4097, headers={'Content-Type': 'application/json'}).status_code == 413
    assert client.post('/evaluate', content='text').status_code == 415
