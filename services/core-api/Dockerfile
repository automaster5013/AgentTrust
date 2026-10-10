FROM maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237 AS gate-keys
WORKDIR /tool
COPY GateKeyTool.java ./
RUN javac GateKeyTool.java
USER 10001:10001
ENTRYPOINT ["java","-Xmx64m","-cp","/tool","GateKeyTool"]
FROM maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237 AS build
WORKDIR /build
COPY pom.xml ./
COPY src ./src
COPY HealthProbe.java ./
RUN mvn --batch-mode --no-transfer-progress verify
RUN javac -d /probe HealthProbe.java
FROM eclipse-temurin:21-jre@sha256:cff19e6215689161eb6162c11b86b0c60ddf802164f2eaf48d570f8fb79a36c5
RUN rm -f /usr/bin/pebble
WORKDIR /app
ADD --chmod=644 --checksum=sha256:f787eb6c7f3d18e69a431e108a15278d25ee37f83d68b678f621e063f3988f82 https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.32.0/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar
COPY --from=build /build/target/core-api-0.1.0.jar /app/core-api.jar
COPY --from=build /probe /app/health
COPY --from=gate-keys /tool/GateKeyTool.class /app/tools/GateKeyTool.class
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 CMD ["env","-u","JAVA_TOOL_OPTIONS","java","-cp","/app/health","HealthProbe"]
ENTRYPOINT ["java","-XX:MaxRAMPercentage=65","-jar","/app/core-api.jar"]
