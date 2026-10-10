package dev.agenttrust.core;
import org.junit.jupiter.api.Test;
import java.util.UUID;
import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.*;
class ArchiveIntegrityTest {
 @Test void changedOrOversizedEvidenceNeverVerifies(){byte[] original="synthetic evidence".getBytes(StandardCharsets.UTF_8);String hash=ArchiveIntegrity.sha256(original);ArchiveIntegrity.verify(original,hash,original.length);assertThrows(IllegalArgumentException.class,()->ArchiveIntegrity.verify("corrupt".getBytes(),hash,original.length));assertThrows(IllegalArgumentException.class,()->ArchiveIntegrity.sha256(new byte[16385]));assertThrows(IllegalArgumentException.class,()->ArchiveIntegrity.verify(original,hash,original.length+1));}
 @Test void keysBindScopeRunAndHashAndRequireAStoredVersion(){UUID org=UUID.randomUUID(),project=UUID.randomUUID(),run=UUID.randomUUID();String hash="a".repeat(64);assertEquals("organizations/"+org+"/projects/"+project+"/runs/"+run+"/"+hash+".json",ArchiveIntegrity.key(org,project,run,hash));assertThrows(IllegalArgumentException.class,()->ArchiveIntegrity.key(org,project,run,"../../secret"));assertThrows(IllegalArgumentException.class,()->ArchiveIntegrity.version("null"));assertThrows(IllegalArgumentException.class,()->ArchiveIntegrity.version(""));}
}
