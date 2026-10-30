"""Read-only owner-installation CD inventory and digest rollout planning; never applies."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys

COMPONENTS = {'stack-core-api':'core-api','stack-ai-worker':'ai-worker','stack-console':'console',
 'stack-opa':'opa','stack-identity':'identity','stack-gateway':'gateway','stack-object-store':'object-store',
 'stack-db':'database','stack-ollama':'local-model','stack-nats':'messaging','stack-otel':'telemetry',
 'stack-tempo':'tempo','stack-loki':'loki','stack-prometheus':'prometheus','stack-quality-verifier':'quality-verifier'}
PRESERVED = {'api','worker','db','stack-redis','stack-grafana'}
ALL_IMAGES = set(COMPONENTS.values()) | {'console-https'}


def require(value):
    if not value:
        raise ValueError('CD precondition failed')


def summarize(containers):
    result = {}
    for item in containers:
        labels = item['Config']['Labels'] or {}
        require(labels.get('com.docker.compose.project') == 'agenttrust')
        service = labels.get('com.docker.compose.service')
        require(service in set(COMPONENTS) | PRESERVED and service not in result)
        require(item['Name'] == '/agenttrust-' + service + '-1')
        require(item['State']['Running'] is True and item['State'].get('Health', {}).get('Status') == 'healthy')
        require(re.fullmatch(r'sha256:[a-f0-9]{64}', item['Image']))
        require(item['HostConfig']['RestartPolicy']['Name'] == 'unless-stopped')
        require(isinstance(labels.get('com.docker.compose.project.config_files'), str))
        policy = {'host': {name:item['HostConfig'].get(name) for name in
                  ('Privileged','ReadonlyRootfs','CapAdd','CapDrop','SecurityOpt','NetworkMode',
                   'Memory','MemorySwap','MemoryReservation','NanoCpus','CpuPeriod','CpuQuota',
                   'CpusetCpus','PidsLimit','PortBindings','PublishAllPorts','PidMode','IpcMode')},
                  'process': {name:item['Config'].get(name) for name in
                  ('User','WorkingDir','Entrypoint','Cmd','Healthcheck','ExposedPorts')}}
        fingerprint = hashlib.sha256(json.dumps(policy,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        result[service] = {'runtimePolicySha256':fingerprint,'containerId': item['Id'], 'rollbackImageId': item['Image'],
                          'restartPolicy': 'unless-stopped', 'healthy': True,
                          'composeFiles': labels['com.docker.compose.project.config_files'].split(','),
                          'mounts': [{'type': m['Type'], 'destination': m['Destination'],
                                      'name': m.get('Name'), 'readWrite': m['RW']} for m in item.get('Mounts', [])]}
    require(set(result) == set(COMPONENTS) | PRESERVED)
    return result


def receipt_plan(receipt, revision, inventory, profile):
    require(profile in ('development','https-review'))
    require(re.fullmatch('[a-f0-9]{40}', revision) is not None)
    require(type(receipt['schemaVersion']) is int and receipt['schemaVersion'] in (2,3) and receipt['revision'] == revision)
    for flag in ['published','destinationDigestsVerified','sourceSignaturesVerifiedHere']:
        require(receipt[flag] is True)
    require(receipt['serverDeployed'] is False)
    origin = receipt['publicationRun']
    require(origin['repository'] == 'automaster5013/AgentTrust')
    if receipt['schemaVersion']==2:
        require(origin['workflow']=='.github/workflows/original-stack.yml')
    else:
        require(origin['workflow']=='.github/workflows/dockerhub-main-mirror.yml')
        require(origin['ref'] in ('refs/heads/main','refs/heads/codex/commercial-workspace-ux-20261026'))
        source=receipt['sourceRun']
        require(type(source['runId']) is int and source['runId']>0 and type(source['runAttempt']) is int and source['runAttempt']>0)
    require(type(origin['runId']) is int and origin['runId'] > 0 and type(origin['runAttempt']) is int and origin['runAttempt'] > 0)
    require(re.fullmatch('[a-f0-9]{64}', receipt['sourceChecksumsSha256']) is not None)
    rows = receipt['images']; require(isinstance(rows, list) and len(rows) == 16)
    require({r['name'] for r in rows} == ALL_IMAGES)
    images = {}
    for row in rows:
        name = row['name']
        require(re.fullmatch('docker.io/automaster5013/agenttrust-' + re.escape(name) + '@sha256:[a-f0-9]{64}', row['reference']) is not None)
        require(row['source'] == 'ghcr.io/automaster5013/agenttrust-' + name + '@' + row['reference'].split('@')[1])
        require(row['tag'] == 'docker.io/automaster5013/agenttrust-' + name + ':' + revision)
        images[name] = row['reference']
    return [{'service': service, 'candidate': images['console-https' if service == 'stack-console' and profile == 'https-review' else component],
             'rollbackImageId': inventory[service]['rollbackImageId'], 'restartPolicy': inventory[service]['restartPolicy']}
            for service, component in sorted(COMPONENTS.items())]


def rollback_override(inventory):
    require(set(inventory) == set(COMPONENTS) | PRESERVED)
    services = {}
    for service in sorted(COMPONENTS):
        image = inventory[service]['rollbackImageId']
        require(re.fullmatch('sha256:[a-f0-9]{64}', image) is not None)
        require(inventory[service]['restartPolicy'] == 'unless-stopped')
        services[service] = {'image': image, 'restart': 'unless-stopped'}
    return {'services': services}


def candidate_override(plan, inventory):
    require(isinstance(plan,list) and len(plan) == len(COMPONENTS))
    require({row['service'] for row in plan} == set(COMPONENTS))
    services = {}
    for row in plan:
        service = row['service']
        component = COMPONENTS[service]
        allowed = ('console','console-https') if service == 'stack-console' else (component,)
        require(any(re.fullmatch('docker.io/automaster5013/agenttrust-' + name + '@sha256:[a-f0-9]{64}', row['candidate']) for name in allowed))
        require(row['rollbackImageId'] == inventory[service]['rollbackImageId'])
        require(row['restartPolicy'] == inventory[service]['restartPolicy'] == 'unless-stopped')
        services[service] = {'image': row['candidate'], 'restart': 'unless-stopped'}
    return {'services': services}


def runtime_file_groups(inventory):
    # Do not merge per-service file histories: private overrides differ in real installs.
    groups = {}
    for service in sorted(COMPONENTS):
        files = inventory[service]['composeFiles']
        require(isinstance(files,list) and 0 < len(files) <= 32 and len(set(files)) == len(files))
        require(all(isinstance(file,str) and file for file in files))
        groups.setdefault(tuple(files),[]).append(service)
    return [{'services':services,'filesInOrder':list(files)} for files,services in groups.items()]


def docker(args):
    process = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=30)
    require(process.returncode == 0)
    return process.stdout


def running_ids():
    ids = tuple(sorted(docker(['ps','--no-trunc','--filter','label=com.docker.compose.project=agenttrust','--format','{{.ID}}']).splitlines()))
    require(len(ids) == len(set(ids)) == 20)
    require(all(re.fullmatch('[a-f0-9]{64}', value) for value in ids))
    return ids


def compose_hashes(inventory, root):
    files = sorted({path for value in inventory.values() for path in value['composeFiles']})
    require(0 < len(files) <= 32)
    hashes = {}
    for file in files:
        path = pathlib.Path(file).resolve()
        require(path.is_relative_to(root) and path.is_file() and 0 < path.stat().st_size <= 1048576)
        raw = path.read_bytes(); require(len(raw) <= 1048576)
        hashes[str(path)] = hashlib.sha256(raw).hexdigest()
    return hashes


def recheck(ids, inventory, root, hashes):
    # Re-enumerate the project: inspecting old IDs alone misses newly added services.
    require(running_ids() == ids)
    current = summarize(json.loads(docker(['inspect', *ids])))
    require(current == inventory)
    require(compose_hashes(current, root) == hashes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--receipt', type=pathlib.Path)
    parser.add_argument('--expected-receipt-sha256')
    parser.add_argument('--expected-revision')
    parser.add_argument('--console-profile', choices=['development','https-review'])
    args = parser.parse_args()
    try:
        root = pathlib.Path(__file__).resolve().parent.parent
        # User-selected C:\AgentTrust may resolve through the preserved T: junction.
        require(pathlib.Path.cwd().resolve() == root)
        output = args.output.resolve()
        require(output.is_relative_to((root / '.local').resolve()) and not output.exists())
        ids = running_ids()
        inventory = summarize(json.loads(docker(['inspect', *ids])))
        hashes = compose_hashes(inventory, root)
        plan = None
        if args.receipt:
            require(args.expected_revision and args.console_profile and args.expected_receipt_sha256)
            raw = args.receipt.read_bytes(); require(len(raw) <= 65536)
            require(hashlib.sha256(raw).hexdigest() == args.expected_receipt_sha256)
            plan = receipt_plan(json.loads(raw), args.expected_revision, inventory, args.console_profile)
        rollback = rollback_override(inventory)
        candidate = candidate_override(plan,inventory) if plan is not None else None
        runtime_groups = runtime_file_groups(inventory)
        recheck(ids, inventory, root, hashes)
        report = {'schemaVersion':1,'readOnly':True,'inventory':inventory,'composeFileSha256':hashes,
                  'plannedServices':plan,'rollbackComposeOverride':rollback,'candidateComposeOverride':candidate,
                  'runtimeComposeGroups':runtime_groups,'singleRuntimeComposeVerified':len(runtime_groups)==1,'overridesApplied':False,
                  'rollbackRehearsed':False,'preservedServices':sorted(PRESERVED), 'logitrackAccessed':False,
                  'registryContacted':False,'imagesPulled':False,'actualDeploymentPerformed':False,
                  'automaticDeploymentAllowed':False,'receiptSignatureVerifiedHere':False,
                  'blockers':['trusted-main-run-and-signed-bundle-verification','migration-compatibility',
                              'authenticated-backup-and-recovery','private-runtime-overlay-and-rollback-rehearsal',
                              'target-executor-not-installed','first-operational-transition-review'] + (['per-service-runtime-reconciliation'] if len(runtime_groups)>1 else [])}
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('x', encoding='utf-8') as handle:
            handle.write(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'completed':True,'healthyContainers':len(inventory),'plannedServices':len(plan) if plan else 0,
                          'readOnly':True,'automaticDeploymentAllowed':False,'actualDeploymentPerformed':False}))
        return 0
    except Exception:
        print(json.dumps({'completed':False,'code':'LOCAL_CD_PLAN_BLOCKED','actualDeploymentPerformed':False}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
