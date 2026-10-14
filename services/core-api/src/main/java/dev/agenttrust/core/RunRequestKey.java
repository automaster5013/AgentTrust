package dev.agenttrust.core;
/** Bounded opaque admission key, not an authentication credential. */
final class RunRequestKey {
 private RunRequestKey(){}
 static void validate(String key){if(key==null||!key.matches("[A-Za-z0-9_-]{8,100}"))throw new IllegalArgumentException("Invalid evaluation request key");}
}
