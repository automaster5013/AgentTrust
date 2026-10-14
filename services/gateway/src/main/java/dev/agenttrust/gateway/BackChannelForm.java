package dev.agenttrust.gateway;

import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

/** Syntax and size only. The Core OIDC handler must authenticate the signed JWT. */
final class BackChannelForm {
    static final String PATH="/logout/connect/back-channel/keycloak";
    private BackChannelForm(){}
    static byte[] normalize(byte[] body,String contentType){
        try{
            if(body==null||body.length==0||body.length>16384||contentType==null||contentType.length()>100
                ||!contentType.matches("(?i)application/x-www-form-urlencoded(?:\\s*;\\s*charset=(?:utf-8|\"utf-8\"))?\\s*"))throw new IllegalArgumentException();
            String text=StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(body)).toString();
            String[] fields=text.split("&",-1);if(fields.length!=1)throw new IllegalArgumentException();
            String[] field=fields[0].split("=",2);
            if(field.length!=2||!URLDecoder.decode(field[0],StandardCharsets.UTF_8).equals("logout_token"))throw new IllegalArgumentException();
            String token=URLDecoder.decode(field[1],StandardCharsets.UTF_8);
            if(!token.matches("[A-Za-z0-9_-]{1,2048}\\.[A-Za-z0-9_-]{1,12288}\\.[A-Za-z0-9_-]{1,2048}"))throw new IllegalArgumentException();
            return ("logout_token="+URLEncoder.encode(token,StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8);
        }catch(Exception refused){throw new IllegalArgumentException("Back-channel form refused");}
    }
}
