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
    async def observe():
        return await asyncio.wait_for(queue_ready(Slow(), True, True), timeout=3)
    assert not asyncio.run(observe())

# Shared observations retain the existing live consumer checks and one-second
# bound; completed answers are never a readiness cache.
import json
import unittest
from unittest.mock import patch
import operations_application as operations
from operations_application import QueueReadinessProbe


class ConcurrentConnection(Connection):
    def __init__(self):
        super().__init__()
        self.release = asyncio.Event()
        self.entered = asyncio.Event()

    async def consumer_info(self, *args):
        self.entered.set()
        await self.release.wait()
        return await super().consumer_info(*args)


class SharedQueueReadinessTests(unittest.IsolatedAsyncioTestCase):
    async def test_twenty_readers_share_two_live_consumer_contract_reads(self):
        probe, connection = QueueReadinessProbe(), ConcurrentConnection()
        tasks = [asyncio.create_task(probe.observe(connection, True, True)) for _ in range(20)]
        await connection.entered.wait()
        connection.release.set()
        self.assertTrue(all(await asyncio.gather(*tasks)))
        self.assertEqual(len(connection.calls), 2)

    async def test_completed_success_is_not_cached(self):
        probe, connection = QueueReadinessProbe(), ConcurrentConnection()
        connection.release.set()
        self.assertTrue(await probe.observe(connection, True, True))
        self.assertTrue(await probe.observe(connection, True, True))
        self.assertEqual(len(connection.calls), 4)

    async def test_cancelled_reader_does_not_cancel_shared_broker_inspection(self):
        probe, connection = QueueReadinessProbe(), ConcurrentConnection()
        first = asyncio.create_task(probe.observe(connection, True, True))
        second = asyncio.create_task(probe.observe(connection, True, True))
        await connection.entered.wait()
        first.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await first
        connection.release.set()
        self.assertTrue(await second)
        self.assertEqual(len(connection.calls), 2)

    async def test_dead_loop_and_disconnected_broker_refuse_pending_observation(self):
        probe, connection = QueueReadinessProbe(), ConcurrentConnection()
        active = asyncio.create_task(probe.observe(connection, True, True))
        await connection.entered.wait()
        self.assertFalse(await probe.observe(connection, False, True))
        self.assertFalse(await probe.observe(connection, True, False))
        connection.is_connected = False
        self.assertFalse(await probe.observe(connection, True, True))
        connection.release.set()
        self.assertFalse(await active)

    async def test_replaced_connection_does_not_join_previous_inspection(self):
        probe, first, second = QueueReadinessProbe(), ConcurrentConnection(), ConcurrentConnection()
        a = asyncio.create_task(probe.observe(first, True, True))
        await first.entered.wait()
        b = asyncio.create_task(probe.observe(second, True, True))
        await second.entered.wait()
        first.release.set()
        second.release.set()
        self.assertTrue(all(await asyncio.gather(a, b)))
        self.assertEqual(len(first.calls), 2)
        self.assertEqual(len(second.calls), 2)

    async def test_failure_is_not_cached_and_next_read_can_recover(self):
        probe, connection = QueueReadinessProbe(), ConcurrentConnection()
        connection.release.set()
        connection.failure = True
        self.assertFalse(await probe.observe(connection, True, True))
        connection.failure = False
        self.assertTrue(await probe.observe(connection, True, True))
        self.assertEqual(len(connection.calls), 3)

    async def test_shared_inspection_retains_existing_one_second_deadline(self):
        probe, connection = QueueReadinessProbe(), ConcurrentConnection()
        self.assertFalse(await asyncio.wait_for(probe.observe(connection, True, True), timeout=3))
        self.assertIsNone(probe.task)

    async def response_after_pending_change(self, change):
        connection, replacement = ConcurrentConnection(), ConcurrentConnection()
        with patch.dict(operations.inspection, {'connection': connection}), patch.dict(operations.worker_state, {'ready': True}), patch.dict(operations.reference_state, {'ready': True}), patch.object(operations, 'readiness_probe', QueueReadinessProbe()):
            pending = asyncio.create_task(operations.ready())
            await connection.entered.wait()
            if change == 'loop':
                operations.worker_state['ready'] = False
            else:
                operations.inspection['connection'] = replacement
            connection.release.set()
            response = await pending
            self.assertEqual(response.status_code, 503)
            body = json.loads(response.body)
            self.assertFalse(body['ready'])
            self.assertFalse(body['queueReady'])

    async def test_http_contract_rechecks_worker_loop_after_shared_await(self):
        await self.response_after_pending_change('loop')

    async def test_http_contract_rechecks_current_connection_after_shared_await(self):
        await self.response_after_pending_change('connection')
