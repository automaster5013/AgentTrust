package dev.agenttrust.gateway;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import static org.junit.jupiter.api.Assertions.*;
class VersionHistorySearchRouteTest {
 @Test void onlyAuthenticatedReadOnlyBoundedNamesAndCursorsAreRouted(){
  for(String kind:new String[]{"agents","datasets"})for(String tail:new String[]{"","/"+"A".repeat(128)}){String path="/api/version-history-search/"+kind+"/agent-test"+tail;assertTrue(RoutePolicy.allowed(path,HttpMethod.GET));assertTrue(RoutePolicy.protectedPath(path));for(HttpMethod method:new HttpMethod[]{HttpMethod.POST,HttpMethod.PUT,HttpMethod.DELETE})assertFalse(RoutePolicy.allowed(path,method));}
  for(String path:new String[]{"agents/ab","other/agent-test","agents/AGENT","agents/agent%2Ftest","agents/agent-test/short","agents/agent-test/"+"A".repeat(129),"agents/agent-test/../runs","agents/agent?scope=foreign"})assertFalse(RoutePolicy.allowed("/api/version-history-search/"+path,HttpMethod.GET));
 }
}
