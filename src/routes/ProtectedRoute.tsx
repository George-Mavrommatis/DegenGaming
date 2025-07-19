// src/components/ProtectedRoute.tsx

import { Navigate, Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';
import { useProfile } from '../context/ProfileContext'; // Import useProfile

export default function ProtectedRoute() {
  // Destructure relevant state from useProfile
  const { currentUser: user, isAuthenticated, loadingAuth } = useProfile();

  // Debugging logs - keep these while debugging!
  useEffect(() => {
    console.log("ProtectedRoute: Current user:", user);
    console.log("ProtectedRoute: Is Authenticated:", isAuthenticated);
    console.log("ProtectedRoute: Loading Auth:", loadingAuth);
  }, [user, isAuthenticated, loadingAuth]);

  // Effect to manage user online/offline status
  useEffect(() => {
    // Check if authentication status has been determined (not loading)
    // and if a user is logged in.
    if (!loadingAuth && user) {
      console.log(`ProtectedRoute: Setting user ${user.uid} online...`);
      const setUserOnline = async () => {
        try {
          await updateDoc(doc(db, "users", user.uid), {
            isOnline: true,
            lastSeen: new Date().toISOString(),
          });
        } catch (e) {
          console.error("ProtectedRoute: Error setting user online:", e);
          // Consider logging this to a monitoring service or user notification
        }
      };
      setUserOnline();

      // Set up 'beforeunload' listener to mark user offline
      const handleBeforeUnload = async () => {
        // Ensure the user ID is available before trying to update
        if (user && user.uid) {
            console.log(`ProtectedRoute: Setting user ${user.uid} offline on unload...`);
            try {
            await updateDoc(doc(db, "users", user.uid), {
                isOnline: false,
                lastSeen: new Date().toISOString(),
            });
            } catch (e) {
            console.error("ProtectedRoute: Error setting user offline on unload:", e);
            }
        }
      };

      // Add the event listener
      window.addEventListener('beforeunload', handleBeforeUnload);

      // Cleanup function for useEffect: removes the event listener
      // and ensures user is marked offline when component unmounts
      // or dependencies change (e.g., user logs out)
      return () => {
        console.log(`ProtectedRoute: Cleanup for user ${user?.uid}. Removing unload listener.`);
        window.removeEventListener('beforeunload', handleBeforeUnload);
        // Important: Also set user offline if the component unmounts for other reasons
        // like navigating away or logging out. This covers cases where 'beforeunload' might not fire reliably.
        // Make sure 'user' is still valid before attempting update.
        if (user && user.uid) {
            console.log(`ProtectedRoute: Setting user ${user.uid} offline during cleanup.`);
            updateDoc(doc(db, "users", user.uid), {
                isOnline: false,
                lastSeen: new Date().toISOString(),
            }).catch(e => console.error("ProtectedRoute: Error setting user offline during cleanup:", e));
        }
      };
    } else if (!loadingAuth && !user) {
        // If not loading and no user, ensure any leftover online status is cleaned up
        // This handles cases where a user might log out.
        console.log("ProtectedRoute: No user logged in, ensuring offline status is handled.");
        // We don't have a user.uid here, so we can't update a specific doc.
        // This implies that the 'isOnline' status should ideally be cleared by
        // the logout function itself, or rely on the cleanup above if 'user' transitions to null.
    }
  }, [user, loadingAuth]); // Dependencies: re-run if user or loadingAuth changes

  // Display loading screen while authentication status is being determined by ProfileContext
  if (loadingAuth) {
    console.log("ProtectedRoute: Displaying authenticating screen.");
    return (
      <div className="w-full min-h-screen flex items-center justify-center bg-black">
        <h1 className="text-2xl font-orbitron text-white animate-pulse">Authenticating...</h1>
      </div>
    );
  }

  // If not authenticated (and not loading), redirect to the home page
  if (!isAuthenticated) {
    console.log("ProtectedRoute: User not authenticated, redirecting to /.");
    return <Navigate to="/" replace />;
  }

  // If authenticated and loading is false, render the protected content
  console.log("ProtectedRoute: User authenticated, rendering protected content.");
  return <Outlet />;
}