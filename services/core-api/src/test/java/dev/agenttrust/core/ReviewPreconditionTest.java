package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
class ReviewPreconditionTest {
 private final ObjectMapper mapper=new ObjectMapper();
 @Test void omittedFieldsKeepTheOriginalContractButExplicitNullIsInvalid() throws Exception {
  assertNull(ReviewPrecondition.expected(null));
  assertThrows(ResponseStatusException.class,()->ReviewPrecondition.expected(mapper.readTree("null")));
  assertDoesNotThrow(()->ReviewPrecondition.require(null,List.of()));
 }
 @Test void onlyExactNonnegativeSafeIntegersCanBeUsedAsObservedSequences() throws Exception {
  for(String input:new String[]{"0","1","9007199254740991"})assertEquals(Long.valueOf(input),ReviewPrecondition.expected(mapper.readTree(input)));
  for(String input:new String[]{"-1","9007199254740992","9223372036854775808","1.0","1e0","\"1\"","true","[]","{}"}){
   var error=assertThrows(ResponseStatusException.class,()->ReviewPrecondition.expected(mapper.readTree(input)));assertEquals(400,error.getStatusCode().value());
  }
 }
 @Test void firstReviewRequiresTheObservedEmptyHistory() {
  assertDoesNotThrow(()->ReviewPrecondition.require(0L,List.of()));
  assertEquals(409,assertThrows(ResponseStatusException.class,()->ReviewPrecondition.require(1L,List.of())).getStatusCode().value());
 }
 @Test void newerApprovalOrRejectionInvalidatesTheSameObservedBasis() {
  for(String decision:new String[]{"approved","rejected"}){
   var history=List.<Map<String,Object>>of(Map.of("review_sequence",17L,"decision",decision));
   assertDoesNotThrow(()->ReviewPrecondition.require(17L,history));
   for(long expected:new long[]{0,16,18})assertEquals(409,assertThrows(ResponseStatusException.class,()->ReviewPrecondition.require(expected,history)).getStatusCode().value());
  }
 }
}
