package dev.agenttrust.core;

import com.fasterxml.jackson.databind.*;
import java.nio.file.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Exact pgvector cosine search of immutable rule features, scoped by database RLS. */
@Service
public class SimilarEvidence {
 private final RunService runs;private final JdbcTemplate jdbc;private final ObjectMapper mapper;private final List<DemoUser> scopes;private final String token;
 private final BoundedJsonHttp http=new BoundedJsonHttp();
 public SimilarEvidence(RunService runs,JdbcTemplate jdbc,ObjectMapper mapper,@Value("${agenttrust.demo-credentials-file}") String file) throws Exception {
  this.runs=runs;this.jdbc=jdbc;this.mapper=mapper;token=Files.readString(Path.of("/run/secrets/stack-worker-token"));if(!token.matches("[a-f0-9]{64}"))throw new IllegalStateException("Feature configuration unavailable");
  var known=new HashSet<String>();var rows=new ArrayList<DemoUser>();for(var row:mapper.readTree(Files.readString(Path.of(file)))){UUID org=UUID.fromString(row.path("organizationId").asText()),project=UUID.fromString(row.path("projectId").asText());if(known.add(org+"/"+project))rows.add(new DemoUser("feature-indexer","unused",org,project,UUID.fromString(row.path("actorId").asText()),"viewer"));}scopes=List.copyOf(rows);
 }
 @Scheduled(fixedDelay=2000,initialDelay=4000)
 void indexPending(){for(var user:scopes){try{var rows=runs.scoped(user,()->jdbc.queryForList("SELECT c.run_id FROM stack_run_results c LEFT JOIN stack_rule_vectors v ON v.run_id=c.run_id WHERE c.organization_id=? AND c.project_id=? AND v.run_id IS NULL ORDER BY c.completed_at,c.run_id LIMIT 20",user.organizationId(),user.projectId()));for(var row:rows)index(user,(UUID)row.get("run_id"));}catch(Exception unavailable){/* Retry durable completions; never log signed requests or payloads. */}}}
 void index(DemoUser user,UUID id){runs.scoped(user,()->{jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"feature/"+id);if(jdbc.queryForObject("SELECT count(*) FROM stack_rule_vectors WHERE run_id=?",Integer.class,id)>0)return null;
  try{var record=runs.get(user,id);byte[] content=mapper.writeValueAsBytes(record.get("result"));String hash=ArchiveIntegrity.sha256(content);var body=Map.of("runId",id.toString(),"organizationId",user.organizationId().toString(),"projectId",user.projectId().toString(),"contentSha256",hash,"result",record.get("result"));byte[] input=mapper.writeValueAsBytes(body);if(input.length>4096)throw new IllegalArgumentException("Feature payload limit");
   byte[] raw=http.post("http://stack-ai-worker:8000/features","X-AgentTrust-Worker-Token",token,input,8192);String vector=RuleFeatures.vector(mapper.readTree(raw),id,user.organizationId(),user.projectId(),hash);jdbc.update("INSERT INTO stack_rule_vectors(run_id,organization_id,project_id,content_sha256,feature_version,embedding) VALUES(?,?,?,?,?,?::vector)",id,user.organizationId(),user.projectId(),hash,RuleFeatures.VERSION,vector);return null;
  }catch(Exception unavailable){if(unavailable instanceof InterruptedException)Thread.currentThread().interrupt();throw new IllegalStateException("Feature index unavailable");}
 });}
 public Map<String,Object> similar(DemoUser user,UUID id){return runs.scoped(user,()->{runs.get(user,id);var exists=jdbc.queryForObject("SELECT count(*) FROM stack_rule_vectors WHERE run_id=? AND feature_version=?",Integer.class,id,RuleFeatures.VERSION);if(exists==0)throw new ResponseStatusException(HttpStatus.CONFLICT);
  var rows=jdbc.queryForList("SELECT v.run_id,c.decision,c.state,r.scenario,1-(v.embedding <=> source.embedding) AS score FROM stack_rule_vectors v JOIN stack_rule_vectors source ON source.run_id=? JOIN stack_run_results c ON c.run_id=v.run_id JOIN stack_runs r ON r.id=v.run_id WHERE v.run_id<>source.run_id AND v.organization_id=? AND v.project_id=? AND v.feature_version=source.feature_version ORDER BY v.embedding <=> source.embedding,v.run_id LIMIT 5",id,user.organizationId(),user.projectId());
  var matches=new ArrayList<Map<String,Object>>();for(var row:rows){double score=((Number)row.get("score")).doubleValue();if(!Double.isFinite(score)||score< -0.000001||score>1.000001)throw new ResponseStatusException(HttpStatus.BAD_GATEWAY);matches.add(Map.of("runId",row.get("run_id"),"decision",row.get("decision"),"state",row.get("state"),"scenario",row.get("scenario"),"score",Math.max(0,Math.min(1,score))));}
  return Map.of("runId",id,"organizationId",user.organizationId(),"projectId",user.projectId(),"featureVersion",RuleFeatures.VERSION,"dimensions",64,"searchEngine","pgvector-cosine","matches",matches,"deploymentAuthority",false);
 });}
}
