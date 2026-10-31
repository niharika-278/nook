import { FormEvent, useState } from "react";
import { useAuth } from "../auth";
import { ApiError } from "../api";

export function AuthPage() {
  const { login, register, sessionMessage } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (mode === "signup" && password.length < 12) { setError("Use at least 12 characters for your password."); return; }
    setLoading(true);
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password, displayName.trim() || undefined);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "We could not finish that request.");
    } finally { setLoading(false); }
  }

  return <div className="auth-shell">
    <div className="auth-art"><div className="auth-art-content"><img src="/logo.jpg" alt="Nook" className="auth-logo" /><p>Collect the things that make you curious. Nook keeps them close, understood, and easy to return to.</p><div className="art-stamp">✦ a calmer way to save</div></div><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /></div>
    <main className="auth-panel"><div className="auth-card"><div className="auth-mobile-brand"><img src="/icon.png" alt="" /> Nook</div><p className="eyebrow">{mode === "login" ? "Welcome back" : "Make room for good ideas"}</p><h1>{mode === "login" ? "Return to your nook." : "Create your nook."}</h1><p className="auth-subtitle">{mode === "login" ? "Your saved corners of the internet are waiting." : "A personal library for the things you find online."}</p>
       {sessionMessage && <div className="form-error session-message" role="status">{sessionMessage}</div>}
       <form onSubmit={submit} className="stack-form">
        {mode === "signup" && <label>What should we call you?<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name" autoComplete="name" /></label>}
        <label>Email address<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></label>
        <label>Password<input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "signup" ? "At least 12 characters" : "Your password"} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary-button full-button" disabled={loading}>{loading && <span className="button-spinner" />}{mode === "login" ? "Open my library" : "Create my library"}</button>
      </form>
      <p className="auth-switch">{mode === "login" ? "New to Nook?" : "Already have a nook?"} <button className="text-button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}>{mode === "login" ? "Create an account" : "Sign in"}</button></p>
    </div><p className="auth-footer">Nook · Your little corner of the internet</p></main>
  </div>;
}
