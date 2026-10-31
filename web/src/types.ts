export type ProcessingStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
export type SuggestionStatus = "PENDING" | "ACCEPTED" | "REJECTED";

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}

export interface Category {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  _count?: { bookmarks: number };
}

export interface Tag {
  id: string;
  userId: string;
  name: string;
  normalizedName: string;
  createdAt: string;
  _count?: { bookmarks: number };
}

export interface BookmarkTag {
  bookmarkId: string;
  tagId: string;
  createdAt: string;
  tag: Tag;
}

export interface Classification {
  id: string;
  bookmarkId: string;
  provider: string;
  model: string;
  categoryName: string | null;
  tags: string;
  summary: string | null;
  confidence: number | null;
  promptVersion: string;
  classificationStage: "METADATA" | "CONTENT" | string;
  createdAt: string;
}

export interface Bookmark {
  id: string;
  userId: string;
  categoryId: string | null;
  categorySource: "NONE" | "AI" | "MANUAL" | string;
  url: string;
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  author: string | null;
  publishedAt: string | null;
  faviconUrl: string | null;
  previewImageUrl: string | null;
  sourceDomain: string | null;
  contentType: string | null;
  extractedText: string | null;
  contentHash: string | null;
  processingStatus: ProcessingStatus;
  processingError: string | null;
  contentStatus: ProcessingStatus;
  contentError: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
  category: Category | null;
  tags: BookmarkTag[];
  classification?: Classification | null;
  duplicateType?: string;
  duplicateOfId?: string | null;
}

/** The process endpoint returns the bookmark plus its classification, without list relations. */
export type ProcessedBookmark = Omit<Bookmark, "category" | "tags"> & {
  classification: Classification | null;
};

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export interface Collection {
  id: string;
  userId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  source: "MANUAL" | "AI" | string;
  createdAt: string;
  updatedAt: string;
  category: Category | null;
  _count: { bookmarks: number };
}

export interface CollectionBookmark {
  collectionId: string;
  bookmarkId: string;
  createdAt: string;
  bookmark: Bookmark;
}

export interface CollectionDetail extends Collection {
  bookmarks: CollectionBookmark[];
}

export interface CollectionSuggestionBookmark {
  suggestionId: string;
  bookmarkId: string;
  createdAt: string;
  bookmark: { id: string; title: string | null; url: string };
}

export interface CollectionSuggestion {
  id: string;
  userId: string;
  name: string;
  description: string;
  status: SuggestionStatus;
  provider: string;
  model: string;
  createdAt: string;
  reviewedAt: string | null;
  bookmarks: CollectionSuggestionBookmark[];
}

export interface Correction {
  id: string;
  userId: string;
  bookmarkId: string;
  domain: string;
  contentType: string | null;
  originalCategory: string | null;
  correctedCategory: string | null;
  originalTags: string | null;
  correctedTags: string;
  keywords: string;
  reason: string | null;
  createdAt: string;
}
