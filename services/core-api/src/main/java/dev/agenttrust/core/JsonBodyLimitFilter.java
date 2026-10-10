package dev.agenttrust.core;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
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
        if(!request.getMethod().equals("POST") || !(path.equals("/internal/completions") || path.equals("/api/runs") || path.startsWith("/api/runs/"))) {chain.doFilter(request,response);return;}
        if(request.getContentLengthLong()>16384) {reject(response);return;}
        byte[] bytes=request.getInputStream().readNBytes(16385);
        if(bytes.length>16384) {reject(response);return;}
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
    private static void reject(HttpServletResponse response) throws IOException {response.setStatus(413);response.setContentType("application/json");response.getWriter().write("{\"code\":\"REQUEST_TOO_LARGE\"}");}
}
