package dev.agenttrust.gateway;
import org.junit.jupiter.api.Test;import org.springframework.http.HttpMethod;import static org.junit.jupiter.api.Assertions.*;
class AuditSearchRouteTest {
 @Test void searchNavigationIsAuthenticatedReadOnlyAndBounded(){
  String id="11111111-1111-4111-8111-111111111111";
  for(String path:new String[]{"/api/audit-search/all/all","/api/audit-search/version.agents.retired/"+id,"/api/audit-search/review.approved/"+id+"/"+"A".repeat(124)}){assertTrue(RoutePolicy.allowed(path,HttpMethod.GET));assertTrue(RoutePolicy.protectedPath(path));for(var method:new HttpMethod[]{HttpMethod.POST,HttpMethod.PUT,HttpMethod.DELETE})assertFalse(RoutePolicy.allowed(path,method));}
  for(String path:new String[]{"/api/audit-search/all/all/"+"A".repeat(80),"/api/audit-search/all/all/"+"A".repeat(124)+"=","/api/audit-search/all/all/../runs","/api/audit-search/all/all/organization/"+id,"/api/audit-search/all/%61ll"})assertFalse(RoutePolicy.allowed(path,HttpMethod.GET));
 }
}
