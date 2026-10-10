"""Optional internal OTLP instrumentation; never attach prompts, identity or credentials."""
import os
import re
from contextlib import contextmanager
from opentelemetry import trace,metrics
from opentelemetry.context import Context
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

def queue_context(headers):
    # Ignore malformed transport metadata; telemetry cannot reject an otherwise valid job.
    value = headers.get('traceparent') if isinstance(headers,dict) else None
    if not isinstance(value,str) or not re.fullmatch(r'00-[a-f0-9]{32}-[a-f0-9]{16}-[a-f0-9]{2}',value):
        return Context()
    if value[3:35]=='0'*32 or value[36:52]=='0'*16:
        return Context()
    return TraceContextTextMapPropagator().extract({'traceparent':value},context=Context())

@contextmanager
def evaluation_span(headers):
    if os.environ.get('STACK_TELEMETRY_ENABLED')!='true':
        yield
        return
    with trace.get_tracer('agenttrust.queue').start_as_current_span(
            'evaluation consume',context=queue_context(headers),kind=trace.SpanKind.CONSUMER,
            record_exception=False,set_status_on_exception=False):
        yield

def worker_headers(token):
    headers={'X-AgentTrust-Worker-Token':token}
    if os.environ.get('STACK_TELEMETRY_ENABLED')=='true':
        carrier={}
        TraceContextTextMapPropagator().inject(carrier)
        value=carrier.get('traceparent')
        if isinstance(value,str) and re.fullmatch(r'00-[a-f0-9]{32}-[a-f0-9]{16}-[a-f0-9]{2}',value):
            headers['traceparent']=value
    return headers

def configure(app):
    if os.environ.get('STACK_TELEMETRY_ENABLED')!='true':
        return
    os.environ['OTEL_METRICS_EXEMPLAR_FILTER']='always_off'
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.sdk._logs import LoggerProvider,LoggingHandler
    from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
    from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    import logging
    resource=Resource.create({'service.name':'agenttrust-ai-worker'})
    traces=TracerProvider(resource=resource)
    traces.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint='http://stack-otel:4318/v1/traces',timeout=2),max_queue_size=128,max_export_batch_size=32,schedule_delay_millis=1000))
    trace.set_tracer_provider(traces)
    metric_reader=PeriodicExportingMetricReader(OTLPMetricExporter(endpoint='http://stack-otel:4318/v1/metrics',timeout=2),export_interval_millis=5000,export_timeout_millis=2000)
    metrics.set_meter_provider(MeterProvider(resource=resource,metric_readers=[metric_reader]))
    logs=LoggerProvider(resource=resource)
    logs.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter(endpoint='http://stack-otel:4318/v1/logs',timeout=2),max_queue_size=128,max_export_batch_size=32,schedule_delay_millis=1000))
    event=logging.getLogger('agenttrust.evaluation');event.setLevel(logging.INFO);event.propagate=False;event.addHandler(LoggingHandler(level=logging.INFO,logger_provider=logs))
    FastAPIInstrumentor.instrument_app(app,tracer_provider=traces,meter_provider=metrics.get_meter_provider(),excluded_urls='health')

def evaluation_event():
    if os.environ.get('STACK_TELEMETRY_ENABLED')=='true':
        import logging
        metrics.get_meter('agenttrust.worker').create_counter('agenttrust.evaluations').add(1)
        logging.getLogger('agenttrust.evaluation').info('Synthetic evaluation completed')
