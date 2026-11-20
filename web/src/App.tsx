import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { ClerkProvider, Show } from '@clerk/react';
import { AuthProvider } from './contexts/AuthContext';
import { PermissionProvider } from './contexts/PermissionContext';
import { DonationProvider } from './contexts/DonationContext';
import { CampaignProvider } from './contexts/CampaignContext';
import { OfflineProvider } from './contexts/OfflineContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Dashboard } from './pages/Dashboard';
import { StorePicker } from './pages/StorePicker';
import {
  Businesses,
  Opportunities,
  Donations,
  Calendar,
  Stores,
  AdminPanel,
  OrgSettings,
  Platform,
  Reports,
  LegalPage,
  prefetchPages,
} from './pages/lazyPages';
import { PageLoader } from './components/PageLoader';
import { NoAccess } from './pages/NoAccess';
import { TermsGate } from './components/legal/TermsGate';
import './App.css';

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function AppRoutes() {
  useEffect(() => { prefetchPages(); }, []);

  return (
    <AuthProvider>
      <PermissionProvider>
        <OfflineProvider>
        <CampaignProvider>
        <DonationProvider>
          <TermsGate>
          <Routes>
            <Route path="/terms" element={<PageLoader><LegalPage doc="terms" /></PageLoader>} />
            <Route path="/privacy" element={<PageLoader><LegalPage doc="privacy" /></PageLoader>} />
            <Route path="/login/*" element={<Login />} />
            <Route path="/signup/*" element={<Signup />} />
            <Route path="/no-access" element={
              <Show when="signed-in">
                <NoAccess />
              </Show>
            } />
            <Route
              path="/select-store"
              element={
                <ProtectedRoute>
                  <StorePicker />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/businesses"
              element={
                <ProtectedRoute>
                  <Businesses />
                </ProtectedRoute>
              }
            />
            <Route
              path="/opportunities"
              element={
                <ProtectedRoute>
                  <Opportunities />
                </ProtectedRoute>
              }
            />
            <Route
              path="/donations"
              element={
                <ProtectedRoute>
                  <Donations />
                </ProtectedRoute>
              }
            />
            <Route
              path="/reports"
              element={
                <ProtectedRoute>
                  <Reports />
                </ProtectedRoute>
              }
            />
            <Route path="/map" element={<Navigate to="/opportunities?tab=map" replace />} />
            <Route
              path="/calendar"
              element={
                <ProtectedRoute>
                  <Calendar />
                </ProtectedRoute>
              }
            />
            <Route
              path="/stores"
              element={
                <ProtectedRoute>
                  <Stores />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <AdminPanel />
                </ProtectedRoute>
              }
            />
            <Route
              path="/platform"
              element={
                <ProtectedRoute>
                  <Platform />
                </ProtectedRoute>
              }
            />
            <Route
              path="/org-settings"
              element={
                <ProtectedRoute>
                  <OrgSettings />
                </ProtectedRoute>
              }
            />
            {/* Land authenticated users on the dashboard. ProtectedRoute will
                bounce to /select-store automatically if no store is remembered
                in localStorage, so a marketer who refreshes the bare URL goes
                straight to their last-used store instead of the picker. */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            {/* Catch-all for any unknown URL (typo, stale share link, etc.) */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          </TermsGate>
        </DonationProvider>
        </CampaignProvider>
        </OfflineProvider>
      </PermissionProvider>
    </AuthProvider>
  );
}

function App() {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <Router>
        <AppRoutes />
      </Router>
    </ClerkProvider>
  );
}

export default App;
