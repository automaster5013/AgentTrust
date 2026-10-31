package dev.agenttrust.core;

import jakarta.servlet.http.HttpSession;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.web.server.ResponseStatusException;

/** Bounded local application-session inventory; never an IdP/distributed-session claim. */
@Service
public class WorkspaceSessions {
 private record Tracked(UUID handle,UUID organization,UUID project,UUID actor,HttpSession session){}
 private final HashMap<UUID,Tracked> tracked=new HashMap<>();
 public record Entry(UUID handle,Instant createdAt,Instant lastAccessedAt,boolean current){}
 public record Page(UUID organizationId,UUID projectId,UUID actorId,List<Entry> entries,boolean truncated,String coverage,boolean deploymentAuthority){}
 private boolean owns(Tracked t,DemoUser u){return t.organization().equals(u.organizationId())&&t.project().equals(u.projectId())&&t.actor().equals(u.actorId());}
 private void prune(){tracked.entrySet().removeIf(entry->{try{
  var value=entry.getValue();value.session().getCreationTime();Object context=value.session().getAttribute("SPRING_SECURITY_CONTEXT");
  return !(context instanceof SecurityContext security)||security.getAuthentication()==null||!security.getAuthentication().isAuthenticated()||!(security.getAuthentication().getPrincipal() instanceof DemoUser user)||!owns(value,user);
 }catch(IllegalStateException expired){return true;}});}
 public synchronized void observe(DemoUser user,HttpSession session){
  if(user==null||session==null)return;prune();
  tracked.entrySet().removeIf(entry->entry.getValue().session()==session&&!owns(entry.getValue(),user));
  for(var value:tracked.values())if(value.session()==session&&owns(value,user))return;
  // Inventory pressure must not break authentication. Missing coverage is reported.
  if(tracked.size()>=1000)return;
  UUID handle=UUID.randomUUID();tracked.put(handle,new Tracked(handle,user.organizationId(),user.projectId(),user.actorId(),session));
 }
 public synchronized Page list(DemoUser user,HttpSession current){
  observe(user,current);prune();var rows=new ArrayList<Entry>();
  for(var value:tracked.values())if(owns(value,user)){
   try{rows.add(new Entry(value.handle(),Instant.ofEpochMilli(value.session().getCreationTime()),Instant.ofEpochMilli(value.session().getLastAccessedTime()),value.session()==current));}catch(IllegalStateException expired){/* omitted stale session */}
  }
  rows.sort(Comparator.comparing(Entry::createdAt).reversed().thenComparing(Entry::handle));
  return new Page(user.organizationId(),user.projectId(),user.actorId(),List.copyOf(rows.subList(0,Math.min(25,rows.size()))),rows.size()>25||tracked.size()>=1000,"current-core-instance-observed-app-sessions",false);
 }
 public synchronized Page revoke(DemoUser user,HttpSession current,UUID handle){
  prune();var value=tracked.get(handle);if(value==null||!owns(value,user))throw new ResponseStatusException(HttpStatus.NOT_FOUND);
  if(value.session()==current)throw new ResponseStatusException(HttpStatus.CONFLICT);
  try{value.session().invalidate();}catch(IllegalStateException expired){/* already ended */}tracked.remove(handle);return list(user,current);
 }
}
