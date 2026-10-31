import type {
  Bookmark, Category, Collection, CollectionDetail, CollectionSuggestion, Correction, Paginated, ProcessedBookmark, Tag, User,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";
const TOKEN_KEY = "nook.auth.token";
const SESSION_EXPIRED_EVENT = "nook:session-expired";

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
  localStorage.removeItem(TOKEN_KEY);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

export function onSessionExpired(listener: () => void): () => void {
  const handler = () => listener();
  window.addEventListener(SESSION_EXPIRED_EVENT, handler);
  return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: init.signal ?? controller.signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") {
      throw new ApiError("Nook took too long to respond. Please try again.", 0, "REQUEST_TIMEOUT");
    }
    throw new ApiError("Nook could not reach the API. Is the backend running?", 0, "NETWORK_ERROR");
  } finally {
    window.clearTimeout(timeout);
  }

  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? body.error : null;
    const message = error && typeof error === "object" && error && "message" in error && typeof error.message === "string"
      ? error.message
      : `Request failed (${response.status})`;
    const code = error && typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : undefined;
    if (response.status === 401 && !path.startsWith("/auth/login") && !path.startsWith("/auth/register")) {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(message, response.status, code);
  }
  if (!body || typeof body !== "object" || !("data" in body)) return body as T;
  return body.data as T;
}

const query = (values: Record<string, string | number | undefined>): string => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  const result = params.toString();
  return result ? `?${result}` : "";
};

export const api = {
  auth: {
    login: (email: string, password: string) => request<{ token: string; user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
    register: (email: string, password: string, displayName?: string) => request<{ token: string; user: User }>("/auth/register", { method: "POST", body: JSON.stringify({ email, password, ...(displayName ? { displayName } : {}) }) }),
    me: () => request<{ user: User }>("/auth/me"),
  },
  bookmarks: {
    list: (values: { page?: number; limit?: number; categoryId?: string; tag?: string; status?: string; q?: string }) => request<Paginated<Bookmark>>(`/bookmarks${query(values)}`),
    get: (id: string) => request<Bookmark>(`/bookmarks/${id}`),
    create: (payload: { url: string; title?: string; description?: string; categoryId?: string; tags?: string[] }) => request<Bookmark>("/bookmarks", { method: "POST", body: JSON.stringify(payload) }),
    update: (id: string, payload: { url?: string; title?: string; description?: string; categoryId?: string | null; tags?: string[] }) => request<Bookmark>(`/bookmarks/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    remove: (id: string) => request<void>(`/bookmarks/${id}`, { method: "DELETE" }),
    removeTag: (id: string, tagId: string) => request<void>(`/bookmarks/${id}/tags/${tagId}`, { method: "DELETE" }),
    process: (id: string) => request<ProcessedBookmark>(`/bookmarks/${id}/process`, { method: "POST" }),
    correct: (id: string, payload: { category?: string | null; tags?: string[]; reason?: string }) => request<Correction>(`/bookmarks/${id}/correction`, { method: "POST", body: JSON.stringify(payload) }),
  },
  categories: {
    list: () => request<Category[]>("/categories"),
    create: (name: string) => request<Category>("/categories", { method: "POST", body: JSON.stringify({ name }) }),
    update: (id: string, name: string) => request<Category>(`/categories/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    remove: (id: string) => request<void>(`/categories/${id}`, { method: "DELETE" }),
  },
  tags: { list: () => request<Tag[]>("/tags?limit=100") },
  collections: {
    list: (page = 1) => request<Paginated<Collection>>(`/collections${query({ page, limit: 24 })}`),
    get: (id: string) => request<CollectionDetail>(`/collections/${id}`),
    create: (payload: { name: string; description?: string; categoryId?: string | null }) => request<Collection>("/collections", { method: "POST", body: JSON.stringify(payload) }),
    update: (id: string, payload: { name: string; description?: string; categoryId?: string | null }) => request<Collection>(`/collections/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    remove: (id: string) => request<void>(`/collections/${id}`, { method: "DELETE" }),
    addBookmark: (id: string, bookmarkId: string) => request<{ collectionId: string; bookmarkId: string }>(`/collections/${id}/bookmarks`, { method: "POST", body: JSON.stringify({ bookmarkId }) }),
    removeBookmark: (id: string, bookmarkId: string) => request<void>(`/collections/${id}/bookmarks/${bookmarkId}`, { method: "DELETE" }),
  },
  suggestions: {
    list: (status = "PENDING") => request<CollectionSuggestion[]>(`/collection-suggestions${query({ status, limit: 50 })}`),
    generate: () => request<CollectionSuggestion[]>("/collection-suggestions/generate", { method: "POST" }),
    accept: (id: string) => request<Collection>(`/collection-suggestions/${id}/accept`, { method: "POST" }),
    reject: (id: string) => request<void>(`/collection-suggestions/${id}/reject`, { method: "POST" }),
  },
};
