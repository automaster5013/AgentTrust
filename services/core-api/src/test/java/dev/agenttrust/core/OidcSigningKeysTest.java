package dev.agenttrust.core;

import static org.junit.jupiter.api.Assertions.*;
import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.*;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.jwt.JwtException;

class OidcSigningKeysTest {
    private static ClientRegistration registration(String base) {
        return ClientRegistration.withRegistrationId("fixture").clientId("fixture-client")
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE).redirectUri(base+"/callback")
            .authorizationUri(base+"/authorize").tokenUri(base+"/token").jwkSetUri(base+"/keys")
            .issuerUri(base).scope("openid").build();
    }
    private static String token(RSAKey key,String issuer,String audience,Instant expiry) throws Exception {
        return token(key,issuer,audience,expiry,"fixture-nonce");
    }
    private static String token(RSAKey key,String issuer,String audience,Instant expiry,String nonce) throws Exception {
        var claims=new JWTClaimsSet.Builder().issuer(issuer).subject("fixture-user").audience(audience)
            .issueTime(Date.from(Instant.now())).expirationTime(Date.from(expiry)).claim("nonce",nonce).build();
        var jwt=new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.getKeyID()).build(),claims);
        jwt.sign(new RSASSASigner(key));return jwt.serialize();
    }
    @Test @Timeout(15) void realSignatureIssuerAudienceAndExpiryValidationArePreserved() throws Exception {
        var key=new RSAKeyGenerator(2048).keyID("fixture").generate();
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/keys",exchange->{byte[] body=new JWKSet(key.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,body.length);try(var out=exchange.getResponseBody()){out.write(body);}});server.start();
        try {
            var base="http://127.0.0.1:"+server.getAddress().getPort();var decoder=OidcSigningKeys.decoder(registration(base),Duration.ofSeconds(1));var expiry=Instant.now().plusSeconds(300);
            assertEquals("fixture-user",decoder.decode(token(key,base,"fixture-client",expiry)).getSubject());
            assertThrows(JwtException.class,()->decoder.decode(token(key,base+"/wrong","fixture-client",expiry)));
            assertThrows(JwtException.class,()->decoder.decode(token(key,base,"wrong-client",expiry)));
            assertThrows(JwtException.class,()->decoder.decode(token(key,base,"fixture-client",Instant.now().minusSeconds(120))));
            var other=new RSAKeyGenerator(2048).keyID("fixture").generate();
            assertThrows(JwtException.class,()->decoder.decode(token(other,base,"fixture-client",expiry)));
        } finally {server.stop(0);}
    }
    @Test @Timeout(15) void authenticationProviderRejectsMissingAndWrongNonceBeforeUserInfo() throws Exception {
        var key=new RSAKeyGenerator(2048).keyID("fixture").generate();var userInfoCalls=new AtomicInteger();
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/keys",exchange->{byte[] body=new JWKSet(key.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);exchange.sendResponseHeaders(200,body.length);try(var out=exchange.getResponseBody()){out.write(body);}});server.start();
        try {
            var base="http://127.0.0.1:"+server.getAddress().getPort();var client=registration(base);var rawNonce="fixture-request-nonce";
            var hash=Base64.getUrlEncoder().withoutPadding().encodeToString(java.security.MessageDigest.getInstance("SHA-256").digest(rawNonce.getBytes(StandardCharsets.US_ASCII)));
            for(String nonce: new String[]{null,"wrong-nonce",hash}) {
                var signed=token(key,base,"fixture-client",Instant.now().plusSeconds(300),nonce);
                var provider=new org.springframework.security.oauth2.client.oidc.authentication.OidcAuthorizationCodeAuthenticationProvider(
                    request->org.springframework.security.oauth2.core.endpoint.OAuth2AccessTokenResponse.withToken("fixture-access").tokenType(org.springframework.security.oauth2.core.OAuth2AccessToken.TokenType.BEARER).additionalParameters(Map.of("id_token",signed)).build(),
                    request->{userInfoCalls.incrementAndGet();return new org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser(List.of(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_USER")),request.getIdToken());});
                provider.setJwtDecoderFactory(registration->OidcSigningKeys.decoder(registration,Duration.ofSeconds(1)));
                var request=org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest.authorizationCode().authorizationUri(base+"/authorize").clientId(client.getClientId()).redirectUri(client.getRedirectUri()).scope("openid").state("fixture-state").attributes(attrs->attrs.put("nonce",rawNonce)).build();
                var response=org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationResponse.success("fixture-code").redirectUri(client.getRedirectUri()).state("fixture-state").build();
                var login=new org.springframework.security.oauth2.client.authentication.OAuth2LoginAuthenticationToken(client,new org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationExchange(request,response));
                if(hash.equals(nonce))assertTrue(provider.authenticate(login).isAuthenticated());
                else {var error=assertThrows(org.springframework.security.oauth2.core.OAuth2AuthenticationException.class,()->provider.authenticate(login));assertEquals("invalid_nonce",error.getError().getErrorCode());assertEquals(0,userInfoCalls.get());}
            }
            assertEquals(1,userInfoCalls.get());
        } finally {server.stop(0);}
    }
    @Test @Timeout(15) void keyRedirectIsRefusedWithoutContactingReceiver() throws Exception {
        var key=new RSAKeyGenerator(2048).keyID("fixture").generate();var receiver=new AtomicInteger();
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/keys",exchange->{exchange.getResponseHeaders().set("Location","/receiver");exchange.sendResponseHeaders(302,-1);exchange.close();});
        server.createContext("/receiver",exchange->{receiver.incrementAndGet();exchange.sendResponseHeaders(200,-1);exchange.close();});server.start();
        try {var base="http://127.0.0.1:"+server.getAddress().getPort();var decoder=OidcSigningKeys.decoder(registration(base),Duration.ofSeconds(1));assertThrows(JwtException.class,()->decoder.decode(token(key,base,"fixture-client",Instant.now().plusSeconds(300))));assertEquals(0,receiver.get());}
        finally {server.stop(0);}
    }
    @Test @Timeout(15) void stalledKeyBodyIsBoundedAfterSuccessfulHeaders() throws Exception {
        var key=new RSAKeyGenerator(2048).keyID("fixture").generate();
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/keys",exchange->{exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,0);try(var out=exchange.getResponseBody()){out.write('{');out.flush();try{Thread.sleep(2000);}catch(InterruptedException e){Thread.currentThread().interrupt();}}catch(java.io.IOException ignored){}});server.start();
        try {
            var base="http://127.0.0.1:"+server.getAddress().getPort();
            var decoder=OidcSigningKeys.decoder(registration(base),Duration.ofMillis(200));
            var signed=token(key,base,"fixture-client",Instant.now().plusSeconds(300));long started=System.nanoTime();
            assertThrows(JwtException.class,()->decoder.decode(signed));
            assertTrue(Duration.ofNanos(System.nanoTime()-started).compareTo(Duration.ofMillis(1500))<0);
        } finally {server.stop(0);}
    }
}
