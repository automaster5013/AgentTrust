package dev.agenttrust.core;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Optional compare-and-append contract; omitted fields preserve the original API. */
final class ReviewPrecondition {
    static final long MAX_SEQUENCE=9_007_199_254_740_991L;
    private ReviewPrecondition() {}
    static Long expected(JsonNode value) {
        if(value==null)return null;
        if(!value.isIntegralNumber()||!value.canConvertToLong()||value.longValue()<0||value.longValue()>MAX_SEQUENCE)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid review precondition");
        return value.longValue();
    }
    static void require(Long expected,List<Map<String,Object>> reviews) {
        if(expected==null)return;
        if(expected<0||expected>MAX_SEQUENCE)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        long actual=reviews.isEmpty()?0:((Number)reviews.getFirst().get("review_sequence")).longValue();
        if(actual<0||actual>MAX_SEQUENCE)throw new IllegalStateException("Review history unavailable");
        if(expected!=actual)throw new ResponseStatusException(HttpStatus.CONFLICT,"Review history changed");
    }
}
