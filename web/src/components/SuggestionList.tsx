import { useEffect, useState } from "react";
import type { CollectionSuggestion } from "../types";
import { ApiError, api } from "../api";
import { EmptyState, ErrorNotice, SpinnerButton } from "./AppLayout";

export function SuggestionList({ onAccepted }: { onAccepted: () => void }) {
  const [suggestions, setSuggestions] = useState<CollectionSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  async function load() { setLoading(true); setError(""); try { setSuggestions(await api.suggestions.list()); } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not load suggestions."); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  async function generate() { setGenerating(true); setError(""); try { await api.suggestions.generate(); await load(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not generate suggestions."); } finally { setGenerating(false); } }
  async function review(id: string, action: "accept" | "reject") { setBusyId(id); setError(""); try { if (action === "accept") { await api.suggestions.accept(id); onAccepted(); } else await api.suggestions.reject(id); setSuggestions((items) => items.filter((item) => item.id !== id)); } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not update this suggestion."); } finally { setBusyId(""); } }
  return <section className="suggestions-section"><div className="section-heading suggestion-heading"><div><p className="eyebrow">A little help from Nook</p><h2>Collection ideas</h2><p>Suggestions are always yours to review before anything is added.</p></div><SpinnerButton className="secondary-button" loading={generating} onClick={() => void generate()}>✦ Find themes</SpinnerButton></div>{error && <ErrorNotice message={error} onRetry={() => void load()} />}{loading ? <div className="suggestion-grid"><div className="suggestion-skeleton" /><div className="suggestion-skeleton" /></div> : suggestions.length === 0 ? <EmptyState icon="✦" title="No ideas to review" message="Once you have a few processed bookmarks, Nook can look for useful themes." action={<button className="secondary-button" onClick={() => void generate()}>Generate ideas</button>} /> : <div className="suggestion-grid">{suggestions.map((suggestion) => <article className="suggestion-card" key={suggestion.id}><div className="suggestion-card-top"><span className="ai-badge">✦ Suggested</span><span className="suggestion-count">{suggestion.bookmarks.length} saves</span></div><h3>{suggestion.name}</h3><p>{suggestion.description}</p><div className="suggestion-links">{suggestion.bookmarks.slice(0, 3).map(({ bookmark }) => <a key={bookmark.id} href={bookmark.url} target="_blank" rel="noopener noreferrer">{bookmark.title || bookmark.url}</a>)}</div><div className="suggestion-actions"><button className="secondary-button" disabled={busyId === suggestion.id} onClick={() => void review(suggestion.id, "reject")}>Not for me</button><SpinnerButton className="primary-button" loading={busyId === suggestion.id} onClick={() => void review(suggestion.id, "accept")}>Add to collections</SpinnerButton></div></article>)}</div>}</section>;
}
