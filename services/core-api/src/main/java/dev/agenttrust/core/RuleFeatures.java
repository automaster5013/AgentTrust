package dev.agenttrust.core;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;

/** Rejects unbounded, nonfinite or nonnormalized vectors from the internal worker. */
public final class RuleFeatures {
 public static final String VERSION="rule-features-v1";
 static String vector(JsonNode response,UUID run,UUID org,UUID project,String hash){
  var names=new HashSet<String>();response.fieldNames().forEachRemaining(names::add);
  if(!names.equals(Set.of("runId","organizationId","projectId","contentSha256","featureVersion","dimensions","vector"))
     ||!response.path("runId").asText().equals(run.toString())||!response.path("organizationId").asText().equals(org.toString())
     ||!response.path("projectId").asText().equals(project.toString())||!response.path("contentSha256").asText().equals(hash)
     ||!response.path("featureVersion").asText().equals(VERSION)||!response.path("dimensions").isIntegralNumber()||response.path("dimensions").asInt()!=64)
    throw new IllegalArgumentException("Invalid feature scope");
  var values=response.path("vector");if(!values.isArray()||values.size()!=64)throw new IllegalArgumentException("Invalid dimensions");
  double norm=0;var parts=new ArrayList<String>();for(var value:values){double number=value.asDouble();if(!value.isNumber()||!Double.isFinite(number)||number<0||number>1)throw new IllegalArgumentException("Invalid feature value");norm+=number*number;parts.add(Double.toString(number));}
  if(norm<0.999||norm>1.001)throw new IllegalArgumentException("Invalid feature norm");return "["+String.join(",",parts)+"]";
 }
}
