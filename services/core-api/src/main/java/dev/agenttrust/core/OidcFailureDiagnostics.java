package dev.agenttrust.core;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.net.SocketTimeoutException;
import java.net.http.HttpTimeoutException;
import javax.net.ssl.SSLException;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;

/** Opt-in owned-fixture classification only: never records messages, URLs, claims or credentials. */
final class OidcFailureDiagnostics {
    static final Path FIXTURE_PATH = Path.of("/tmp/agenttrust-oidc-failure-category");
    enum Category { TLS, TIMEOUT, TRANSPORT, WORKSPACE_IDENTITY, AUTHORIZATION_REQUEST,
        STATE, NONCE, ID_TOKEN, USERINFO, TOKEN_RESPONSE, OAUTH2_OTHER, OTHER }
    private OidcFailureDiagnostics() {}

    static Category category(Throwable failure) {
        Category result = Category.OTHER;
        for (int depth = 0; failure != null && depth < 16; depth++, failure = failure.getCause()) {
            if (failure instanceof SSLException) return Category.TLS;
            if (failure instanceof SocketTimeoutException || failure instanceof HttpTimeoutException) return Category.TIMEOUT;
            if (failure instanceof OAuth2AuthenticationException oauth) {
                result = switch (oauth.getError().getErrorCode()) {
                    case "invalid_workspace_identity" -> Category.WORKSPACE_IDENTITY;
                    case "authorization_request_not_found" -> Category.AUTHORIZATION_REQUEST;
                    case "invalid_state_parameter" -> Category.STATE;
                    case "invalid_nonce" -> Category.NONCE;
                    case "invalid_id_token" -> Category.ID_TOKEN;
                    case "invalid_user_info_response", "missing_user_info_uri" -> Category.USERINFO;
                    case "invalid_token_response", "invalid_grant" -> Category.TOKEN_RESPONSE;
                    default -> Category.OAUTH2_OTHER;
                };
            } else if (failure instanceof IOException) result = Category.TRANSPORT;
        }
        return result;
    }

    static void writeCategory(Path path, Category category) throws IOException {
        Files.writeString(path, category.name(), StandardCharsets.US_ASCII,
            StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS);
    }

    static void record(Throwable failure) {
        if (!"true".equals(System.getenv("AGENTTRUST_FIXTURE_OIDC_FAILURE_DIAGNOSTICS"))) return;
        try { writeCategory(FIXTURE_PATH, category(failure)); }
        catch (IOException ignored) { /* Diagnostic availability must not alter authentication behavior. */ }
    }
}
