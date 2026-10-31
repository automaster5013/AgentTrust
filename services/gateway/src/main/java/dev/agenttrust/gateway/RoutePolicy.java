package dev.agenttrust.gateway;
import java.util.UUID;
import java.util.Map;
import org.springframework.http.HttpMethod;
public final class RoutePolicy {
 private RoutePolicy(){}
 public static boolean allowed(String path,HttpMethod method){
  if(path.equals(BackChannelForm.PATH))return method==HttpMethod.POST;
  if(path.contains("%")||path.contains(".."))return false;
  if(path.matches("/api/workspace/(project|access-keys|sessions)"))return method==HttpMethod.GET||method==HttpMethod.POST&&!path.endsWith("/sessions");
  if(path.matches("/api/workspace/(access-keys|sessions)/[a-f0-9-]{36}/revoke"))return method==HttpMethod.POST;
  if(method==HttpMethod.GET)return path.matches("/api/(campaign-history(/dataset/[a-f0-9-]{36})?(/page/[A-Za-z0-9_-]{107})?|audit-search/(all|[a-z][a-z0-9.-]{0,59})/(all|[a-f0-9-]{36})(/[A-Za-z0-9_-]{124})?|audit-export|audit(/[A-Za-z0-9_-]{80})?|run-history(/[A-Za-z0-9_-]{84})?|provider-usage|evaluation-readiness|version-history/(agents|datasets)(/[A-Za-z0-9_-]{84})?|auth-info|gate-trust(/keys/[a-f0-9]{64})?|csrf|me|runs|(run|campaign)-requests/[A-Za-z0-9_-]{8,100}|runs/[a-f0-9-]{36}(/reviews(/page(/[A-Za-z0-9_-]{79})?)?|/(gate|evidence|similar))?|versions/(agents|datasets)(/[a-f0-9-]{36}(/lifecycle)?)?|campaigns|campaigns/[a-f0-9-]{36}(/gate-check/[a-f0-9]{64}|/gate|/release-requirements|/version-lifecycle|/evidence|/reviews(/page(/[A-Za-z0-9_-]{79})?)?|/receipts(/[a-f0-9-]{36}(/bundle)?)?|/comparison/[a-f0-9-]{36})?)")||path.equals("/oauth2/authorization/keycloak")||path.equals("/login/oauth2/code/keycloak");
  return method==HttpMethod.POST&&(path.matches("/api/(login|logout|runs|runs/[a-f0-9-]{36}/(reviews|cancel)|versions/(agents|datasets)(/[a-f0-9-]{36}/lifecycle/retirement)?|campaigns|campaigns/[a-f0-9-]{36}/(reviews|cancel|receipts))"));
 }
 public static boolean protectedPath(String path){return path.startsWith("/api/workspace/")|| path.startsWith("/api/campaign-requests/")||path.startsWith("/api/run-requests/")||path.startsWith("/api/audit-search/")||path.equals("/api/audit-export")||path.startsWith("/api/version-history/")||path.equals("/api/evaluation-readiness")||path.equals("/api/campaign-history")||path.startsWith("/api/campaign-history/")||path.equals("/api/provider-usage")||path.equals("/api/run-history")||path.startsWith("/api/run-history/")||path.equals("/api/audit")||path.startsWith("/api/audit/")||path.equals("/api/gate-trust")||path.startsWith("/api/gate-trust/keys/")||path.equals("/api/me")||path.equals("/api/runs")||path.startsWith("/api/runs/")||path.startsWith("/api/versions/")||path.equals("/api/campaigns")||path.startsWith("/api/campaigns/");}
 public static String session(String raw){if(raw==null)return "";return java.util.Arrays.stream(raw.split(";")).map(String::trim).filter(s->s.matches("AGENTTRUST_STACK_SESSION=[A-Za-z0-9.-]{1,128}")).findFirst().orElse("");}
 public static String quotaScope(Map<String,Object> identity){return canonical(identity.get("organizationId"))+":"+canonical(identity.get("projectId"));}
 private static String canonical(Object value){if(!(value instanceof String text)||!UUID.fromString(text).toString().equals(text))throw new IllegalArgumentException("Invalid authenticated scope");return text;}
}
