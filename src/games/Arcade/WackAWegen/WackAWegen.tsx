import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import Phaser from "phaser";
import ArcadeGameOverModal from "../../../games/Arcade/ArcadeGameOverModal";
import ArcadeInitModal from "../../../games/Arcade/ArcadeInitModal";
import { useProfile } from "../../../context/ProfileContext";
import { saveWackAWegenScore } from "../../../firebase/gamescores";
import { WackAWegenScene } from "./WackAWegenScene";

const GAME_WIDTH = 1050;
const GAME_HEIGHT = 700;

// Configs for game/payment
const GAME_ID = "wackawegen";
const GAME_CATEGORY = "Arcade";
const TICKET_PRICE_SOL = 0.005;
const PLATFORM_WALLET = "4TA49YPJRYbQF5riagHj3DSzDeMek9fHnXChQpgnKkzy";

export default function WackAWegen() {
  const gameRef = useRef<Phaser.Game | null>(null);
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const { profile, loading: profileLoading } = useProfile();
  const navigate = useNavigate();

  const [gameState, setGameState] = useState<'IDLE' | 'PAYING' | 'PLAYING' | 'GAME_OVER'>('IDLE');
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [coinsEarned, setCoinsEarned] = useState<number>(0);
  const [showInitModal, setShowInitModal] = useState(true);
  const [lastTxSig, setLastTxSig] = useState<string | null>(null);

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

  const startGame = useCallback((txSigOverride?: string) => {
    if (!profile || !gameContainerRef.current) return;
    if (gameRef.current) {
      gameRef.current.destroy(true);
      gameRef.current = null;
    }
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: gameContainerRef.current,
      width: '100%',
      height: '100%',
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
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
      txSig: txSigOverride ?? lastTxSig,
    });
  }, [profile, handleGameOver, lastTxSig]);

  // Payment Success Handler
  const handleInitSuccess = async (txSig: string) => {
    setLastTxSig(txSig);
    setShowInitModal(false);
    setGameState('PLAYING');
    // Update platform stats!
    try {
      await fetch("http://localhost:4000/api/platform/update-pot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId: GAME_ID,
          category: GAME_CATEGORY,
          amount: TICKET_PRICE_SOL,
          txSig
        }),
      });
    } catch (err) {
      toast.error("Failed to update platform stats!");
    }
    startGame(txSig);
  };

  const handleInitError = (msg: string) => {
    toast.error(msg);
    setShowInitModal(false);
    setGameState('IDLE');
  };

  const restartGame = () => {
    setFinalScore(null);
    setCoinsEarned(0);
    setGameState('IDLE');
    setShowInitModal(true);
    setLastTxSig(null);
  };

  // Fullscreen handler with fallback
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
      <div
        className="flex flex-row items-center justify-between mt-8 mb-4 px-6 py-3 rounded-lg bg-zinc-900 bg-opacity-80 shadow-lg"
        style={{
          width: GAME_WIDTH,
          minWidth: 320,
          maxWidth: GAME_WIDTH,
        }}
      >
        <div className="text-lg font-bold text-orange-400">WackAWegen</div>
        <button
          onClick={handleFullscreen}
          title="Fullscreen"
          className="focus:outline-none"
          style={{ width: 32, height: 32, background: "none", padding: 0 }}
        >
          <img
            src="/WackAWegenAssets/fullscreen.png"
            alt="Fullscreen"
            style={{ width: 32, height: 32 }}
          />
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
      {/* Overlay Screens */}
      {gameState === 'PAYING' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-80 text-white z-10">
          <h2 className="text-3xl font-orbitron animate-pulse">Processing Transaction...</h2>
          <p className="mt-4">Please approve the transaction in your wallet.</p>
        </div>
      )}
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
