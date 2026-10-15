package dev.agenttrust.core;

import java.util.Map;
import java.util.Properties;
import java.util.Locale;

/** A migration process never starts the API; the API never receives DDL credentials. */
final class DatabaseProcessBoundary {
    static final String API_ROLE="agenttrust_stack_api";
    enum Mode { API, MIGRATE, CHECK_API_ROLE }
    record ConnectionSettings(String url,String username,String password) {
        @Override public String toString(){return "ConnectionSettings[redacted]";}
    }
    private DatabaseProcessBoundary(){}
    static Mode mode(String[] args){
        if(args.length==0)return Mode.API;
        if(args.length==1&&args[0].equals("--migrate-only"))return Mode.MIGRATE;
        if(args.length==1&&args[0].equals("--check-database-role"))return Mode.CHECK_API_ROLE;
        throw new IllegalArgumentException("Unsupported database process mode");
    }
    private static String value(Map<String,String> env,String name,int maximum){
        String value=env.get(name);
        if(value==null||value.isBlank()||value.length()>maximum||value.chars().anyMatch(c->c<32||c==127))throw new IllegalArgumentException("Database process configuration unavailable");
        return value;
    }
    private static String url(Map<String,String> env){
        String value=value(env,"STACK_DATABASE_URL",1024);
        if(!value.startsWith("jdbc:postgresql://")||value.contains("@")||value.matches("(?i).*[?&](?:user|username|password)=.*"))throw new IllegalArgumentException("Database URL refused");
        return value;
    }
    private static String password(Map<String,String> env,String name){
        String value=value(env,name,256);if(value.length()<32)throw new IllegalArgumentException("Database credential unavailable");return value;
    }
    static ConnectionSettings api(Map<String,String> env,Properties properties){
        for(var entry:env.entrySet()){
            String name=normalized(entry.getKey());
            if(forbidden(name)||name.startsWith("STACK_DATABASE_")&&!name.equals(entry.getKey()))throw new IllegalArgumentException("Privileged database configuration refused in API process");
            if(name.equals("SPRING_FLYWAY_ENABLED")&&!"false".equals(entry.getValue()))throw new IllegalArgumentException("Automatic API migration refused");
        }
        for(String key:properties.stringPropertyNames()){
            String name=normalized(key);
            if(forbidden(name)||name.startsWith("STACK_DATABASE_"))throw new IllegalArgumentException("Database property override refused");
            if(name.equals("SPRING_FLYWAY_ENABLED")&&!"false".equals(properties.getProperty(key)))throw new IllegalArgumentException("Automatic API migration refused");
        }
        String user=env.getOrDefault("STACK_DATABASE_USER",API_ROLE);if(!API_ROLE.equals(user))throw new IllegalArgumentException("Restricted API role required");
        return new ConnectionSettings(url(env),user,password(env,"STACK_DATABASE_PASSWORD"));
    }
    private static String normalized(String name){return name.toUpperCase(Locale.ROOT).replace('.','_').replace('-','_');}
    private static boolean forbidden(String name){return name.startsWith("STACK_MIGRATION_")||name.startsWith("FLYWAY_")||name.startsWith("SPRING_DATASOURCE_")||name.startsWith("SPRING_FLYWAY_")&&!name.equals("SPRING_FLYWAY_ENABLED")||name.equals("SPRING_APPLICATION_JSON")||name.startsWith("SPRING_CONFIG_");}
    static ConnectionSettings migration(Map<String,String> env){
        if(env.containsKey("STACK_DATABASE_USER")||env.containsKey("STACK_DATABASE_PASSWORD"))throw new IllegalArgumentException("API credentials refused in migration process");
        String user=value(env,"STACK_MIGRATION_USER",63);if(!user.matches("[a-z_][a-z0-9_]{0,62}")||API_ROLE.equals(user))throw new IllegalArgumentException("Migration role required");
        return new ConnectionSettings(url(env),user,password(env,"STACK_MIGRATION_PASSWORD"));
    }
}
