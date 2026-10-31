import { assertSafeRemoteUrl, canonicalizeUrl } from "../src/domain/url.js";

describe("URL normalization and SSRF boundaries", () => {
  it("canonicalizes host casing, tracking parameters, fragments, and query order", () => {
    expect(canonicalizeUrl(" HTTPS://Example.COM/read?utm_source=news&b=2&a=1#notes "))
      .toBe("https://example.com/read?a=1&b=2");
  });

  it("rejects credentials and unsupported schemes", () => {
    expect(() => canonicalizeUrl("javascript:alert(1)")).toThrowError("only http and https URLs are supported");
    expect(() => canonicalizeUrl("https://user:password@example.com")).toThrowError("URLs containing credentials are not allowed");
  });

  it("blocks private network targets before content processing", async () => {
    await expect(assertSafeRemoteUrl("http://127.0.0.1/metadata")).rejects.toThrow("private network");
    await expect(assertSafeRemoteUrl("http://localhost/admin")).rejects.toThrow("local network");
  });

  it("blocks special-purpose IPv4 and IPv6 targets, including mapped addresses", async () => {
    for (const address of [
      "100.64.0.1", // CGNAT
      "192.0.2.1", // documentation
      "198.18.0.1", // benchmarking
      "224.0.0.1", // multicast
      "240.0.0.1", // reserved
      "[::ffff:127.0.0.1]", // IPv4-mapped loopback
      "[fc00::1]", // ULA
      "[fe80::1]", // link-local
      "[ff02::1]", // multicast
      "[2001:db8::1]", // documentation
    ]) {
      await expect(assertSafeRemoteUrl(`http://${address}/`)).rejects.toThrow("private network");
    }
  });

  it("returns the validated URL without canonicalizing signed query semantics", async () => {
    const validated = await assertSafeRemoteUrl("http://93.184.216.34/read?sig=b&sig=a&utm_source=mail");
    expect(validated.search).toBe("?sig=b&sig=a&utm_source=mail");
  });
});
