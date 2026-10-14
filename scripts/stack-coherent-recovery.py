"""Rehearse a coherent, encrypted cold recovery into a portless isolated stack.

Default is a read-only preflight. --execute briefly stops only existing transition
writers/stateful services, snapshots their cold volumes and private configuration,
then restores those same source containers before starting any fixture work.
No original volume is ever a restore target. This is a development rehearsal,
not a production backup, HA proof, operational RPO/RTO or deployment approval.
"""
import argparse
import base64
import datetime
import hashlib
import json
import os
import pathlib
import re
import secrets
import shutil
import subprocess
import time
import uuid
from stack_backup_tools import ALPINE, crypt
from stack_business_fingerprint import fingerprint, sql
from stack_coherent_archive import (COMPRESSED_LIMIT, TOTAL_LIMIT, SERVICES,
                                    STATEFUL, archive_fingerprints,
                                    validate_manifest, verify_component)
from stack_recovery_load_contract import cohort as validate_cohort

ROOT = pathlib.Path(__file__).resolve().parent.parent
QUIESCE = ('stack-console', 'stack-gateway', 'stack-ai-worker', 'stack-core-api',
           'stack-identity', 'stack-object-store', 'stack-nats', 'stack-redis', 'stack-db')
VOLUME_KEYS = {'stack-db': 'stack-postgres-data', 'stack-identity': 'stack-identity-data',
               'stack-nats': 'stack-nats-data', 'stack-redis': 'stack-redis-data',
               'stack-object-store': 'stack-object-data'}
PENDING = "SELECT count(*) FROM stack_runs r LEFT JOIN stack_run_results c ON c.run_id=r.id WHERE r.state='queued' AND c.run_id IS NULL;"


