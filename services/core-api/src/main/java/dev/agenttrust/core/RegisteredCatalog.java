package dev.agenttrust.core;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
/** A bounded, read-only index over existing project registries, not a release decision. */
@Service
public class RegisteredCatalog {
 private final VersionHistoryReader history;
 public RegisteredCatalog(VersionHistoryReader history){this.history=history;}
 public record Catalog(UUID organizationId,UUID projectId,String catalogKind,VersionHistoryReader.Page agents,VersionHistoryReader.Page datasets,boolean deploymentAuthority){}
 public Catalog read(DemoUser user){
  if(user==null)throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
  if(!List.of("admin","editor","viewer").contains(user.role()))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
  var agents=history.page(user,"agents",null);var datasets=history.page(user,"datasets",null);
  check(user,agents,"agents");check(user,datasets,"datasets");
  return new Catalog(user.organizationId(),user.projectId(),"registered-agent-dataset-versions-v1",agents,datasets,false);
 }
 private static void check(DemoUser user,VersionHistoryReader.Page page,String kind){
  if(page==null||!user.organizationId().equals(page.organizationId())||!user.projectId().equals(page.projectId())||!kind.equals(page.kind())||page.deploymentAuthority()||page.limit()!=25||!"created-at-id-desc".equals(page.ordering())||page.entries()==null||page.entries().size()>25)throw new IllegalStateException("Catalog scope unavailable");
 }
}
