import json
import pathlib
import unittest
from uuid import uuid4
from connector_evaluator import sample, evaluate
from connector_profiles import execution_profile
from connector_worker import process, scoped_job
from test_connector_evaluator import cases

def job():
    return {**{name: str(uuid4()) for name in ['runId', 'organizationId', 'projectId', 'campaignId', 'agentVersionId', 'datasetVersionId']},
            'scenario': 'quality', 'provider': 'synthetic', 'caseId': cases()[0]['id'], 'connectorCase': sample(cases()[0]),
            'executionProfileSha256': execution_profile()['contentSha256']}

class Message:
    def __init__(self, value): self.data=json.dumps(value).encode(); self.actions=[]
    async def ack_sync(self, **kwargs): self.actions.append('ack')
    async def term(self): self.actions.append('term')
    async def nak(self, **kwargs): self.actions.append('nak')

class Client:
    def __init__(self, mismatch=False, unavailable=False): self.calls=[]; self.mismatch=mismatch; self.unavailable=unavailable
    async def post(self, path, **kwargs):
        self.calls.append((path, kwargs)); body=kwargs['json']
        if path.endswith('/recorded-grade'):
            result={'caseSha256':body['sample']['contentSha256'],'statuses':[r['status'] for r in evaluate(body['sample'])['rules']],
                    'engine':'ajv-flat-object-v1','ajvVersion':'8.20.0','validatorProfileSha256':body['validatorProfileSha256']}
            if self.mismatch: result['statuses'][0]='fail'
            code=503 if self.unavailable else 200
        else: result={'accepted':True,'runId':body['runId']}; code=200
        class Response:
            status_code=code
            def json(self): return result
        return Response()

class ConnectorWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_actual_admitted_sample_reaches_only_verifier_and_completion(self):
        value=job(); message,client=Message(value),Client();await process(message,client,'in-memory-placeholder')
        self.assertEqual(['ack'],message.actions)
        self.assertEqual(['http://stack-quality-verifier:9105/recorded-grade','/internal/completions'],[path for path,_ in client.calls])
        self.assertEqual('pass',client.calls[-1][1]['json']['result']['decision'])
    async def test_disagreement_or_unavailable_verifier_cannot_complete_as_pass(self):
        for client in [Client(mismatch=True),Client(unavailable=True)]:
            message=Message(job());await process(message,client,'in-memory-placeholder')
            self.assertEqual(('failed','inconclusive'),(client.calls[-1][1]['json']['result']['state'],client.calls[-1][1]['json']['result']['decision']))
    async def test_foreign_case_and_mixed_old_payload_never_call_transport(self):
        for change in [{'caseId':'other'},{'provider':'ollama'},{'qualityCase':{}},{'recordedCase':{}}]:
            value={**job(),**change};message,client=Message(value),Client();await process(message,client,'in-memory-placeholder')
            self.assertEqual(['term'],message.actions);self.assertEqual([],client.calls)
    def test_installed_source_profile_and_protocol_are_exact(self):
        stored=json.loads(pathlib.Path(__file__).with_name('connector-execution-profile.json').read_text(encoding='utf-8'));self.assertEqual(stored,execution_profile())
        value=job();self.assertEqual(value,scoped_job(json.dumps(value).encode()))
        raw=json.dumps(value)
        with self.assertRaises(ValueError): scoped_job((raw[:-1]+',"provider":"synthetic"}').encode())
        with self.assertRaises(ValueError): scoped_job(b' '*4097)

class ConnectorReadinessTests(unittest.IsolatedAsyncioTestCase):
    async def test_live_consumer_identity_and_configuration_fail_closed(self):
        import sys, types
        from unittest.mock import patch
        import connector_worker as worker
        policy=types.SimpleNamespace(EXPLICIT='explicit')
        api=types.ModuleType('nats.js.api');api.AckPolicy=policy
        class Connection:
            is_connected=True
            def __init__(self): self.change={}; self.calls=0
            def jetstream(self, timeout): return self
            async def consumer_info(self, stream, durable):
                self.calls+=1
                config=dict(durable_name=worker.DURABLE,filter_subject=worker.SUBJECT,ack_policy='explicit',ack_wait=15,max_deliver=20,max_ack_pending=8)
                config.update(self.change)
                return types.SimpleNamespace(stream_name=worker.STREAM,name=worker.DURABLE,config=types.SimpleNamespace(**config))
        connection=Connection()
        with patch.dict(sys.modules,{'nats.js.api':api}),patch.dict(worker.state,{'ready':True,'connection':connection}):
            self.assertTrue(await worker.queue_ready())
            for change in [{'filter_subject':'>'},{'max_ack_pending':99},{'ack_policy':'none'},{'durable_name':'other'}]:
                connection.change=change;self.assertFalse(await worker.queue_ready())
            worker.state['ready']=False;before=connection.calls;self.assertFalse(await worker.queue_ready());self.assertEqual(before,connection.calls)
            worker.state['ready']=True;connection.is_connected=False;self.assertFalse(await worker.queue_ready())

if __name__=='__main__': unittest.main()
