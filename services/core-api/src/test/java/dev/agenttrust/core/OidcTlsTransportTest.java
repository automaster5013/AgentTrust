package dev.agenttrust.core;

import static org.junit.jupiter.api.Assertions.*;
import com.sun.net.httpserver.HttpsServer;
import com.sun.net.httpserver.HttpsConfigurator;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.ResourceAccessException;

class OidcTlsTransportTest {
    @Test @Timeout(30) void springTransportChecksCertificateTrustAndHostnameDuringActualTlsHandshake() throws Exception {
        Path directory=Files.createTempDirectory("agenttrust-oidc-tls-");Path store=directory.resolve("fixture.p12");
        char[] password=UUID.randomUUID().toString().toCharArray();HttpsServer server=null;
        try {
            var process=new ProcessBuilder(Path.of(System.getProperty("java.home"),"bin","keytool").toString(),"-genkeypair","-alias","fixture","-keyalg","RSA","-keysize","2048","-validity","1","-dname","CN=localhost","-ext","SAN=dns:localhost","-storetype","PKCS12","-keystore",store.toString(),"-storepass",new String(password),"-noprompt").redirectErrorStream(true).start();
            assertTrue(process.waitFor(15,TimeUnit.SECONDS));assertEquals(0,process.exitValue());
            KeyStore keys=KeyStore.getInstance("PKCS12");try(var input=Files.newInputStream(store)){keys.load(input,password);}
            var keyManagers=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());keyManagers.init(keys,password);
            SSLContext serverContext=SSLContext.getInstance("TLS");serverContext.init(keyManagers.getKeyManagers(),null,null);
            KeyStore trust=KeyStore.getInstance(KeyStore.getDefaultType());trust.load(null,null);trust.setCertificateEntry("fixture",keys.getCertificate("fixture"));
            var trustManagers=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());trustManagers.init(trust);
            SSLContext fixtureTrust=SSLContext.getInstance("TLS");fixtureTrust.init(null,trustManagers.getTrustManagers(),null);
            server=HttpsServer.create(new InetSocketAddress("127.0.0.1",0),0);server.setHttpsConfigurator(new HttpsConfigurator(serverContext));
            var requests=new AtomicInteger();server.createContext("/metadata",exchange->{requests.incrementAndGet();byte[] body="fixture metadata".getBytes(java.nio.charset.StandardCharsets.UTF_8);exchange.sendResponseHeaders(200,body.length);try(var output=exchange.getResponseBody()){output.write(body);}});server.start();int port=server.getAddress().getPort();
            try(var defaultClient=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();var trustedClient=HttpClient.newBuilder().sslContext(fixtureTrust).connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build()){
                var defaults=new JdkClientHttpRequestFactory(defaultClient);defaults.setReadTimeout(Duration.ofSeconds(3));
                var explicit=new JdkClientHttpRequestFactory(trustedClient);explicit.setReadTimeout(Duration.ofSeconds(3));
                var untrusted=RestClient.builder().requestFactory(defaults).build();var trusted=RestClient.builder().requestFactory(explicit).build();
                var trustFailure=assertThrows(ResourceAccessException.class,()->untrusted.get().uri("https://localhost:"+port+"/metadata").retrieve().body(String.class));assertTrue(hasTlsCause(trustFailure));assertEquals(0,requests.get());
                var oidcDefault=RestClient.builder().requestFactory(OidcHttpTransport.factory(Duration.ofSeconds(1))).build();
                var oidcTrustFailure=assertThrows(ResourceAccessException.class,()->oidcDefault.get().uri("https://localhost:"+port+"/metadata").retrieve().body(String.class));assertTrue(hasTlsCause(oidcTrustFailure));assertEquals(0,requests.get());
                assertEquals("fixture metadata",trusted.get().uri("https://localhost:"+port+"/metadata").retrieve().body(String.class));assertEquals(1,requests.get());
                var hostnameFailure=assertThrows(ResourceAccessException.class,()->trusted.get().uri("https://127.0.0.1:"+port+"/metadata").retrieve().body(String.class));assertTrue(hasTlsCause(hostnameFailure));assertEquals(1,requests.get());
            }
        } finally {
            if(server!=null)server.stop(0);java.util.Arrays.fill(password,'\0');Files.deleteIfExists(store);Files.deleteIfExists(directory);
        }
    }
    private static boolean hasTlsCause(Throwable error){for(Throwable cause=error;cause!=null;cause=cause.getCause())if(cause instanceof SSLHandshakeException)return true;return false;}
}
