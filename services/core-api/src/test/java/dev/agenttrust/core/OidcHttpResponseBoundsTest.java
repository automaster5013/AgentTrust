package dev.agenttrust.core;

import static org.junit.jupiter.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.security.oauth2.client.endpoint.OAuth2AuthorizationCodeGrantRequest;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.core.endpoint.*;

class OidcHttpResponseBoundsTest {
    private static OAuth2AuthorizationCodeGrantRequest request(int port) {
        String base="http://127.0.0.1:"+port;
        var client=ClientRegistration.withRegistrationId("fixture").clientId("fixture-client")
            .clientSecret("fixture-only-secret").clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE).redirectUri(base+"/callback")
            .scope("openid").authorizationUri(base+"/authorize").tokenUri(base+"/token")
            .userInfoUri(base+"/userinfo").userNameAttributeName("sub").build();
        var authorization=OAuth2AuthorizationRequest.authorizationCode().authorizationUri(base+"/authorize")
            .clientId(client.getClientId()).redirectUri(client.getRedirectUri()).state("fixture-state").build();
        var response=OAuth2AuthorizationResponse.success("fixture-code").redirectUri(client.getRedirectUri()).state("fixture-state").build();
        return new OAuth2AuthorizationCodeGrantRequest(client,new OAuth2AuthorizationExchange(authorization,response));
    }
    @Test @Timeout(10) void continuouslyTrickledTokenBodyCannotExtendTheWholeCallDeadline() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var partialBodyFlushed=new CountDownLatch(1);var chunks=new AtomicInteger();
        server.createContext("/token",exchange->{
            exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,0);
            try(var output=exchange.getResponseBody()){
                output.write("{\"access_token\":\"fixture-token\",\"token_type\":\"Bearer\"".getBytes(StandardCharsets.UTF_8));
                output.flush();partialBodyFlushed.countDown();
                for(int index=0;index<100;index++){
                    output.write(' ');output.flush();chunks.incrementAndGet();
                    try{Thread.sleep(25);}catch(InterruptedException error){Thread.currentThread().interrupt();break;}
                }
                output.write('}');
            }catch(java.io.IOException ignored){}
        });server.start();
        try{
            var client=OidcHttpTransport.tokens(Duration.ofSeconds(1));var grant=request(server.getAddress().getPort());
            var error=assertThrows(OAuth2AuthorizationException.class,()->client.getTokenResponse(grant));
            assertEquals(0,partialBodyFlushed.getCount());assertTrue(chunks.get()>1);
            boolean totalDeadline=false;
            for(Throwable cause=error;cause!=null;cause=cause.getCause())totalDeadline|=cause.getClass()==java.io.InterruptedIOException.class;
            assertTrue(totalDeadline,"A continuously progressing response must hit the total call deadline");
        }finally{server.stop(0);}
    }
    @Test @Timeout(10) void oversizedOtherwiseValidTokenResponseIsRefusedBeforeConversion() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        byte[] body=("{\"access_token\":\""+"a".repeat(65536)+"\",\"token_type\":\"Bearer\"}").getBytes(StandardCharsets.UTF_8);
        server.createContext("/token",exchange->{exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,body.length);try(var output=exchange.getResponseBody()){output.write(body);}catch(java.io.IOException ignored){}});server.start();
        try{
            var client=OidcHttpTransport.tokens(Duration.ofSeconds(1));var grant=request(server.getAddress().getPort());
            var error=assertThrows(OAuth2AuthorizationException.class,()->client.getTokenResponse(grant));
            assertTrue(hasCauseMessage(error,"OIDC response body limit"));
        }finally{server.stop(0);}
    }
    @Test @Timeout(10) void exactResponseByteLimitRemainsUsableForOtherwiseValidToken() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        String prefix="{\"access_token\":\"fixture-token\",\"token_type\":\"Bearer\",\"padding\":\"";String suffix="\"}";
        byte[] body=(prefix+"a".repeat(65536-prefix.length()-suffix.length())+suffix).getBytes(StandardCharsets.UTF_8);
        assertEquals(65536,body.length);
        server.createContext("/token",exchange->{exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,0);try(var output=exchange.getResponseBody()){output.write(body);}catch(java.io.IOException ignored){}});server.start();
        try{
            var client=OidcHttpTransport.tokens(Duration.ofSeconds(1));var grant=request(server.getAddress().getPort());
            assertEquals("fixture-token",client.getTokenResponse(grant).getAccessToken().getTokenValue());
        }finally{server.stop(0);}
    }
    @Test @Timeout(10) void compressedResponseLimitAppliesToExpandedBytes() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        byte[] expanded=("{\"access_token\":\""+"a".repeat(65536)+"\",\"token_type\":\"Bearer\"}").getBytes(StandardCharsets.UTF_8);
        var compressed=new java.io.ByteArrayOutputStream();try(var gzip=new java.util.zip.GZIPOutputStream(compressed)){gzip.write(expanded);}byte[] body=compressed.toByteArray();assertTrue(body.length<1024);
        server.createContext("/token",exchange->{exchange.getResponseHeaders().set("Content-Type","application/json");exchange.getResponseHeaders().set("Content-Encoding","gzip");exchange.sendResponseHeaders(200,body.length);try(var output=exchange.getResponseBody()){output.write(body);}catch(java.io.IOException ignored){}});server.start();
        try{
            var client=OidcHttpTransport.tokens(Duration.ofSeconds(1));var grant=request(server.getAddress().getPort());
            var error=assertThrows(OAuth2AuthorizationException.class,()->client.getTokenResponse(grant));
            assertTrue(hasCauseMessage(error,"OIDC response body limit"));
        }finally{server.stop(0);}
    }
    @Test @Timeout(10) void authorizationCodeAboveRequestLimitNeverReachesProvider() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);var requests=new AtomicInteger();
        server.createContext("/token",exchange->{requests.incrementAndGet();exchange.sendResponseHeaders(500,-1);exchange.close();});server.start();
        try{
            var original=request(server.getAddress().getPort());var response=OAuth2AuthorizationResponse.success("a".repeat(32768))
                .redirectUri(original.getClientRegistration().getRedirectUri()).state("fixture-state").build();
            var grant=new OAuth2AuthorizationCodeGrantRequest(original.getClientRegistration(),new OAuth2AuthorizationExchange(original.getAuthorizationExchange().getAuthorizationRequest(),response));
            var client=OidcHttpTransport.tokens(Duration.ofSeconds(1));
            var error=assertThrows(OAuth2AuthorizationException.class,()->client.getTokenResponse(grant));
            assertTrue(hasCauseMessage(error,"OIDC request body limit"));assertEquals(0,requests.get());
        }finally{server.stop(0);}
    }
    @Test @Timeout(10) void unavailableProviderDoesNotReplayOneTimeAuthorizationCode() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);var requests=new AtomicInteger();
        server.createContext("/token",exchange->{requests.incrementAndGet();byte[] body="{\"error\":\"temporarily_unavailable\"}".getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.getResponseHeaders().set("Retry-After","0");exchange.sendResponseHeaders(503,body.length);try(var output=exchange.getResponseBody()){output.write(body);}});server.start();
        try{
            var client=OidcHttpTransport.tokens(Duration.ofSeconds(1));var grant=request(server.getAddress().getPort());
            assertThrows(OAuth2AuthorizationException.class,()->client.getTokenResponse(grant));assertEquals(1,requests.get());
        }finally{server.stop(0);}
    }
    @Test @Timeout(10) void userInfoSharesTheSameResponseLimit() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        byte[] body=("{\"sub\":\"fixture-user\",\"name\":\""+"a".repeat(65536)+"\"}").getBytes(StandardCharsets.UTF_8);
        server.createContext("/userinfo",exchange->{exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,body.length);try(var output=exchange.getResponseBody()){output.write(body);}catch(java.io.IOException ignored){}});server.start();
        try{
            var registration=request(server.getAddress().getPort()).getClientRegistration();
            var token=new OAuth2AccessToken(OAuth2AccessToken.TokenType.BEARER,"fixture-token",java.time.Instant.now(),java.time.Instant.now().plusSeconds(60));
            var userRequest=new org.springframework.security.oauth2.client.userinfo.OAuth2UserRequest(registration,token);
            var error=assertThrows(OAuth2AuthenticationException.class,()->OidcHttpTransport.users(Duration.ofSeconds(1)).loadUser(userRequest));
            assertTrue(hasCauseMessage(error,"OIDC response body limit"));
        }finally{server.stop(0);}
    }
    private static boolean hasCauseMessage(Throwable error,String expected){
        for(Throwable cause=error;cause!=null;cause=cause.getCause())if(expected.equals(cause.getMessage()))return true;
        return false;
    }
    @Test @Timeout(10) void userInfoStatusFollowupCannotTransmitASecondBearerRequest() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);var requests=new AtomicInteger();
        server.createContext("/userinfo",exchange->{requests.incrementAndGet();byte[] body="{\"error\":\"temporarily_unavailable\"}".getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.getResponseHeaders().set("Retry-After","0");exchange.sendResponseHeaders(503,body.length);try(var output=exchange.getResponseBody()){output.write(body);}});server.start();
        try{
            var registration=request(server.getAddress().getPort()).getClientRegistration();
            var token=new OAuth2AccessToken(OAuth2AccessToken.TokenType.BEARER,"fixture-token",java.time.Instant.now(),java.time.Instant.now().plusSeconds(60));
            var userRequest=new org.springframework.security.oauth2.client.userinfo.OAuth2UserRequest(registration,token);
            var error=assertThrows(OAuth2AuthenticationException.class,()->OidcHttpTransport.users(Duration.ofSeconds(1)).loadUser(userRequest));
            assertTrue(hasCauseMessage(error,"OIDC request replay refused"));assertEquals(1,requests.get());
        }finally{server.stop(0);}
    }
}
