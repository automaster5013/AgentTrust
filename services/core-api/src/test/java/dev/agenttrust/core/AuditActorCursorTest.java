package dev.agenttrust.core;
import java.time.Instant;import java.util.UUID;import org.junit.jupiter.api.Test;import static org.junit.jupiter.api.Assertions.*;
class AuditActorCursorTest {
 @Test void actorFilterTenantAndPreciseOrderingAreBoundTogether(){
  UUID org=UUID.randomUUID(),project=UUID.randomUUID(),actor=UUID.randomUUID(),id=UUID.randomUUID();var user=new DemoUser("viewer","unused",org,project,actor,"viewer");var filters=AuditFilters.parse("review.approved","all");var boundary=new AuditCursor(org,project,Instant.parse("2026-10-12T09:00:00.123456Z"),id);String token=AuditActorCursor.encode(boundary,filters,actor);
  assertEquals(168,token.length());assertEquals(boundary,AuditActorCursor.decode(token,user,filters,actor));
  assertThrows(IllegalArgumentException.class,()->AuditActorCursor.decode(token,user,filters,UUID.randomUUID()));
  assertThrows(IllegalArgumentException.class,()->AuditActorCursor.decode(token,user,AuditFilters.parse("all","all"),actor));
  assertThrows(IllegalArgumentException.class,()->AuditActorCursor.decode(token,new DemoUser("other","unused",UUID.randomUUID(),project,actor,"admin"),filters,actor));
  for(String invalid:new String[]{AuditSearchCursor.encode(boundary,filters),token+"=",token.substring(1),"!"+token.substring(1)})assertThrows(IllegalArgumentException.class,()->AuditActorCursor.decode(invalid,user,filters,actor));
 }
 @Test void actorCoordinatesMustBeCanonical(){for(String invalid:new String[]{"all","","1-1-1-1-1","AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA","../../runs"})assertThrows(IllegalArgumentException.class,()->AuditActorCursor.actor(invalid));}
}
