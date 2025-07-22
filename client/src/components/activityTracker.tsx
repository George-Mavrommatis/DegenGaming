// src/components/UserActivityTracker.tsx
import { useEffect } from 'react';
import { updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';
import { useProfile } from '../context/ProfileContext'; // Now it's safe to use useProfile here

const UserActivityTracker: React.FC = () => {
  const { user, isAuthenticated, loading } = useProfile(); // Use useProfile to get the user

  useEffect(() => {
    // Only run this effect if user is authenticated and not loading
    if (user && isAuthenticated && !loading) {
      console.log(`UserActivityTracker: Setting user ${user.uid} lastSeen...`);
      const userDocRef = doc(db, "users", user.uid);

      const updateLastSeen = async () => {
        try {
          await updateDoc(userDocRef, {
            lastSeen: new Date().toISOString()
          });
        } catch (e) {
          console.error("UserActivityTracker: Error updating lastSeen:", e);
        }
      };

      updateLastSeen(); // Update immediately on mount/user change

      const interval = setInterval(updateLastSeen, 30000); // Update every 30 seconds

      // Cleanup function to clear interval
      return () => {
        clearInterval(interval);
      };
    }
  }, [user, isAuthenticated, loading]); // Dependencies: user, isAuthenticated, loading from useProfile

  // This component doesn't render any UI, it's purely for side effects.
  return null;
};

export default UserActivityTracker;