import dns from "node:dns/promises";
import http from "node:http";
import { PassThrough } from "node:stream";
import type { ClientRequest, IncomingMessage } from "node:http";
import { CONTENT_LIMITS, extractPdfDocument, extractResource } from "../src/content/processor.js";

function fakeResponse(statusCode: number, headers: Record<string, string>): PassThrough & Partial<IncomingMessage> {
  const response = new PassThrough() as PassThrough & Partial<IncomingMessage>;
  response.statusCode = statusCode;
  response.headers = headers;
  return response;
}

describe("remote content network boundaries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("pins the vetted DNS address and sends the original query unchanged", async () => {
    const lookup = vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never);
    const requests: Array<{ options: http.ClientRequestArgs; address: string | undefined }> = [];
    vi.spyOn(http, "request").mockImplementation(((options: http.ClientRequestArgs, callback?: (response: IncomingMessage) => void): ClientRequest => {
      const request = new PassThrough() as PassThrough & Partial<ClientRequest>;
      requests.push({ options, address: undefined });
      options.lookup?.(String(options.hostname), {}, (_error, address) => {
        requests[requests.length - 1]!.address = typeof address === "string" ? address : undefined;
      });
      const response = fakeResponse(200, { "content-type": "text/plain" });
      queueMicrotask(() => {
        callback?.(response as IncomingMessage);
        response.end("signed response");
      });
      return request as ClientRequest;
    }) as typeof http.request);

    const result = await extractResource("http://example.test/read?sig=b&sig=a&utm_source=mail");

    expect(result.text).toBe("signed response");
    expect(requests[0]?.options.path).toBe("/read?sig=b&sig=a&utm_source=mail");
    expect(requests[0]?.address).toBe("93.184.216.34");
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("validates every redirect before opening its socket", async () => {
    const lookup = vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never);
    const redirectBodies: IncomingMessage[] = [];
    const request = vi.spyOn(http, "request").mockImplementation(((
      _options: http.ClientRequestArgs,
      callback?: (response: IncomingMessage) => void,
    ): ClientRequest => {
      const client = new PassThrough() as PassThrough & Partial<ClientRequest>;
      const response = fakeResponse(302, { location: "http://127.0.0.1/private", "content-length": "0" });
      redirectBodies.push(response as IncomingMessage);
      queueMicrotask(() => {
        callback?.(response as IncomingMessage);
        response.end();
      });
      return client as ClientRequest;
    }) as typeof http.request);

    await expect(extractResource("http://example.test/start")).rejects.toThrow("private network");

    expect(request).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(redirectBodies[0]?.destroyed).toBe(true);
  });

  it("rejects an oversized body from its declared length", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    const request = vi.spyOn(http, "request").mockImplementation(((
      _options: http.ClientRequestArgs,
      callback?: (response: IncomingMessage) => void,
    ): ClientRequest => {
      const client = new PassThrough() as PassThrough & Partial<ClientRequest>;
      const response = fakeResponse(200, {
        "content-type": "text/plain",
        "content-length": String(CONTENT_LIMITS.maxBytes + 1),
      });
      queueMicrotask(() => callback?.(response as IncomingMessage));
      return client as ClientRequest;
    }) as typeof http.request);

    await expect(extractResource("http://example.test/large")).rejects.toThrow("larger than the allowed limit");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("applies the total deadline while a response body is stalled", async () => {
    vi.useFakeTimers();
    vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    vi.spyOn(http, "request").mockImplementation(((
      _options: http.ClientRequestArgs,
      callback?: (response: IncomingMessage) => void,
    ): ClientRequest => {
      const client = new PassThrough() as PassThrough & Partial<ClientRequest>;
      const response = fakeResponse(200, { "content-type": "text/plain" });
      queueMicrotask(() => callback?.(response as IncomingMessage));
      return client as ClientRequest;
    }) as typeof http.request);

    const pending = extractResource("http://example.test/stalled");
    const assertion = expect(pending).rejects.toMatchObject({ code: "REMOTE_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(CONTENT_LIMITS.timeoutMs + 1);

    await assertion;
  });

  it("rejects malformed PDF data in the isolated parser", async () => {
    await expect(
      extractPdfDocument(Buffer.from("%PDF-1.7\nnot a real PDF"), "https://example.com/broken.pdf"),
    ).rejects.toMatchObject({ code: "PDF_PROCESSING_FAILED" });
  });
});
