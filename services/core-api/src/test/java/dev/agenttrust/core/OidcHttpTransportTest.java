package dev.agenttrust.core;

import static org.junit.jupiter.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.security.oauth2.client.endpoint.OAuth2AuthorizationCodeGrantRequest;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.userinfo.OAuth2UserRequest;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.core.endpoint.*;

class OidcHttpTransportTest {
    private static ClientRegistration registration(String base) {
        return ClientRegistration.withRegistrationId("fixture").clientId("fixture-client").clientSecret(UUID.randomUUID().toString()).clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC).authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE).redirectUri(base+"/callback").scope("openid").authorizationUri(base+"/authorize").tokenUri(base+"/token").userInfoUri(base+"/userinfo").userNameAttributeName("sub").build();
    }
    private static OAuth2AuthorizationCodeGrantRequest grant(ClientRegistration client) {
        var request=OAuth2AuthorizationRequest.authorizationCode().authorizationUri(client.getProviderDetails().getAuthorizationUri()).clientId(client.getClientId()).redirectUri(client.getRedirectUri()).state("fixture-state").build();
        var response=OAuth2AuthorizationResponse.success("fixture-code").redirectUri(client.getRedirectUri()).state("fixture-state").build();
        return new OAuth2AuthorizationCodeGrantRequest(client,new OAuth2AuthorizationExchange(request,response));
    }
    @Test @Timeout(10) void actualTokenConversionAndOAuthErrorHandlingArePreserved() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);var requests=new AtomicInteger();
        server.createContext("/token",exchange->{assertEquals("POST",exchange.getRequestMethod());assertNotNull(exchange.getRequestHeaders().getFirst("Authorization"));var body=new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8);assertTrue(body.contains("grant_type=authorization_code"));int n=requests.incrementAndGet();byte[] data=(n==1?"{\"access_token\":\"fixture-token\",\"token_type\":\"Bearer\",\"expires_in\":300,\"scope\":\"openid\"}":"{\"error\":\"invalid_grant\"}").getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(n==1?200:400,data.length);try(var out=exchange.getResponseBody()){out.write(data);}});server.start();
        try {
            var client=OidcHttpTransport.tokens(Duration.ofSeconds(1));var request=grant(registration("http://127.0.0.1:"+server.getAddress().getPort()));
            assertEquals("fixture-token",client.getTokenResponse(request).getAccessToken().getTokenValue());
            var error=assertThrows(OAuth2AuthorizationException.class,()->client.getTokenResponse(request));assertEquals("invalid_grant",error.getError().getErrorCode());assertEquals(2,requests.get());
        } finally {server.stop(0);}
    }
    @Test @Timeout(10) void tokenAndUserInfoRedirectsNeverReachCredentialReceiver() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);var receiverRequests=new AtomicInteger();
        server.createContext("/receiver",exchange->{receiverRequests.incrementAndGet();exchange.sendResponseHeaders(200,-1);exchange.close();});
        server.createContext("/token",exchange->{exchange.getResponseHeaders().set("Location","http://127.0.0.1:"+server.getAddress().getPort()+"/receiver");exchange.sendResponseHeaders(307,-1);exchange.close();});
        server.createContext("/userinfo",exchange->{exchange.getResponseHeaders().set("Location","http://127.0.0.1:"+server.getAddress().getPort()+"/receiver");exchange.sendResponseHeaders(302,-1);exchange.close();});server.start();
        try {
            var registration=registration("http://127.0.0.1:"+server.getAddress().getPort());
            assertThrows(OAuth2AuthorizationException.class,()->OidcHttpTransport.tokens(Duration.ofSeconds(1)).getTokenResponse(grant(registration)));
            var token=new OAuth2AccessToken(OAuth2AccessToken.TokenType.BEARER,UUID.randomUUID().toString(),java.time.Instant.now(),java.time.Instant.now().plusSeconds(60));
            assertThrows(Exception.class,()->OidcHttpTransport.users(Duration.ofSeconds(1)).loadUser(new OAuth2UserRequest(registration,token)));
            assertEquals(0,receiverRequests.get());
        } finally {server.stop(0);}
    }
    @Test @Timeout(10) void stalledTokenBodyIsBoundedAfterSuccessfulResponseHeaders() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var partialBodyFlushed=new CountDownLatch(1);var releaseBody=new CountDownLatch(1);
        server.createContext("/token",exchange->{exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,0);try(var out=exchange.getResponseBody()){out.write('{');out.flush();partialBodyFlushed.countDown();try{releaseBody.await(5,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}}catch(java.io.IOException ignored){}});server.start();
        try {
            var request=grant(registration("http://127.0.0.1:"+server.getAddress().getPort()));
            var client=OidcHttpTransport.tokens(Duration.ofMillis(200));
            var error=assertThrows(OAuth2AuthorizationException.class,()->client.getTokenResponse(request));
            assertEquals(0,partialBodyFlushed.getCount(),"Server must send a partial successful body before refusal");
            Throwable cause=error;boolean socketReadTimedOut=false;
            while(cause!=null){socketReadTimedOut|=cause instanceof java.net.SocketTimeoutException;cause=cause.getCause();}
            assertTrue(socketReadTimedOut,"Refusal must come from the configured socket read timeout, not malformed EOF or unrelated setup time");
            assertEquals(1,releaseBody.getCount(),"Server body remains deliberately stalled when the client times out");
        } finally {releaseBody.countDown();server.stop(0);}
    }
    @Test void unlimitedOrExcessiveReadTimeoutIsRefused() {
        for(var timeout:new Duration[]{Duration.ZERO,Duration.ofNanos(1),Duration.ofSeconds(-1),Duration.ofSeconds(11)})assertThrows(IllegalArgumentException.class,()->OidcHttpTransport.factory(timeout));
    }
}
