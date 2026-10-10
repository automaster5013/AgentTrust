package dev.agenttrust.core;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@org.springframework.scheduling.annotation.EnableScheduling
public class CoreApplication {
    public static void main(String[] args) { SpringApplication.run(CoreApplication.class, args); }
}
