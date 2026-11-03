import unittest
from unittest.mock import patch
from types import SimpleNamespace
import stack_hosted_disk
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


class HostedDiskAdmissionTest(unittest.TestCase):
    def test_local_execution_is_refused_before_measurement_or_removal(self):
        with patch.dict(stack_hosted_disk.os.environ, {}, clear=True), patch.object(stack_hosted_disk.shutil, 'disk_usage', side_effect=AssertionError('local disk measured')), patch.object(stack_hosted_disk.subprocess, 'run', side_effect=AssertionError('local removal')):
            with self.assertRaises(ValueError):stack_hosted_disk.main()

    def test_start_reserve_reclaims_only_approved_sdk_until_multi_image_build_headroom(self):
        free=[31*1024**3];commands=[]
        def remove(command,**kwargs):
            commands.append(command);free[0]=44*1024**3
        with patch.object(stack_hosted_disk,'authorized_paths',return_value=list(SDK_PATHS)), patch.object(stack_hosted_disk.shutil,'disk_usage',side_effect=lambda p:SimpleNamespace(free=free[0])), patch.object(stack_hosted_disk.Path,'exists',return_value=True), patch.object(stack_hosted_disk.subprocess,'run',side_effect=remove):
            stack_hosted_disk.main()
        self.assertGreaterEqual(stack_hosted_disk.MINIMUM_FREE,40*1024**3)
        self.assertEqual(commands,[['sudo','-n','rm','-rf','--',SDK_PATHS[0]]])

if __name__ == '__main__':
    unittest.main()
