package dev.agenttrust.gateway;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import static org.junit.jupiter.api.Assertions.*;
class RegisteredCatalogRouteTest {
 @Test void catalogUsesAuthenticatedGetOnly(){assertTrue(RoutePolicy.allowed("/api/catalog",HttpMethod.GET));assertTrue(RoutePolicy.protectedPath("/api/catalog"));for(var method:new HttpMethod[]{HttpMethod.POST,HttpMethod.PUT,HttpMethod.DELETE})assertFalse(RoutePolicy.allowed("/api/catalog",method));for(String path:new String[]{"/api/catalog/foreign","/api/catalog%2f","/api/catalog/.."})assertFalse(RoutePolicy.allowed(path,HttpMethod.GET));}
}
