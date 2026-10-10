import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.KeyFactory;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.HexFormat;
import java.util.regex.Pattern;

/** Writes a new local development key pair to one explicitly mounted file.
 * Private bytes never go to stdout, stderr, environment variables or arguments. */
public final class GateKeyTool {
    public static void main(String[] args){
        try{
            if(args.length!=2||!args[1].equals("/output/key-pair.json")||!java.util.List.of("generate","validate").contains(args[0]))throw new IllegalArgumentException();
            Path path=Path.of(args[1]);
            if(args[0].equals("generate")&&!Files.exists(path)){
                var pair=KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
                String privateKey=Base64.getEncoder().encodeToString(pair.getPrivate().getEncoded()),publicKey=Base64.getEncoder().encodeToString(pair.getPublic().getEncoded());
                Files.writeString(path,"{\"schemaVersion\":1,\"privateKey\":\""+privateKey+"\",\"publicKey\":\""+publicKey+"\"}",StandardCharsets.UTF_8,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE);
            }
            if(Files.size(path)>4096)throw new IllegalArgumentException();
            var match=Pattern.compile("\\{\"schemaVersion\":1,\"privateKey\":\"([A-Za-z0-9+/=]+)\",\"publicKey\":\"([A-Za-z0-9+/=]+)\"\\}").matcher(Files.readString(path));
            if(!match.matches())throw new IllegalArgumentException();
            byte[] privateBytes=Base64.getDecoder().decode(match.group(1)),publicBytes=Base64.getDecoder().decode(match.group(2));
            if(privateBytes.length!=48||publicBytes.length!=44)throw new IllegalArgumentException();
            var factory=KeyFactory.getInstance("Ed25519");var privateKey=factory.generatePrivate(new PKCS8EncodedKeySpec(privateBytes));var publicKey=factory.generatePublic(new X509EncodedKeySpec(publicBytes));
            var signer=Signature.getInstance("Ed25519");byte[] challenge="AgentTrust development key pair consistency/v1".getBytes(StandardCharsets.UTF_8);signer.initSign(privateKey);signer.update(challenge);byte[] signature=signer.sign();signer.initVerify(publicKey);signer.update(challenge);if(!signer.verify(signature))throw new IllegalArgumentException();
            String id=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(publicBytes));
            System.out.println("{\"prepared\":true,\"keyId\":\""+id+"\",\"privateKeyPrinted\":false}");
        }catch(Exception unavailable){System.out.println("{\"prepared\":false,\"code\":\"DEVELOPMENT_SIGNING_KEY_UNVERIFIED\",\"privateKeyPrinted\":false}");System.exit(1);}
    }
}
