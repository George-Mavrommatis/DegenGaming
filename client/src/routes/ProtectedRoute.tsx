// src/protectedRoute.tsx

import { Navigate, Outlet } from 'react-router-dom';
import { useEffect } from 'react';
// Removed Firestore imports as isOnline logic is moved
// import { doc, updateDoc } from 'firebase/firestore'; 
// import { db } from '../firebase/firebaseConfig'; 
import { useProfile } from '../context/ProfileContext';

export default function ProtectedRoute() {
  const { user, isAuthenticated, loading } = useProfile(); // Use 'user' and 'loading' from useProfile

  useEffect(() => {
    console.log("ProtectedRoute: Current user:", user?.uid);
    console.log("ProtectedRoute: Is Authenticated:", isAuthenticated);
    console.log("ProtectedRoute: Loading:", loading);
  }, [user, isAuthenticated, loading]);

  // REMOVED THE ENTIRE useEffect BLOCK THAT MANAGED isOnline STATUS.
  // The Socket.IO server will handle setting isOnline: true/false based on connection.
  // The 'beforeunload' listener for isOnline: false is no longer needed here.

  // Display loading screen while authentication status is being determined by ProfileContext
  if (loading) {
    console.log("ProtectedRoute: Displaying authenticating screen.");
    return (
      <div className="w-full min-h-screen flex items-center justify-center bg-black">
        <h1 className="text-2xl font-orbitron text-white animate-pulse">Authenticating...</h1>
      </div>
    );
  }

  // If not authenticated (and not loading), redirect to the /landing page
  if (!isAuthenticated) {
    console.log("ProtectedRoute: User not authenticated, redirecting to /landing.");
    return <Navigate to="/landing" replace />;
  }

  // If authenticated and loading is false, render the protected content
  console.log("ProtectedRoute: User authenticated, rendering protected content.");
  return <Outlet />;
}