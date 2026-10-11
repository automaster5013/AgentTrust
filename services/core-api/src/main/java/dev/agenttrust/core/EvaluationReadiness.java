package dev.agenttrust.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import okhttp3.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Read-only dependency observation; never a release permission or production certification. */
@Service
public class EvaluationReadiness {
 private final RunService runs; private final JdbcTemplate jdbc;
 private final PolicyClient policy; private final ObjectMapper mapper;
 private final OkHttpClient client=new OkHttpClient.Builder()
  .connectionPool(new ConnectionPool(2,4,java.util.concurrent.TimeUnit.SECONDS))
  .connectTimeout(Duration.ofSeconds(1)).readTimeout(Duration.ofSeconds(1))
  .callTimeout(Duration.ofSeconds(2)).followRedirects(false).followSslRedirects(false)
  .retryOnConnectionFailure(false).build();
 public EvaluationReadiness(RunService runs,JdbcTemplate jdbc,PolicyClient policy,ObjectMapper mapper){this.runs=runs;this.jdbc=jdbc;this.policy=policy;this.mapper=mapper;}
 public record Dependency(String name,boolean available){}
 public record Observation(String contract,UUID organizationId,UUID projectId,Instant checkedAt,
  boolean ready,List<Dependency> dependencies,boolean productionReady,boolean deploymentAuthority){}
 public Observation read(DemoUser user){
  boolean database=false,worker=false,opa=false;
  try{database=Boolean.TRUE.equals(runs.scoped(user,()->jdbc.queryForObject("""
   SELECT current_user='agenttrust_stack_api' AND NOT rolsuper AND NOT rolbypassrls
    AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication
    AND NOT pg_has_role(current_user,'agenttrust_stack','member')
    AND current_setting('agenttrust.organization_id')=?
    AND current_setting('agenttrust.project_id')=?
   FROM pg_roles WHERE rolname=current_user
   """,Boolean.class,user.organizationId().toString(),user.projectId().toString())));}catch(Exception ignored){}
  try{var request=new Request.Builder().url("http://stack-ai-worker:8000/ready").get().build();
   try(var response=client.newCall(request).execute()){
    if(response.code()==200&&response.body()!=null){
     byte[] bytes=response.body().byteStream().readNBytes(1025);
     if(bytes.length<=1024)worker=validWorker(mapper.readTree(bytes));
    }
   }
  }catch(Exception ignored){}
  try{var result=mapper.createObjectNode();var rule=result.putArray("rules").addObject();
   rule.put("id","readiness-probe");rule.put("required",true);rule.put("status","inconclusive");
   var gate=policy.decide(user,new UUID(0,0),Map.of("state","queued","decision","inconclusive","requires_approval",true,"result",result),null);
   opa=gate.policyStatus().equals("evaluated")&&gate.decision().equals("inconclusive")&&!gate.deploymentAllowed();
  }catch(Exception ignored){}
  return new Observation("agenttrust-evaluation-readiness-v1",user.organizationId(),user.projectId(),Instant.now(),
   database&&worker&&opa,List.of(new Dependency("database",database),new Dependency("worker-queue",worker),new Dependency("policy",opa)),false,false);
 }
 static boolean validWorker(com.fasterxml.jackson.databind.JsonNode value){
  if(!value.isObject()||value.size()!=5||!value.path("contract").asText().equals("agenttrust-worker-readiness-v1"))return false;
  for(String name:List.of("ready","fixedConsumerReady","referenceConsumerReady","queueReady"))
   if(!value.path(name).isBoolean()||!value.path(name).booleanValue())return false;
  return true;
 }
}
