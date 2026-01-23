import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { PermissionProvider } from './contexts/PermissionContext';
import { DonationProvider } from './contexts/DonationContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Dashboard } from './pages/Dashboard';
import { Businesses } from './pages/Businesses';
import { Donations } from './pages/Donations';
import { Calendar } from './pages/Calendar';
import { Stores } from './pages/Stores';
import { AdminPanel } from './pages/AdminPanel';
import { StorePicker } from './pages/StorePicker';
import { NoAccess } from './pages/NoAccess';
import './App.css';

function App() {
  return (
    <Router>
      <AuthProvider>
        <PermissionProvider>
          <DonationProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/no-access" element={<NoAccess />} />
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
                <ProtectedRoute requireAdmin={true}>
                  <AdminPanel />
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<Navigate to="/select-store" replace />} />
          </Routes>
          </DonationProvider>
        </PermissionProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
