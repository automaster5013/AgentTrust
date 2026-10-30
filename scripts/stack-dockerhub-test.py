"""Offline failure-path tests. No registry or running service is accessed."""
import importlib.util
import json
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('hub', pathlib.Path(__file__).with_name('stack-dockerhub.py'))
hub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hub)
SHA = 'a' * 40
RECORDS = [{'name': name, 'reference': 'ghcr.io/automaster5013/agenttrust-' + name + '@sha256:' + 'b' * 64} for name in hub.NAMES]


class DeliveryTests(unittest.TestCase):
    def test_publication_run_requires_original_main_workflow_and_attempt(self):
        env = {'GITHUB_ACTIONS':'true', 'GITHUB_REF':'refs/heads/main', 'GITHUB_SHA':SHA,
               'GITHUB_REPOSITORY':'automaster5013/AgentTrust', 'GITHUB_EVENT_NAME':'push',
               'GITHUB_WORKFLOW_REF':'automaster5013/AgentTrust/.github/workflows/original-stack.yml@refs/heads/main',
               'GITHUB_RUN_ID':'123', 'GITHUB_RUN_ATTEMPT':'2'}
        self.assertEqual(hub.publication_run(env,SHA,'automaster5013/AgentTrust')['runAttempt'],2)
        for key,value in [('GITHUB_RUN_ID',''),('GITHUB_RUN_ATTEMPT','0'),('GITHUB_RUN_ATTEMPT','01'),
                          ('GITHUB_WORKFLOW_REF','other'),('GITHUB_EVENT_NAME','pull_request')]:
            with self.subTest(key=key,value=value), self.assertRaises(ValueError):
                hub.publication_run({**env,key:value},SHA,'automaster5013/AgentTrust')

    def test_complete_digest_mapping(self):
        rows = hub.plan(RECORDS, 'example-team', SHA)
        self.assertEqual(len(rows), 16)
        self.assertTrue(all(row['reference'].endswith('@sha256:' + 'b' * 64) and row['tag'].endswith(':' + SHA) for row in rows))

    def test_incomplete_or_duplicate_release(self):
        for records in (RECORDS[:-1], RECORDS + [RECORDS[0]]):
            with self.assertRaises(ValueError):
                hub.plan(records, 'example', SHA)

    def test_untrusted_namespaces_and_sources(self):
        for namespace in ('../escape', 'owner/repo', 'https://hub', 'UPPER', ''):
            with self.assertRaises(ValueError):
                hub.plan(RECORDS, namespace, SHA)
        for source in ('ghcr.io/other:latest', 'docker.io/a/b@sha256:' + 'b' * 64):
            with self.assertRaises(ValueError):
                hub.plan([{**row, 'reference': source} for row in RECORDS], 'example', SHA)

    def test_push_requires_digest_readback(self):
        row = hub.plan(RECORDS, 'example', SHA)[0]
        calls = []
        def run(args):
            calls.append(args)
            return json.dumps([row['reference']]) if args[0] == 'image' else ''
        hub.publish([row], run)
        self.assertEqual([call[0] for call in calls], ['pull', 'tag', 'push', 'pull', 'image'])
        with self.assertRaises(ValueError):
            hub.publish([row], lambda args: '[]' if args[0] == 'image' else '')

    def test_registry_failure_stops_release(self):
        calls = []
        def fail(args):
            calls.append(args)
            raise RuntimeError('unavailable')
        with self.assertRaises(RuntimeError):
            hub.publish(hub.plan(RECORDS, 'example', SHA), fail)
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
