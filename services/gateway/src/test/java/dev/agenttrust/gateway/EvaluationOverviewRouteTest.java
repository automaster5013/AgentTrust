package dev.agenttrust.gateway;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import static org.junit.jupiter.api.Assertions.*;
class EvaluationOverviewRouteTest {
 @Test void capacityIsAuthenticatedExactGetOnly(){assertTrue(RoutePolicy.allowed("/api/evaluation-overview",HttpMethod.GET));assertTrue(RoutePolicy.protectedPath("/api/evaluation-overview"));for(var method:new HttpMethod[]{HttpMethod.POST,HttpMethod.PUT,HttpMethod.DELETE})assertFalse(RoutePolicy.allowed("/api/evaluation-overview",method));for(String path:new String[]{"/api/evaluation-overview/foreign","/api/evaluation-overview%2f","/api/evaluation-overview/.."})assertFalse(RoutePolicy.allowed(path,HttpMethod.GET));}
}
