package dev.agenttrust.core;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.URI;
import java.time.Duration;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.client.AbstractClientHttpRequest;
import org.springframework.http.client.ClientHttpRequest;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.ClientHttpResponse;

/** Bounded OAuth/JWKS transport; converters see bytes only after the socket closes. */
final class OidcHttpRequestFactory implements ClientHttpRequestFactory {
    static final int MAX_REQUEST_BYTES=32768;
    static final int MAX_RESPONSE_BYTES=65536;
    private static final class Attempt {final java.util.concurrent.atomic.AtomicBoolean sent=new java.util.concurrent.atomic.AtomicBoolean();}
    private static final OkHttpClient BASE=new OkHttpClient.Builder().connectTimeout(Duration.ofSeconds(3))
        .readTimeout(Duration.ofSeconds(10)).writeTimeout(Duration.ofSeconds(3)).callTimeout(Duration.ofSeconds(10))
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).fastFallback(false)
        .addNetworkInterceptor(chain->{
            var attempt=chain.request().tag(Attempt.class);
            if(attempt==null || !attempt.sent.compareAndSet(false,true))throw new IOException("OIDC request replay refused");
            return chain.proceed(chain.request());
        }).build();
    private final OkHttpClient client;

    OidcHttpRequestFactory(Duration timeout) {
        if(timeout==null || timeout.toMillis()<1 || timeout.compareTo(Duration.ofSeconds(10))>0)
            throw new IllegalArgumentException("OIDC transport configuration unavailable");
        // Decoder instances share a pool; account logins must not accumulate one
        // independent pool per signing-key lookup. Budgets remain per exchange.
        client=BASE.newBuilder().readTimeout(timeout).callTimeout(timeout).build();
    }

    @Override public ClientHttpRequest createRequest(URI uri,HttpMethod method) throws IOException {
        if(!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
            || uri.getRawUserInfo()!=null || uri.getRawFragment()!=null
            || !(method==HttpMethod.GET || method==HttpMethod.POST))
            throw new IOException("OIDC request unavailable");
        return new AbstractClientHttpRequest(){
            private final ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            private final OutputStream body=new OutputStream(){
                @Override public void write(int value) throws IOException {
                    if(bytes.size()>=MAX_REQUEST_BYTES)throw new IOException("OIDC request body limit");
                    bytes.write(value);
                }
                @Override public void write(byte[] value,int offset,int length) throws IOException {
                    java.util.Objects.checkFromIndexSize(offset,length,value.length);
                    if(length>MAX_REQUEST_BYTES-bytes.size())throw new IOException("OIDC request body limit");
                    bytes.write(value,offset,length);
                }
            };
            @Override public URI getURI(){return uri;}
            @Override public HttpMethod getMethod(){return method;}
            @Override protected OutputStream getBodyInternal(HttpHeaders headers){return body;}
            @Override protected ClientHttpResponse executeInternal(HttpHeaders headers) throws IOException {
                if(method==HttpMethod.GET && bytes.size()!=0)throw new IOException("OIDC request body unavailable");
                var builder=new Request.Builder().url(uri.toString()).tag(Attempt.class,new Attempt());
                headers.forEach((name,values)->values.forEach(value->builder.addHeader(name,value)));
                var encodedBody=method==HttpMethod.POST
                    ?RequestBody.create(bytes.toByteArray(),MediaType.parse(headers.getFirst(HttpHeaders.CONTENT_TYPE)==null?"application/x-www-form-urlencoded":headers.getFirst(HttpHeaders.CONTENT_TYPE)))
                    :null;
                RequestBody requestBody=encodedBody==null?null:new RequestBody(){
                    @Override public MediaType contentType(){return encodedBody.contentType();}
                    @Override public long contentLength() throws IOException {return encodedBody.contentLength();}
                    @Override public void writeTo(okio.BufferedSink sink) throws IOException {encodedBody.writeTo(sink);}
                    @Override public boolean isOneShot(){return true;}
                };
                builder.method(method.name(),requestBody);
                // The same deadline covers headers and every byte of the body.
                // readNBytes(limit+1) also bounds chunked/compressed responses.
                try(var response=client.newCall(builder.build()).execute()){
                    byte[] raw=response.body()==null?new byte[0]:response.body().byteStream().readNBytes(MAX_RESPONSE_BYTES+1);
                    if(raw.length>MAX_RESPONSE_BYTES)throw new IOException("OIDC response body limit");
                    var responseHeaders=new HttpHeaders();
                    response.headers().toMultimap().forEach(responseHeaders::addAll);
                    int status=response.code();String reason=response.message();
                    return new ClientHttpResponse(){
                        private final ByteArrayInputStream input=new ByteArrayInputStream(raw);
                        @Override public HttpStatusCode getStatusCode(){return HttpStatusCode.valueOf(status);}
                        @Override public String getStatusText(){return reason;}
                        @Override public HttpHeaders getHeaders(){return HttpHeaders.readOnlyHttpHeaders(responseHeaders);}
                        @Override public ByteArrayInputStream getBody(){return input;}
                        @Override public void close(){input.skip(input.available());}
                    };
                }
            }
        };
    }
}
