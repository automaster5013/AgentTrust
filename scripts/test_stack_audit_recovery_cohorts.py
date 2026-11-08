"""No Docker/network calls: distinguish current rollback from historical refusal."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('audit_recovery', Path(__file__).with_name('stack-audit-candidate-recovery.py'))
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class RecoveryCohortsTest(unittest.TestCase):
    def admission_fixture(self):
        scratch = Path(__file__).resolve().parent.parent / '.local'
        scratch.mkdir(exist_ok=True)
        temporary = tempfile.TemporaryDirectory(prefix='audit-recovery-admission-', dir=scratch)
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        (root / '.local').mkdir()
        (root / 'audit-delivery').mkdir()
        images = recovery.references({name: 'c' * 64 for name in recovery.CURRENT})
        manifest = {'revision': 'a' * 40, 'ref': recovery.REF, 'images': images}
        (root / 'audit-delivery/manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        env = {'GITHUB_ACTIONS': 'true', 'GITHUB_REPOSITORY': 'automaster5013/AgentTrust',
               'GITHUB_REF': recovery.REF, 'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_SHA': 'a' * 40}
        return root, manifest, env

    def test_foreign_execution_scope_refused_before_any_runtime_access(self):
        root, _, env = self.admission_fixture()
        for key, value in (('GITHUB_ACTIONS', 'false'), ('GITHUB_REPOSITORY', 'foreign/repository'),
                           ('GITHUB_REF', 'refs/heads/foreign'), ('GITHUB_EVENT_NAME', 'push')):
            with self.subTest(key=key), patch.dict(os.environ, {**env, key: value}), \
                    patch.object(recovery, 'ROOT', root), patch.object(recovery, 'run') as command, \
                    patch.object(recovery, 'set_images') as replace:
                with self.assertRaises(ValueError):
                    recovery.main()
                command.assert_not_called()
                replace.assert_not_called()

    def test_nonexclusive_fixture_refused_before_pull_or_replacement(self):
        root, _, env = self.admission_fixture()
        with patch.dict(os.environ, env), patch.object(recovery, 'ROOT', root), \
                patch.object(recovery, 'run', return_value='stack-db\nstack-core-api') as command, \
                patch.object(recovery, 'set_images') as replace:
            with self.assertRaises(ValueError):
                recovery.main()
            self.assertEqual(command.call_count, 1)
            self.assertEqual(command.call_args.args[:3], ('docker', 'ps', '-a'))
            replace.assert_not_called()

    def test_foreign_manifest_or_mutable_image_refused_before_replacement(self):
        root, manifest, env = self.admission_fixture()
        mutations = [('revision', 'b' * 40), ('ref', 'refs/heads/foreign'), ('images', {}),
                     ('images', {**manifest['images'], 'core-api': 'foreign:latest'})]
        for field, value in mutations:
            with self.subTest(field=field, value=value):
                (root / 'audit-delivery/manifest.json').write_text(json.dumps({**manifest, field: value}), encoding='utf-8')
                with patch.dict(os.environ, env), patch.object(recovery, 'ROOT', root), \
                        patch.object(recovery, 'run', return_value='stack-db') as command, \
                        patch.object(recovery, 'set_images') as replace:
                    with self.assertRaises(ValueError):
                        recovery.main()
                    self.assertEqual(command.call_count, 1)
                    replace.assert_not_called()

    def test_valid_mocked_admission_preserves_all_five_phases_and_fingerprints(self):
        root, manifest, env = self.admission_fixture()
        with patch.dict(os.environ, env), patch.object(recovery, 'ROOT', root), \
                patch.object(recovery, 'run', return_value='stack-db'), \
                patch.object(recovery, 'set_images') as replace, patch.object(recovery, 'probe') as probe, \
                patch.object(recovery, 'fingerprint', return_value={str(i): 'synthetic' for i in range(18)}):
            recovery.main()
        report = json.loads((root / '.local/audit-recovery-result.json').read_bytes())
        self.assertTrue(report['completed'])
        self.assertEqual(report['revision'], manifest['revision'])
        self.assertEqual(len(report['phases']), 5)
        self.assertEqual(replace.call_count, 5)
        self.assertEqual(probe.call_count, 5)
        self.assertTrue(all(phase['businessDataUnchanged'] for phase in report['phases']))

    def test_changed_business_fingerprint_cannot_produce_completed_report(self):
        root, _, env = self.admission_fixture()
        baseline = {str(i): 'synthetic' for i in range(18)}
        with patch.dict(os.environ, env), patch.object(recovery, 'ROOT', root), \
                patch.object(recovery, 'run', return_value='stack-db'), \
                patch.object(recovery, 'set_images') as replace, patch.object(recovery, 'probe'), \
                patch.object(recovery, 'fingerprint', side_effect=[baseline, {**baseline, '0': 'changed'}]):
            with self.assertRaises(ValueError):
                recovery.main()
        report = json.loads((root / '.local/audit-recovery-result.json').read_bytes())
        self.assertFalse(report.get('completed', False))
        self.assertEqual(report['phases'], [])
        replace.assert_called_once()

    def test_current_and_historical_baselines_have_distinct_acceptance_contracts(self):
        candidate = {name: 'candidate-'+name for name in recovery.CURRENT}
        phases = recovery.recovery_phases(candidate)
        self.assertEqual([p[0] for p in phases], ['candidate', 'current-b2c17be-rollback', 'candidate-return', 'historical-rollback', 'candidate-return-from-historical'])
        self.assertEqual(phases[1][1], recovery.references(recovery.CURRENT))
        self.assertEqual(phases[3][1], recovery.references(recovery.PRIOR))
        self.assertNotEqual(phases[1][1], phases[3][1])
        self.assertEqual([p[2:] for p in phases], [(True, True), (True, False), (True, True), (False, False), (True, True)])
        for i in (0, 2, 4):
            self.assertIs(phases[i][1], candidate)

    def probe_contract(self, supported, filters_supported, mutation=None):
        root = Path(__file__).resolve().parent.parent / '.local'
        root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as directory:
            local = Path(directory)/'.local/stack'
            local.mkdir(parents=True)
            (local/'demo-credentials.json').write_text('[]', encoding='utf-8')
            client = Mock()
            client.login.return_value = {'organizationId': 'synthetic-org', 'projectId': 'synthetic-project', 'actorId': 'synthetic-actor'}
            def response(path, **kwargs):
                if kwargs.get('expected') == 502:
                    return {'code': 'REQUEST_UNAVAILABLE'}
                value = {'organizationId': 'synthetic-org', 'projectId': 'synthetic-project'}
                if path.startswith('audit-period-export/'):
                    value.update(signed=False, currentDeploymentAuthority=False)
                    value['contentJson'] = json.dumps({**value})
                else:
                    value['deploymentAuthority'] = False
                if mutation:
                    mutation(path, value)
                return value
            client.request.side_effect = response
            with patch.object(recovery, 'ROOT', Path(directory)), patch.object(recovery, 'StackClient', return_value=client):
                try:
                    recovery.probe(supported, filters_supported)
                finally:
                    client.logout.assert_called_once()
            calls = client.request.call_args_list
            for action in recovery.FILTER_ACTIONS:
                matching = [c for c in calls if c.args[0] == 'audit-search/'+action+'/all']
                self.assertEqual(len(matching), 1)
                self.assertEqual(matching[0].kwargs, {} if filters_supported else {'expected': 400})
            for call in calls[1:4]:
                self.assertEqual(call.kwargs, {} if supported else {'expected': 502})

    def test_supported_routes_reject_missing_or_invented_authority_and_foreign_project(self):
        for target in ('audit-search/', 'audit-period-search/', 'audit-period-export/', 'audit-actor-search/'):
            key = 'currentDeploymentAuthority' if target == 'audit-period-export/' else 'deploymentAuthority'
            for field, replacement in ((key, True), (key, None), ('projectId', 'foreign-project')):
                def mutate(path, value):
                    if path.startswith(target):
                        if replacement is None:
                            value.pop(field)
                        else:
                            value[field] = replacement
                with self.subTest(target=target, field=field, replacement=replacement):
                    with self.assertRaises((ValueError, KeyError)):
                        self.probe_contract(True, True, mutate)

    def test_export_document_cannot_hide_foreign_scope_or_authority(self):
        for field, replacement in (('organizationId', 'foreign-org'), ('projectId', 'foreign-project'), ('signed', True), ('currentDeploymentAuthority', True), ('signed', None), ('currentDeploymentAuthority', None)):
            def mutate(path, value):
                if path.startswith('audit-period-export/'):
                    document = json.loads(value['contentJson'])
                    if replacement is None:
                        document.pop(field)
                    else:
                        document[field] = replacement
                    value['contentJson'] = json.dumps(document)
            with self.subTest(field=field, replacement=replacement):
                with self.assertRaises((ValueError, KeyError)):
                    self.probe_contract(True, True, mutate)

    def check_image_identity(self, mismatched=False):
        root = Path(__file__).resolve().parent.parent / '.local'
        root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as directory:
            images = {'core-api': 'synthetic-ref'}
            expected_id = 'sha256:' + 'a' * 64
            actual_id = 'sha256:' + ('b' if mismatched else 'a') * 64
            def run(*args):
                if args[:3] == ('docker', 'image', 'inspect'):
                    return expected_id
                if args[:2] == ('docker', 'inspect'):
                    if '{{.Image}}' in args[3]:
                        return 'synthetic-ref ' + actual_id + ' healthy'
                    return 'synthetic-ref healthy'
                return ''
            with patch.object(recovery, 'OVERLAY', Path(directory)/'images.json'), patch.object(recovery, 'run', side_effect=run):
                recovery.set_images(images)

    def test_running_container_must_match_resolved_image_id(self):
        with self.assertRaises(ValueError):
            self.check_image_identity(mismatched=True)

    def test_matching_running_image_id_is_accepted(self):
        self.check_image_identity()

    def test_candidate_accepts_fixed_filters_and_new_routes(self):
        self.probe_contract(True, True)

    def test_current_b2c17be_keeps_routes_but_refuses_unpatched_filters(self):
        self.probe_contract(True, False)

    def test_historical_cohort_refuses_routes_and_unpatched_filters(self):
        self.probe_contract(False, False)


if __name__ == '__main__':
    unittest.main()
