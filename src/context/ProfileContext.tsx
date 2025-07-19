import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseConfig';
import { toast } from 'react-toastify';

// --- ProfileData Interface Definition ---
// This defines the structure of a user's profile data stored in Firestore.
export interface ProfileData {
  uid: string;
  username: string;
  usernameLowercase: string;
  wallet: string; // Solana wallet address
  avatarUrl: string;
  bio: string;
  dmsOpen: boolean; // Whether direct messages are open
  duelsOpen: boolean; // Whether duel invitations are open
  isOnline: boolean; // User's online status
  lastSeen: string; // Timestamp of last activity

  // Nested objects for various stats
  stats: {
    arcadeXP: number;
    pickerArcade: number;
    pickerCasino: number;
    // Add other game/platform specific stats here
    [key: string]: number; // Allow for other dynamic stat keys
  };

  // Nested objects for different coin types
  coins: {
    arcade: number;
    casino: number;
    // Add other coin types here
    [key: string]: number; // Allow for other dynamic coin keys
  };

  // Nested object for free entry tokens for different game types
  freeEntryTokens: {
    pickerTokens: number;
    arcadeTokens: number;
    casinoTokens: number;
    // Add other free token types here
    [key: string]: number; // Allow for other dynamic token keys
  };

  // Array to store recent game history entries
  recentGames: any[]; // Consider defining a more specific interface for game history entries
  
  // You can add more fields as your application grows
  // For example: lastLogin, createdDate, friendList, etc.
}

// --- DEFAULT_PROFILE Constant ---
// This provides default values for a new user's profile or a fallback when data is missing.
export const DEFAULT_PROFILE: ProfileData = {
  uid: "",
  username: "Guest",
  usernameLowercase: "guest",
  wallet: "",
  avatarUrl: "/placeholder-avatar.png", // Default avatar if none is set
  bio: "",
  dmsOpen: true,
  duelsOpen: true,
  isOnline: false,
  lastSeen: new Date().toISOString(), // Current timestamp as ISO string

  stats: {
    arcadeXP: 0,
    pickerArcade: 0,
    pickerCasino: 0,
  },

  coins: {
    arcade: 0,
    casino: 0,
  },

  freeEntryTokens: {
    pickerTokens: 0,
    arcadeTokens: 0,
    casinoTokens: 0,
  },

  recentGames: [],
};

// --- ProfileContextType Interface ---
// Defines the shape of the context value that will be provided to consumers.
interface ProfileContextType {
  currentUser: FirebaseUser | null; // The authenticated Firebase user object
  userProfile: ProfileData; // The user's custom profile data from Firestore
  isAuthenticated: boolean; // True if a user is logged in
  loadingAuth: boolean; // True if authentication state is currently being determined
  firebaseAuthToken: string | null; // Firebase ID token for backend authentication
  refreshProfile: () => Promise<void>; // Function to manually refresh user profile data
  updateUserProfile: (data: Partial<ProfileData>) => Promise<void>; // Function to update user profile
}

// Create the React Context
const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

