package dev.agenttrust.core;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class SecurityConfigurationTest {
    @Test void credentialErasureCannotBreakTheNextLoginOrLoseTenantScope() throws Exception {
        Path root=Path.of("target").toAbsolutePath().normalize();Files.createDirectories(root);Path file=Files.createTempFile(root,"synthetic-auth-",".json");
        try {
            String id="11111111-1111-4111-8111-111111111111",password="0123456789abcdef0123456789abcdef0123456789abcdef";
            Files.writeString(file,"[{\"username\":\"demo-admin\",\"password\":\""+password+"\",\"role\":\"admin\",\"organizationId\":\""+id+"\",\"projectId\":\""+id+"\",\"actorId\":\""+id+"\"}]");
            var configuration=new SecurityConfiguration();var encoder=configuration.passwordEncoder();var service=configuration.users(file.toString(),new ObjectMapper(),encoder);
            var first=(DemoUser)service.loadUserByUsername("demo-admin");assertTrue(encoder.matches(password,first.getPassword()));first.eraseCredentials();assertNull(first.getPassword());
            var second=(DemoUser)service.loadUserByUsername("demo-admin");assertTrue(encoder.matches(password,second.getPassword()));assertEquals(first.organizationId(),second.organizationId());assertEquals("admin",second.role());assertNotSame(first,second);
        } finally {assertEquals(root,file.getParent());Files.deleteIfExists(file);}
    }
}
