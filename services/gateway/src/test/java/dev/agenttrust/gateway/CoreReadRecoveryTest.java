package dev.agenttrust.gateway;
import java.net.URI;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.http.*;
import org.springframework.web.reactive.function.client.*;
import reactor.core.publisher.Mono;
import static org.junit.jupiter.api.Assertions.*;
class CoreReadRecoveryTest {
 @Test void transportFailureCanRecoverOneReadWithoutReplayingWritesOrOauthCallbacks(){
  for(var row:new Object[][]{{HttpMethod.GET,"/api/auth-info",2},{HttpMethod.POST,"/api/runs",1},{HttpMethod.GET,"/login/oauth2/code/keycloak",1},{HttpMethod.GET,"/api/csrf",1}}){
   var count=new AtomicInteger();HttpMethod method=(HttpMethod)row[0];String path=(String)row[1];
   var client=WebClient.builder().baseUrl("http://stack-core-api:8080").filter(GatewayConfiguration.recoverReads()).exchangeFunction(request->{if(count.incrementAndGet()==1)return Mono.error(new WebClientRequestException(new IOException("Synthetic closed connection"),method,URI.create("http://stack-core-api:8080"+path),new HttpHeaders()));return Mono.just(ClientResponse.create(HttpStatus.OK).body("recovered").build());}).build();
   var response=client.method(method).uri(path).retrieve().bodyToMono(String.class);
   if((int)row[2]==2)assertEquals("recovered",response.block());else assertThrows(WebClientRequestException.class,response::block);
   assertEquals((int)row[2],count.get());
  }
 }
}
