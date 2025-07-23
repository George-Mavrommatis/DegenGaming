import React, { useEffect, useState, useRef, useCallback } from "react";
import { ProfileData, RecentGame, DEFAULT_PROFILE } from "../types/profile";
import { toast } from "react-toastify";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useWallet } from "@solana/wallet-adapter-react";
import { useProfile } from "../context/ProfileContext";
import { Link } from 'react-router-dom';
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { FaEdit, FaHistory, FaGamepad, FaCoins } from 'react-icons/fa';
import UserDashboard from "../components/UserDashboard";

export default function Profile() {
  const {
    user,
    profile,
    updateUserProfile,
    loading,
    isAuthenticated
  } = useProfile();

  const walletAdapter = useWallet();

  const [form, setForm] = useState<ProfileData>(DEFAULT_PROFILE);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [usernameError, setUsernameError] = useState("");
  const [usernameChecking, setUsernameChecking] = useState(false);
  const usernameInputRef = useRef<HTMLInputElement>(null);

  // Keep keys in sync with backend: arcade, picker, casino, pvp
  const tokenKeys = ["arcade", "picker", "casino", "pvp"] as const;

  useEffect(() => {
    if (!loading) {
      if (isAuthenticated && user && profile) {
        setForm(prevForm => {
          const newFormState: ProfileData = {
            ...DEFAULT_PROFILE,
            ...profile,
            uid: user.uid,
            stats: { ...DEFAULT_PROFILE.stats, ...(profile.stats || {}) },
            coins: { ...DEFAULT_PROFILE.coins, ...(profile.coins || {}) },
            freeEntryTokens: { ...DEFAULT_PROFILE.freeEntryTokens, ...(profile.freeEntryTokens || {}) },
            recentGames: profile.recentGames || [],
            friends: profile.friends || [],
            friendRequests: profile.friendRequests || [],
            sentInvitations: profile.sentInvitations || [],
            duelInvitations: profile.duelInvitations || [],
            pvpRoomInvites: profile.pvpRoomInvites || [],
            wallet: profile.wallet || walletAdapter.publicKey?.toBase58() || "",
          };
          if (JSON.stringify(prevForm) !== JSON.stringify(newFormState)) {
            return newFormState;
          }
          return prevForm;
        });
        setAvatarPreview(null);
        setAvatarFile(null);
      } else {
        setForm({ ...DEFAULT_PROFILE });
        setAvatarPreview(null);
        setAvatarFile(null);
      }
    }
  }, [user, profile, loading, isAuthenticated, walletAdapter.publicKey]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type, checked } = e.target;
    setForm(f => ({
      ...f,
      [name]: type === "checkbox" ? checked : value ?? ""
    }));
  }, []);

  const handleAvatar = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const file = e.target.files[0];
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Avatar image too large (max 5MB).");
        e.target.value = '';
        setAvatarFile(null);
        setAvatarPreview(null);
        return;
      }
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  }, []);

  const checkUsernameUnique = useCallback(async (username: string) => {
    const trimmedUsername = username.trim().toLowerCase();
    if (!trimmedUsername || (profile && trimmedUsername === (profile.usernameLowercase || "").toLowerCase())) {
      setUsernameError("");
      return true;
    }
    setUsernameChecking(true);
    try {
      const q = query(collection(db, "users"), where("usernameLowercase", "==", trimmedUsername));
      const querySnapshot = await getDocs(q);
      const isTaken = !querySnapshot.empty && querySnapshot.docs[0].id !== user?.uid;
      setUsernameError(isTaken ? "Username is already taken!" : "");
      return !isTaken;
    } catch (error) {
      setUsernameError("Error checking username. Please try again.");
      return false;
    } finally {
      setUsernameChecking(false);
    }
  }, [profile, user]);

  const handleUsernameBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    if (e.target.value.trim().toLowerCase() !== (profile?.usernameLowercase || '').toLowerCase()) {
      checkUsernameUnique(e.target.value);
    } else {
      setUsernameError("");
    }
  }, [profile, checkUsernameUnique]);

  const handleSave = useCallback(async () => {
    if (!user) {
      toast.error("You must be logged in to save your profile.");
      return;
    }
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
        const storageInstance = getStorage();
        const avatarPath = `avatars/${user.uid}/${Date.now()}_${avatarFile.name}`;
        const avatarRef = ref(storageInstance, avatarPath);
        await uploadBytes(avatarRef, avatarFile);
        finalAvatarUrl = await getDownloadURL(avatarRef);
      }
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
      };
      await updateUserProfile(dataToSave);
      toast.success("Profile saved successfully!");
      setAvatarFile(null);
      setAvatarPreview(null);
    } catch (err) {
      toast.error("Failed to save profile: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }, [user, avatarFile, form, checkUsernameUnique, updateUserProfile]);

  if (loading) {
    return <div className="text-center text-white mt-20 text-xl font-bold animate-pulse">Loading Profile...</div>;
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="text-center text-white mt-20">
        <p className="text-xl font-bold mb-4">Please sign in to view your profile.</p>
      </div>
    );
  }

  const displayedAvatar = avatarPreview || form.avatarUrl || '/WegenRaceAssets/G1small.png';

  // Ensure correct keys and fallback
  const tokensObj = form.freeEntryTokens || {};
  const tokens = {
    arcade: tokensObj.arcade ?? tokensObj.arcadeTokens ?? 0,
    picker: tokensObj.picker ?? tokensObj.pickerTokens ?? 0,
    casino: tokensObj.casino ?? tokensObj.casinoTokens ?? 0,
    pvp: tokensObj.pvp ?? tokensObj.pvpTokens ?? 0,
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-gray-800 rounded-lg p-6 text-center shadow-lg">
            <div className="relative inline-block mb-4">
              <img
                src={displayedAvatar}
                alt={`${form.username}'s avatar`}
                className="w-32 h-32 rounded-full mx-auto border-4 border-purple-500 object-cover"
                onError={(e) => { e.currentTarget.src = '/WegenRaceAssets/G1small.png'; }}
              />
              <label className="absolute bottom-1 right-1 bg-purple-600 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer hover:bg-purple-700 transition">
                <FaEdit />
                <input type="file" accept="image/*" onChange={handleAvatar} className="hidden" />
              </label>
            </div>
            <h2 className="text-2xl font-bold font-orbitron">{form.username || "Guest Player"}</h2>
            <p className="text-sm text-gray-400 break-all">{form.wallet || walletAdapter.publicKey?.toBase58() || "No Wallet Connected"}</p>
          </div>

          <div className="bg-gray-800 rounded-lg p-6 shadow-lg">
            <h3 className="text-xl font-semibold mb-4 font-orbitron">Free Entry Tokens</h3>
            <div className="grid grid-cols-2 gap-4 text-center">
              {tokenKeys.map(key => (
                <div key={key} className="p-3 bg-gray-900 rounded-lg">
                  <p className="text-sm text-gray-400">{key.charAt(0).toUpperCase() + key.slice(1)}</p>
                  <p className={`text-xl font-bold ${
                    key === 'arcade' ? 'text-green-400' :
                    key === 'picker' ? 'text-yellow-400' :
                    key === 'casino' ? 'text-red-400' :
                    key === 'pvp' ? 'text-blue-400' : ''
                  }`}>{tokens[key]}</p>
                </div>
              ))}
            </div>
          </div>
          <UserDashboard profile={form} />
        </div>

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
                  onBlur={handleUsernameBlur}
                  className="w-full p-2 bg-gray-900 rounded border border-gray-700 focus:ring-purple-500 focus:border-purple-500"
                />
                {usernameChecking && <span className="text-xs text-blue-400">Checking…</span>}
                {usernameError && <p className="text-xs text-red-500 mt-1">{usernameError}</p>}
              </div>
              <div>
                <label className="block text-sm font-bold mb-1 text-gray-400">Bio</label>
                <textarea
                  name="bio"
                  value={form.bio ?? ''}
                  onChange={handleChange}
                  className="w-full p-2 bg-gray-900 rounded border border-gray-700 h-24 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-bold mb-1 text-gray-400">Twitter</label>
                  <input type="text" name="twitter" value={form.twitter ?? ""} onChange={handleChange} className="w-full p-2 bg-gray-900 rounded border border-gray-700" />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-bold mb-1 text-gray-400">Discord</label>
                  <input type="text" name="discord" value={form.discord ?? ""} onChange={handleChange} className="w-full p-2 bg-gray-900 rounded border border-gray-700" />
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-bold mb-1 text-gray-400">Telegram</label>
                  <input type="text" name="telegram" value={form.telegram ?? ""} onChange={handleChange} className="w-full p-2 bg-gray-900 rounded border border-gray-700" />
                </div>
                <div className="flex-1">
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
                    className="form-checkbox h-4 w-4 text-purple-600 rounded"
                  />Open to DMs
                </label>
                <label className="flex gap-2 items-center text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    name="duelsOpen"
                    checked={!!form.duelsOpen}
                    onChange={handleChange}
                    className="form-checkbox h-4 w-4 text-purple-600 rounded"
                  />Open for Duels
                </label>
              </div>
              <div className="text-right">
                <button
                  onClick={handleSave}
                  disabled={saving || usernameChecking || !!usernameError}
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
              {form.recentGames && form.recentGames.length > 0 ? form.recentGames.slice(0, 5).map((game: RecentGame, idx) => (
                <div key={idx} className="bg-gray-900/50 p-3 rounded-lg flex items-center justify-between text-sm flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <FaGamepad className="text-purple-400" />
                    <span className="font-semibold">{game.gameName}</span>
                  </div>
                  <div className="flex items-center gap-4 font-mono">
                    <span>Score: {game.score?.toLocaleString()}</span>
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