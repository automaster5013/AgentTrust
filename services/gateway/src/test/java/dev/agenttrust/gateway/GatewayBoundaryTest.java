package dev.agenttrust.gateway;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.*;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.reactive.function.client.*;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;
import java.time.Duration;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;
class GatewayBoundaryTest {
 static final String ORG="11111111-1111-4111-8111-111111111111",PROJECT="22222222-2222-4222-8222-222222222222";
 static WebClient core(){return WebClient.builder().exchangeFunction(request->{assertFalse(request.headers().containsKey("X-Organization-Id"));assertFalse(request.headers().containsKey("Authorization"));return Mono.just(ClientResponse.create(HttpStatus.OK).header("Content-Type","application/json").body(request.url().getPath().equals("/api/me")?"{\"organizationId\":\""+ORG+"\",\"projectId\":\""+PROJECT+"\"}":"[]").build());}).build();}
 @Test void oauthStateEncodingSurvivesTheProxyExactly(){var core=WebClient.builder().exchangeFunction(request->{assertEquals("code=abcdefgh&state=abcdefgh%3D",request.url().getRawQuery());return Mono.just(ClientResponse.create(HttpStatus.FOUND).header("Location","http://127.0.0.1:4320/").build());}).build();var client=WebTestClient.bindToController(new GatewayController(core,mock(QuotaService.class))).build();client.get().uri(java.net.URI.create("/login/oauth2/code/keycloak?code=abcdefgh&state=abcdefgh%3D")).exchange().expectStatus().isFound();}
 @Test void callerScopeHeaderCannotChooseQuotaTenant(){var quota=mock(QuotaService.class);when(quota.admit(ORG+":"+PROJECT,false)).thenReturn(Mono.just(1L));var client=WebTestClient.bindToController(new GatewayController(core(),quota)).build();client.get().uri("/api/runs").header("Cookie","AGENTTRUST_STACK_SESSION=session").header("X-Organization-Id","attacker").header("Authorization","Bearer attacker").exchange().expectStatus().isOk().expectHeader().valueEquals("X-AgentTrust-Gateway","spring-webflux");verify(quota).admit(ORG+":"+PROJECT,false);}
 @Test void quotaDenialReturnsRetryAfterAndAnonymousCannotReserveQuota(){var quota=mock(QuotaService.class);when(quota.admit(ORG+":"+PROJECT,false)).thenReturn(Mono.just(-42L));var client=WebTestClient.bindToController(new GatewayController(core(),quota)).build();client.get().uri("/api/runs").header("Cookie","AGENTTRUST_STACK_SESSION=session").exchange().expectStatus().isEqualTo(429).expectHeader().valueEquals("Retry-After","42");client.get().uri("/api/runs").exchange().expectStatus().isUnauthorized();verify(quota,times(1)).admit(anyString(),anyBoolean());}
 @Test void oversizedBodyIsRejectedBeforeProxy(){var quota=mock(QuotaService.class);when(quota.admit(ORG+":"+PROJECT,true)).thenReturn(Mono.just(1L));var client=WebTestClient.bindToController(new GatewayController(core(),quota)).build();client.post().uri("/api/runs").header("Cookie","AGENTTRUST_STACK_SESSION=session").header("X-CSRF-TOKEN","bounded-test-token").bodyValue("x".repeat(17000)).exchange().expectStatus().isEqualTo(413);}
 @Test void missingCsrfHeaderIsRefusedBeforeAuthenticationOrQuota(){var quota=mock(QuotaService.class);var client=WebTestClient.bindToController(new GatewayController(core(),quota)).build();client.post().uri("/api/runs").bodyValue("{}").exchange().expectStatus().isForbidden();verifyNoInteractions(quota);}
 @Test void unavailableQuotaCannotFallBackToUnrestrictedRequests(){var quota=mock(QuotaService.class);when(quota.admit(ORG+":"+PROJECT,false)).thenReturn(Mono.never());var controller=new GatewayController(core(),quota);var request=MockServerWebExchange.from(MockServerHttpRequest.get("/api/runs").header("Cookie","AGENTTRUST_STACK_SESSION=session"));StepVerifier.withVirtualTime(()->controller.forward(request)).thenAwait(Duration.ofSeconds(7)).assertNext(response->{assertEquals(503,response.getStatusCode().value());assertTrue(new String(response.getBody()).contains("GATEWAY_UNAVAILABLE"));}).verifyComplete();}
}
