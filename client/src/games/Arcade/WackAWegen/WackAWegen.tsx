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

  // Entry config (from navigation)
  const { txSig, useArcadeFreeEntry, paid } = (location.state || {}) as { txSig?: string; useArcadeFreeEntry?: boolean; paid?: boolean };

  // State for flow
  const [showInitModal, setShowInitModal] = useState(!txSig && !useArcadeFreeEntry);
  const [showInstructions, setShowInstructions] = useState(false);
  const [shouldStartGame, setShouldStartGame] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [coinsEarned, setCoinsEarned] = useState<number>(0);
  const [gameState, setGameState] = useState<'IDLE'|'PAYING'|'PLAYING'|'GAME_OVER'>('IDLE');
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Step 1: ArcadeInitModal (payment/free entry)
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
    setShowInstructions(true);
  };

  const handleInitError = (msg: string) => {
    toast.error(msg);
    setShowInitModal(false);
    setGameState('IDLE');
  };

  // Step 2: Instructions overlay
  const handleInstructionsDone = async () => {
    setTokenError(null); // clear any previous error
    // If free entry, consume token
    if (useArcadeFreeEntry && !paid) {
      const tokens = getArcadeFreeEntryTokens(profile);
      if (tokens <= 0) {
        setTokenError("You have no Arcade Free Entry Tokens to consume.");
        toast.error("No arcade tokens available to consume.");
        return;
      }
      try {
        await api.post(
          "/tokens/consume",
          { tokenType: "arcade" },
          { headers: { Authorization: `Bearer ${firebaseAuthToken}` } }
        );
        toast.success("Arcade Free Entry Token consumed!");
        await refreshProfile();
      } catch (err: any) {
        setTokenError("Could not consume Arcade Free Entry Token. Please try again.");
        toast.error(tokenError || "Failed to consume Arcade Free Entry Token.");
        return;
      }
    }
    setShowInstructions(false);
    setShouldStartGame(true);
  };

  // Step 3: Mount Phaser only when shouldStartGame
  useEffect(() => {
    if (!shouldStartGame || !profile || !gameContainerRef.current || gameStarted) return;
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
      txSig,
      paid,
      skipInstructions: true, // always skip, parent shows instructions
      onGameOver: handleGameOver,
      onReadyToStartGame: () => setGameStarted(true),
    });
    return () => { if (gameRef.current) { gameRef.current.destroy(true); gameRef.current = null; } };
    // eslint-disable-next-line
  }, [shouldStartGame, profile, txSig, paid, gameStarted]);

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

  const restartGame = () => {
    setFinalScore(null);
    setCoinsEarned(0);
    setGameStarted(false);
    setGameState('IDLE');
    setShowInitModal(true);
    setShowInstructions(false);
    setShouldStartGame(false);
    setTokenError(null);
  };

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
      {/* Game Container (Phaser mounts here after everything is ready) */}
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
      {/* Game Instructions (parent controlled) */}
      {showInstructions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-90">
          <div className="w-full max-w-2xl mx-auto p-8 rounded-2xl bg-zinc-900 shadow-2xl flex flex-col items-center">
            <h2 className="text-3xl font-extrabold mb-4 text-yellow-300 text-center font-orbitron">WackAWegen Instructions</h2>
            <ul className="space-y-4 mb-4 text-lg text-white font-medium">
              <li>Power-Ups & Penalties: Bombs lose time, Clock gains time, Mystery is random, Golden Wegen gives big points!</li>
              <li>Scoring & Combos: Normal 10pts, Fast 25pts, Tanky 50pts (3 hits), Golden 150pts, Hit fast for COMBOS!</li>
              <li>Pro Tips: Chain hits for combos, Avoid near misses, Time bonuses get harder, Watch for patterns!</li>
            </ul>
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