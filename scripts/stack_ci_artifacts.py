"""Select attempt-bound diagnostics without replacing prior evidence."""
import re


def require(condition):
    if not condition:
        raise ValueError('DIAGNOSTIC_ATTEMPT_ARTIFACT_UNVERIFIED')


def diagnostic_artifact_revision(name, attempt):
    require(type(attempt) is int and 1 <= attempt <= 9999)
    if not isinstance(name, str): return None
    match = re.fullmatch(r'original-stack-diagnostics-attempt-([1-9][0-9]{0,3})-([a-f0-9]{40})', name)
    if match: return match[2] if int(match[1]) == attempt else None
    # Preserve readers for the original first-attempt and earlier attempt suffixes.
    match = re.fullmatch(r'original-stack-diagnostics-([a-f0-9]{40})(?:-attempt-([1-9][0-9]{0,3}))?', name)
    if not match: return None
    encoded_attempt = int(match[2]) if match[2] is not None else 1
    return match[1] if encoded_attempt == attempt else None


def select_diagnostic_artifact(artifacts, revision, attempt):
    require(isinstance(revision, str) and re.fullmatch('[a-f0-9]{40}', revision))
    selected = [item for item in artifacts if item.get('expired') is False
                and diagnostic_artifact_revision(item.get('name'), attempt) == revision]
    require(len(selected) == 1)
    return selected[0]
