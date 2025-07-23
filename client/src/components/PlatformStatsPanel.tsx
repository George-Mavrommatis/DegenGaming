import React, { useEffect } from 'react';
import { FaUsers, FaGamepad, FaDollarSign, FaChartLine, FaHourglassHalf, FaFire, FaDice, FaCrosshairs, FaEye, FaTrophy } from 'react-icons/fa';
import { GiPistolGun, GiSlotMachine, GiGiraffe } from "react-icons/gi";
import { usePlatformStats } from '../firebase/usePlatformStats';
import { PlatformStats, CategoryStats, GameStats } from '../types/platformStats';

const CATEGORY_ICONS: Record<string, JSX.Element> = {
  arcade: <FaGamepad className="inline mr-1 text-pink-400" />,
  pvp: <FaCrosshairs className="inline mr-1 text-orange-400" />,
  casino: <FaDice className="inline mr-1 text-yellow-300" />,
  picker: <FaEye className="inline mr-1 text-purple-400" />,
};

const CATEGORY_COLORS: Record<string, string> = {
  arcade: "bg-pink-900/80 border-pink-400",
  pvp: "bg-orange-900/80 border-orange-400",
  casino: "bg-yellow-900/80 border-yellow-400",
  picker: "bg-purple-900/80 border-purple-400",
};

