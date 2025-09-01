import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
  useMemo,
} from "react";
import {
  onAuthStateChanged,
  User as FirebaseUser,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import { toast } from "react-toastify";
import { useWallet } from "@solana/wallet-adapter-react";
import { useNavigate } from "react-router-dom";
import { socket } from "../socket";
import { ProfileData, DEFAULT_PROFILE } from "../types/profile";

// --- Utility: Ensure both singular and plural freeEntryTokens keys exist ---
function mergeFreeEntryTokens(tokens: any): any {
  const result = { ...tokens };
  // Arcade
  if (
    typeof result.arcadeTokens === "number" &&
    typeof result.arcade !== "number"
  ) {
    result.arcade = result.arcadeTokens;
  }
  if (
    typeof result.arcade === "number" &&
    typeof result.arcadeTokens !== "number"
  ) {
    result.arcadeTokens = result.arcade;
  }
  // Picker
  if (
    typeof result.pickerTokens === "number" &&
    typeof result.picker !== "number"
  ) {
    result.picker = result.pickerTokens;
  }
  if (
    typeof result.picker === "number" &&
    typeof result.pickerTokens !== "number"
  ) {
    result.pickerTokens = result.picker;
  }
  // Casino
  if (
    typeof result.casinoTokens === "number" &&
    typeof result.casino !== "number"
  ) {
    result.casino = result.casinoTokens;
  }
  if (
    typeof result.casino === "number" &&
    typeof result.casinoTokens !== "number"
  ) {
    result.casinoTokens = result.casino;
  }
  // PvP
  if (
    typeof result.pvpTokens === "number" &&
    typeof result.pvp !== "number"
  ) {
    result.pvp = result.pvpTokens;
  }
  if (
    typeof result.pvp === "number" &&
    typeof result.pvpTokens !== "number"
  ) {
    result.pvpTokens = result.pvp;
  }
  return result;
}

// --- ProfileContextType Interface ---
interface ProfileContextType {
  user: FirebaseUser | null;
  profile: ProfileData | null;
  isAuthenticated: boolean;
  loading: boolean;
  firebaseAuthToken: string | null;
  refreshProfile: () => Promise<void>;
  updateUserProfile: (data: Partial<ProfileData>) => Promise<void>;
  logout: () => Promise<void>;
}

// Create the React Context
const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

// --- Internal Helper: ensureUserProfileData ---
const ensureUserProfileData = async (
  firebaseUser: FirebaseUser,
  walletPublicKey: string | null,
  connected: boolean
): Promise<ProfileData> => {
  const userRef = doc(db, "users", firebaseUser.uid);
  const userSnap = await getDoc(userRef);

  let profileData: ProfileData;

  if (!userSnap.exists()) {
    console.log("ensureUserProfileData: Creating new profile for", firebaseUser.uid);
    const now = new Date().toISOString();
    profileData = {
      ...DEFAULT_PROFILE,
      uid: firebaseUser.uid,
      username: firebaseUser.displayName || `user-${Math.random().toString(36).substring(2, 9)}`,
      usernameLowercase: (firebaseUser.displayName || `user-${Math.random().toString(36).substring(2, 9)}`).toLowerCase(),
      avatarUrl: firebaseUser.photoURL || DEFAULT_PROFILE.avatarUrl,
      wallet: walletPublicKey || "",
      isOnline: true,
      lastSeen: now,
      createdAt: now,
      lastLogin: now,
    };
    await setDoc(userRef, profileData);
  } else {
    console.log("ensureUserProfileData: Fetching existing profile for", firebaseUser.uid);
    const fetchedData = userSnap.data() as ProfileData;

    profileData = {
      ...DEFAULT_PROFILE,
      ...fetchedData,
      uid: firebaseUser.uid,
      stats: { ...DEFAULT_PROFILE.stats, ...(fetchedData.stats || {}) },
      coins: { ...DEFAULT_PROFILE.coins, ...(fetchedData.coins || {}) },
      freeEntryTokens: mergeFreeEntryTokens({ ...DEFAULT_PROFILE.freeEntryTokens, ...(fetchedData.freeEntryTokens || {}) }),
      friends: fetchedData.friends || [],
      friendRequests: fetchedData.friendRequests || [],
      sentInvitations: fetchedData.sentInvitations || [],
      duelInvitations: fetchedData.duelInvitations || [],
      pvpRoomInvites: fetchedData.pvpRoomInvites || [],
      recentGames: fetchedData.recentGames || [],
    };

    const updateFields: Partial<ProfileData> = {};
    if (walletPublicKey && profileData.wallet !== walletPublicKey) {
      updateFields.wallet = walletPublicKey;
    }
    const now = new Date().toISOString();
    updateFields.isOnline = true;
    updateFields.lastSeen = now;
    updateFields.lastLogin = now;

    if (Object.keys(updateFields).length > 0) {
      console.log("ensureUserProfileData: Updating existing profile fields for", firebaseUser.uid, updateFields);
      await updateDoc(userRef, updateFields);
      profileData = { ...profileData, ...updateFields };
    }
  }

  // Always merge freeEntryTokens for robust access in frontend
  profileData.freeEntryTokens = mergeFreeEntryTokens(profileData.freeEntryTokens);

  return profileData;
};

// --- ProfileProvider Component ---
export const ProfileProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [firebaseAuthToken, setFirebaseAuthToken] = useState<string | null>(null);

  const { connected, disconnect, publicKey } = useWallet();
  const navigate = useNavigate();

  const refreshProfile = useCallback(async () => {
    if (!user) {
      console.warn("ProfileContext: Cannot refresh profile - no current Firebase user.");
      setProfile(null);
      return;
    }

    console.log("ProfileContext: Refreshing profile for", user.uid);
    try {
      const fetchedProfile = await ensureUserProfileData(
        user,
        publicKey?.toBase58() || null,
        connected
      );
      setProfile(fetchedProfile);
      console.log("ProfileContext: Profile refreshed:", fetchedProfile);
    } catch (error) {
      console.error("ProfileContext: Error during profile refresh:", error);
      toast.error("Failed to refresh user profile data.");
      setProfile(null);
    }
  }, [user, publicKey, connected]);

  const updateUserProfile = useCallback(
    async (data: Partial<ProfileData>) => {
      if (!user) {
        toast.error("Not logged in to update profile.");
        console.warn("ProfileContext: Attempted to update profile without a logged-in user.");
        return;
      }

      const userDocRef = doc(db, "users", user.uid);
      try {
        await updateDoc(userDocRef, { ...data, updatedAt: new Date().toISOString() });
        setProfile((prev) => {
          if (!prev) return null;
          // Always merge tokens
          return {
            ...prev,
            ...data,
            stats: data.stats ? { ...prev.stats, ...data.stats } : prev.stats,
            coins: data.coins ? { ...prev.coins, ...data.coins } : prev.coins,
            freeEntryTokens: data.freeEntryTokens
              ? mergeFreeEntryTokens({ ...prev.freeEntryTokens, ...data.freeEntryTokens })
              : prev.freeEntryTokens,
          };
        });
        toast.success("Profile updated successfully!");
        console.log("ProfileContext: Profile updated for", user.uid, data);
      } catch (error) {
        console.error("ProfileContext: Error updating user profile:", error);
        toast.error("Failed to update profile.");
      }
    },
    [user]
  );

  const logout = useCallback(
    async () => {
      console.log("ProfileContext: Explicit logout initiated.");
      setLoading(true);
      try {
        if (user) {
          const userDocRef = doc(db, "users", user.uid);
          await updateDoc(userDocRef, { isOnline: false, lastSeen: new Date().toISOString() });
          console.log("ProfileContext: User's online status set to false in Firestore.");
        }

        if (socket.connected) {
          socket.disconnect();
          console.log("ProfileContext: Socket.IO disconnected.");
        }

        if (connected) {
          await disconnect();
          console.log("ProfileContext: Solana wallet disconnected.");
        }

        await firebaseSignOut(auth);
        console.log("ProfileContext: Signed out from Firebase.");

        setUser(null);
        setProfile(null);
        setIsAuthenticated(false);
        setFirebaseAuthToken(null);

        toast.info("You have been logged out.");
        navigate("/landing");
      } catch (error) {
        console.error("ProfileContext: Error during explicit logout:", error);
        toast.error("Failed to log out.");
      } finally {
        setLoading(false);
      }
    },
    [user, connected, disconnect, navigate]
  );

  useEffect(() => {
    console.log("ProfileContext: onAuthStateChanged listener setup.");
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log("--- onAuthStateChanged Fired ---");
      console.log("firebaseUser received:", firebaseUser ? firebaseUser.uid : null);

      setLoading(true);

      if (firebaseUser) {
        console.log("ProfileContext: User logged in:", firebaseUser.uid);
        setUser(firebaseUser);
        setIsAuthenticated(true);

        try {
          const userProfileData = await ensureUserProfileData(
            firebaseUser,
            publicKey?.toBase58() || null,
            connected
          );
          setProfile(userProfileData);
          console.log("ProfileContext: User profile loaded/ensured:", userProfileData);

          if (!socket.connected) {
            socket.connect();
          }
          socket.emit("setUid", firebaseUser.uid);
          console.log("ProfileContext: Socket.IO setUid emitted for UID:", firebaseUser.uid);
        } catch (error) {
          console.error("ProfileContext: Error during profile load/ensure:", error);
          setProfile(null);
          toast.error("Error loading user profile. Please refresh.");
        }

        try {
          const token = await firebaseUser.getIdToken(true);
          setFirebaseAuthToken(token);
          console.log("ProfileContext: Firebase ID Token generated.");
        } catch (error) {
          console.error("ProfileContext: Error getting Firebase ID token:", error);
          setFirebaseAuthToken(null);
        }
      } else {
        console.log("ProfileContext: User logged out from Firebase.");
        setUser(null);
        setProfile(null);
        setIsAuthenticated(false);
        setFirebaseAuthToken(null);

        if (socket.connected) {
          socket.disconnect();
          console.log("ProfileContext: Socket.IO disconnected.");
        }
      }
      setLoading(false);
      console.log("--- onAuthStateChanged Finished ---");
    });

    return () => {
      console.log("ProfileContext: Cleaning up onAuthStateChanged listener.");
      unsubscribe();
    };
  }, [publicKey, connected]);

  useEffect(() => {
    if (user && !connected && !loading && isAuthenticated) {
      console.log("ProfileContext: Solana wallet disconnected for active Firebase user. Initiating Firebase logout...");
      if (auth.currentUser && auth.currentUser.uid === user.uid) {
        firebaseSignOut(auth)
          .then(() => {
            console.log("ProfileContext: Firebase user signed out due to Solana wallet disconnect.");
          })
          .catch((error) => {
            console.error("ProfileContext: Error signing out from Firebase after Solana wallet disconnect:", error);
            toast.error("Failed to log out after wallet disconnect.");
          });
      } else {
        console.log("ProfileContext: auth.currentUser mismatch or null after Solana disconnect. No action.");
      }
    }
  }, [connected, user, loading, isAuthenticated]);

  const contextValue = useMemo(
    () => ({
      user,
      profile,
      isAuthenticated,
      loading,
      firebaseAuthToken,
      refreshProfile,
      updateUserProfile,
      logout,
    }),
    [user, profile, isAuthenticated, loading, firebaseAuthToken, refreshProfile, updateUserProfile, logout]
  );

  return (
    <ProfileContext.Provider value={contextValue}>
      {children}
    </ProfileContext.Provider>
  );
};

export const useProfile = () => {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error("useProfile must be used within a ProfileProvider");
  }
  return context;
};