import { FormEvent, useState } from "react";
import type { Category, Collection } from "../types";
import { ApiError, api } from "../api";
import { Modal, SpinnerButton } from "./AppLayout";

export function CollectionForm({ collection, categories, onClose, onSaved }: { collection?: Collection; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(collection?.name || "");
  const [description, setDescription] = useState(collection?.description || "");
  const [categoryId, setCategoryId] = useState(collection?.categoryId || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); if (!name.trim()) { setError("Give your collection a name."); return; } setLoading(true); setError(""); try { const payload = { name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), categoryId: categoryId || null }; if (collection) await api.collections.update(collection.id, payload); else await api.collections.create(payload); onSaved(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not save this collection."); } finally { setLoading(false); } }
  return <Modal title={collection ? "Edit collection" : "Make a collection"} onClose={onClose}><form className="stack-form modal-form" onSubmit={submit}><p className="form-hint">Collections are for a purpose or theme. Add and remove saved things whenever you like.</p><label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Weekend reading" autoFocus /></label><label>Description <span className="optional">optional</span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What belongs here?" /></label><label>Related shelf <span className="optional">optional</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">No shelf</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>{error && <div className="form-error" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><SpinnerButton className="primary-button" loading={loading}>{collection ? "Save collection" : "Create collection"}</SpinnerButton></div></form></Modal>;
}
