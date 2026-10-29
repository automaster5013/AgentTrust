"""Bounded, read-only confirmation of an owned --rm fixture's asynchronous removal."""
import time


def wait_for_owned_fixture_removal(run, owner, timeout=10, *, monotonic=time.monotonic, sleep=time.sleep):
    """Wait for an already stopped fixture; never remove or stop another resource."""
    deadline = monotonic() + timeout
    while True:
        remaining = run(['docker', 'ps', '-a', '-q', '--filter', 'label=dev.agenttrust.owner=' + owner], cleanup=True)
        if not remaining.strip():
            return
        if monotonic() >= deadline:
            raise TimeoutError('OWNED_FIXTURE_REMOVAL_NOT_CONFIRMED')
        sleep(min(.25, max(0, deadline - monotonic())))
