"""Join signed delivery, live SQL migration ledger and retained recovery evidence without applying."""
import argparse
import datetime
import hashlib
import importlib.util
import json
import pathlib
import re
import subprocess
import sys
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = 'services/core-api/src/main/resources/db/migration/'


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


planner = load('local_cd_plan', 'stack-local-cd-plan.py')
delivery = load('signed_delivery', 'stack-delivery-verify.py')


def require(value):
    if not value: raise ValueError('Evidence binding refused')


def command(args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, timeout=120)
    require(result.returncode == 0)
    return result.stdout


def checksum(raw):
    # Flyway versioned SQL checksum: UTF-8, BOM removed, line endings excluded.
    crc = 0
    for line in raw.decode('utf-8-sig').splitlines():
        crc = zlib.crc32(line.encode('utf-8'), crc)
    return crc if crc < 2**31 else crc - 2**32


def migration_catalog(revision):
    require(re.fullmatch('[a-f0-9]{40}', revision) is not None)
    paths = command(['git','ls-tree','-r','--name-only',revision,'--',MIGRATIONS]).decode().splitlines()
    require(0 < len(paths) <= 128)
    result = []
    for path in paths:
        name = path.removeprefix(MIGRATIONS)
        match = re.fullmatch(r'V([1-9][0-9]*)__[a-z0-9_]+\.sql', name)
        require(match is not None)
        raw = command(['git','show',revision + ':' + path]); require(len(raw) <= 1048576)
        result.append({'version':str(int(match[1])), 'script':name, 'checksum':checksum(raw), 'sha256':hashlib.sha256(raw).hexdigest()})
    require(len({row['version'] for row in result}) == len(result))
    return sorted(result, key=lambda row:int(row['version']))


def live_ledger():
    sql = "BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SELECT coalesce(json_agg(x ORDER BY installed_rank),'[]'::json) FROM (SELECT installed_rank,version,script,checksum,success FROM flyway_schema_history) x; COMMIT;"
    raw = command(['docker','exec','agenttrust-stack-db-1','psql','-X','-q','-U','agenttrust_stack','-d','agenttrust_stack','-v','ON_ERROR_STOP=1','-At','-c',sql])
    require(len(raw) <= 65536)
    rows = json.loads(raw); require(isinstance(rows,list) and 0 < len(rows) <= 128)
    return rows


def same_schema(catalog, ledger):
    require(len(catalog) == len(ledger))
    require(len({row['version'] for row in ledger}) == len(ledger))
    require(len({row['installed_rank'] for row in ledger}) == len(ledger))
    actual = {row['version']:row for row in ledger}
    for expected in catalog:
        row = actual[expected['version']]
        require(row['success'] is True and type(row['checksum']) is int)
        require(all(row[key] == expected[key] for key in ['script','checksum']))
    return {'sameSchemaVerified':True,'appliedMigrations':len(ledger),'pendingMigrations':0,'databaseChanged':False}


def anchored_file(path, expected, limit=1048576):
    path = pathlib.Path(path)
    require(re.fullmatch('[a-f0-9]{64}',expected) is not None)
    require(not path.is_symlink() and path.is_file() and 0 < path.stat().st_size <= limit)
    raw = path.read_bytes(); require(len(raw) <= limit and hashlib.sha256(raw).hexdigest() == expected)
    return raw


def recovery_binding(proof, inventory, snapshot, now, max_age):
    require(0 < max_age <= 24)
    for flag in ['completed','businessCriticalDevelopmentRecoveryVerified','sourceServicesRestored','ownFixtureAndTemporarySecretsCleaned']:
        require(proof.get(flag) is True)
    require(proof['fixtureId'] == snapshot['snapshotId'] and proof['sourceRevision'] == snapshot['revision'])
    require(proof['encryptedManifestSha256'] == snapshot['encryptedManifestSha256'])
    started = datetime.datetime.fromisoformat(proof['startedAt'].replace('Z','+00:00'))
    require(started.tzinfo is not None and 0 <= (now-started).total_seconds() <= max_age*3600)
    require(set(proof['sourceImageIds']) == set(snapshot['serviceImageIds']))
    for service, image in snapshot['serviceImageIds'].items():
        require(proof['sourceImageIds'][service] == image == inventory[service]['rollbackImageId'])
    return {'retainedDevelopmentRecoveryEvidenceBound':True,'freshnessHours':max_age,
            'newRecoveryPerformed':False,'operationalBackupVerified':False}


