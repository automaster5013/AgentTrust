package dev.agenttrust.gateway;
import org.junit.jupiter.api.Test;import org.springframework.http.HttpMethod;import static org.junit.jupiter.api.Assertions.*;
class AuditPeriodRouteTest {
 @Test void chunkExportsAreReadOnlyAndProtected(){String p="/api/audit-period-export/2026-11-03/2026-11-03/all/all/all";assertTrue(RoutePolicy.allowed(p,HttpMethod.GET));assertTrue(RoutePolicy.protectedPath(p));assertTrue(RoutePolicy.allowed(p+"/"+"A".repeat(124),HttpMethod.GET));assertFalse(RoutePolicy.allowed(p,HttpMethod.POST));assertFalse(RoutePolicy.allowed(p+"/"+"A".repeat(168),HttpMethod.GET));}
 @Test void periodRoutesAreAuthenticatedBoundedReads(){
  String p="/api/audit-period-search/2026-11-03/2026-11-03/all/all/all";
  assertTrue(RoutePolicy.allowed(p,HttpMethod.GET));assertTrue(RoutePolicy.protectedPath(p));assertTrue(RoutePolicy.allowed(p+"/"+"A".repeat(124),HttpMethod.GET));
  for(var method:new HttpMethod[]{HttpMethod.POST,HttpMethod.PUT,HttpMethod.DELETE})assertFalse(RoutePolicy.allowed(p,method));
  for(String suffix:new String[]{"/"+"A".repeat(168),"/"+"A".repeat(80),"/../../runs","/"+"A".repeat(124)+"="})assertFalse(RoutePolicy.allowed(p+suffix,HttpMethod.GET));
 }
}
