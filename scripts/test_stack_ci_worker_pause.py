import copy
import importlib.util
import json
import os
import pathlib
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
        with self.assertRaises(ValueError):
            worker.perform('pause', 'not-a-witness', ROOT, command, environment={})
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
        with self.assertRaises(AssertionError): self.invoke(fixture, 'pause')
        self.assertFalse(fixture[1].exists()); self.assertFalse(any(c[1] == 'pause' for c in fixture[4]))

    def test_partial_pause_is_resumed_from_witness(self):
        fixture = self.fixture(); fixture[5].add('pause-after-mutation'); journal = {}
        with self.assertRaises(RuntimeError): self.invoke(fixture, 'pause', journal)
        self.assertTrue(journal['mutationMayHaveStarted']); self.assertTrue(fixture[3]['State']['Paused'])
        self.assertTrue(self.invoke(fixture, 'resume')['restored']); self.assertFalse(fixture[3]['State']['Paused'])

    def test_changed_process_identity_refuses_unpause(self):
        fixture = self.fixture(); self.invoke(fixture, 'pause'); fixture[4].clear()
        fixture[3]['State']['StartedAt'] = 'changed-start'
        with self.assertRaises(AssertionError): self.invoke(fixture, 'resume')
        self.assertFalse(any(c[1] == 'unpause' for c in fixture[4]))

    def test_cross_run_witness_is_not_reused(self):
        fixture = self.fixture(); self.invoke(fixture, 'pause'); fixture[4].clear()
        fixture[2]['GITHUB_RUN_ID'] = '999999'
        with self.assertRaises(AssertionError): self.invoke(fixture, 'resume')
        self.assertEqual(fixture[4], [])

    def test_missing_witness_cleanup_has_no_docker_operation(self):
        fixture = self.fixture(); result = self.invoke(fixture, 'resume')
        self.assertTrue(result['noPauseWitness']); self.assertFalse(result['executed']); self.assertEqual(fixture[4], [])

    def test_existing_witness_is_not_overwritten_for_second_pause(self):
        fixture = self.fixture(); self.invoke(fixture, 'pause'); raw = fixture[1].read_bytes(); fixture[4].clear()
        with self.assertRaises(AssertionError): self.invoke(fixture, 'pause')
        self.assertEqual(fixture[1].read_bytes(), raw); self.assertEqual(fixture[4], [])


if __name__ == '__main__': unittest.main()
