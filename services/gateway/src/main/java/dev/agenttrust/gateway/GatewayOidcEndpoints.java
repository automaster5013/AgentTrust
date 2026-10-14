package dev.agenttrust.gateway;

import java.net.URI;

/** Operator configuration only; forwarded Host/Origin headers never choose endpoints. */
record GatewayOidcEndpoints(String applicationOrigin,String publicIssuer) {
    static GatewayOidcEndpoints local(){return new GatewayOidcEndpoints("http://127.0.0.1:4320","http://127.0.0.1:4322/realms/agenttrust");}
    static GatewayOidcEndpoints configure(String profile,String origin,String issuer){
        if("local-review".equals(profile)){
            var local=local();if(!local.applicationOrigin.equals(origin)||!local.publicIssuer.equals(issuer))throw invalid();return local;
        }
        if(!"https-review".equals(profile))throw invalid();
        https(origin,"");https(issuer,"/realms/agenttrust");return new GatewayOidcEndpoints(origin,issuer);
    }
    private static void https(String value,String path){
        try{
            if(value==null||value.length()>300||!value.matches("[\\x21-\\x7e]+"))throw invalid();
            var uri=URI.create(value);String host=uri.getHost();
            if(!"https".equals(uri.getScheme())||host==null||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null||uri.getPort()!=-1||!path.equals(uri.getRawPath()))throw invalid();
            if(!host.matches("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+")||host.matches("[0-9.]+")||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")||!value.equals("https://"+host+path))throw invalid();
        }catch(IllegalArgumentException refused){throw invalid();}
    }
    boolean acceptsRedirect(String path,String location){
        if(location==null||location.length()>8192)return false;
        try{
            var uri=URI.create(location);
            if(uri.getUserInfo()!=null||uri.getFragment()!=null)return false;
            return path.equals("/oauth2/authorization/keycloak")&&(uri.getScheme()+"://"+uri.getRawAuthority()+uri.getRawPath()).equals(publicIssuer+"/protocol/openid-connect/auth")
                ||path.equals("/login/oauth2/code/keycloak")&&location.equals(applicationOrigin+"/");
        }catch(Exception refused){return false;}
    }
    private static IllegalArgumentException invalid(){return new IllegalArgumentException("Gateway OIDC endpoint configuration unavailable");}
}
