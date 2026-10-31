import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth";

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const initials = (user?.displayName || user?.email || "N").slice(0, 1).toUpperCase();

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <img src="/logo.jpg" alt="Nook" className="brand-logo" />
          <div><strong>Nook</strong><span>Your little corner</span></div>
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          <NavLink to="/" end onClick={() => setMenuOpen(false)}><span className="nav-symbol">▦</span> Library</NavLink>
          <NavLink to="/collections" onClick={() => setMenuOpen(false)}><span className="nav-symbol">◇</span> Collections</NavLink>
        </nav>
        <div className="sidebar-note"><span>✦</span><p>Save the good stuff.<br />Find it when you need it.</p></div>
        <div className="sidebar-account">
          <div className="avatar">{initials}</div>
          <div className="account-details"><strong>{user?.displayName || "Your library"}</strong><span>{user?.email}</span></div>
          <button className="icon-button subtle" onClick={logout} aria-label="Log out" title="Log out">↪</button>
        </div>
      </aside>
      <div className="main-area">
        <header className="mobile-header">
          <button className="icon-button" onClick={() => setMenuOpen((open) => !open)} aria-label="Open navigation">☰</button>
          <img src="/icon.png" alt="Nook" className="mobile-icon" />
          <span>Nook</span>
        </header>
        {menuOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
        <main>{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{action && <div className="page-header-action">{action}</div>}</div>;
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close">×</button></div>
      {children}
    </section>
  </div>;
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="error-notice" role="alert"><span>!</span><div><strong>Something went wrong</strong><p>{message}</p>{onRetry && <button className="text-button" onClick={onRetry}>Try again</button>}</div></div>;
}

export function EmptyState({ icon, title, message, action }: { icon: string; title: string; message: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{message}</p>{action}</div>;
}

export function SpinnerButton({ loading, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return <button {...props} disabled={loading || props.disabled}>{loading && <span className="button-spinner" />}{children}</button>;
}
