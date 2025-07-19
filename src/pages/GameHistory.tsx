// src/pages/GameHistory.tsx

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { useProfile } from "../context/ProfileContext";
import { FaCoins, FaTrophy, FaCalendarAlt } from "react-icons/fa";

interface GameHistoryEntry {
  id: string;
  gameName: string;
  score: number;
  coinsEarned: number;
  timestamp: { seconds: number };
}

const getGameData = (gameId: string): { name: string; img1: string; img2: string } => {
  const normalizedId = (gameId || "").toLowerCase().replace(/[^a-z0-9]/g, '');

  const gameDataMap: { [key: string]: { name: string; img1: string; img2: string } } = {
    wackawegen: {
      name: "Wack-a-Wegen",
      img1: "/images/games/BG-Wack.png",
      img2: "/images/games/small-logo.png",
    },
    girafferace: {
      name: "Giraffe Race!",
      img1: "/images/games/GiraffeRaceBG.png",
      img2: "/images/games/small-logo.png",
    },
    coinflip: {
        name: "Coin Flip",
        img1: "/images/games/coin-flip.png",
        img2: "/images/games/coin-flip-assets.png",
    },
  };

  const defaultData = {
    name: gameId,
    img1: "/images/games/small-logo.png",
    img2: "/images/games/hammer.png",
  };

  return gameDataMap[normalizedId] || defaultData;
};

export default function GameHistory() {
  const { user, profile, loading: profileLoading } = useProfile();
  const [fullHistory, setFullHistory] = useState<GameHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      const fetchFullHistory = async () => {
        setIsLoading(true);
        try {
          const historyCollectionRef = collection(db, 'users', user.uid, 'gameHistory');
          const q = query(historyCollectionRef, orderBy("timestamp", "desc"));
          const snapshot = await getDocs(q);
          const historyData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GameHistoryEntry));
          setFullHistory(historyData);
        } catch (error) {
          console.error("Error fetching game history:", error);
        } finally {
          setIsLoading(false);
        }
      };
      fetchFullHistory();
    } else if (!profileLoading) {
      setIsLoading(false);
    }
  }, [user, profileLoading]);

  const formatDate = (timestamp: { seconds: number }) => {
    if (!timestamp?.seconds) return "N/A";
    return new Date(timestamp.seconds * 1000).toLocaleString();
  };

  const renderContent = () => {
    if (isLoading) { return <div className="text-center text-white mt-20 animate-pulse">Loading Game History...</div>; }
    if (!user) { return (<div className="w-full h-full flex flex-col items-center justify-center p-6 text-center"><h1 className="text-3xl font-orbitron mb-4">Access Denied</h1><p className="text-lg mb-6">You must be logged in to view your game history.</p><Link to="/" className="px-6 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold transition-colors">Go Home</Link></div>); }
    if (fullHistory.length === 0) { return (<div className="w-full h-full flex flex-col items-center justify-center p-6 text-center"><h2 className="text-2xl font-semibold">No Games Played</h2><p className="text-gray-400 mt-2">Your glorious history will appear here once you play a few games!</p></div>); }

    return (
      <div className="space-y-4 p-1">
        {fullHistory.map((entry) => {
          const gameData = getGameData(entry.gameName);

          return (
            <div
              key={entry.id}
              className="w-full bg-[#161B22]/70 border border-gray-700 rounded-lg shadow-lg group
                         transition-all duration-300 ease-in-out hover:scale-[1.02] hover:border-purple-500/50 hover:shadow-purple-500/20"
            >
              <div className="flex items-center justify-between p-4 space-x-4">
                {/* Left Side: Game Info */}
                <div className="flex-grow min-w-0"> {/* Added min-w-0 to help with text truncation if needed */}
                  <h3 className="text-xl md:text-2xl font-bold font-orbitron text-purple-300 truncate">{gameData.name}</h3>
                  <div className="flex items-center text-xs text-gray-400 mt-1 gap-2">
                    <FaCalendarAlt />
                    <span>{formatDate(entry.timestamp)}</span>
                  </div>
                </div>

                {/* Right Side: Images and Stats */}
                {/* ✅ THE FIX: Added flex-shrink-0 to prevent this div from being crushed */}
                <div className="flex flex-shrink-0 items-center gap-4 sm:gap-6">
                  {/* Image Gallery - Hidden on small screens, visible on medium+ */}
                  <div className="hidden md:flex items-center gap-2">
                    <img
                      src={gameData.img1}
                      alt={`${gameData.name} preview 1`}
                      className="w-24 h-14 rounded-md object-cover border-2 border-gray-600/50
                                 transition-transform duration-300 group-hover:scale-105"
                    />
                    <img
                      src={gameData.img2}
                      alt={`${gameData.name} preview 2`}
                      className="w-24 h-14 rounded-md object-cover border-2 border-gray-600/50
                                 transition-transform duration-300 delay-75 group-hover:scale-105"
                    />
                  </div>

                  {/* Stats Section - Always visible */}
                  <div className="flex items-center gap-4 text-base sm:text-lg">
                      <div className="flex flex-col items-center text-center">
                          <span className="font-mono text-lg sm:text-xl md:text-2xl font-bold">{entry.score.toLocaleString()}</span>
                          <span className="text-xs font-semibold text-gray-400 flex items-center gap-1"><FaTrophy/> Score</span>
                      </div>
                      <div className="flex flex-col items-center text-center">
                          <span className="font-mono text-lg sm:text-xl md:text-2xl font-bold text-yellow-400">+{entry.coinsEarned || 0}</span>
                          <span className="text-xs font-semibold text-gray-400 flex items-center gap-1"><FaCoins /> Coins</span>
                      </div>
                  </div>
                </div>

              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="bg-[#0D1117] text-white flex flex-col" style={{ height: 'calc(100vh - 64px)' }}>
      <header className="text-center py-6">
        <h1 className="text-4xl font-bold font-orbitron">Game History</h1>
        <p className="text-gray-400 mt-1">A complete record of your battles, {profile?.username || 'Player'}.</p>
      </header>
      <main className="flex-grow overflow-y-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          {renderContent()}
        </div>
      </main>
    </div>
  );
}
