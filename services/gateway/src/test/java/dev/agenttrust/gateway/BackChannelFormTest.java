package dev.agenttrust.gateway;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class BackChannelFormTest {
 private byte[] bytes(String value){return value.getBytes(StandardCharsets.UTF_8);}
 @Test void exactlyOneFormTokenIsCanonicalizedButSignatureValidationRemainsDownstream(){
  assertArrayEquals(bytes("logout_token=aa.bb.cc"),BackChannelForm.normalize(bytes("logout%5Ftoken=aa%2Ebb%2Ecc"),"application/x-www-form-urlencoded; charset=UTF-8"));
 }
 @Test void duplicateUnknownMalformedAndOversizedInputIsRefusedWithoutReflectingTokenBytes(){
  for(String body:java.util.List.of("logout_token=aa.bb.cc&logout_token=dd.ee.ff","logout_token=aa.bb.cc&scope=other","id_token=aa.bb.cc","logout_token=aa.bb.cc&","?logout_token=aa.bb.cc","logout_token=aa.bb.cc%0A","logout_token=aa.%FF.cc","logout_token="+"a".repeat(2049)+".b.c","logout_token=a."+"b".repeat(12289)+".c","logout_token=a.b."+"c".repeat(2049),"x".repeat(16385))){
   var failure=assertThrows(IllegalArgumentException.class,()->BackChannelForm.normalize(bytes(body),"application/x-www-form-urlencoded"));assertEquals("Back-channel form refused",failure.getMessage());assertNull(failure.getCause());
  }
 }
 @Test void mediaTypeAndUtf8MustMatchTheFixedProtocol(){
  for(String contentType:java.util.List.of("application/json","multipart/form-data","application/x-www-form-urlencoded; charset=iso-8859-1","application/x-www-form-urlencoded; charset=utf-8; charset=utf-8"))assertThrows(IllegalArgumentException.class,()->BackChannelForm.normalize(bytes("logout_token=aa.bb.cc"),contentType));
  assertThrows(IllegalArgumentException.class,()->BackChannelForm.normalize(new byte[]{(byte)0xff},"application/x-www-form-urlencoded"));
  assertThrows(IllegalArgumentException.class,()->BackChannelForm.normalize(bytes("logout_token=aa.bb.cc"),null));
 }
}
