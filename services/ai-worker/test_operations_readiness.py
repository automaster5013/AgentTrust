import asyncio
from types import SimpleNamespace
import pytest
from operations_application import CONSUMERS, queue_ready
from nats.js.api import AckPolicy

class Connection:
    is_connected = True
    def __init__(self, change=None, failure=False):
        self.change = change or {}
        self.failure = failure
        self.calls = []
    def jetstream(self, timeout):
        assert timeout == 0.4
        return self
    async def consumer_info(self, stream, durable):
        self.calls.append((stream, durable))
        if self.failure:
            raise RuntimeError('private broker details')
        subject, pending = next((s,p) for n,d,s,p in CONSUMERS if n == stream and d == durable)
        config = dict(durable_name=durable, filter_subject=subject,
            ack_policy=AckPolicy.EXPLICIT, ack_wait=15, max_deliver=20, max_ack_pending=pending)
        config.update(self.change)
        return SimpleNamespace(stream_name=stream, name=durable, config=SimpleNamespace(**config))

def run(connection, fixed=True, reference=True):
    return asyncio.run(queue_ready(connection, fixed, reference))

def test_both_actual_consumer_contracts_are_checked():
    connection = Connection()
    assert run(connection)
    assert connection.calls == [(n,d) for n,d,s,p in CONSUMERS]

@pytest.mark.parametrize('fixed,reference', [(False,True),(True,False),(False,False)])
def test_dead_loop_never_reads_queue(fixed,reference):
    connection = Connection()
    assert not run(connection,fixed,reference)
    assert not connection.calls

def test_disconnected_missing_and_rpc_failure_fail_closed():
    assert not run(None)
    connection = Connection(); connection.is_connected = False
    assert not run(connection)
    assert not run(Connection(failure=True))

@pytest.mark.parametrize('change', [
    {'durable_name':'other'}, {'filter_subject':'>'}, {'ack_policy':AckPolicy.NONE},
    {'ack_wait':30}, {'max_deliver':-1}, {'max_ack_pending':99},
])
def test_reconfigured_consumer_fails_closed(change):
    assert not run(Connection(change=change))

def test_queue_timeout_is_bounded():
    class Slow(Connection):
        async def consumer_info(self,*args):
            await asyncio.sleep(10)
    assert not run(Slow())
