import React, { useEffect, useState } from 'react';
import { fetchLeaderboard, LeaderboardEntry } from '../firebase/gameScores';
import { fetchAccountRankingLeaderboard, AccountRankEntry } from '../firebase/gameScores';
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

const shortAddress = (addr: string) => {
  if (!addr || addr.length < 8) return addr || 'Anonymous';
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
};

const DEFAULT_AVATAR = "/placeholder-avatar.png";

type TabName = 'scores' | 'accountXP';

export default function LeaderboardsPage() {
  const [tab, setTab] = useState<TabName>('scores');
  const [gamesList, setGamesList] = useState<{ id: string, name: string }[]>([]);
  const [selectedGame, setSelectedGame] = useState<string>('');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [timeframe, setTimeframe] = useState<'allTime' | 'monthly'>('monthly');
  const [xpLeaderboard, setXPLeaderboard] = useState<AccountRankEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Load arcade games from DB
  useEffect(() => {
    async function loadArcadeGames() {
      const gamesRef = collection(db, 'games');
      const q = query(gamesRef, where('category', '==', 'arcade'));
      const snap = await getDocs(q);
      const list = snap.docs.map(doc => ({
        id: doc.id,
        name: doc.data().title || doc.data().name || doc.id
      }));
      setGamesList(list);
      if (list.length > 0 && !selectedGame) setSelectedGame(list[0].id);
    }
    loadArcadeGames();
  }, []);

  // Fetch leaderboard
  useEffect(() => {
    if (tab === 'scores' && selectedGame) {
      setLoading(true);
      fetchLeaderboard(timeframe, selectedGame).then(entries => {
        setLeaderboard(entries);
        setLoading(false);
      });
    }
  }, [tab, timeframe, selectedGame]);

  // Fetch XP leaderboard
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
    <main className="min-h-screen w-full px-6 md:px-12 lg:px-20 py-12 bg-gradient-to-br from-[#181824] via-[#22013a] to-[#151428] flex flex-col text-white">
      <div className="w-full max-w-screen-2xl mx-auto">
        <header className="mb-10">
          <h1 className="text-5xl font-black font-orbitron mb-3 bg-gradient-to-r from-yellow-400 via-orange-400 to-pink-400 bg-clip-text text-transparent uppercase tracking-widest">
            Leaderboards
          </h1>
          <p className="text-xl text-gray-400 font-medium">Compete for the top spot!</p>
        </header>
        {/* Tabs */}
        <nav className="flex gap-6 mb-10">
          <button
            onClick={() => setTab('scores')}
            className={`px-10 py-5 font-extrabold text-2xl border-4 rounded-2xl transition-all relative overflow-visible ${
              tab === 'scores'
                ? 'border-yellow-400 bg-gradient-to-r from-yellow-500 via-yellow-400 to-orange-400 text-black shadow-2xl scale-105 z-10'
                : 'border-gray-700 bg-[#232946] text-yellow-200 hover:bg-yellow-900/10 scale-95 z-0'
            }`}
            style={{
              boxShadow: tab === 'scores' ? '0 6px 32px rgba(255, 204, 0, 0.22)' : undefined,
              fontWeight: 'bolder',
              borderRadius: '1.2rem',
            }}
          >
            <span className={`block px-4 py-2 rounded-xl ${tab === 'scores' ? 'bg-yellow-300/90 text-black' : 'bg-black/80 text-yellow-200'}`}>
              🎮 Game High Scores
            </span>
          </button>
          <button
            onClick={() => setTab('accountXP')}
            className={`px-10 py-5 font-extrabold text-2xl border-4 rounded-2xl transition-all relative overflow-visible ${
              tab === 'accountXP'
                ? 'border-purple-600 bg-gradient-to-r from-pink-500 via-yellow-400 to-purple-500 text-black shadow-2xl scale-105 z-10'
                : 'border-gray-700 bg-[#232946] text-pink-200 hover:bg-pink-900/10 scale-95 z-0'
            }`}
            style={{
              boxShadow: tab === 'accountXP' ? '0 6px 32px #d946ef99' : undefined,
              fontWeight: 'bolder',
              borderRadius: '1.2rem',
            }}
          >
            <span className={`block px-4 py-2 rounded-xl ${tab === 'accountXP' ? 'bg-pink-400/90 text-black' : 'bg-black/80 text-pink-200'}`}>
              🏆 Account Ranking (XP)
            </span>
          </button>
        </nav>

        {/* Arcade games dropdown for scores tab */}
        {tab === 'scores' && (
          <div className="flex items-center gap-4 mb-8">
            <label className="font-bold text-lg mr-2">Arcade Game:</label>
            {gamesList.length > 0 ? (
              <select
                value={selectedGame}
                onChange={e => setSelectedGame(e.target.value)}
                className="px-6 py-3 rounded-xl border-2 border-yellow-400 font-bold text-lg bg-black/70 text-yellow-900 focus:outline-none focus:ring-2 focus:ring-yellow-400"
              >
                {gamesList.map(game => (
                  <option key={game.id} value={game.id}>{game.name}</option>
                ))}
              </select>
            ) : (
              <div className="px-6 py-3 rounded-xl border-2 border-yellow-400 bg-black/70 text-lg text-yellow-900 font-bold">
                No arcade games found!
              </div>
            )}
          </div>
        )}

        {/* Leaderboard timeframes for scores tab only */}
        {tab === 'scores' && (
          <div className="flex gap-6 mb-8">
            <button
              onClick={() => setTimeframe('monthly')}
              className={`px-7 py-3 rounded-xl font-bold border-2 text-lg transition ${
                timeframe === 'monthly'
                  ? 'border-purple-600 bg-purple-800 text-white scale-105'
                  : 'border-gray-700 bg-gray-800 text-purple-200 hover:bg-purple-900/10 scale-95'
              }`}
            >
              <span className="block rounded-lg px-2 py-1 bg-black/80">Monthly</span>
            </button>
            <button
              onClick={() => setTimeframe('allTime')}
              className={`px-7 py-3 rounded-xl font-bold border-2 text-lg transition ${
                timeframe === 'allTime'
                  ? 'border-purple-600 bg-purple-800 text-white scale-105'
                  : 'border-gray-700 bg-gray-800 text-purple-200 hover:bg-purple-900/10 scale-95'
              }`}
            >
              <span className="block rounded-lg px-2 py-1 bg-black/80">All-Time</span>
            </button>
          </div>
        )}

        {/* Main leaderboard */}
        <section className="bg-[#181820] border border-gray-700 rounded-2xl shadow-2xl overflow-x-auto w-full">
          {/* Header Row */}
          <div className="grid grid-cols-10 items-center px-4 lg:px-8 py-4 bg-gradient-to-r from-purple-950 via-[#232946] to-purple-950 border-b border-gray-700 text-gray-400 uppercase text-base font-extrabold tracking-wider">
            <div className="col-span-2">Rank</div>
            <div className="col-span-4">Player</div>
            {tab === 'scores' ? (
              <div className="col-span-4 text-right">Score</div>
            ) : (
              <>
                <div className="col-span-2 text-center">Level</div>
                <div className="col-span-2 text-right">XP</div>
              </>
            )}
          </div>
          {/* Body */}
          {loading ? (
            <div className="py-10 text-center text-lg text-gray-300 animate-pulse">Loading Leaderboard...</div>
          ) : tab === 'scores' ? (
            leaderboard.length === 0 ? (
              <div className="py-10 text-center text-lg text-gray-400">No scores recorded for this period yet.</div>
            ) : (
              leaderboard.map(({ rank, score, player }, index) => (
                <div
                  key={player.wallet}
                  className={`grid grid-cols-10 items-center px-4 lg:px-8 py-5 border-b border-gray-800 last:border-b-0
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
                  <div className={`col-span-2 font-bold text-xl flex items-center ${
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
                  <div className="col-span-4 flex items-center gap-4 min-w-0">
                    <img
                      src={player.avatarUrl || DEFAULT_AVATAR}
                      alt="avatar"
                      className={`w-10 h-10 rounded-full object-cover shadow ${
                        rank === 1 ? 'border-2 border-yellow-400' : rank === 2 ? 'border-2 border-gray-300' : rank === 3 ? 'border-2 border-orange-400' : 'border border-gray-700'
                      }`}
                    />
                    <span className="font-bold text-white truncate text-lg">
                      {player.username || shortAddress(player.wallet)}
                    </span>
                  </div>
                  {/* Score */}
                  <div className="col-span-4 text-right font-bold text-2xl text-white">
                    {score}
                  </div>
                </div>
              ))
            )
          ) : (
            xpLeaderboard.length === 0 ? (
              <div className="py-10 text-center text-lg text-gray-400">No users have earned XP yet.</div>
            ) : (
              xpLeaderboard.map(({ rank, player, level, accountXP }, index) => (
                <div
                  key={player.wallet}
                  className={`grid grid-cols-10 items-center px-4 lg:px-8 py-5 border-b border-gray-800 last:border-b-0
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
                  <div className={`col-span-2 font-bold text-xl flex items-center ${
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
                  <div className="col-span-4 flex items-center gap-4 min-w-0">
                    <img
                      src={player.avatarUrl || DEFAULT_AVATAR}
                      alt="avatar"
                      className={`w-10 h-10 rounded-full object-cover shadow ${
                        rank === 1 ? 'border-2 border-yellow-400' : rank === 2 ? 'border-2 border-gray-300' : rank === 3 ? 'border-2 border-orange-400' : 'border border-gray-700'
                      }`}
                    />
                    <span className="font-bold text-white truncate text-lg">
                      {player.username || shortAddress(player.wallet)}
                    </span>
                  </div>
                  {/* Level */}
                  <div className="col-span-2 text-center text-lg">{level}</div>
                  {/* XP */}
                  <div className="col-span-2 text-right font-bold text-xl text-pink-200">{accountXP}</div>
                </div>
              ))
            )
          )}
        </section>
      </div>
    </main>
  );
}