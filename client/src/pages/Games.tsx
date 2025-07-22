import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import axios from 'axios';
import { useProfile } from '../context/ProfileContext';

// Import all category-specific InitModal components (ensure these paths are correct)
import PickerInitModal from '../games/Picker/PickerInitModal';
import ArcadeInitModal from '../games/Arcade/ArcadeInitModal';
import CasinoInitModal from '../games/Casino/CasinoInitModal';
import PvPInitModal from '../games/PvP/PvPInitModal';

import PlatformStatsPanel from "../components/PlatformStatsPanel";
import {
  FaGamepad, FaTrophy, FaFire, FaArrowRight, FaCoins,
  FaFistRaised, FaDice, FaGift
} from 'react-icons/fa';

// Wallet and payment configurations
const PLATFORM_WALLET = "4TA49YPJRYbQF5riagHj3DSzDeMek9fHnXChQpgnKkzy";
const CATEGORY_PAYMENT: { [key: string]: number } = { Arcade: 0.005, Picker: 0.01, PvP: 0.1, Casino: 0.02 };

const categoryConfig: { [key: string]: any } = {
  Arcade: { icon: FaGamepad, color: 'from-purple-600 to-blue-600', bgColor: 'bg-purple-900/20', borderColor: 'border-purple-500/30', description: 'Classic arcade games' },
  Picker: { icon: FaGift, color: 'from-green-600 to-emerald-600', bgColor: 'bg-green-900/20', borderColor: 'border-green-500/30', description: 'Random selection games' },
  PvP: { icon: FaFistRaised, color: 'from-red-600 to-orange-600', bgColor: 'bg-red-900/20', borderColor: 'border-red-500/30', description: 'Player vs Player battles' },
  Casino: { icon: FaDice, color: 'from-yellow-600 to-amber-600', bgColor: 'bg-yellow-900/20', borderColor: 'border-yellow-900/30', description: 'Traditional casino games' }
};

type Game = {
  id: string;
  title: string;
  category: string;
  image: string;
  isNew?: boolean;
  isTrending?: boolean;
  prizePool?: string;
  route: string;
  description: string;
  solGathered?: number;
  solDistributed?: number;
  ticketPriceUsd?: number;
  destinationWallet?: string;
  minPlayers?: number;
};

type Category = {
  id: string;
  name: string;
  description?: string;
};

interface FreeEntryTokens {
    arcadeTokens: number;
    pickerTokens: number;
    casinoTokens: number;
    pvpTokens: number;
}

