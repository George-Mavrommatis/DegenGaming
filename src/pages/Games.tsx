import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify'; // Ensure this is imported for toaster messages

// Import all category-specific InitModal components
import PickerInitModal from '../games/Picker/PickerInitModal';
import ArcadeInitModal from '../games/Arcade/ArcadeInitModal'; // Assuming these exist
import CasinoInitModal from '../games/Casino/CasinoInitModal'; // Assuming these exist
import PvPInitModal from '../games/PvP/PvPInitModal'; // Assuming these exist

import PlatformStatsPanel from "../components/PlatformStatsPanel";
import {
  FaGamepad, FaTrophy, FaFire, FaArrowRight, FaCoins,
  FaFistRaised, FaDice, FaGift
} from 'react-icons/fa';

// Wallet and payment configurations
// Ensure this is your actual platform wallet address
const PLATFORM_WALLET = "4TA49YPJRYbQF5riagHj3DSzDeMek9fHnXChQpgnKkzy"; 
const CATEGORY_PAYMENT: { [key: string]: number } = { Arcade: 0.005, Picker: 0.01, PvP: 0.1, Casino: 0.02 }; // Defined as USD prices

// Category configuration
const categoryConfig: { [key: string]: any } = {
  Arcade: { icon: FaGamepad, color: 'from-purple-600 to-blue-600', bgColor: 'bg-purple-900/20', borderColor: 'border-purple-500/30', description: 'Classic arcade games' },
  Picker: { icon: FaGift, color: 'from-green-600 to-emerald-600', bgColor: 'bg-green-900/20', borderColor: 'border-green-500/30', description: 'Random selection games' },
  PvP: { icon: FaFistRaised, color: 'from-red-600 to-orange-600', bgColor: 'bg-red-900/20', borderColor: 'border-red-500/30', description: 'Player vs Player battles' },
  Casino: { icon: FaDice, color: 'from-yellow-600 to-amber-600', bgColor: 'bg-yellow-900/20', borderColor: 'border-yellow-900/30', description: 'Traditional casino games' } // Fixed 'to-amber-600'
};

// Games page related types
type Game = {
  id: string;
  title: string;
  category: string;
  image: string;
  isNew?: boolean;
  isTrending?: boolean;
  prizePool?: string;
  route: string; // The route to navigate to for this game, e.g., '/games/wegenrace'
  description: string;
  solGathered?: number;
  solDistributed?: number;
  ticketPriceUsd?: number; // This might still come from backend, but PickerInitModal doesn't use it directly now
  destinationWallet?: string;
  minPlayers?: number; // Added for Picker game
};

type Category = {
  id: string;
  name: string;
  description?: string;
};

