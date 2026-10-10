package dev.agenttrust.core;

import java.time.Duration;
import okhttp3.*;

/** Total call deadline includes streaming the bounded body, not only receiving headers. */
final class BoundedJsonHttp {
 private final OkHttpClient client=new OkHttpClient.Builder().connectTimeout(Duration.ofSeconds(1)).readTimeout(Duration.ofSeconds(1)).writeTimeout(Duration.ofSeconds(1)).callTimeout(Duration.ofSeconds(2)).followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build();
 byte[] post(String fixedUrl,String header,String token,byte[] input,int limit) throws Exception {
  var request=new Request.Builder().url(fixedUrl).header(header,token).post(RequestBody.create(input,MediaType.get("application/json"))).build();
  try(var response=client.newCall(request).execute()){
   if(response.code()!=200||response.body()==null)throw new IllegalStateException("Internal response unavailable");
   try(var stream=response.body().byteStream()){byte[] bytes=stream.readNBytes(limit+1);if(bytes.length>limit)throw new IllegalStateException("Internal response limit");return bytes;}
  }
 }
}
