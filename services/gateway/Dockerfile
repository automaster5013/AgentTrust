FROM maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237 AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -B -ntp dependency:go-offline
COPY src src
COPY HealthProbe.java .
RUN mvn -B -ntp verify && javac HealthProbe.java
FROM eclipse-temurin:21-jre@sha256:cff19e6215689161eb6162c11b86b0c60ddf802164f2eaf48d570f8fb79a36c5
WORKDIR /app
COPY --from=build /build/target/gateway-0.1.0.jar app.jar
COPY --from=build /build/HealthProbe.class .
USER 10001:10001
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=12 CMD ["java","-cp","/app","HealthProbe"]
ENTRYPOINT ["java","-XX:MaxRAMPercentage=65","-jar","/app/app.jar"]