def run(args, data=None, timeout=60, check=True):
    result = subprocess.run(args, cwd=ROOT, input=data, capture_output=True, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError('COHERENT_RECOVERY_COMMAND_FAILED')
    return result


def inspect(name):
    return json.loads(run(['docker', 'inspect', name]).stdout)[0]


def digest(data):
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def reserve():
    minimum = (22 if os.name == 'nt' else 4) * 1073741824
    if shutil.disk_usage(ROOT).free < minimum + 1024 * 1024 * 1024:
        raise ValueError('Cold recovery disk reserve unavailable')


def private_file(path, data):
    with path.open('xb') as stream:
        stream.write(data)
    path.chmod(0o600)


def source_preflight():
    reserve()
    if os.name!='nt' and os.getuid()==0:
        raise ValueError('Nonroot rehearsal host required')
    sources = {}
    run(['docker', 'image', 'inspect', 'agenttrust-security:local'])
    run(['docker', 'image', 'inspect', ALPINE])
    for service in SERVICES:
        row = inspect('agenttrust-' + service + '-1')
        labels = row['Config']['Labels']
        if (labels.get('com.docker.compose.project') != 'agenttrust'
                or labels.get('com.docker.compose.service') != service
                or not row['State']['Running']
                or row['State'].get('Health', {}).get('Status') != 'healthy'
                or not re.fullmatch('sha256:[a-f0-9]{64}', row['Image'])
                or not row['HostConfig']['ReadonlyRootfs']
                or row['Config']['User'] in ('', '0', '0:0', 'root')):
            raise ValueError('Source transition identity unavailable')
        for mount in row['Mounts']:
            if mount['Type'] == 'bind':
                path = pathlib.Path(mount['Source'])
                # Docker Desktop can return the native host path or its Linux VM path.
                if os.name == 'nt' and str(path).startswith('/run/desktop/mnt/host/c/'):
                    path = pathlib.Path('C:/' + str(path)[len('/run/desktop/mnt/host/c/'):])
                if (path.is_symlink() or not path.is_file()
                        or not path.resolve().is_relative_to((ROOT/'.local/stack').resolve())
                        or path.stat().st_size > 1024 * 1024 or mount.get('RW')):
                    raise ValueError('Private source mount refused')
                mount['PrivateHostPath'] = str(path)
            elif mount['Type'] != 'volume':
                raise ValueError('Unexpected source mount kind')
        volumes = [m for m in row['Mounts'] if m['Type'] == 'volume']
        if service in STATEFUL:
            expected = 'agenttrust_' + VOLUME_KEYS[service]
            if len(volumes) != 1 or volumes[0]['Name'] != expected:
                raise ValueError('Source volume binding refused')
            volume = json.loads(run(['docker', 'volume', 'inspect', expected]).stdout)[0]
            if (volume['Labels'].get('com.docker.compose.project') != 'agenttrust'
                    or volume['Labels'].get('com.docker.compose.volume') != VOLUME_KEYS[service]):
                raise ValueError('Source volume labels refused')
        elif volumes:
            raise ValueError('Unexpected stateless source volume')
        if any('\n' in value or '\r' in value for value in row['Config']['Env']):
            raise ValueError('Multiline fixture environment refused')
        sources[service] = row
    if sql(PENDING) != '0':
        raise ValueError('Pending evaluation prevents cold recovery rehearsal')
    return sources


class Rehearsal:
    def __init__(self, sources, exercise_rotation=False, exercise_load=False):
        self.sources = sources
        self.id = str(uuid.uuid4())
        self.prefix = 'agenttrust-stack-coldrestore-' + self.id
        self.directory = ROOT/'.local'/('stack-coherent-recovery-' + self.id)
        self.directory.mkdir()
        self.directory.chmod(0o700)
        if os.name=='nt':
            owner=run(['whoami']).stdout.decode().strip()
            run(['icacls',str(self.directory),'/inheritance:r','/grant:r',owner+':(OI)(CI)F','SYSTEM:(OI)(CI)F'])
        self.exercise_rotation=exercise_rotation
        self.exercise_load=exercise_load
        self.history_path=None
        self.key = self.directory/'development-key.bin'
        self.stopped, self.containers, self.volumes, self.private = [], [], [], []
        self.network = False
        self.report = {'completed': False, 'fixtureId': self.id,
                       'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                       'checks': [], 'productionDeploymentPerformed': False,
                       'operationalBackupVerified': False, 'fullSystemRecoveryVerified': False,
                       'businessCriticalDevelopmentRecoveryVerified': False,
                       'legacyServicesChanged': False, 'existingVolumeRestoredOver': False,
                       'fixtureHostPortsPublished': False, 'rawSecretsPrinted': False,
                       'keyManagement': 'temporary-local-development-key',
                       'temporaryPrivateDirectoryOwnerProtected': True,
                       'developmentKeyRotationRequested': exercise_rotation,
                       'syntheticRecoveryLoadRequested': exercise_load,
                       'excludedFromRecovery': ['observability history', 'local model download cache',
                                                'external infrastructure and KMS', 'HA and production RPO/RTO']}

    def save(self):
        path = self.directory/'summary.json'
        temporary = path.with_suffix('.next.json')
        temporary.write_text(json.dumps(self.report, indent=2)+'\n', encoding='utf-8')
        temporary.replace(path)

    def stage(self, name):
        self.report['stage'] = name
        self.save()

    def check(self, name):
        self.report['checks'].append(name)
        self.save()

    def own_volume(self, volume):
        row = json.loads(run(['docker', 'volume', 'inspect', volume]).stdout)[0]
        if row.get('Labels', {}).get('agenttrust.fixture') != self.id:
            raise ValueError('Fixture volume ownership refused')

    def volume_command(self, volume, user, args, data=None, write=False, initialize=False):
        if write:
            self.own_volume(volume)
        command = ['docker', 'run', '--rm', '-i', '--network', 'none', '--read-only',
                   '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
                   '--memory', '192m', '--cpus', '2', '--pids-limit', '32',
                   '--user', '0:0' if initialize else user,
                   '--mount', 'type=volume,source='+volume+',target=/data'+('' if write else ',readonly')]
        if initialize:
            command += ['--cap-add', 'CHOWN']
        return run(command+[ALPINE]+args, data=data, timeout=120).stdout

    def snapshot_volume(self, service):
        source = self.sources[service]
        states=json.loads(run(['docker','inspect',*[self.sources[s]['Id'] for s in QUIESCE]]).stdout)
        if len(states)!=len(QUIESCE) or any(row['State']['Running'] for row in states):
            raise ValueError('Live source snapshot refused')
        volume = next(m['Name'] for m in source['Mounts'] if m['Type'] == 'volume')
        size = self.volume_command(volume, source['Config']['User'], ['du', '-sk', '/data']).split()[0]
        if not size.isdigit() or int(size) > TOTAL_LIMIT//1024:
            raise ValueError('Cold source volume exceeds bound')
        raw = self.volume_command(volume, source['Config']['User'], ['tar', '-C', '/data', '-czf', '-', '.'])
        if len(raw) > COMPRESSED_LIMIT:
            raise ValueError('Cold compressed volume exceeds bound')
        return raw, archive_fingerprints(raw)

    def wait(self, name, service, seconds=180):
        until = time.monotonic() + seconds
        self.report['readinessService']=service
        self.report['readinessTargetKind']='fixture' if name.startswith(self.prefix) else 'original-source'
        self.save()
        health = self.sources[service]['Config'].get('Healthcheck', {}).get('Test')
        if not health or health[0] not in ('CMD', 'CMD-SHELL'):
            raise ValueError('Explicit source health contract unavailable')
        while time.monotonic() < until:
            state = inspect(name)['State']
            if not state['Running']:
                raise ValueError('Recovered service stopped before readiness')
            arguments = health[1:] if health[0] == 'CMD' else ['sh', '-c', health[1]]
            try:
                if run(['docker', 'exec', name]+arguments, timeout=8, check=False).returncode == 0:
                    return
            except subprocess.TimeoutExpired:
                self.report['transientReadinessProbeTimeouts']=self.report.get('transientReadinessProbeTimeouts',0)+1
                self.save()
            time.sleep(1)
        raise TimeoutError('Recovered service readiness unavailable')

    def restore_source(self):
        if not self.stopped:
            return
        # Existing containers only: never build, initialize or recreate source services.
        for service in SERVICES:
            if service in self.stopped:
                source = self.sources[service]
                current = inspect(source['Id'])
                if current['Id'] != source['Id'] or current['Image'] != source['Image']:
                    raise ValueError('Original source runtime changed')
                if not current['State']['Running']:
                    run(['docker', 'start', source['Id']])
                self.wait(source['Id'], service)
                self.stopped.remove(service)

    def configuration(self):
        config = {}
        for service, source in self.sources.items():
            entry = {'imageId': source['Image'], 'user': source['Config']['User'],
                     'env': source['Config']['Env'], 'entrypoint': source['Config']['Entrypoint'],
                     'command': source['Config']['Cmd'], 'files': [],
                     'tmpfs': source['HostConfig'].get('Tmpfs') or {},
                     'memory': source['HostConfig']['Memory'], 'cpus': source['HostConfig'].get('NanoCpus') or 1000000000,
                     'pids': source['HostConfig'].get('PidsLimit') or 128,
                     'workingDirectory': source['Config']['WorkingDir']}
            for mount in source['Mounts']:
                if mount['Type'] == 'bind':
                    entry['files'].append({'destination': mount['Destination'],
                                           'content': base64.b64encode(pathlib.Path(mount['PrivateHostPath']).read_bytes()).decode('ascii')})
                else:
                    entry['volumeDestination'] = mount['Destination']
            config[service] = entry
        return json.dumps(config, separators=(',', ':')).encode()

    def build_fixture(self, config, snapshots, fileprints):
        run(['docker', 'network', 'create', '--internal', '--label', 'agenttrust.fixture='+self.id,
             '--label', 'com.docker.compose.project=agenttrust', self.prefix])
        self.network = True
        for service in STATEFUL:
            name = self.prefix+'-'+service
            run(['docker', 'volume', 'create', '--label', 'agenttrust.fixture='+self.id,
                 '--label', 'com.docker.compose.project=agenttrust', name])
            self.volumes.append(name)
            user = config[service]['user']
            self.volume_command(name, user, ['chown', user, '/data'], write=True, initialize=True)
            self.volume_command(name, user, ['tar', '-C', '/data', '-xzopf', '-'], data=snapshots[service], write=True)
            raw = self.volume_command(name, user, ['tar', '-C', '/data', '-czf', '-', '.'])
            if archive_fingerprints(raw) != fileprints[service]:
                raise ValueError('Restored physical state differs')
        self.check('all five restored state volumes have identical bounded file bytes and permissions before startup')
        for service in SERVICES:
            reserve()
            entry, name = config[service], self.prefix+'-'+service
            env = self.directory/(service+'.env')
            private_file(env, ('\n'.join(entry['env'])+'\n').encode())
            self.private.append(env)
            args = ['docker', 'run', '-d', '--name', name,
                    '--label', 'agenttrust.fixture='+self.id, '--label', 'com.docker.compose.project=agenttrust',
                    '--network', self.prefix, '--network-alias', service,
                    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
                    '--user', entry['user'], '--env-file', str(env),
                    '--memory', str(entry['memory']), '--cpus', str(entry['cpus']/1000000000),
                    '--pids-limit', str(entry['pids'])]
            if service == 'stack-ai-worker':
                args += ['-e', 'STACK_ENABLE_PAID_PROVIDERS=false', '-e', 'STACK_TELEMETRY_ENABLED=false']
            if service == 'stack-core-api':
                args += ['-e', 'OTEL_SDK_DISABLED=true']
                if self.exercise_rotation:
                    self.history_path=self.directory/'retired-public-keys.json'
                    private_file(self.history_path,b'{"schemaVersion":1,"keys":[]}')
                    self.history_path.chmod(0o444);self.private.append(self.history_path)
                    args+=['-e','STACK_GATE_RETIRED_KEYS_FILE=/run/secrets/stack-gate-retired-keys',
                           '--mount','type=bind,source='+str(self.history_path)+',target=/run/secrets/stack-gate-retired-keys,readonly']
            if entry['workingDirectory']:
                args += ['--workdir', entry['workingDirectory']]
            for destination, options in entry['tmpfs'].items():
                args += ['--tmpfs', destination+':'+options]
            for index, file in enumerate(entry['files']):
                path = self.directory/(service+'-secret-'+str(index))
                private_file(path, base64.b64decode(file['content'], validate=True))
                self.private.append(path)
                # Parent is owner-only on the host; mounted application bytes must be readable by its nonroot UID.
                path.chmod(0o444)
                file['fixturePath'] = str(path)
                args += ['--mount', 'type=bind,source='+str(path)+',target='+file['destination']+',readonly']
            if service in STATEFUL:
                args += ['--mount', 'type=volume,source='+name+',target='+entry['volumeDestination']]
            endpoint = entry['entrypoint'] or []
            args += ['--entrypoint', endpoint[0] if endpoint else '']
            args += [entry['imageId']]+endpoint[1:]+(entry['command'] or [])
            # Reserve the known name before Docker invocation so even a partial creation is cleaned.
            self.containers.append(name)
            run(args)
            self.wait(name, service)
            row = inspect(name)
            if (row['Image'] != entry['imageId'] or row['HostConfig']['PortBindings']
                    or set(row['NetworkSettings']['Networks']) != {self.prefix}
                    or not row['HostConfig']['ReadonlyRootfs']):
                raise ValueError('Fixture runtime isolation differs')
        network = json.loads(run(['docker', 'network', 'inspect', self.prefix]).stdout)[0]
        if not network['Internal'] or len(network['Containers']) != len(SERVICES):
            raise ValueError('Fixture network membership refused')
        self.check('eleven exact-image nonroot services start only on a fresh internal network without published ports')

    def replace_owned_private(self,path,data):
        if path not in self.private or path.is_symlink() or path.resolve().parent!=self.directory.resolve():
            raise ValueError('Fixture private replacement ownership refused')
        path.chmod(0o600)
        # Preserve the bind-mounted file inode while changing only owned fixture bytes.
        path.write_bytes(data);path.chmod(0o444)

    def application_probe(self,kind,tools,script,credential,mounts,timeout):
        if not re.fullmatch('[a-z-]{1,30}',kind) or script not in ('stack-coherent-recovery-probe.py','stack-key-rotation-probe.py','stack-recovery-load-probe.py'):
            raise ValueError('Fixture probe identity refused')
        paths=[pathlib.Path(credential),*[pathlib.Path(path) for path in mounts]]
        if any(path not in self.private or path.is_symlink() or path.resolve().parent!=self.directory.resolve() for path in paths):
            raise ValueError('Fixture probe private mount ownership refused')
        if any(destination not in ('/probe-anchor.json','/rotation-probe-input.json','/load-probe-input.json') for destination in mounts.values()):
            raise ValueError('Fixture probe mount destination refused')
        name=self.prefix+'-probe-'+kind
        self.containers.append(name)
        args=['docker','run','--rm','--name',name,'--label','agenttrust.fixture='+self.id,
              '--label','com.docker.compose.project=agenttrust','--network',self.prefix,
              '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
              '--tmpfs','/tmp:size=32m,mode=1777','--memory','256m','--cpus','1','--pids-limit','64',
              '--mount','type=bind,source='+str(ROOT/'scripts')+',target=/scripts,readonly',
              '--mount','type=bind,source='+str(credential)+',target=/credentials.json,readonly']
        for path,destination in mounts.items():
            args+=['--mount','type=bind,source='+str(path)+',target='+destination+',readonly']
        return run(args+[tools,'python','/scripts/'+script],timeout=timeout,check=False)

    def key_rotation(self,config,old_anchor,credential,tools):
        self.stage('isolated-development-key-rotation')
        generated=self.directory/'key-pair.json'
        if generated.exists():raise ValueError('Existing key generation target refused')
        self.private.append(generated)
        user=str(os.getuid())+':'+str(os.getgid()) if os.name!='nt' else '10001:10001'
        generated_status=json.loads(run(['docker','run','--rm','--pull','never','--log-driver','none','--network','none',
                                        '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
                                        '--user',user,'--memory','256m','--cpus','1','--pids-limit','32',
                                        '--mount','type=bind,source='+str(self.directory)+',target=/output',
                                        '--entrypoint','java',config['stack-core-api']['imageId'],
                                        '-Xmx64m','-cp','/app/tools','GateKeyTool','generate','/output/key-pair.json']).stdout)
        if not generated_status.get('prepared') or generated_status.get('privateKeyPrinted') is not False:
            raise ValueError('Fixture key generation unavailable')
        pair=json.loads(generated.read_bytes());public=base64.b64decode(pair['publicKey'],validate=True)
        if len(public)!=44 or hashlib.sha256(public).hexdigest()!=generated_status['keyId']:
            raise ValueError('Generated public key identity differs')
        current_anchor={**old_anchor,'keyId':generated_status['keyId'],'publicKeySpkiBase64':pair['publicKey']}
        key_path=pathlib.Path(next(f['fixturePath'] for f in config['stack-core-api']['files'] if f['destination']=='/run/secrets/stack-gate-key-pair'))
        self.replace_owned_private(key_path,generated.read_bytes())
        proof={}
        for mode in ['retired','revoked']:
            history={'schemaVersion':1,'keys':[{'keyId':old_anchor['keyId'],'publicKeySpkiBase64':old_anchor['publicKeySpkiBase64'],'status':mode}]}
            self.replace_owned_private(self.history_path,json.dumps(history).encode())
            name=self.prefix+'-stack-core-api'
            if inspect(name)['Config']['Labels'].get('agenttrust.fixture')!=self.id:
                raise ValueError('Fixture restart ownership refused')
            run(['docker','restart',name]);self.wait(name,'stack-core-api')
            arguments={'mode':mode,'old':old_anchor,'current':current_anchor,
                       'newReceiptId':proof.get('retired',{}).get('newReceiptId')}
            source=self.directory/'rotation-probe-input.json'
            if source.exists():self.replace_owned_private(source,json.dumps(arguments).encode())
            else:private_file(source,json.dumps(arguments).encode());source.chmod(0o444);self.private.append(source)
            result=self.application_probe('rotation-'+mode,tools,'stack-key-rotation-probe.py',credential,{source:'/rotation-probe-input.json'},120)
            value=json.loads(result.stdout);proof[mode]=value
            self.report['developmentKeyRotationProof']=proof;self.save()
            if result.returncode or not value.get('completed') or not value.get('ownSessionsClosed'):
                raise ValueError('Actual development key rotation unverified')
        self.report['developmentKeyRotationVerified']=True
        self.check('only disposable signing bytes rotate: old receipts verify under retired public key, revocation refuses them, and fresh signatures/receipts use the new key')

    def load_probe(self,value,credential,tools):
        validate_cohort(value)
        path=self.directory/'load-probe-input.json'
        if path.exists():self.replace_owned_private(path,json.dumps(value).encode())
        else:private_file(path,json.dumps(value).encode());path.chmod(0o444);self.private.append(path)
        result=self.application_probe('load-'+value['mode'],tools,'stack-recovery-load-probe.py',credential,{path:'/load-probe-input.json'},240)
        proof=json.loads(result.stdout)
        self.report.setdefault('syntheticRecoveryLoadProof',{})[value['mode']]=proof;self.save()
        if result.returncode or not proof.get('completed') or not proof.get('ownSessionClosed'):
            raise ValueError('Synthetic recovery load unverified')
        return proof

    def recovery_load(self,credential,tools):
        self.stage('isolated-twenty-pending-evaluation-recovery-and-metadata-latency')
        worker=self.prefix+'-stack-ai-worker'
        if inspect(worker)['Config']['Labels'].get('agenttrust.fixture')!=self.id:
            raise ValueError('Fixture worker stop ownership refused')
        value={'schemaVersion':1,'cohortId':str(uuid.uuid4()),'mode':'admit','records':[]}
        run(['docker','stop','--time','15',worker],timeout=30)
        try:
            admitted=self.load_probe(value,credential,tools)
            verify={**value,'mode':'verify','records':admitted['records']};validate_cohort(verify)
            ids=','.join("'"+row['runId']+"'" for row in verify['records'])
            fixture_db=self.prefix+'-stack-db'
            pending="SELECT count(*) FROM stack_runs r LEFT JOIN stack_run_results c ON c.run_id=r.id WHERE r.id IN ("+ids+") AND c.run_id IS NULL;"
            if sql(pending,fixture_db)!='20':raise ValueError('Twenty simultaneously pending evaluations unverified')
            self.report['maximumSimultaneouslyPendingSyntheticEvaluations']=20
            self.save()
        finally:
            run(['docker','start',worker]);self.wait(worker,'stack-ai-worker')
        started=time.monotonic();until=started+45
        complete="SELECT count(*) FROM stack_run_results WHERE run_id IN ("+ids+");"
        while sql(complete,fixture_db)!='20':
            if time.monotonic()>=until:raise TimeoutError('Synthetic recovery completion deadline exceeded')
            time.sleep(.5)
        self.report['syntheticCompletionObservationSeconds']=round(time.monotonic()-started,3)
        proof=self.load_probe(verify,credential,tools)
        if sql(complete,fixture_db)!='20':raise ValueError('Idempotent replay changed completion count')
        self.report['syntheticRecoveryLoadVerified']=True
        self.report['metadataP95TargetPassed']=proof['metadataTargetPassed']
        self.check('twenty simultaneously queued fixture evaluations recover once, idempotent replay preserves their IDs, and 160 scoped metadata responses meet the measured 500ms p95 target on four routes')

    def execute(self):
        self.stage('source-baseline')
        before = fingerprint()
        self.report['sourceBusinessTables'] = len(before)
        revision = run(['git', 'rev-parse', 'HEAD']).stdout.decode().strip()
        core_files = {m['Destination']: pathlib.Path(m['PrivateHostPath']) for m in self.sources['stack-core-api']['Mounts'] if m['Type'] == 'bind'}
        credentials = json.loads(core_files['/run/secrets/stack-demo-credentials'].read_bytes())
        owner = next(row for row in credentials if row['username'] == 'demo-admin')
        organization, project = str(uuid.UUID(owner['organizationId'])), str(uuid.UUID(owner['projectId']))
        receipt = sql("SELECT campaign_id::text||'|'||id::text FROM stack_campaign_receipts WHERE organization_id='"+organization+"' AND project_id='"+project+"' ORDER BY created_at DESC,id DESC LIMIT 1;").split('|')
        if len(receipt) != 2:
            raise ValueError('Existing signed campaign required for recovery acceptance')
        campaign, receipt_id = (str(uuid.UUID(value)) for value in receipt)
        key_pair = json.loads(core_files['/run/secrets/stack-gate-key-pair'].read_bytes())
        public_key = base64.b64decode(key_pair['publicKey'], validate=True)
        probe_anchor = {'campaignId': campaign, 'receiptId': receipt_id,
                        'publicKeySpkiBase64': base64.b64encode(public_key).decode('ascii'),
                        'keyId': hashlib.sha256(public_key).hexdigest()}
        self.report['separatelyAnchoredSigningKeyId'] = probe_anchor['keyId']
        private_file(self.key, secrets.token_bytes(32));self.private.append(self.key)
        self.stage('quiesce-original-transition-services')
        for service in QUIESCE:
            self.stopped.append(service)
            run(['docker', 'stop', '--time', '20', self.sources[service]['Id']], timeout=45)
            if service == 'stack-core-api' and sql(PENDING) != '0':
                raise ValueError('Admission raced cold snapshot quiescence')
        if any(inspect(self.sources[s]['Id'])['State']['Running'] for s in QUIESCE):
            raise ValueError('Cold consistency point unavailable')
        self.report['sourceQuiescedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        self.stage('bounded-encrypted-coherent-snapshot')
        snapshots, fileprints, encrypted = {}, {}, {}
        for service in STATEFUL:
            reserve()
            snapshots[service], fileprints[service] = self.snapshot_volume(service)
            encrypted[service] = crypt(ROOT, self.key, 'encrypt', snapshots[service])
            private_file(self.directory/(service+'.aesgcm'), encrypted[service])
        states=json.loads(run(['docker','inspect',*[self.sources[s]['Id'] for s in QUIESCE]]).stdout)
        if len(states)!=len(QUIESCE) or any(row['State']['Running'] for row in states):
            raise ValueError('Cold consistency point changed during snapshot')
        encrypted['configuration'] = crypt(ROOT, self.key, 'encrypt', self.configuration())
        private_file(self.directory/'configuration.aesgcm', encrypted['configuration'])
        manifest = {'schema': 1, 'snapshotId': self.id, 'revision': revision,
                    'services': {s: {'imageId': r['Image'], 'containerId': r['Id']} for s, r in self.sources.items()},
                    'components': {s: digest(raw) for s, raw in encrypted.items()},
                    'quiescence': {'allWritersStopped': True, 'allStatefulServicesStopped': True, 'pendingEvaluations': 0}}
        manifest_raw = json.dumps(manifest, separators=(',', ':')).encode()
        private_file(self.directory/'manifest.aesgcm', crypt(ROOT, self.key, 'encrypt', manifest_raw))
        # Release the original installation before decrypting or starting fixture workloads.
        self.stage('restore-same-source-containers')
        self.restore_source()
        self.report['sourceRestoredAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        if fingerprint() != before:
            raise ValueError('Original business rows changed during snapshot')
        self.check('source writers and all stateful services quiesced together; same original containers restored with unchanged business fingerprints')
        self.stage('authenticate-manifest-and-all-components-before-fixture-creation')
        recovered = json.loads(crypt(ROOT, self.key, 'decrypt', (self.directory/'manifest.aesgcm').read_bytes()))
        validate_manifest(recovered, self.id, revision)
        decoded = {}
        for component, expected in recovered['components'].items():
            data = verify_component((self.directory/(component+'.aesgcm')).read_bytes(), expected)
            decoded[component] = crypt(ROOT, self.key, 'decrypt', data)
        for service in STATEFUL:
            if archive_fingerprints(decoded[service]) != fileprints[service]:
                raise ValueError('Authenticated cold archive bytes differ')
        config = json.loads(decoded.pop('configuration'))
        if set(config) != set(SERVICES) or any(config[s]['imageId'] != recovered['services'][s]['imageId'] for s in SERVICES):
            raise ValueError('Authenticated configuration binding differs')
        self.check('authenticated manifest binds one snapshot, exact source images, all five state volumes and private configuration before restore')
        self.stage('isolated-fixture-physical-restore-and-startup')
        self.build_fixture(config, decoded, fileprints)
        restored = fingerprint(self.prefix+'-stack-db')
        if restored != before:
            raise ValueError('Restored business table bytes differ before requests')
        self.report['restoredBusinessTables'] = len(restored)
        self.check('all business table rows match the source snapshot before any fixture API request')
        self.stage('restored-oidc-evidence-and-new-evaluation')
        credential = next(f['fixturePath'] for f in config['stack-core-api']['files'] if f['destination'] == '/run/secrets/stack-demo-credentials')
        anchor = self.directory/'probe-anchor.json'
        private_file(anchor, json.dumps(probe_anchor).encode());anchor.chmod(0o444);self.private.append(anchor)
        tools = json.loads(run(['docker', 'image', 'inspect', 'agenttrust-security:local']).stdout)[0]['Id']
        result=self.application_probe('restored-application',tools,'stack-coherent-recovery-probe.py',credential,{anchor:'/probe-anchor.json'},180)
        proof = json.loads(result.stdout)
        self.report['restoredApplicationProof'] = proof
        if result.returncode or not proof.get('completed') or not proof.get('ownSessionsClosed') or not proof.get('paidProviderCallsPerformed') is False:
            raise ValueError('Restored application recovery probe unavailable')
        self.check('restored Keycloak PKCE identities, tenant/role boundaries, archived bytes, signing identity and fresh Python/NATS evaluation verified')
        if self.exercise_rotation:
            self.key_rotation(config,probe_anchor,credential,tools)
        if self.exercise_load:
            self.recovery_load(credential,tools)
        if fingerprint() != before:
            raise ValueError('Original business rows changed during isolated fixture probe')
        for service, source in self.sources.items():
            current = inspect(source['Id'])
            if current['Id'] != source['Id'] or current['Image'] != source['Image'] or not current['State']['Running']:
                raise ValueError('Original source runtime changed during fixture')
        self.report.update(sourceBusinessRowsUnchanged=True, sourceContainerIdsAndImagesUnchanged=True,
                           businessCriticalDevelopmentRecoveryVerified=True, completed=True)

    def cleanup(self):
        restored, cleaned = True, True
        try:
            self.restore_source()
        except Exception:
            restored = False
        for name in reversed(self.containers):
            try:
                found = run(['docker', 'inspect', name], check=False)
                if found.returncode:
                    continue
                if json.loads(found.stdout)[0]['Config']['Labels'].get('agenttrust.fixture') != self.id:
                    raise ValueError('Fixture container ownership refused')
                run(['docker', 'rm', '-f', name])
            except Exception:
                cleaned = False
        for name in reversed(self.volumes):
            try:
                self.own_volume(name);run(['docker', 'volume', 'rm', name])
            except Exception:
                cleaned = False
        if self.network:
            try:
                row = json.loads(run(['docker', 'network', 'inspect', self.prefix]).stdout)[0]
                if row.get('Labels', {}).get('agenttrust.fixture') != self.id:
                    raise ValueError('Fixture network ownership refused')
                run(['docker', 'network', 'rm', self.prefix])
            except Exception:
                cleaned = False
        for path in self.private:
            try:
                if path.is_symlink() or path.resolve().parent != self.directory.resolve():
                    raise ValueError('Private fixture path ownership refused')
                if path.exists():
                    path.chmod(0o600);path.unlink()
            except Exception:
                cleaned = False
        self.report.update(sourceServicesRestored=restored, ownFixtureAndTemporarySecretsCleaned=cleaned,
                           finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
        if not restored or not cleaned:
            self.report['completed'] = False
        self.save()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--exercise-key-rotation',action='store_true')
    parser.add_argument('--exercise-load',action='store_true')
    args = parser.parse_args()
    try:
        sources = source_preflight()
    except Exception as error:
        print(json.dumps({'completed': False, 'stage': 'read-only-preflight', 'errorType': type(error).__name__, 'sourceServicesStopped': False}))
        return 1
    if not args.execute:
        print(json.dumps({'completed': True, 'mode': 'read-only-preflight', 'servicesVerified': len(sources),
                          'statefulVolumesVerified': len(STATEFUL), 'pendingEvaluations': 0,
                          'sourceServicesStopped': False, 'actualRecoveryPerformed': False}))
        return 0
    drill = Rehearsal(sources,args.exercise_key_rotation,args.exercise_load)
    try:
        drill.execute()
    except Exception as error:
        drill.report.update(completed=False, errorType=type(error).__name__, code='COHERENT_RECOVERY_UNVERIFIED')
    finally:
        drill.cleanup()
    print(json.dumps({**drill.report, 'reportPath': str(drill.directory/'summary.json')}))
    return 0 if drill.report['completed'] else 1


if __name__ == '__main__':raise SystemExit(main())
