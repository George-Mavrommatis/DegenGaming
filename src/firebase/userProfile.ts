import { db, auth } from "./firebaseConfig";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import type { ProfileData } from "../types/profile";
import { DEFAULT_PROFILE } from "../types/profile";
import { useState, useEffect } from "react";
import { onAuthStateChanged, User } from "firebase/auth";

// This is a direct hook for the Firebase user object.
export function useFirebaseUser() {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setInitializing(false);
    });
    return () => unsubscribe();
  }, []);

  return { user, initializing };
}


export async function ensureUserProfile(uid: string, walletPublicKey: string) {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    await setDoc(userRef, {
      ...DEFAULT_PROFILE,
      wallet: walletPublicKey,
      createdAt: new Date().toISOString(),
      friends: [],
      friendRequests: [],
      sentInvitations: [],
      dmsOpen: true,
      duelsOpen: true,
      duelInvitations: [],
      pvpRoomInvites: [],
    });
  } else {
    const data = userSnap.data() || {};
    const update: any = {};

    if (!Array.isArray(data.friends)) update.friends = [];
    if (!Array.isArray(data.friendRequests)) update.friendRequests = [];
    if (!Array.isArray(data.sentInvitations)) update.sentInvitations = [];
    if (!Array.isArray(data.duelInvitations)) update.duelInvitations = [];
    if (!Array.isArray(data.pvpRoomInvites)) update.pvpRoomInvites = [];
    if (typeof data.dmsOpen !== "boolean") update.dmsOpen = true;
    if (typeof data.duelsOpen !== "boolean") update.duelsOpen = true;
    update.wallet = walletPublicKey;
    update.lastLogin = new Date().toISOString();

    if (Object.keys(update).length > 0) await updateDoc(userRef, update);
  }
}

export async function ensureUserHasArrays(uid: string) {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    await setDoc(userRef, {
      friends: [],
      friendRequests: [],
      sentInvitations: [],
      duelInvitations: [],
      pvpRoomInvites: [],
    }, { merge: true });
    return;
  }
  const data = userSnap.data() || {};
  const patch: any = {};
  if (!Array.isArray(data.friends)) patch.friends = [];
  if (!Array.isArray(data.friendRequests)) patch.friendRequests = [];
  if (!Array.isArray(data.sentInvitations)) patch.sentInvitations = [];
  if (!Array.isArray(data.duelInvitations)) patch.duelInvitations = [];
  if (!Array.isArray(data.pvpRoomInvites)) patch.pvpRoomInvites = [];
  if (Object.keys(patch).length > 0) {
    await updateDoc(userRef, patch);
  }
}


export async function getProfileData(uid: string): Promise<ProfileData | null> {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as ProfileData) : null;
}

export async function updateProfileData(uid: string, data: Partial<ProfileData>) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, { ...data, updatedAt: new Date().toISOString() });
}

export function useProfile() {
  const { user, initializing: authInitializing } = useFirebaseUser();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      if (user) {
        const profileData = await getProfileData(user.uid);
        setProfile(profileData);

      } else {
        setProfile(null);
      }
      setLoading(false);
    };

    if (!authInitializing) {
      fetchProfile();
    }
  }, [user, authInitializing]);

  return { profile, user, loading: authInitializing || loading };
}
