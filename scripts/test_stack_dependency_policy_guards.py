"""Exercise the offline policy evaluator with synthetic selectors and peers."""
import importlib.util
from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import patch

path = Path(__file__).with_name('stack-infrastructure-dependencies-probe.py')
spec = importlib.util.spec_from_file_location('dependency_probe', path)
probe = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {'yaml': ModuleType('yaml')}):
    spec.loader.exec_module(probe)


class DependencyPolicyGuardsTest(unittest.TestCase):
    def test_unsupported_selector_is_refused(self):
        with self.assertRaisesRegex(ValueError, 'Dependency contract refused'):
            probe._matches({'matchExpressions': [{'key': 'app', 'operator': 'Exists'}]}, {})

    def test_supported_selector_matches_labels(self):
        selector = {'matchLabels': {'app': 'fixture'}}
        self.assertTrue(probe._matches(selector, {'app': 'fixture'}))
        self.assertFalse(probe._matches(selector, {'app': 'other'}))

    def test_unsupported_peer_is_refused(self):
        origin = probe._endpoint('fixture', 'source')
        target = probe._endpoint('fixture', 'target')
        policies = [{
            'metadata': {'namespace': 'fixture'},
            'spec': {
                'policyTypes': ['Ingress'],
                'podSelector': {},
                'ingress': [{'from': [{'ipBlock': {'cidr': '192.0.2.0/24'}}]}],
            },
        }]
        with self.assertRaisesRegex(ValueError, 'Dependency contract refused'):
            probe._allowed(policies, 'Ingress', origin, target, 5432)
