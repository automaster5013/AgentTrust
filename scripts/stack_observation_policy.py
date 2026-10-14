"""Pinned single-image scan identities and pre-export disk reserve policy."""
import re

GIB = 1073741824
NAMES = ('telemetry', 'tempo', 'loki', 'prometheus', 'grafana')


def official_reference(name, reference):
    if name not in NAMES or not isinstance(reference, str):
        raise ValueError('Observation image identity refused')
    official = name == 'grafana' and bool(re.fullmatch(r'grafana/grafana:13\.[0-9]+\.[0-9]+@sha256:[a-f0-9]{64}', reference))
    if not official and not re.fullmatch(r'agenttrust-'+name+r':local|ghcr\.io/automaster5013/agenttrust-'+name+r'@sha256:[a-f0-9]{64}', reference):
        raise ValueError('Observation image reference refused')
    return official


def archive_preflight(name, reference, image_size, free_bytes, windows):
    maximum = (3 if official_reference(name, reference) else 1) * GIB
    minimum = (22 if windows else 4) * GIB
    if type(image_size) is not int or not 0 < image_size <= maximum:
        raise ValueError('Observation image size exceeds bounded export')
    if type(free_bytes) is not int or free_bytes < minimum + image_size:
        raise ValueError('Observation image export would violate reserve')
    return {'minimumReserveBytes': minimum, 'maximumArchiveBytes': maximum, 'imageSizeBytes': image_size}
