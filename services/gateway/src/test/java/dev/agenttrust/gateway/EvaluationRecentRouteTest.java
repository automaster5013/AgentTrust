package dev.agenttrust.gateway;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import static org.junit.jupiter.api.Assertions.*;
class EvaluationRecentRouteTest {
 @Test void capacityIsAuthenticatedExactGetOnly(){assertTrue(RoutePolicy.allowed("/api/evaluation-recent",HttpMethod.GET));assertTrue(RoutePolicy.protectedPath("/api/evaluation-recent"));for(var method:new HttpMethod[]{HttpMethod.POST,HttpMethod.PUT,HttpMethod.DELETE})assertFalse(RoutePolicy.allowed("/api/evaluation-recent",method));for(String path:new String[]{"/api/evaluation-recent/foreign","/api/evaluation-recent%2f","/api/evaluation-recent/.."})assertFalse(RoutePolicy.allowed(path,HttpMethod.GET));}
}
