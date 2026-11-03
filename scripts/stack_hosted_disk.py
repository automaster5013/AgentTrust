"""Recover unused SDK space only on disposable GitHub-hosted Linux runners."""
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess

SDK_PATHS = ('/usr/local/lib/android', '/usr/share/dotnet', '/opt/ghc', '/usr/local/.ghcup')
MINIMUM_FREE = 24 * 1024 ** 3


def authorized_paths(env, resolve=lambda p: Path(p).resolve()):
    for key, expected in {'GITHUB_ACTIONS': 'true', 'CI': 'true',
                          'RUNNER_ENVIRONMENT': 'github-hosted', 'RUNNER_OS': 'Linux'}.items():
        if env.get(key) != expected:
            raise ValueError('disposable hosted Linux runner required')
    workspace = resolve(env.get('GITHUB_WORKSPACE', ''))
    temporary = resolve(env.get('RUNNER_TEMP', ''))
    base = PurePosixPath('/home/runner/work')
    if not workspace.is_relative_to(base) or workspace == base or temporary != base / '_temp':
        raise ValueError('unexpected hosted workspace')
    result = []
    for name in SDK_PATHS:
        target = resolve(name)
        if target != PurePosixPath(name) or workspace.is_relative_to(target) or target.is_relative_to(workspace):
            raise ValueError('SDK path must be canonical and outside workspace')
        result.append(name)
    return result


def main():
    paths = authorized_paths(os.environ)
    before = shutil.disk_usage('/').free
    removed = []
    for name in paths:
        if shutil.disk_usage('/').free >= MINIMUM_FREE:
            break
        if Path(name).exists():
            subprocess.run(['sudo', '-n', 'rm', '-rf', '--', name], check=True, timeout=180)
            removed.append(name)
    after = shutil.disk_usage('/').free
    print(json.dumps({'beforeFreeBytes': before, 'afterFreeBytes': after,
                      'minimumFreeBytes': MINIMUM_FREE, 'removedUnusedHostedSdks': removed,
                      'dockerAssetsModified': False, 'workspaceModified': False}))
    if after < MINIMUM_FREE:
        raise RuntimeError('insufficient disposable runner disk before integration')


if __name__ == '__main__':
    main()
