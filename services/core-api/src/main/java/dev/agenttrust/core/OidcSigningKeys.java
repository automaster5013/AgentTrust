package dev.agenttrust.core;

import java.time.Duration;
import org.springframework.security.oauth2.client.oidc.authentication.OidcIdTokenDecoderFactory;
import org.springframework.security.oauth2.client.oidc.authentication.OidcIdTokenValidator;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.web.client.RestTemplate;

/** RS256 identity-token verification with bounded, non-redirecting key retrieval. */
final class OidcSigningKeys {
    private OidcSigningKeys() {}
    static JwtDecoder decoder(ClientRegistration registration, Duration readTimeout) {
        var decoder = NimbusJwtDecoder.withJwkSetUri(registration.getProviderDetails().getJwkSetUri())
            .jwsAlgorithm(SignatureAlgorithm.RS256)
            .restOperations(new RestTemplate(OidcHttpTransport.factory(readTimeout))).build();
        decoder.setJwtValidator(JwtValidators.createDefaultWithValidators(new OidcIdTokenValidator(registration)));
        decoder.setClaimSetConverter(OidcIdTokenDecoderFactory.createDefaultClaimTypeConverter());
        return decoder;
    }
}
