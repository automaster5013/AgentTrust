package dev.agenttrust.core;
import java.time.Instant;import java.util.UUID;import org.junit.jupiter.api.Test;import static org.junit.jupiter.api.Assertions.*;
class AuditPeriodCursorTest {
 private final UUID org=UUID.randomUUID(),project=UUID.randomUUID(),actor=UUID.randomUUID(),id=UUID.randomUUID();
 private final DemoUser user=new DemoUser("viewer","unused",org,project,actor,"viewer");
 @Test void utcDaysAreStrictInclusiveAndCappedAt366(){
  var p=AuditPeriod.parse("2024-01-01","2024-12-31","all","all","all");assertNull(p.actorId());assertEquals(Instant.parse("2024-01-01T00:00:00Z"),p.startInclusive());assertEquals(Instant.parse("2025-01-01T00:00:00Z"),p.endExclusive());
  for(String[] pair:new String[][]{{"2023-02-29","2023-03-01"},{"2026-11-03","2026-11-02"},{"2024-01-01","2025-01-01"},{"1969-12-31","1970-01-01"},{"2026-1-01","2026-01-01"},{"2026-01-01","9999-12-31"}})assertThrows(IllegalArgumentException.class,()->AuditPeriod.parse(pair[0],pair[1],"all","all","all"));
 }
 @Test void dateActorActionResourceAndTenantMustAllMatch(){
  var p=AuditPeriod.parse("2026-11-03","2026-11-03",actor.toString(),"review.approved",id.toString());var b=new AuditCursor(org,project,Instant.parse("2026-11-03T23:59:59.999999Z"),id);String token=AuditPeriodCursor.encode(b,p);assertEquals(124,token.length());assertEquals(b,AuditPeriodCursor.decode(token,user,p));
  for(var changed:new AuditPeriod[]{AuditPeriod.parse("2026-11-02","2026-11-03",actor.toString(),"review.approved",id.toString()),AuditPeriod.parse("2026-11-03","2026-11-04",actor.toString(),"review.approved",id.toString()),AuditPeriod.parse("2026-11-03","2026-11-03","all","review.approved",id.toString()),AuditPeriod.parse("2026-11-03","2026-11-03",actor.toString(),"all",id.toString()),AuditPeriod.parse("2026-11-03","2026-11-03",actor.toString(),"review.approved","all")})assertThrows(IllegalArgumentException.class,()->AuditPeriodCursor.decode(token,user,changed));
  assertThrows(IllegalArgumentException.class,()->AuditPeriodCursor.decode(token,new DemoUser("foreign","unused",UUID.randomUUID(),project,actor,"viewer"),p));
  assertThrows(IllegalArgumentException.class,()->AuditPeriodCursor.decode(AuditSearchCursor.encode(b,p.filters()),user,p));
 }
 @Test void boundariesOutsideTheInclusiveUtcDayAreRejected(){
  var p=AuditPeriod.parse("2026-11-03","2026-11-03","all","all","all");
  for(String at:new String[]{"2026-11-02T23:59:59.999999Z","2026-11-04T00:00:00Z"})assertThrows(IllegalArgumentException.class,()->AuditPeriodCursor.decode(AuditPeriodCursor.encode(new AuditCursor(org,project,Instant.parse(at),id),p),user,p));
  var b=new AuditCursor(org,project,Instant.parse("2026-11-03T00:00:00Z"),id);assertEquals(b,AuditPeriodCursor.decode(AuditPeriodCursor.encode(b,p),user,p));
 }
}
