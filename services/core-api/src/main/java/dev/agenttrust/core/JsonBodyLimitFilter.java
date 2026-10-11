package dev.agenttrust.core;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import java.nio.ByteBuffer;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import org.springframework.http.MediaType;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Bound JSON before Jackson allocation. Login form parsing is left to Spring Security. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class JsonBodyLimitFilter extends OncePerRequestFilter {
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
        String path=request.getRequestURI();
        if(!request.getMethod().equals("POST") || !(path.equals("/internal/completions") || path.equals("/internal/provider-reservations") || path.equals("/api/runs") || path.startsWith("/api/runs/") || path.startsWith("/api/versions/") || path.equals("/api/campaigns") || path.startsWith("/api/campaigns/"))) {chain.doFilter(request,response);return;}
        if(request.getContentLengthLong()>16384) {reject(response);return;}
        byte[] bytes=request.getInputStream().readNBytes(16385);
        if(bytes.length>16384) {reject(response);return;}
        if(!validText(bytes,request.getCharacterEncoding(),request.getContentType())) {response.setStatus(400);response.setContentType("application/json");response.getWriter().write("{\"code\":\"INVALID_JSON_TEXT\"}");return;}
        var wrapped=new HttpServletRequestWrapper(request) {
            @Override public ServletInputStream getInputStream() {
                var stream=new ByteArrayInputStream(bytes);
                return new ServletInputStream() {
                    @Override public int read(){return stream.read();}
                    @Override public int read(byte[] target,int start,int length){return stream.read(target,start,length);}
                    @Override public boolean isFinished(){return stream.available()==0;}
                    @Override public boolean isReady(){return true;}
                    @Override public void setReadListener(ReadListener listener){throw new UnsupportedOperationException("Synchronous bounded requests only");}
                };
            }
        };
        chain.doFilter(wrapped,response);
    }
    // Reject text that PostgreSQL cannot store or UTF-8 encoders would silently replace.
    // This is bounded by the body limit and does not materialize a JSON tree.
    private static boolean validText(byte[] bytes,String encoding,String contentType) {
        try {
            Charset declared=contentType==null?null:MediaType.parseMediaType(contentType).getCharset();
            if(declared!=null && !declared.equals(StandardCharsets.UTF_8)) return false;
            if(encoding!=null && !Charset.forName(encoding).equals(StandardCharsets.UTF_8)) return false;
            String text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            try(var parser=new JsonFactory().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION).createParser(text)) {
                JsonToken token; boolean rootSeen=false; int depth=0;
                while((token=parser.nextToken())!=null) {
                    if(depth==0) {if(rootSeen) return false; rootSeen=true;}
                    if(token.isStructStart()) depth++;
                    if(token.isStructEnd()) depth--;
                    if(token==JsonToken.FIELD_NAME || token==JsonToken.VALUE_STRING) {
                        String value=parser.getText();
                        for(int i=0;i<value.length();i++) {
                            char c=value.charAt(i);
                            if(c==0 || Character.isLowSurrogate(c)) return false;
                            if(Character.isHighSurrogate(c)) {
                                if(++i>=value.length() || !Character.isLowSurrogate(value.charAt(i))) return false;
                            }
                        }
                    }
                }
                return rootSeen && depth==0;
            }
        } catch(IOException|IllegalArgumentException failure) {return false;}
    }
    private static void reject(HttpServletResponse response) throws IOException {response.setStatus(413);response.setContentType("application/json");response.getWriter().write("{\"code\":\"REQUEST_TOO_LARGE\"}");}
}
