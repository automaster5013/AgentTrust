"""Coherent isolated recovery plus real provider-signed public logout acceptance."""
import argparse,importlib.util,json,pathlib

spec=importlib.util.spec_from_file_location('coherent',pathlib.Path(__file__).with_name('stack-coherent-recovery.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)

class PublicIdentityRehearsal(base.Rehearsal):
    def recovered_application_extension(self,config,credential,tools):
        self.stage('real-provider-signed-public-logout')
        before=base.fingerprint()
        settings=dict(value.split('=',1) for value in config['stack-identity']['env'])
        source=self.directory/'identity-probe-input.json'
        base.private_file(source,json.dumps({'username':settings.get('KC_BOOTSTRAP_ADMIN_USERNAME','stack-admin'),
            'password':settings['KC_BOOTSTRAP_ADMIN_PASSWORD']}).encode())
        source.chmod(0o444);self.private.append(source)
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
        self.report.update(publicIdentityDevelopmentAcceptanceVerified=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--execute',action='store_true')
    parser.add_argument('--exercise-key-rotation',action='store_true');parser.add_argument('--exercise-load',action='store_true');parser.add_argument('--load-cycles',type=int,default=1);args=parser.parse_args()
    if not 1<=args.load_cycles<=120 or args.load_cycles!=1 and not args.exercise_load:parser.error('Load cycles require --exercise-load and must be within 1..120')
    try:sources=base.source_preflight()
    except Exception as error:
        print(json.dumps({'completed':False,'stage':'read-only-preflight','errorType':type(error).__name__}));return 1
    if not args.execute:
        print(json.dumps({'completed':True,'mode':'read-only-preflight','actualRecoveryPerformed':False}));return 0
    drill=PublicIdentityRehearsal(sources,args.exercise_key_rotation,args.exercise_load,args.load_cycles)
    try:drill.execute()
    except Exception as error:drill.report.update(completed=False,errorType=type(error).__name__,code='PUBLIC_IDENTITY_RECOVERY_UNVERIFIED')
    finally:drill.cleanup()
    print(json.dumps({**drill.report,'reportPath':str(drill.directory/'summary.json')}));return 0 if drill.report['completed'] else 1

if __name__=='__main__':raise SystemExit(main())
