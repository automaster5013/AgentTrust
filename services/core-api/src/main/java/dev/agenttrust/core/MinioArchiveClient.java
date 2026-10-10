package dev.agenttrust.core;
import io.minio.*;
import io.minio.errors.ErrorResponseException;
import java.io.ByteArrayInputStream;
import java.nio.file.*;
import java.time.Duration;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import okhttp3.OkHttpClient;
@Component
@ConditionalOnProperty(name="agenttrust.object-mode",havingValue="minio")
public class MinioArchiveClient {
 private static final String BUCKET="stack-evidence";private final MinioClient client;
 public MinioArchiveClient() throws Exception {
  String user=Files.readString(Path.of("/run/secrets/stack-minio-user")),password=Files.readString(Path.of("/run/secrets/stack-minio-password"));if(!user.equals("stack-evidence")||!password.matches("[a-f0-9]{64}"))throw new IllegalStateException("Evidence configuration unavailable");
  var http=new OkHttpClient.Builder().connectTimeout(Duration.ofSeconds(1)).readTimeout(Duration.ofSeconds(1)).writeTimeout(Duration.ofSeconds(1)).callTimeout(Duration.ofSeconds(2)).followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build();client=MinioClient.builder().endpoint("http://stack-object-store:9000").region("us-east-1").credentials(user,password).httpClient(http).build();
 }
 record Stored(byte[] content,String version){}
 Stored read(String key,String version) throws Exception {
  if(version!=null)ArchiveIntegrity.version(version);
  try(var response=client.getObject(GetObjectArgs.builder().bucket(BUCKET).object(key).versionId(version).build())){byte[] content=response.readNBytes(16385);String actual=response.headers().get("x-amz-version-id");ArchiveIntegrity.version(actual);if(version!=null&&!version.equals(actual))throw new IllegalArgumentException("Unexpected evidence version");ArchiveIntegrity.sha256(content);return new Stored(content,actual);}
 }
 String persist(String key,byte[] content) throws Exception {
  String hash=ArchiveIntegrity.sha256(content);
  try{var existing=read(key,null);ArchiveIntegrity.verify(existing.content(),hash,content.length);return existing.version();}catch(ErrorResponseException missing){if(!missing.errorResponse().code().equals("NoSuchKey"))throw missing;}
  var write=client.putObject(PutObjectArgs.builder().bucket(BUCKET).object(key).stream(new ByteArrayInputStream(content),(long)content.length,-1L).contentType("application/json").headers(Map.of("If-None-Match","*")).build());String version=write.versionId();ArchiveIntegrity.version(version);var stored=read(key,version);ArchiveIntegrity.verify(stored.content(),hash,content.length);return version;
 }
}
