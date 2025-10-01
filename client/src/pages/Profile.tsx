import React, { useEffect, useState, useRef, useCallback } from "react";
import { ProfileData, RecentGame, DEFAULT_PROFILE } from "../types/profile";
import { toast } from "react-toastify";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useWallet } from "@solana/wallet-adapter-react";
import { useProfile } from "../context/ProfileContext";
import { Link } from 'react-router-dom';
import { FaEdit, FaHistory, FaGamepad, FaCoins, FaWallet } from 'react-icons/fa';
import UserDashboard from "../components/UserDashboard";
import Cashier from "../components/Cashier";

const DEFAULT_AVATAR = "/placeholder-avatar.png";
const GG_COIN_ICON = "/assets/ggcoin.png"; // Ensure this asset exists

export default function Profile() {
  const { user, profile, updateUserProfile, refreshProfile, loading, isAuthenticated } = useProfile();
  const walletAdapter = useWallet();

  const [form, setForm] = useState<ProfileData>(DEFAULT_PROFILE);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [usernameError, setUsernameError] = useState("");
  const [usernameChecking, setUsernameChecking] = useState(false);
  const usernameInputRef = useRef<HTMLInputElement>(null);

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
      setUsernameError("");
      return true;
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
        dmsOpen: !!form.dmsOpen,
        duelsOpen: !!form.duelsOpen,
      };
      await updateUserProfile(dataToSave);
      await refreshProfile();
      toast.success("Profile saved successfully!");
      setAvatarFile(null);
      setAvatarPreview(null);
    } catch (err) {
      toast.error("Failed to save profile: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }, [user, avatarFile, form, checkUsernameUnique, updateUserProfile, refreshProfile]);

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

  const displayedAvatar = avatarPreview || form.avatarUrl || DEFAULT_AVATAR;
  const ggCoins = form.coins?.gg ?? 0;
  const xp = form.accountXP ?? 0;
  const xpLevel = Math.floor(xp / 1000) + 1;
  const xpPercent = Math.min(((xp % 1000) / 1000) * 100, 100);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-[#221c2d] to-black flex flex-col items-center py-12 px-8 lg:px-16">
      <div className="w-full max-w-screen-2xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-12">
        {/* Profile Column */}
        <div className="md:col-span-1 flex flex-col items-center gap-8">
          <div className="w-full bg-[#232946] rounded-xl p-8 shadow-xl border border-purple-600 flex flex-col items-center">
            <div className="relative mb-4">
              <img src={displayedAvatar} alt="Avatar" className="w-36 h-36 rounded-full border-4 border-purple-400 shadow-lg object-cover" />
              <label className="absolute bottom-2 right-2 bg-purple-600 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer hover:bg-purple-700 transition">
                <FaEdit />
                <input type="file" accept="image/*" onChange={handleAvatar} className="hidden" />
              </label>
            </div>
            <h2 className="text-2xl font-bold mb-1 text-yellow-300 font-orbitron">{form.username || "Guest Player"}</h2>
            <p className="font-mono text-gray-400">{form.wallet || "No Wallet Connected"}</p>
            <div className="mt-6 w-full flex flex-col gap-2">
              {/* GG Coins Card - yellow border */}
              <div className="rounded-lg bg-black/60 shadow p-4 flex items-center justify-between border-2 border-yellow-400">
                <span className="text-lg font-bold text-yellow-400 flex items-center gap-2">
                  <img src={GG_COIN_ICON} alt="GG Coin" className="w-7 h-7 inline-block" />
                  GG Coins
                </span>
                <span className="text-2xl font-bold text-yellow-200">{ggCoins.toLocaleString()}</span>
              </div>
              {/* XP Card */}
              <div className="rounded-lg bg-black/60 shadow p-4 border border-purple-400 mt-4">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold text-purple-300">XP</span>
                  <span className="text-lg text-purple-200">Level {xpLevel}</span>
                </div>
                <div className="relative mt-2 h-5 bg-gray-800 rounded-full overflow-hidden">
                  <div style={{ width: `${xpPercent}%` }} className="absolute left-0 top-0 h-full bg-gradient-to-r from-purple-500 to-yellow-400 rounded-full transition-all" />
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-gray-300">{xp} XP</span>
                </div>
              </div>
            </div>
          <Cashier ggCoins={ggCoins} /> 
            <UserDashboard profile={form} />
          </div>
        </div>
        {/* Edit Profile + Recent Games Column */}
        <div className="md:col-span-2 flex flex-col gap-8">
          <div className="w-full rounded-xl bg-[#232946] p-8 shadow-xl border border-purple-600 mb-8">
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
          {/* Recent Games Grid */}
          <div className="w-full rounded-xl bg-[#181b24] p-8 shadow-xl border border-gray-700">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold font-orbitron text-yellow-300">Recent Activity</h3>
              <Link to="/profile/history" className="flex items-center gap-2 text-sm text-purple-400 hover:underline">
                <FaHistory /> View Full History
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {form.recentGames && form.recentGames.length > 0 ? form.recentGames.slice(0, 6).map((game, idx) => (
                <div key={idx} className="bg-black/80 p-4 rounded-xl flex flex-col items-start border border-gray-700 shadow">
                  <div className="flex items-center gap-3 mb-1">
                    <FaGamepad className="text-purple-400" />
                    <span className="font-semibold text-white">{game.gameName}</span>
                  </div>
                  <span className="text-yellow-400 text-lg font-mono">Score: {game.score}</span>
                  <span className="flex items-center gap-1 text-yellow-200 mt-1"><FaCoins /> +{game.coinsEarned}</span>
                </div>
              )) : <p className="text-gray-500">No recent games. Go play!</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}