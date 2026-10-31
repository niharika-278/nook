import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { spawn } from "node:child_process";
import { load } from "cheerio";
import { AppError } from "../domain/errors.js";
import { canonicalizeUrl, pinnedLookup, resolveSafeRemoteTarget } from "../domain/url.js";

export const CONTENT_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxTextCharacters: 200_000,
  timeoutMs: 12_000,
  maxRedirects: 5,
  maxPdfPages: 100,
  pdfTimeoutMs: 8_000,
  pdfMaxOldGenerationMb: 64,
} as const;

export interface ExtractedResource {
  finalUrl: string;
  contentType: string;
  title?: string;
  description?: string;
  author?: string;
  publishedAt?: string;
  faviconUrl?: string;
  previewImageUrl?: string;
  sourceDomain: string;
  text: string;
  contentHash: string;
}

interface RemoteResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: IncomingMessage;
}

function truncateText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, CONTENT_LIMITS.maxTextCharacters);
}

function ensureInputSize(value: string): void {
  if (Buffer.byteLength(value, "utf8") > CONTENT_LIMITS.maxBytes) {
    throw new AppError(413, "CONTENT_TOO_LARGE", "the resource is larger than the allowed limit");
  }
}

function firstMetadata($: ReturnType<typeof load>, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const value = $(selector).first().attr("content")?.trim() || $(selector).first().text().trim();
    if (value) return value.slice(0, CONTENT_LIMITS.maxTextCharacters);
  }
  return undefined;
}

function firstAttribute($: ReturnType<typeof load>, selector: string, attribute: string): string | undefined {
  const value = $(selector).first().attr(attribute)?.trim();
  return value ? value.slice(0, CONTENT_LIMITS.maxTextCharacters) : undefined;
}

function safeMetadataUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value, baseUrl);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) return undefined;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function safePublishedAt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

export function extractHtmlDocument(html: string, url: string): Omit<ExtractedResource, "contentHash"> {
  ensureInputSize(html);
  let $: ReturnType<typeof load>;
  try {
    $ = load(html);
  } catch {
    throw new AppError(422, "INVALID_HTML", "the resource could not be safely parsed as HTML");
  }
  $("script, style, noscript, template, svg, canvas").remove();
  const title = $("title").first().text().trim().slice(0, CONTENT_LIMITS.maxTextCharacters)
    || firstMetadata($, ["meta[property='og:title']", "meta[name='twitter:title']"]);
  const description = firstMetadata($, ["meta[name='description']", "meta[property='og:description']"]);
  const author = firstMetadata($, ["meta[name='author']", "meta[property='article:author']", "[rel='author']"]);
  const publishedAt = safePublishedAt(firstMetadata($, ["meta[property='article:published_time']", "meta[name='date']", "time[datetime]"]));
  const faviconUrl = safeMetadataUrl(firstAttribute($, "link[rel~='icon'], link[rel='shortcut icon']", "href"), url);
  const previewImageUrl = safeMetadataUrl(firstMetadata($, ["meta[property='og:image']", "meta[name='twitter:image']"]), url);
  const baseUrl = new URL(url);
  const canonicalCandidate = safeMetadataUrl(firstAttribute($, "link[rel='canonical']", "href"), url);
  const canonicalUrl = canonicalCandidate && new URL(canonicalCandidate).hostname.toLowerCase() === baseUrl.hostname.toLowerCase()
    ? canonicalCandidate
    : url;
  const sourceDomain = new URL(canonicalUrl).hostname.toLowerCase();
  const root = $("article").first().length ? $("article").first() : $("main").first().length ? $("main").first() : $("body");
  const text = truncateText(root.text());
  if (!text) throw new AppError(422, "EMPTY_CONTENT", "the page did not contain readable text");
  return {
    finalUrl: canonicalizeUrl(canonicalUrl),
    contentType: "text/html",
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(author === undefined ? {} : { author }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    ...(faviconUrl === undefined ? {} : { faviconUrl }),
    ...(previewImageUrl === undefined ? {} : { previewImageUrl }),
    sourceDomain,
    text,
  };
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

async function withDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
  const remaining = remainingMs(deadline);
  if (remaining <= 0) throw new AppError(504, "REMOTE_TIMEOUT", "the remote resource timed out");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError(504, "REMOTE_TIMEOUT", "the remote resource timed out")), remaining);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function destroyResponse(response: IncomingMessage): void {
  response.resume();
  response.destroy();
}

