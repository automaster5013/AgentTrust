package dev.agenttrust.core;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import static org.junit.jupiter.api.Assertions.*;
class JsonBodyLimitFilterTest {
    @Test void newVersionAndCampaignBodiesAreBoundedBeforeParsing() throws Exception {
        for(String path:java.util.List.of("/api/versions/agents","/api/versions/datasets","/api/campaigns","/api/campaigns/11111111-1111-4111-8111-111111111111/reviews")){
            var request=new MockHttpServletRequest("POST",path);request.setContent(new byte[16385]);var response=new MockHttpServletResponse();var chain=new MockFilterChain();new JsonBodyLimitFilter().doFilter(request,response,chain);assertEquals(413,response.getStatus());assertNull(chain.getRequest());
        }
    }
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
    @Test void malformedUtf8NullAndUnpairedEscapedSurrogatesNeverReachController() throws Exception {
        for(String value:java.util.List.of("\\u0000","\\ud800","\\udc00","\\ud800x","\\ud800\\ud800","\\udc00\\ud800")) {
            byte[] body=("{\"description\":\""+value+"\"}").getBytes(java.nio.charset.StandardCharsets.UTF_8);
            assertInvalid(body);
            assertInvalid(("{\""+value+"\":1}").getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
        assertInvalid(new byte[]{'{','"','x','"',':','"',(byte)0xc0,(byte)0xaf,'"','}'});
        assertInvalid("{\"x\":1}".getBytes(java.nio.charset.StandardCharsets.UTF_16LE));
        assertInvalid("{\"x\":1}".getBytes(java.nio.charset.StandardCharsets.UTF_16BE));
    }
    @Test void validMultilingualTextAndEmojiRetainExactBytes() throws Exception {
        for(String value:java.util.List.of("한국어 café 🚀","\\ud83d\\ude80","line\\nnext")) {
            byte[] body=("{\"description\":\""+value+"\"}").getBytes(java.nio.charset.StandardCharsets.UTF_8);
            var request=new MockHttpServletRequest("POST","/api/versions/agents");request.setContent(body);
            var response=new MockHttpServletResponse();var chain=new MockFilterChain();new JsonBodyLimitFilter().doFilter(request,response,chain);
            assertEquals(200,response.getStatus());assertArrayEquals(body,chain.getRequest().getInputStream().readAllBytes());
        }
    }
    @Test void explicitNonUtf8CharsetCannotReinterpretAlreadyValidatedText() throws Exception {
        for(String encoding:java.util.List.of("ISO-8859-1","UTF-16","UTF-32","invalid-charset")) {
            var request=new MockHttpServletRequest("POST","/api/versions/agents");request.setCharacterEncoding(encoding);request.setContent("{\"description\":\"café\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            var response=new MockHttpServletResponse();var chain=new MockFilterChain();new JsonBodyLimitFilter().doFilter(request,response,chain);assertEquals(400,response.getStatus());assertNull(chain.getRequest());
        }
        var forced=new MockHttpServletRequest("POST","/api/versions/agents") {@Override public String getCharacterEncoding(){return "UTF-8";}};
        forced.setContentType("application/json; charset=ISO-8859-1");forced.setContent("{\"description\":\"café\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        var rejected=new MockHttpServletResponse();var blocked=new MockFilterChain();new JsonBodyLimitFilter().doFilter(forced,rejected,blocked);assertEquals(400,rejected.getStatus());assertNull(blocked.getRequest());
        for(String encoding:java.util.List.of("UTF-8","utf8")) {
            var request=new MockHttpServletRequest("POST","/api/versions/agents");request.setCharacterEncoding(encoding);byte[] body="{\"description\":\"café\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8);request.setContent(body);
            var chain=new MockFilterChain();new JsonBodyLimitFilter().doFilter(request,new MockHttpServletResponse(),chain);assertArrayEquals(body,chain.getRequest().getInputStream().readAllBytes());
        }
    }
    @Test void duplicateFieldsAndMultipleRootDocumentsAreRejected() throws Exception {
        for(String body:java.util.List.of("{\"decision\":\"approved\",\"decision\":\"rejected\"}","{\"nested\":{\"x\":1,\"x\":2}}","{} {}","[] {}","1 2",""," ")) assertInvalid(body.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        byte[] valid="{\"left\":{\"x\":1},\"right\":{\"x\":2},\"rows\":[{\"x\":3},{\"x\":4}]}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        var request=new MockHttpServletRequest("POST","/api/campaigns");request.setContent(valid);var chain=new MockFilterChain();new JsonBodyLimitFilter().doFilter(request,new MockHttpServletResponse(),chain);assertArrayEquals(valid,chain.getRequest().getInputStream().readAllBytes());
    }
    private static void assertInvalid(byte[] body) throws Exception {
        var request=new MockHttpServletRequest("POST","/api/campaigns");request.setContent(body);
        var response=new MockHttpServletResponse();var chain=new MockFilterChain();new JsonBodyLimitFilter().doFilter(request,response,chain);
        assertEquals(400,response.getStatus());assertNull(chain.getRequest());assertEquals("{\"code\":\"INVALID_JSON_TEXT\"}",response.getContentAsString());
    }
}
