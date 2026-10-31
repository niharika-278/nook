import { useState } from "react";
import type { Bookmark } from "../types";

function StatusPill({ status }: { status: Bookmark["processingStatus"] }) {
  const labels = { PENDING: "Queued", PROCESSING: "Processing", COMPLETED: "Ready", FAILED: "Needs attention" };
  return <span className={`status-pill status-${status.toLowerCase()}`}><span className="status-dot" />{labels[status]}</span>;
}

export function BookmarkCard({ bookmark, onOpen, onRetry }: { bookmark: Bookmark; onOpen: () => void; onRetry: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const title = bookmark.title || bookmark.sourceDomain || "Untitled bookmark";
  const summary = bookmark.classification?.summary || bookmark.description;
  const categoryName = bookmark.category?.name || bookmark.classification?.categoryName;
  return <article className="bookmark-card" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}>
    <div className="card-image-wrap">
      {bookmark.previewImageUrl && !imageFailed ? <img src={bookmark.previewImageUrl} alt="" className="card-image" onError={() => setImageFailed(true)} /> : <div className="card-image card-image-fallback"><span>{title.slice(0, 1).toUpperCase()}</span></div>}
      {bookmark.duplicateType && bookmark.duplicateType !== "NONE" && <span className="duplicate-badge">Possible duplicate</span>}
    </div>
    <div className="card-body">
      <div className="domain-row">{bookmark.faviconUrl ? <img src={bookmark.faviconUrl} alt="" className="favicon" /> : <span className="favicon favicon-fallback">↗</span>}<span>{bookmark.sourceDomain || "Unknown source"}</span><span className="card-date">{new Date(bookmark.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div>
       <h3>{title}</h3>
       {categoryName && <span className="category-badge ai-category-badge">{categoryName}</span>}
      {summary && <p className="card-summary">{summary}</p>}
      <div className="card-footer"><StatusPill status={bookmark.processingStatus} /><div className="tag-row">{bookmark.tags.slice(0, 2).map(({ tag }) => <span className="tag-chip" key={tag.id}>#{tag.name}</span>)}{bookmark.tags.length > 2 && <span className="tag-more">+{bookmark.tags.length - 2}</span>}</div></div>
      {bookmark.processingStatus === "FAILED" && <button className="retry-link" onClick={(event) => { event.stopPropagation(); onRetry(); }}>Retry processing ↗</button>}
    </div>
  </article>;
}

export function BookmarkSkeleton() {
  return <div className="bookmark-card skeleton-card"><div className="skeleton skeleton-image" /><div className="skeleton-content"><span className="skeleton skeleton-line short" /><span className="skeleton skeleton-line" /><span className="skeleton skeleton-line medium" /><span className="skeleton skeleton-line short" /></div></div>;
}
