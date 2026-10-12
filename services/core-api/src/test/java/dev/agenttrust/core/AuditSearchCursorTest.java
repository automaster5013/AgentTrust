package dev.agenttrust.core;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class AuditSearchCursorTest {
 private final UUID org=UUID.randomUUID(),project=UUID.randomUUID(),id=UUID.randomUUID();
 private final DemoUser user=new DemoUser("viewer","unused",org,project,id,"viewer");
 private final AuditCursor boundary=new AuditCursor(org,project,Instant.parse("2026-10-12T09:00:00.123456Z"),id);
 @Test void preciseBoundaryIsBoundToExactFiltersAndTenant(){
  var filters=AuditFilters.parse("version.agents.retired",id.toString());String token=AuditSearchCursor.encode(boundary,filters);
  assertEquals(124,token.length());assertEquals(boundary,AuditSearchCursor.decode(token,user,filters));
  for(var changed:new AuditFilters[]{AuditFilters.parse("all",id.toString()),AuditFilters.parse("version.datasets.retired",id.toString()),AuditFilters.parse("version.agents.retired","all"),AuditFilters.parse("version.agents.retired",UUID.randomUUID().toString())})assertThrows(IllegalArgumentException.class,()->AuditSearchCursor.decode(token,user,changed));
  assertThrows(IllegalArgumentException.class,()->AuditSearchCursor.decode(token,new DemoUser("foreign","unused",UUID.randomUUID(),project,id,"admin"),filters));
  assertThrows(IllegalArgumentException.class,()->AuditSearchCursor.decode(token,new DemoUser("foreign-project","unused",org,UUID.randomUUID(),id,"admin"),filters));
 }
 @Test void legacyPaddingSchemaAndDigestSubstitutionAreRefused(){
  var filters=AuditFilters.parse("all","all");String token=AuditSearchCursor.encode(boundary,filters);
  for(String malformed:new String[]{boundary.encode(),token+"=",token.substring(1),"!"+token.substring(1)})assertThrows(IllegalArgumentException.class,()->AuditSearchCursor.decode(malformed,user,filters));
  for(int offset:new int[]{0,1,32}){byte[] raw=Base64.getUrlDecoder().decode(token);raw[offset]^=1;String changed=Base64.getUrlEncoder().withoutPadding().encodeToString(raw);assertThrows(IllegalArgumentException.class,()->AuditSearchCursor.decode(changed,user,filters));}
 }
 @Test void filtersRejectUnknownActionsAndNoncanonicalResourceCoordinates(){
  assertNull(AuditFilters.parse("all","all").action());assertNull(AuditFilters.parse("all","all").resourceId());
  for(String action:new String[]{"","ALL","review.deleted","version.agents.retired/../all","review.approved' OR 1=1"})assertThrows(IllegalArgumentException.class,()->AuditFilters.parse(action,"all"));
  for(String resource:new String[]{"","ALL",id.toString().toUpperCase(),"1-1-1-1-1","../../runs",id+"?actor=other"})assertThrows(IllegalArgumentException.class,()->AuditFilters.parse("all",resource));
 }
}
