// DegenFighter.tsx — React wrapper for the PvP DegenFighter Phaser scene
import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Phaser from 'phaser';
import { toast } from 'react-toastify';
import { useProfile } from '../../../context/ProfileContext';
import { saveGameResult } from '../../../firebase/gameScores';
import { apiService } from '../../../services/api';
import { DegenFighterScene, FighterConfig } from './DegenFighterScene';
import { claimPvpPayout } from '../pvpTransaction';
import { socket } from '../../../socket';

const GAME_W = 960;
const GAME_H = 540;
const GAME_ID = 'degen-fighter';
const GAME_CATEGORY = 'pvp' as const;

type UIState = 'mode-select' | 'pvp-lobby' | 'playing' | 'done';

export default function DegenFighter() {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const matchSessionIdRef = useRef<string>(crypto.randomUUID());
  const { profile, refreshProfile } = useProfile();
  const navigate = useNavigate();

  const [uiState, setUiState] = useState<UIState>('mode-select');
  const [result, setResult] = useState<{ won: boolean; score: number; coinsEarned: number } | null>(null);

  // PvP room state
  const [pvpMode, setPvpMode] = useState<'ai' | 'online'>('ai');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomInputValue, setRoomInputValue] = useState('');
  const [pvpStatus, setPvpStatus] = useState<string>('');
  const [opponentInfo, setOpponentInfo] = useState<FighterConfig | null>(null);
  const pvpRoomIdRef = useRef<string | null>(null);

  // ── Socket PvP lifecycle ─────────────────────────────────────────────────────

  useEffect(() => {
    if (pvpMode !== 'online') return;

    // Connect socket for PvP
    if (!socket.connected) socket.connect();

    const handleRoomCreated = ({ roomId: id }: { roomId: string }) => {
      setRoomId(id);
      pvpRoomIdRef.current = id;
      setPvpStatus('Waiting for opponent… share your Room ID.');
    };

    const handleMatchStart = ({
      roomId: id,
      host,
      guest,
    }: {
      roomId: string;
      host: { uid: string; username: string; avatarUrl: string };
      guest: { uid: string; username: string; avatarUrl: string };
    }) => {
      pvpRoomIdRef.current = id;
      setRoomId(id);
      const isHost = host.uid === profile?.wallet;
      const opp = isHost ? guest : host;
      setOpponentInfo({ key: opp.uid, username: opp.username, avatarUrl: opp.avatarUrl, isLocal: false });
      setPvpStatus('Opponent found! Starting match…');
      setTimeout(() => setUiState('playing'), 800);
    };

    const handleOpponentLeft = () => {
      if (uiState === 'pvp-lobby') {
        setPvpStatus('Opponent disconnected from the lobby.');
        setRoomId(null);
        pvpRoomIdRef.current = null;
      }
    };

    const handlePvpError = ({ message }: { message: string }) => {
      toast.error(`PvP: ${message}`);
      setPvpStatus('');
    };

    socket.on('pvp:roomCreated', handleRoomCreated);
    socket.on('pvp:matchStart', handleMatchStart);
    socket.on('pvp:opponentLeft', handleOpponentLeft);
    socket.on('pvp:error', handlePvpError);

    return () => {
      socket.off('pvp:roomCreated', handleRoomCreated);
      socket.off('pvp:matchStart', handleMatchStart);
      socket.off('pvp:opponentLeft', handleOpponentLeft);
      socket.off('pvp:error', handlePvpError);
    };
  }, [pvpMode, profile?.wallet, uiState]);

  // Leave room on unmount if in PvP mode
  useEffect(() => {
    return () => {
      if (pvpRoomIdRef.current) {
        socket.emit('pvp:leaveRoom', { roomId: pvpRoomIdRef.current });
        pvpRoomIdRef.current = null;
      }
    };
  }, []);

  // ── Match end handler ────────────────────────────────────────────────────────

  const handleMatchEnd = useCallback(
    async (res: { won: boolean; score: number; coinsEarned: number }) => {
      setResult(res);
      setUiState('done');
      pvpRoomIdRef.current = null;

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

        try {
          const payoutResult = await claimPvpPayout(matchSessionIdRef.current, res.won, res.score);
          if (payoutResult.won && payoutResult.reward) {
            toast.success(`🏆 ${(payoutResult.reward / 1_000_000_000).toFixed(4)} GGW tokens sent!`);
          } else if (payoutResult.error && payoutResult.error !== 'Payout already claimed for this match session.') {
            toast.warn(`Payout notice: ${payoutResult.error}`);
          }
        } catch {
          // Non-fatal
        }
      }
    },
    [profile, refreshProfile]
  );

  // ── Mount Phaser game ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || gameRef.current || !profile) return;
    if (uiState !== 'playing') return;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: GAME_W,
      height: GAME_H,
      backgroundColor: '#0a0015',
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 300 }, debug: false } },
      scene: [DegenFighterScene],
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;

    const localFighter: FighterConfig = {
      key: profile.wallet,
      username: profile.username || profile.wallet.slice(0, 6),
      avatarUrl: profile.avatarUrl || '/DegenRaceAssets/G1small.png',
      isLocal: true,
    };

    const opponent: FighterConfig = opponentInfo ?? {
      key: 'ai-opponent',
      username: 'Degen Bot',
      avatarUrl: '/DegenRaceAssets/G1small.png',
      isLocal: false,
    };

    game.scene.start('DegenFighterScene', {
      localFighter,
      opponent,
      onMatchEnd: handleMatchEnd,
      ...(pvpMode === 'online' && pvpRoomIdRef.current
        ? { socket, roomId: pvpRoomIdRef.current }
        : {}),
    });

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, [uiState, profile, handleMatchEnd, opponentInfo, pvpMode]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const startAI = () => {
    if (!profile) { toast.error('Connect wallet first.'); return; }
    setPvpMode('ai');
    setOpponentInfo(null);
    setResult(null);
    setUiState('playing');
  };

  const openPvPLobby = () => {
    if (!profile) { toast.error('Connect wallet first.'); return; }
    setPvpMode('online');
    setRoomId(null);
    setRoomInputValue('');
    setPvpStatus('');
    setOpponentInfo(null);
    setUiState('pvp-lobby');
  };

  const createRoom = () => {
    if (!profile) return;
    setPvpStatus('Creating room…');
    socket.emit('pvp:createRoom', { username: profile.username || profile.wallet.slice(0, 6), avatarUrl: profile.avatarUrl });
  };

  const joinRoom = () => {
    const id = roomInputValue.trim();
    if (!id) { toast.error('Enter a Room ID.'); return; }
    if (!profile) return;
    setPvpStatus('Joining room…');
    socket.emit('pvp:joinRoom', { roomId: id, username: profile.username || profile.wallet.slice(0, 6), avatarUrl: profile.avatarUrl });
  };

  const playAgain = () => {
    if (gameRef.current) { gameRef.current.destroy(true); gameRef.current = null; }
    setResult(null);
    setOpponentInfo(null);
    setPvpMode('ai');
    setRoomId(null);
    pvpRoomIdRef.current = null;
    matchSessionIdRef.current = crypto.randomUUID();
    setUiState('mode-select');
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center min-h-screen bg-black text-white font-mono">
      {/* Header */}
      <div className="w-full flex items-center justify-between px-6 py-4 border-b border-red-900/40">
        <button
          onClick={() => { if (pvpRoomIdRef.current) socket.emit('pvp:leaveRoom', { roomId: pvpRoomIdRef.current }); navigate('/games'); }}
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

      {/* Mode select */}
      {uiState === 'mode-select' && (
        <div className="flex flex-col items-center justify-center flex-1 gap-6 px-4">
          <h1 className="text-4xl font-bold text-red-400">⚔ DegenFighter</h1>
          <p className="text-gray-400 text-sm">Use arrow keys to move, Z to attack, X for special.</p>
          <div className="grid grid-cols-2 gap-4 w-full max-w-sm">
            <button
              onClick={startAI}
              className="bg-gray-800 hover:bg-gray-700 border border-gray-600 text-white font-bold py-6 rounded-xl transition flex flex-col items-center gap-2"
            >
              <span className="text-3xl">🤖</span>
              <span>vs AI</span>
              <span className="text-xs text-gray-400">Solo practice</span>
            </button>
            <button
              onClick={openPvPLobby}
              className="bg-red-900 hover:bg-red-800 border border-red-600 text-white font-bold py-6 rounded-xl transition flex flex-col items-center gap-2"
            >
              <span className="text-3xl">⚔</span>
              <span>vs Player</span>
              <span className="text-xs text-red-300">Online PvP</span>
            </button>
          </div>
        </div>
      )}

      {/* PvP lobby */}
      {uiState === 'pvp-lobby' && (
        <div className="flex flex-col items-center justify-center flex-1 gap-6 px-4 w-full max-w-md">
          <h2 className="text-2xl font-bold text-red-400">Online PvP Lobby</h2>

          {!roomId ? (
            <>
              <button
                onClick={createRoom}
                className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 rounded-lg transition"
              >
                ➕ Create Room
              </button>
              <div className="w-full text-center text-gray-500 text-sm">— or —</div>
              <div className="w-full flex gap-2">
                <input
                  type="text"
                  value={roomInputValue}
                  onChange={(e) => setRoomInputValue(e.target.value)}
                  placeholder="Enter Room ID…"
                  className="flex-1 bg-gray-900 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500"
                />
                <button
                  onClick={joinRoom}
                  className="bg-gray-700 hover:bg-gray-600 text-white font-bold px-4 py-2 rounded-lg transition"
                >
                  Join
                </button>
              </div>
            </>
          ) : (
            <div className="w-full bg-gray-900 border border-red-900/50 rounded-xl p-6 text-center">
              <p className="text-sm text-gray-400 mb-2">Share this Room ID with your opponent:</p>
              <div
                className="text-xl font-bold text-red-300 bg-black/50 rounded px-4 py-3 cursor-pointer select-all mb-2"
                onClick={() => { navigator.clipboard.writeText(roomId); toast.success('Copied!'); }}
              >
                {roomId}
              </div>
              <p className="text-xs text-gray-500">Click to copy</p>
            </div>
          )}

          {pvpStatus && (
            <p className="text-sm text-yellow-400 text-center animate-pulse">{pvpStatus}</p>
          )}

          <button
            onClick={() => { if (pvpRoomIdRef.current) socket.emit('pvp:leaveRoom', { roomId: pvpRoomIdRef.current }); setUiState('mode-select'); setRoomId(null); pvpRoomIdRef.current = null; }}
            className="text-sm text-gray-500 hover:text-gray-300 transition"
          >
            ← Back
          </button>
        </div>
      )}

      {/* Game canvas */}
      {uiState === 'playing' && (
        <div ref={containerRef} className="w-full max-w-5xl mt-4" style={{ aspectRatio: '16/9' }} />
      )}

      {/* Game over */}
      {uiState === 'done' && result && (
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
              <button onClick={playAgain} className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2 rounded-lg transition">
                Play Again
              </button>
              <button onClick={() => navigate('/games')} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg transition">
                Games
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