// Main Component
export default function GamesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [modalGame, setModalGame] = useState<Game | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const CATEGORY_ORDER = ['Picker', 'Arcade', 'Casino', 'PvP'];
  const sortedCategories = [...categories].sort((a, b) => CATEGORY_ORDER.indexOf(a.id) - CATEGORY_ORDER.indexOf(b.id));

  useEffect(() => {
    console.log("DEBUG: GamesPage: Fetching games and categories data.");
    setLoading(true);
    Promise.all([
      fetch('http://localhost:4000/api/games').then(r => r.json()),
      fetch('http://localhost:4000/api/categories').then(r => r.json())
    ]).then(([gamesData, categoriesData]) => {
      // Ensure gamesData includes ticketPriceUsd and destinationWallet for proper modal props
      const processedGames = gamesData.map((game: Game) => ({
        ...game,
        ticketPriceUsd: CATEGORY_PAYMENT[game.category] || 0.01, // Default if not found
        destinationWallet: PLATFORM_WALLET, // Assuming a single platform wallet for now
        // For 'Picker' category, specifically 'Wegen Race', ensure minPlayers is set correctly.
        // Backend should ideally provide this, but overriding here for known games like Wegen Race.
        minPlayers: game.id === "wegen-race-game-id" ? 2 : undefined, // Assuming "wegen-race-game-id" is the ID for Wegen Race from your backend
      }));
      console.log("DEBUG: GamesPage: Processed Games Data:", processedGames);
      console.log("DEBUG: GamesPage: Categories Data:", categoriesData);
      setGames(processedGames);
      setCategories(categoriesData);
      setLoading(false);
    }).catch(err => {
      setLoading(false);
      toast.error("Failed to load game data: " + err.message);
      console.error("ERROR: GamesPage: Failed to load game data:", err);
    });
  }, []);

  const getGamesByCategory = (categoryId: string) =>
    games.filter(game => game.category === categoryId && game.title.toLowerCase().includes(searchQuery.toLowerCase()));

  // Game Card Component - All games now show modal first
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
            console.log(`DEBUG: GamesPage: GameCard click. Setting modalGame to:`, game);
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

  // Category Section Component
  const CategorySection = ({ category }: { category: Category }) => {
    const config = categoryConfig[category.id] || {};
    const IconComponent = config.icon || FaGamepad;
    const categoryGames = getGamesByCategory(category.id);

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
        {categoryGames.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {categoryGames.slice(0, 3).map(game => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <FaGamepad className="mx-auto text-4xl mb-2" />
            <p>No games found matching your search</p>
          </div>
        )}
      </div>
    );
  };

  // Main games page
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/30 to-slate-900 pt-24 pb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
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

        {/* Featured Banner */}
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

            {/* Category Sections */}
        <div className="space-y-8">
          {loading ? (
            <div className="text-center text-xl text-purple-300 py-8">Loading games and categories...</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {sortedCategories.map(category => (
                <CategorySection key={category.id} category={category} />
              ))}
            </div>
          )}

          {/* Platform Stats Panel */}
          <div className="w-full mt-8 flex justify-center">
            <PlatformStatsPanel />
          </div>
        </div>

        {/* Category-specific modals - Show correct modal based on selected game */}
        {modalGame && modalGame.category === "Picker" && (
          <PickerInitModal
            isOpen={!!modalGame}
            gameId={modalGame.id}
            category={modalGame.category}
            // Removed ticketPriceUsd prop as PickerInitModal now uses its own fixed internal fee.
            destinationWallet={modalGame.destinationWallet || PLATFORM_WALLET}
            onSuccess={(gameConfigFromModal) => {
              console.log("DEBUG: GamesPage: PickerInitModal onSuccess triggered!");
              console.log("DEBUG: GamesPage: GameConfig received from PickerInitModal:", gameConfigFromModal);
              
              // Validate critical properties for debugging purposes
              if (!gameConfigFromModal || typeof gameConfigFromModal !== 'object') {
                  console.error("ERROR: GamesPage: gameConfigFromModal is not a valid object!", gameConfigFromModal);
                  toast.error("Game configuration error. Please try again.");
                  setModalGame(null);
                  return;
              }
              if (!gameConfigFromModal.authToken) {
                  console.error("ERROR: GamesPage: gameConfigFromModal is missing authToken!", gameConfigFromModal);
                  toast.error("Authentication token missing for game. Please log in.");
                  setModalGame(null);
                  return;
              }
              if (!gameConfigFromModal.gameEntryTokenId) {
                  console.error("ERROR: GamesPage: gameConfigFromModal is missing gameEntryTokenId!", gameConfigFromModal);
                  toast.error("Game session token missing. Please re-initiate payment or free entry.");
                  setModalGame(null);
                  return;
              }
              if (!modalGame.route) {
                  console.error("ERROR: GamesPage: modalGame.route is undefined. Cannot navigate to game.", modalGame);
                  toast.error("Game route not configured. Please try another game.");
                  setModalGame(null);
                  return;
              }

              // Close the modal and then navigate
              setModalGame(null); 
              console.log(`DEBUG: GamesPage: Navigating to ${modalGame.route} with gameConfig in state.`);
              // THIS IS THE CRITICAL LINE (which was already there in your provided code)
              navigate(modalGame.route, { state: { gameConfig: gameConfigFromModal } });
            }}
            onError={msg => {
              console.error("ERROR: GamesPage: PickerInitModal onError:", msg);
              setModalGame(null);
              toast.error(`Game initiation failed: ${msg}`); // Use toast for user feedback
            }}
            onClose={() => {
              console.log("DEBUG: GamesPage: PickerInitModal onClose triggered.");
              setModalGame(null);
            }}
            gameTitle={modalGame.title}
            minPlayers={modalGame.minPlayers || 2} // Use minPlayers from game data, default to 2
          />
        )}

        {/* Other game category modals (Arcade, Casino, PvP) */}
        {/* These still use window.location.href, as they seem to have a simpler navigation pattern */}
        {/* If they also need to pass complex state, you would apply the same navigate(route, {state:{...}}) pattern */}
        {modalGame && modalGame.category === "Arcade" && (
          <ArcadeInitModal
            isOpen={!!modalGame}
            gameId={modalGame.id}
            category={modalGame.category}
            ticketPriceSol={CATEGORY_PAYMENT[modalGame.category] || 0.005}
            destinationWallet={PLATFORM_WALLET}
            onSuccess={sig => {
              console.log("DEBUG: GamesPage: ArcadeInitModal onSuccess. Sig:", sig);
              setModalGame(null);
              window.location.href = modalGame.route; // Simplified for this category
            }}
            onError={msg => {
              console.error("ERROR: GamesPage: ArcadeInitModal onError:", msg);
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
              console.log("DEBUG: GamesPage: CasinoInitModal onSuccess. Sig:", sig);
              setModalGame(null);
              window.location.href = modalGame.route; // Simplified for this category
            }}
            onError={msg => {
              console.error("ERROR: GamesPage: CasinoInitModal onError:", msg);
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
              console.log("DEBUG: GamesPage: PvPInitModal onSuccess. Sig:", sig);
              setModalGame(null);
              window.location.href = modalGame.route; // Simplified for this category
            }}
            onError={msg => {
              console.error("ERROR: GamesPage: PvPInitModal onError:", msg);
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