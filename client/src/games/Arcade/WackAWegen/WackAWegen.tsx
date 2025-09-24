import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import Phaser from "phaser";
import ArcadeGameOverModal from "../../../games/Arcade/ArcadeGameOverModal";
import ArcadeInitModal from "../../../games/Arcade/ArcadeInitModal";
import { useProfile } from "../../../context/ProfileContext";
import { saveWackAWegenScore } from "../../../firebase/gamescores";
import { WackAWegenScene } from "./WackAWegenScene";
import { apiService } from '../../../services/api';
import { getArcadeFreeEntryTokens } from "../../../utilities/token";

const GAME_WIDTH = 1050;
const GAME_HEIGHT = 700;
const GAME_ID = "wackawegen";
const GAME_CATEGORY = "arcade";
const TICKET_PRICE_SOL = 0.005;
const PLATFORM_WALLET = "4TA49YPJRYbQF5riagHj3DSzDeMek9fHnXChQpgnKkzy";

const INSTRUCTION_SLIDES = [
  {
    image: "/WackAWegenAssets/instructions1.png",
    title: "Power-Ups & Penalties",
    text: "💣 Bombs lose time\n⏰ Clock gains time\n❓ Mystery is random\n⭐ Golden Wegen gives big points!"
  },
  {
    image: "/WackAWegenAssets/instructions2.png",
    title: "Scoring & Combos",
    text: "👊 Normal: 10pts\n⚡ Fast: 25pts\n🛡️ Tanky: 50pts (3 hits)\n⭐ Golden: 150pts\nHit fast for COMBOS!"
  },
  {
    image: "/WackAWegenAssets/instructions3.png",
    title: "Pro Tips",
    text: "Chain hits for combos\nAvoid near misses\nTime bonuses get harder\nWatch for patterns!"
  }
];

