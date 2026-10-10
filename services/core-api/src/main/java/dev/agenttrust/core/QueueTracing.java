package dev.agenttrust.core;

import io.nats.client.impl.Headers;
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.api.trace.SpanContext;

/** Only a generated W3C traceparent crosses the queue; no baggage, payload or actor attributes. */
final class QueueTracing {
    private QueueTracing() {}
    interface Publisher { void publish(Headers headers) throws Exception; }
    static Headers headers(SpanContext context) {
        var headers = new Headers();
        if (context.isValid()) {
            String value = "00-" + context.getTraceId() + "-" + context.getSpanId() + "-" + context.getTraceFlags().asHex();
            if (value.matches("00-[a-f0-9]{32}-[a-f0-9]{16}-[a-f0-9]{2}")) headers.put("traceparent",value);
        }
        return headers;
    }
    static void publish(Publisher publisher) throws Exception {
        // DB dispatch is independent of the admission HTTP request, not a fabricated HTTP parent.
        Span span = GlobalOpenTelemetry.getTracer("agenttrust.queue").spanBuilder("evaluation publish")
            .setNoParent().setSpanKind(SpanKind.PRODUCER).startSpan();
        try (var scope = span.makeCurrent()) { publisher.publish(headers(span.getSpanContext())); }
        finally { span.end(); }
    }
}
