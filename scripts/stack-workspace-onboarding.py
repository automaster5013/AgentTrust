"""Review a bounded manifest; --execute provisions only the local development IdP."""
import argparse
import datetime
import json
import os
import pathlib
import subprocess
import traceback
import uuid
from stack_backup_custody import windows_owner_only
from stack_identity_scope_contract import verify
from stack_workspace_identity import LocalWorkspaceIdentity
from stack_workspace_onboarding import Provisioner, manifest_digest, parse_manifest, require
from stack_workspace_suspension import cohort_from_journal, suspend

ROOT = pathlib.Path(__file__).resolve().parent.parent


def protect_owned(path):
    if os.name == 'nt':
        who = subprocess.check_output(['whoami'], text=True).strip()
        # Only newly created, still-empty assets reach here. Reset creation-time
        # explicit defaults, then grant solely the current owner and SYSTEM.
        subprocess.run(['icacls', str(path), '/reset'], check=True, capture_output=True)
        suffix = ':(OI)(CI)F' if path.is_dir() else ':F'
        subprocess.run(['icacls', str(path), '/inheritance:r', '/grant:r', who + suffix, 'SYSTEM' + suffix],
                       check=True, capture_output=True)
        windows_owner_only((path,))


def private_directory(path):
    path.mkdir(mode=0o700)
    protect_owned(path)


def private_checkpoint(directory, state):
    temporary, target = directory / 'journal.next.json', directory / 'journal.json'
    require(not temporary.exists() and not temporary.is_symlink() and not target.is_symlink())
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        protect_owned(temporary)
    except Exception:
        os.close(descriptor)
        raise
    with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
        json.dump(state, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    if os.name == 'nt':
        windows_owner_only((temporary, directory))
    temporary.replace(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--manifest')
    source.add_argument('--suspend-journal', help='Suspend only the exact identities in a completed private provisioning journal.')
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    report = {'completed': False, 'executed': False, 'localDevelopmentOnly': True,
              'productionIdentityConfigured': False, 'rawCredentialsPrinted': False,
              'existingUsersModified': False}
    try:
        path = pathlib.Path(args.manifest or args.suspend_journal)
        if not path.is_absolute():
            path = ROOT / path
        require(not path.is_symlink() and not path.parent.is_symlink())
        path = path.resolve(strict=True)
        require(path.is_relative_to(ROOT / '.local') and path.is_file() and path.stat().st_size <= 32768)
        if args.suspend_journal:
            if os.name == 'nt':
                windows_owner_only((path, path.parent))
            else:
                for item in (path, path.parent):
                    require(item.stat().st_uid == os.getuid() and item.stat().st_mode & 0o077 == 0)
            cohort = cohort_from_journal(path.read_bytes())
            report.update(operation='suspend', manifestSha256=cohort['manifestSha256'], memberCount=len(cohort['members']))
        else:
            manifest = parse_manifest(path.read_bytes())
            report.update(operation='provision', manifestSha256=manifest_digest(manifest), memberCount=len(manifest['members']))
        if not args.execute:
            report.update(completed=True, stage='manifest-reviewed-no-provider-contact')
        else:
            directory = ROOT / '.local' / ('workspace-onboarding-' + str(uuid.uuid4()))
            private_directory(directory)
            report['privateJournalDirectory'] = str(directory)
            with LocalWorkspaceIdentity(ROOT) as api:
                clients = api.read('/clients?clientId=agenttrust-console')
                require(isinstance(clients, list) and len(clients) == 1)
                verify(clients[0], api.read('/users/profile'))
                report['executed'] = True
                if args.suspend_journal:
                    state = suspend(api, cohort, lambda s: private_checkpoint(directory, s))
                    report.update(completed=state['completed'], stage=state['stage'],
                                  disabledUsers=state['verifiedDisabledMembers'],
                                  providerSessionRevocationVerified=state['providerSessionRevocationVerified'],
                                  applicationSessionRevocationVerifiedHere=False)
                else:
                    state = Provisioner(api, lambda s: private_checkpoint(directory, s)).execute(manifest)
                    report.update(completed=state['completed'], stage=state['stage'],
                                  createdUsers=len(state['members']), allCreatedUsersVerified=True)
            report['operatorSessionClosed'] = True
    except Exception as error:
        report.update(completed=False, errorType=type(error).__name__,
                      code=getattr(error, 'code', 'WORKSPACE_ONBOARDING_UNVERIFIED'),
                      failureLocations=[{'file': pathlib.Path(t.filename).name, 'line': t.lineno}
                                        for t in traceback.extract_tb(error.__traceback__)])
    report['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    print(json.dumps(report))
    return 0 if report['completed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