export default function WackAWegen() {
  const gameRef = useRef<Phaser.Game | null>(null);
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const { profile, loading: profileLoading, firebaseAuthToken, refreshProfile } = useProfile();
  const navigate = useNavigate();
  const location = useLocation();

  // Payment navigation state (for replays, deep linking, etc)
  const { txSig, useArcadeFreeEntry, paid: paidNav } = (location.state || {}) as { txSig?: string; useArcadeFreeEntry?: boolean; paid?: boolean };

  // Component state
  const [paid, setPaid] = useState(!!(paidNav || txSig));
  const [useFreeTokenIntent, setUseFreeTokenIntent] = useState(!!useArcadeFreeEntry);
  const [showInitModal, setShowInitModal] = useState(!(paidNav || txSig || useArcadeFreeEntry));
  const [showInstructions, setShowInstructions] = useState(!!(paidNav || txSig || useArcadeFreeEntry));
  const [shouldStartGame, setShouldStartGame] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [coinsEarned, setCoinsEarned] = useState<number>(0);
  const [gameState, setGameState] = useState<'IDLE'|'PLAYING'|'GAME_OVER'>('IDLE');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);
  const [fullscreenLoading, setFullscreenLoading] = useState(false);

  // Responsive background
  useEffect(() => {
    document.body.style.background = "radial-gradient(circle at 60% 40%, #352b5c 0%, #181a2e 100%)";
    return () => { document.body.style.background = "#000"; };
  }, []);

  // Instructions overlay "Start Game" button logic
  const handleInstructionsDone = () => {
    setTokenError(null);
    setShowInstructions(false);
    setShouldStartGame(true); // The actual token consumption now happens in the game start effect
  };

  // Consume free entry token as SOON as the game starts
  useEffect(() => {
    async function consumeFreeTokenIfNeeded() {
      if (shouldStartGame && !gameStarted && (useFreeTokenIntent || paidNav || txSig)) {
        // Always consume 1 token at game start
        const tokens = getArcadeFreeEntryTokens(profile);
        if (tokens <= 0) {
          setTokenError("You have no Arcade Free Entry Tokens to consume.");
          toast.error("No arcade tokens available to consume.");
          setShouldStartGame(false);
          setShowInitModal(true);
          setShowInstructions(false);
          setPaid(false);
          setUseFreeTokenIntent(false);
          return;
        }
        try {
          await apiService.post(
            "/tokens/consume",
            { tokenType: "arcade" },
            { headers: { Authorization: `Bearer ${firebaseAuthToken}` } }
          );
          toast.success("Arcade Free Entry Token consumed!");
          await refreshProfile();
          setPaid(true);
        } catch (err: any) {
          setTokenError("Could not consume Arcade Free Entry Token. Please try again.");
          toast.error("Failed to consume Arcade Free Entry Token.");
          setShouldStartGame(false);
          setShowInitModal(true);
          setPaid(false);
          setUseFreeTokenIntent(false);
        }
      }
    }
    consumeFreeTokenIfNeeded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldStartGame, useFreeTokenIntent, paid, profile, firebaseAuthToken, refreshProfile]);

  // INCREMENT gamesPlayed for this game and category (only once per session)
  useEffect(() => {
    if (shouldStartGame && paid && !gameStarted) {
      setGameStarted(true);
      apiService.incrementGamesPlayed(GAME_ID, GAME_CATEGORY)
        .catch(e => {
          console.error("Failed to increment gamesPlayed stats:", e);
        });
    }
  }, [shouldStartGame, paid, gameStarted]);

  // Mount Phaser game only after payment, instructions, and token consumption
  useEffect(() => {
    if (!shouldStartGame || !profile || !gameContainerRef.current || gameStarted && gameRef.current || !paid) return;
    if (gameRef.current) { gameRef.current.destroy(true); gameRef.current = null; }
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: gameContainerRef.current,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, // Best scaling for fullscreen
      backgroundColor: "#000000",
      scene: [WackAWegenScene],
    };
    const game = new Phaser.Game(config);
    gameRef.current = game;
    game.scene.start("WackAWegenScene", {
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      onGameOver: handleGameOver,
    });
    return () => { if (gameRef.current) { gameRef.current.destroy(true); gameRef.current = null; } };
  }, [shouldStartGame, profile, paid, gameStarted]);

  // Game Over Handler
  const handleGameOver = useCallback(async (event: { score: number }) => {
    setFinalScore(event.score);
    setCoinsEarned(Math.floor(event.score / 10));
    setGameState('GAME_OVER');
    if (!profile) {
      toast.error("Could not save score: User profile not found.");
      return;
    }
    try {
      await saveWackAWegenScore(profile, event.score);
      toast.success(`Score of ${event.score} saved!`);
    } catch (error) {
      toast.error("There was an issue saving your score.");
    }
  }, [profile]);

  // Restart flow
  const restartGame = () => {
    setFinalScore(null);
    setCoinsEarned(0);
    setGameStarted(false);
    setGameState('IDLE');
    setShowInitModal(true);
    setShowInstructions(false);
    setShouldStartGame(false);
    setTokenError(null);
    setPaid(false);
    setUseFreeTokenIntent(false);
    setSlide(0);
  };

  // Robust fullscreen handler (native + Phaser)
  const handleFullscreen = async () => {
    setFullscreenLoading(true);
    try {
      let canvas = gameContainerRef.current?.querySelector("canvas");
      if (gameRef.current?.scale && typeof gameRef.current.scale.startFullscreen === 'function') {
        gameRef.current.scale.startFullscreen();
      } else if (canvas?.requestFullscreen) {
        await canvas.requestFullscreen();
      } else if ((canvas as any)?.webkitRequestFullscreen) {
        (canvas as any).webkitRequestFullscreen();
      } else {
        toast.error("Fullscreen not supported on this device.");
      }
    } catch (e) {
      toast.error("Failed to enter fullscreen.");
    } finally {
      setFullscreenLoading(false);
    }
  };

  // Loading state
  if (profileLoading) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center bg-black">
        <h1 className="text-2xl font-orbitron text-white animate-pulse">Loading Profile...</h1>
      </div>
    );
  }

  // Main render
  return (
    <div className="w-full min-h-screen flex flex-col items-center justify-center bg-black relative">
      {/* Top Bar */}
      <div className="flex flex-row items-center justify-between mt-8 mb-4 px-6 py-3 rounded-lg bg-gradient-to-r from-[#332e6c] to-[#191a2d] shadow-lg"
        style={{ width: GAME_WIDTH, minWidth: 320, maxWidth: GAME_WIDTH }}>
        <div className="text-lg font-extrabold text-orange-400 tracking-wide font-orbitron drop-shadow">WackAWegen</div>
        <button
          onClick={handleFullscreen}
          title="Fullscreen"
          className="focus:outline-none bg-transparent"
          style={{ width: 32, height: 32, padding: 0 }}
          disabled={fullscreenLoading}
        >
          <img src="/WackAWegenAssets/fullscreen.png" alt="Fullscreen" style={{ width: 32, height: 32, filter: "drop-shadow(0 0 8px #FFD700)" }} />
        </button>
      </div>
      {/* Game Container */}
      <div
        ref={gameContainerRef}
        id="phaser-container"
        style={{
          width: "100vw",
          maxWidth: GAME_WIDTH,
          height: `calc(100vw * ${GAME_HEIGHT / GAME_WIDTH})`,
          maxHeight: GAME_HEIGHT,
          background: "linear-gradient(135deg, #23243a 0%, #302d6c 100%)",
          borderRadius: 24,
          overflow: "hidden",
          boxShadow: "0 8px 48px #000a",
          margin: "0 auto",
          position: "relative",
          zIndex: 1,
          aspectRatio: `${GAME_WIDTH} / ${GAME_HEIGHT}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "calc(100vh - 240px)", // Ensures vertical centering and padding in windowed mode
        }}
      >
        {fullscreenLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-60 z-50">
            <div className="w-12 h-12 border-4 border-t-transparent border-yellow-400 border-solid rounded-full animate-spin" />
          </div>
        )}
      </div>
      {/* ArcadeInitModal */}
      {showInitModal && (
        <ArcadeInitModal
          isOpen={showInitModal}
          gameId={GAME_ID}
          category={GAME_CATEGORY}
          ticketPriceSol={TICKET_PRICE_SOL}
          destinationWallet={PLATFORM_WALLET}
          onSuccess={result => {
            setShowInitModal(false);
            setShowInstructions(true);
            if (result?.paid || result?.txSig) {
              setPaid(true);
              setUseFreeTokenIntent(false);
            } else if (result?.useArcadeFreeEntry) {
              setPaid(false);
              setUseFreeTokenIntent(true);
            }
          }}
          onError={msg => {
            setShowInitModal(false);
            toast.error("Arcade initiation failed: " + msg);
          }}
          onClose={() => setShowInitModal(false)}
        />
      )}
      {/* Instructions Carousel Overlay */}
      {showInstructions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-90 transition animate-fade-in">
          <div className="w-full max-w-2xl mx-auto p-8 rounded-2xl bg-gradient-to-br from-[#332e6c] to-[#191a2d] shadow-2xl flex flex-col items-center border-4 border-yellow-400">
            <h2 className="text-3xl font-extrabold mb-4 text-yellow-300 text-center font-orbitron tracking-wide">
              WackAWegen Instructions
            </h2>
            <div className="w-full flex flex-col items-center">
              <img
                src={INSTRUCTION_SLIDES[slide].image}
                alt={INSTRUCTION_SLIDES[slide].title}
                style={{ width: "320px", borderRadius: 18, marginBottom: 16, boxShadow: "0 2px 24px #0008" }}
              />
              <div className="mb-4 text-lg text-white font-bold text-center drop-shadow">{INSTRUCTION_SLIDES[slide].title}</div>
              <div className="mb-8 text-base text-gray-300 text-center max-w-xl whitespace-pre-line">{INSTRUCTION_SLIDES[slide].text}</div>
              <div className="flex flex-row gap-4 mb-6">
                <button
                  className={`px-4 py-2 rounded bg-gray-700 text-gray-200 font-bold transition ${slide === 0 ? "opacity-40 cursor-not-allowed" : "hover:bg-gray-600"}`}
                  onClick={() => setSlide((prev) => Math.max(prev - 1, 0))}
                  disabled={slide === 0}
                >
                  ◀ Prev
                </button>
                <button
                  className={`px-4 py-2 rounded bg-gray-700 text-gray-200 font-bold transition ${slide === INSTRUCTION_SLIDES.length - 1 ? "opacity-40 cursor-not-allowed" : "hover:bg-gray-600"}`}
                  onClick={() => setSlide((prev) => Math.min(prev + 1, INSTRUCTION_SLIDES.length - 1))}
                  disabled={slide === INSTRUCTION_SLIDES.length - 1}
                >
                  Next ▶
                </button>
              </div>
            </div>
            {tokenError && (
              <div className="w-full rounded py-2 px-3 mb-3 text-center text-red-200 text-xs bg-red-800 font-semibold shadow">
                {tokenError}
              </div>
            )}
            <button
              className="w-full py-4 rounded-lg bg-gradient-to-r from-green-500 to-lime-500 text-white text-xl font-bold shadow-lg hover:scale-105 transition-transform"
              onClick={handleInstructionsDone}
            >
              Start Game
            </button>
          </div>
        </div>
      )}
      {/* Game Over Modal */}
      {gameState === 'GAME_OVER' && profile && (
        <ArcadeGameOverModal
          score={finalScore!}
          coinsEarned={coinsEarned}
          profile={profile}
          onRestart={restartGame}
          onGoToProfile={() => navigate("/profile")}
          onGoToLeaderboards={() => navigate("/leaderboards")}
        />
      )}
    </div>
  );
}