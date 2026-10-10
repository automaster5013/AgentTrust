package dev.agenttrust.core;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class BoundedJsonHttpTest {
 @Test void oversizedBodyAndRedirectAreRefused() throws Exception {
  var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  server.createContext("/large",exchange->{exchange.sendResponseHeaders(200,9);exchange.getResponseBody().write(new byte[9]);exchange.close();});
  server.createContext("/redirect",exchange->{exchange.getResponseHeaders().add("Location","/large");exchange.sendResponseHeaders(302,-1);exchange.close();});server.start();
  try{var client=new BoundedJsonHttp();String base="http://127.0.0.1:"+server.getAddress().getPort();assertThrows(Exception.class,()->client.post(base+"/large","X-Test","synthetic",new byte[0],8));assertThrows(Exception.class,()->client.post(base+"/redirect","X-Test","synthetic",new byte[0],16));}finally{server.stop(0);}
 }
 @Test void aStalledBodyAfterHeadersHasABoundedDeadline() throws Exception {
  var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);server.createContext("/slow",exchange->{exchange.sendResponseHeaders(200,10);try{Thread.sleep(2500);}catch(InterruptedException ignored){Thread.currentThread().interrupt();}finally{exchange.close();}});server.start();
  try{assertTimeout(Duration.ofSeconds(4),()->assertThrows(Exception.class,()->new BoundedJsonHttp().post("http://127.0.0.1:"+server.getAddress().getPort()+"/slow","X-Test","synthetic",new byte[0],16)));}finally{server.stop(0);}
 }
}