// --- ProfileProvider Component ---
// This component wraps your application and provides the profile context to all children.
export const ProfileProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<ProfileData>(DEFAULT_PROFILE);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [firebaseAuthToken, setFirebaseAuthToken] = useState<string | null>(null);

  // Callback to refresh the user's profile data from Firestore
  const refreshProfile = useCallback(async () => {
    if (!currentUser) {
      console.log("ProfileContext: Cannot refresh profile - no current user.");
      return;
    }

    console.log("ProfileContext: Refreshing profile for", currentUser.uid);
    const userDocRef = doc(db, "users", currentUser.uid);
    try {
      const userDocSnap = await getDoc(userDocRef);
      if (userDocSnap.exists()) {
        const fetchedProfileData = userDocSnap.data() as ProfileData;
        
        // Merge fetched data with DEFAULT_PROFILE to ensure all fields are present and typed correctly
        const mergedProfile = {
          ...DEFAULT_PROFILE,
          ...fetchedProfileData,
          stats: { ...DEFAULT_PROFILE.stats, ...(fetchedProfileData.stats || {}) },
          coins: { ...DEFAULT_PROFILE.coins, ...(fetchedProfileData.coins || {}) },
          freeEntryTokens: { ...DEFAULT_PROFILE.freeEntryTokens, ...(fetchedProfileData.freeEntryTokens || {}) },
          recentGames: fetchedProfileData.recentGames || [],
        };
        setUserProfile(mergedProfile);
        console.log("ProfileContext: Profile refreshed and set to:", mergedProfile);
      } else {
        // This case indicates a profile document that somehow got deleted while the user was logged in
        console.warn("ProfileContext: User profile document not found during refresh for logged-in user. Resetting to default.");
        setUserProfile(DEFAULT_PROFILE); // Fallback to default
        // Optionally, you might want to create a new one here, or prompt the user.
      }
    } catch (error) {
      console.error("ProfileContext: Error during profile refresh:", error);
      toast.error("Failed to refresh user profile data.");
    }
  }, [currentUser]); // Dependency on currentUser ensures this function is stable as long as currentUser is stable

  // Callback to update the user's profile data in Firestore and local state
  const updateUserProfile = useCallback(async (data: Partial<ProfileData>) => {
    if (!currentUser) {
      toast.error("Not logged in to update profile.");
      console.warn("ProfileContext: Attempted to update profile without a logged-in user.");
      return;
    }

    const userDocRef = doc(db, "users", currentUser.uid);
    try {
      await updateDoc(userDocRef, data);
      // Optimistically update local state
      setUserProfile(prev => ({
        ...prev,
        ...data,
        // Deep merge nested objects if they are part of the update
        stats: data.stats ? { ...prev.stats, ...data.stats } : prev.stats,
        coins: data.coins ? { ...prev.coins, ...data.coins } : prev.coins,
        freeEntryTokens: data.freeEntryTokens ? { ...prev.freeEntryTokens, ...data.freeEntryTokens } : prev.freeEntryTokens,
        recentGames: data.recentGames ? data.recentGames : prev.recentGames,
      }));
      toast.success("Profile updated successfully!");
      console.log("ProfileContext: Profile updated for", currentUser.uid, data);
    } catch (error) {
      console.error("ProfileContext: Error updating user profile:", error);
      toast.error("Failed to update profile.");
    }
  }, [currentUser]); // Dependency on currentUser

  // Main effect for handling Firebase authentication state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoadingAuth(true); // Indicate that authentication state is being determined
      setCurrentUser(firebaseUser);
      setIsAuthenticated(!!firebaseUser);

      if (firebaseUser) {
        console.log("ProfileContext: Auth state changed - User logged in:", firebaseUser.uid);
        const userDocRef = doc(db, "users", firebaseUser.uid);
        try {
          const userDocSnap = await getDoc(userDocRef);
          if (userDocSnap.exists()) {
            const fetchedProfileData = userDocSnap.data() as ProfileData;
            console.log("ProfileContext: Raw profile fetched from Firestore (on auth change):", fetchedProfileData);

            // Merge fetched data with DEFAULT_PROFILE to ensure all fields are initialized
            const mergedProfile = {
              ...DEFAULT_PROFILE, // Start with all defaults from ProfileData interface
              ...fetchedProfileData, // Overlay fetched data from Firestore
              // Explicitly merge nested objects to ensure they are maps and have defaults
              stats: { ...DEFAULT_PROFILE.stats, ...(fetchedProfileData.stats || {}) },
              coins: { ...DEFAULT_PROFILE.coins, ...(fetchedProfileData.coins || {}) },
              freeEntryTokens: { ...DEFAULT_PROFILE.freeEntryTokens, ...(fetchedProfileData.freeEntryTokens || {}) },
              recentGames: fetchedProfileData.recentGames || [], // Ensure recentGames is an array
              uid: firebaseUser.uid, // Ensure UID from Firebase user is used
            };
            setUserProfile(mergedProfile);
            console.log("ProfileContext: Merged user profile set to:", mergedProfile);
          } else {
            // New user, or profile document missing - create a new one with default values
            console.log("ProfileContext: User profile does not exist. Creating new default profile.");
            const newProfile: ProfileData = {
              ...DEFAULT_PROFILE, // Initialize from DEFAULT_PROFILE
              uid: firebaseUser.uid,
              username: firebaseUser.displayName || `user-${Math.random().toString(36).substring(2, 9)}`,
              usernameLowercase: (firebaseUser.displayName || `user-${Math.random().toString(36).substring(2, 9)}`).toLowerCase(),
              avatarUrl: firebaseUser.photoURL || DEFAULT_PROFILE.avatarUrl,
              isOnline: true, // New users are online by default upon creation
              lastSeen: new Date().toISOString(),
            };
            await setDoc(userDocRef, newProfile); // Set the new profile in Firestore
            setUserProfile(newProfile); // Update local state
            console.log("ProfileContext: New default profile created and set:", newProfile);
          }
        } catch (error) {
          console.error("ProfileContext: Error fetching/creating user profile:", error);
          setUserProfile(DEFAULT_PROFILE); // Fallback to default on error
          toast.error("Error loading user profile. Please refresh.");
        }

        // Get Firebase ID token for backend authentication
        try {
          const token = await firebaseUser.getIdToken(true); // `true` forces a token refresh
          setFirebaseAuthToken(token);
          console.log("ProfileContext: Firebase ID Token generated (on auth change).");
        } catch (error) {
          console.error("ProfileContext: Error getting Firebase ID token (on auth change):", error);
          setFirebaseAuthToken(null);
        }
      } else {
        // User logged out
        console.log("ProfileContext: Auth state changed - User logged out.");
        setCurrentUser(null);
        setUserProfile(DEFAULT_PROFILE); // Reset profile to default state
        setIsAuthenticated(false);
        setFirebaseAuthToken(null);
      }
      setLoadingAuth(false); // Authentication state determination complete
    });

    // Cleanup function: unsubscribe from auth state changes when component unmounts
    return () => unsubscribe();
  }, []); // Empty dependency array ensures this effect runs only once on mount

  // Memoize the context value to prevent unnecessary re-renders of consumers
  const contextValue = useMemo(() => ({
    currentUser,
    userProfile,
    isAuthenticated,
    loadingAuth,
    firebaseAuthToken,
    refreshProfile,
    updateUserProfile,
  }), [currentUser, userProfile, isAuthenticated, loadingAuth, firebaseAuthToken, refreshProfile, updateUserProfile]);

  return (
    <ProfileContext.Provider value={contextValue}>
      {children}
    </ProfileContext.Provider>
  );
};

// --- useProfile Custom Hook ---
// Provides a convenient way for functional components to access the profile context.
export const useProfile = () => {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return context;
};