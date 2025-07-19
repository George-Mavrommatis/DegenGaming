// src/pages/Profile.tsx

import React, { useEffect, useState, useRef } from "react";
import type { ProfileData, RecentGame } from "../types/profile"; // Ensure this path is correct for your ProfileData and RecentGame types
import { toast } from "react-toastify";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
// import { useFirebaseUser } from "../firebase/useFirebaseUser"; // <-- REMOVED: Consolidate user data through useProfile
import { useWallet } from "@solana/wallet-adapter-react";
import { useProfile } from "../context/ProfileContext"; // Ensure this path is correct
import { Link } from 'react-router-dom';
import { collection, query, where, getDocs, doc, setDoc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig"; // Ensure 'db' is correctly exported from firebaseConfig
import { FaEdit, FaHistory, FaGamepad, FaCoins } from 'react-icons/fa';
import UserDashboard from "../components/UserDashboard"; // Ensure this path is correct

// RECOMMENDATION: Define DEFAULT_PROFILE closer to ProfileContext or in a shared types file
// This ensures that DEFAULT_PROFILE is consistent across where profiles are created/fetched
// and where they are consumed. For now, it's fine here, but consider moving it.
export const DEFAULT_PROFILE: ProfileData = {
  username: "",
  usernameLowercase: "",
  wallet: "",
  avatarUrl: "",
  bio: "",
  level: 1,
  accountXP: 0,
  badges: [],
  wegenNFTs: 0,
  stats: {
    totalGamesPlayed: 0,
    totalWins: 0,
    bestScores: {},
    arcadeGamesPlayed: 0,
    pickerGamesPlayed: 0,
    pvpGamesPlayed: 0,
    casinoGamesPlayed: 0,
  },
  coins: {
    arcade: 0,
    picker: 0,
    casino: 0,
    pvp: 0
  },
  freeEntryTokens: {
    arcadeTokens: 0,
    pickerTokens: 0,
    casinoTokens: 0,
    pvpTokens: 0
  },
  recentGames: [],
  twitter: "",
  discord: "",
  telegram: "",
  instagram: "",
  isOnline: false,
  dmsOpen: false,
  duelsOpen: false,
};

export default function Profile() {
  // Recommendation: Consolidate user fetching via useProfile
  // Instead of useFirebaseUser, get the Firebase user directly from useProfile
  const { 
    currentUser: user, // Rename currentUser to 'user' for consistency with existing code
    userProfile: profile, // Rename userProfile to 'profile' for consistency
    updateProfile, // This is likely a function from ProfileContext to update Firestore profile (useful!)
    refreshProfile, 
    loading: profileLoading, // Renamed from 'loadingProfile' in context to 'profileLoading' here for clarity
    isAuthenticated // Added to handle authenticated state more explicitly
  } = useProfile(); 

  const walletAdapter = useWallet();

  const [form, setForm] = useState<ProfileData>({ ...DEFAULT_PROFILE });
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [usernameError, setUsernameError] = useState("");
  const [usernameChecking, setUsernameChecking] = useState(false);
  const usernameInputRef = useRef<HTMLInputElement>(null);

  // --- Debugging Logs (Keep these while debugging, remove in production) ---
  useEffect(() => {
    console.log("Profile.tsx Render Cycle:");
    console.log("  isAuthenticated:", isAuthenticated);
    console.log("  currentUser (user):", user);
    console.log("  profile (from useProfile):", profile);
    console.log("  profileLoading:", profileLoading);
    console.log("  Current form state:", form);
  }, [isAuthenticated, user, profile, profileLoading, form]);
  // --- End Debugging Logs ---

  // Load profile data into form state
  // This useEffect ensures the form is updated when 'profile' from ProfileContext changes
  useEffect(() => {
    if (!profileLoading) { // Ensure profile data has finished loading from context
      if (user && profile) { // If user is logged in AND profile data is available
        console.log("Profile.tsx: Populating form with fetched profile data.");
        setForm({
          ...DEFAULT_PROFILE, // Start with defaults to ensure all fields are present
          ...profile,       // Overlay fetched profile data
          // Ensure nested objects are merged properly if they might be partially present
          stats: { ...DEFAULT_PROFILE.stats, ...(profile.stats || {}) },
          coins: { ...DEFAULT_PROFILE.coins, ...(profile.coins || {}) },
          freeEntryTokens: { ...DEFAULT_PROFILE.freeEntryTokens, ...(profile.freeEntryTokens || {}) },
          recentGames: profile.recentGames || [] // Ensure recentGames is an array
        });
        setAvatarPreview(null); // Clear preview when new profile loads
        setAvatarFile(null);    // Clear file when new profile loads
      } else if (!user) { // If no user is logged in
        console.log("Profile.tsx: Resetting form to default as no user is logged in.");
        setForm({ ...DEFAULT_PROFILE });
        setAvatarPreview(null);
        setAvatarFile(null);
      }
    }
  }, [user, profile, profileLoading]); // Add profileLoading to dependencies

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type, checked } = e.target;
    setForm(f => ({
      ...f,
      [name]: type === "checkbox" ? checked : value ?? ""
    }));
  };

  // Handle avatar file change
  const handleAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const file = e.target.files[0];
      // Basic validation for file size (e.g., 5MB limit)
      if (file.size > 5 * 1024 * 1024) {
          toast.error("Avatar image too large (max 5MB).");
          e.target.value = ''; // Clear the input
          setAvatarFile(null);
          setAvatarPreview(null);
          return;
      }
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  // Check if username is unique
  // Suggestion: Add debouncing to this function for better UX on input
  const checkUsernameUnique = async (username: string) => {
    const trimmedUsername = username.trim().toLowerCase();
    
    // If username is empty, or if it's the current user's *original* username (case-insensitive)
    if (!trimmedUsername || (profile && trimmedUsername === (profile.username || "").toLowerCase())) {
      setUsernameError("");
      return true;
    }

    setUsernameChecking(true);
    try {
        const q = query(collection(db, "users"), where("usernameLowercase", "==", trimmedUsername));
        const querySnapshot = await getDocs(q);
        
        // If a document exists AND it's not the current user's document
        const isTaken = !querySnapshot.empty && querySnapshot.docs[0].id !== user?.uid;
        setUsernameError(isTaken ? "Username is already taken!" : "");
        return !isTaken;
    } catch (error) {
        console.error("Error checking username uniqueness:", error);
        setUsernameError("Error checking username. Please try again.");
        return false; // Assume not unique on error to prevent overwriting
    } finally {
        setUsernameChecking(false);
    }
  };

  // Save profile changes safely (merge: true)
  const handleSave = async () => {
    if (!user) {
        toast.error("You must be logged in to save your profile.");
        return;
    }
    setSaving(true);
    
    // Re-check uniqueness right before saving to prevent race conditions
    const isUnique = await checkUsernameUnique(form.username);
    if (!isUnique) {
      toast.error("Please choose a different username.");
      usernameInputRef.current?.focus();
      setSaving(false);
      return;
    }

    try {
      let finalAvatarUrl = form.avatarUrl;
      if (avatarFile) {
        const storageInstance = getStorage(); // Get storage instance
        const avatarPath = `avatars/${user.uid}/${Date.now()}_${avatarFile.name}`;
        const avatarRef = ref(storageInstance, avatarPath);
        await uploadBytes(avatarRef, avatarFile);
        finalAvatarUrl = await getDownloadURL(avatarRef);
      }

      // Create a partial object with only fields that can be updated via the form
      const dataToSave: Partial<ProfileData> = {
        username: form.username.trim(),
        usernameLowercase: form.username.trim().toLowerCase(),
        avatarUrl: finalAvatarUrl,
        bio: form.bio,
        twitter: form.twitter,
        discord: form.discord,
        telegram: form.telegram,
        instagram: form.instagram,
        dmsOpen: !!form.dmsOpen,
        duelsOpen: !!form.duelsOpen,
        // wallet: profile?.wallet || walletAdapter.publicKey?.toBase58() || "",
        // Recommendation: Wallet should be set once on user creation/wallet connect, not editable via form.
        // If you intend for users to change/update wallet, handle with care.
        // For now, let's assume wallet comes from profile context and isn't modified here.
      };

      // Firestore update: Use setDoc with merge: true for partial updates
      // This is crucial to avoid overwriting level, XP, stats, tokens, etc.
      await setDoc(doc(db, "users", user.uid), dataToSave, { merge: true });
      
      // Refresh profile data in context after successful save
      await refreshProfile(); 
      toast.success("Profile saved successfully!");
      setAvatarFile(null);
      setAvatarPreview(null);
    } catch (err) {
      console.error("Failed to save profile:", err);
      toast.error("Failed to save profile: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  // --- Conditional Rendering for Loading/Not Logged In ---
  if (profileLoading) {
    console.log("Profile.tsx: Displaying loading state.");
    return <div className="text-center text-white mt-20 text-xl font-bold animate-pulse">Loading Profile...</div>;
  }

  // If not authenticated AND not loading, prompt login
  if (!isAuthenticated || !user) {
    console.log("Profile.tsx: Displaying not logged in state.");
    return (
      <div className="text-center text-white mt-20">
        <p className="text-xl font-bold mb-4">Please sign in to view your profile.</p>
        {/* You might want a button to redirect to login or open a login modal here */}
      </div>
    );
  }
  // --- End Conditional Rendering ---

  // If we reach here, profileLoading is false, isAuthenticated is true, and 'user' (currentUser) exists.
  // The 'profile' object from useProfile might still be null if no document exists in Firestore
  // or if there was an error fetching it and the fallback in ProfileContext didn't set enough data.
  // It's crucial that ProfileContext provides at least a basic profile object if a user exists.
  // If 'profile' is null here, it means ProfileContext's fallback isn't working as expected.

  // Determine displayed avatar (preview > form.avatarUrl > default)
  const displayedAvatar = avatarPreview || form.avatarUrl || '/WegenRaceAssets/G1small.png'; // Updated default avatar path if needed

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: User Card & Dashboard */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-gray-800 rounded-lg p-6 text-center shadow-lg">
            <div className="relative inline-block mb-4">
              <img 
                src={displayedAvatar} 
                alt="Avatar" 
                className="w-32 h-32 rounded-full mx-auto border-4 border-purple-500 object-cover" 
                onError={(e) => { e.currentTarget.src = '/WegenRaceAssets/G1small.png'; }} // Fallback if image fails to load
              />
              <label className="absolute bottom-1 right-1 bg-purple-600 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer hover:bg-purple-700 transition">
                <FaEdit />
                <input type="file" accept="image/*" onChange={handleAvatar} className="hidden" />
              </label>
            </div>
            {/* Display username from form, which should be populated by profile */}
            <h2 className="text-2xl font-bold font-orbitron">{form.username || "Guest Player"}</h2> 
            {/* Display wallet from form, which should be populated by profile */}
            <p className="text-sm text-gray-400 break-all">{form.wallet || walletAdapter.publicKey?.toBase58() || "No Wallet Connected"}</p>
          </div>

          {/* New Section: Free Entry Tokens */}
          <div className="bg-gray-800 rounded-lg p-6 shadow-lg">
            <h3 className="text-xl font-semibold mb-4 font-orbitron">Free Entry Tokens</h3>
            {/* Use optional chaining and check form.freeEntryTokens directly, as it's kept up to date */}
            {form.freeEntryTokens ? ( 
              <div className="grid grid-cols-2 gap-4 text-center">
                <div className="p-3 bg-gray-900 rounded-lg">
                  <p className="text-sm text-gray-400">Arcade</p>
                  <p className="text-xl font-bold text-green-400">{form.freeEntryTokens.arcadeTokens}</p>
                </div>
                <div className="p-3 bg-gray-900 rounded-lg">
                  <p className="text-sm text-gray-400">Picker</p>
                  <p className="text-xl font-bold text-yellow-400">{form.freeEntryTokens.pickerTokens}</p>
                </div>
                <div className="p-3 bg-gray-900 rounded-lg">
                  <p className="text-sm text-gray-400">Casino</p>
                  <p className="text-xl font-bold text-red-400">{form.freeEntryTokens.casinoTokens}</p>
                </div>
                <div className="p-3 bg-gray-900 rounded-lg">
                  <p className="text-sm text-gray-400">PvP</p>
                  <p className="text-xl font-bold text-blue-400">{form.freeEntryTokens.pvpTokens}</p>
                </div>
              </div>
            ) : (
              <p className="text-gray-500">No free entry tokens available yet.</p>
            )}
          </div>
          {/* End New Section */}

          {/* UserDashboard should also receive the potentially updated 'form' data */}
          <UserDashboard profile={form} /> 
        </div>

        {/* Right Column: Edit Form & Recent Activity */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-gray-800 rounded-lg p-6 shadow-lg">
            <h3 className="text-xl font-semibold mb-4 font-orbitron">Edit Profile</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold mb-1 text-gray-400">Username</label>
                <input 
                  ref={usernameInputRef} 
                  type="text" 
                  name="username" 
                  value={form.username} 
                  onChange={handleChange} 
                  onBlur={(e) => checkUsernameUnique(e.target.value)} 
                  className="w-full p-2 bg-gray-900 rounded border border-gray-700 focus:ring-purple-500 focus:border-purple-500" 
                />
                {usernameChecking && <span className="text-xs text-blue-400">Checking…</span>}
                {usernameError && <p className="text-xs text-red-500 mt-1">{usernameError}</p>}
              </div>
              <div>
                <label className="block text-sm font-bold mb-1 text-gray-400">Bio</label>
                <textarea 
                  name="bio" 
                  value={form.bio ?? ''} // Use nullish coalescing for safety
                  onChange={handleChange} 
                  className="w-full p-2 bg-gray-900 rounded border border-gray-700 h-24 focus:ring-purple-500 focus:border-purple-500" 
                />
              </div>
              {/* Social media inputs */}
              <div className="flex gap-4">
                <div className="flex-1"> {/* Added flex-1 for better layout */}
                  <label className="block text-sm font-bold mb-1 text-gray-400">Twitter</label>
                  <input type="text" name="twitter" value={form.twitter ?? ""} onChange={handleChange} className="w-full p-2 bg-gray-900 rounded border border-gray-700" />
                </div>
                <div className="flex-1"> {/* Added flex-1 for better layout */}
                  <label className="block text-sm font-bold mb-1 text-gray-400">Discord</label>
                  <input type="text" name="discord" value={form.discord ?? ""} onChange={handleChange} className="w-full p-2 bg-gray-900 rounded border border-gray-700" />
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1"> {/* Added flex-1 for better layout */}
                  <label className="block text-sm font-bold mb-1 text-gray-400">Telegram</label>
                  <input type="text" name="telegram" value={form.telegram ?? ""} onChange={handleChange} className="w-full p-2 bg-gray-900 rounded border border-gray-700" />
                </div>
                <div className="flex-1"> {/* Added flex-1 for better layout */}
                  <label className="block text-sm font-bold mb-1 text-gray-400">Instagram</label>
                  <input type="text" name="instagram" value={form.instagram ?? ""} onChange={handleChange} className="w-full p-2 bg-gray-900 rounded border border-gray-700" />
                </div>
              </div>
              {/* Checkboxes */}
              <div className="flex gap-6 mt-4">
                <label className="flex gap-2 items-center text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    name="dmsOpen"
                    checked={!!form.dmsOpen} // Ensure boolean
                    onChange={handleChange}
                    className="form-checkbox h-4 w-4 text-purple-600 rounded" // Tailwind styling for checkboxes
                  />Open to DMs
                </label>
                <label className="flex gap-2 items-center text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    name="duelsOpen"
                    checked={!!form.duelsOpen} // Ensure boolean
                    onChange={handleChange}
                    className="form-checkbox h-4 w-4 text-purple-600 rounded" // Tailwind styling for checkboxes
                  />Open for Duels
                </label>
              </div>
              <div className="text-right">
                <button 
                  onClick={handleSave} 
                  disabled={saving || usernameChecking || !!usernameError} // Disable if saving, checking username, or username has error
                  className="bg-purple-600 hover:bg-purple-700 font-bold py-2 px-6 rounded-lg transition disabled:bg-gray-500 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-6 shadow-lg">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold font-orbitron">Recent Activity</h3>
              <Link to="/profile/history" className="flex items-center gap-2 text-sm text-purple-400 hover:underline">
                <FaHistory /> View Full History
              </Link>
            </div>
            <div className="space-y-3">
              {/* Ensure form.recentGames is an array before mapping */}
              {form.recentGames && form.recentGames.length > 0 ? form.recentGames.slice(0, 5).map((game: RecentGame, idx) => (
                <div key={idx} className="bg-gray-900/50 p-3 rounded-lg flex items-center justify-between text-sm flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <FaGamepad className="text-purple-400" />
                    <span className="font-semibold">{game.gameName}</span>
                  </div>
                  <div className="flex items-center gap-4 font-mono">
                    <span>Score: {game.score.toLocaleString()}</span>
                    <span className="flex items-center gap-1 text-yellow-400"><FaCoins /> +{game.coinsEarned}</span>
                  </div>
                </div>
              )) : <p className="text-gray-500">No recent games. Go play!</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}