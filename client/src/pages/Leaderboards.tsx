import React, { useEffect, useState } from 'react';
// Game leaderboard: existing logic
import { fetchLeaderboard, LeaderboardEntry } from '../firebase/gameScores';
// Account XP leaderboard:
import { fetchAccountRankingLeaderboard, AccountRankEntry } from '../firebase/gameScores';

const shortAddress = (addr: string) => {
  if (!addr || addr.length < 8) return addr || 'Anonymous';
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
};

const DEFAULT_AVATAR = "/placeholder-avatar.png";

type TabName = 'scores' | 'accountXP';

export default function LeaderboardsPage() {
  const [tab, setTab] = useState<TabName>('scores');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [timeframe, setTimeframe] = useState<'allTime' | 'monthly'>('monthly');
  const [xpLeaderboard, setXPLeaderboard] = useState<AccountRankEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Game scores leaderboard
  useEffect(() => {
    if (tab === 'scores') {
      setLoading(true);
      fetchLeaderboard(timeframe).then(entries => {
        setLeaderboard(entries);
        setLoading(false);
      });
    }
  }, [tab, timeframe]);

  // Account XP leaderboard
  useEffect(() => {
    if (tab === 'accountXP') {
      setLoading(true);
      fetchAccountRankingLeaderboard().then(entries => {
        setXPLeaderboard(entries);
        setLoading(false);
      });
    }
  }, [tab]);

  return (
    <main className="min-h-screen w-full px-2 py-8 sm:px-6 bg-gradient-to-br from-[#181824] via-[#22013a] to-[#151428] flex flex-col text-white">
      <div className="w-full max-w-3xl mx-auto">
        <header className="mb-8">
          <h1 className="text-4xl md:text-5xl font-black font-orbitron mb-2 bg-gradient-to-r from-yellow-400 via-orange-400 to-pink-400 bg-clip-text text-transparent uppercase tracking-widest">
            Leaderboards
          </h1>
          <p className="text-xl text-gray-400 font-medium">Compete for the top spot!</p>
        </header>

        {/* Tabs */}
        <nav className="flex flex-wrap gap-2 mb-7">
          <button
            onClick={() => setTab('scores')}
            className={`px-5 py-2 rounded-t-lg font-bold transition-colors ${
              tab === 'scores'
                ? 'bg-gradient-to-tr from-orange-600 to-yellow-400 text-white shadow-lg'
                : 'bg-gray-800/80 text-orange-200 hover:bg-orange-700/40'
            }`}
          >
            🎮 Game High Scores
          </button>
          <button
            onClick={() => setTab('accountXP')}
            className={`px-5 py-2 rounded-t-lg font-bold transition-colors ${
              tab === 'accountXP'
                ? 'bg-gradient-to-tr from-yellow-500 to-pink-500 text-white shadow-lg'
                : 'bg-gray-800/80 text-orange-200 hover:bg-orange-700/40'
            }`}
          >
            🏆 Account Ranking (XP)
          </button>
        </nav>

        {/* Leaderboard controls */}
        {tab === 'scores' && (
          <div className="flex flex-col sm:flex-row justify-between items-center mb-7 gap-3">
            <div className="w-full sm:w-auto bg-[#232946] p-3 rounded-lg text-lg font-bold text-orange-200 text-center shadow">
              Wack-a-Wegen
            </div>
            <div className="flex bg-[#232946] rounded-lg p-1">
              <button
                onClick={() => setTimeframe('monthly')}
                className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${
                  timeframe === 'monthly'
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setTimeframe('allTime')}
                className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${
                  timeframe === 'allTime'
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                All-Time
              </button>
            </div>
          </div>
        )}

        {/* Main leaderboard */}
        <section className="bg-[#181820] border border-gray-900 rounded-lg shadow-2xl overflow-x-auto w-full">
          {/* Header Row */}
          <div className="grid grid-cols-10 sm:grid-cols-10 items-center px-3 sm:px-7 py-3 bg-gradient-to-r from-purple-950 via-[#232946] to-purple-950 border-b border-gray-700 text-gray-400 uppercase text-[13px] font-extrabold tracking-wider">
            <div className="col-span-2 sm:col-span-2">Rank</div>
            <div className="col-span-4 sm:col-span-4">Player</div>
            {tab === 'scores' ? (
              <div className="col-span-4 sm:col-span-4 text-right">Score</div>
            ) : (
              <>
                <div className="col-span-2 sm:col-span-2 text-center">Level</div>
                <div className="col-span-2 sm:col-span-2 text-right">XP</div>
              </>
            )}
          </div>

          {/* Body */}
          {loading ? (
            <div className="py-8 text-center text-lg text-gray-300 animate-pulse">Loading Leaderboard...</div>
          ) : tab === 'scores' ? (
            leaderboard.length === 0 ? (
              <div className="py-8 text-center text-lg text-gray-400">No scores recorded for this period yet.</div>
            ) : (
              leaderboard.map(({ rank, score, player }, index) => (
                <div
                  key={player.wallet}
                  className={`grid grid-cols-10 sm:grid-cols-10 items-center px-3 sm:px-7 py-4 border-b border-gray-800 last:border-b-0
                    ${
                      rank === 1
                        ? 'bg-gradient-to-r from-yellow-400/15 via-yellow-100/0 to-transparent'
                        : rank === 2
                        ? 'bg-gradient-to-r from-gray-400/10 via-gray-100/0 to-transparent'
                        : rank === 3
                        ? 'bg-gradient-to-r from-orange-600/15 via-orange-100/0 to-transparent'
                        : index % 2
                        ? 'bg-black/10'
                        : ''
                    }`}
                >
                  {/* Rank */}
                  <div className={`col-span-2 font-bold text-lg flex items-center ${
                    rank === 1
                      ? 'text-yellow-400'
                      : rank === 2
                      ? 'text-gray-300'
                      : rank === 3
                      ? 'text-yellow-700'
                      : 'text-gray-400'
                  }`}>
                    {rank <= 3 && (
                      <span className="mr-2 text-2xl ">
                        {rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}
                      </span>
                    )}
                    {rank}
                  </div>

                  {/* Player */}
                  <div className="col-span-4 flex items-center gap-3 min-w-0">
                    <img
                      src={player.avatarUrl || DEFAULT_AVATAR}
                      alt="avatar"
                      className={`w-9 h-9 rounded-full object-cover shadow ${
                        rank === 1 ? 'border-2 border-yellow-400' : rank === 2 ? 'border-2 border-gray-300' : rank === 3 ? 'border-2 border-orange-400' : 'border border-gray-700'
                      }`}
                    />
                    <span className="font-bold text-white truncate">
                      {player.username || shortAddress(player.wallet)}
                    </span>
                  </div>

                  {/* Score */}
                  <div className="col-span-4 text-right font-bold text-xl text-white">
                    {score}
                  </div>
                </div>
              ))
            )
          ) : (
            xpLeaderboard.length === 0 ? (
              <div className="py-8 text-center text-lg text-gray-400">No users have earned XP yet.</div>
            ) : (
              xpLeaderboard.map(({ rank, player, level, accountXP }, index) => (
                <div
                  key={player.wallet}
                  className={`grid grid-cols-10 sm:grid-cols-10 items-center px-3 sm:px-7 py-4 border-b border-gray-800 last:border-b-0
                    ${
                      rank === 1
                        ? 'bg-gradient-to-r from-yellow-400/15 via-yellow-100/0 to-transparent'
                        : rank === 2
                        ? 'bg-gradient-to-r from-gray-400/10 via-gray-100/0 to-transparent'
                        : rank === 3
                        ? 'bg-gradient-to-r from-orange-600/15 via-orange-100/0 to-transparent'
                        : index % 2
                        ? 'bg-black/10'
                        : ''
                    }`}
                >
                  {/* Rank */}
                  <div className={`col-span-2 font-bold text-lg flex items-center ${
                    rank === 1
                      ? 'text-yellow-400'
                      : rank === 2
                      ? 'text-gray-300'
                      : rank === 3
                      ? 'text-yellow-700'
                      : 'text-gray-400'
                  }`}>
                    {rank <= 3 && (
                      <span className="mr-2 text-2xl">
                        {rank === 1 ? '🏆' : rank === 2 ? '🥈' : '🥉'}
                      </span>
                    )}
                    {rank}
                  </div>
                  {/* Player */}
                  <div className="col-span-4 flex items-center gap-3 min-w-0">
                    <img
                      src={player.avatarUrl || DEFAULT_AVATAR}
                      alt="avatar"
                      className={`w-9 h-9 rounded-full object-cover shadow ${
                        rank === 1 ? 'border-2 border-yellow-400' : rank === 2 ? 'border-2 border-gray-300' : rank === 3 ? 'border-2 border-orange-400' : 'border border-gray-700'
                      }`}
                    />
                    <span className="font-bold text-white truncate">
                      {player.username || shortAddress(player.wallet)}
                    </span>
                  </div>
                  {/* Level */}
                  <div className="col-span-2 text-center text-lg">{level}</div>
                  {/* XP */}
                  <div className="col-span-2 text-right font-bold text-lg text-pink-200">{accountXP}</div>
                </div>
              ))
            )
          )}
        </section>
      </div>
    </main>
  );
}
