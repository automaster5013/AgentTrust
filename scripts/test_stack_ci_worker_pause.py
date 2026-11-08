import copy
import concurrent.futures
import threading
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('worker_pause', ROOT / 'scripts/stack-ci-browser-worker-pause.py')
worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)


class WorkerPauseTest(unittest.TestCase):
    def fixture(self):
        # Local test scratch stays inside the explicitly resolved AgentTrust workspace.
        base = pathlib.Path('C:/AgentTrust/.local') if os.name == 'nt' else ROOT / '.local'
        base.mkdir(exist_ok=True)
        directory = tempfile.TemporaryDirectory(prefix='worker-pause-unit-', dir=base)
        root = pathlib.Path(directory.name)
        self.assertTrue(root.resolve().is_relative_to(base.resolve()))
        self.addCleanup(directory.cleanup)
        (root / '.local').mkdir()
        witness = root / '.local/ci-worker-pause-11111111-1111-4111-8111-111111111111.json'
        env = {'GITHUB_RUN_ID': '123456', 'GITHUB_RUN_ATTEMPT': '1'}
        state = {'Id': 'a' * 64, 'Image': 'sha256:' + 'b' * 64,
                 'Config': {'Labels': {'com.docker.compose.project': 'agenttrust',
                    'com.docker.compose.service': 'stack-ai-worker',
                    'com.docker.compose.project.working_dir': str(root),
                    'com.docker.compose.project.config_files': ','.join(str(root / p) for p in worker.FILES)}},
                 'State': {'Running': True, 'Paused': False, 'StartedAt': 'synthetic-original-start', 'Health': {'Status': 'healthy'}}}
        calls = []; faults = set()
        def command(args):
            calls.append(args)
            if args[1] == 'inspect': return json.dumps([copy.deepcopy(state)]).encode()
            self.assertEqual(args[2], state['Id'])
            if args[1] == 'pause':
                state['State']['Paused'] = True
                if 'pause-after-mutation' in faults: raise RuntimeError('synthetic partial pause')
            elif args[1] == 'unpause': state['State']['Paused'] = False
            else: self.fail('Unexpected mutating command')
            return b''
        return root, witness, env, state, calls, faults, command

    def invoke(self, fixture, action, journal=None):
        root, witness, env, _, _, _, command = fixture
        with patch.object(worker, 'require_hosted'):
            return worker.perform(action, str(witness), root, command, env, journal=journal)

    def test_local_guard_refuses_before_docker_or_witness_access(self):
        command = Mock()
        with patch.object(worker, 'witness_lock') as lock:
            with self.assertRaises(ValueError):
                worker.perform('pause', 'not-a-witness', ROOT, command, environment={})
            lock.assert_not_called()
        command.assert_not_called()

    def test_pause_resume_and_repeated_cleanup_preserve_original_identity(self):
        fixture = self.fixture(); original = copy.deepcopy(fixture[3]); journal = {}
        paused = self.invoke(fixture, 'pause', journal)
        self.assertTrue(paused['paused']); self.assertTrue(journal['mutationMayHaveStarted'])
        resumed = self.invoke(fixture, 'resume'); self.assertTrue(resumed['restored'])
        self.assertEqual(original, fixture[3]); self.assertTrue(self.invoke(fixture, 'resume')['restored'])
        self.assertEqual([c[1] for c in fixture[4] if c[1] != 'inspect'], ['pause', 'unpause'])
        self.assertNotIn(original['Id'], repr(resumed)); self.assertNotIn(original['Image'], repr(resumed))

    def test_foreign_owned_container_is_not_paused(self):
        fixture = self.fixture(); fixture[3]['Config']['Labels']['com.docker.compose.project'] = 'other'
        with self.assertRaises(ValueError): self.invoke(fixture, 'pause')
        self.assertFalse(fixture[1].exists()); self.assertFalse(any(c[1] == 'pause' for c in fixture[4]))

    def test_partial_pause_is_resumed_from_witness(self):
        fixture = self.fixture(); fixture[5].add('pause-after-mutation'); journal = {}
        with self.assertRaises(RuntimeError): self.invoke(fixture, 'pause', journal)
        self.assertTrue(journal['mutationMayHaveStarted']); self.assertTrue(fixture[3]['State']['Paused'])
        self.assertTrue(self.invoke(fixture, 'resume')['restored']); self.assertFalse(fixture[3]['State']['Paused'])

    def test_changed_process_identity_refuses_unpause(self):
        fixture = self.fixture(); self.invoke(fixture, 'pause'); fixture[4].clear()
        fixture[3]['State']['StartedAt'] = 'changed-start'
        with self.assertRaises(ValueError): self.invoke(fixture, 'resume')
        self.assertFalse(any(c[1] == 'unpause' for c in fixture[4]))

    def test_cross_run_witness_is_not_reused(self):
        fixture = self.fixture(); self.invoke(fixture, 'pause'); fixture[4].clear()
        fixture[2]['GITHUB_RUN_ID'] = '999999'
        with self.assertRaises(ValueError): self.invoke(fixture, 'resume')
        self.assertEqual(fixture[4], [])

    def test_completed_witness_cannot_unpause_a_later_unowned_pause(self):
        fixture = self.fixture(); self.invoke(fixture, 'pause'); self.invoke(fixture, 'resume')
        fixture[3]['State']['Paused'] = True; fixture[4].clear()
        with self.assertRaises(ValueError): self.invoke(fixture, 'resume')
        self.assertFalse(any(c[1] == 'unpause' for c in fixture[4]))

    def test_missing_witness_cleanup_has_no_docker_operation(self):
        fixture = self.fixture(); result = self.invoke(fixture, 'resume')
        self.assertTrue(result['noPauseWitness']); self.assertTrue(result['executed'])
        self.assertTrue(result['witnessClosed']); self.assertFalse(result['containerMutationPerformed'])
        raw = fixture[1].read_bytes(); repeated = self.invoke(fixture, 'resume')
        self.assertFalse(repeated['executed']); self.assertTrue(repeated['witnessClosed'])
        self.assertEqual(fixture[1].read_bytes(), raw); self.assertEqual(fixture[4], [])

    def test_cleanup_without_pause_revokes_late_pause_for_the_same_invocation(self):
        fixture = self.fixture(); result = self.invoke(fixture, 'resume')
        self.assertTrue(result['noPauseWitness']); fixture[4].clear()
        with self.assertRaises(ValueError): self.invoke(fixture, 'pause')
        self.assertEqual(fixture[4], [])
        self.assertFalse(fixture[3]['State']['Paused'])

    def test_abrupt_helper_exit_releases_os_lock(self):
        fixture = self.fixture()
        code = """import importlib.util, os, pathlib, sys
sys.path.insert(0, sys.argv[1])
spec = importlib.util.spec_from_file_location('pause_lock_child', pathlib.Path(sys.argv[1]) / 'stack-ci-browser-worker-pause.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
with module.witness_lock(pathlib.Path(sys.argv[2])):
    print('synthetic-lock-acquired', flush=True)
    os._exit(0)
"""
        child = subprocess.run([sys.executable, '-c', code, str(ROOT / 'scripts'), str(fixture[1])],
                               cwd=ROOT, capture_output=True, timeout=5)
        self.assertEqual(child.returncode, 0)
        self.assertEqual(child.stdout.strip(), b'synthetic-lock-acquired')
        with worker.witness_lock(fixture[1]): pass
        self.assertEqual(fixture[4], [])
        self.assertFalse(fixture[1].exists())

    def test_cleanup_waits_for_in_flight_pause_before_resuming(self):
        fixture = list(self.fixture()); original_command = fixture[-1]
        pause_entered = threading.Event(); release_pause = threading.Event(); cleanup_started = threading.Event()
        def command(args):
            if args[1] == 'pause':
                pause_entered.set()
                self.assertTrue(release_pause.wait(5), 'synthetic pause was not released')
            return original_command(args)
        fixture[-1] = command
        def perform(action):
            if action == 'resume': cleanup_started.set()
            return worker.perform(action, str(fixture[1]), fixture[0], command, fixture[2])
        with patch.object(worker, 'require_hosted'), concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            paused = pool.submit(perform, 'pause')
            try:
                self.assertTrue(pause_entered.wait(5))
                resumed = pool.submit(perform, 'resume'); self.assertTrue(cleanup_started.wait(5))
                with self.assertRaises(concurrent.futures.TimeoutError): resumed.result(timeout=0.2)
            finally: release_pause.set()
            self.assertTrue(paused.result(timeout=5)['paused'])
            self.assertTrue(resumed.result(timeout=5)['restored'])
        self.assertFalse(fixture[3]['State']['Paused'])
        self.assertEqual([c[1] for c in fixture[4] if c[1] != 'inspect'], ['pause', 'unpause'])

    def test_existing_witness_is_not_overwritten_for_second_pause(self):
        fixture = self.fixture(); self.invoke(fixture, 'pause'); raw = fixture[1].read_bytes(); fixture[4].clear()
        with self.assertRaises(ValueError): self.invoke(fixture, 'pause')
        self.assertEqual(fixture[1].read_bytes(), raw); self.assertEqual(fixture[4], [])


if __name__ == '__main__': unittest.main()
