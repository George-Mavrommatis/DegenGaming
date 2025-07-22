import { Navigate, Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { useProfile } from '../context/ProfileContext';

export default function ProtectedRoute() {
  const { user, isAuthenticated, loading } = useProfile();

  useEffect(() => {
    console.log("ProtectedRoute: Current user:", user?.uid);
    console.log("ProtectedRoute: Is Authenticated:", isAuthenticated);
    console.log("ProtectedRoute: Loading:", loading);
  }, [user, isAuthenticated, loading]);

  if (loading) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center bg-black">
        <h1 className="text-2xl font-orbitron text-white animate-pulse">Authenticating...</h1>
      </div>
    );
  }

  // Redirect to "/" not "/landing"
  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}