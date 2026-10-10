FROM maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237 AS build
WORKDIR /build
COPY pom.xml ./
COPY src ./src
COPY HealthProbe.java ./
RUN mvn --batch-mode --no-transfer-progress verify
RUN javac -d /probe HealthProbe.java
FROM eclipse-temurin:21-jre@sha256:cff19e6215689161eb6162c11b86b0c60ddf802164f2eaf48d570f8fb79a36c5
WORKDIR /app
COPY --from=build /build/target/core-api-0.1.0.jar /app/core-api.jar
COPY --from=build /probe /app/health
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 CMD ["java","-cp","/app/health","HealthProbe"]
ENTRYPOINT ["java","-XX:MaxRAMPercentage=65","-jar","/app/core-api.jar"]
