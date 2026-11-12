package dev.agenttrust.gateway;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import static org.junit.jupiter.api.Assertions.*;
class ReceiptHistoryRouteTest {
 @Test void capacityIsAuthenticatedExactGetOnly(){assertTrue(RoutePolicy.allowed("/api/receipt-history",HttpMethod.GET));assertTrue(RoutePolicy.protectedPath("/api/receipt-history"));assertTrue(RoutePolicy.allowed("/api/receipt-history/campaign/11111111-1111-4111-8111-111111111111/page/"+"a".repeat(107),HttpMethod.GET));for(var method:new HttpMethod[]{HttpMethod.POST,HttpMethod.PUT,HttpMethod.DELETE})assertFalse(RoutePolicy.allowed("/api/receipt-history",method));for(String path:new String[]{"/api/receipt-history/foreign","/api/receipt-history%2f","/api/receipt-history/.."})assertFalse(RoutePolicy.allowed(path,HttpMethod.GET));}
}
