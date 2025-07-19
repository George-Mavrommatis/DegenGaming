import React, { createContext, useContext, ReactNode, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { db, auth } from '../firebase/firebaseConfig';
import { doc, onSnapshot, getDoc, setDoc } from 'firebase/firestore';
import type { ProfileData } from '../types/profile';

interface ProfileContextType {
  user: User | null;
  profile: ProfileData | null;
  loading: boolean;
  updateProfile: (data: Partial<ProfileData>) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export const useProfile = () => {
  const context = useContext(ProfileContext);
  if (!context) throw new Error('useProfile must be used within a ProfileProvider');
  return context;
};

// Helper: merges new data, doesn't overwrite existing
const updateProfileData = async (uid: string, data: Partial<ProfileData>) => {
  await setDoc(doc(db, "users", uid), data, { merge: true });
};

export const ProfileProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  // 1. Auth listener to set user
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setProfile(null);
      setLoading(true);
    });
    return unsubscribe;
  }, []);

  // 2. Real-time profile listener for current user
  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const userDoc = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(userDoc, (snap) => {
      if (snap.exists()) {
        setProfile({ ...(snap.data() as ProfileData) });
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, [user]);

  // 3. updateProfile and refreshProfile
  const updateProfile = useCallback(async (data: Partial<ProfileData>) => {
    if (!user) throw new Error("No user");
    await updateProfileData(user.uid, data);
  }, [user]);

  // Manual refresh (almost never needed with onSnapshot, but provided for API compatibility)
  const refreshProfile = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) setProfile(snap.data() as ProfileData);
    setLoading(false);
  }, [user]);

  const value: ProfileContextType = {
    user,
    profile,
    loading,
    updateProfile,
    refreshProfile,
  };

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  );
};
