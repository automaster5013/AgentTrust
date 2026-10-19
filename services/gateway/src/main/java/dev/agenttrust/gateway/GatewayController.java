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
 private final WebClient core;private final QuotaService quotas;private final GatewayOidcEndpoints endpoints;private final GatewayStageTiming timing;
 public GatewayController(WebClient coreClient,QuotaService quotas){this(coreClient,quotas,new GatewayStageTiming(new io.micrometer.core.instrument.simple.SimpleMeterRegistry()));}
 GatewayController(WebClient coreClient,QuotaService quotas,GatewayStageTiming timing){core=coreClient;this.quotas=quotas;endpoints=GatewayOidcEndpoints.local();this.timing=timing;}
 public GatewayController(WebClient coreClient,QuotaService quotas,org.springframework.core.env.Environment environment){this(coreClient,quotas,environment,new GatewayStageTiming(new io.micrometer.core.instrument.simple.SimpleMeterRegistry()));}
 @org.springframework.beans.factory.annotation.Autowired
 public GatewayController(WebClient coreClient,QuotaService quotas,org.springframework.core.env.Environment environment,GatewayStageTiming timing){
  core=coreClient;this.quotas=quotas;this.timing=timing;endpoints=GatewayOidcEndpoints.configure(environment.getProperty("agenttrust.oidc.profile","local-review"),environment.getProperty("agenttrust.oidc.application-origin","http://127.0.0.1:4320"),environment.getProperty("agenttrust.oidc.public-issuer","http://127.0.0.1:4322/realms/agenttrust"));
 }
 @RequestMapping({"/api/**","/oauth2/**","/login/oauth2/**","/internal/**","/logout/connect/back-channel/keycloak"})
 public Mono<ResponseEntity<byte[]>> forward(ServerWebExchange exchange){
  var request=exchange.getRequest();var method=request.getMethod();String path=request.getURI().getRawPath();
  if(!RoutePolicy.allowed(path,method))return Mono.just(error(404,"ROUTE_REFUSED"));
  if(method==HttpMethod.POST&&RoutePolicy.protectedPath(path)&&request.getHeaders().getFirst("X-CSRF-TOKEN")==null)return Mono.just(error(403,"REQUEST_REFUSED"));
  String query=request.getURI().getRawQuery();if(query!=null&&(!path.equals("/login/oauth2/code/keycloak")||query.length()>8192))return Mono.just(error(400,"QUERY_REFUSED"));
  if(path.equals(BackChannelForm.PATH))return backchannel(exchange);
  String target=path+(query==null?"":"?"+query),cookie=RoutePolicy.session(request.getHeaders().getFirst(HttpHeaders.COOKIE));
  Mono<Long> admitted=Mono.just(1L);
  if(RoutePolicy.protectedPath(path)){
   if(cookie.isEmpty())return Mono.just(error(401,"AUTHENTICATION_REQUIRED"));
   admitted=timing.measure(GatewayStageTiming.Stage.IDENTITY,()->core.get().uri("/api/me").header(HttpHeaders.COOKIE,cookie).exchangeToMono(response->{if(response.statusCode().value()!=200)return response.releaseBody().then(Mono.error(response.statusCode().value()==401?new Unauthenticated():new IllegalStateException("Identity service unavailable")));return response.bodyToMono(new ParameterizedTypeReference<Map<String,Object>>(){});})).flatMap(identity->timing.measure(GatewayStageTiming.Stage.QUOTA,()->quotas.admit(RoutePolicy.quotaScope(identity),method==HttpMethod.POST)));
  }
  return admitted.flatMap(value->{if(value<0){var headers=new HttpHeaders();headers.setContentType(MediaType.APPLICATION_JSON);headers.set(HttpHeaders.RETRY_AFTER,Long.toString(-value));headers.setCacheControl("no-store");return Mono.just(new ResponseEntity<>(json("RATE_LIMITED"),headers,HttpStatus.TOO_MANY_REQUESTS));}
   java.util.function.Supplier<Mono<ResponseEntity<byte[]>>> forwarding=()->DataBufferUtils.join(request.getBody(),16384).map(buffer->{byte[] bytes=new byte[buffer.readableByteCount()];buffer.read(bytes);DataBufferUtils.release(buffer);return bytes;}).defaultIfEmpty(new byte[0]).flatMap(body->{
    var outbound=core.method(method).uri(java.net.URI.create("http://stack-core-api:8080"+target)).header(HttpHeaders.ACCEPT,MediaType.APPLICATION_JSON_VALUE);if(!cookie.isEmpty())outbound.header(HttpHeaders.COOKIE,cookie);
    if(method==HttpMethod.POST){outbound.header(HttpHeaders.CONTENT_TYPE,path.equals("/api/login")?MediaType.APPLICATION_FORM_URLENCODED_VALUE:MediaType.APPLICATION_JSON_VALUE);for(String name:new String[]{"X-CSRF-TOKEN","Idempotency-Key"}){String header=request.getHeaders().getFirst(name);if(header!=null&&header.length()<=2048)outbound.header(name,header);}}
    return outbound.bodyValue(body).exchangeToMono(response->response.bodyToMono(byte[].class).defaultIfEmpty(new byte[0]).map(bytes->{var headers=new HttpHeaders();headers.setContentType(MediaType.APPLICATION_JSON);headers.setCacheControl("no-store");for(String session:response.headers().header(HttpHeaders.SET_COOKIE))if(session.startsWith("AGENTTRUST_STACK_SESSION="))headers.add(HttpHeaders.SET_COOKIE,session);
     if(response.statusCode().is3xxRedirection()){String location=response.headers().asHttpHeaders().getFirst(HttpHeaders.LOCATION);if(!endpoints.acceptsRedirect(path,location))return error(502,"UPSTREAM_REFUSED");headers.set(HttpHeaders.LOCATION,location);}headers.set("X-AgentTrust-Gateway","spring-webflux");return new ResponseEntity<>(bytes,headers,response.statusCode());}));
   });
   return RoutePolicy.protectedPath(path)?timing.measure(GatewayStageTiming.Stage.FORWARD,forwarding):Mono.defer(forwarding);
  }).timeout(Duration.ofSeconds(6)).onErrorResume(Unauthenticated.class,error->Mono.just(error(401,"AUTHENTICATION_REQUIRED"))).onErrorResume(DataBufferLimitException.class,error->Mono.just(error(413,"REQUEST_TOO_LARGE"))).onErrorResume(error->Mono.just(error(503,"GATEWAY_UNAVAILABLE")));
 }
 private Mono<ResponseEntity<byte[]>> backchannel(ServerWebExchange exchange){
  var request=exchange.getRequest();
  return DataBufferUtils.join(request.getBody(),16384).map(buffer->{byte[] bytes=new byte[buffer.readableByteCount()];buffer.read(bytes);DataBufferUtils.release(buffer);return bytes;}).defaultIfEmpty(new byte[0]).flatMap(body->{
   byte[] normalized;try{normalized=BackChannelForm.normalize(body,request.getHeaders().getFirst(HttpHeaders.CONTENT_TYPE));}catch(IllegalArgumentException refused){return Mono.just(error(400,"LOGOUT_FORM_REFUSED"));}
   return quotas.admit("public-backchannel",true).flatMap(value->{
    if(value<0)return Mono.just(ResponseEntity.status(429).header(HttpHeaders.RETRY_AFTER,Long.toString(-value)).contentType(MediaType.APPLICATION_JSON).cacheControl(CacheControl.noStore()).body(json("RATE_LIMITED")));
    return core.post().uri(BackChannelForm.PATH).contentType(MediaType.APPLICATION_FORM_URLENCODED).bodyValue(normalized).exchangeToMono(response->{
     int status=response.statusCode().value();return response.releaseBody().thenReturn(status==200||status==204?ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(new byte[0]):error(status==400||status==401?status:503,"LOGOUT_REFUSED"));
    });
   });
  }).timeout(Duration.ofSeconds(6)).onErrorResume(DataBufferLimitException.class,error->Mono.just(error(413,"REQUEST_TOO_LARGE"))).onErrorResume(error->Mono.just(error(503,"LOGOUT_UNAVAILABLE")));
 }
 static boolean validRedirect(String path,String location){return GatewayOidcEndpoints.local().acceptsRedirect(path,location);}
 static byte[] json(String code){return ("{\"code\":\""+code+"\"}").getBytes(java.nio.charset.StandardCharsets.UTF_8);}
 static ResponseEntity<byte[]> error(int status,String code){return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).cacheControl(CacheControl.noStore()).body(json(code));}
 static final class Unauthenticated extends RuntimeException{}
}
