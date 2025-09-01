import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import Phaser from "phaser";
import ArcadeGameOverModal from "../../../games/Arcade/ArcadeGameOverModal";
import ArcadeInitModal from "../../../games/Arcade/ArcadeInitModal";
import { useProfile } from "../../../context/ProfileContext";
import { saveWackAWegenScore } from "../../../firebase/gamescores";
import { WackAWegenScene } from "./WackAWegenScene";
import { api } from '../../../services/api';
import { getArcadeFreeEntryTokens } from "../../../utilities/token";

const GAME_WIDTH = 1050;
const GAME_HEIGHT = 700;
const GAME_ID = "wackawegen";
const GAME_CATEGORY = "Arcade";
const TICKET_PRICE_SOL = 0.005;
const PLATFORM_WALLET = "4TA49YPJRYbQF5riagHj3DSzDeMek9fHnXChQpgnKkzy";

export default function WackAWegen() {
  const gameRef = useRef<Phaser.Game | null>(null);
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const { profile, loading: profileLoading, firebaseAuthToken, refreshProfile } = useProfile();
  const navigate = useNavigate();
  const location = useLocation();

  // Extract entry type from navigation (paid or free)
  const { txSig, useArcadeFreeEntry, paid } = (location.state || {}) as { txSig?: string; useArcadeFreeEntry?: boolean; paid?: boolean };

  const [showInitModal, setShowInitModal] = useState(!txSig && !useArcadeFreeEntry);
  const [gameStarted, setGameStarted] = useState(false);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [coinsEarned, setCoinsEarned] = useState<number>(0);
  const [gameState, setGameState] = useState<'IDLE'|'PAYING'|'PLAYING'|'GAME_OVER'>('IDLE');
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Arcade free token consumption, handled by Phaser callback
const handleConsumeFreeToken = async () => {
  // Only attempt to consume if (useArcadeFreeEntry && !paid)
  if (!useArcadeFreeEntry || paid) {
    return true; // No consumption needed, just start game
  }
  const tokens = getArcadeFreeEntryTokens(profile);
  if (tokens <= 0) {
    setTokenError("You have no Arcade Free Entry Tokens to consume.");
    toast.error("No arcade tokens available to consume.");
    return false;
  }
  try {
    await api.post(
      "/tokens/consume",
      { tokenType: "arcade" },
      { headers: { Authorization: `Bearer ${firebaseAuthToken}` } }
    );
    toast.success("Arcade Free Entry Token consumed!");
    await refreshProfile();
    return true;
  } catch (err: any) {
    setTokenError("Could not consume Arcade Free Entry Token. Please try again.");
    toast.error(tokenError || "Failed to consume Arcade Free Entry Token.");
    return false;
  }
};

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

  // Phaser mount: only after modal is closed and txSig/useArcadeFreeEntry is set
  useEffect(() => {
    if (showInitModal || !profile || !gameContainerRef.current || gameStarted) return;
    if (gameRef.current) { gameRef.current.destroy(true); gameRef.current = null; }
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: gameContainerRef.current,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
      backgroundColor: "#000000",
      scene: [WackAWegenScene],
    };
    const game = new Phaser.Game(config);
    gameRef.current = game;
    game.scene.start("WackAWegenScene", {
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      onGameOver: handleGameOver,
      skipInstructions: false,
      txSig: txSig,
      shouldConsumeFreeToken: useArcadeFreeEntry ? true : false,
      paid: paid,
      onConsumeFreeToken: handleConsumeFreeToken,
      onReadyToStartGame: () => setGameStarted(true),
    });
    // Cleanup
    return () => { if (gameRef.current) { gameRef.current.destroy(true); gameRef.current = null; } };
  // eslint-disable-next-line
  }, [showInitModal, profile, txSig, useArcadeFreeEntry, paid]);

  // ArcadeInitModal handlers
  const handleInitSuccess = async (result: { txSig?: string; useArcadeFreeEntry?: boolean; paid?: boolean }) => {
    setShowInitModal(false);
    setGameState('PLAYING');
    // If paid, update backend stats
    if (result.txSig) {
      try {
        await fetch("http://localhost:4000/api/platform/update-pot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gameId: GAME_ID,
            category: GAME_CATEGORY,
            amount: TICKET_PRICE_SOL,
            txSig: result.txSig
          }),
        });
      } catch (err) {
        toast.error("Failed to update platform stats!");
      }
    }
    // Navigation state is not required; stay on page
  };

  const handleInitError = (msg: string) => {
    toast.error(msg);
    setShowInitModal(false);
    setGameState('IDLE');
  };

  const restartGame = () => {
    setFinalScore(null);
    setCoinsEarned(0);
    setGameStarted(false);
    setGameState('IDLE');
    setShowInitModal(true);
  };

  // Fullscreen handler
  const handleFullscreen = () => {
    const canvas = gameContainerRef.current?.querySelector("canvas");
    if (canvas) {
      if (canvas.requestFullscreen) {
        canvas.requestFullscreen();
      } else if ((canvas as any).webkitRequestFullscreen) {
        (canvas as any).webkitRequestFullscreen();
      } else {
        toast.error("Fullscreen not supported.");
      }
    } else {
      toast.error("No game canvas found!");
    }
  };

  if (profileLoading) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center bg-black">
        <h1 className="text-2xl font-orbitron text-white animate-pulse">Loading Profile...</h1>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen flex flex-col items-center justify-start bg-black relative">
      {/* Top Bar */}
      <div className="flex flex-row items-center justify-between mt-8 mb-4 px-6 py-3 rounded-lg bg-zinc-900 bg-opacity-80 shadow-lg"
        style={{ width: GAME_WIDTH, minWidth: 320, maxWidth: GAME_WIDTH }}>
        <div className="text-lg font-bold text-orange-400">WackAWegen</div>
        <button
          onClick={handleFullscreen}
          title="Fullscreen"
          className="focus:outline-none"
          style={{ width: 32, height: 32, background: "none", padding: 0 }}
        >
          <img src="/WackAWegenAssets/fullscreen.png" alt="Fullscreen" style={{ width: 32, height: 32 }} />
        </button>
      </div>
      {/* Game Container (Phaser mounts here after modal) */}
      <div
        ref={gameContainerRef}
        id="phaser-container"
        style={{
          width: "100vw",
          maxWidth: GAME_WIDTH,
          height: `calc(100vw * ${GAME_HEIGHT / GAME_WIDTH})`,
          maxHeight: GAME_HEIGHT,
          background: "#222",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 4px 32px #000a",
          margin: "0 auto",
          position: "relative",
          zIndex: 1,
          aspectRatio: `${GAME_WIDTH} / ${GAME_HEIGHT}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      />
      {/* ArcadeInitModal for pay-to-play */}
      {showInitModal && (
        <ArcadeInitModal
          gameId={GAME_ID}
          category={GAME_CATEGORY}
          ticketPriceSol={TICKET_PRICE_SOL}
          destinationWallet={PLATFORM_WALLET}
          onSuccess={handleInitSuccess}
          onError={handleInitError}
          onClose={() => setShowInitModal(false)}
        />
      )}
      {/* Show error if token consumption fails */}
      {tokenError && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 bg-red-800 text-white px-6 py-3 rounded-lg shadow-lg z-50 font-bold">
          {tokenError}
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