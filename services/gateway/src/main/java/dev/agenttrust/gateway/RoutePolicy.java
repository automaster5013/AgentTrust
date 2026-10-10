package dev.agenttrust.gateway;
import java.util.UUID;
import java.util.Map;
import org.springframework.http.HttpMethod;
public final class RoutePolicy {
 private RoutePolicy(){}
 public static boolean allowed(String path,HttpMethod method){
  if(path.contains("%")||path.contains(".."))return false;
  if(method==HttpMethod.GET)return path.matches("/api/(auth-info|csrf|me|runs|runs/[a-f0-9-]{36}(/(reviews|gate|evidence|similar))?)")||path.equals("/oauth2/authorization/keycloak")||path.equals("/login/oauth2/code/keycloak");
  return method==HttpMethod.POST&&(path.matches("/api/(login|logout|runs|runs/[a-f0-9-]{36}/reviews)"));
 }
 public static boolean protectedPath(String path){return path.equals("/api/me")||path.equals("/api/runs")||path.startsWith("/api/runs/");}
 public static String session(String raw){if(raw==null)return "";return java.util.Arrays.stream(raw.split(";")).map(String::trim).filter(s->s.matches("AGENTTRUST_STACK_SESSION=[A-Za-z0-9.-]{1,128}")).findFirst().orElse("");}
 public static String quotaScope(Map<String,Object> identity){return canonical(identity.get("organizationId"))+":"+canonical(identity.get("projectId"));}
 private static String canonical(Object value){if(!(value instanceof String text)||!UUID.fromString(text).toString().equals(text))throw new IllegalArgumentException("Invalid authenticated scope");return text;}
}
