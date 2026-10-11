package dev.agenttrust.core;

import static org.junit.jupiter.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.Call;
import okhttp3.EventListener;
import okhttp3.Request;
import org.junit.jupiter.api.Test;

class ArchiveConnectionLifetimeTest {
    @Test void retiresIdleConnectionsBeforeThePinnedServerWithoutReplayingRequests() throws Exception {
        var requests=new AtomicInteger();var connections=new AtomicInteger();
        var server=HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(),0),0);
        server.createContext("/proof",exchange->{
            requests.incrementAndGet();var bytes="proof".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200,bytes.length);
            try(var body=exchange.getResponseBody()){body.write(bytes);}
        });server.start();
        var client=MinioArchiveClient.archiveHttp().newBuilder().eventListener(new EventListener(){
            @Override public void connectStart(Call call,InetSocketAddress address,Proxy proxy){connections.incrementAndGet();}
        }).build();
        try {
            assertEquals(1000,client.connectTimeoutMillis());assertEquals(1000,client.readTimeoutMillis());
            assertEquals(1000,client.writeTimeoutMillis());assertEquals(2000,client.callTimeoutMillis());
            assertFalse(client.retryOnConnectionFailure());assertFalse(client.followRedirects());assertFalse(client.followSslRedirects());
            var request=new Request.Builder().url("http://127.0.0.1:"+server.getAddress().getPort()+"/proof").build();
            try(var response=client.newCall(request).execute()){assertEquals("proof",response.body().string());}
            assertEquals(1,client.connectionPool().idleConnectionCount());
            long deadline=System.nanoTime()+Duration.ofSeconds(26).toNanos();
            while(client.connectionPool().idleConnectionCount()!=0&&System.nanoTime()<deadline)Thread.sleep(100);
            assertEquals(0,client.connectionPool().idleConnectionCount(),"Must retire before the server's 30-second idle closure");
            try(var response=client.newCall(request).execute()){assertEquals("proof",response.body().string());}
            assertEquals(2,connections.get());assertEquals(2,requests.get(),"Exactly one request per explicit read");
        } finally {
            client.connectionPool().evictAll();client.dispatcher().executorService().shutdownNow();server.stop(0);
        }
    }
}
