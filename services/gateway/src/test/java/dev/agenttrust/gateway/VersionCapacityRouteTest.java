package dev.agenttrust.gateway;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import static org.junit.jupiter.api.Assertions.*;
class VersionCapacityRouteTest {
 @Test void capacityIsAuthenticatedExactGetOnly(){assertTrue(RoutePolicy.allowed("/api/version-capacity",HttpMethod.GET));assertTrue(RoutePolicy.protectedPath("/api/version-capacity"));for(var method:new HttpMethod[]{HttpMethod.POST,HttpMethod.PUT,HttpMethod.DELETE})assertFalse(RoutePolicy.allowed("/api/version-capacity",method));for(String path:new String[]{"/api/version-capacity/foreign","/api/version-capacity%2f","/api/version-capacity/.."})assertFalse(RoutePolicy.allowed(path,HttpMethod.GET));}
}
