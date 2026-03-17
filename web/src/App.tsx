import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ClerkProvider, Show } from '@clerk/react';
import { AuthProvider } from './contexts/AuthContext';
import { PermissionProvider } from './contexts/PermissionContext';
import { DonationProvider } from './contexts/DonationContext';
import { CampaignProvider } from './contexts/CampaignContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Dashboard } from './pages/Dashboard';
import { Businesses } from './pages/Businesses';
import { Opportunities } from './pages/Opportunities';
import { Donations } from './pages/Donations';
import { Calendar } from './pages/Calendar';
import { Stores } from './pages/Stores';
import { AdminPanel } from './pages/AdminPanel';
import { OrgSettings } from './pages/OrgSettings';
import { StorePicker } from './pages/StorePicker';
import { NoAccess } from './pages/NoAccess';
import './App.css';

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function AppRoutes() {
  return (
    <AuthProvider>
      <PermissionProvider>
        <CampaignProvider>
        <DonationProvider>
          <Routes>
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
                <ProtectedRoute requireAdmin={true}>
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
              path="/org-settings"
              element={
                <ProtectedRoute>
                  <OrgSettings />
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<Navigate to="/select-store" replace />} />
          </Routes>
        </DonationProvider>
        </CampaignProvider>
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
