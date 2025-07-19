// src/pages/games/wegenRace.tsx

import React, { useRef, useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
    createWegenRaceGame,
    getWegenRaceScene,
    destroyWegenRaceGame,
    Player,
    GameState,
    GameEvent,
    enableDebugMode
} from '../../../games/Picker/WegenRace/wegenRaceGame';
import GameOverModal from "../../Picker/PickerGameOverModal";
import "./wegenrace.css";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import { toast } from "react-toastify";

// --- Types ---
interface WegenRaceConfig {
    players: Player[];
    duration: number;
    humanChoice: Player;
    betAmount?: number;
    currency?: string;
    paymentSignature?: string;
    gameId?: string;
    gameTitle?: string;
    authToken?: string;
    gameEntryTokenId?: string;
}

type WegenRaceState = GameState & {
    raceEndTime?: number | null;
    leaderboard?: Player[];
};

const auth = getAuth();

export default function WegenRace() {
    const location = useLocation();
    const navigate = useNavigate();

    const [showGameOverModal, setShowGameOverModal] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState("Loading game...");
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');

    const [loadedGameConfig, setLoadedGameConfig] = useState<WegenRaceConfig | null>(null);
    const [isSessionAuthenticated, setIsSessionAuthenticated] = useState(false);
    const [isPhaserGameRunning, setIsPhaserGameRunning] = useState(false);

    const [gameState, setGameState] = useState<WegenRaceState>({
        status: 'waiting',
        players: [],
        positions: {},
        raceProgress: 0,
        winner: null,
        raceElapsedTime: 0,
        raceEndTime: null,
        raceDuration: 0,
        currentPhase: 'Initializing',
        timeRemaining: 0,
        leaderboard: [],
        eventLog: []
    });
    const [eventLog, setEventLog] = useState<GameEvent[]>([]);

    const gameContainerRef = useRef<HTMLDivElement>(null);
    const phaserGameRef = useRef<Phaser.Game | null>(null);

    // --- Callbacks passed to Phaser ---
    const handleGameStateChange = useCallback((state: GameState) => {
        setGameState(prevState => ({ 
            ...prevState, 
            status: state.status,
            players: state.players,
            positions: state.positions,
            raceProgress: state.raceProgress,
            raceElapsedTime: state.raceElapsedTime,
            raceDuration: state.raceDuration,
            currentPhase: state.currentPhase,
            timeRemaining: state.timeRemaining,
            winner: state.winner,
            leaderboard: state.rankings || [],
            eventLog: state.eventLog || []
        }));
        setEventLog(state.eventLog || []);
        setConnectionStatus('connected');
    }, []);

    const handleGameEnd = useCallback((winner: Player | null, rankings: Player[]) => {
        console.log("DEBUG: WegenRace.tsx: handleGameEnd callback fired!");
        setGameState(prevState => ({
            ...prevState,
            status: 'finished',
            winner,
            leaderboard: rankings,
            raceEndTime: Date.now()
        }));
        setTimeout(() => {
            console.log("DEBUG: WegenRace.tsx: Setting showGameOverModal to true.");
            setShowGameOverModal(true);
        }, 1500);
    }, []);

    // --- Core Logic Effects ---
    useEffect(() => {
        console.log("DEBUG: WegenRace.tsx: Effect 1 (Load Config) - Component mounted. Checking route state.");
        setLoadingMessage("Validating game configuration...");
        const config: WegenRaceConfig | undefined = (location.state as { gameConfig?: WegenRaceConfig })?.gameConfig;
        
        if (!config) {
            console.error("ERROR: WegenRace.tsx: Effect 1 - No gameConfig found in route state.");
            toast.error("Game configuration not found. Please start the game from the Games page.");
            navigate("/games"); 
            return;
        }
        if (!config.players || config.players.length === 0 || !config.humanChoice || !config.authToken || !config.gameEntryTokenId) {
            console.error("ERROR: WegenRace.tsx: Effect 1 - Validation failed: Incomplete game data.", config);
            toast.error("Invalid game data. Please restart from games page.");
            navigate("/games"); 
            return;
        }
        console.log("DEBUG: WegenRace.tsx: Effect 1 - Valid game configuration loaded:", config);
        setLoadedGameConfig(config);
        setLoadingMessage("Configuration loaded. Authenticating session...");
    }, [location.state, navigate]);

    useEffect(() => {
        console.log(`DEBUG: WegenRace.tsx: Effect 2 (Auth) - LoadedConfig: ${!!loadedGameConfig}, SessionAuthenticated: ${isSessionAuthenticated}`);
        if (!loadedGameConfig || isSessionAuthenticated) {
            return;
        }
        const consumeTokenAndAuth = async () => {
            setLoadingMessage("Verifying game session...");
            try {
                const consumeTokenResponse = await fetch('http://localhost:4000/api/game-sessions/consume-token', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${loadedGameConfig.authToken}`, },
                    body: JSON.stringify({ gameEntryTokenId: loadedGameConfig.gameEntryTokenId }),
                });
                if (!consumeTokenResponse.ok) {
                    const errorData = await consumeTokenResponse.json();
                    throw new Error(errorData.message || 'Failed to consume game entry token.');
                }
                console.log("DEBUG: WegenRace.tsx: Effect 2 - Game entry token consumed successfully.");

                setLoadingMessage("Securing authentication...");
                const customTokenResponse = await fetch('http://localhost:4000/api/auth/exchange-id-for-custom', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${loadedGameConfig.authToken}`, },
                });
                if (!customTokenResponse.ok) {
                    const errorData = await customTokenResponse.json();
                    throw new Error(errorData.message || 'Failed to get custom authentication token from backend.');
                }
                const { customToken } = await customTokenResponse.json();
                console.log("DEBUG: WegenRace.tsx: Effect 2 - Received Firebase custom token.");

                setLoadingMessage("Authenticating user with Firebase...");
                await signInWithCustomToken(auth, customToken);
                console.log("DEBUG: WegenRace.tsx: Effect 2 - Firebase Authentication successful.");
                setIsSessionAuthenticated(true);
                setLoadingMessage("Session authenticated. Initializing game engine...");
            } catch (error: any) {
                console.error("ERROR: WegenRace.tsx: Effect 2 - Game initiation error during token consumption or Firebase auth:", error);
                toast.error(`Access denied: ${error.message}. Please restart from the games page.`);
                navigate("/games"); 
            }
        };
        consumeTokenAndAuth();
    }, [loadedGameConfig, isSessionAuthenticated, navigate]);

    useEffect(() => {
        console.log(`DEBUG: WegenRace.tsx: Effect 3 (Phaser Init) - Conditions: LoadedConfig=${!!loadedGameConfig}, SessionAuthenticated=${isSessionAuthenticated}, PhaserRunning=${isPhaserGameRunning}`);
        if (!loadedGameConfig || !isSessionAuthenticated || isPhaserGameRunning) {
            if (!loadedGameConfig) console.log("DEBUG: WegenRace.tsx: Effect 3 - Skipping Phaser init: game config not yet loaded.");
            if (!isSessionAuthenticated) console.log("DEBUG: WegenRace.tsx: Effect 3 - Skipping Phaser init: session not yet authenticated.");
            if (isPhaserGameRunning) console.log("DEBUG: WegenRace.tsx: Effect 3 - Skipping Phaser init: game is already running.");
            return;
        }

        const gameContainer = gameContainerRef.current;
        if (!gameContainer) {
            console.error("ERROR: WegenRace.tsx: Effect 3 - Game container ref is null. Cannot initialize Phaser.");
            // This error indicates a rendering issue, not a game logic issue
            // We should not proceed with Phaser initialization until the ref is available.
            // No toast.error here as it's an internal component rendering issue.
            setConnectionStatus('disconnected');
            return;
        }

        if (phaserGameRef.current) {
            console.log("DEBUG: WegenRace.tsx: Effect 3 - Destroying previous Phaser instance before re-initialization.");
            destroyWegenRaceGame(phaserGameRef.current);
            phaserGameRef.current = null;
        }

        try {
            gameContainer.innerHTML = '';
            console.log("DEBUG: WegenRace.tsx: Effect 3 - Creating new Phaser game instance.");
            const game = createWegenRaceGame(gameContainer);
            phaserGameRef.current = game;

            game.events.once(Phaser.Core.EVENT_READY, () => {
                const scene = getWegenRaceScene(game);
                if (!scene) {
                    console.error("ERROR: WegenRace.tsx: Effect 3 - WegenRaceScene not found after game 'ready' event.");
                    toast.error("Game engine error: Core scene not found.");
                    setConnectionStatus('disconnected');
                    return;
                }
                scene.events.once('create', () => {
                    console.log("DEBUG: WegenRace.tsx: Effect 3 - WegenRaceScene 'create' event fired. Attaching listeners and initializing race.");
                    enableDebugMode(game); 
                    scene.onStateChange(handleGameStateChange);
                    scene.onGameEnd(handleGameEnd);
                    scene.initializeRaceWithData( loadedGameConfig.players, loadedGameConfig.duration, loadedGameConfig.humanChoice );
                    scene.startRaceExternally();
                    setConnectionStatus('connected');
                    setIsPhaserGameRunning(true);
                    setLoadingMessage("Game is running!");
                    console.log("DEBUG: WegenRace.tsx: Effect 3 - Game fully initialized and running.");
                });
            });
        } catch (e: any) {
            console.error("ERROR: WegenRace.tsx: Effect 3 - Error initializing Phaser game:", e);
            toast.error(`Failed to start game engine: ${e.message || "Unknown error."}`);
            setConnectionStatus('disconnected');
            setIsPhaserGameRunning(false);
        }

        return () => {
            if (phaserGameRef.current) {
                console.log("DEBUG: WegenRace.tsx: Effect 3 Cleanup - Destroying Phaser instance on component unmount or re-render.");
                destroyWegenRaceGame(phaserGameRef.current);
                phaserGameRef.current = null;
            }
            setIsPhaserGameRunning(false);
            setLoadedGameConfig(null);
            setIsSessionAuthenticated(false);
            setGameState({
                status: 'waiting', players: [], positions: {}, raceProgress: 0, winner: null,
                raceElapsedTime: 0, raceDuration: 0, currentPhase: 'Initializing',
                timeRemaining: 0, leaderboard: [], eventLog: []
            });
            setEventLog([]);
        };
    }, [loadedGameConfig, isSessionAuthenticated, isPhaserGameRunning, handleGameStateChange, handleGameEnd]); // Added handleGameStateChange and handleGameEnd to dependencies

    // --- UI and Control Handlers ---
    const handleBackToGames = useCallback(() => {
        if (phaserGameRef.current) {
            console.log("DEBUG: WegenRace.tsx: handleBackToGames - Destroying Phaser game instance.");
            destroyWegenRaceGame(phaserGameRef.current);
            phaserGameRef.current = null;
        }
        navigate("/games");
    }, [navigate]);

    const handlePlayAgain = useCallback(() => {
        handleBackToGames(); 
    }, [handleBackToGames]);

    const toggleFullscreen = useCallback(() => {
        const element = document.documentElement;
        if (!isFullscreen) { /* ... */ } else { /* ... */ }
    }, [isFullscreen]);

    useEffect(() => {
        const handleFullscreenChange = () => { setIsFullscreen(!!document.fullscreenElement); };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.addEventListener('mozfullscreenchange', handleFullscreenChange);
        document.addEventListener('MSFullscreenChange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
            document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
            document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
        };
    }, []);

    const formatTimeRemaining = useCallback(() => {
        if (typeof gameState.timeRemaining !== 'number' || isNaN(gameState.timeRemaining)) return "Loading...";
        const seconds = Math.ceil(gameState.timeRemaining / 1000);
        if (seconds <= 0) { return "Race Over"; }
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }, [gameState.timeRemaining]);

    // --- Conditional Rendering ---

    // Phase 1: Initial load and authentication check
    if (!isSessionAuthenticated) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="text-center text-white p-4">
                    <div className="text-4xl mb-4 animate-pulse">⏳</div>
                    <div className="text-xl font-bold mb-2">Preparing Wegen Race...</div>
                    <div className="text-sm mb-4">{loadingMessage}</div>
                    {loadedGameConfig && (
                        <div className="text-xs text-gray-400 mt-4">
                            <div>Players: {loadedGameConfig.players.length}</div>
                            <div>Duration: {loadedGameConfig.duration} minutes</div>
                            <div>Your pick: {loadedGameConfig.humanChoice?.name}</div>
                        </div>
                    )}
                    <button
                        onClick={handleBackToGames}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-bold mt-4 transition-colors duration-200"
                    >
                        Go to Games
                    </button>
                </div>
            </div>
        );
    }
    
    // Phase 2: Session authenticated, but Phaser game not yet running.
    // The key here is to render the game container div, but keep it hidden or overlayed.
    return (
        <div className={`wegenrace-root ${isFullscreen ? "fullscreen-mode" : ""}`}>
            {/* The Phaser game container needs to be present in the DOM for its ref to be set */}
            <div
                className="phaser-game-container"
                id="phaser-game-container"
                ref={gameContainerRef}
                style={{
                    // Style to hide it or keep it at 100% size, but not display: none
                    // Or, if using an overlay, it can be underneath
                    position: 'absolute', // Or 'relative' depending on layout
                    width: '100%',
                    height: '100%',
                    top: 0,
                    left: 0,
                    visibility: isPhaserGameRunning ? 'visible' : 'hidden', // Hide when not running
                    zIndex: isPhaserGameRunning ? 1 : -1, // Ensure it's behind the loading screen
                }}
            />

            {!isPhaserGameRunning && (
                // Overlay for "Loading Game Engine..."
                <div style={{
                    position: "fixed", inset: 0, background: "#000000cc", display: "flex", 
                    flexDirection: "column", alignItems: "center", justifyContent: "center", 
                    color: "#fff", zIndex: 999
                }}>
                    <div style={{ fontSize: "1.5rem", marginBottom: 16 }}>Loading Game Engine...</div>
                    <div style={{
                        width: 48, height: 48, border: "3px solid #333", borderTop: "3px solid #ffd93b",
                        borderRadius: "50%", animation: "spin 1s linear infinite", marginBottom: 16
                    }} />
                    <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                    <div style={{ fontSize: "0.9rem", color: "#bbb" }}>{loadingMessage}</div>
                    <button
                        onClick={handleBackToGames}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded font-bold mt-4 transition-colors duration-200"
                    >
                        Cancel and Back to Games
                    </button>
                </div>
            )}

            {isPhaserGameRunning && (
                // Main game UI content when Phaser is fully running
                <>
                    <div className="wegenrace-sidebar">
                        <div className="leaderboard-panel">
                            <h4>Leaderboard</h4>
                            <div className="leaderboard-scroll">
                                {gameState.players.length > 0 &&
                                    (gameState.leaderboard || gameState.players) 
                                        .sort((a, b) => (gameState.positions[a.key] ?? 999) - (gameState.positions[b.key] ?? 999))
                                        .map((player, idx) => (
                                            <div key={player.key} style={{
                                                display: "flex", alignItems: "center", gap: 6, marginBottom: 6,
                                                background: player.key === loadedGameConfig?.humanChoice.key ? "#2e2e7a77" : "transparent",
                                                borderRadius: 6, padding: "4px 6px"
                                            }}>
                                                <span style={{
                                                    width: 18, textAlign: "center", fontWeight: 600,
                                                    color: idx < 3 ? "#ffe36d" : "#eee"
                                                }}>
                                                    {idx + 1} 
                                                </span>
                                                <img
                                                    src={player.avatarUrl || '/WegenRaceAssets/G1small.png'}
                                                    className="participant-avatar"
                                                    alt={player.name || ""}
                                                    style={{ width: 28, height: 28, borderRadius: '50%' }}
                                                    onError={(e) => { e.currentTarget.src = '/WegenRaceAssets/G1small.png'; }}
                                                />
                                                <span style={{
                                                    fontSize: 12,
                                                    fontWeight: player.key === loadedGameConfig?.humanChoice.key ? "bold" : "normal",
                                                    color: player.key === loadedGameConfig?.humanChoice.key ? '#aad0ff' : '#fafaf7'
                                                }}>
                                                    {player.name || player.username || "Guest"}
                                                </span>
                                                {player.key === loadedGameConfig?.humanChoice.key && <span style={{ marginLeft: 3 }}>👤</span>}
                                            </div>
                                        ))}
                            </div>
                        </div>

                       <div className="eventlog-panel">
                            <h4>Event Log</h4>
                            <div className="eventlog-scroll">
                                {eventLog.map((event) => (
                                        <div key={event.id || `${event.eventType}-${event.description}-${Math.random()}`} style={{
                                            marginBottom: 4, padding: "4px 6px", borderRadius: 4,
                                            background: event.eventType.includes('boost') ? "#2d5a2d" :
                                                event.eventType.includes('stumble') ? "#5a2d2d" :
                                                event.eventType.includes('finished') ? "#2d2d5a" : 
                                                event.eventType.includes('system') ? "#2d2d2d" : "#2d2d2d",
                                            fontSize: "0.75rem", lineHeight: "1.2"
                                        }}>
                                            <div style={{ color: "#fff", fontWeight: 500 }}>
                                                {event.description}
                                            </div>
                                            {event.effect && (
                                                <div style={{ color: "#bbb", fontSize: "0.7rem" }}>
                                                    {event.effect}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                            </div>
                        </div>
                    </div>

                    <div className="wegenrace-main">
                        <div className="race-bar-panel">
                            <span style={{ fontWeight: 600, color: "#ffd93b", fontSize: "1.15rem" }}>
                                {loadedGameConfig?.gameTitle || "Wegen Race"}
                            </span>
                            <span>Players: <b>{gameState.players.length}</b></span>
                            <span>Status: <span style={{ color: "#76ffb4" }}>{gameState.status}</span></span>
                            {gameState.currentPhase && (
                                <span style={{ color: "#9fedff" }}>Phase: {gameState.currentPhase}</span>
                            )}
                            <span>
                                🕐 {formatTimeRemaining()}
                            </span>
                            <div style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
                                <button
                                    onClick={handleBackToGames}
                                    style={{
                                        background: "#ff4757", color: "#fff", border: 0, borderRadius: 8,
                                        fontWeight: 700, padding: "7px 18px", fontSize: 12, cursor: "pointer"
                                    }}
                                >
                                    Back to Games
                                </button>
                                <button
                                    onClick={toggleFullscreen}
                                    style={{
                                        background: "#ffd93b", color: "#1d1757", border: 0, borderRadius: 8,
                                        fontWeight: 700, padding: "7px 18px", fontSize: 12, cursor: "pointer"
                                    }}
                                >
                                    {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                                </button>
                            </div>
                        </div>

                        {/* Phaser game container already rendered outside this block but controlled by visibility */}

                        <div className="participants-panel">
                            {loadedGameConfig?.players.map((player) => (
                                <div
                                    key={player.key}
                                    style={{
                                        display: "flex", flexDirection: "column", alignItems: "center",
                                        minWidth: 60, padding: "4px 8px", borderRadius: 8,
                                        background: player.key === loadedGameConfig.humanChoice.key ? "#3e3e8a55" : "transparent",
                                        border: player.key === loadedGameConfig.humanChoice.key ? "1px solid #7d7dff77" : "none"
                                    }}
                                >
                                    <img
                                        src={player.avatarUrl || '/WegenRaceAssets/G1small.png'}
                                        alt={player.name || ''}
                                        className="participant-avatar"
                                        style={{ width: 28, height: 28, borderRadius: '50%' }}
                                        onError={(e) => { e.currentTarget.src = '/WegenRaceAssets/G1small.png'; }}
                                    />
                                    <span
                                        className="participant-name"
                                        style={{
                                            fontWeight: player.key === loadedGameConfig.humanChoice.key ? 'bold' : 'normal',
                                            color: player.key === loadedGameConfig.humanChoice.key ? '#aad0ff' : '#fafaf7'
                                        }}
                                    >
                                        {player.name || player.username || "Guest"}
                                        {player.key === loadedGameConfig.humanChoice.key && <span style={{ marginLeft: 2 }}>👤</span>}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {showGameOverModal && loadedGameConfig && (
                <GameOverModal
                    isOpen={showGameOverModal}
                    onClose={() => setShowGameOverModal(false)}
                    winner={gameState.winner}
                    rankings={
                        (gameState.leaderboard || [])
                            .map(player => ({
                                ...player,
                                progress: phaserGameRef.current 
                                            ? (getWegenRaceScene(phaserGameRef.current)?.getPlayerProgress(player.key) * 100) || 0
                                            : 0,
                                finishTime: (gameState.winner && player.key === gameState.winner.key && gameState.raceElapsedTime) 
                                            ? gameState.raceElapsedTime / 1000 
                                            : undefined, 
                            }))
                    }
                    humanPlayerChoice={loadedGameConfig.humanChoice}
                    gameType="wegen-race"
                    gameTitle={loadedGameConfig.gameTitle || "Wegen Race"}
                    onPlayAgain={handlePlayAgain}
                    onBackToGames={handleBackToGames}
                />
            )}
        </div>
    );
}