"""This mode may mutate only the disposable GitHub-hosted synthetic stack."""
import os
import pathlib


def require_hosted(root, environment=None):
    env = os.environ if environment is None else environment
    if not (os.name == 'posix' and os.getuid() != 0 and env.get('CI') == 'true'
            and env.get('GITHUB_ACTIONS') == 'true' and env.get('RUNNER_ENVIRONMENT') == 'github-hosted'
            and env.get('GITHUB_REPOSITORY') == 'automaster5013/AgentTrust'
            and env.get('GITHUB_WORKSPACE') and pathlib.Path(env['GITHUB_WORKSPACE']).resolve() == root.resolve()):
        raise ValueError('HOSTED_SYNTHETIC_RETURN_ONLY')