function formatSOL(n: number | undefined) {
  if (typeof n !== 'number') return "N/A SOL";
  if (n === 0) return "0.000 SOL";
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 6 })} SOL`;
}

function formatNum(n: number | undefined) {
  if (typeof n !== 'number') return "N/A";
  return n.toLocaleString();
}

export default function PlatformStatsPanel() {
  const { stats, loading } = usePlatformStats();

  useEffect(() => {
    if (!loading) {
      console.log("PlatformStatsPanel (via Firestore): Stats loaded:", stats);
      if (!stats) {
        console.warn("PlatformStatsPanel (via Firestore): Firestore document 'platform/stats' does not exist or is empty.");
      }
    }
  }, [stats, loading]);

  if (loading) {
    return (
      <div className="w-full flex items-center justify-center p-12">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mb-4"></div>
          <div className="text-2xl text-purple-300">Loading platform statistics...</div>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="w-full flex items-center justify-center p-12 text-center text-slate-400">
        <div className="text-xl font-bold mb-2">No platform statistics available yet.</div>
        <div className="text-sm">Please ensure the 'platform/stats' document exists and is populated in your Firestore.</div>
      </div>
    );
  }

  const categories = ["arcade", "pvp", "casino", "picker"] as const;

  return (
    <div className="w-full max-w-6xl mx-auto p-4 md:p-8 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-black border-2 border-purple-700/40 shadow-2xl text-white">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-purple-300">Platform Statistics</h2>
        <div className="text-xs text-slate-400">
          Last updated: {stats.lastUpdated ? new Date(stats.lastUpdated).toLocaleString() : "--"}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatIconBox
          icon={<FaUsers className="text-3xl text-blue-300" />}
          label="Registered Users"
          value={formatNum(stats.registeredUsers)}
        />
        <StatIconBox
          icon={<FaUsers className="text-3xl text-green-300" />}
          label="Online (5min)"
          value={formatNum(stats.onlineUsers)}
        />
        <StatIconBox
          icon={<FaTrophy className="text-3xl text-yellow-300" />}
          label="Games Played"
          value={formatNum(stats.totalGamesPlayed)}
        />
      </div>

      <SectionHeader label="Last Month" period={stats.lastMonthPeriod} />
      <CategoryStatsPanel
        stats={stats}
        categories={categories}
        games={stats.games}
        type="month"
      />

      <SectionHeader label="All Time" />
      <CategoryStatsPanel
        stats={stats}
        categories={categories}
        games={stats.games}
        type="all"
      />
    </div>
  );
}

function SectionHeader({ label, period }: { label: string, period?: string }) {
  return (
    <div className="mt-10 mb-4 flex items-center gap-2">
      <span className="text-xl font-bold text-purple-300">{label}</span>
      {period && <span className="text-sm text-slate-400">({period})</span>}
      <div className="flex-1 border-t border-purple-700/50 ml-3" />
    </div>
  );
}

function CategoryStatsPanel({
  stats,
  categories,
  games,
  type,
}: {
  stats: PlatformStats,
  categories: readonly string[],
  games: PlatformStats["games"],
  type: "month" | "all"
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
      {categories.map(cat => {
        const catStats = stats.categories ? stats.categories[cat] : undefined;
        if (!catStats) {
          return (
            <div
              key={cat}
              className="rounded-xl border-2 bg-slate-800/50 border-slate-600 p-4 shadow-lg"
            >
              <div className="flex items-center mb-2">
                {CATEGORY_ICONS[cat]}
                <span className="text-lg font-bold capitalize">{cat}</span>
              </div>
              <div className="text-sm text-slate-400 italic">No data available</div>
            </div>
          );
        }
        const color = CATEGORY_COLORS[cat] || "bg-slate-800 border-slate-600";
        const showDistributed = cat !== "picker"; // Picker has no distribution

        // Defensive fallback for category stats
        const solTotal = type === "month" ? catStats.solLastMonth : catStats.solTotal;
        const solDistributed = type === "month" ? (catStats.solDistributedLastMonth || 0) : (catStats.solDistributed || 0);
        const plays = type === "month" ? catStats.playsLastMonth : catStats.playsTotal;

        return (
          <div
            key={cat}
            className={`rounded-xl border-2 ${color} p-4 shadow-lg transition-all duration-300 hover:shadow-xl hover:scale-105`}
          >
            <div className="flex items-center mb-3">
              {CATEGORY_ICONS[cat]}
              <span className="text-lg font-bold capitalize">{cat}</span>
            </div>
            <div className="flex flex-col gap-2 mb-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-300">Gathered:</span>
                <span className="font-bold text-yellow-300 text-sm">
                  {formatSOL(solTotal)}
                </span>
              </div>
              {showDistributed && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-300">Distributed:</span>
                  <span className="font-bold text-green-400 text-sm">
                    {formatSOL(solDistributed)}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-300">Plays:</span>
                <span className="font-semibold text-blue-200 text-sm">
                  {formatNum(plays)}
                </span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-700/50">
              <div className="text-xs text-slate-400 mb-2 font-semibold">Games:</div>
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                {catStats.games && catStats.games.length === 0 ? (
                  <div className="text-xs text-slate-500 italic">No games played</div>
                ) : (
                  catStats.games?.map(gameId => {
                    const g = games[gameId];
                    if (!g) return null;
                    const gSolTotal = type === "month" ? g.solLastMonth : g.solTotal;
                    const gSolDistributed = type === "month" ? (g.solDistributedLastMonth || 0) : (g.solDistributed || 0);
                    const gPlays = type === "month" ? g.playsLastMonth : g.playsTotal;
                    return (
                      <div key={gameId} className="p-2 rounded bg-black/30 border border-slate-700/30">
                        <div className="font-semibold text-white text-xs mb-1">{g.name}</div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-yellow-300">{formatSOL(gSolTotal)}</span>
                          {showDistributed && (
                            <span className="text-green-400">{formatSOL(gSolDistributed)}</span>
                          )}
                        </div>
                        <div className="text-right text-blue-200 text-xs mt-1">
                          {formatNum(gPlays)} plays
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatIconBox({ icon, label, value }: { icon: JSX.Element, label: string, value: string | number }) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-lg bg-slate-800/60 border border-slate-700/50 shadow-lg hover:shadow-xl transition-all duration-300 hover:bg-slate-800">
      <div className="flex-shrink-0">{icon}</div>
      <div>
        <div className="font-bold text-lg text-white">{value}</div>
        <div className="text-sm text-slate-400">{label}</div>
      </div>
    </div>
  );
}