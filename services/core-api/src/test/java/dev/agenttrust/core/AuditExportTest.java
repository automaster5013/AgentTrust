package dev.agenttrust.core;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class AuditExportTest {
 private final DemoUser user=new DemoUser("viewer","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
 private AuditReader.Entry row(int n){return new AuditReader.Entry(new UUID(-1,n),user.actorId(),"evaluation.completed",user.actorId(),Instant.parse("2026-10-12T00:00:00.123456Z"));}
 @Test void exactBoundaryDistinguishesEntireSnapshotFromTruncatedHistory(){
  var rows=new ArrayList<AuditReader.Entry>();for(int i=501;i>0;i--)rows.add(row(i));
  var truncated=AuditExport.document(user,rows);assertEquals(500,truncated.get("recordCount"));assertEquals(true,truncated.get("hasOlderRecords"));assertEquals(false,truncated.get("entireProjectHistory"));assertEquals(false,truncated.get("signed"));assertEquals(false,truncated.get("currentDeploymentAuthority"));
  assertEquals(row(501).id(),AuditCursor.decode((String)truncated.get("newestCursor"),user).id());assertEquals(row(2).id(),AuditCursor.decode((String)truncated.get("oldestCursor"),user).id());
  var exact=AuditExport.document(user,rows.subList(0,500));assertEquals(false,exact.get("hasOlderRecords"));assertEquals(true,exact.get("entireProjectHistory"));
  var empty=AuditExport.document(user,List.of());assertEquals(0,empty.get("recordCount"));assertNull(empty.get("oldestCursor"));assertNull(empty.get("newestCursor"));
 }
 @Test void malformedOrderDuplicateRowsUnsafeActionAndUnboundedSourceAreRejected(){
  assertThrows(IllegalArgumentException.class,()->AuditExport.document(user,List.of(row(1),row(2))));
  assertThrows(IllegalArgumentException.class,()->AuditExport.document(user,List.of(row(2),row(2))));
  var unsafe=new AuditReader.Entry(UUID.randomUUID(),user.actorId(),"<script>",user.actorId(),Instant.now());assertThrows(IllegalArgumentException.class,()->AuditExport.document(user,List.of(unsafe)));
  assertThrows(IllegalArgumentException.class,()->AuditExport.document(user,Collections.nCopies(502,row(1))));
 }
 @Test void byteHashAcceptsBoundedExportWithoutWeakeningSmallEvidenceContract(){
  assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",AuditExport.digest("abc".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  assertEquals(64,AuditExport.digest(new byte[AuditExport.MAX_BYTES]).length());assertThrows(IllegalArgumentException.class,()->AuditExport.digest(new byte[AuditExport.MAX_BYTES+1]));assertThrows(IllegalArgumentException.class,()->AuditExport.digest(new byte[0]));assertThrows(IllegalArgumentException.class,()->ArchiveIntegrity.sha256(new byte[16385]));
 }
}
