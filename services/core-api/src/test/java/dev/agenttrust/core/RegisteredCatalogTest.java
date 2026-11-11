package dev.agenttrust.core;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class RegisteredCatalogTest {
 final VersionHistoryReader history=mock(VersionHistoryReader.class);
 final RegisteredCatalog catalog=new RegisteredCatalog(history);
 final DemoUser user=new DemoUser("fixture","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
 VersionHistoryReader.Page page(String kind){return new VersionHistoryReader.Page(user.organizationId(),user.projectId(),kind,List.of(new VersionHistoryReader.Entry(UUID.randomUUID(),"fixture-version",1,"a".repeat(64),Instant.parse("2026-11-12T00:00:00Z"))),null,25,"created-at-id-desc",false);}
 @Test void viewerReadsBothScopedRegistriesWithoutAnyWriteOrReleaseAuthority(){
  var agents=page("agents");var datasets=page("datasets");when(history.page(user,"agents",null)).thenReturn(agents);when(history.page(user,"datasets",null)).thenReturn(datasets);
  var value=catalog.read(user);assertEquals(agents,value.agents());assertEquals(datasets,value.datasets());assertEquals(user.projectId(),value.projectId());assertFalse(value.deploymentAuthority());verify(history).page(user,"agents",null);verify(history).page(user,"datasets",null);verifyNoMoreInteractions(history);
 }
 @Test void anonymousCannotReadEitherRegistry(){assertEquals(401,assertThrows(ResponseStatusException.class,()->catalog.read(null)).getStatusCode().value());verifyNoInteractions(history);}
 @Test void aForeignOrSwappedPageCannotBecomeAnEmptyOrTrustedCatalog(){
  var page=page("agents");when(history.page(user,"agents",null)).thenReturn(new VersionHistoryReader.Page(user.organizationId(),UUID.randomUUID(),"agents",page.entries(),null,25,"created-at-id-desc",false));when(history.page(user,"datasets",null)).thenReturn(page("datasets"));assertThrows(IllegalStateException.class,()->catalog.read(user));
  when(history.page(user,"agents",null)).thenReturn(page("datasets"));assertThrows(IllegalStateException.class,()->catalog.read(user));
 }
 @Test void aFailedRegistryDoesNotProducePartialSuccess(){when(history.page(user,"agents",null)).thenReturn(page("agents"));when(history.page(user,"datasets",null)).thenThrow(new IllegalStateException("Unavailable"));assertThrows(IllegalStateException.class,()->catalog.read(user));}
}
