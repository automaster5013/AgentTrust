"""Mocked JetStream lifecycle; never contacts or changes an operating queue."""
import asyncio,importlib.util,pathlib,types,unittest
from unittest.mock import AsyncMock,patch

spec=importlib.util.spec_from_file_location('queue_fixture_probe',pathlib.Path(__file__).with_name('stack-store-queue-probe.py'));probe=importlib.util.module_from_spec(spec)
with patch.dict('sys.modules',{'nats':types.SimpleNamespace()}):spec.loader.exec_module(probe)

class QueueProbe(unittest.TestCase):
 def exercise(self,backlog=0,wrong=False):
  state=types.SimpleNamespace(messages=backlog,last_seq=10);consumer=types.SimpleNamespace(num_pending=backlog,num_ack_pending=0,ack_floor=types.SimpleNamespace(stream_seq=10))
  async def publish(subject,body):state.messages+=1;state.last_seq+=1;consumer.num_pending+=1
  async def ack_sync(**kwargs):state.messages=0;consumer.num_pending=0;consumer.num_ack_pending=0;consumer.ack_floor.stream_seq=state.last_seq
  message=types.SimpleNamespace(data=b'wrong' if wrong else b'agenttrust-owned-durable-recovery-v1',ack_sync=AsyncMock(side_effect=ack_sync))
  subscription=types.SimpleNamespace(fetch=AsyncMock(return_value=[message]))
  stream=types.SimpleNamespace(stream_info=AsyncMock(side_effect=lambda *args:types.SimpleNamespace(state=state)),consumer_info=AsyncMock(side_effect=lambda *args:consumer),publish=AsyncMock(side_effect=publish),pull_subscribe=AsyncMock(return_value=subscription))
  connection=types.SimpleNamespace(jetstream=lambda:stream,close=AsyncMock());probe.nats.connect=AsyncMock(return_value=connection)
  with patch.object(pathlib.Path,'read_text',return_value='fixture-token'):
   if backlog:
    with self.assertRaises(AssertionError):asyncio.run(probe.exercise('admit'))
    stream.publish.assert_not_called();return
   self.assertTrue(asyncio.run(probe.exercise('admit'))['completed'])
   self.assertEqual(state.messages,1)
   # State survives a simulated transport/process restart; no new stream API exists.
   if wrong:
    with self.assertRaises(AssertionError):asyncio.run(probe.exercise('completion'))
    message.ack_sync.assert_not_called()
   else:
    self.assertTrue(asyncio.run(probe.exercise('completion'))['exactPayloadAndDurableAckVerified']);self.assertEqual(consumer.ack_floor.stream_seq,11)
   self.assertEqual(connection.close.await_count,2)
 def test_existing_stream_reservation_is_reused_across_restart(self):self.exercise()
 def test_nonempty_captured_backlog_is_not_overwritten(self):self.exercise(backlog=1)
 def test_unexpected_message_is_not_acknowledged(self):self.exercise(wrong=True)

if __name__=='__main__':unittest.main()
