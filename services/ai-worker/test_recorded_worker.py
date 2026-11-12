import copy
import json
import pathlib
import unittest
from uuid import uuid4
from recorded_evaluator import sample
from recorded_profiles import execution_profile
from recorded_worker import scoped_job, process
from test_recorded_evaluator import case


def job():
    return {**{key: str(uuid4()) for key in ['runId', 'organizationId', 'projectId', 'campaignId', 'agentVersionId', 'datasetVersionId']},
            'caseId': 'refund', 'scenario': 'quality', 'provider': 'synthetic', 'recordedCase': sample(case()),
            'executionProfileSha256': execution_profile()['contentSha256']}


class Message:
    def __init__(self, value):
        self.data = json.dumps(value).encode()
        self.actions = []
    async def term(self): self.actions.append('term')
    async def ack_sync(self, **kwargs): self.actions.append('ack')
    async def nak(self, **kwargs): self.actions.append('nak')


class Client:
    def __init__(self, status=200):
        self.calls = []
        self.status = status
    async def post(self, path, **kwargs):
        self.calls.append((path, kwargs))
        status, run_id = self.status, kwargs['json']['runId']
        class Response:
            status_code = status
            def json(self): return {'accepted': True, 'runId': run_id}
        return Response()


class RecordedJobTests(unittest.TestCase):
    def test_exact_scope_contract_and_duplicate_fields(self):
        value = job()
        self.assertEqual(value, scoped_job(json.dumps(value).encode()))
        for change in [{'provider': 'ollama'}, {'scenario': 'pass'}, {'runId': 'invalid'}, {'caseId': 'other'},
                       {'qualityCase': {}}, {'url': 'https://untrusted'}, {'executionProfileSha256': 'bad'}]:
            with self.assertRaises(ValueError):
                scoped_job(json.dumps({**value, **change}).encode())
        for key in value:
            missing = {k: v for k, v in value.items() if k != key}
            with self.assertRaises(ValueError):
                scoped_job(json.dumps(missing).encode())
        raw = json.dumps(value)
        with self.assertRaises(ValueError):
            scoped_job((raw[:-1] + ',"provider":"synthetic"}').encode())
        with self.assertRaises(ValueError):
            scoped_job(b' ' * 4097)
        nested = copy.deepcopy(value)
        nested['recordedCase']['case']['output'] = 'changed'
        with self.assertRaises(ValueError):
            scoped_job(json.dumps(nested).encode())

    def test_cross_language_case_digest_is_stable(self):
        self.assertEqual('ba742a16bb6867984245bc937614872afa93d12bed2ce555b547e2e95430f693', sample(case())['contentSha256'])

    def test_snapshot_matches_the_installed_evaluator_sources(self):
        stored = json.loads(pathlib.Path(__file__).with_name('recorded-text-execution-profile.json').read_text(encoding='utf-8'))
        self.assertEqual(stored, execution_profile())


class RecordedDeliveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_authenticated_completion_is_requested(self):
        message, client = Message(job()), Client()
        await process(message, client, 'in-memory-test-placeholder')
        self.assertEqual(['ack'], message.actions)
        self.assertEqual(['/internal/completions'], [path for path, _ in client.calls])
        self.assertEqual('pass', client.calls[0][1]['json']['result']['decision'])
        self.assertIn('X-AgentTrust-Worker-Token', client.calls[0][1]['headers'])

    async def test_profile_mismatch_is_inconclusive_and_ambiguous_completion_retries(self):
        value = job()
        value['executionProfileSha256'] = 'a' * 64
        message, client = Message(value), Client(503)
        await process(message, client, 'in-memory-test-placeholder')
        self.assertEqual(['nak'], message.actions)
        self.assertEqual('failed', client.calls[0][1]['json']['result']['state'])
        self.assertEqual('inconclusive', client.calls[0][1]['json']['result']['decision'])

    async def test_invalid_binding_never_calls_completion_and_conflict_terminates(self):
        value = job()
        value['caseId'] = 'other'
        message, client = Message(value), Client()
        await process(message, client, 'in-memory-test-placeholder')
        self.assertEqual(['term'], message.actions)
        self.assertEqual([], client.calls)
        message, client = Message(job()), Client(409)
        await process(message, client, 'in-memory-test-placeholder')
        self.assertEqual(['term'], message.actions)


if __name__ == '__main__': unittest.main()
