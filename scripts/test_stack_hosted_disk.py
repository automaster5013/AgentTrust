import unittest
from pathlib import PurePosixPath
from stack_hosted_disk import authorized_paths, SDK_PATHS


class HostedDiskBoundaryTest(unittest.TestCase):
    env = {'GITHUB_ACTIONS': 'true', 'CI': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
           'RUNNER_OS': 'Linux', 'GITHUB_WORKSPACE': '/home/runner/work/repo/repo',
           'RUNNER_TEMP': '/home/runner/work/_temp'}

    def test_hosted_paths_only(self):
        self.assertEqual(authorized_paths(self.env, PurePosixPath), list(SDK_PATHS))

    def test_local_and_self_hosted_are_refused(self):
        for key in ('GITHUB_ACTIONS', 'CI', 'RUNNER_ENVIRONMENT', 'RUNNER_OS'):
            for value in ('', 'false', 'self-hosted', 'Windows'):
                with self.assertRaises(ValueError):
                    authorized_paths({**self.env, key: value}, PurePosixPath)

    def test_workspace_and_redirected_sdk_are_refused(self):
        for key, value in [('GITHUB_WORKSPACE', '/'), ('GITHUB_WORKSPACE', '/home/runner/work'),
                           ('RUNNER_TEMP', '/tmp')]:
            with self.assertRaises(ValueError):
                authorized_paths({**self.env, key: value}, PurePosixPath)
        def redirected(name):
            return PurePosixPath(self.env['GITHUB_WORKSPACE']) if name == SDK_PATHS[0] else PurePosixPath(name)
        with self.assertRaises(ValueError):
            authorized_paths(self.env, redirected)


if __name__ == '__main__':
    unittest.main()