function requestPinned(target: Awaited<ReturnType<typeof resolveSafeRemoteTarget>>, deadline: number): Promise<RemoteResponse> {
  const url = target.url;
  const transport = url.protocol === "https:" ? https : http;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const path = `${url.pathname || "/"}${url.search}`;
  const timeout = remainingMs(deadline);
  if (timeout <= 0) return Promise.reject(new AppError(504, "REMOTE_TIMEOUT", "the remote resource timed out"));

  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let request: ReturnType<typeof transport.request> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      request?.destroy();
    }, timeout);
    const finishError = (error: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(timedOut ? new AppError(504, "REMOTE_TIMEOUT", "the remote resource timed out") : error);
    };
    try {
      request = transport.request({
        protocol: url.protocol,
        hostname,
        port: url.port || undefined,
        method: "GET",
        path,
        headers: {
          accept: "text/html, application/xhtml+xml, application/pdf, text/plain;q=0.8",
          "accept-encoding": "identity",
        },
        // Supplying lookup pins the socket to the vetted result. The URL
        // hostname and default TLS checks remain in place for certificate/SNI validation.
        lookup: pinnedLookup(target.address),
        servername: hostname,
        rejectUnauthorized: true,
        agent: false,
      }, (response) => {
        if (settled) {
          destroyResponse(response);
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, body: response });
      });
      request.once("error", finishError);
      request.end();
    } catch (error) {
      finishError(error);
    }
  });
}

async function readLimitedBody(response: RemoteResponse, deadline: number): Promise<Buffer> {
  const declaredLength = Number(headerValue(response.headers, "content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > CONTENT_LIMITS.maxBytes) {
    destroyResponse(response.body);
    throw new AppError(413, "CONTENT_TOO_LARGE", "the remote resource is larger than the allowed limit");
  }
  const encoding = headerValue(response.headers, "content-encoding")?.trim().toLowerCase();
  if (encoding && encoding !== "identity") {
    destroyResponse(response.body);
    throw new AppError(415, "UNSUPPORTED_CONTENT_ENCODING", "the remote resource must use identity content encoding");
  }

  const timeout = remainingMs(deadline);
  if (timeout <= 0) {
    destroyResponse(response.body);
    throw new AppError(504, "REMOTE_TIMEOUT", "the remote resource timed out");
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    response.body.destroy();
  }, timeout);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const value of response.body) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      total += chunk.byteLength;
      if (total > CONTENT_LIMITS.maxBytes) {
        destroyResponse(response.body);
        throw new AppError(413, "CONTENT_TOO_LARGE", "the remote resource is larger than the allowed limit");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (timedOut || remainingMs(deadline) <= 0) {
      throw new AppError(504, "REMOTE_TIMEOUT", "the remote resource timed out");
    }
    if (error instanceof AppError) throw error;
    throw new AppError(502, "REMOTE_FETCH_FAILED", "the remote resource could not be read");
  } finally {
    clearTimeout(timer);
    if (!response.body.readableEnded) response.body.destroy();
  }
  if (timedOut) throw new AppError(504, "REMOTE_TIMEOUT", "the remote resource timed out");
  return Buffer.concat(chunks);
}

async function fetchResource(
  inputUrl: string,
  redirectCount = 0,
  deadline = Date.now() + CONTENT_LIMITS.timeoutMs,
): Promise<{ response: RemoteResponse; finalUrl: URL; deadline: number }> {
  if (redirectCount > CONTENT_LIMITS.maxRedirects) {
    throw new AppError(422, "TOO_MANY_REDIRECTS", "the remote resource redirected too many times");
  }
  const target = await withDeadline(resolveSafeRemoteTarget(inputUrl), deadline);
  const response = await requestPinned(target, deadline).catch((error: unknown) => {
    if (error instanceof AppError) throw error;
    throw new AppError(502, "REMOTE_FETCH_FAILED", "the remote resource could not be fetched");
  });

  if (response.statusCode >= 300 && response.statusCode < 400) {
    const location = headerValue(response.headers, "location");
    destroyResponse(response.body);
    if (!location) throw new AppError(422, "INVALID_REDIRECT", "the remote resource returned an invalid redirect");
    const nextUrl = new URL(location, target.url).toString();
    return fetchResource(nextUrl, redirectCount + 1, deadline);
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    destroyResponse(response.body);
    throw new AppError(422, "REMOTE_FETCH_FAILED", `the remote resource returned HTTP ${response.statusCode}`);
  }
  return { response, finalUrl: target.url, deadline };
}

