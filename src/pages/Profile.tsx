import React, { useEffect, useState, useRef } from "react";
import type { ProfileData, RecentGame } from "../types/profile";
import { toast } from "react-toastify";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useFirebaseUser } from "../firebase/useFirebaseUser";
import { useWallet } from "@solana/wallet-adapter-react";
import { useProfile } from "../context/ProfileContext";
import { Link } from 'react-router-dom';
import { collection, query, where, getDocs, doc, setDoc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { FaEdit, FaHistory, FaGamepad, FaCoins } from 'react-icons/fa';
import UserDashboard from "../components/UserDashboard";

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
  const { user } = useFirebaseUser();
  const walletAdapter = useWallet();
  const { profile, updateProfile, refreshProfile, loading: profileLoading } = useProfile();

  const [form, setForm] = useState<ProfileData>({ ...DEFAULT_PROFILE });
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [usernameError, setUsernameError] = useState("");
  const [usernameChecking, setUsernameChecking] = useState(false);
  const usernameInputRef = useRef<HTMLInputElement>(null);

  // Load profile data into form state
  useEffect(() => {
    if (user && profile) {
      setForm({
        ...DEFAULT_PROFILE,
        ...profile,
        stats: { ...DEFAULT_PROFILE.stats, ...(profile.stats || {}) }
      });
      setAvatarPreview(null);
      setAvatarFile(null);
    } else if (!user) {
      setForm({ ...DEFAULT_PROFILE });
      setAvatarPreview(null);
      setAvatarFile(null);
    }
  }, [user, profile]);

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
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  // Check if username is unique
  const checkUsernameUnique = async (username: string) => {
    const trimmedUsername = username.trim().toLowerCase();
    if (!trimmedUsername || (profile && trimmedUsername === (profile.username || "").toLowerCase())) {
      setUsernameError("");
      return true;
    }
    setUsernameChecking(true);
    const q = query(collection(db, "users"), where("usernameLowercase", "==", trimmedUsername));
    const querySnapshot = await getDocs(q);
    const isTaken = !querySnapshot.empty && querySnapshot.docs[0].id !== user?.uid;
    setUsernameError(isTaken ? "Username is already taken!" : "");
    setUsernameChecking(false);
    return !isTaken;
  };

  // Save profile changes safely (merge: true)
  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
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
        const storage = getStorage();
        const avatarPath = `avatars/${user.uid}/${Date.now()}_${avatarFile.name}`;
        const avatarRef = ref(storage, avatarPath);
        await uploadBytes(avatarRef, avatarFile);
        finalAvatarUrl = await getDownloadURL(avatarRef);
      }

      // Only update changed fields, never overwrite arrays or subcollections.
      const dataToSave: Partial<ProfileData> = {
        ...form,
        username: form.username.trim(),
        usernameLowercase: form.username.trim().toLowerCase(),
        avatarUrl: finalAvatarUrl,
        wallet: profile?.wallet || walletAdapter.publicKey?.toBase58() || "",
        dmsOpen: !!form.dmsOpen,
        duelsOpen: !!form.duelsOpen,
      };

      // Use setDoc with merge: true to avoid overwriting fields like friends, scores, etc.
      // Important: `freeEntryTokens` is an object, so merge:true will merge its sub-fields correctly.
      await setDoc(doc(db, "users", user.uid), dataToSave, { merge: true });
      await refreshProfile();
      toast.success("Profile saved successfully!");
      setAvatarFile(null);
      setAvatarPreview(null);
    } catch (err) {
      toast.error("Failed to save: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (profileLoading) return <div className="text-center text-white mt-20">Loading Profile...</div>;
  if (!user) return <div className="text-center text-white mt-20">Please sign in to view your profile.</div>;

  const displayedAvatar = avatarPreview || form.avatarUrl || '/placeholder-avatar.png';

  // Debug: Log profile and friends array
  // console.log("profile:", profile);
  // console.log("friends:", profile?.friends);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: User Card & Dashboard */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-gray-800 rounded-lg p-6 text-center shadow-lg">
            <div className="relative inline-block mb-4">
              <img src={displayedAvatar} alt="Avatar" className="w-32 h-32 rounded-full mx-auto border-4 border-purple-500 object-cover" />
              <label className="absolute bottom-1 right-1 bg-purple-600 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer hover:bg-purple-700 transition">
                <FaEdit />
                <input type="file" accept="image/*" onChange={handleAvatar} className="hidden" />
              </label>
            </div>
            <h2 className="text-2xl font-bold font-orbitron">{form.username}</h2>
            <p className="text-sm text-gray-400 break-all">{form.wallet}</p>
          </div>

          {/* New Section: Free Entry Tokens */}
          <div className="bg-gray-800 rounded-lg p-6 shadow-lg">
            <h3 className="text-xl font-semibold mb-4 font-orbitron">Free Entry Tokens</h3>
            {profile?.freeEntryTokens ? (
              <div className="grid grid-cols-2 gap-4 text-center">
                <div className="p-3 bg-gray-900 rounded-lg">
                  <p className="text-sm text-gray-400">Arcade</p>
                  <p className="text-xl font-bold text-green-400">{profile.freeEntryTokens.arcadeTokens}</p>
                </div>
                <div className="p-3 bg-gray-900 rounded-lg">
                  <p className="text-sm text-gray-400">Picker</p>
                  <p className="text-xl font-bold text-yellow-400">{profile.freeEntryTokens.pickerTokens}</p>
                </div>
                <div className="p-3 bg-gray-900 rounded-lg">
                  <p className="text-sm text-gray-400">Casino</p>
                  <p className="text-xl font-bold text-red-400">{profile.freeEntryTokens.casinoTokens}</p>
                </div>
                <div className="p-3 bg-gray-900 rounded-lg">
                  <p className="text-sm text-gray-400">PvP</p>
                  <p className="text-xl font-bold text-blue-400">{profile.freeEntryTokens.pvpTokens}</p>
                </div>
              </div>
            ) : (
              <p className="text-gray-500">No free entry tokens available yet.</p>
            )}
          </div>
          {/* End New Section */}

          <UserDashboard profile={form} />
        </div>
        {/* Right Column: Edit Form & Recent Activity */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-gray-800 rounded-lg p-6 shadow-lg">
            <h3 className="text-xl font-semibold mb-4 font-orbitron">Edit Profile</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold mb-1 text-gray-400">Username</label>
                <input ref={usernameInputRef} type="text" name="username" value={form.username} onChange={handleChange} onBlur={(e) => checkUsernameUnique(e.target.value)} className="w-full p-2 bg-gray-900 rounded border border-gray-700 focus:ring-purple-500 focus:border-purple-500" />
                {usernameChecking && <span className="text-xs text-blue-400">Checking…</span>}
                {usernameError && <p className="text-xs text-red-500 mt-1">{usernameError}</p>}
              </div>
              <div>
                <label className="block text-sm font-bold mb-1 text-gray-400">Bio</label>
                <textarea name="bio" value={form.bio ?? ''} onChange={handleChange} className="w-full p-2 bg-gray-900 rounded border border-gray-700 h-24 focus:ring-purple-500 focus:border-purple-500" />
              </div>
              <div className="flex gap-4">
                <div>
                  <label className="block text-sm font-bold mb-1 text-gray-400">Twitter</label>
                  <input type="text" name="twitter" value={form.twitter ?? ""} onChange={handleChange} className="w-full p-2 bg-gray-900 rounded border border-gray-700" />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1 text-gray-400">Discord</label>
                  <input type="text" name="discord" value={form.discord ?? ""} onChange={handleChange} className="w-full p-2 bg-gray-900 rounded border border-gray-700" />
                </div>
              </div>
              <div className="flex gap-4">
                <div>
                  <label className="block text-sm font-bold mb-1 text-gray-400">Telegram</label>
                  <input type="text" name="telegram" value={form.telegram ?? ""} onChange={handleChange} className="w-full p-2 bg-gray-900 rounded border border-gray-700" />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1 text-gray-400">Instagram</label>
                  <input type="text" name="instagram" value={form.instagram ?? ""} onChange={handleChange} className="w-full p-2 bg-gray-900 rounded border border-gray-700" />
                </div>
              </div>
              <div className="flex gap-6 mt-4">
                <label className="flex gap-2 items-center text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    name="dmsOpen"
                    checked={!!form.dmsOpen}
                    onChange={handleChange}
                  />Open to DMs
                </label>
                <label className="flex gap-2 items-center text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    name="duelsOpen"
                    checked={!!form.duelsOpen}
                    onChange={handleChange}
                  />Open for Duels
                </label>
              </div>
              <div className="text-right">
                <button onClick={handleSave} disabled={saving} className="bg-purple-600 hover:bg-purple-700 font-bold py-2 px-6 rounded-lg transition disabled:bg-gray-500">
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