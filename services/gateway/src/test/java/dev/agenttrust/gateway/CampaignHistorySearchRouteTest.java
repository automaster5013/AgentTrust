package dev.agenttrust.gateway;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import static org.junit.jupiter.api.Assertions.*;
class CampaignHistorySearchRouteTest {
 @Test void onlyAuthenticatedBoundedGetsAreAdmitted(){
  for(var path:new String[]{"/api/campaign-history-search/all/all/all","/api/campaign-history-search/11111111-1111-4111-8111-111111111111/required/22222222-2222-4222-8222-222222222222/"+"A".repeat(151)}){
   assertTrue(RoutePolicy.allowed(path,HttpMethod.GET));assertTrue(RoutePolicy.protectedPath(path));
   for(var method:new HttpMethod[]{HttpMethod.POST,HttpMethod.PUT,HttpMethod.PATCH,HttpMethod.DELETE})assertFalse(RoutePolicy.allowed(path,method));
  }
 }
 @Test void invalidConditionsAndTraversalAreRefused(){for(var path:new String[]{"/api/campaign-history-search/all/approved/all","/api/campaign-history-search/all/ALL/all","/api/campaign-history-search/%61ll/all/all","/api/campaign-history-search/all/all/../runs","/api/campaign-history-search/all/all/all/"+"A".repeat(150),"/api/campaign-history-search/all/all/all/"+"A".repeat(151)+"="})assertFalse(RoutePolicy.allowed(path,HttpMethod.GET));}
}
