package dev.agenttrust.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** One bounded database statement; metadata export, never a signature or deployment authority. */
@Service
public class AuditExport {
    static final int LIMIT=500,MAX_BYTES=262144;
    private final RunService runs;private final JdbcTemplate jdbc;private final ObjectMapper mapper;
    public AuditExport(RunService runs,JdbcTemplate jdbc,ObjectMapper mapper){this.runs=runs;this.jdbc=jdbc;this.mapper=mapper;}
    static Map<String,Object> document(DemoUser user,List<AuditReader.Entry> rows){
        if(rows.size()>LIMIT+1)throw new IllegalArgumentException("Audit export exceeds limit");
        var entries=List.copyOf(rows.subList(0,Math.min(rows.size(),LIMIT)));boolean more=rows.size()>LIMIT;
        var seen=new HashSet<UUID>();
        for(int i=0;i<entries.size();i++){
            var row=entries.get(i);if(row.id()==null||row.actorId()==null||row.resourceId()==null||row.createdAt()==null||row.createdAt().isBefore(Instant.EPOCH)||row.createdAt().getNano()%1000!=0||row.action()==null||!row.action().matches("[a-z][a-z0-9.-]{0,59}"))throw new IllegalArgumentException("Invalid audit metadata");
            if(!seen.add(row.id())||row.createdAt().getEpochSecond()>253402300799L)throw new IllegalArgumentException("Invalid audit metadata");
            if(i>0){var previous=entries.get(i-1);int time=row.createdAt().compareTo(previous.createdAt());if(time>0||time==0&&row.id().toString().compareTo(previous.id().toString())>=0)throw new IllegalArgumentException("Invalid audit order");}
        }
        var doc=new TreeMap<String,Object>();doc.put("schemaVersion",1);doc.put("kind","project-audit-export");doc.put("organizationId",user.organizationId());doc.put("projectId",user.projectId());doc.put("ordering","created-at-id-desc");doc.put("limit",LIMIT);doc.put("entries",entries);doc.put("recordCount",entries.size());doc.put("hasOlderRecords",more);doc.put("entireProjectHistory",!more);doc.put("currentDeploymentAuthority",false);doc.put("signed",false);
        doc.put("newestCursor",entries.isEmpty()?null:new AuditCursor(user.organizationId(),user.projectId(),entries.getFirst().createdAt(),entries.getFirst().id()).encode());
        doc.put("oldestCursor",entries.isEmpty()?null:new AuditCursor(user.organizationId(),user.projectId(),entries.getLast().createdAt(),entries.getLast().id()).encode());return doc;
    }
    static String digest(byte[] bytes){if(bytes.length<1||bytes.length>MAX_BYTES)throw new IllegalArgumentException("Audit export byte limit");try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}catch(java.security.NoSuchAlgorithmException error){throw new IllegalStateException("Digest unavailable");}}
    public Map<String,Object> export(DemoUser user){return runs.scoped(user,()->{
        var rows=jdbc.query("SELECT id,actor_id,action,resource_id,created_at FROM stack_audit WHERE organization_id=? AND project_id=? ORDER BY created_at DESC,id DESC LIMIT 501",(row,index)->new AuditReader.Entry(row.getObject("id",UUID.class),row.getObject("actor_id",UUID.class),row.getString("action"),row.getObject("resource_id",UUID.class),row.getTimestamp("created_at").toInstant()),user.organizationId(),user.projectId());
        try{byte[] bytes=mapper.writeValueAsBytes(document(user,rows));String text=new String(bytes,StandardCharsets.UTF_8);return Map.of("contentJson",text,"contentSha256",digest(bytes),"contentBytes",bytes.length,"organizationId",user.organizationId(),"projectId",user.projectId(),"signed",false,"currentDeploymentAuthority",false);}
        catch(Exception invalid){throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);}
    });}
}
