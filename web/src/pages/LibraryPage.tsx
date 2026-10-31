import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../api";
import type { Bookmark, Category, Tag } from "../types";
import { BookmarkCard, BookmarkSkeleton } from "../components/BookmarkCard";
import { BookmarkDrawer } from "../components/BookmarkDrawer";
import { BookmarkForm } from "../components/BookmarkForm";
import { CategoryManager } from "../components/CategoryManager";
import { EmptyState, ErrorNotice, PageHeader } from "../components/AppLayout";
import { useAuth } from "../auth";

const PAGE_SIZE = 12;

export function LibraryPage() {
  const { user } = useAuth();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [selectedBookmark, setSelectedBookmark] = useState<Bookmark | null>(null);
  const [showBookmarkForm, setShowBookmarkForm] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(query || selectedCategory || selectedTag || selectedStatus);
  const categoryLabel = useMemo(() => categories.find((category) => category.id === selectedCategory)?.name, [categories, selectedCategory]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(draftQuery); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [draftQuery]);

  useEffect(() => {
    let active = true;
    if (!hasLoaded) setLoading(true); setError("");
    Promise.all([
      api.bookmarks.list({ page, limit: PAGE_SIZE, q: query, categoryId: selectedCategory, tag: selectedTag, status: selectedStatus }),
      api.categories.list(),
      api.tags.list(),
    ]).then(([result, categoryResult, tagResult]) => {
      if (!active) return;
      setBookmarks(result.items); setTotal(result.total); setCategories(categoryResult); setTags(tagResult); setHasLoaded(true);
    }).catch((cause) => { if (active) setError(cause instanceof ApiError ? cause.message : "Could not load your library."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [hasLoaded, page, query, selectedCategory, selectedTag, selectedStatus, refreshKey]);

  const processingCount = bookmarks.filter((bookmark) => bookmark.processingStatus === "PENDING" || bookmark.processingStatus === "PROCESSING").length;
  useEffect(() => {
    if (!processingCount) return;
    const timer = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer);
  }, [processingCount]);

  function refresh() { setRefreshKey((key) => key + 1); }
  function clearFilters() { setQuery(""); setSelectedCategory(""); setSelectedTag(""); setSelectedStatus(""); setPage(1); }
  async function retry(bookmark: Bookmark) { try { await api.bookmarks.process(bookmark.id); refresh(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Processing could not be retried."); } }

  return <div className="page-wrap library-page"><PageHeader eyebrow="Your personal library" title={`A home for the things you find${user?.displayName ? `, ${user.displayName.split(" ")[0]}` : ""}.`} description="Keep the internet's good ideas somewhere that feels like yours." action={<button className="primary-button save-button" onClick={() => setShowBookmarkForm(true)}><span>＋</span> Save a bookmark</button>} />
     <div className="library-toolbar"><div className="search-box"><span>⌕</span><input value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder="Search your library…" aria-label="Search bookmarks by title, description, URL, or domain" /></div><div className="toolbar-actions"><select value={selectedStatus} onChange={(event) => { setSelectedStatus(event.target.value); setPage(1); }} aria-label="Filter by processing status"><option value="">All states</option><option value="COMPLETED">Ready</option><option value="PENDING">Queued</option><option value="PROCESSING">Processing</option><option value="FAILED">Needs attention</option></select><button className="secondary-button category-button" onClick={() => setShowCategoryManager(true)}>⚙ Categories</button></div></div>
     <div className="library-content"><aside className="filter-rail"><div className="filter-heading"><span>Browse</span>{hasFilters && <button className="text-button" onClick={clearFilters}>Clear</button>}</div><button className={`rail-filter ${!selectedCategory && !selectedTag ? "active" : ""}`} onClick={clearFilters}><span className="rail-icon">✦</span> Everything <span>{hasFilters ? "" : total}</span></button><p className="filter-label">Shelves</p>{categories.length === 0 ? <p className="muted-copy">Add categories to make shelves.</p> : categories.map((category) => <button className={`rail-filter ${selectedCategory === category.id ? "active" : ""}`} key={category.id} onClick={() => { setSelectedCategory(selectedCategory === category.id ? "" : category.id); setPage(1); }}><span className="rail-icon">◌</span> <span className="truncate">{category.name}</span><span>{category._count?.bookmarks ?? 0}</span></button>)}<p className="filter-label">Popular tags</p><div className="tag-filter-list">{tags.length === 0 ? <p className="muted-copy">Tags appear as Nook organizes saves.</p> : tags.slice(0, 12).map((tag) => <button className={`tag-filter ${selectedTag === tag.name ? "active" : ""}`} key={tag.id} onClick={() => { setSelectedTag(selectedTag === tag.name ? "" : tag.name); setPage(1); }}>#{tag.name}<span>{tag._count?.bookmarks ?? 0}</span></button>)}</div></aside>
      <section className="library-results" aria-live="polite"><div className="results-heading"><div><span className="results-count">{loading ? "Looking around…" : `${total} ${total === 1 ? "bookmark" : "bookmarks"}`}</span>{(categoryLabel || selectedTag) && <span className="active-filter-note"> in {categoryLabel || `#${selectedTag}`}</span>}</div>{total > 0 && <span className="page-note">Page {page} of {pageCount}</span>}</div>
        {error && <ErrorNotice message={error} onRetry={refresh} />}
        {loading ? <div className="bookmark-grid">{Array.from({ length: 6 }, (_, index) => <BookmarkSkeleton key={index} />)}</div> : bookmarks.length === 0 ? <EmptyState icon={hasFilters ? "⌕" : "✧"} title={hasFilters ? "Nothing in this corner yet" : "Your library is waiting"} message={hasFilters ? "Try another search or clear your filters to look elsewhere." : "Save your first bookmark and Nook will start making sense of the web for you."} action={hasFilters ? <button className="secondary-button" onClick={clearFilters}>Show everything</button> : <button className="primary-button" onClick={() => setShowBookmarkForm(true)}>Save your first bookmark</button>} /> : <div className="bookmark-grid">{bookmarks.map((bookmark) => <BookmarkCard key={bookmark.id} bookmark={bookmark} onOpen={() => setSelectedBookmark(bookmark)} onRetry={() => void retry(bookmark)} />)}</div>}
        {!loading && pageCount > 1 && <div className="pagination"><button className="secondary-button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>← Previous</button><span>{page} / {pageCount}</span><button className="secondary-button" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next →</button></div>}
      </section>
    </div>
    {selectedBookmark && <BookmarkDrawer bookmark={selectedBookmark} categories={categories} onClose={() => setSelectedBookmark(null)} onChanged={refresh} />}
    {showBookmarkForm && <BookmarkForm categories={categories} onClose={() => setShowBookmarkForm(false)} onCreated={() => { setShowBookmarkForm(false); setPage(1); refresh(); }} />}
    {showCategoryManager && <CategoryManager categories={categories} onClose={() => setShowCategoryManager(false)} onChanged={refresh} />}
  </div>;
}