def run(args, report):
    require(pathlib.Path.cwd().resolve() == ROOT)
    report['stage']='live-inventory'
    ids = planner.docker(['ps','--filter','label=com.docker.compose.project=agenttrust','--format','{{.ID}}']).splitlines()
    inventory = planner.summarize(json.loads(planner.docker(['inspect',*ids])))
    report['healthyAgentTrustContainers']=len(inventory)
    report['stage']='migration-ledger'
    catalog = migration_catalog(args.expected_revision)
    ledger = live_ledger(); report.update(same_schema(catalog,ledger))
    report['migrationCatalogSha256']=hashlib.sha256(json.dumps(catalog,sort_keys=True).encode()).hexdigest()
    if not args.evidence_config:
        require(live_ledger() == ledger)
        require(planner.summarize(json.loads(planner.docker(['inspect',*ids]))) == inventory)
        report.update(completed=True,scope='inventory-and-migration-only',signedReleaseVerified=False,
                      recoveryEvidenceVerified=False,blockers=['signed-release-and-anchored-backup-config-required'])
        return
    report['stage']='independent-anchors'
    config = delivery.json_bytes(anchored_file(args.evidence_config,args.expected_config_sha256))
    require(config['revision'] == args.expected_revision and config['repository'] == 'automaster5013/AgentTrust')
    report['stage']='signed-delivery'
    directory,identity,records = delivery.validate(pathlib.Path(config['bundle']),args.expected_revision,config['checksumsSha256'],config['repository'])
    require({row['name'] for row in records} == planner.ALL_IMAGES)
    delivery.Verifier(directory,True,pathlib.Path(config['trustedRoot']) if config.get('trustedRoot') else None).verify(records,identity,config['repository'],args.expected_revision)
    require(delivery.validate(directory,args.expected_revision,config['checksumsSha256'],config['repository']) == (directory,identity,records))
    report['signedReleaseVerified']=True
    receipt = delivery.json_bytes(anchored_file(config['receipt'],config['receiptSha256'],65536))
    planner.receipt_plan(receipt,args.expected_revision,inventory,config['consoleProfile'])
    require(receipt['sourceChecksumsSha256'] == config['checksumsSha256'])
    require({r['name']:r['source'] for r in receipt['images']} == {r['name']:r['reference'] for r in records})
    report['publicationReceiptBound']=True
    report['stage']='retained-snapshot-authentication'
    snap = load('retained_snapshot','stack-coherent-snapshot-verify.py')
    crypt = load('backup_envelope','stack-backup-crypt.py')
    from stack_backup_custody import retained_key, key_unchanged
    from stack_coherent_archive import validate_manifest
    key_path,key_hash = retained_key(ROOT,config['retainedKey'])
    key = key_path.read_bytes()
    snapshot = snap.verify(ROOT,pathlib.Path(config['snapshot']),key_path,config['snapshotId'],config['snapshotRevision'],config['snapshotManifestSha256'],
                           decrypt=lambda raw:crypt.transform('decrypt',key,raw))
    encrypted = snap.bounded_file(pathlib.Path(config['snapshot'])/'manifest.aesgcm',1048576)
    require(hashlib.sha256(encrypted).hexdigest() == config['snapshotManifestSha256'])
    manifest = validate_manifest(snap.document(crypt.transform('decrypt',key,encrypted)),config['snapshotId'],config['snapshotRevision'])
    snapshot['serviceImageIds']={service:row['imageId'] for service,row in manifest['services'].items()}
    require(key_unchanged(key_path,key_hash))
    report['authenticatedSnapshotComponents']=snapshot['authenticatedEncryptedComponents']
    report['stage']='retained-recovery-binding'
    proof = delivery.json_bytes(anchored_file(config['recoveryReport'],config['recoveryReportSha256']))
    report.update(recovery_binding(proof,inventory,snapshot,datetime.datetime.now(datetime.timezone.utc),config['maximumRecoveryAgeHours']))
    require(migration_catalog(config['snapshotRevision']) == catalog)
    report['stage']='recheck-live-state'
    require(live_ledger() == ledger)
    require(planner.summarize(json.loads(planner.docker(['inspect',*ids]))) == inventory)
    require(delivery.validate(directory,args.expected_revision,config['checksumsSha256'],config['repository']) == (directory,identity,records))
    snapshot_again = snap.verify(ROOT,pathlib.Path(config['snapshot']),key_path,config['snapshotId'],config['snapshotRevision'],config['snapshotManifestSha256'], decrypt=lambda raw:crypt.transform('decrypt',key,raw))
    require(snapshot_again['authenticatedEncryptedComponents'] == snapshot['authenticatedEncryptedComponents'])
    require(key_unchanged(key_path,key_hash))
    anchored_file(config['receipt'],config['receiptSha256'],65536)
    anchored_file(config['recoveryReport'],config['recoveryReportSha256'])
    anchored_file(args.evidence_config,args.expected_config_sha256)
    report.update(completed=True,scope='signed-publication-and-retained-development-recovery-binding',
                  blockers=['trusted-main-run-online-check','destination-registry-readback','target-executor',
                            'operational-backup-policy','first-operational-transition-review'])


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-revision',required=True)
    parser.add_argument('--evidence-config',type=pathlib.Path)
    parser.add_argument('--expected-config-sha256')
    parser.add_argument('--output',type=pathlib.Path,required=True)
    args=parser.parse_args()
    report={'completed':False,'readOnly':True,'actualDeploymentPerformed':False,'databaseChanged':False,
            'existingServicesStopped':False,'automaticDeploymentAllowed':False,
            'operationalBackupVerified':False,'newRecoveryPerformed':False}
    try:
        output=args.output.resolve(); require(output.is_relative_to((ROOT/'.local').resolve()) and not output.exists())
        run(args,report)
    except Exception:
        report.update(completed=False,code='CD_EVIDENCE_UNVERIFIED')
    try:
        require(output.is_relative_to((ROOT/'.local').resolve()))
        output.parent.mkdir(parents=True,exist_ok=True)
        with output.open('x',encoding='utf-8') as handle:handle.write(json.dumps(report,indent=2)+'\n')
    except Exception:
        report.update(completed=False,code='CD_EVIDENCE_OUTPUT_REFUSED')
    print(json.dumps(report))
    return 0 if report['completed'] else 1


if __name__=='__main__':sys.exit(main())
