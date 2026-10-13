package dev.agenttrust.core;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestCustomizers;

class OidcEndpointPolicyTest {
    @Test void realAuthorizationResolverPinsCallbackAndPkceDespiteHostAndForwardedHeaders() {
        var endpoints=OidcEndpointPolicy.configure("https-review","https://console.example.com","https://identity.example.com/realms/agenttrust",true);
        String syntheticSecret=java.util.UUID.randomUUID().toString()+java.util.UUID.randomUUID();
        var registration=OidcSecurityConfiguration.registration(syntheticSecret,endpoints);
        assertEquals(endpoints.publicIssuer()+"/protocol/openid-connect/token",registration.getProviderDetails().getTokenUri());
        assertEquals(endpoints.publicIssuer(),registration.getProviderDetails().getIssuerUri());
        var resolver=new DefaultOAuth2AuthorizationRequestResolver(new InMemoryClientRegistrationRepository(registration),"/oauth2/authorization");
        resolver.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());
        var request=new MockHttpServletRequest("GET","/oauth2/authorization/keycloak");
        request.addHeader("Host","evil.example.com");request.addHeader("X-Forwarded-Host","evil.example.com");request.addHeader("X-Forwarded-Proto","http");
        var result=resolver.resolve(request);assertNotNull(result);assertEquals(endpoints.callback(),result.getRedirectUri());
        assertEquals("S256",result.getAdditionalParameters().get("code_challenge_method"));
        assertTrue(result.getAdditionalParameters().get("code_challenge").toString().matches("[A-Za-z0-9_-]{43}"));
        assertNotNull(result.getState());assertTrue(result.getAuthorizationRequestUri().startsWith(endpoints.publicIssuer()+"/protocol/openid-connect/auth?"));
    }
    @Test void springConfigurationUsesExplicitPropertiesAndDefaultsToLocalReview() {
        var configuration=new OidcSecurityConfiguration();
        var local=configuration.oidcEndpoints(new MockEnvironment());
        assertEquals(OidcEndpointPolicy.LOCAL_ORIGIN,local.applicationOrigin());
        var environment=new MockEnvironment().withProperty("agenttrust.oidc.profile","https-review")
            .withProperty("agenttrust.oidc.application-origin","https://console.example.com")
            .withProperty("agenttrust.oidc.public-issuer","https://identity.example.com/realms/agenttrust");
        assertThrows(IllegalArgumentException.class,()->configuration.oidcEndpoints(environment));
        environment.setProperty("server.servlet.session.cookie.secure","true");
        assertThrows(IllegalArgumentException.class,()->configuration.oidcEndpoints(environment));
        environment.setProperty("server.servlet.session.cookie.same-site","lax");
        assertEquals("https://console.example.com/",configuration.oidcEndpoints(environment).home());
    }
    @Test void httpsCookieScopeRefusesDomainNarrowPathAndScriptReadableSessions() {
        var configuration=new OidcSecurityConfiguration();
        var environment=new MockEnvironment().withProperty("agenttrust.oidc.profile","https-review")
            .withProperty("agenttrust.oidc.application-origin","https://console.example.com")
            .withProperty("agenttrust.oidc.public-issuer","https://identity.example.com/realms/agenttrust")
            .withProperty("server.servlet.session.cookie.secure","true")
            .withProperty("server.servlet.session.cookie.same-site","lax");
        assertEquals("https://console.example.com/",configuration.oidcEndpoints(environment).home());
        environment.setProperty("server.servlet.session.cookie.domain","example.com");
        assertThrows(IllegalArgumentException.class,()->configuration.oidcEndpoints(environment));
        environment.setProperty("server.servlet.session.cookie.domain","");
        environment.setProperty("server.servlet.session.cookie.path","/backend");
        assertThrows(IllegalArgumentException.class,()->configuration.oidcEndpoints(environment));
        environment.setProperty("server.servlet.session.cookie.path","/");
        environment.setProperty("server.servlet.session.cookie.http-only","false");
        assertThrows(IllegalArgumentException.class,()->configuration.oidcEndpoints(environment));
        environment.setProperty("server.servlet.session.cookie.http-only","true");
        assertEquals("https://console.example.com/",configuration.oidcEndpoints(environment).home());
    }
    @Test void localReviewPreservesExactExistingEndpoints() {
        var p=OidcEndpointPolicy.configure("local-review",OidcEndpointPolicy.LOCAL_ORIGIN,OidcEndpointPolicy.LOCAL_ISSUER,false);
        assertEquals("http://127.0.0.1:4320/backend/login/oauth2/code/keycloak",p.callback());
        assertEquals(OidcEndpointPolicy.LOCAL_TRANSPORT,p.transportIssuer());
        assertTrue(p.logout().endsWith("http%3A%2F%2F127.0.0.1%3A4320%2F"));
        assertThrows(IllegalArgumentException.class,()->OidcEndpointPolicy.configure("local-review","http://localhost:4320",p.publicIssuer(),false));
    }
    @Test void httpsReviewPinsOperatorEndpointsAndRequiresSecureCookies() {
        var p=OidcEndpointPolicy.configure("https-review","https://console.example.com","https://identity.example.com/realms/agenttrust",true);
        assertEquals(p.publicIssuer(),p.transportIssuer());assertEquals("https://console.example.com/",p.home());
        assertEquals("https://console.example.com/backend/login/oauth2/code/keycloak",p.callback());
        assertThrows(IllegalArgumentException.class,()->OidcEndpointPolicy.configure("https-review",p.applicationOrigin(),p.publicIssuer(),false));
        assertThrows(IllegalArgumentException.class,()->OidcEndpointPolicy.configure("production",p.applicationOrigin(),p.publicIssuer(),true));
    }
    @Test void refusesRedirectAmbiguityAndNonCanonicalEndpointsWithoutEchoingInput() {
        for(String origin:new String[]{"http://console.example.com","https://console.example.com/","https://console.example.com:443","https://user@console.example.com","https://console.example.com?x=1","https://console.example.com#x","https://127.0.0.1","https://[::1]","https://console.local","https://console.internal","https://console.localhost","https://*.example.com","https://CONSOLE.example.com","https://console.example.com\\evil","https://console.example.com\n","https://console.example.com/%2f","https://console%2eexample.com"}) {
            var e=assertThrows(IllegalArgumentException.class,()->OidcEndpointPolicy.configure("https-review",origin,"https://identity.example.com/realms/agenttrust",true));
            assertEquals("OIDC endpoint configuration unavailable",e.getMessage());
        }
        for(String issuer:new String[]{"https://identity.example.com","https://identity.example.com/realms/other","https://identity.example.com/realms/agenttrust/","https://identity.example.com/realms/%61genttrust"})
            assertThrows(IllegalArgumentException.class,()->OidcEndpointPolicy.configure("https-review","https://console.example.com",issuer,true));
    }
}
