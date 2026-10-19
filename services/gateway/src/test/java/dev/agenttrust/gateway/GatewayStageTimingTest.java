package dev.agenttrust.gateway;

import io.micrometer.core.instrument.MockClock;
import io.micrometer.core.instrument.Timer;
import io.micrometer.core.instrument.simple.SimpleConfig;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Duration;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;
import static org.junit.jupiter.api.Assertions.*;

class GatewayStageTimingTest {
    final MockClock clock=new MockClock();
    final SimpleMeterRegistry registry=new SimpleMeterRegistry(SimpleConfig.DEFAULT,clock);
    final GatewayStageTiming timing=new GatewayStageTiming(registry);
    Timer timer(String stage,String outcome){return registry.get(GatewayStageTiming.NAME)
        .tags("agenttrust.gateway.stage",stage,"agenttrust.gateway.outcome",outcome).timer();}
    long count(){return registry.find(GatewayStageTiming.NAME).timers().stream().mapToLong(Timer::count).sum();}

    @Test void timingStartsAtSubscriptionAndHasOneRecordPerSubscription(){
        var calls=new AtomicInteger();
        var operation=timing.measure(GatewayStageTiming.Stage.IDENTITY,()->{
            calls.incrementAndGet();clock.add(Duration.ofMillis(125));return Mono.just("unchanged");
        });
        clock.add(Duration.ofSeconds(10));assertEquals(0,calls.get());assertEquals(0,count());
        StepVerifier.create(operation).expectNext("unchanged").verifyComplete();
        StepVerifier.create(operation).expectNext("unchanged").verifyComplete();
        assertEquals(2,calls.get());assertEquals(2,count());
        assertEquals(250,timer("identity","completed").totalTime(TimeUnit.MILLISECONDS),0.001);
    }

    @Test void upstreamErrorAndSynchronousFactoryErrorKeepTheOriginalFailure(){
        var original=new IllegalStateException("synthetic fixture detail");
        StepVerifier.create(timing.measure(GatewayStageTiming.Stage.IDENTITY,()->Mono.error(original)))
            .expectErrorSatisfies(error->assertSame(original,error)).verify();
        StepVerifier.create(timing.measure(GatewayStageTiming.Stage.QUOTA,()->{throw original;}))
            .expectErrorSatisfies(error->assertSame(original,error)).verify();
        assertEquals(1,timer("identity","error").count());assertEquals(1,timer("quota","error").count());
        assertEquals(2,count());
    }

    @Test void cancellationAndOuterTimeoutAreRecordedWithoutCreatingAResult(){
        var waiting=timing.measure(GatewayStageTiming.Stage.QUOTA,()->Mono.never());
        StepVerifier.create(waiting).then(()->clock.add(Duration.ofMillis(50))).thenCancel().verify();
        StepVerifier.withVirtualTime(()->waiting.timeout(Duration.ofSeconds(6)))
            .then(()->clock.add(Duration.ofSeconds(6))).thenAwait(Duration.ofSeconds(7))
            .expectError(java.util.concurrent.TimeoutException.class).verify();
        assertEquals(2,timer("quota","cancelled").count());assertEquals(2,count());
        assertEquals(6050,timer("quota","cancelled").totalTime(TimeUnit.MILLISECONDS),0.001);
    }

    @Test void emptyCompletionIsCountedOnceWithoutBecomingAnError(){
        StepVerifier.create(timing.measure(GatewayStageTiming.Stage.FORWARD,Mono::empty)).verifyComplete();
        assertEquals(1,timer("forward","completed").count());assertEquals(1,count());
    }

    @Test void metricDimensionsAndHistogramBoundariesAreFixed(){
        var timers=registry.find(GatewayStageTiming.NAME).timers();assertEquals(9,timers.size());
        for(var meter:timers){
            assertEquals(GatewayStageTiming.NAME,meter.getId().getName());
            assertEquals(Set.of("agenttrust.gateway.stage","agenttrust.gateway.outcome"),
                meter.getId().getTags().stream().map(io.micrometer.core.instrument.Tag::getKey).collect(java.util.stream.Collectors.toSet()));
            assertTrue(Set.of("identity","quota","forward").contains(meter.getId().getTag("agenttrust.gateway.stage")));
            assertTrue(Set.of("completed","error","cancelled").contains(meter.getId().getTag("agenttrust.gateway.outcome")));
            assertArrayEquals(new double[]{5e6,25e6,100e6,250e6,500e6,1e9,3e9,6e9},
                java.util.Arrays.stream(meter.takeSnapshot().histogramCounts()).mapToDouble(bucket->bucket.bucket()).filter(Double::isFinite).toArray(),0.001);
        }
    }
}
