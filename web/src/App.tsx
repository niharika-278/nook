import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { AuthPage } from "./pages/AuthPage";
import { LibraryPage } from "./pages/LibraryPage";
import { CollectionsPage } from "./pages/CollectionsPage";
import { AppLayout } from "./components/AppLayout";

function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="full-page-loading"><span className="spinner" />Opening your nook…</div>;
  return user ? <AppLayout><Outlet /></AppLayout> : <Navigate to="/auth" replace />;
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/auth" element={user ? <Navigate to="/" replace /> : <AuthPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/collections" element={<CollectionsPage />} />
      </Route>
      <Route path="*" element={<Navigate to={user ? "/" : "/auth"} replace />} />
    </Routes>
  );
}
