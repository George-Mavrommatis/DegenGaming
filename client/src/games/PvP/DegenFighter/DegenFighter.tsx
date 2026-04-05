// DegenFighter.tsx — React wrapper for the PvP DegenFighter Phaser scene
import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Phaser from 'phaser';
import { toast } from 'react-toastify';
import { useProfile } from '../../../context/ProfileContext';
import { saveGameResult } from '../../../firebase/gameScores';
import { apiService } from '../../../services/api';
import { DegenFighterScene } from './DegenFighterScene';
import { claimPvpPayout } from '../pvpTransaction';

const GAME_W = 960;
const GAME_H = 540;
const GAME_ID = 'degen-fighter';
const GAME_CATEGORY = 'pvp' as const;

export default function DegenFighter() {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const matchSessionIdRef = useRef<string>(crypto.randomUUID());
  const { profile, refreshProfile } = useProfile();
  const navigate = useNavigate();

  const [gameState, setGameState] = useState<'idle' | 'playing' | 'done'>('idle');
  const [result, setResult] = useState<{ won: boolean; score: number; coinsEarned: number } | null>(null);

  const handleMatchEnd = useCallback(
    async (res: { won: boolean; score: number; coinsEarned: number }) => {
      setResult(res);
      setGameState('done');

      if (profile) {
        try {
          await saveGameResult(profile, {
            gameId: GAME_ID,
            gameName: 'DegenFighter',
            category: GAME_CATEGORY,
            score: res.score,
            coinsEarned: res.coinsEarned,
            won: res.won,
          });
          await apiService.incrementGamesPlayed(GAME_ID, GAME_CATEGORY);
          await refreshProfile();
          toast.success(`Match saved — ${res.score} pts, ${res.coinsEarned} coins!`);
        } catch (err) {
          console.error('[DegenFighter] Failed to save match result:', err);
          toast.error('Could not save match result.');
        }

        // Claim GGW token payout (winners) or record session (losers)
        try {
          const payoutResult = await claimPvpPayout(matchSessionIdRef.current, res.won, res.score);
          if (payoutResult.won && payoutResult.reward) {
            const rewardDisplay = payoutResult.reward / 1_000_000_000;
            toast.success(`🏆 ${rewardDisplay} GGW tokens sent to your wallet!`);
          } else if (payoutResult.error && payoutResult.error !== 'Payout already claimed for this match session.') {
            toast.warn(`Payout notice: ${payoutResult.error}`);
          }
        } catch {
          // Non-fatal: payout failure should not break the game over flow
        }
      }
    },
    [profile, refreshProfile]
  );

  // Mount Phaser game
  useEffect(() => {
    if (!containerRef.current || gameRef.current || !profile) return;
    if (gameState !== 'playing') return;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: GAME_W,
      height: GAME_H,
      backgroundColor: '#0a0015',
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      physics: {
        default: 'arcade',
        arcade: { gravity: { x: 0, y: 300 }, debug: false },
      },
      scene: [DegenFighterScene],
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;

    game.scene.start('DegenFighterScene', {
      localFighter: {
        key: profile.wallet,
        username: profile.username || profile.wallet.slice(0, 6),
        avatarUrl: profile.avatarUrl || '/DegenRaceAssets/G1small.png',
        isLocal: true,
      },
      // Opponent: solo AI for now — will be replaced by Socket.IO matchmaking
      opponent: {
        key: 'ai-opponent',
        username: 'Degen Bot',
        avatarUrl: '/DegenRaceAssets/G1small.png',
        isLocal: false,
      },
      onMatchEnd: handleMatchEnd,
    });

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, [gameState, profile, handleMatchEnd]);

  const startGame = () => {
    if (!profile) {
      toast.error('Please connect your wallet first.');
      return;
    }
    setResult(null);
    setGameState('playing');
  };

  const playAgain = () => {
    if (gameRef.current) {
      gameRef.current.destroy(true);
      gameRef.current = null;
    }
    setResult(null);
    setGameState('playing');
    // Fresh session ID so each replay can claim its own payout
    matchSessionIdRef.current = crypto.randomUUID();
  };

  return (
    <div className="flex flex-col items-center min-h-screen bg-black text-white font-mono">
      {/* Header */}
      <div className="w-full flex items-center justify-between px-6 py-4 border-b border-red-900/40">
        <button
          onClick={() => navigate('/games')}
          className="text-sm text-red-400 hover:text-red-200 transition"
        >
          ← Back to Games
        </button>
        <img
          src="/DegenFighterAssets/DegenFighterII_Logo_Full.png"
          alt="DegenFighter"
          className="h-10 object-contain"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
        <span className="text-sm text-gray-500">PvP Arena</span>
      </div>

      {/* Game area */}
      {gameState === 'idle' && (
        <div className="flex flex-col items-center justify-center flex-1 gap-6 px-4">
          <div className="text-center max-w-md">
            <h1 className="text-4xl font-bold text-red-400 mb-2">⚔ DegenFighter</h1>
            <p className="text-gray-400 text-sm mb-4">
              1v1 battle arena — fight your way to the top. Use arrow keys to move, Z to attack, X for special.
            </p>
            <div className="bg-gray-900 border border-red-900/50 rounded-lg p-4 text-left text-sm text-gray-300 mb-6 space-y-1">
              <div>← → Move</div>
              <div>↑ Jump</div>
              <div>Z Normal attack</div>
              <div>X Special attack (3s cooldown)</div>
              <div className="text-yellow-400 mt-2">Chain hits for combo bonuses!</div>
            </div>
            <button
              onClick={startGame}
              className="bg-red-600 hover:bg-red-500 text-white font-bold px-10 py-3 rounded-lg text-lg transition shadow-lg shadow-red-900/40"
            >
              ⚔ Enter Arena
            </button>
          </div>
        </div>
      )}

      {gameState === 'playing' && (
        <div
          ref={containerRef}
          className="w-full max-w-5xl mt-4"
          style={{ aspectRatio: '16/9' }}
        />
      )}

      {gameState === 'done' && result && (
        <div className="flex flex-col items-center justify-center flex-1 gap-6">
          <div className="bg-gray-900 border border-red-700/40 rounded-2xl p-8 max-w-sm text-center shadow-2xl">
            <div className="text-5xl mb-3">{result.won ? '🏆' : '💀'}</div>
            <h2 className="text-3xl font-bold mb-1" style={{ color: result.won ? '#ffe36d' : '#ff4444' }}>
              {result.won ? 'Victory!' : 'Defeated'}
            </h2>
            <p className="text-gray-400 text-sm mb-4">
              {result.won ? 'You crushed your opponent!' : 'Better luck next time, degen.'}
            </p>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-black/50 rounded-lg p-3">
                <div className="text-2xl font-bold text-white">{result.score}</div>
                <div className="text-xs text-gray-500">Score</div>
              </div>
              <div className="bg-black/50 rounded-lg p-3">
                <div className="text-2xl font-bold text-yellow-400">{result.coinsEarned}</div>
                <div className="text-xs text-gray-500">GG Coins</div>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={playAgain}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2 rounded-lg transition"
              >
                Play Again
              </button>
              <button
                onClick={() => navigate('/games')}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg transition"
              >
                Games
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
