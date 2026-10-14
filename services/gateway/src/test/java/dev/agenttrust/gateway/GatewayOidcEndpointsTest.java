package dev.agenttrust.gateway;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class GatewayOidcEndpointsTest {
 @Test void configuredHttpsIssuerAndCallbackAreAcceptedWithoutAllowingOtherOriginsOrPaths(){
  var endpoints=GatewayOidcEndpoints.configure("https-review","https://app.agenttrust.test","https://identity.agenttrust.test/realms/agenttrust");
  assertTrue(endpoints.acceptsRedirect("/oauth2/authorization/keycloak","https://identity.agenttrust.test/realms/agenttrust/protocol/openid-connect/auth?client_id=agenttrust-console"));
  assertTrue(endpoints.acceptsRedirect("/login/oauth2/code/keycloak","https://app.agenttrust.test/"));
  for(String location:java.util.List.of("http://identity.agenttrust.test/realms/agenttrust/protocol/openid-connect/auth","https://identity.agenttrust.test.evil/realms/agenttrust/protocol/openid-connect/auth","https://identity.agenttrust.test/realms/other/protocol/openid-connect/auth","https://identity.agenttrust.test/realms/agenttrust/protocol/openid-connect/auth#fragment","https://user@identity.agenttrust.test/realms/agenttrust/protocol/openid-connect/auth","http://127.0.0.1:4322/realms/agenttrust/protocol/openid-connect/auth"))assertFalse(endpoints.acceptsRedirect("/oauth2/authorization/keycloak",location));
  assertFalse(endpoints.acceptsRedirect("/login/oauth2/code/keycloak","https://app.agenttrust.test/?next=other"));
 }
 @Test void invalidProfilesOrNoncanonicalPublicEndpointsFailAtConfiguration(){
  for(String origin:java.util.List.of("http://app.agenttrust.test","https://127.0.0.1","https://app.agenttrust.test:443","https://app.agenttrust.test/","https://app.agenttrust.test?secret=refused","https://user:password@app.agenttrust.test","https://app.local","https://app.internal"))assertThrows(IllegalArgumentException.class,()->GatewayOidcEndpoints.configure("https-review",origin,"https://identity.agenttrust.test/realms/agenttrust"));
  assertThrows(IllegalArgumentException.class,()->GatewayOidcEndpoints.configure("local-review","https://app.agenttrust.test","https://identity.agenttrust.test/realms/agenttrust"));
  assertThrows(IllegalArgumentException.class,()->GatewayOidcEndpoints.configure("production","https://app.agenttrust.test","https://identity.agenttrust.test/realms/agenttrust"));
  assertThrows(IllegalArgumentException.class,()->GatewayOidcEndpoints.configure("https-review","https://app.agenttrust.test","https://identity.agenttrust.test/realms/other"));
 }
 @Test void existingLoopbackRedirectContractRemainsUnchanged(){
  var local=GatewayOidcEndpoints.local();assertTrue(local.acceptsRedirect("/oauth2/authorization/keycloak","http://127.0.0.1:4322/realms/agenttrust/protocol/openid-connect/auth"));assertTrue(local.acceptsRedirect("/login/oauth2/code/keycloak","http://127.0.0.1:4320/"));assertFalse(local.acceptsRedirect("/api/runs","http://127.0.0.1:4320/"));assertFalse(local.acceptsRedirect("/login/oauth2/code/keycloak","http://127.0.0.1:4320/other"));
 }
}
