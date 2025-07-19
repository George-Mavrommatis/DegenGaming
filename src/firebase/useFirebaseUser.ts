// src/firebase/useFirebaseUser.ts

import { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './firebaseConfig';

export function useFirebaseUser() {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true); // Start in an initializing state

  useEffect(() => {
    // onAuthStateChanged returns an unsubscribe function.
    // It listens for auth state changes and checks for a persisted session on initial load.
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);

      // Once we get the first response from Firebase (either a user or null),
      // the initial check is complete.
      setInitializing(false);
    });

    // Cleanup the subscription on component unmount to prevent memory leaks
    return () => unsubscribe();
  }, []); // The empty dependency array ensures this effect runs only once

  return { user, initializing };
}
