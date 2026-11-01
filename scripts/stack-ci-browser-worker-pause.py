"""Pause only an owned disposable hosted worker without changing its process identity."""
import argparse
import contextlib
import json
import os
import pathlib
import re
import subprocess
from stack_ci_return_guard import require_hosted

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORKER = 'agenttrust-stack-ai-worker-1'
FILES = ('compose.stack.yaml', 'compose.stack.identity.yaml', 'compose.stack.gateway.yaml',
         'compose.stack.object.yaml', 'compose.stack.observability.yaml', 'compose.stack.signing.yaml')


def owned(state, root):
    labels = state['Config']['Labels']
    assert labels['com.docker.compose.project'] == 'agenttrust'
    assert labels['com.docker.compose.service'] == 'stack-ai-worker'
    assert pathlib.Path(labels['com.docker.compose.project.working_dir']).resolve() == root.resolve()
    assert [pathlib.Path(p).resolve() for p in labels['com.docker.compose.project.config_files'].split(',')] == [root.resolve() / p for p in FILES]
    assert re.fullmatch('[a-f0-9]{64}', state['Id'])
    assert re.fullmatch('sha256:[a-f0-9]{64}', state['Image'])
    assert state['State']['Running'] is True
    return {key: state[key] for key in ('Id', 'Image')} | {'StartedAt': state['State']['StartedAt']}


@contextlib.contextmanager
def witness_lock(path):
    # OS-owned advisory locks release if a helper exits or is killed. A stale
    # lock file is harmless; deleting/replacing it could split the lock domain.
    lock_path = path.with_name(path.name + '.lock')
    assert not lock_path.is_symlink()
    descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0)
                         | getattr(os, 'O_BINARY', 0), 0o600)
    with os.fdopen(descriptor, 'r+b', buffering=0) as handle:
        if os.name == 'posix':
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try: yield
            finally: fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        else:
            # Windows is used only by mocked unit tests; require_hosted refuses
            # real helper execution before reaching this function.
            import msvcrt
            if os.fstat(handle.fileno()).st_size == 0: handle.write(b'\0')
            handle.seek(0); msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            try: yield
            finally:
                handle.seek(0); msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)


def perform(action, witness, root, command, environment=None, journal=None):
    # This guard precedes Docker, witness inspection/creation and private file reads.
    env = os.environ if environment is None else environment
    journal = {} if journal is None else journal
    journal['stage'] = 'hosted-guard'
    require_hosted(root, env)
    journal['stage'] = 'witness-validation'
    assert action in ('pause', 'resume') and witness
    assert re.fullmatch('[0-9]{1,20}', env.get('GITHUB_RUN_ID', ''))
    assert re.fullmatch('[1-9][0-9]{0,3}', env.get('GITHUB_RUN_ATTEMPT', ''))
    local = root / '.local'; path = pathlib.Path(witness)
    assert path.is_absolute() and path.parent.resolve() == local.resolve()
    assert local.is_dir() and not local.is_symlink() and not path.is_symlink()
    assert re.fullmatch(r'ci-worker-pause-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json', path.name)

    journal['stage'] = 'witness-lock'
    with witness_lock(path):
        def inspect():
            journal['stage'] = 'owned-worker-inspection'
            states = json.loads(command(['docker', 'inspect', WORKER]))
            assert len(states) == 1
            return states[0]

        def create_ticket(ticket):
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'w', encoding='utf-8') as handle: handle.write(json.dumps(ticket) + '\n')

        if action == 'resume' and not path.exists():
            # Revoke this invocation before a delayed child can acquire its pause witness.
            journal['stage'] = 'witness-close'
            create_ticket({'schemaVersion': 1, 'root': str(root.resolve()), 'runId': env['GITHUB_RUN_ID'],
                           'runAttempt': env['GITHUB_RUN_ATTEMPT'], 'identity': None, 'pauseAttempted': False, 'resumed': True})
            return {'completed': True, 'executed': True, 'noPauseWitness': True, 'restored': False,
                    'witnessClosed': True, 'containerMutationPerformed': False}
        if action == 'pause':
            assert not path.exists()
            state = inspect(); identity = owned(state, root)
            assert state['State'].get('Paused') is False and state['State'].get('Health', {}).get('Status') == 'healthy'
            ticket = {'schemaVersion': 1, 'root': str(root.resolve()), 'runId': env['GITHUB_RUN_ID'],
                      'runAttempt': env['GITHUB_RUN_ATTEMPT'], 'identity': identity, 'pauseAttempted': True, 'resumed': False}
            create_ticket(ticket)
            journal.update(mutationMayHaveStarted=True, stage='pause-command')
            command(['docker', 'pause', identity['Id']])
            state = inspect(); assert owned(state, root) == identity and state['State'].get('Paused') is True
            return {'completed': True, 'executed': True, 'paused': True, 'identityPreserved': True, 'restored': False}
        assert path.is_file() and 0 < path.stat().st_size <= 8192
        ticket = json.loads(path.read_text(encoding='utf-8'))
        assert set(ticket) == {'schemaVersion', 'root', 'runId', 'runAttempt', 'identity', 'pauseAttempted', 'resumed'}
        assert ticket['schemaVersion'] == 1 and ticket['root'] == str(root.resolve())
        assert ticket['runId'] == env['GITHUB_RUN_ID'] and ticket['runAttempt'] == env['GITHUB_RUN_ATTEMPT']
        assert type(ticket['pauseAttempted']) is bool and type(ticket['resumed']) is bool
        if ticket['pauseAttempted'] is False:
            assert ticket['resumed'] is True and ticket['identity'] is None
            return {'completed': True, 'executed': False, 'noPauseWitness': True, 'restored': False,
                    'witnessClosed': True, 'containerMutationPerformed': False}
        state = inspect(); assert owned(state, root) == ticket['identity']
        if ticket['resumed'] is True:
            # A completed witness may verify cleanup, never release a later pause.
            assert state['State'].get('Paused') is False
            return {'completed': True, 'executed': False, 'noPauseWitness': False,
                    'restored': True, 'identityPreserved': True, 'alreadyRestored': True}
        if state['State'].get('Paused') is True:
            journal.update(mutationMayHaveStarted=True, stage='resume-command')
            command(['docker', 'unpause', state['Id']])
        state = inspect(); assert owned(state, root) == ticket['identity'] and state['State'].get('Paused') is False
        ticket['resumed'] = True; path.write_text(json.dumps(ticket) + '\n', encoding='utf-8')
        return {'completed': True, 'executed': True, 'noPauseWitness': False, 'restored': True, 'identityPreserved': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true'); parser.add_argument('--action', choices=('pause', 'resume'))
    parser.add_argument('--witness'); args = parser.parse_args()
    if not args.execute:
        print(json.dumps({'completed': True, 'executed': False, 'requires': 'owned disposable hosted --execute'})); return 0
    def command(argv):
        result = subprocess.run(argv, cwd=ROOT, capture_output=True, timeout=30)
        if result.returncode: raise RuntimeError('CI_WORKER_PAUSE_COMMAND_UNVERIFIED')
        return result.stdout
    journal = {'mutationMayHaveStarted': False}
    try:
        result = perform(args.action, args.witness, ROOT, command, journal=journal)
        print(json.dumps(result)); return 0
    except Exception as error:
        print(json.dumps({'completed': False, 'mutationMayHaveStarted': journal['mutationMayHaveStarted'], 'code': 'CI_WORKER_PAUSE_UNVERIFIED',
                          'errorType': type(error).__name__, 'stage': journal.get('stage'), 'credentialsRecorded': False})); return 1


if __name__ == '__main__': raise SystemExit(main())
