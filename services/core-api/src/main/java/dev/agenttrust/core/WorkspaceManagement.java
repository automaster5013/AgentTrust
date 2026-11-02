package dev.agenttrust.core;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Current authenticated project only. No membership provisioning or legacy key reuse. */
@Service
public class WorkspaceManagement {
 static final String KEY_SCOPE="project-metadata-read";
 private final RunService runs;private final JdbcTemplate jdbc;
 public WorkspaceManagement(RunService runs,JdbcTemplate jdbc){this.runs=runs;this.jdbc=jdbc;}
 public record Project(UUID organizationId,UUID projectId,long revision,String name,String description,Instant updatedAt,boolean deploymentAuthority){}
 public record Key(UUID id,String name,Instant createdAt,Instant expiresAt,boolean revoked,String scope){}
 public record Keys(UUID organizationId,UUID projectId,List<Key> entries,boolean truncated,int limit,boolean deploymentAuthority){}
 public record Issued(UUID organizationId,UUID projectId,Key key,String token,boolean deploymentAuthority){@Override public String toString(){return "Issued[secret-redacted]";}}
 static void admin(DemoUser user){if(user==null||!user.role().equals("admin"))throw new ResponseStatusException(HttpStatus.FORBIDDEN);}
 static String text(String value,int limit,boolean empty){if(value==null||value.length()>limit||(!empty&&value.isBlank())||value.chars().anyMatch(c->Character.isISOControl(c)&&(!empty||c!='\n')))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);return value.strip();}
 public Project project(DemoUser user){return runs.scoped(user,()->projectScoped(user));}
 private Project projectScoped(DemoUser user){
  var rows=jdbc.query("SELECT revision,name,description,created_at FROM stack_project_settings WHERE organization_id=? AND project_id=? ORDER BY revision DESC LIMIT 1",(r,n)->new Project(user.organizationId(),user.projectId(),r.getLong("revision"),r.getString("name"),r.getString("description"),r.getTimestamp("created_at").toInstant(),false),user.organizationId(),user.projectId());
  return rows.isEmpty()?new Project(user.organizationId(),user.projectId(),0,"현재 프로젝트","",null,false):rows.getFirst();
 }
 private void lock(DemoUser user){jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"workspace/"+user.organizationId()+"/"+user.projectId());}
 public Project update(DemoUser user,long expected,String name,String description){
  admin(user);String label=text(name,80,false),notes=text(description,500,true);if(expected<0||expected>=1000000000)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
  return runs.scoped(user,()->{lock(user);var before=projectScoped(user);if(before.revision()!=expected)throw new ResponseStatusException(HttpStatus.CONFLICT);
   jdbc.update("INSERT INTO stack_project_settings(organization_id,project_id,revision,actor_id,name,description) VALUES(?,?,?,?,?,?)",user.organizationId(),user.projectId(),expected+1,user.actorId(),label,notes);runs.audit(user,"workspace.project.updated",user.projectId());return projectScoped(user);});
 }
 public Keys keys(DemoUser user){admin(user);return runs.scoped(user,()->{
  var rows=jdbc.query("SELECT k.id,k.name,k.created_at,k.expires_at,(r.key_id IS NOT NULL) revoked FROM stack_access_keys k LEFT JOIN stack_access_key_revocations r ON r.key_id=k.id AND r.organization_id=k.organization_id AND r.project_id=k.project_id WHERE k.organization_id=? AND k.project_id=? ORDER BY k.created_at DESC,k.id DESC LIMIT 26",(r,n)->new Key(r.getObject("id",UUID.class),r.getString("name"),r.getTimestamp("created_at").toInstant(),r.getTimestamp("expires_at").toInstant(),r.getBoolean("revoked"),KEY_SCOPE),user.organizationId(),user.projectId());
  return new Keys(user.organizationId(),user.projectId(),List.copyOf(rows.subList(0,Math.min(25,rows.size()))),rows.size()>25,25,false);});}
 static String hash(String value){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.US_ASCII)));}catch(Exception error){throw new IllegalStateException("Key unavailable");}}
 public Issued issue(DemoUser user,UUID id,String name,int days){
  admin(user);String label=text(name,80,false);if(id==null||days<1||days>30)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
  return runs.scoped(user,()->{lock(user);
   int duplicate=jdbc.queryForObject("SELECT count(*) FROM stack_access_keys WHERE id=?",Integer.class,id);if(duplicate!=0)throw new ResponseStatusException(HttpStatus.CONFLICT);
   int active=jdbc.queryForObject("SELECT count(*) FROM stack_access_keys k WHERE organization_id=? AND project_id=? AND expires_at>now() AND NOT EXISTS(SELECT 1 FROM stack_access_key_revocations r WHERE r.key_id=k.id)",Integer.class,user.organizationId(),user.projectId());if(active>=10)throw new ResponseStatusException(HttpStatus.CONFLICT);
   byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);String secret=HexFormat.of().formatHex(bytes);Instant now=jdbc.queryForObject("SELECT now()",Timestamp.class).toInstant(),expires=now.plus(days,ChronoUnit.DAYS);
   jdbc.update("INSERT INTO stack_access_keys(id,organization_id,project_id,actor_id,name,secret_hash,expires_at) VALUES(?,?,?,?,?,?,?)",id,user.organizationId(),user.projectId(),user.actorId(),label,hash(secret),Timestamp.from(expires));runs.audit(user,"access-key.created",id);
   return new Issued(user.organizationId(),user.projectId(),new Key(id,label,now,expires,false,KEY_SCOPE),"at1."+user.organizationId()+"."+user.projectId()+"."+id+"."+secret,false);});
 }
 public Keys revoke(DemoUser user,UUID id){admin(user);return runs.scoped(user,()->{lock(user);
  int found=jdbc.queryForObject("SELECT count(*) FROM stack_access_keys WHERE id=? AND organization_id=? AND project_id=?",Integer.class,id,user.organizationId(),user.projectId());if(found!=1)throw new ResponseStatusException(HttpStatus.NOT_FOUND);
  int changed=jdbc.update("INSERT INTO stack_access_key_revocations(key_id,organization_id,project_id,actor_id) VALUES(?,?,?,?) ON CONFLICT(key_id) DO NOTHING",id,user.organizationId(),user.projectId(),user.actorId());if(changed>0)runs.audit(user,"access-key.revoked",id);return keys(user);});}
 record Token(UUID organization,UUID project,UUID id,String secret){@Override public String toString(){return "Token[secret-redacted]";}}
 static Token token(String header){try{
  if(header==null||header.length()>240||!header.startsWith("Bearer at1."))throw new IllegalArgumentException();String[] parts=header.substring(7).split("\\.",-1);
  if(parts.length!=5||!parts[0].equals("at1")||!parts[4].matches("[a-f0-9]{64}"))throw new IllegalArgumentException();
  for(int i=1;i<=3;i++)if(!UUID.fromString(parts[i]).toString().equals(parts[i]))throw new IllegalArgumentException();
  return new Token(UUID.fromString(parts[1]),UUID.fromString(parts[2]),UUID.fromString(parts[3]),parts[4]);
 }catch(IllegalArgumentException error){throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);}}
 public Project projectWithKey(String header){
  Token key=token(header);DemoUser scope=new DemoUser("scoped-api-key","unused",key.organization(),key.project(),key.id(),"viewer");
  return runs.scoped(scope,()->{
   var hashes=jdbc.query("SELECT k.secret_hash FROM stack_access_keys k WHERE k.id=? AND k.organization_id=? AND k.project_id=? AND k.expires_at>now() AND NOT EXISTS(SELECT 1 FROM stack_access_key_revocations r WHERE r.key_id=k.id)",(r,n)->r.getString(1),key.id(),key.organization(),key.project());
   if(hashes.size()!=1||!MessageDigest.isEqual(hash(key.secret()).getBytes(StandardCharsets.US_ASCII),hashes.getFirst().getBytes(StandardCharsets.US_ASCII)))throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
   return projectScoped(scope);
  });
 }
}
