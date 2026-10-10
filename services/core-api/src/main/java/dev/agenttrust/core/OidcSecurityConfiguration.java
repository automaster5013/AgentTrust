package dev.agenttrust.core;

import java.nio.file.Files;
import java.nio.file.Path;
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
    static final String PUBLIC_ISSUER="http://127.0.0.1:4322/realms/agenttrust",INTERNAL_ISSUER="http://stack-identity:8080/realms/agenttrust";
    @Bean ClientRegistrationRepository registrations() throws Exception {
        var secret=Files.readString(Path.of("/run/secrets/stack-oidc-client-secret"));if(!secret.matches("[a-f0-9]{64}"))throw new IllegalStateException("OIDC configuration unavailable");
        return new InMemoryClientRegistrationRepository(ClientRegistration.withRegistrationId("keycloak").clientId("agenttrust-console").clientSecret(secret).clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC).authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE).redirectUri("http://127.0.0.1:4320/backend/login/oauth2/code/keycloak").scope("openid","profile","email").authorizationUri(PUBLIC_ISSUER+"/protocol/openid-connect/auth").tokenUri(INTERNAL_ISSUER+"/protocol/openid-connect/token").jwkSetUri(INTERNAL_ISSUER+"/protocol/openid-connect/certs").userInfoUri(INTERNAL_ISSUER+"/protocol/openid-connect/userinfo").userNameAttributeName("sub").issuerUri(PUBLIC_ISSUER).clientName("AgentTrust Keycloak").build());
    }
    @Bean OidcSessionRegistry oidcSessions(){return new InMemoryOidcSessionRegistry();}
    @Bean HttpSessionEventPublisher sessionEvents(){return new HttpSessionEventPublisher();}
    @Bean OidcBackChannelLogoutHandler backChannelHandler(OidcSessionRegistry sessions){var handler=new OidcBackChannelLogoutHandler(sessions);handler.setSessionCookieName("AGENTTRUST_STACK_SESSION");handler.setLogoutUri("http://127.0.0.1:8080/logout/connect/back-channel/{registrationId}");return handler;}
    @Bean SecurityFilterChain oidcSecurity(HttpSecurity http,ClientRegistrationRepository registrations,OidcSessionRegistry sessions,OidcBackChannelLogoutHandler handler) throws Exception {
        var resolver=new DefaultOAuth2AuthorizationRequestResolver(registrations,"/oauth2/authorization");resolver.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());
        var delegate=new OidcUserService();
        http.authorizeHttpRequests(auth->auth.requestMatchers("/actuator/health","/api/csrf","/api/auth-info","/oauth2/authorization/keycloak","/login/oauth2/code/keycloak","/internal/completions","/internal/provider-reservations").permitAll().anyRequest().authenticated());
        http.csrf(csrf->csrf.ignoringRequestMatchers("/internal/completions","/internal/provider-reservations"));http.requestCache(cache->cache.disable());
        http.oidcLogout(oidc->oidc.oidcSessionRegistry(sessions).backChannel(channel->channel.logoutHandler(handler)));
        http.oauth2Login(login->login.authorizationEndpoint(endpoint->endpoint.authorizationRequestResolver(resolver)).userInfoEndpoint(endpoint->endpoint.oidcUserService(request->{try{return new OidcWorkspaceUser(delegate.loadUser(request));}catch(IllegalArgumentException error){throw new OAuth2AuthenticationException(new OAuth2Error("invalid_workspace_identity"));}})).successHandler((req,res,auth)->res.sendRedirect("http://127.0.0.1:4320/")).failureHandler((req,res,error)->{res.setStatus(401);res.setContentType("application/json");res.getWriter().write("{\"code\":\"OIDC_AUTHENTICATION_FAILED\"}");}));
        http.logout(logout->logout.logoutUrl("/api/logout").logoutSuccessHandler((req,res,auth)->{res.setContentType("application/json");res.getWriter().write("{\"authenticated\":false,\"logoutUrl\":\"http://127.0.0.1:4322/realms/agenttrust/protocol/openid-connect/logout?client_id=agenttrust-console&post_logout_redirect_uri=http%3A%2F%2F127.0.0.1%3A4320%2F\"}");}));
        http.exceptionHandling(errors->errors.authenticationEntryPoint((req,res,error)->{res.setStatus(401);res.setContentType("application/json");res.getWriter().write("{\"code\":\"AUTHENTICATION_REQUIRED\"}");}).accessDeniedHandler((req,res,error)->{res.setStatus(403);res.setContentType("application/json");res.getWriter().write("{\"code\":\"REQUEST_REFUSED\"}");}));
        http.sessionManagement(session->session.sessionFixation(fixation->fixation.migrateSession()));return http.build();
    }
}
