import dns from "node:dns/promises";
import net from "node:net";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { AppError } from "./errors.js";

const trackingParameters = /^(utm_[a-z0-9_]+|fbclid|gclid)$/i;

function parseHttpUrl(input: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new AppError(400, "INVALID_URL", "url must be a valid absolute URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError(400, "UNSUPPORTED_URL_SCHEME", "only http and https URLs are supported");
  }
  if (parsed.username || parsed.password) {
    throw new AppError(400, "URL_CREDENTIALS_NOT_ALLOWED", "URLs containing credentials are not allowed");
  }
  return parsed;
}

export function canonicalizeUrl(input: string): string {
  const parsed = parseHttpUrl(input);

  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.port === "80" && parsed.protocol === "http:") parsed.port = "";
  if (parsed.port === "443" && parsed.protocol === "https:") parsed.port = "";
  parsed.hash = "";
  if (!parsed.pathname) parsed.pathname = "/";

  const retainedParameters = [...parsed.searchParams.entries()]
    .filter(([name]) => !trackingParameters.test(name))
    .sort(([leftName, leftValue], [rightName, rightValue]) =>
      leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue),
    );
  parsed.search = "";
  for (const [name, value] of retainedParameters) parsed.searchParams.append(name, value);

  return parsed.toString();
}

function ipv4ToBytes(address: string): number[] | undefined {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return undefined;
  }
  return octets;
}

function isNonPublicIpv4(address: string): boolean {
  const octets = ipv4ToBytes(address);
  if (!octets) return true;
  const [first = -1, second, third] = octets;
  const inRange = (a: number, b: number, c = 0, d = 255): boolean =>
    first === a && second !== undefined && second >= b && second <= c && (third === undefined || (third >= 0 && third <= d));

  // RFC 1918, loopback, link-local, CGNAT, documentation, benchmarking,
  // protocol assignments, multicast, and the reserved/broadcast ranges.
  return first === 0 || first === 10 || first === 127 ||
    (first === 100 && second !== undefined && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && second !== undefined && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224 || inRange(192, 0, 0, 255);
}

function ipv6ToBytes(address: string): number[] | undefined {
  const withoutZone = address.split("%", 1)[0];
  if (!withoutZone) return undefined;
  const halves = withoutZone.split("::");
  if (halves.length > 2) return undefined;
  const parsePart = (part: string): number[] | undefined => {
    if (!part) return [];
    const pieces = part.split(":");
    const result: number[] = [];
    for (const piece of pieces) {
      if (piece.includes(".")) {
        const ipv4 = ipv4ToBytes(piece);
        if (!ipv4) return undefined;
        result.push((ipv4[0] ?? 0), (ipv4[1] ?? 0), (ipv4[2] ?? 0), (ipv4[3] ?? 0));
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(piece)) return undefined;
      const value = Number.parseInt(piece, 16);
      result.push(value >> 8, value & 0xff);
    }
    return result;
  };

  const left = parsePart(halves[0] ?? "");
  const right = parsePart(halves[1] ?? "");
  if (!left || !right) return undefined;
  if (halves.length === 1) return left.length === 16 ? left : undefined;
  if (left.length + right.length >= 16) return undefined;
  return [...left, ...Array.from({ length: 16 - left.length - right.length }, () => 0), ...right];
}

function bytesStartWith(bytes: number[], prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function isNonPublicIpv6(address: string): boolean {
  const bytes = ipv6ToBytes(address);
  if (!bytes) return true;

  // IPv4-mapped and IPv4-compatible IPv6 addresses are not public IPv6
  // destinations, even when their embedded IPv4 value happens to be public.
  const isMapped = bytesStartWith(bytes, [0, 0, 0, 0, 0, 0, 0xff, 0xff]);
  const isCompatible = bytes.slice(0, 12).every((value) => value === 0);
  if (isMapped) return true;
  if (isCompatible) return true;

  const first = bytes[0] ?? 0;
  const second = bytes[1] ?? 0;
  const first16 = (first << 8) | second;
  // Unspecified/loopback, ULA, link-local, multicast, documentation and
  // other IANA special-purpose/reserved IPv6 blocks.
  if (first16 === 0 || (first16 & 0xfe00) === 0xfc00 || (first16 & 0xffc0) === 0xfe80 || first === 0xff) return true;
  if (bytesStartWith(bytes, [0x20, 0x01, 0x00, 0x00]) ||
    bytesStartWith(bytes, [0x20, 0x01, 0x00, 0x02]) ||
    bytesStartWith(bytes, [0x20, 0x01, 0x00, 0x10]) ||
    bytesStartWith(bytes, [0x20, 0x01, 0x00, 0x20]) ||
    bytesStartWith(bytes, [0x20, 0x01, 0x0d, 0xb8]) ||
    bytesStartWith(bytes, [0x3f, 0xff]) ||
    bytesStartWith(bytes, [0x64, 0xff, 0x9b]) ||
    bytesStartWith(bytes, [0x01, 0x00]) ||
    (bytesStartWith(bytes, [0x20, 0x02]) && isNonPublicIpv4(bytes.slice(2, 6).join(".")))) return true;
  return false;
}

function isNonPublicAddress(address: string): boolean {
  if (net.isIPv4(address)) return isNonPublicIpv4(address);
  if (net.isIPv6(address)) return isNonPublicIpv6(address);
  return true;
}

function hostForLookup(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

export interface SafeRemoteTarget {
  url: URL;
  address: string;
}

/** Resolve and validate one URL, returning the address that the request must pin. */
export async function resolveSafeRemoteTarget(input: string): Promise<SafeRemoteTarget> {
  const parsed = parseHttpUrl(input);
  const hostname = hostForLookup(parsed);
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new AppError(400, "PRIVATE_URL_BLOCKED", "local network URLs cannot be processed");
  }

  if (net.isIP(hostname)) {
    if (isNonPublicAddress(hostname)) {
      throw new AppError(400, "PRIVATE_URL_BLOCKED", "private network URLs cannot be processed");
    }
    return { url: parsed, address: hostname };
  }

  let addresses: LookupAddress[];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new AppError(400, "HOST_NOT_RESOLVABLE", "the URL host could not be resolved");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isNonPublicAddress(address))) {
    throw new AppError(400, "PRIVATE_URL_BLOCKED", "the URL resolves to a private network address");
  }
  const address = addresses[0]?.address;
  if (!address) throw new AppError(400, "HOST_NOT_RESOLVABLE", "the URL host could not be resolved");
  return { url: parsed, address };
}

/** Validate a URL without exposing the canonicalized query to callers. */
export async function assertSafeRemoteUrl(input: string): Promise<URL> {
  return (await resolveSafeRemoteTarget(input)).url;
}

/** A lookup function that can only return the address vetted for this request. */
export function pinnedLookup(address: string): LookupFunction {
  const family = net.isIPv4(address) ? 4 : 6;
  return (_hostname, _options, callback) => callback(null, address, family);
}
