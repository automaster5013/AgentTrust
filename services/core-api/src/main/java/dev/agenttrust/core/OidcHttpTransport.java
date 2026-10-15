package dev.agenttrust.core;

import java.time.Duration;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.converter.FormHttpMessageConverter;
import org.springframework.security.oauth2.client.endpoint.RestClientAuthorizationCodeTokenResponseClient;
import org.springframework.security.oauth2.client.http.OAuth2ErrorResponseErrorHandler;
import org.springframework.security.oauth2.client.userinfo.DefaultOAuth2UserService;
import org.springframework.security.oauth2.core.http.converter.OAuth2AccessTokenResponseHttpMessageConverter;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestTemplate;

/** Total call and byte bounds with standard TLS verification and no credential-bearing redirects. */
final class OidcHttpTransport {
    private OidcHttpTransport() {}
    static ClientHttpRequestFactory factory(Duration readTimeout) {
        return new OidcHttpRequestFactory(readTimeout);
    }
    static RestClientAuthorizationCodeTokenResponseClient tokens(Duration readTimeout) {
        var rest=RestClient.builder().requestFactory(factory(readTimeout)).messageConverters(converters->{converters.clear();converters.add(new FormHttpMessageConverter());converters.add(new OAuth2AccessTokenResponseHttpMessageConverter());}).defaultStatusHandler(new OAuth2ErrorResponseErrorHandler()).build();
        var client=new RestClientAuthorizationCodeTokenResponseClient();client.setRestClient(rest);return client;
    }
    static DefaultOAuth2UserService users(Duration readTimeout) {
        var rest=new RestTemplate(factory(readTimeout));rest.setErrorHandler(new OAuth2ErrorResponseErrorHandler());
        var client=new DefaultOAuth2UserService();client.setRestOperations(rest);return client;
    }
}
