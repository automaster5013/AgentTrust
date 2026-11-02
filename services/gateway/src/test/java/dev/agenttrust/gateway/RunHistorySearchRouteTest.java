package dev.agenttrust.gateway;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import static org.junit.jupiter.api.Assertions.*;
class RunHistorySearchRouteTest {
 @Test void readOnlySearchIsAuthenticatedAndBounded(){
  for(String path:new String[]{"/api/run-history-search/all/all/all/all/all","/api/run-history-search/quality/not-required/failed/inconclusive/openai-compatible/"+"A".repeat(128)}){
   assertTrue(RoutePolicy.allowed(path,HttpMethod.GET));assertTrue(RoutePolicy.protectedPath(path));
   for(var method:new HttpMethod[]{HttpMethod.POST,HttpMethod.PUT,HttpMethod.DELETE,HttpMethod.PATCH})assertFalse(RoutePolicy.allowed(path,method));
  }
 }
 @Test void unknownChoicesAndTraversalNeverReachCore(){
  for(String path:new String[]{"/api/run-history-search/all/all/all/all/unknown","/api/run-history-search/ALL/all/all/all/all","/api/run-history-search/all/all/cancelled/all/all","/api/run-history-search/all/all/all/all/all/"+"A".repeat(127),"/api/run-history-search/all/all/all/all/all/"+"A".repeat(128)+"=","/api/run-history-search/%61ll/all/all/all/all","/api/run-history-search/all/all/all/all/all/../runs"})assertFalse(RoutePolicy.allowed(path,HttpMethod.GET));
 }
}
