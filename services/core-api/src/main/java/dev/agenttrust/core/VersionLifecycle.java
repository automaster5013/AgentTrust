package dev.agenttrust.core;

import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class VersionLifecycle {
    private final RunService runs;private final VersionRegistry versions;private final JdbcTemplate jdbc;
    public VersionLifecycle(RunService runs,VersionRegistry versions,JdbcTemplate jdbc){this.runs=runs;this.versions=versions;this.jdbc=jdbc;}
    private static String table(String kind){return switch(kind){case "agents"->"stack_agent_version_retirements";case "datasets"->"stack_dataset_version_retirements";default->throw new IllegalArgumentException("Invalid version kind");};}
    static String reason(String value){if(value==null||value.isBlank()||value.length()>500)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);return value.strip();}
    void lock(DemoUser user){jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"version-lifecycle/"+user.organizationId()+"/"+user.projectId());}
    public Map<String,Object> get(DemoUser user,String kind,UUID id){return runs.scoped(user,()->{
        var version=versions.get(user,kind,id);
        var rows=jdbc.queryForList("SELECT actor_id,reason,created_at FROM "+table(kind)+" WHERE version_id=? AND organization_id=? AND project_id=?",id,user.organizationId(),user.projectId());
        var value=new TreeMap<String,Object>();value.put("contract","version-lifecycle-v1");value.put("kind",kind);value.put("versionId",id);value.put("organizationId",user.organizationId());value.put("projectId",user.projectId());value.put("contentSha256",version.get("content_sha256"));value.put("state",rows.isEmpty()?"active":"retired");value.put("deploymentAuthority",false);
        if(!rows.isEmpty()){var row=rows.getFirst();value.put("retiredBy",row.get("actor_id"));value.put("reason",row.get("reason"));value.put("retiredAt",((java.sql.Timestamp)row.get("created_at")).toInstant().toString());}return value;
    });}
    public Map<String,Object> retire(DemoUser user,String kind,UUID id,String rawReason){
        if(!user.role().equals("admin"))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        String checked=reason(rawReason);
        return runs.scoped(user,()->{lock(user);var current=get(user,kind,id);
            if(current.get("state").equals("retired")){if(!checked.equals(current.get("reason")))throw new ResponseStatusException(HttpStatus.CONFLICT);return current;}
            jdbc.update("INSERT INTO "+table(kind)+"(version_id,organization_id,project_id,actor_id,reason,created_at) VALUES(?,?,?,?,?,clock_timestamp())",id,user.organizationId(),user.projectId(),user.actorId(),checked);
            runs.audit(user,"version."+kind+".retired",id);return get(user,kind,id);
        });
    }
    void requireActive(DemoUser user,String kind,UUID id){if(!get(user,kind,id).get("state").equals("active"))throw new ResponseStatusException(HttpStatus.CONFLICT,"Version retired");}
}
