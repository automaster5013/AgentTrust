package dev.agenttrust.gateway;

import io.micrometer.core.instrument.MockClock;
import io.micrometer.core.instrument.simple.SimpleConfig;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Duration;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class GatewayStageBoundaryTest {
    final MockClock clock=new MockClock();
    final SimpleMeterRegistry registry=new SimpleMeterRegistry(SimpleConfig.DEFAULT,clock);
    final GatewayStageTiming timing=new GatewayStageTiming(registry);
    long count(String stage,String outcome){return registry.get(GatewayStageTiming.NAME)
        .tags("agenttrust.gateway.stage",stage,"agenttrust.gateway.outcome",outcome).timer().count();}
    WebClient core(AtomicInteger calls){return WebClient.builder().exchangeFunction(request->Mono.defer(()->{
        calls.incrementAndGet();boolean identity=request.url().getPath().equals("/api/me");
        clock.add(Duration.ofMillis(identity?100:300));
        return Mono.just(ClientResponse.create(HttpStatus.OK).header("Content-Type","application/json")
            .body(identity?"{\"organizationId\":\""+GatewayBoundaryTest.ORG+"\",\"projectId\":\""+GatewayBoundaryTest.PROJECT+"\"}":"[]").build());
    })).build();}
    QuotaService quota(long result){var quota=mock(QuotaService.class);
        when(quota.admit(anyString(),anyBoolean())).thenAnswer(ignored->Mono.defer(()->{
            clock.add(Duration.ofMillis(50));return Mono.just(result);
        }));return quota;}

    @Test void protectedRequestMeasuresIndependentStagesAndKeepsTheResponse(){
        var calls=new AtomicInteger();var client=WebTestClient.bindToController(new GatewayController(core(calls),quota(1),timing)).build();
        client.get().uri("/api/runs").header("Cookie","AGENTTRUST_STACK_SESSION=fixture")
            .exchange().expectStatus().isOk().expectHeader().valueEquals("X-AgentTrust-Gateway","spring-webflux")
            .expectBody().json("[]");
        assertEquals(2,calls.get());
        for(var stage:new String[]{"identity","quota","forward"})assertEquals(1,count(stage,"completed"));
        assertEquals(100,registry.get(GatewayStageTiming.NAME).tags("agenttrust.gateway.stage","identity","agenttrust.gateway.outcome","completed").timer().totalTime(TimeUnit.MILLISECONDS),0.001);
        assertEquals(50,registry.get(GatewayStageTiming.NAME).tags("agenttrust.gateway.stage","quota","agenttrust.gateway.outcome","completed").timer().totalTime(TimeUnit.MILLISECONDS),0.001);
        assertEquals(300,registry.get(GatewayStageTiming.NAME).tags("agenttrust.gateway.stage","forward","agenttrust.gateway.outcome","completed").timer().totalTime(TimeUnit.MILLISECONDS),0.001);
    }

    @Test void quotaDenialDoesNotRecordAnUpstreamRequest(){
        var calls=new AtomicInteger();var client=WebTestClient.bindToController(new GatewayController(core(calls),quota(-42),timing)).build();
        client.get().uri("/api/runs").header("Cookie","AGENTTRUST_STACK_SESSION=fixture")
            .exchange().expectStatus().isEqualTo(429).expectHeader().valueEquals("Retry-After","42");
        assertEquals(1,calls.get());assertEquals(1,count("identity","completed"));
        assertEquals(1,count("quota","completed"));assertEquals(0,count("forward","completed"));
    }

    @Test void unauthenticatedIdentityRecordsOnlyAnIdentityError(){
        var quota=mock(QuotaService.class);var core=WebClient.builder().exchangeFunction(request->
            Mono.just(ClientResponse.create(HttpStatus.UNAUTHORIZED).build())).build();
        var client=WebTestClient.bindToController(new GatewayController(core,quota,timing)).build();
        client.get().uri("/api/runs").header("Cookie","AGENTTRUST_STACK_SESSION=fixture").exchange().expectStatus().isUnauthorized();
        assertEquals(1,count("identity","error"));assertEquals(0,count("quota","completed"));verifyNoInteractions(quota);
    }

    @Test void unchangedSixSecondDeadlineCancelsTheActualWaitingStage(){
        var quota=mock(QuotaService.class);var core=WebClient.builder().exchangeFunction(request->Mono.never()).build();
        var controller=new GatewayController(core,quota,timing);
        var exchange=MockServerWebExchange.from(MockServerHttpRequest.get("/api/runs").header("Cookie","AGENTTRUST_STACK_SESSION=fixture"));
        StepVerifier.withVirtualTime(()->controller.forward(exchange)).thenAwait(Duration.ofSeconds(7))
            .assertNext(response->assertEquals(503,response.getStatusCode().value())).verifyComplete();
        assertEquals(1,count("identity","cancelled"));assertEquals(0,count("forward","completed"));verifyNoInteractions(quota);
    }

    @Test void anonymousAndRefusedRoutesCreateNoStageMeasurements(){
        var calls=new AtomicInteger();var quota=mock(QuotaService.class);
        var client=WebTestClient.bindToController(new GatewayController(core(calls),quota,timing)).build();
        client.get().uri("/api/runs").exchange().expectStatus().isUnauthorized();
        client.get().uri("/api/private").exchange().expectStatus().isNotFound();
        assertEquals(0,calls.get());assertEquals(0,registry.find(GatewayStageTiming.NAME).timers().stream().mapToLong(io.micrometer.core.instrument.Timer::count).sum());
        verifyNoInteractions(quota);
    }
}
