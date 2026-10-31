import { FormEvent, useState } from "react";
import type { Category } from "../types";
import { ApiError, api } from "../api";
import { Modal, SpinnerButton } from "./AppLayout";

export function BookmarkForm({ categories, onClose, onCreated }: { categories: Category[]; onClose: () => void; onCreated: () => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    try { const parsed = new URL(url); if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported protocol"); } catch { setError("Enter a complete URL beginning with http:// or https://."); return; }
    setLoading(true);
    try {
      await api.bookmarks.create({ url: url.trim(), ...(title.trim() ? { title: title.trim() } : {}), ...(description.trim() ? { description: description.trim() } : {}), ...(categoryId ? { categoryId } : {}), ...(tags.trim() ? { tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) } : {}) });
      onCreated();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "We could not save that bookmark."); }
    finally { setLoading(false); }
  }

  return <Modal title="Save something good" onClose={onClose}>
    <form className="stack-form modal-form" onSubmit={submit}><p className="form-hint">Nook will fetch the page and organize it in the background.</p>
      <label>URL <input required type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" autoFocus /></label>
      <div className="form-grid"><label>Title <span className="optional">optional</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="A memorable title" /></label><label>Category <span className="optional">optional</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Let Nook decide</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div>
      <label>Description <span className="optional">optional</span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="A note for future you" /></label>
      <label>Tags <span className="optional">optional · comma separated</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="reading, inspiration, work" /></label>
      {error && <div className="form-error" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><SpinnerButton className="primary-button" loading={loading}>Save bookmark</SpinnerButton></div>
    </form>
  </Modal>;
}
