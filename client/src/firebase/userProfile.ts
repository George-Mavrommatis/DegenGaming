/**
 * userProfile.ts
 * Minimal local profile helpers. All friend logic is server-side now.
 *
 * If a new wallet user logs in and no profile doc exists the backend
 * should create it via /verify-wallet. This hook still ensures fallback.
 */

import { db, auth } from './firebaseConfig';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { useEffect, useState } from 'react';

export interface MinimalProfile {
  uid: string;
  username?: string;
  avatarUrl?: string;
  wallet?: string;
  createdAt?: string;
  coins?: { gg?: number };
  friends?: string[];
  friendRequestsSent?: string[];
  friendRequestsReceived?: string[];
  isOnline?: boolean;
  lastSeen?: any;
}

const DEFAULT_PROFILE: Partial<MinimalProfile> = {
  friends: [],
  friendRequestsSent: [],
  friendRequestsReceived: []
};

export function useFirebaseUser() {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setInitializing(false);
    });
    return () => unsub();
  }, []);

  return { user, initializing };
}

/**
 * ensureUserProfile - client fallback only if backend failed to make doc.
 */
export async function ensureUserProfile(uid: string, walletPublicKey?: string) {
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    await setDoc(userRef, {
      ...DEFAULT_PROFILE,
      uid,
      wallet: walletPublicKey || null,
      createdAt: new Date().toISOString()
    }, { merge: true });
  } else if (walletPublicKey) {
    // Ensure wallet stored if newly linked
    await updateDoc(userRef, { wallet: walletPublicKey });
  }
}

export async function getProfileData(uid: string): Promise<MinimalProfile | null> {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as MinimalProfile) : null;
}

export async function updateProfileData(uid: string, data: Partial<MinimalProfile>) {
  const ref = doc(db, 'users', uid);
  await updateDoc(ref, { ...data, updatedAt: new Date().toISOString() });
}

export function useProfile() {
  const { user, initializing: authInit } = useFirebaseUser();
  const [profile, setProfile] = useState<MinimalProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      if (user) {
        const p = await getProfileData(user.uid);
        setProfile(p);
      } else {
        setProfile(null);
      }
      setLoading(false);
    };
    if (!authInit) run();
  }, [user, authInit]);

  return { profile, user, loading: authInit || loading };
}