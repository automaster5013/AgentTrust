"""Pinned single-image scan identities and pre-export disk reserve policy."""
import re

GIB = 1073741824
SCANNER_WORKSPACE_BYTES = 8 * GIB
NAMES = ('telemetry', 'tempo', 'loki', 'prometheus', 'grafana')


def scanner_disk_budget(maximum_archive_bytes, windows):
    if type(maximum_archive_bytes) is not int or maximum_archive_bytes <= 0:
        raise ValueError('Invalid scanner archive budget')
    minimum = (22 if windows else 4) * GIB
    # The vulnerability and Java databases can coexist with their replacements,
    # downloads and analysis scratch. Keep this separate from the host reserve.
    return {'minimumReserveBytes': minimum, 'scannerWorkspaceBytes': SCANNER_WORKSPACE_BYTES,
            'requiredFreeBytes': minimum + maximum_archive_bytes + SCANNER_WORKSPACE_BYTES}


def official_reference(name, reference):
    if name not in NAMES or not isinstance(reference, str):
        raise ValueError('Observation image identity refused')
    official = name == 'grafana' and bool(re.fullmatch(r'grafana/grafana:13\.[0-9]+\.[0-9]+@sha256:[a-f0-9]{64}', reference))
    if not official and not re.fullmatch(r'agenttrust-'+name+r':local|ghcr\.io/automaster5013/agenttrust-'+name+r'@sha256:[a-f0-9]{64}', reference):
        raise ValueError('Observation image reference refused')
    return official


def archive_preflight(name, reference, image_size, free_bytes, windows):
    maximum = (3 if official_reference(name, reference) else 1) * GIB
    if type(image_size) is not int or not 0 < image_size <= maximum:
        raise ValueError('Observation image size exceeds bounded export')
    budget = scanner_disk_budget(maximum, windows)
    if type(free_bytes) is not int or free_bytes < budget['requiredFreeBytes']:
        raise ValueError('Observation image export would violate reserve')
    return {**budget, 'maximumArchiveBytes': maximum, 'imageSizeBytes': image_size}
