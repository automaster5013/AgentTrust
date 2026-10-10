package dev.agenttrust.gateway;
import java.time.Duration;
import java.util.Map;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.core.io.buffer.DataBufferLimitException;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;
@RestController
public class GatewayController {
 private final WebClient core;private final QuotaService quotas;
 public GatewayController(WebClient coreClient,QuotaService quotas){core=coreClient;this.quotas=quotas;}
 @RequestMapping({"/api/**","/oauth2/**","/login/oauth2/**","/internal/**"})
 public Mono<ResponseEntity<byte[]>> forward(ServerWebExchange exchange){
  var request=exchange.getRequest();var method=request.getMethod();String path=request.getURI().getRawPath();
  if(!RoutePolicy.allowed(path,method))return Mono.just(error(404,"ROUTE_REFUSED"));
  if(method==HttpMethod.POST&&RoutePolicy.protectedPath(path)&&request.getHeaders().getFirst("X-CSRF-TOKEN")==null)return Mono.just(error(403,"REQUEST_REFUSED"));
  String query=request.getURI().getRawQuery();if(query!=null&&(!path.equals("/login/oauth2/code/keycloak")||query.length()>8192))return Mono.just(error(400,"QUERY_REFUSED"));
  String target=path+(query==null?"":"?"+query),cookie=RoutePolicy.session(request.getHeaders().getFirst(HttpHeaders.COOKIE));
  Mono<Long> admitted=Mono.just(1L);
  if(RoutePolicy.protectedPath(path)){
   if(cookie.isEmpty())return Mono.just(error(401,"AUTHENTICATION_REQUIRED"));
   admitted=core.get().uri("/api/me").header(HttpHeaders.COOKIE,cookie).exchangeToMono(response->{if(response.statusCode().value()!=200)return response.releaseBody().then(Mono.error(response.statusCode().value()==401?new Unauthenticated():new IllegalStateException("Identity service unavailable")));return response.bodyToMono(new ParameterizedTypeReference<Map<String,Object>>(){});}).flatMap(identity->quotas.admit(RoutePolicy.quotaScope(identity),method==HttpMethod.POST));
  }
  return admitted.flatMap(value->{if(value<0){var headers=new HttpHeaders();headers.setContentType(MediaType.APPLICATION_JSON);headers.set(HttpHeaders.RETRY_AFTER,Long.toString(-value));headers.setCacheControl("no-store");return Mono.just(new ResponseEntity<>(json("RATE_LIMITED"),headers,HttpStatus.TOO_MANY_REQUESTS));}
   return DataBufferUtils.join(request.getBody(),16384).map(buffer->{byte[] bytes=new byte[buffer.readableByteCount()];buffer.read(bytes);DataBufferUtils.release(buffer);return bytes;}).defaultIfEmpty(new byte[0]).flatMap(body->{
    var outbound=core.method(method).uri(java.net.URI.create("http://stack-core-api:8080"+target)).header(HttpHeaders.ACCEPT,MediaType.APPLICATION_JSON_VALUE);if(!cookie.isEmpty())outbound.header(HttpHeaders.COOKIE,cookie);
    if(method==HttpMethod.POST){outbound.header(HttpHeaders.CONTENT_TYPE,path.equals("/api/login")?MediaType.APPLICATION_FORM_URLENCODED_VALUE:MediaType.APPLICATION_JSON_VALUE);for(String name:new String[]{"X-CSRF-TOKEN","Idempotency-Key"}){String header=request.getHeaders().getFirst(name);if(header!=null&&header.length()<=2048)outbound.header(name,header);}}
    return outbound.bodyValue(body).exchangeToMono(response->response.bodyToMono(byte[].class).defaultIfEmpty(new byte[0]).map(bytes->{var headers=new HttpHeaders();headers.setContentType(MediaType.APPLICATION_JSON);headers.setCacheControl("no-store");for(String session:response.headers().header(HttpHeaders.SET_COOKIE))if(session.startsWith("AGENTTRUST_STACK_SESSION="))headers.add(HttpHeaders.SET_COOKIE,session);
     if(response.statusCode().is3xxRedirection()){String location=response.headers().asHttpHeaders().getFirst(HttpHeaders.LOCATION);if(!validRedirect(path,location))return error(502,"UPSTREAM_REFUSED");headers.set(HttpHeaders.LOCATION,location);}headers.set("X-AgentTrust-Gateway","spring-webflux");return new ResponseEntity<>(bytes,headers,response.statusCode());}));
   });
  }).timeout(Duration.ofSeconds(6)).onErrorResume(Unauthenticated.class,error->Mono.just(error(401,"AUTHENTICATION_REQUIRED"))).onErrorResume(DataBufferLimitException.class,error->Mono.just(error(413,"REQUEST_TOO_LARGE"))).onErrorResume(error->Mono.just(error(503,"GATEWAY_UNAVAILABLE")));
 }
 static boolean validRedirect(String path,String location){if(location==null)return false;try{var uri=java.net.URI.create(location);if(uri.getUserInfo()!=null||uri.getFragment()!=null)return false;return path.equals("/oauth2/authorization/keycloak")&&uri.getScheme().equals("http")&&uri.getHost().equals("127.0.0.1")&&uri.getPort()==4322&&uri.getPath().equals("/realms/agenttrust/protocol/openid-connect/auth")||path.equals("/login/oauth2/code/keycloak")&&location.equals("http://127.0.0.1:4320/");}catch(Exception error){return false;}}
 static byte[] json(String code){return ("{\"code\":\""+code+"\"}").getBytes(java.nio.charset.StandardCharsets.UTF_8);}
 static ResponseEntity<byte[]> error(int status,String code){return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).cacheControl(CacheControl.noStore()).body(json(code));}
 static final class Unauthenticated extends RuntimeException{}
}
