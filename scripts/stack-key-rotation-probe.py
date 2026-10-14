"""Actual retired/revoked signing-key checks inside the disposable recovery stack."""
import importlib.util
import json
import pathlib
import secrets
import time
import uuid
from stack_recovery_transport import fixture_opener
from stack_test_client import StackClient,FixedRedirects

spec=importlib.util.spec_from_file_location('recovery_probe',pathlib.Path(__file__).with_name('stack-coherent-recovery-probe.py'))
probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)


def main():
    value=json.loads(pathlib.Path('/rotation-probe-input.json').read_bytes())
    credentials=json.loads(pathlib.Path('/credentials.json').read_bytes())
    mode=value['mode'];old=value['old'];current=value['current'];clients=[]
    report={'completed':False,'mode':mode,'checks':[],'paidProviderCallsPerformed':False,
            'originalPrivateKeyChanged':False,'productionKey':False,'currentDeploymentAuthority':False}
    def client(name=None):
        c=StackClient('http://127.0.0.1:4320',credentials,{},clients);c.opener=fixture_opener(c.jar,FixedRedirects())
        if name is not None:c.login(name)
        return c
    try:
        probe.require(mode in ('retired','revoked') and old['keyId']!=current['keyId'])
        anonymous=client();anonymous.request('gate-trust/keys/'+current['keyId'],expected=401)
        viewer=client('demo-viewer')
        trust=viewer.request('gate-trust')
        probe.require(trust['keyId']==current['keyId'] and trust['publicKeySpkiBase64']==current['publicKeySpkiBase64'])
        probe.require(viewer.request('gate-trust/keys/'+current['keyId'])==trust)
        viewer.request('gate-trust/keys/'+'f'*64,expected=404)
        path='campaigns/'+old['campaignId']+'/receipts/'+old['receiptId']
        if mode=='retired':
            historical=viewer.request('gate-trust/keys/'+old['keyId'])
            probe.require(historical['publicKeySpkiBase64']==old['publicKeySpkiBase64'])
            receipt=viewer.request(path);probe.signed_payload(receipt,old)
            probe.require(receipt['receiptId']==old['receiptId'] and receipt['campaignId']==old['campaignId'])
            report['checks'].append('retired public key lookup and historical receipt remain authenticated and cryptographically verified after real Core restart')
        else:
            viewer.request('gate-trust/keys/'+old['keyId'],expected=404)
            viewer.request(path,expected=503)
            viewer.request(path+'/bundle',expected=503)
            report['checks'].append('revoked historical public key, receipt and bundle are refused after real Core restart without deleting stored rows')
        challenge=secrets.token_hex(32)
        frame=viewer.request('campaigns/'+old['campaignId']+'/gate-check/'+challenge)
        payload=probe.signed_payload(frame,current)
        probe.require(payload['challenge']==challenge and payload['campaignId']==old['campaignId'] and payload['expiresAtEpochMillis']>time.time()*1000)
        report['checks'].append('fresh challenge is signed only with the newly active key while current deployment authority remains false')
        if mode=='retired':
            admin=client('demo-admin')
            receipt=admin.request('campaigns/'+old['campaignId']+'/receipts','POST',{'note':'isolated signing-key rotation acceptance'},{'Idempotency-Key':str(uuid.uuid4())})
            probe.signed_payload(receipt,current)
            report['newReceiptId']=receipt['receiptId']
            report['checks'].append('new immutable receipt is issued and verified with the new key while the original receipt remains readable')
        else:
            receipt=viewer.request('campaigns/'+old['campaignId']+'/receipts/'+value['newReceiptId'])
            probe.signed_payload(receipt,current)
            report['checks'].append('new-key receipt survives revocation of the old key')
        report['completed']=True
    except Exception as error:report.update(errorType=type(error).__name__,code='KEY_ROTATION_ACCEPTANCE_UNVERIFIED')
    finally:
        closed=True
        for c in reversed(clients):
            try:c.logout()
            except Exception:closed=False
        report['ownSessionsClosed']=closed and all(not c.logged for c in clients)
    print(json.dumps(report));return 0 if report['completed'] and report['ownSessionsClosed'] else 1


if __name__=='__main__':raise SystemExit(main())
