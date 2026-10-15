package dev.agenttrust.core;

import static org.junit.jupiter.api.Assertions.*;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;
import org.junit.jupiter.api.Test;

class DatabaseProcessBoundaryTest {
    private static final String URL="jdbc:postgresql://stack-db:5432/agenttrust_stack?connectTimeout=2&socketTimeout=5";
    private Map<String,String> api(){return new HashMap<>(Map.of("STACK_DATABASE_URL",URL,"STACK_DATABASE_USER","agenttrust_stack_api","STACK_DATABASE_PASSWORD","a".repeat(48)));}
    private Map<String,String> migration(){return new HashMap<>(Map.of("STACK_DATABASE_URL",URL,"STACK_MIGRATION_USER","agenttrust_stack","STACK_MIGRATION_PASSWORD","b".repeat(48)));}
    @Test void processModesCannotCombineMigrationWithApiArguments(){
        assertEquals(DatabaseProcessBoundary.Mode.API,DatabaseProcessBoundary.mode(new String[0]));
        assertEquals(DatabaseProcessBoundary.Mode.MIGRATE,DatabaseProcessBoundary.mode(new String[]{"--migrate-only"}));
        assertEquals(DatabaseProcessBoundary.Mode.CHECK_API_ROLE,DatabaseProcessBoundary.mode(new String[]{"--check-database-role"}));
        for(String[] args:new String[][]{{"--migrate-only","--server.port=8080"},{"--spring.flyway.enabled=true"},{"--migrate-only=true"}})assertThrows(IllegalArgumentException.class,()->DatabaseProcessBoundary.mode(args));
    }
    @Test void apiOnlyAcceptsRestrictedCredentialsAndNeverFormatsTheirValues(){
        var settings=DatabaseProcessBoundary.api(api(),new Properties());assertEquals("agenttrust_stack_api",settings.username());assertEquals(URL,settings.url());assertFalse(settings.toString().contains(settings.password()));
        var env=api();env.remove("STACK_DATABASE_USER");assertEquals("agenttrust_stack_api",DatabaseProcessBoundary.api(env,new Properties()).username());
    }
    @Test void migrationCredentialsOrSpringOverridesCannotEnterApiProcess(){
        for(String name:new String[]{"STACK_MIGRATION_USER","STACK_MIGRATION_PASSWORD","SPRING_FLYWAY_PASSWORD","SPRING_FLYWAY_USER","SPRING_DATASOURCE_USERNAME","SPRING_DATASOURCE_PASSWORD"}){
            var env=api();env.put(name,"private".repeat(8));var error=assertThrows(IllegalArgumentException.class,()->DatabaseProcessBoundary.api(env,new Properties()));assertFalse(error.getMessage().contains(env.get(name)));
        }
        var env=api();env.put("SPRING_FLYWAY_ENABLED","true");assertThrows(IllegalArgumentException.class,()->DatabaseProcessBoundary.api(env,new Properties()));
        env.put("SPRING_FLYWAY_ENABLED","false");assertDoesNotThrow(()->DatabaseProcessBoundary.api(env,new Properties()));
    }
    @Test void jvmPropertiesCannotReenableApiMigrationsOrReplaceDatasource(){
        for(String name:new String[]{"spring.flyway.password","spring.flyway.user","spring.flyway.enabled","spring.datasource.username","spring.datasource.password"}){
            var properties=new Properties();properties.setProperty(name,"private".repeat(8));assertThrows(IllegalArgumentException.class,()->DatabaseProcessBoundary.api(api(),properties));
        }
        var safe=new Properties();safe.setProperty("spring.flyway.enabled","false");assertDoesNotThrow(()->DatabaseProcessBoundary.api(api(),safe));
    }
    @Test void apiRefusesOwnerRoleAndCredentialBearingUrls(){
        var owner=api();owner.put("STACK_DATABASE_USER","agenttrust_stack");assertThrows(IllegalArgumentException.class,()->DatabaseProcessBoundary.api(owner,new Properties()));
        for(String suffix:new String[]{"&password=private","&USER=owner","&username=owner"}){var env=api();env.put("STACK_DATABASE_URL",URL+suffix);assertThrows(IllegalArgumentException.class,()->DatabaseProcessBoundary.api(env,new Properties()));}
    }
    @Test void missingShortOrControlCharacterCredentialsAreRejected(){
        for(String password:new String[]{"","a".repeat(31),"a".repeat(257),"a".repeat(48)+"\n"}){var env=api();env.put("STACK_DATABASE_PASSWORD",password);assertThrows(IllegalArgumentException.class,()->DatabaseProcessBoundary.api(env,new Properties()));}
        var env=api();env.remove("STACK_DATABASE_PASSWORD");assertThrows(IllegalArgumentException.class,()->DatabaseProcessBoundary.api(env,new Properties()));
    }
    @Test void migrationProcessRequiresSeparateOwnerCredentialsAndNoApiPassword(){
        var settings=DatabaseProcessBoundary.migration(migration());assertEquals("agenttrust_stack",settings.username());assertFalse(settings.toString().contains(settings.password()));
        for(String key:new String[]{"STACK_DATABASE_USER","STACK_DATABASE_PASSWORD"}){var env=migration();env.put(key,"private".repeat(8));assertThrows(IllegalArgumentException.class,()->DatabaseProcessBoundary.migration(env));}
        var env=migration();env.put("STACK_MIGRATION_USER","agenttrust_stack_api");assertThrows(IllegalArgumentException.class,()->DatabaseProcessBoundary.migration(env));
    }
    @Test void relaxedBindingJsonAndExternalConfigCannotHidePrivilegedOverrides(){
        for(String key:new String[]{"spring.datasource.username","spring-datasource-password","spring.application.json","SPRING_APPLICATION_JSON","SPRING_CONFIG_IMPORT","spring.config.location","STACK_MIGRATION_PASSWORD","FLYWAY_PASSWORD","stack.database.user"}){
            var env=api();env.put(key,"private".repeat(8));assertThrows(IllegalArgumentException.class,()->DatabaseProcessBoundary.api(env,new Properties()));
            var properties=new Properties();properties.setProperty(key,"private".repeat(8));assertThrows(IllegalArgumentException.class,()->DatabaseProcessBoundary.api(api(),properties));
        }
        var env=api();env.put("STACK_DATABASE_URL","jdbc:postgresql://owner:private@stack-db:5432/agenttrust_stack");assertThrows(IllegalArgumentException.class,()->DatabaseProcessBoundary.api(env,new Properties()));
    }
}
