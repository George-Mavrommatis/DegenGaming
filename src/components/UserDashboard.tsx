import React from "react";
import type { ProfileData } from "../types/profile";
import { getLevelProgress } from "../utilities/leveling";
import { FaCoins } from "react-icons/fa";

interface UserDashboardProps {
  profile: ProfileData;
}

export default function UserDashboard({ profile }: UserDashboardProps) {
  const xp = getLevelProgress(profile.accountXP || 0);

  return (
    <div className="bg-gray-800 rounded-lg p-6 shadow-lg">
      {/* Overview row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center mb-6 border-b border-gray-700 pb-4">
        {/* Level, XP */}
        <div>
          <div className="text-3xl font-bold text-purple-400">{xp.level}</div>
          <div className="text-xs text-gray-400 mb-2">Level</div>
          <div className="flex justify-center text-xs text-gray-400 mb-1">
            {xp.currentXP} / {xp.xpNeeded} XP
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 mb-1">
            <div
              style={{ width: `${xp.percent}%` }}
              className="bg-yellow-400 h-2 rounded-full transition-all duration-200"
            />
          </div>
          <div className="text-[11px] text-gray-500">{xp.xpToNext} XP to next level</div>
        </div>
        {/* Total games played */}
        <div>
          <div className="text-3xl font-bold text-purple-400">{profile.stats?.totalGamesPlayed ?? 0}</div>
          <div className="text-xs text-gray-400">Total Games</div>
        </div>
        {/* XP/Rank */}
        <div>
          <div className="text-3xl font-bold text-purple-400">{profile.accountXP ?? 0}</div>
          <div className="text-xs text-gray-400">Account XP</div>
        </div>
        {/* Badges or NFTs */}
        <div>
          <div className="text-2xl font-bold text-purple-400">{profile.badges?.length || 0}</div>
          <div className="text-xs text-gray-400">Badges</div>
        </div>
      </div>
      {/* Game mode breakdown (Arcade / Picker / Casino / PvP) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
        {/* Arcade */}
        <div>
          <div className="text-sm text-gray-400 mb-0.5">Arcade</div>
          <div className="text-lg font-bold text-purple-300">{profile.stats?.arcadeGamesPlayed ?? 0}</div>
          <div className="flex items-center justify-center gap-1 text-yellow-400">
            <FaCoins />
            <span className="font-semibold">{profile.coins?.arcade ?? 0}</span>
          </div>
        </div>
        {/* Picker */}
        <div>
          <div className="text-sm text-gray-400 mb-0.5">Picker</div>
          <div className="text-lg font-bold text-purple-300">{profile.stats?.pickerGamesPlayed ?? 0}</div>
          <div className="flex items-center justify-center gap-1 text-yellow-400">
            <FaCoins />
            <span className="font-semibold">{profile.coins?.picker ?? 0}</span>
          </div>
        </div>
        {/* Casino */}
        <div>
          <div className="text-sm text-gray-400 mb-0.5">Casino</div>
          <div className="text-lg font-bold text-purple-300">{profile.stats?.casinoGamesPlayed ?? 0}</div>
          <div className="flex items-center justify-center gap-1 text-yellow-400">
            <FaCoins />
            <span className="font-semibold">{profile.coins?.casino ?? 0}</span>
          </div>
        </div>
        {/* PvP */}
        <div>
          <div className="text-sm text-gray-400 mb-0.5">PvP</div>
          <div className="text-lg font-bold text-purple-300">{profile.stats?.pvpGamesPlayed ?? 0}</div>
          <div className="flex items-center justify-center gap-1 text-yellow-400">
            <FaCoins />
            <span className="font-semibold">{profile.coins?.pvp ?? 0}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
