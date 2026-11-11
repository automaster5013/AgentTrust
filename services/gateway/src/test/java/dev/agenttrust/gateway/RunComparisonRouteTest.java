package dev.agenttrust.gateway;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import static org.junit.jupiter.api.Assertions.*;
class RunComparisonRouteTest {
 @Test void exactComparisonPathIsAuthenticatedAndReadOnly(){
  String a="11111111-1111-4111-8111-111111111111",b="22222222-2222-4222-8222-222222222222",path="/api/runs/"+a+"/comparison/"+b;
  assertTrue(RoutePolicy.allowed(path,HttpMethod.GET));assertTrue(RoutePolicy.protectedPath(path));
  for(var method:new HttpMethod[]{HttpMethod.POST,HttpMethod.PUT,HttpMethod.DELETE})assertFalse(RoutePolicy.allowed(path,method));
  for(String bad:new String[]{path+"/extra",path+"%2f",path.replace(b,"foreign"),path.replace(a,"..")})assertFalse(RoutePolicy.allowed(bad,HttpMethod.GET));
 }
}