const PDF_PROCESS_SOURCE = `
  import { PDFParse } from "pdf-parse";
  const chunks = [];
  let total = 0;
  process.stdin.on("data", (chunk) => { total += chunk.length; if (total <= ${CONTENT_LIMITS.maxBytes}) chunks.push(chunk); });
  process.stdin.on("end", async () => {
    let parser;
    try {
      if (total > ${CONTENT_LIMITS.maxBytes}) throw new Error("input too large");
      parser = new PDFParse({ data: Buffer.concat(chunks) });
      const result = await parser.getText({ first: ${CONTENT_LIMITS.maxPdfPages}, lineEnforce: false, pageJoiner: "" });
      let text = "";
      for (const page of result.pages) {
        if (text.length >= ${CONTENT_LIMITS.maxTextCharacters}) break;
        text += page.text;
        if (text.length < ${CONTENT_LIMITS.maxTextCharacters}) text += "\\n";
      }
      process.stdout.write(JSON.stringify({ ok: true, text: text.slice(0, ${CONTENT_LIMITS.maxTextCharacters}) }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    } finally {
      if (parser) await parser.destroy();
    }
  });
`;

async function extractPdfTextInProcess(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      `--max-old-space-size=${CONTENT_LIMITS.pdfMaxOldGenerationMb}`,
      "--input-type=module",
      "-e",
      PDF_PROCESS_SOURCE,
    ], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let settled = false;
    const output: Buffer[] = [];
    let outputSize = 0;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new AppError(504, "PDF_PROCESSING_TIMEOUT", "the PDF took too long to process"));
    }, CONTENT_LIMITS.pdfTimeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      outputSize += chunk.byteLength;
      if (outputSize <= CONTENT_LIMITS.maxTextCharacters + 100) output.push(chunk);
      else child.kill();
    });
    child.once("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new AppError(422, "PDF_PROCESSING_FAILED", "the PDF could not be safely processed"));
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new AppError(422, "PDF_PROCESSING_FAILED", "the PDF could not be safely processed"));
        return;
      }
      try {
        const message = JSON.parse(Buffer.concat(output).toString("utf8")) as { ok?: boolean; text?: unknown };
        if (message.ok && typeof message.text === "string") resolve(message.text);
        else reject(new AppError(422, "PDF_PROCESSING_FAILED", "the PDF could not be safely processed"));
      } catch {
        reject(new AppError(422, "PDF_PROCESSING_FAILED", "the PDF could not be safely processed"));
      }
    });
    child.stdin.end(buffer);
  });
}

export async function extractPdfDocument(buffer: Buffer, finalUrl: string | URL): Promise<Omit<ExtractedResource, "contentHash">> {
  if (buffer.byteLength > CONTENT_LIMITS.maxBytes) {
    throw new AppError(413, "CONTENT_TOO_LARGE", "the PDF is larger than the allowed limit");
  }
  if (!buffer.subarray(0, 5).toString("ascii").startsWith("%PDF-")) {
    throw new AppError(422, "INVALID_PDF", "the resource was labeled as a PDF but has an invalid PDF header");
  }
  try {
    const text = truncateText(await extractPdfTextInProcess(buffer));
    if (!text) throw new AppError(422, "EMPTY_CONTENT", "the PDF did not contain readable text");
    return {
      finalUrl: canonicalizeUrl(finalUrl.toString()),
      contentType: "application/pdf",
      sourceDomain: new URL(finalUrl.toString()).hostname.toLowerCase(),
      text,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, "PDF_PROCESSING_FAILED", "the PDF could not be safely processed");
  }
}

export async function extractResource(url: string): Promise<ExtractedResource> {
  const { response, finalUrl, deadline } = await fetchResource(url);
  const buffer = await readLimitedBody(response, deadline);
  const contentType = (headerValue(response.headers, "content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const bodyPrefix = buffer.toString("utf8", 0, 512).toLowerCase();
  const looksLikePdf = contentType === "application/pdf" || finalUrl.pathname.toLowerCase().endsWith(".pdf");
  const result = looksLikePdf
    ? await extractPdfDocument(buffer, finalUrl)
    : contentType === "text/html" || contentType === "application/xhtml+xml" || (contentType === "" && bodyPrefix.includes("<html"))
      ? extractHtmlDocument(buffer.toString("utf8"), finalUrl.toString())
      : contentType === "text/plain"
        ? (() => {
          const text = truncateText(buffer.toString("utf8"));
          if (!text) throw new AppError(422, "EMPTY_CONTENT", "the resource did not contain readable text");
           return { finalUrl: canonicalizeUrl(finalUrl.toString()), contentType: "text/plain", sourceDomain: finalUrl.hostname.toLowerCase(), text };
        })()
        : (() => { throw new AppError(415, "UNSUPPORTED_CONTENT_TYPE", "the remote resource is not HTML, PDF, or plain text"); })();

  return {
    ...result,
    contentHash: createHash("sha256").update(buffer).digest("hex"),
  };
}
