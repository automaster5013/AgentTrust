package dev.agenttrust.core;

import java.nio.ByteBuffer;
import java.util.Base64;
import java.util.UUID;

/** Scoped keyset boundary for immutable review history, never release authority. */
record RunReviewCursor(UUID organizationId, UUID projectId, UUID runId, long sequence) {
    static final long MAX_SEQUENCE = 9_007_199_254_740_991L;
    String encode() {
        var bytes = ByteBuffer.allocate(59);
        bytes.put(new byte[]{'R','R','V'});
        for (UUID id : new UUID[]{organizationId, projectId, runId}) bytes.putLong(id.getMostSignificantBits()).putLong(id.getLeastSignificantBits());
        bytes.putLong(sequence);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes.array());
    }
    static RunReviewCursor decode(String token, DemoUser user, UUID runId) {
        if (token == null || !token.matches("[A-Za-z0-9_-]{79}")) throw new IllegalArgumentException("Invalid review boundary");
        var bytes = ByteBuffer.wrap(Base64.getUrlDecoder().decode(token));
        if (bytes.remaining() != 59 || bytes.get() != 'R' || bytes.get() != 'R' || bytes.get() != 'V') throw new IllegalArgumentException("Invalid review domain");
        var cursor = new RunReviewCursor(new UUID(bytes.getLong(), bytes.getLong()), new UUID(bytes.getLong(), bytes.getLong()), new UUID(bytes.getLong(), bytes.getLong()), bytes.getLong());
        if (!cursor.organizationId.equals(user.organizationId()) || !cursor.projectId.equals(user.projectId()) || !cursor.runId.equals(runId) || cursor.sequence < 1 || cursor.sequence > MAX_SEQUENCE || !cursor.encode().equals(token)) throw new IllegalArgumentException("Invalid review scope or sequence");
        return cursor;
    }
}
