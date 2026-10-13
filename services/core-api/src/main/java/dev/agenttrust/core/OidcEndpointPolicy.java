package dev.agenttrust.core;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/** Operator-owned endpoints; never derive redirects from request headers. */
record OidcEndpointPolicy(String applicationOrigin, String publicIssuer, String transportIssuer) {
    static final String LOCAL_ORIGIN="http://127.0.0.1:4320";
    static final String LOCAL_ISSUER="http://127.0.0.1:4322/realms/agenttrust";
    static final String LOCAL_TRANSPORT="http://stack-identity:8080/realms/agenttrust";

    static OidcEndpointPolicy configure(String profile,String origin,String issuer,boolean secureCookie) {
        if ("local-review".equals(profile)) {
            if (!LOCAL_ORIGIN.equals(origin) || !LOCAL_ISSUER.equals(issuer)) throw invalid();
            return new OidcEndpointPolicy(origin,issuer,LOCAL_TRANSPORT);
        }
        if (!"https-review".equals(profile) || !secureCookie) throw invalid();
        validateHttps(origin,"");validateHttps(issuer,"/realms/agenttrust");
        return new OidcEndpointPolicy(origin,issuer,issuer);
    }

    private static void validateHttps(String value,String path) {
        try {
            if(value==null || value.length()>300 || !value.matches("[\\x21-\\x7e]+")) throw invalid();
            URI uri=URI.create(value);String host=uri.getHost();
            if(!"https".equals(uri.getScheme()) || host==null || uri.getUserInfo()!=null || uri.getQuery()!=null || uri.getFragment()!=null || uri.getPort()!=-1 || !path.equals(uri.getRawPath())) throw invalid();
            // Canonical DNS only: no IP literals, wildcard, encoded host, or local suffix.
            if(!host.matches("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+") || host.matches("[0-9.]+") || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !value.equals("https://"+host+path)) throw invalid();
        } catch(IllegalArgumentException error) {throw invalid();}
    }
    String callback(){return applicationOrigin+"/backend/login/oauth2/code/keycloak";}
    String home(){return applicationOrigin+"/";}
    String logout(){return publicIssuer+"/protocol/openid-connect/logout?client_id=agenttrust-console&post_logout_redirect_uri="+URLEncoder.encode(home(),StandardCharsets.UTF_8);}
    private static IllegalArgumentException invalid(){return new IllegalArgumentException("OIDC endpoint configuration unavailable");}
}
