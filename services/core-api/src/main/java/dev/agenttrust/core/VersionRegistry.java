package dev.agenttrust.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class VersionRegistry {
    private final RunService runs;private final JdbcTemplate jdbc;private final ObjectMapper mapper;
    public VersionRegistry(RunService runs,JdbcTemplate jdbc,ObjectMapper mapper){this.runs=runs;this.jdbc=jdbc;this.mapper=mapper;}
    private static String table(String kind){return switch(kind){case "agents"->"stack_agent_versions";case "datasets"->"stack_dataset_versions";default->throw new IllegalArgumentException("Invalid registry kind");};}
    public List<Map<String,Object>> list(DemoUser user,String kind){return runs.scoped(user,()->jdbc.queryForList("SELECT id,resource_key,version,content_sha256,created_at FROM "+table(kind)+" WHERE organization_id=? AND project_id=? ORDER BY created_at DESC,id DESC LIMIT 50",user.organizationId(),user.projectId()));}
    public Map<String,Object> get(DemoUser user,String kind,UUID id){return runs.scoped(user,()->{
        var rows=jdbc.queryForList("SELECT id,organization_id,project_id,resource_key,version,content_sha256,content_json,created_at FROM "+table(kind)+" WHERE id=? AND organization_id=? AND project_id=?",id,user.organizationId(),user.projectId());
        if(rows.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        var row=rows.getFirst();String content=(String)row.remove("content_json");
        if(!ArchiveIntegrity.sha256(content.getBytes(java.nio.charset.StandardCharsets.UTF_8)).equals(row.get("content_sha256")))throw new IllegalStateException("Version integrity unavailable");
        try{row.put("definition",mapper.readTree(content));}catch(Exception error){throw new IllegalStateException("Version content unavailable");}return row;
    });}
    public Map<String,Object> register(DemoUser user,String kind,String key,Integer version,String content){
        if(!List.of("admin","editor").contains(user.role()))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        VersionDefinition.coordinate(key,version);String hash=ArchiveIntegrity.sha256(content.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return runs.scoped(user,()->{
            jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"registry/"+kind+"/"+user.organizationId()+"/"+user.projectId());
            var existing=jdbc.queryForList("SELECT id,content_sha256 FROM "+table(kind)+" WHERE organization_id=? AND project_id=? AND resource_key=? AND version=?",user.organizationId(),user.projectId(),key,version);
            if(!existing.isEmpty()){if(!hash.equals(existing.getFirst().get("content_sha256")))throw new ResponseStatusException(HttpStatus.CONFLICT);return get(user,kind,(UUID)existing.getFirst().get("id"));}
            if(jdbc.queryForObject("SELECT count(*) FROM "+table(kind)+" WHERE organization_id=? AND project_id=?",Integer.class,user.organizationId(),user.projectId())>=200)throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS);
            UUID id=UUID.randomUUID();jdbc.update("INSERT INTO "+table(kind)+" (id,organization_id,project_id,actor_id,resource_key,version,content_json,content_sha256) VALUES(?,?,?,?,?,?,?,?)",id,user.organizationId(),user.projectId(),user.actorId(),key,version,content,hash);
            runs.audit(user,"version."+kind+".registered",id);return get(user,kind,id);
        });
    }
}
