package dev.agenttrust.gateway;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.http.*;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.reactive.function.client.*;
import org.springframework.mock.env.MockEnvironment;
import reactor.core.publisher.Mono;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class BackChannelGatewayTest {
 @Test void receiverForwardsOnlyTheFixedFormWithoutCookiesAuthScopeOrResponseSecrets(){
  var quota=mock(QuotaService.class);when(quota.admit("public-backchannel",true)).thenReturn(Mono.just(1L));var calls=new AtomicInteger();
  var core=WebClient.builder().baseUrl("http://stack-core-api:8080").exchangeFunction(request->{calls.incrementAndGet();assertEquals(BackChannelForm.PATH,request.url().getPath());assertEquals(HttpMethod.POST,request.method());assertEquals(MediaType.APPLICATION_FORM_URLENCODED,request.headers().getContentType());for(String name:java.util.List.of("Cookie","Authorization","X-CSRF-TOKEN","X-Organization-Id","Origin"))assertNull(request.headers().getFirst(name));return Mono.just(ClientResponse.create(HttpStatus.OK).header("Set-Cookie","AGENTTRUST_STACK_SESSION=refused").header("Location","https://other.example/").body("never-forward-token-details").build());}).build();
  var client=WebTestClient.bindToController(new GatewayController(core,quota)).build();
  client.post().uri(BackChannelForm.PATH).contentType(MediaType.APPLICATION_FORM_URLENCODED).header("Cookie","AGENTTRUST_STACK_SESSION=caller").header("Authorization","Bearer caller").header("X-Organization-Id","caller").header("X-CSRF-TOKEN","caller").bodyValue("logout_token=aa.bb.cc").exchange().expectStatus().isOk().expectHeader().doesNotExist("Set-Cookie").expectHeader().doesNotExist("Location").expectBody().isEmpty();
  assertEquals(1,calls.get());verify(quota).admit("public-backchannel",true);
 }
 @Test void malformedOrOversizedFormsAreRefusedBeforeQuotaAndUnsupportedMethodsStayClosed(){
  var quota=mock(QuotaService.class);var calls=new AtomicInteger();var core=WebClient.builder().exchangeFunction(request->{calls.incrementAndGet();return Mono.error(new IllegalStateException());}).build();var client=WebTestClient.bindToController(new GatewayController(core,quota)).build();
  client.get().uri(BackChannelForm.PATH).exchange().expectStatus().isNotFound();
  client.post().uri(BackChannelForm.PATH).contentType(MediaType.APPLICATION_JSON).bodyValue("{}").exchange().expectStatus().isBadRequest();
  client.post().uri(BackChannelForm.PATH).contentType(MediaType.APPLICATION_FORM_URLENCODED).bodyValue("logout_token=aa.bb.cc&logout_token=dd.ee.ff").exchange().expectStatus().isBadRequest();
  client.post().uri(BackChannelForm.PATH).contentType(MediaType.APPLICATION_FORM_URLENCODED).bodyValue("x".repeat(16385)).exchange().expectStatus().isEqualTo(413);
  client.post().uri(BackChannelForm.PATH+"?target=other").contentType(MediaType.APPLICATION_FORM_URLENCODED).bodyValue("logout_token=aa.bb.cc").exchange().expectStatus().isBadRequest();
  verifyNoInteractions(quota);assertEquals(0,calls.get());
 }
 @Test void quotaDenialOrFailureCannotForwardUnboundedAnonymousJwtWork(){
  var quota=mock(QuotaService.class);var calls=new AtomicInteger();var core=WebClient.builder().exchangeFunction(request->{calls.incrementAndGet();return Mono.error(new IllegalStateException());}).build();var client=WebTestClient.bindToController(new GatewayController(core,quota)).build();
  when(quota.admit("public-backchannel",true)).thenReturn(Mono.just(-42L));client.post().uri(BackChannelForm.PATH).contentType(MediaType.APPLICATION_FORM_URLENCODED).bodyValue("logout_token=aa.bb.cc").exchange().expectStatus().isEqualTo(429).expectHeader().valueEquals("Retry-After","42");
  when(quota.admit("public-backchannel",true)).thenReturn(Mono.error(new IllegalStateException("private-redis-error")));client.post().uri(BackChannelForm.PATH).contentType(MediaType.APPLICATION_FORM_URLENCODED).bodyValue("logout_token=aa.bb.cc").exchange().expectStatus().isEqualTo(503).expectBody().json("{\"code\":\"LOGOUT_UNAVAILABLE\"}");assertEquals(0,calls.get());
 }
 @Test void httpsProfilePassesOnlyTheConfiguredIssuerRedirectAndCallback(){
  var environment=new MockEnvironment().withProperty("agenttrust.oidc.profile","https-review").withProperty("agenttrust.oidc.application-origin","https://app.agenttrust.test").withProperty("agenttrust.oidc.public-issuer","https://identity.agenttrust.test/realms/agenttrust");
  var core=WebClient.builder().exchangeFunction(request->Mono.just(ClientResponse.create(HttpStatus.FOUND).header("Location",request.url().getPath().equals("/oauth2/authorization/keycloak")?"https://identity.agenttrust.test/realms/agenttrust/protocol/openid-connect/auth?state=fixture":"https://app.agenttrust.test/").build())).build();
  var client=WebTestClient.bindToController(new GatewayController(core,mock(QuotaService.class),environment)).build();client.get().uri("/oauth2/authorization/keycloak").exchange().expectStatus().isFound().expectHeader().valueEquals("Location","https://identity.agenttrust.test/realms/agenttrust/protocol/openid-connect/auth?state=fixture");client.get().uri("/login/oauth2/code/keycloak?code=abcdefgh&state=abcdefgh").exchange().expectStatus().isFound().expectHeader().valueEquals("Location","https://app.agenttrust.test/");
 }
}
