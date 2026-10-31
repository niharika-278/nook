import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, clearToken, getToken, onSessionExpired, setToken } from "./api";
import type { User } from "./types";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  sessionMessage: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [sessionMessage, setSessionMessage] = useState("");

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api.auth.me().then((result) => setUser(result.user)).catch(() => {
      clearToken();
      setUser(null);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => onSessionExpired(() => {
    clearToken();
    setUser(null);
    setSessionMessage("Your session expired. Sign in again to continue.");
  }), []);

  const value = useMemo<AuthContextValue>(() => ({
      user,
      isLoading,
      sessionMessage,
    login: async (email, password) => {
      const result = await api.auth.login(email, password);
      setToken(result.token);
      setUser(result.user);
      setSessionMessage("");
    },
    register: async (email, password, displayName) => {
      const result = await api.auth.register(email, password, displayName);
      setToken(result.token);
      setUser(result.user);
      setSessionMessage("");
    },
    logout: () => {
      clearToken();
      setUser(null);
      setSessionMessage("");
    },
  }), [isLoading, sessionMessage, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
