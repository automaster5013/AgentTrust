"""Optional internal OTLP instrumentation; never attach prompts, identity or credentials."""
import os
from opentelemetry import trace,metrics

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
