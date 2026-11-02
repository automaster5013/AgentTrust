package dev.agenttrust.core;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Set;
import java.util.UUID;

record CampaignHistoryFilters(String approval,UUID agentVersionId) {
    CampaignHistoryFilters {if(!Set.of("all","required","not-required").contains(approval))throw new IllegalArgumentException("Invalid campaign filter");}
    static UUID optionalId(String value){if("all".equals(value))return null;var id=UUID.fromString(value);if(!id.toString().equals(value))throw new IllegalArgumentException("Invalid canonical version");return id;}
    byte[] digest(){try{return MessageDigest.getInstance("SHA-256").digest(("campaign-search-v1;approval="+approval+";agent="+(agentVersionId==null?"all":agentVersionId)).getBytes(StandardCharsets.US_ASCII));}catch(java.security.NoSuchAlgorithmException unavailable){throw new IllegalStateException(unavailable);}}
}
