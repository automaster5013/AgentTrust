package dev.agenttrust.core;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Set;

record RunHistoryFilters(String scenario,String approval,String state,String decision,String provider) {
    RunHistoryFilters {
        require(scenario,Set.of("all","pass","block","missing_evidence","error","quality"));
        require(approval,Set.of("all","required","not-required"));
        require(state,Set.of("all","queued","succeeded","failed"));
        require(decision,Set.of("all","pass","block","inconclusive"));
        require(provider,Set.of("all","synthetic","ollama","openai","openai-compatible"));
    }
    private static void require(String value,Set<String> choices){if(value==null||!choices.contains(value))throw new IllegalArgumentException("Invalid run history filter");}
    byte[] digest(){try{return MessageDigest.getInstance("SHA-256").digest(("scenario="+scenario+";approval="+approval+";state="+state+";decision="+decision+";provider="+provider).getBytes(StandardCharsets.US_ASCII));}catch(java.security.NoSuchAlgorithmException unavailable){throw new IllegalStateException(unavailable);}}
}
