import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import OnboardPage from './pages/OnboardPage';
import TenantDetailPage from './pages/TenantDetailPage';
import type { ReactNode } from 'react';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isSuperAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner spinner-lg" />
        <span style={{ color: 'var(--color-text-muted)' }}>Verifying credentials...</span>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Block non-super-admin users
  if (!isSuperAdmin) {
    return (
      <div className="loading-screen">
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ marginBottom: 'var(--space-4)' }}>⛔ Access Denied</h2>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-6)' }}>
            This portal is restricted to authorized Super Admin accounts only.
          </p>
          <button className="btn btn-ghost" onClick={() => window.location.href = '/login'}>
            Sign Out & Try Again
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { user, isSuperAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user && isSuperAdmin ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route
        path="/"
        element={<ProtectedRoute><DashboardPage /></ProtectedRoute>}
      />
      <Route
        path="/onboard"
        element={<ProtectedRoute><OnboardPage /></ProtectedRoute>}
      />
      <Route
        path="/tenant/:orgId"
        element={<ProtectedRoute><TenantDetailPage /></ProtectedRoute>}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
