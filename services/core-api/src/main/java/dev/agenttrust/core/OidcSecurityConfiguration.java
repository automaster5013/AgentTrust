package dev.agenttrust.core;

import java.nio.file.Files;
import java.time.Duration;
import org.springframework.security.oauth2.client.endpoint.RestClientAuthorizationCodeTokenResponseClient;
import java.nio.file.Path;
import org.springframework.core.env.Environment;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserService;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestCustomizers;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.config.annotation.web.configurers.oauth2.client.OidcBackChannelLogoutHandler;
import org.springframework.security.oauth2.client.oidc.session.OidcSessionRegistry;
import org.springframework.security.oauth2.client.oidc.session.InMemoryOidcSessionRegistry;
import org.springframework.security.web.session.HttpSessionEventPublisher;

@Configuration
@ConditionalOnProperty(name="agenttrust.identity-mode",havingValue="keycloak")
public class OidcSecurityConfiguration {
    @Bean OidcEndpointPolicy oidcEndpoints(Environment environment) {
        if ("https-review".equals(environment.getProperty("agenttrust.oidc.profile"))) {
            if (!"lax".equals(environment.getProperty("server.servlet.session.cookie.same-site"))
                || !"/".equals(environment.getProperty("server.servlet.session.cookie.path","/"))
                || !environment.getProperty("server.servlet.session.cookie.domain","").isEmpty()
                || !environment.getProperty("server.servlet.session.cookie.http-only",Boolean.class,true))
                throw new IllegalArgumentException("OIDC endpoint configuration unavailable");
        }
        return OidcEndpointPolicy.configure(environment.getProperty("agenttrust.oidc.profile","local-review"),
            environment.getProperty("agenttrust.oidc.application-origin",OidcEndpointPolicy.LOCAL_ORIGIN),
            environment.getProperty("agenttrust.oidc.public-issuer",OidcEndpointPolicy.LOCAL_ISSUER),
            environment.getProperty("server.servlet.session.cookie.secure",Boolean.class,false));
    }
    @Bean ClientRegistrationRepository registrations(OidcEndpointPolicy endpoints) throws Exception {
        var secret=Files.readString(Path.of("/run/secrets/stack-oidc-client-secret"));if(!secret.matches("[a-f0-9]{64}"))throw new IllegalStateException("OIDC configuration unavailable");
        return new InMemoryClientRegistrationRepository(registration(secret,endpoints));
    }
    static ClientRegistration registration(String secret,OidcEndpointPolicy endpoints) {
        return ClientRegistration.withRegistrationId("keycloak").clientId("agenttrust-console").clientSecret(secret).clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC).authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE).redirectUri(endpoints.callback()).scope("openid","profile","email").authorizationUri(endpoints.publicIssuer()+"/protocol/openid-connect/auth").tokenUri(endpoints.transportIssuer()+"/protocol/openid-connect/token").jwkSetUri(endpoints.transportIssuer()+"/protocol/openid-connect/certs").userInfoUri(endpoints.transportIssuer()+"/protocol/openid-connect/userinfo").userNameAttributeName("sub").issuerUri(endpoints.publicIssuer()).clientName("AgentTrust Keycloak").build();
    }
    @Bean RestClientAuthorizationCodeTokenResponseClient oidcTokens(){return OidcHttpTransport.tokens(Duration.ofSeconds(10));}
    @Bean org.springframework.security.oauth2.jwt.JwtDecoderFactory<ClientRegistration> oidcSigningKeys(){
        return registration -> OidcSigningKeys.decoder(registration,Duration.ofSeconds(10));
    }
    @Bean OidcSessionRegistry oidcSessions(){return new InMemoryOidcSessionRegistry();}
    @Bean HttpSessionEventPublisher sessionEvents(){return new HttpSessionEventPublisher();}
    @Bean OidcBackChannelLogoutHandler backChannelHandler(OidcSessionRegistry sessions){var handler=new OidcBackChannelLogoutHandler(sessions);handler.setSessionCookieName("AGENTTRUST_STACK_SESSION");handler.setLogoutUri("http://127.0.0.1:8080/logout/connect/back-channel/{registrationId}");return handler;}
    @Bean SecurityFilterChain oidcSecurity(HttpSecurity http,ClientRegistrationRepository registrations,OidcSessionRegistry sessions,OidcBackChannelLogoutHandler handler,OidcEndpointPolicy endpoints,RestClientAuthorizationCodeTokenResponseClient oidcTokens) throws Exception {
        var resolver=new DefaultOAuth2AuthorizationRequestResolver(registrations,"/oauth2/authorization");resolver.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());
        var delegate=new OidcUserService();delegate.setOauth2UserService(OidcHttpTransport.users(Duration.ofSeconds(10)));
        http.authorizeHttpRequests(auth->auth.requestMatchers("/actuator/health","/api/csrf","/api/auth-info","/oauth2/authorization/keycloak","/login/oauth2/code/keycloak","/internal/completions","/internal/provider-reservations").permitAll().anyRequest().authenticated());
        http.csrf(csrf->csrf.ignoringRequestMatchers("/internal/completions","/internal/provider-reservations"));http.requestCache(cache->cache.disable());
        http.oidcLogout(oidc->oidc.oidcSessionRegistry(sessions).backChannel(channel->channel.logoutHandler(handler)));
        http.oauth2Login(login->login.tokenEndpoint(endpoint->endpoint.accessTokenResponseClient(oidcTokens)).authorizationEndpoint(endpoint->endpoint.authorizationRequestResolver(resolver)).userInfoEndpoint(endpoint->endpoint.oidcUserService(request->{try{return new OidcWorkspaceUser(delegate.loadUser(request));}catch(IllegalArgumentException error){throw new OAuth2AuthenticationException(new OAuth2Error("invalid_workspace_identity"));}})).successHandler((req,res,auth)->res.sendRedirect(endpoints.home())).failureHandler((req,res,error)->{OidcFailureDiagnostics.record(error);res.setStatus(401);res.setContentType("application/json");res.getWriter().write("{\"code\":\"OIDC_AUTHENTICATION_FAILED\"}");}));
        http.logout(logout->logout.logoutUrl("/api/logout").logoutSuccessHandler((req,res,auth)->{res.setContentType("application/json");res.getWriter().write("{\"authenticated\":false,\"logoutUrl\":\""+endpoints.logout()+"\"}");}));
        http.exceptionHandling(errors->errors.authenticationEntryPoint((req,res,error)->{res.setStatus(401);res.setContentType("application/json");res.getWriter().write("{\"code\":\"AUTHENTICATION_REQUIRED\"}");}).accessDeniedHandler((req,res,error)->{res.setStatus(403);res.setContentType("application/json");res.getWriter().write("{\"code\":\"REQUEST_REFUSED\"}");}));
        http.sessionManagement(session->session.sessionFixation(fixation->fixation.migrateSession()));return http.build();
    }
}
