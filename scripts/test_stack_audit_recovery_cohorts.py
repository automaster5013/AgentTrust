"""No Docker/network calls: distinguish current rollback from historical refusal."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('audit_recovery', Path(__file__).with_name('stack-audit-candidate-recovery.py'))
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class RecoveryCohortsTest(unittest.TestCase):
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
                    with self.assertRaises((AssertionError, KeyError)):
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
                with self.assertRaises((AssertionError, KeyError)):
                    self.probe_contract(True, True, mutate)

    def test_candidate_accepts_fixed_filters_and_new_routes(self):
        self.probe_contract(True, True)

    def test_current_b2c17be_keeps_routes_but_refuses_unpatched_filters(self):
        self.probe_contract(True, False)

    def test_historical_cohort_refuses_routes_and_unpatched_filters(self):
        self.probe_contract(False, False)


if __name__ == '__main__':
    unittest.main()
