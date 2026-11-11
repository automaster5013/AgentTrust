package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
class DatasetCopyRegistrationTest {
 final RunService runs=mock(RunService.class);final JdbcTemplate jdbc=mock(JdbcTemplate.class);final ObjectMapper mapper=new ObjectMapper();final VersionRegistry registry=new VersionRegistry(runs,jdbc,mapper);
 final DemoUser writer=new DemoUser("fixture","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"editor");
 final String content=VersionDefinition.dataset(mapper,List.of(new VersionDefinition.Case("required","pass",true)));
 void scoped(){when(runs.scoped(eq(writer),any())).thenAnswer(call->((Supplier<?>)call.getArgument(1)).get());}
 @Test void readerCannotRegisterCopiedContent(){var viewer=new DemoUser("fixture","unused",writer.organizationId(),writer.projectId(),writer.actorId(),"viewer");assertEquals(403,assertThrows(ResponseStatusException.class,()->registry.register(viewer,"datasets","copy-fixture",1,content)).getStatusCode().value());verifyNoInteractions(jdbc,runs);}
 @Test void conflictingCoordinateCannotOverwriteExistingDataset(){scoped();when(jdbc.queryForList(startsWith("SELECT id,content_sha256"),eq(writer.organizationId()),eq(writer.projectId()),eq("copy-fixture"),eq(1))).thenReturn(List.of(Map.of("id",UUID.randomUUID(),"content_sha256","b".repeat(64))));assertEquals(409,assertThrows(ResponseStatusException.class,()->registry.register(writer,"datasets","copy-fixture",1,content)).getStatusCode().value());verify(jdbc,never()).update(anyString(),any(Object[].class));}
 @Test void newCoordinateCreatesAnInsertAndBindsReadbackToNewId(){
  scoped();when(jdbc.queryForObject(startsWith("SELECT count(*)"),eq(Integer.class),eq(writer.organizationId()),eq(writer.projectId()))).thenReturn(1);
  when(jdbc.queryForList(startsWith("SELECT id,organization_id"),any(UUID.class),eq(writer.organizationId()),eq(writer.projectId()))).thenAnswer(call->{UUID newId=call.getArgument(1);return List.of(new HashMap<>(Map.of("id",newId,"organization_id",writer.organizationId(),"project_id",writer.projectId(),"resource_key","copy-fixture","version",1,"content_sha256",ArchiveIntegrity.sha256(content.getBytes(java.nio.charset.StandardCharsets.UTF_8)),"content_json",content,"created_at",Timestamp.from(Instant.now()))));});
  var created=registry.register(writer,"datasets","copy-fixture",1,content);assertEquals("copy-fixture",created.get("resource_key"));assertNotNull(created.get("definition"));verify(jdbc).update(startsWith("INSERT INTO stack_dataset_versions"),eq(created.get("id")),eq(writer.organizationId()),eq(writer.projectId()),eq(writer.actorId()),eq("copy-fixture"),eq(1),eq(content),eq(created.get("content_sha256")));verify(runs).audit(writer,"version.datasets.registered",(UUID)created.get("id"));
 }
}
