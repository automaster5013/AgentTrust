package dev.agenttrust.core;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class VersionResponseTest {
 @Test void responsePreservesPostgresMicrosecondsWithoutChangingInternalArchiveMetadata() throws Exception {
  Instant at=Instant.parse("2026-10-11T05:00:00.123456Z");UUID id=UUID.randomUUID();
  for(Object value:java.util.List.of(Timestamp.from(at),OffsetDateTime.parse("2026-10-11T14:00:00.123456+09:00"),at)){
   var source=Map.<String,Object>of("id",id,"created_at",value,"content_sha256","a".repeat(64));var result=VersionResponse.exactTimestamp(source);
   assertEquals(at.toString(),result.get("created_at"));assertSame(value,source.get("created_at"));assertEquals(id,result.get("id"));
   assertTrue(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(result).contains("2026-10-11T05:00:00.123456Z"));
  }
 }
 @Test void unknownOrAlreadyCoarseTimestampTypesAndSubMicrosecondPrecisionFailClosed(){
  for(Object value:java.util.List.of(new java.util.Date(),"2026-10-11T05:00:00Z",Instant.parse("2026-10-11T05:00:00.123456001Z")))assertThrows(IllegalStateException.class,()->VersionResponse.exactTimestamp(Map.of("created_at",value)));
 }
}
