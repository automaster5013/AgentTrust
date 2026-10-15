package dev.agenttrust.core;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@org.springframework.scheduling.annotation.EnableScheduling
public class CoreApplication {
    public static void main(String[] args) {
        try{
            var mode=DatabaseProcessBoundary.mode(args);
            if(mode==DatabaseProcessBoundary.Mode.MIGRATE){
                int count=DatabaseMigrationProcess.migrate(DatabaseProcessBoundary.migration(System.getenv()));
                System.out.println("{\"completed\":true,\"mode\":\"migration-only\",\"migrationsExecuted\":"+count+",\"apiServerStarted\":false}");return;
            }
            var settings=DatabaseProcessBoundary.api(System.getenv(),System.getProperties());
            DatabaseApiRoleCheck.verify(settings);
            if(mode==DatabaseProcessBoundary.Mode.CHECK_API_ROLE){System.out.println("{\"completed\":true,\"restrictedApiRoleVerified\":true,\"apiServerStarted\":false}");return;}
            System.setProperty("spring.flyway.enabled","false");
        }catch(DatabaseApiRoleCheck.RolePolicyRefused error){System.err.println("DATABASE_PROCESS_BOUNDARY_REFUSED:API_ROLE_POLICY");System.exit(1);return;
        }catch(Exception error){System.err.println("DATABASE_PROCESS_BOUNDARY_REFUSED");System.exit(1);return;}
        SpringApplication.run(CoreApplication.class, args);
    }
}
