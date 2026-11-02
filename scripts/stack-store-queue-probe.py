"""Synthetic durable backlog probe on the owned fixture network only."""
import argparse,asyncio,json,pathlib
import nats
stage='connect'

async def exercise(phase):
 global stage
 connection=await nats.connect('nats://stack-nats:4222',token=pathlib.Path('/run/secrets/stack-nats-token').read_text(),connect_timeout=3,max_reconnect_attempts=0)
 try:
  stream=connection.jetstream();name='STACK_EVALUATIONS';subject='stack.evaluations';durable='python-evaluator';body=b'agenttrust-owned-durable-recovery-v1'
  if phase=='admit':
   stage='check-empty-restored-stream'
   existing=await stream.stream_info(name);consumer=await stream.consumer_info(name,durable)
   assert existing.state.messages==0 and consumer.num_pending==0 and consumer.num_ack_pending==0
   stage='publish-owned-pending-message'
   await stream.publish(subject,body)
   info=await stream.consumer_info(name,durable);assert info.num_pending==1
   return {'completed':True,'pendingSyntheticMessages':1}
  stage='fetch-restored-durable-message';subscription=await stream.pull_subscribe(subject,durable=durable,stream=name)
  messages=await subscription.fetch(batch=1,timeout=10);assert len(messages)==1 and messages[0].data==body
  await messages[0].ack_sync(timeout=5);info=await stream.consumer_info(name,durable)
  current=await stream.stream_info(name)
  assert info.num_pending==0 and info.num_ack_pending==0 and info.ack_floor.stream_seq==current.state.last_seq
  return {'completed':True,'exactPayloadAndDurableAckVerified':True}
 finally:await connection.close()

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--phase',choices=('admit','completion'),required=True);args=parser.parse_args()
 try:report=asyncio.run(exercise(args.phase))
 except Exception as error:report={'completed':False,'errorType':type(error).__name__,'stage':stage,'serverCode':getattr(error,'code',None),'jetstreamErrorCode':getattr(error,'err_code',None)}
 print(json.dumps(report));return 0 if report['completed'] else 1
if __name__=='__main__':raise SystemExit(main())
