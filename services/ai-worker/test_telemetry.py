from opentelemetry import baggage,trace
from opentelemetry.context import Context
from opentelemetry.trace import NonRecordingSpan,SpanContext,TraceFlags,TraceState
from telemetry import queue_context,worker_headers,evaluation_span

parent='00-'+'1'*32+'-'+'2'*16+'-01'

def test_queue_trace_parent_is_remote_and_cannot_import_baggage_or_tracestate():
    context=queue_context({'traceparent':parent,'tracestate':'private=canary','baggage':'private=canary'})
    span=trace.get_current_span(context).get_span_context()
    assert span.is_remote and span.trace_id==int('1'*32,16) and not span.trace_state
    assert not baggage.get_all(context)
    assert trace.get_current_span(queue_context({'traceparent':parent[:-2]+'03'})).get_span_context().is_valid

def test_invalid_queue_transport_metadata_is_ignored_without_rejecting_job():
    for value in [None,[],{}, {'traceparent':[]},{'traceparent':parent+'x'},
                  {'traceparent':'00-'+'0'*32+'-'+'2'*16+'-01'},
                  {'traceparent':'00-'+'1'*32+'-'+'0'*16+'-01'},
                  {'traceparent':'ff-'+'1'*32+'-'+'2'*16+'-01'}]:
        assert not trace.get_current_span(queue_context(value)).get_span_context().is_valid

def test_completion_headers_never_forward_baggage_or_tracestate(monkeypatch):
    monkeypatch.setenv('STACK_TELEMETRY_ENABLED','true')
    span=NonRecordingSpan(SpanContext(int('1'*32,16),int('2'*16,16),False,TraceFlags(1),TraceState([('private','canary')])))
    with trace.use_span(span):
        assert worker_headers('synthetic-worker-token')=={
            'X-AgentTrust-Worker-Token':'synthetic-worker-token','traceparent':parent}

def test_disabled_telemetry_preserves_context_and_emits_no_trace_headers(monkeypatch):
    monkeypatch.delenv('STACK_TELEMETRY_ENABLED',raising=False)
    with evaluation_span({'traceparent':parent}):
        assert not trace.get_current_span().get_span_context().is_valid
        assert worker_headers('synthetic-worker-token')=={'X-AgentTrust-Worker-Token':'synthetic-worker-token'}
