"""Select attempt-bound diagnostics without replacing prior evidence."""
import re


def diagnostic_artifact_revision(name, attempt):
    assert type(attempt) is int and 1 <= attempt <= 9999
    if not isinstance(name, str): return None
    match = re.fullmatch(r'original-stack-diagnostics-([a-f0-9]{40})(?:-attempt-([1-9][0-9]{0,3}))?', name)
    if not match: return None
    encoded_attempt = int(match[2]) if match[2] is not None else 1
    return match[1] if encoded_attempt == attempt else None


def select_diagnostic_artifact(artifacts, revision, attempt):
    assert re.fullmatch('[a-f0-9]{40}', revision)
    selected = [item for item in artifacts if item.get('expired') is False
                and diagnostic_artifact_revision(item.get('name'), attempt) == revision]
    assert len(selected) == 1, 'DIAGNOSTIC_ATTEMPT_ARTIFACT_UNVERIFIED'
    return selected[0]
