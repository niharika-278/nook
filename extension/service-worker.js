/* global chrome, document, fetch, URL */

const DEFAULT_API_BASE_URL = "http://localhost:3000";
const DEFAULT_APP_URL = "http://localhost:5173";
const STORAGE_KEYS = Object.freeze({
  apiBaseUrl: "apiBaseUrl",
  token: "authToken",
  user: "authUser"
});
const PROCESSING_STATUSES = new Set(["PENDING", "PROCESSING", "COMPLETED", "FAILED"]);

class ClientError extends Error {
  constructor(code, message, status = 0, details) {
    super(message);
    this.name = "ClientError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

class ApiError extends ClientError {
  constructor(status, code, message, details) {
    super(code, message, status, details);
    this.name = "ApiError";
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeApiBaseUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return DEFAULT_API_BASE_URL;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ClientError("INVALID_API_BASE_URL", "Enter a valid HTTP or HTTPS URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ClientError("INVALID_API_BASE_URL", "The API URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new ClientError("INVALID_API_BASE_URL", "Use the API origin only, such as http://localhost:3000.");
  }
  return parsed.origin;
}

async function readStorage(keys) {
  return chrome.storage.local.get(keys);
}

async function writeStorage(values) {
  await chrome.storage.local.set(values);
}

async function clearSession() {
  await chrome.storage.local.remove([STORAGE_KEYS.token, STORAGE_KEYS.user]);
}

async function getApiBaseUrl() {
  const values = await readStorage([STORAGE_KEYS.apiBaseUrl]);
  try {
    return normalizeApiBaseUrl(values[STORAGE_KEYS.apiBaseUrl]);
  } catch {
    return DEFAULT_API_BASE_URL;
  }
}

function validateUser(user) {
  if (!isRecord(user) || typeof user.id !== "string" || typeof user.email !== "string" || typeof user.createdAt !== "string") {
    throw new ClientError("INVALID_SERVER_RESPONSE", "Nook returned an invalid user response.");
  }
  if (user.displayName !== null && typeof user.displayName !== "string") {
    throw new ClientError("INVALID_SERVER_RESPONSE", "Nook returned an invalid user response.");
  }
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt
  };
}

function requireDataEnvelope(payload) {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new ClientError("INVALID_SERVER_RESPONSE", "Nook returned an invalid response.");
  }
  return payload.data;
}

function validateAuthResponse(payload) {
  const data = requireDataEnvelope(payload);
  if (typeof data.token !== "string" || data.token.length < 1) {
    throw new ClientError("INVALID_SERVER_RESPONSE", "Nook returned an invalid authentication response.");
  }
  return { token: data.token, user: validateUser(data.user) };
}

function validateMeResponse(payload) {
  const data = requireDataEnvelope(payload);
  return { user: validateUser(data.user) };
}

function validateBookmarkResponse(payload) {
  const bookmark = requireDataEnvelope(payload);
  if (
    typeof bookmark.id !== "string" ||
    typeof bookmark.url !== "string" ||
    typeof bookmark.processingStatus !== "string" ||
    !PROCESSING_STATUSES.has(bookmark.processingStatus)
  ) {
    throw new ClientError("INVALID_SERVER_RESPONSE", "Nook returned an invalid bookmark response.");
  }
  if (bookmark.title !== null && typeof bookmark.title !== "string") {
    throw new ClientError("INVALID_SERVER_RESPONSE", "Nook returned an invalid bookmark response.");
  }
  if (bookmark.description !== null && typeof bookmark.description !== "string") {
    throw new ClientError("INVALID_SERVER_RESPONSE", "Nook returned an invalid bookmark response.");
  }
  return bookmark;
}

function readStructuredError(status, payload) {
  if (!isRecord(payload) || !isRecord(payload.error) || typeof payload.error.code !== "string" || typeof payload.error.message !== "string") {
    throw new ClientError("INVALID_SERVER_RESPONSE", "Nook returned an invalid error response.", status);
  }
  return new ApiError(status, payload.error.code, payload.error.message, payload.error.details);
}

async function requestApi(path, { method = "GET", body, token } = {}) {
  const baseUrl = await getApiBaseUrl();
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ClientError("NETWORK_ERROR", "Nook could not be reached.");
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ClientError("INVALID_SERVER_RESPONSE", "Nook returned an invalid response.", response.status);
    }
  }
  if (!response.ok) throw readStructuredError(response.status, payload);
  if (response.status === 204) return null;
  if (payload === null) throw new ClientError("INVALID_SERVER_RESPONSE", "Nook returned an empty response.", response.status);
  return payload;
}

function serializeError(error) {
  if (error instanceof ClientError) {
    return { code: error.code, status: error.status, message: error.message };
  }
  return { code: "CLIENT_ERROR", status: 0, message: "Nook could not complete the request." };
}

function isUnauthorized(error) {
  return error instanceof ApiError && (error.status === 401 || error.code === "AUTHENTICATION_REQUIRED" || error.code === "INVALID_TOKEN");
}

