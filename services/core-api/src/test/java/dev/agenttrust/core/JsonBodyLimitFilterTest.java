package dev.agenttrust.core;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import static org.junit.jupiter.api.Assertions.*;
class JsonBodyLimitFilterTest {
    @Test void oversizedJsonCannotReachSecurityOrController() throws Exception {
        var request=new MockHttpServletRequest("POST","/internal/completions");request.setContent(new byte[16385]);
        var response=new MockHttpServletResponse();var chain=new MockFilterChain();new JsonBodyLimitFilter().doFilter(request,response,chain);
        assertEquals(413,response.getStatus());assertNull(chain.getRequest());assertEquals("{\"code\":\"REQUEST_TOO_LARGE\"}",response.getContentAsString());
    }
    @Test void validJsonIsReplayedAndLoginFormIsUntouched() throws Exception {
        var request=new MockHttpServletRequest("POST","/api/runs");byte[] body="{\"scenario\":\"pass\"}".getBytes();request.setContent(body);
        var chain=new MockFilterChain();new JsonBodyLimitFilter().doFilter(request,new MockHttpServletResponse(),chain);assertArrayEquals(body,chain.getRequest().getInputStream().readAllBytes());
        var login=new MockHttpServletRequest("POST","/api/login");var loginChain=new MockFilterChain();new JsonBodyLimitFilter().doFilter(login,new MockHttpServletResponse(),loginChain);assertSame(login,loginChain.getRequest());
    }
}
