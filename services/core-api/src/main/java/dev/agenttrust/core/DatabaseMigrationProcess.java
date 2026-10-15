package dev.agenttrust.core;

import org.flywaydb.core.Flyway;

final class DatabaseMigrationProcess {
    private DatabaseMigrationProcess(){}
    static int migrate(DatabaseProcessBoundary.ConnectionSettings settings){
        // Only the short-lived migration process selects this redacted logger.
        System.setProperty("logback.configurationFile","logback-migration.xml");
        return Flyway.configure().dataSource(settings.url(),settings.username(),settings.password())
            .locations("classpath:db/migration").cleanDisabled(true).baselineOnMigrate(false)
            .validateOnMigrate(true).validateMigrationNaming(true).connectRetries(0).loggers("slf4j")
            .load().migrate().migrationsExecuted;
    }
}