export default function GamesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [modalGame, setModalGame] = useState<Game | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true); // Loading for games/categories
  const navigate = useNavigate();
  const { user, firebaseAuthToken } = useProfile(); // FIX: user, not currentUser

  const [freeTokens, setFreeTokens] = useState<FreeEntryTokens | null>(null);
  const [loadingTokens, setLoadingTokens] = useState(true); // Loading for free tokens
  const [errorTokens, setErrorTokens] = useState<string | null>(null);

  // This line needs to correctly point to your backend.
  // Ensure your .env file in the project root contains VITE_BACKEND_URL=http://localhost:8000
  const API_BASE_URL = process.env.VITE_BACKEND_URL || 'http://localhost:4000';

  const CATEGORY_ORDER = ['Picker', 'Arcade', 'Casino', 'PvP'];
  const sortedCategories = [...categories].sort((a, b) => CATEGORY_ORDER.indexOf(a.id) - CATEGORY_ORDER.indexOf(b.id));

  // Fetch free entry tokens
  const fetchFreeEntryTokens = useCallback(async () => {
      setLoadingTokens(true);
      setErrorTokens(null);
      if (!user || !firebaseAuthToken) {
          setFreeTokens({ arcadeTokens: 0, pickerTokens: 0, casinoTokens: 0, pvpTokens: 0 });
          setErrorTokens("Log in to view your free entry tokens.");
          setLoadingTokens(false);
          return;
      }
      try {
          const response = await axios.get<FreeEntryTokens>(`${API_BASE_URL}/user/free-entry-tokens`, {
              headers: { Authorization: `Bearer ${firebaseAuthToken}` },
          });
          setFreeTokens(response.data);
      } catch (error: any) {
          console.error("Error fetching free entry tokens:", error);
          setErrorTokens(error.response?.data?.message || "Failed to load free entry tokens.");
          setFreeTokens({ arcadeTokens: 0, pickerTokens: 0, casinoTokens: 0, pvpTokens: 0 });
      } finally {
          setLoadingTokens(false);
      }
  }, [user, firebaseAuthToken, API_BASE_URL]); // FIX: user

  useEffect(() => {
    if (!firebaseAuthToken) {
        setLoading(false);
        console.warn("GamesPage: No Firebase Auth Token available. Skipping protected API calls for games and categories.");
        return;
    }

    setLoading(true);

    const config = {
        headers: {
            Authorization: `Bearer ${firebaseAuthToken}`
        }
    };

    Promise.all([
      axios.get<Game[]>(`${API_BASE_URL}/games`, config),
      axios.get<Category[]>(`${API_BASE_URL}/categories`, config)
    ]).then(([gamesResponse, categoriesResponse]) => {
      const gamesData = gamesResponse.data;
      const categoriesData = categoriesResponse.data;

      const processedGames = gamesData.map((game: Game) => ({
        ...game,
        ticketPriceUsd: CATEGORY_PAYMENT[game.category] || 0.01,
        destinationWallet: PLATFORM_WALLET,
        minPlayers: game.id === "wegen-race" ? 2 : undefined,
      }));
      setGames(processedGames);
      setCategories(categoriesData);
      setLoading(false);
    }).catch(err => {
      setLoading(false);
      const errorMessage = err.response?.data?.message || err.message || "Unknown error";
      toast.error("Failed to load game data: " + errorMessage);
    });
  }, [firebaseAuthToken, API_BASE_URL]);

  useEffect(() => {
    fetchFreeEntryTokens();
  }, [fetchFreeEntryTokens]);

  const getGamesByCategory = (categoryId: string) =>
    games.filter(game => game.category === categoryId && game.title.toLowerCase().includes(searchQuery.toLowerCase()));

  const GameCard = ({ game }: { game: Game }) => (
    <div className="group bg-slate-800 rounded-lg overflow-hidden hover:scale-105 transition-all duration-300 border border-slate-700 relative">
      <div onClick={() => setModalGame(game)} className="cursor-pointer">
        <img
          src={game.image}
          alt={game.title}
          className="w-full h-32 object-cover"
          onError={(e) => (e.currentTarget.src = '/images/games/small-logo.png')}
        />
        {game.isNew && <span className="absolute top-1 left-1 bg-green-500 text-white px-2 py-0.5 rounded text-xs font-bold">NEW</span>}
        {game.isTrending && <span className="absolute top-1 right-1 bg-orange-500 text-white px-2 py-0.5 rounded text-xs font-bold">HOT</span>}
      </div>
      <div className="p-3">
        <h4 className="font-bold mb-1 text-sm text-white">{game.title}</h4>
        <p className="text-xs text-slate-300 mb-1">{game.description}</p>
        {game.solGathered !== undefined && game.solDistributed !== undefined && (
          <div className="text-[11px] text-amber-200 bg-gray-950/30 p-2 mt-1 rounded-md leading-tight">
            Last month we gathered <span className="font-bold text-yellow-300">{game.solGathered} SOL</span> and gave back to the TOP 5 players <span className="font-bold text-green-300">{game.solDistributed} SOL</span> in prizes.
          </div>
        )}
        <button
          className="mt-3 w-full py-2 rounded bg-gradient-to-r from-lime-500 to-green-600 text-white text-xs font-bold shadow hover:from-lime-600 hover:to-green-700"
          onClick={() => {
            setModalGame(game);
          }}
        >
          Play {game.title} ({CATEGORY_PAYMENT[game.category]?.toFixed(3) || '0.000'} USD)
        </button>
        {game.prizePool && (
          <div className="flex items-center gap-1 mt-2 text-xs text-green-400">
            <FaCoins />
            <span>{game.prizePool} Extra Addition on the Gathered Monthly Pot</span>
          </div>
        )}
      </div>
    </div>
  );

  const CategorySection = ({ category }: { category: Category }) => {
    const config = categoryConfig[category.id] || {};
    const IconComponent = config.icon || FaGamepad;
    const categoryGames = getGamesByCategory(category.id);

    if (!loading && categoryGames.length === 0) return null;

    return (
      <div className={`${config.bgColor || 'bg-slate-900/20'} rounded-2xl p-6 border ${config.borderColor || 'border-slate-700/30'}`}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-lg bg-gradient-to-r ${config.color || 'from-slate-700 to-slate-900'}`}>
              <IconComponent className="text-white text-xl" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">{category.name || category.id} Games</h2>
              <p className="text-gray-400 text-sm">{config.description || category.description}</p>
            </div>
          </div>
          {categoryGames.length > 3 && (
            <Link to={`/games/category/${category.id.toLowerCase()}`} className="text-purple-400 hover:text-purple-300 font-semibold text-sm flex items-center gap-1">
              View All <FaArrowRight className="text-xs" />
            </Link>
          )}
        </div>
        {loading ? (
            <div className="text-center py-8 text-gray-500">Loading games...</div>
        ) : categoryGames.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {categoryGames.slice(0, 3).map(game => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <FaGamepad className="mx-auto text-4xl mb-2" />
            <p>No games found in this category.</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/30 to-slate-900 pt-24 pb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 mb-4">Game Hub</h1>
          <p className="text-slate-300 text-xl max-w-2xl mx-auto mb-8">Compete, earn, and climb the leaderboards in our Web3 gaming ecosystem</p>
          <div className="max-w-md mx-auto">
            <input
              type="text"
              placeholder="Search all games..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-purple-500 focus:outline-none backdrop-blur-md"
            />
          </div>
        </div>

        <div className="bg-gradient-to-r from-purple-600/20 to-pink-600/20 rounded-2xl p-8 mb-12 border border-purple-500/30 backdrop-blur-md">
          <div className="flex flex-col lg:flex-row items-center gap-8">
            <div className="flex-1 text-center lg:text-left">
              <div className="flex items-center justify-center lg:justify-start gap-2 mb-4">
                <FaFire className="text-orange-500 text-xl" />
                <span className="text-orange-500 font-bold text-lg">FEATURES OF OUR PLATFORM </span>
              </div>
              <h2 className="text-4xl font-bold text-white mb-4">Inauguration Month of Degen Gaming</h2>
              <p className="text-slate-300 text-lg mb-6">Use our Picker Games with their minimal fee drawing a winner from a list of Degen Users or simply wallets for your giveaway!</p>
              <p className="text-slate-300 text-lg mb-6">Compete across all Arcade Games for Monthly payouts to the Top 5 Degen Players of the month!</p>
              <Link to="/tournaments/december-championship" className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 px-8 py-4 rounded-lg font-bold transition-all text-white">
                Wack A Wegen to celebrate with us! <FaArrowRight />
              </Link>
            </div>
          </div>
        </div>

        <div className="free-entry-tokens-display mb-8 p-6 bg-gray-800 rounded-lg shadow-lg border border-gray-700">
            <h3 className="text-2xl font-bold text-white mb-4 text-center">Your Free Entry Tokens</h3>
            {loadingTokens ? (
                <p className="text-gray-400 text-center">Loading tokens...</p>
            ) : errorTokens ? (
                <p className="text-red-500 text-center">{errorTokens}</p>
            ) : (user && freeTokens) ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-white text-center">
                    <div className="p-3 bg-gray-700 rounded-md">
                        <p className="text-xl font-semibold">Arcade</p>
                        <p className="text-3xl font-bold text-blue-300 mt-1">{freeTokens.arcadeTokens}</p>
                    </div>
                    <div className="p-3 bg-gray-700 rounded-md">
                        <p className="text-xl font-semibold">Picker</p>
                        <p className="text-3xl font-bold text-green-300 mt-1">{freeTokens.pickerTokens}</p>
                    </div>
                    <div className="p-3 bg-gray-700 rounded-md">
                        <p className="text-xl font-semibold">Casino</p>
                        <p className="text-3xl font-bold text-yellow-300 mt-1">{freeTokens.casinoTokens}</p>
                    </div>
                    <div className="p-3 bg-gray-700 rounded-md">
                        <p className="text-xl font-semibold">PvP</p>
                        <p className="text-3xl font-bold text-red-300 mt-1">{freeTokens.pvpTokens}</p>
                    </div>
                </div>
            ) : (
                <p className="text-gray-400 text-center">Log in to view your free entry tokens.</p>
            )}
        </div>

        <div className="space-y-8">
          {loading ? (
            <div className="text-center text-xl text-purple-300 py-8">Loading games and categories...</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {sortedCategories.length > 0 ? (
                sortedCategories.map(category => (
                  <CategorySection key={category.id} category={category} />
                ))
              ) : (
                <div className="col-span-full text-center text-xl text-gray-500 py-8">No categories found or loaded.</div>
              )}
            </div>
          )}

          <div className="w-full mt-8 flex justify-center">
            <PlatformStatsPanel />
          </div>
        </div>

        {/* Modals remain mostly the same */}
        {modalGame && modalGame.category === "Picker" && (
          <PickerInitModal
            isOpen={!!modalGame}
            gameId={modalGame.id}
            gameType={modalGame.category}
            onSuccess={(gameConfigFromModal) => {
              if (!gameConfigFromModal || typeof gameConfigFromModal !== 'object') {
                  toast.error("Game configuration error. Please try again.");
                  setModalGame(null);
                  return;
              }
              if (!gameConfigFromModal.gameEntryTokenId) {
                  toast.error("Game session token missing. Please re-initiate payment or free entry.");
                  setModalGame(null);
                  return;
              }
              if (!modalGame.route) {
                  toast.error("Game route not configured. Please try another game.");
                  setModalGame(null);
                  return;
              }
              setModalGame(null);
              navigate(modalGame.route, { state: { gameConfig: gameConfigFromModal } });
            }}
            onError={msg => {
              setModalGame(null);
              toast.error(`Game initiation failed: ${msg}`);
            }}
            onClose={() => setModalGame(null)}
            gameTitle={modalGame.title}
            minPlayers={modalGame.minPlayers || 2}
          />
        )}

        {modalGame && modalGame.category === "Arcade" && (
          <ArcadeInitModal
            isOpen={!!modalGame}
            gameId={modalGame.id}
            category={modalGame.category}
            ticketPriceSol={CATEGORY_PAYMENT[modalGame.category] || 0.005}
            destinationWallet={PLATFORM_WALLET}
            onSuccess={sig => {
              setModalGame(null);
              window.location.href = modalGame.route;
            }}
            onError={msg => {
              setModalGame(null);
              toast.error(`Payment error: ${msg}`);
            }}
            onClose={() => setModalGame(null)}
            gameTitle={modalGame.title}
          />
        )}

        {modalGame && modalGame.category === "Casino" && (
          <CasinoInitModal
            isOpen={!!modalGame}
            gameId={modalGame.id}
            category={modalGame.category}
            ticketPriceSol={CATEGORY_PAYMENT[modalGame.category] || 0.01}
            destinationWallet={PLATFORM_WALLET}
            onSuccess={sig => {
              setModalGame(null);
              window.location.href = modalGame.route;
            }}
            onError={msg => {
              setModalGame(null);
              toast.error(`Payment error: ${msg}`);
            }}
            onClose={() => setModalGame(null)}
            gameTitle={modalGame.title}
          />
        )}

        {modalGame && modalGame.category === "PvP" && (
          <PvPInitModal
            isOpen={!!modalGame}
            gameId={modalGame.id}
            category={modalGame.category}
            ticketPriceSol={CATEGORY_PAYMENT[modalGame.category] || 0.01}
            destinationWallet={PLATFORM_WALLET}
            onSuccess={sig => {
              setModalGame(null);
              window.location.href = modalGame.route;
            }}
            onError={msg => {
              setModalGame(null);
              toast.error(`Payment error: ${msg}`);
            }}
            onClose={() => setModalGame(null)}
            gameTitle={modalGame.title}
          />
        )}
      </div>
    </div>
  );
}