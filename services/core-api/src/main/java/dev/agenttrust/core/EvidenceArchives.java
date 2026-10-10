package dev.agenttrust.core;
import com.fasterxml.jackson.databind.*;
import java.nio.file.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
@Service
@ConditionalOnProperty(name="agenttrust.object-mode",havingValue="minio")
public class EvidenceArchives {
 private final RunService runs;private final JdbcTemplate jdbc;private final ObjectMapper mapper;private final MinioArchiveClient storage;private final List<DemoUser> scopes;
 public EvidenceArchives(RunService runs,JdbcTemplate jdbc,ObjectMapper mapper,MinioArchiveClient storage,@Value("${agenttrust.demo-credentials-file}") String file) throws Exception {
  this.runs=runs;this.jdbc=jdbc;this.mapper=mapper;this.storage=storage;var unique=new HashSet<String>();var values=new ArrayList<DemoUser>();for(var row:mapper.readTree(Files.readString(Path.of(file)))){UUID org=UUID.fromString(row.path("organizationId").asText()),project=UUID.fromString(row.path("projectId").asText());if(unique.add(org+"/"+project))values.add(new DemoUser("evidence-archiver","unused",org,project,UUID.fromString(row.path("actorId").asText()),"viewer"));}scopes=List.copyOf(values);
 }
 @Scheduled(fixedDelay=2000,initialDelay=3000)
 void archivePending(){for(var scope:scopes){try{var pending=runs.scoped(scope,()->jdbc.queryForList("SELECT c.run_id FROM stack_run_results c LEFT JOIN stack_evidence_archives a ON a.run_id=c.run_id WHERE c.organization_id=? AND c.project_id=? AND a.run_id IS NULL ORDER BY c.completed_at,c.run_id LIMIT 20",scope.organizationId(),scope.projectId()));for(var row:pending)archive(scope,(UUID)row.get("run_id"));}catch(Exception unavailable){/* Persistent completions remain eligible; never log payloads, credentials or signed requests. */}}}
 void archive(DemoUser user,UUID id){runs.scoped(user,()->{jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"archive/"+id);if(!metadata(user,id).isEmpty())return null;var run=runs.get(user,id);if(run.get("state").equals("queued"))return null;
  try{var document=new TreeMap<String,Object>();document.put("schemaVersion",1);document.put("runId",id.toString());document.put("organizationId",user.organizationId().toString());document.put("projectId",user.projectId().toString());document.put("scenario",run.get("scenario"));document.put("result",run.get("result"));byte[] content=mapper.writeValueAsBytes(document);String hash=ArchiveIntegrity.sha256(content),key=ArchiveIntegrity.key(user.organizationId(),user.projectId(),id,hash),version=storage.persist(key,content);jdbc.update("INSERT INTO stack_evidence_archives(run_id,organization_id,project_id,content_sha256,object_key,version_id,content_bytes) VALUES(?,?,?,?,?,?,?)",id,user.organizationId(),user.projectId(),hash,key,version,content.length);return null;}catch(Exception error){throw new IllegalStateException("Evidence archive unavailable");}
 });}
 private List<Map<String,Object>> metadata(DemoUser user,UUID id){return jdbc.queryForList("SELECT run_id,organization_id,project_id,content_sha256,object_key,version_id,content_bytes FROM stack_evidence_archives WHERE run_id=? AND organization_id=? AND project_id=?",id,user.organizationId(),user.projectId());}
 public Map<String,Object> evidence(DemoUser user,UUID id){var descriptor=runs.scoped(user,()->{runs.get(user,id);var rows=metadata(user,id);if(rows.isEmpty())throw new ResponseStatusException(HttpStatus.CONFLICT);return rows.getFirst();});
  String hash=(String)descriptor.get("content_sha256"),key=(String)descriptor.get("object_key"),version=(String)descriptor.get("version_id");if(!key.equals(ArchiveIntegrity.key(user.organizationId(),user.projectId(),id,hash)))throw new ResponseStatusException(HttpStatus.BAD_GATEWAY);
  try{var stored=storage.read(key,version);ArchiveIntegrity.verify(stored.content(),hash,(Integer)descriptor.get("content_bytes"));JsonNode document=mapper.readTree(stored.content());if(!document.path("runId").asText().equals(id.toString())||!document.path("organizationId").asText().equals(user.organizationId().toString())||!document.path("projectId").asText().equals(user.projectId().toString())||document.path("schemaVersion").asInt()!=1)throw new IllegalArgumentException("Evidence scope mismatch");return Map.of("runId",id,"organizationId",user.organizationId(),"projectId",user.projectId(),"contentSha256",hash,"contentBytes",stored.content().length,"storageVersion",version,"integrityVerified",true,"storageEngine","minio","document",document,"contentBase64",Base64.getEncoder().encodeToString(stored.content()));}catch(IllegalArgumentException invalid){throw new ResponseStatusException(HttpStatus.BAD_GATEWAY);}catch(Exception unavailable){throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);}
 }
}
