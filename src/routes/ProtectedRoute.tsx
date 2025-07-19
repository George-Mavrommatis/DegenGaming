import { Navigate, Outlet } from 'react-router-dom';
import { useFirebaseUser } from '../firebase/useFirebaseUser';
import { useEffect } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';

export default function ProtectedRoute() {
  const { user, initializing } = useFirebaseUser();

  useEffect(() => {
    if (!initializing && user) {
      const setUserOnline = async () => {
        try {
          await updateDoc(doc(db, "users", user.uid), {
            isOnline: true,
            lastSeen: new Date().toISOString(),
          });
        } catch (e) {
          // handle error (optional)
        }
      };
      setUserOnline();

      const handleBeforeUnload = async () => {
        try {
          await updateDoc(doc(db, "users", user.uid), {
            isOnline: false,
            lastSeen: new Date().toISOString(),
          });
        } catch (e) {}
      };
      window.addEventListener('beforeunload', handleBeforeUnload);
      return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }
  }, [user, initializing]);

  if (initializing) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center bg-black">
        <h1 className="text-2xl font-orbitron text-white animate-pulse">Authenticating...</h1>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  // If everything is fine, render the outlet!
  return <Outlet />;
}
