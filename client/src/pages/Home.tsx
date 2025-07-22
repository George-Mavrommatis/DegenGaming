import { Link } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { FaGamepad, FaArrowRight, FaChevronLeft, FaChevronRight } from "react-icons/fa";
import { useState, useEffect } from "react";
import Footer from "../components/Footer";
import { useProfile } from "../context/ProfileContext";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { fetchLeaderboard, LeaderboardEntry } from "../firebase/gameScores";
import PlatformStatsPanel from "../components/PlatformStatsPanel";
import UserDashboard from "../components/UserDashboard";

const TOTAL_GAMES = 16;

interface PlatformStats {
  totalGames: number;
  activePlayers: number;
  totalPrizes: string;
  uptime: string;
}

interface RecentGame {
  gameName: string;
  score: number;
  playedAt: string;
  link: string;
}

export default function Home() {
  const { user, profile, loading: profileLoading } = useProfile();
  const [platformStats, setPlatformStats] = useState<PlatformStats>({
    totalGames: TOTAL_GAMES,
    activePlayers: 0,
    totalPrizes: "0 SOL",
    uptime: "98%",
  });
  const [recentGames, setRecentGames] = useState<RecentGame[]>([]);
  const [leaderboardSnapshot, setLeaderboardSnapshot] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const promoEvents = [
    {
      title: "December Championship",
      desc: "Compete in all games for 1 SOL!",
      url: "/tournaments/december-championship",
    },
    {
      title: "Monthly Arcade Challenge",
      desc: "Beat your high scores - 1 SOL this month.",
      url: "/tournaments/weekly-arcade",
    },
  ];
  const [promoIndex, setPromoIndex] = useState(0);

  useEffect(() => {
    const fetchPlatformStats = async () => {
      try {
        const statsRef = doc(db, "platform", "stats");
        const statsSnap = await getDoc(statsRef);

        if (statsSnap.exists()) {
          const data = statsSnap.data();
          setPlatformStats({
            totalGames: TOTAL_GAMES,
            activePlayers: data.activePlayers || 0,
            totalPrizes: `${data.totalPrizes || 0} SOL`,
            uptime: data.uptime || "98%",
          });
        }
        if (!statsSnap.exists() || !statsSnap.data().activePlayers) {
          const usersSnapshot = await getDocs(collection(db, "users"));
          setPlatformStats((prev) => ({
            ...prev,
            activePlayers: usersSnapshot.size,
          }));
        }
      } catch (error) {
        console.error("Error fetching platform stats:", error);
      }
    };

    fetchPlatformStats();
  }, []);

  useEffect(() => {
    const fetchLeaderboardData = async () => {
      try {
        const leaderboard = await fetchLeaderboard("monthly", 3);
        setLeaderboardSnapshot(leaderboard);
      } catch (error) {
        console.error("Error fetching leaderboard:", error);
      }
    };

    fetchLeaderboardData();
  }, []);

  useEffect(() => {
    if (profile?.recentGames) {
      const transformed = profile.recentGames.slice(0, 3).map((game) => {
        const gameRoutes: { [key: string]: string } = {
          "Wack a Wegen": "/games/wackawegen",
          "Wegen Race": "/games/wegenrace",
          "SoVegas": "/games/so-vegas",
        };
        return {
          gameName: game.gameName,
          score: game.score,
          playedAt: formatTimeAgo(game.playedAt),
          link: gameRoutes[game.gameName] || "/games",
        };
      });
      setRecentGames(transformed);
    }
    setLoading(false);
  }, [profile]);

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 24) return "Today";
    if (diffInHours < 48) return "Yesterday";
    if (diffInHours < 72) return "2 days ago";
    return date.toLocaleDateString();
  };

  const nextPromo = () => setPromoIndex((i) => (i + 1) % promoEvents.length);
  const prevPromo = () => setPromoIndex((i) => (i - 1 + promoEvents.length) % promoEvents.length);

  if (profileLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/30 to-slate-900 flex items-center justify-center">
        <div className="text-white text-xl animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex flex-col bg-gradient-to-br from-slate-900 via-purple-900/30 to-slate-900">
      {/* Hero */}
      <section className="flex flex-col items-center justify-center min-h-[38vh] pt-32 pb-10 w-full">
        <div className="text-center max-w-3xl mx-auto px-4">
          <h1 className="text-6xl font-extrabold tracking-wider font-orbitron bg-clip-text text-transparent bg-gradient-to-r from-yellow-400 via-purple-400 to-pink-500 mb-2 uppercase">
            Welcome to
          </h1>
          <h2 className="text-5xl font-black font-orbitron text-[#ffd93b] mb-6 uppercase">
            Degen Gaming!
          </h2>
          <p className="text-slate-300 text-xl max-w-2xl mx-auto mb-8">
            Discover games, track your progress, and climb the leaderboards.<br />
            Shape the Web3 arcade—your journey starts now.
          </p>
          <WalletMultiButton className="!bg-gradient-to-r !from-purple-600 !to-pink-600 !text-white !font-bold !px-8 !py-4 !rounded-lg !text-lg" />
        </div>
      </section>

      {/* Panels Layout */}
      <main className="w-full max-w-7xl mx-auto flex-1 px-2 sm:px-6 pb-12">

        {/* User Dashboard always first row, always full width on lg+ */}
        <div className="grid grid-cols-1 lg:grid-cols-1 gap-6 mb-6">
          <section className="rounded-2xl bg-slate-800/40 shadow-lg p-5 sm:p-7 border border-slate-700/50 flex flex-col items-center text-center min-w-0 transition-all">
            <h2 className="text-2xl font-orbitron font-bold mb-4 text-purple-400">
              {user ? "Your Dashboard" : "Connect Wallet"}
            </h2>
            {profile ? (
              <div className="w-full max-w-2xl">
                <UserDashboard profile={profile} />
                <Link
                  to="/profile"
                  className="mt-6 inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 font-semibold transition-colors"
                >
                  View Full Profile <FaArrowRight className="text-xs" />
                </Link>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-slate-400 mb-4">Connect your wallet to view your stats</p>
                <WalletMultiButton className="!bg-gradient-to-r !from-purple-600 !to-pink-600 !text-white !font-bold !px-6 !py-3 !rounded-lg" />
              </div>
            )}
          </section>
        </div>

        {/* Other panels grouped below the dashboard */}
        <div
          className="
            grid
            grid-cols-1
            sm:grid-cols-2
            lg:grid-cols-3
            gap-6
          "
        >
          {/* Promo Carousel */}
          <section className="rounded-2xl bg-gradient-to-r from-purple-700/30 to-pink-700/20 shadow-lg border border-purple-500/30 p-5 sm:p-7 flex flex-col items-center text-center min-w-0 transition-all">
            <h2 className="font-orbitron text-2xl font-bold mb-4 text-pink-500">Promo Events</h2>
            <div className="flex flex-col items-center w-full min-h-[120px] justify-center">
              <div className="flex flex-row gap-2 items-center justify-center">
                <button onClick={prevPromo} className="bg-pink-700/30 rounded-full p-2 text-pink-200 hover:text-white">
                  <FaChevronLeft />
                </button>
                <div className="min-w-[160px] px-2">
                  <h3 className="text-lg font-bold text-white">{promoEvents[promoIndex].title}</h3>
                  <p className="text-slate-200 text-sm">{promoEvents[promoIndex].desc}</p>
                  <Link to={promoEvents[promoIndex].url} className="text-purple-300 hover:underline inline-flex gap-1 items-center mt-2 text-sm">
                    View Details <FaArrowRight />
                  </Link>
                </div>
                <button onClick={nextPromo} className="bg-pink-700/30 rounded-full p-2 text-pink-200 hover:text-white">
                  <FaChevronRight />
                </button>
              </div>
            </div>
          </section>

          {/* Recent Games */}
          <section className="rounded-2xl bg-slate-900/40 shadow-lg p-5 sm:p-7 border border-slate-700/50 flex flex-col items-center text-center min-w-0 transition-all">
            <h2 className="text-xl font-orbitron font-bold text-purple-400 mb-4">Recent Games</h2>
            {recentGames.length > 0 ? (
              <ul className="space-y-4 w-full">
                {recentGames.map((game, idx) => (
                  <li key={idx} className="flex justify-between items-center">
                    <div>
                      <Link to={game.link} className="font-bold text-white hover:text-purple-300 inline-flex items-center">
                        <FaGamepad className="mr-2 text-purple-400" /> {game.gameName}
                      </Link>
                      <div className="text-xs text-slate-400">{game.playedAt}</div>
                    </div>
                    <span className="rounded bg-purple-700/50 px-3 py-1 text-sm text-yellow-200">
                      Score: {game.score}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-center py-4 text-slate-500 w-full">
                {user ? "No recent games yet" : "Connect wallet to see your games"}
              </div>
            )}
            <Link
              to="/games"
              className="mt-6 block w-full text-center text-purple-400 hover:text-purple-300 font-semibold transition-colors"
            >
              Go to Games <FaArrowRight className="ml-1 inline" />
            </Link>
          </section>

          {/* Leaderboard Snapshot */}
          <section className="rounded-2xl bg-purple-800/40 border border-purple-600/60 shadow-lg p-5 sm:p-7 flex flex-col items-center text-center min-w-0 transition-all">
            <h2 className="text-xl font-orbitron font-bold text-purple-300 mb-4">Monthly Leaders</h2>
            {leaderboardSnapshot.length > 0 ? (
              <ol className="space-y-2 w-full">
                {leaderboardSnapshot.map((entry) => (
                  <li key={entry.player.wallet} className="flex items-center gap-3 justify-center">
                    <div className={`text-lg font-bold ${
                      entry.rank === 1 ? "text-yellow-300" :
                      entry.rank === 2 ? "text-gray-300" : "text-amber-600"
                    }`}>
                      #{entry.rank}
                    </div>
                    <div className="flex-1 truncate max-w-[100px] text-white">
                      <span>{entry.player.username || `Player${entry.player.wallet.slice(-4)}`}</span>
                      <span className="ml-2 text-xs text-purple-200">Wack a Wegen</span>
                    </div>
                    <span className="font-bold text-yellow-100">{entry.score}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="text-center py-4 text-slate-500 w-full">
                No scores yet this month
              </div>
            )}
            <Link
              to="/leaderboards"
              className="mt-6 block w-full text-center text-purple-400 hover:text-purple-300 font-semibold transition-colors"
            >
              Full Leaderboards <FaArrowRight className="ml-1 inline" />
            </Link>
          </section>
        </div>

        {/* Platform Stats */}
        <div className="w-full mt-10 flex justify-center">
          <PlatformStatsPanel />
        </div>
      </main>
      <Footer />
    </div>
  );
}