function cleanPageField(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function captureActivePage() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch {
    throw new ClientError("PAGE_UNAVAILABLE", "Nook could not read the current tab.");
  }

  const tab = tabs[0];
  if (!tab || typeof tab.id !== "number" || !isWebUrl(tab.url)) {
    throw new ClientError("PAGE_UNAVAILABLE", "This browser page cannot be saved. Open a regular HTTP or HTTPS page first.");
  }

  let metadata = {};
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const description = document.querySelector('meta[name="description"]')?.getAttribute("content")
          || document.querySelector('meta[property="og:description"]')?.getAttribute("content")
          || "";
        return { title: document.title, description };
      }
    });
    if (Array.isArray(results) && isRecord(results[0]?.result)) metadata = results[0].result;
  } catch {
    // activeTab can be unavailable on browser-owned pages. The tab URL/title remain useful fallbacks.
  }

  const title = cleanPageField(metadata.title || tab.title, 500);
  const description = cleanPageField(metadata.description, 5000);
  return {
    url: tab.url,
    ...(title ? { title } : {}),
    ...(description ? { description } : {})
  };
}

function publicBookmark(bookmark) {
  return {
    id: bookmark.id,
    url: bookmark.url,
    title: bookmark.title,
    description: bookmark.description,
    processingStatus: bookmark.processingStatus
  };
}

async function getSession() {
  const values = await readStorage([STORAGE_KEYS.token, STORAGE_KEYS.user]);
  const token = typeof values[STORAGE_KEYS.token] === "string" ? values[STORAGE_KEYS.token] : "";
  if (!token) return { ok: true, authenticated: false, status: "not-authenticated" };

  try {
    const response = validateMeResponse(await requestApi("/api/auth/me", { token }));
    await writeStorage({ [STORAGE_KEYS.user]: response.user });
    return { ok: true, authenticated: true, user: response.user };
  } catch (error) {
    if (isUnauthorized(error)) {
      await clearSession();
      return { ok: true, authenticated: false, status: "not-authenticated" };
    }
    return { ok: false, status: "error", error: serializeError(error) };
  }
}

async function authenticate(message) {
  const mode = message.mode === "register" ? "register" : "login";
  const body = {
    email: typeof message.email === "string" ? message.email : "",
    password: typeof message.password === "string" ? message.password : ""
  };
  if (mode === "register" && typeof message.displayName === "string" && message.displayName.trim()) {
    body.displayName = message.displayName;
  }

  const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";
  const auth = validateAuthResponse(await requestApi(path, { method: "POST", body }));
  await writeStorage({ [STORAGE_KEYS.token]: auth.token, [STORAGE_KEYS.user]: auth.user });
  return { ok: true, authenticated: true, user: auth.user };
}

async function saveCurrentPage() {
  const values = await readStorage([STORAGE_KEYS.token]);
  const token = typeof values[STORAGE_KEYS.token] === "string" ? values[STORAGE_KEYS.token] : "";
  if (!token) return { ok: true, status: "not-authenticated" };

  const page = await captureActivePage();
  try {
    const bookmark = validateBookmarkResponse(await requestApi("/api/bookmarks", {
      method: "POST",
      token,
      // Page metadata is untrusted data. Only these three fields ever leave the extension.
      body: page
    }));
    const status = bookmark.processingStatus === "COMPLETED"
      ? "saved"
      : bookmark.processingStatus === "FAILED"
        ? "error"
        : "processing";
    return { ok: true, status, page, bookmark: publicBookmark(bookmark) };
  } catch (error) {
    if (isUnauthorized(error)) {
      await clearSession();
      return { ok: true, status: "not-authenticated" };
    }
    if (error instanceof ApiError && error.status === 409 && error.code === "EXACT_DUPLICATE") {
      const existingBookmarkId = isRecord(error.details) && typeof error.details.existingBookmarkId === "string"
        ? error.details.existingBookmarkId
        : undefined;
      return { ok: true, status: "duplicate", page, ...(existingBookmarkId ? { existingBookmarkId } : {}) };
    }
    return { ok: false, status: "error", error: serializeError(error), page };
  }
}

async function handleMessage(message) {
  if (!isRecord(message) || typeof message.type !== "string") {
    return { ok: false, status: "error", error: { code: "INVALID_MESSAGE", status: 0, message: "Invalid extension message." } };
  }

  switch (message.type) {
    case "GET_SESSION":
      return getSession();
    case "AUTH_SUBMIT":
      try {
        return await authenticate(message);
      } catch (error) {
        return { ok: false, status: "error", error: serializeError(error) };
      }
    case "SAVE_CURRENT_PAGE":
      try {
        return await saveCurrentPage();
      } catch (error) {
        return { ok: false, status: "error", error: serializeError(error) };
      }
    case "LOGOUT":
      await clearSession();
      return { ok: true, authenticated: false, status: "not-authenticated" };
    case "GET_CONFIG":
      return { ok: true, apiBaseUrl: await getApiBaseUrl(), appUrl: DEFAULT_APP_URL };
    case "SET_CONFIG":
      try {
        const apiBaseUrl = normalizeApiBaseUrl(message.apiBaseUrl);
        await writeStorage({ [STORAGE_KEYS.apiBaseUrl]: apiBaseUrl });
        return { ok: true, apiBaseUrl };
      } catch (error) {
        return { ok: false, status: "error", error: serializeError(error) };
      }
    default:
      return { ok: false, status: "error", error: { code: "UNKNOWN_MESSAGE", status: 0, message: "Unknown extension message." } };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, status: "error", error: serializeError(error) }));
  return true;
});
