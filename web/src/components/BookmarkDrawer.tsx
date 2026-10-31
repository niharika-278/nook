import { FormEvent, useEffect, useState } from "react";
import type { Bookmark, Category } from "../types";
import { ApiError, api } from "../api";
import { SpinnerButton } from "./AppLayout";

function displayTitle(bookmark: Bookmark): string { return bookmark.title || bookmark.sourceDomain || "Untitled bookmark"; }

export function BookmarkDrawer({ bookmark, categories, onClose, onChanged }: { bookmark: Bookmark; categories: Category[]; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState(bookmark);
  const [title, setTitle] = useState(bookmark.title || "");
  const [description, setDescription] = useState(bookmark.description || "");
  const [categoryId, setCategoryId] = useState(bookmark.categoryId || "");
  const [tags, setTags] = useState(bookmark.tags.map(({ tag }) => tag.name).join(", "));
  const [correctionCategory, setCorrectionCategory] = useState(bookmark.category?.name || "");
  const [correctionTags, setCorrectionTags] = useState(bookmark.tags.map(({ tag }) => tag.name).join(", "));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [processLoading, setProcessLoading] = useState(false);
  const [correctionLoading, setCorrectionLoading] = useState(false);

  useEffect(() => { api.bookmarks.get(bookmark.id).then((fresh) => { setDetail(fresh); setTitle(fresh.title || ""); setDescription(fresh.description || ""); setCategoryId(fresh.categoryId || ""); setTags(fresh.tags.map(({ tag }) => tag.name).join(", ")); setCorrectionCategory(fresh.category?.name || ""); setCorrectionTags(fresh.tags.map(({ tag }) => tag.name).join(", ")); }).catch(() => undefined); }, [bookmark.id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaveLoading(true); setError("");
    const nextTags = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
    try {
      const updated = await api.bookmarks.update(detail.id, { title, description, categoryId: categoryId || null, tags: nextTags });
      const previousTags = detail.tags.map(({ tag }) => tag.name).join("|");
      const nextTagKey = nextTags.join("|");
      const categoryChanged = (detail.categoryId || "") !== categoryId;
      const tagsChanged = previousTags !== nextTagKey;
      if (categoryChanged || tagsChanged) {
        await api.bookmarks.correct(detail.id, {
          category: categoryId ? (categories.find((category) => category.id === categoryId)?.name ?? null) : null,
          tags: nextTags,
          reason: "Updated from bookmark details",
        });
      }
      setDetail(updated); onChanged();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not update this bookmark."); }
    finally { setSaveLoading(false); }
  }
  async function retry() { setProcessLoading(true); setError(""); try { await api.bookmarks.process(detail.id); const fresh = await api.bookmarks.get(detail.id); setDetail(fresh); onChanged(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Processing could not be retried."); } finally { setProcessLoading(false); } }
  async function correct(event: FormEvent) { event.preventDefault(); const correctedTags = correctionTags.split(",").map((tag) => tag.trim()).filter(Boolean); setCorrectionLoading(true); setError(""); try { await api.bookmarks.correct(detail.id, { category: correctionCategory.trim() || null, ...(correctedTags.length ? { tags: correctedTags } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) }); const fresh = await api.bookmarks.get(detail.id); setDetail(fresh); setCategoryId(fresh.categoryId || ""); setTags(fresh.tags.map(({ tag }) => tag.name).join(", ")); onChanged(); setReason(""); } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not save that correction."); } finally { setCorrectionLoading(false); } }
  async function removeTag(tagId: string) { setError(""); try { await api.bookmarks.removeTag(detail.id, tagId); const fresh = await api.bookmarks.get(detail.id); setDetail(fresh); setTags(fresh.tags.map(({ tag }) => tag.name).join(", ")); setCorrectionTags(fresh.tags.map(({ tag }) => tag.name).join(", ")); onChanged(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not remove this tag."); } }
  async function remove() { if (!window.confirm("Remove this bookmark from your library?")) return; try { await api.bookmarks.remove(detail.id); onChanged(); onClose(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not remove this bookmark."); } }

   const statusLabels = { PENDING: "Queued for organizing", PROCESSING: "Being understood", COMPLETED: "Organized and ready", FAILED: "Processing needs a retry" };
   const contentMessage = detail.contentStatus === "FAILED"
     ? "The source page blocked content enrichment, so Nook organized this bookmark from its saved metadata."
     : detail.contentStatus === "PROCESSING"
       ? "Nook is fetching the source to enrich this bookmark."
       : detail.contentStatus === "COMPLETED"
         ? "Source content enriched this bookmark."
         : "Nook will try source enrichment after metadata is organized.";
   const suggestedCategory = detail.classification?.categoryName;
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="detail-drawer" role="dialog" aria-modal="true" aria-label={`Details for ${displayTitle(detail)}`}>
    <div className="drawer-top"><span className="eyebrow">Bookmark details</span><button className="icon-button" onClick={onClose} aria-label="Close details">×</button></div>
    <div className="drawer-hero">{detail.previewImageUrl ? <img src={detail.previewImageUrl} alt="" /> : <div className="drawer-hero-fallback">{displayTitle(detail).slice(0, 1)}</div>}</div>
    <div className="drawer-content"><div className="drawer-domain">{detail.faviconUrl && <img src={detail.faviconUrl} alt="" className="favicon" />} {detail.sourceDomain || "Unknown source"}</div><h2>{displayTitle(detail)}</h2><a href={detail.url} target="_blank" rel="noopener noreferrer" className="external-link">Open original ↗</a>
       <div className={`processing-callout processing-${detail.processingStatus.toLowerCase()}`}><strong>{statusLabels[detail.processingStatus]}</strong><p>{contentMessage}</p>{detail.processingError && <p>Nook saved this bookmark safely, but could not finish organizing it yet.</p>}{(detail.processingStatus === "FAILED" || detail.processingStatus === "PENDING") && <SpinnerButton className="text-button" onClick={() => void retry()} loading={processLoading}>Retry processing</SpinnerButton>}</div>
      {detail.duplicateType && detail.duplicateType !== "NONE" && <div className="duplicate-callout"><strong>Possible duplicate</strong><p>Nook found another saved resource with similar content. Both bookmarks are kept for you to review.</p></div>}
      {error && <div className="form-error" role="alert">{error}</div>}
       <form className="drawer-section stack-form" onSubmit={save}><div className="section-heading"><h3>Edit bookmark</h3><span>Manual changes stay yours</span></div>{suggestedCategory && !detail.category && <p className="form-hint">Nook suggests <strong>{suggestedCategory}</strong>. You can choose a shelf below or leave it as a suggestion.</p>}<label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Note / description<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>Category<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">No category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Tags <span className="optional">comma separated</span><input value={tags} onChange={(event) => setTags(event.target.value)} /></label><div className="tag-row detail-tags">{detail.tags.map(({ tag }) => <span className="tag-chip removable-tag" key={tag.id}>#{tag.name}<button type="button" onClick={() => void removeTag(tag.id)} aria-label={`Remove tag ${tag.name}`}>×</button></span>)}</div><SpinnerButton className="primary-button" loading={saveLoading}>Save changes</SpinnerButton></form>
      <form className="drawer-section stack-form correction-section" onSubmit={correct}><div className="section-heading"><h3>Teach Nook</h3><span>Help future saves feel more like yours</span></div><label>Preferred category<select value={correctionCategory} onChange={(event) => setCorrectionCategory(event.target.value)}><option value="">Clear category</option>{categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}</select></label><label>Preferred tags <span className="optional">comma separated</span><input value={correctionTags} onChange={(event) => setCorrectionTags(event.target.value)} /></label><label>Why? <span className="optional">optional</span><textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="This is more useful to me because…" /></label><SpinnerButton className="secondary-button" loading={correctionLoading}>Save correction</SpinnerButton></form>
      <button className="delete-button" onClick={() => void remove()}>Remove bookmark</button>
    </div>
  </aside></div>;
}
