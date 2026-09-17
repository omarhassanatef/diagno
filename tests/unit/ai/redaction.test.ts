import { describe, it, expect } from "vitest";
import { redactSecrets, redactAll } from "../../../src/ai/redaction";

describe("redactSecrets", () => {
  it("redacts AWS access key IDs", () => {
    const { text, redactionCount } = redactSecrets(
      "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"
    );
    expect(text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(redactionCount).toBeGreaterThan(0);
  });

  it("redacts private key blocks entirely", () => {
    const key =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK...\n-----END RSA PRIVATE KEY-----";
    const { text } = redactSecrets(`before\n${key}\nafter`);
    expect(text).not.toContain("MIIBOgIBAAJBAK");
    expect(text).toContain("[REDACTED:PRIVATE_KEY]");
    expect(text).toContain("before");
    expect(text).toContain("after");
  });

  it("redacts JWTs", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGhpc2lzYWZha2VzaWduYXR1cmU";
    const { text } = redactSecrets(`Authorization token: ${jwt}`);
    expect(text).not.toContain(jwt);
    expect(text).toContain("[REDACTED:JWT]");
  });

  it("redacts Bearer tokens", () => {
    const { text } = redactSecrets("Authorization: Bearer sk-abc123def456");
    expect(text).not.toContain("sk-abc123def456");
    expect(text).toContain("Bearer [REDACTED:TOKEN]");
  });

  it("redacts generic key/secret/password assignments in code or config", () => {
    const { text } = redactSecrets(`const apiKey = "sk-verysecretvalue123";`);
    expect(text).not.toContain("sk-verysecretvalue123");
    expect(text).toContain("[REDACTED]");
  });

  it("redacts dotenv-style secret lines by variable name, leaving benign ones alone", () => {
    const input = "DATABASE_PASSWORD=hunter2\nPORT=3000\nSTRIPE_SECRET_KEY=sk_live_abc123";
    const { text } = redactSecrets(input);
    expect(text).toContain("PORT=3000");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("sk_live_abc123");
    expect(text).toContain("DATABASE_PASSWORD=[REDACTED]");
    expect(text).toContain("STRIPE_SECRET_KEY=[REDACTED]");
  });

  it("leaves ordinary text completely untouched", () => {
    const input = "Cannot find module '@/modules/users' from 'src/users.test.ts'";
    const { text, redactionCount } = redactSecrets(input);
    expect(text).toBe(input);
    expect(redactionCount).toBe(0);
  });

  it("redactAll applies redaction across a whole object of named blobs", () => {
    const result = redactAll({
      stdout: "all good here",
      stderr: "API_KEY=abcd1234efgh",
      missing: undefined,
    });
    expect(result.stdout).toBe("all good here");
    expect(result.stderr).not.toContain("abcd1234efgh");
    expect(result.missing).toBeUndefined();
  });
});
