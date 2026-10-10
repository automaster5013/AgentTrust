package dev.agenttrust.core;
import io.opentelemetry.api.baggage.Baggage;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import io.opentelemetry.context.Context;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class QueueTracingTest {
    @Test void onlyTraceParentCanCrossQueue() {
        var span = Span.wrap(SpanContext.create("1".repeat(32),"2".repeat(16),TraceFlags.getSampled(),TraceState.builder().put("private","canary").build()));
        var context = Baggage.builder().put("private","canary").build().storeInContext(span.storeInContext(Context.root()));
        var headers = QueueTracing.headers(Span.fromContext(context).getSpanContext());
        assertEquals("00-"+"1".repeat(32)+"-"+"2".repeat(16)+"-01",headers.getFirst("traceparent"));
        assertNull(headers.getFirst("tracestate"));assertNull(headers.getFirst("baggage"));
        assertTrue(QueueTracing.headers(SpanContext.getInvalid()).isEmpty());
        var random=SpanContext.create("1".repeat(32),"2".repeat(16),TraceFlags.fromHex("03",0),TraceState.getDefault());
        assertEquals("00-"+"1".repeat(32)+"-"+"2".repeat(16)+"-03",QueueTracing.headers(random).getFirst("traceparent"));
    }
    @Test void failedPublishClosesContextWithoutRecordingPayload() {
        var original = Context.current();
        assertThrows(IllegalStateException.class,()->QueueTracing.publish(headers->{throw new IllegalStateException("synthetic failure");}));
        assertSame(original,Context.current());
    }
}
