package dev.agenttrust.gateway;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
class RoutePolicyTest {
 @Test void internalAndArbitraryRoutesNeverProxy(){assertTrue(RoutePolicy.allowed("/api/runs",HttpMethod.POST));assertFalse(RoutePolicy.allowed("/internal/completions",HttpMethod.POST));assertFalse(RoutePolicy.allowed("/api/../actuator",HttpMethod.GET));assertFalse(RoutePolicy.allowed("/api/runs",HttpMethod.DELETE));assertFalse(RoutePolicy.allowed("/api/%72uns",HttpMethod.GET));}
 @Test void scopeComesFromCanonicalIdentityAndOnlyItsSessionIsForwarded(){String org="11111111-1111-4111-8111-111111111111";assertEquals(org+":"+org,RoutePolicy.quotaScope(Map.of("organizationId",org,"projectId",org)));assertThrows(IllegalArgumentException.class,()->RoutePolicy.quotaScope(Map.of("organizationId","attacker","projectId",org)));assertEquals("AGENTTRUST_STACK_SESSION=abcd.12",RoutePolicy.session("legacy=secret; AGENTTRUST_STACK_SESSION=abcd.12; unrelated=hidden"));}
 @Test void upstreamCannotChooseArbitraryRedirect(){assertTrue(GatewayController.validRedirect("/login/oauth2/code/keycloak","http://127.0.0.1:4320/"));assertFalse(GatewayController.validRedirect("/api/me","http://127.0.0.1:4320/"));assertFalse(GatewayController.validRedirect("/oauth2/authorization/keycloak","https://evil.invalid/"));}
}
