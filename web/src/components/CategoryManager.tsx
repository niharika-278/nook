import { FormEvent, useState } from "react";
import type { Category } from "../types";
import { ApiError, api } from "../api";
import { Modal, SpinnerButton } from "./AppLayout";

export function CategoryManager({ categories, onClose, onChanged }: { categories: Category[]; onClose: () => void; onChanged: () => void }) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(event: FormEvent) { event.preventDefault(); if (!newName.trim()) return; setBusy(true); setError(""); try { await api.categories.create(newName.trim()); setNewName(""); onChanged(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not create category."); } finally { setBusy(false); } }
  async function rename(id: string) { if (!editingName.trim()) return; setBusy(true); setError(""); try { await api.categories.update(id, editingName.trim()); setEditingId(null); onChanged(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not rename category."); } finally { setBusy(false); } }
  async function remove(id: string) { if (!window.confirm("Delete this category? Bookmarks will stay safe and become uncategorized.")) return; setBusy(true); setError(""); try { await api.categories.remove(id); onChanged(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not delete category."); } finally { setBusy(false); } }

  return <Modal title="Shape your shelves" onClose={onClose}><div className="category-manager"><p className="form-hint">Categories describe what a bookmark is. You can move bookmarks between them from their detail view.</p><form className="inline-form" onSubmit={create}><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="New category name" aria-label="New category name" /><SpinnerButton className="primary-button" loading={busy}>Add</SpinnerButton></form><div className="category-list">{categories.length === 0 ? <p className="muted-copy">No categories yet. Nook can suggest one when it processes a bookmark.</p> : categories.map((category) => <div className="category-row" key={category.id}>{editingId === category.id ? <><input value={editingName} onChange={(event) => setEditingName(event.target.value)} aria-label={`Rename ${category.name}`} /><button className="text-button" onClick={() => void rename(category.id)}>Save</button><button className="text-button muted" onClick={() => setEditingId(null)}>Cancel</button></> : <><span className="category-name">{category.name}</span><span className="category-count">{category._count?.bookmarks ?? 0}</span><button className="icon-button subtle" onClick={() => { setEditingId(category.id); setEditingName(category.name); }} aria-label={`Rename ${category.name}`}>✎</button><button className="icon-button subtle danger-icon" onClick={() => void remove(category.id)} aria-label={`Delete ${category.name}`}>×</button></>}</div>)}</div>{error && <div className="form-error" role="alert">{error}</div>}</div></Modal>;
}
