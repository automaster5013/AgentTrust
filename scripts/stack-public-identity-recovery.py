"""Coherent isolated recovery plus real provider-signed public logout acceptance."""
import argparse,importlib.util,json,pathlib

spec=importlib.util.spec_from_file_location('coherent',pathlib.Path(__file__).with_name('stack-coherent-recovery.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)

class PublicIdentityRehearsal(base.Rehearsal):
    def build_fixture(self,config,decoded,fileprints):
        super().build_fixture(config,decoded,fileprints);self.configuration=config
    def execute(self):
        super().execute();self.report['completed']=False
        self.stage('real-provider-signed-public-logout')
        before=base.fingerprint()
        config=self.configuration
        settings=dict(value.split('=',1) for value in config['stack-identity']['env'])
        source=self.directory/'identity-probe-input.json'
        base.private_file(source,json.dumps({'username':settings.get('KC_BOOTSTRAP_ADMIN_USERNAME','stack-admin'),
            'password':settings['KC_BOOTSTRAP_ADMIN_PASSWORD']}).encode())
        source.chmod(0o444);self.private.append(source)
        credential=next(f['fixturePath'] for f in config['stack-core-api']['files'] if f['destination']=='/run/secrets/stack-demo-credentials')
        tools=json.loads(base.run(['docker','image','inspect','agenttrust-security:local']).stdout)[0]['Id']
        result=self.application_probe('public-identity',tools,'stack-public-identity-probe.py',credential,{source:'/identity-probe-input.json'},180)
        proof=json.loads(result.stdout);self.report['publicIdentityProof']=proof;self.save()
        if result.returncode or not all(proof.get(k) is True for k in ('completed','ownSessionsClosed','fixtureClientConfigurationRestored')):
            raise ValueError('Public identity recovery acceptance unavailable')
        if base.fingerprint()!=before:raise ValueError('Source business rows changed during public identity fixture')
        for service,source in self.sources.items():
            current=base.inspect(source['Id'])
            if current['Image']!=source['Image'] or not current['State']['Running']:
                raise ValueError('Source runtime changed during public identity fixture')
        self.check('real provider-signed public logout revokes only its matching session while unsigned requests are refused')
        self.report.update(completed=True,publicIdentityDevelopmentAcceptanceVerified=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    try:sources=base.source_preflight()
    except Exception as error:
        print(json.dumps({'completed':False,'stage':'read-only-preflight','errorType':type(error).__name__}));return 1
    if not args.execute:
        print(json.dumps({'completed':True,'mode':'read-only-preflight','actualRecoveryPerformed':False}));return 0
    drill=PublicIdentityRehearsal(sources)
    try:drill.execute()
    except Exception as error:drill.report.update(completed=False,errorType=type(error).__name__,code='PUBLIC_IDENTITY_RECOVERY_UNVERIFIED')
    finally:drill.cleanup()
    print(json.dumps({**drill.report,'reportPath':str(drill.directory/'summary.json')}));return 0 if drill.report['completed'] else 1

if __name__=='__main__':raise SystemExit(main())
