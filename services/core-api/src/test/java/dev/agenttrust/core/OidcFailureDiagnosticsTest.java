package dev.agenttrust.core;
import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.net.SocketTimeoutException;
import javax.net.ssl.SSLHandshakeException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;

class OidcFailureDiagnosticsTest {
    @TempDir Path directory;
    OAuth2AuthenticationException error(String code) {
        return new OAuth2AuthenticationException(new OAuth2Error(code), "PRIVATE-CANARY");
    }
    @Test void distinguishesWorkspaceStateNonceAndTokenFailures() {
        assertEquals(OidcFailureDiagnostics.Category.WORKSPACE_IDENTITY, OidcFailureDiagnostics.category(error("invalid_workspace_identity")));
        assertEquals(OidcFailureDiagnostics.Category.AUTHORIZATION_REQUEST, OidcFailureDiagnostics.category(error("authorization_request_not_found")));
        assertEquals(OidcFailureDiagnostics.Category.STATE, OidcFailureDiagnostics.category(error("invalid_state_parameter")));
        assertEquals(OidcFailureDiagnostics.Category.NONCE, OidcFailureDiagnostics.category(error("invalid_nonce")));
        assertEquals(OidcFailureDiagnostics.Category.ID_TOKEN, OidcFailureDiagnostics.category(error("invalid_id_token")));
        assertEquals(OidcFailureDiagnostics.Category.TOKEN_RESPONSE, OidcFailureDiagnostics.category(error("invalid_token_response")));
    }
    @Test void nestedTlsAndTimeoutAreDistinguishedWithoutMessages() {
        assertEquals(OidcFailureDiagnostics.Category.TLS, OidcFailureDiagnostics.category(new RuntimeException("PRIVATE-CANARY", new SSLHandshakeException("PRIVATE-CANARY"))));
        assertEquals(OidcFailureDiagnostics.Category.TIMEOUT, OidcFailureDiagnostics.category(new RuntimeException("PRIVATE-CANARY", new SocketTimeoutException("PRIVATE-CANARY"))));
    }
    @Test void unknownPrivateErrorCodeIsNeverUsedAsCategory() {
        assertEquals(OidcFailureDiagnostics.Category.OAUTH2_OTHER, OidcFailureDiagnostics.category(error("PRIVATE-CANARY")));
    }
    @Test void fixedFileContentIsBoundedAndTruncated() throws Exception {
        Path target = directory.resolve("category");
        OidcFailureDiagnostics.writeCategory(target, OidcFailureDiagnostics.Category.AUTHORIZATION_REQUEST);
        OidcFailureDiagnostics.writeCategory(target, OidcFailureDiagnostics.Category.TLS);
        assertEquals("TLS", Files.readString(target));
        assertTrue(Files.size(target) < 64);
    }
}
