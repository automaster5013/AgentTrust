package dev.agenttrust.core;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
/** Exact wire coordinates for the dedicated immutable-version detail endpoint. */
final class VersionResponse {
 static Map<String,Object> exactTimestamp(Map<String,Object> source){
  Object value=source.get("created_at");
  Instant at=switch(value){case Timestamp timestamp->timestamp.toInstant();case OffsetDateTime date->date.toInstant();case Instant instant->instant;default->throw new IllegalStateException("Version timestamp unavailable");};
  if(at.getNano()%1000!=0)throw new IllegalStateException("Version timestamp precision unavailable");
  var result=new LinkedHashMap<String,Object>(source);result.put("created_at",at.toString());return result;
 }
}
