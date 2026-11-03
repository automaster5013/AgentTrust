package dev.agenttrust.core;
import java.time.Instant;import java.util.*;import org.junit.jupiter.api.Test;import static org.junit.jupiter.api.Assertions.*;
class AuditPeriodExportTest {
 private final DemoUser user=new DemoUser("viewer","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
 private final AuditPeriod period=AuditPeriod.parse("2026-11-03","2026-11-03",user.actorId().toString(),"review.approved","all");
 private AuditReader.Entry row(int id){return new AuditReader.Entry(new UUID(-1,id),user.actorId(),"review.approved",user.actorId(),Instant.parse("2026-11-03T23:59:59.999999Z"));}
 @Test void boundedChunksContinueBeyondFirstFileWithoutClaimingGlobalSnapshot(){
  var rows=new ArrayList<AuditReader.Entry>();for(int i=251;i>0;i--)rows.add(row(i));var first=AuditPeriodExport.document(user,period,null,rows);
  assertEquals(250,first.get("recordCount"));assertEquals(true,first.get("hasOlderRecords"));assertEquals(false,first.get("rangeExhausted"));assertEquals(false,first.get("entirePeriodHistory"));assertEquals(false,first.get("entireProjectHistory"));assertEquals(true,first.get("singleStatementSnapshot"));assertEquals(false,first.get("signed"));assertEquals(false,first.get("currentDeploymentAuthority"));assertEquals(first.get("oldestCursor"),first.get("nextCursor"));
  String cursor=(String)first.get("nextCursor");assertEquals(row(2).id(),AuditPeriodCursor.decode(cursor,user,period).id());var last=AuditPeriodExport.document(user,period,cursor,List.of(row(1)));assertEquals(cursor,last.get("requestedCursor"));assertEquals(false,last.get("isFirstChunk"));assertEquals(true,last.get("rangeExhausted"));assertEquals(false,last.get("entirePeriodHistory"));assertNull(last.get("nextCursor"));
  var empty=AuditPeriodExport.document(user,period,null,List.of());assertEquals(true,empty.get("entirePeriodHistory"));assertNull(empty.get("newestCursor"));
 }
 @Test void malformedOrderDatesActorAndRepeatedBoundaryAreRefused(){
  assertThrows(IllegalArgumentException.class,()->AuditPeriodExport.document(user,period,null,List.of(row(1),row(2))));assertThrows(IllegalArgumentException.class,()->AuditPeriodExport.document(user,period,null,List.of(row(2),row(2))));
  var foreign=new AuditReader.Entry(UUID.randomUUID(),UUID.randomUUID(),"review.approved",user.actorId(),row(1).createdAt());assertThrows(IllegalArgumentException.class,()->AuditPeriodExport.document(user,period,null,List.of(foreign)));
  var outside=new AuditReader.Entry(UUID.randomUUID(),user.actorId(),"review.approved",user.actorId(),Instant.parse("2026-11-04T00:00:00Z"));assertThrows(IllegalArgumentException.class,()->AuditPeriodExport.document(user,period,null,List.of(outside)));
  String cursor=AuditPeriodCursor.encode(new AuditCursor(user.organizationId(),user.projectId(),row(2).createdAt(),row(2).id()),period);assertThrows(IllegalArgumentException.class,()->AuditPeriodExport.document(user,period,cursor,List.of(row(2))));assertThrows(IllegalArgumentException.class,()->AuditPeriodExport.document(user,period,null,Collections.nCopies(252,row(1))));
 }
}
