FROM maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237 AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -B -ntp dependency:go-offline
COPY src src
COPY HealthProbe.java .
RUN mvn -B -ntp verify && javac HealthProbe.java
FROM eclipse-temurin:21-jre@sha256:cff19e6215689161eb6162c11b86b0c60ddf802164f2eaf48d570f8fb79a36c5
RUN rm -f /usr/bin/pebble
WORKDIR /app
ADD --chmod=644 --checksum=sha256:f787eb6c7f3d18e69a431e108a15278d25ee37f83d68b678f621e063f3988f82 https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.32.0/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar
COPY --from=build /build/target/gateway-0.1.0.jar app.jar
COPY --from=build /build/HealthProbe.class .
USER 10001:10001
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=12 CMD ["env","-u","JAVA_TOOL_OPTIONS","java","-cp","/app","HealthProbe"]
ENTRYPOINT ["java","-XX:MaxRAMPercentage=65","-jar","/app/app.jar"]
