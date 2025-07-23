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

// --- NEW IMPORTS ---
import { useProfile } from '../../../context/ProfileContext'; // Import useProfile
import { api } from '../../../services/api'; // Import your configured Axios instance
// --- END NEW IMPORTS ---

// --- Types ---
interface WegenRaceConfig {
    players: Player[];
    duration: number;
    humanChoice: Player;
    betAmount?: number;
    currency?: 'SOL' | 'FREE'; // Ensure currency can be 'FREE'
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

    // --- NEW REF FOR TOKEN CONSUMPTION ---
    const freeTokenConsumedForSessionRef = useRef(false); // To ensure token is consumed only once
    // --- END NEW REF ---

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
        raceDuration: 0,
        currentPhase: 'Initializing',
        timeRemaining: 0,
        leaderboard: [],
        eventLog: []
    });
    const [eventLog, setEventLog] = useState<GameEvent[]>([]);

    const gameContainerRef = useRef<HTMLDivElement>(null);
    const phaserGameRef = useRef<Phaser.Game | null>(null);

    // --- Access useProfile context ---
    const { refreshProfile } = useProfile();
    // --- End useProfile access ---

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

    // Effect 1: Load Game Configuration from Route State
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
        // Validate essential config properties
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

    // Effect 2: Firebase Authentication (using Custom Token Exchange)
   useEffect(() => {
        if (
          loadedGameConfig && isSessionAuthenticated &&
          loadedGameConfig.gameEntryTokenId && !freeTokenConsumedForSessionRef.current
        ) {
            const consumeToken = async () => {
                try {
                    // POST to backend to consume token
                    // (Backend will only decrement free token balance if FREE, else just mark as consumed)
                    const response = await api.post('/game-sessions/consume-entry-token', {
                        gameEntryTokenId: loadedGameConfig.gameEntryTokenId,
                        gameType: loadedGameConfig.currency === "FREE" ? "picker" : "sol"
                    });
                    if (response.data.success) {
                        freeTokenConsumedForSessionRef.current = true;
                        await refreshProfile();
                    }
                } catch (err) {
                    toast.error("Could not validate entry token. Please try to restart the game.");
                    navigate("/games");
                }
            };
            consumeToken();
        }
    }, [loadedGameConfig, isSessionAuthenticated, navigate, refreshProfile]);

    // --- NEW Effect 2.5: Consume Free Entry Token (if applicable) ---
    // This runs AFTER authentication but BEFORE Phaser game initialization.
    useEffect(() => {
        console.log(`DEBUG: WegenRace.tsx: Effect 2.5 (Consume Free Token) - LoadedConfig=${!!loadedGameConfig}, SessionAuthenticated=${isSessionAuthenticated}, FreeTokenConsumed=${freeTokenConsumedForSessionRef.current}`);

        // Only proceed if config is loaded, session is authenticated,
        // it's a FREE entry, and we haven't consumed the token for this session yet.
        if (loadedGameConfig && isSessionAuthenticated && 
            loadedGameConfig.currency === 'FREE' && !freeTokenConsumedForSessionRef.current) {
            
            const consumeFreeEntryToken = async () => {
                setLoadingMessage("Consuming free entry token...");
                console.log("WegenRace: Attempting to consume free entry token for game session:", loadedGameConfig.gameEntryTokenId);
                try {
                    // Call the new backend endpoint for free token consumption
                    // This will decrement the user's free pickerTokens count in Firestore
                    const response = await api.post('/game-sessions/consume-entry-token', {
                        gameEntryTokenId: loadedGameConfig.gameEntryTokenId,
                        gameType: 'picker' // Category for free tokens
                    });

                    if (response.data.success) {
                        toast.success("1 Free Entry Token consumed for this game!");
                        await refreshProfile(); // Refresh profile to show updated token count immediately
                        freeTokenConsumedForSessionRef.current = true; // Mark as consumed for this session
                        setLoadingMessage("Free token consumed. Initializing game engine...");
                    } else {
                        // This case should ideally be caught by backend validation
                        console.error("WegenRace: Backend failed to consume token:", response.data.message);
                        throw new Error(response.data.message || "Failed to consume free entry token.");
                    }
                } catch (error: any) {
                    console.error("ERROR: WegenRace.tsx: Effect 2.5 - Error consuming free entry token:", error);
                    toast.error(`Game access denied: ${error.message}. Please restart from the games page.`);
                    navigate("/games"); // Critical error, send back to games list
                }
            };
            consumeFreeEntryToken();
        } else if (loadedGameConfig && isSessionAuthenticated && loadedGameConfig.currency === 'SOL') {
            // For SOL entries, we still need to mark the gameEntryToken as consumed
            // but we don't decrement a free token count. The original consume-token
            // endpoint is appropriate here, or if generate-entry-token already marks it,
            // this step might be redundant. For safety, let's keep the original logic here for SOL.
            const markPaidEntryTokenConsumed = async () => {
                setLoadingMessage("Marking paid entry token as consumed...");
                console.log("WegenRace: Marking paid entry token as consumed for game session:", loadedGameConfig.gameEntryTokenId);
                try {
                    // Use the existing endpoint to simply mark the token record as `consumed: true`
                    const response = await api.post('/api/game-sessions/consume-token', {
                        gameEntryTokenId: loadedGameConfig.gameEntryTokenId,
                    });

                    if (response.data.success) {
                        console.log("WegenRace: Paid entry token successfully marked as consumed.");
                        setLoadingMessage("Entry token consumed. Initializing game engine...");
                    } else {
                        console.warn("WegenRace: Backend failed to mark paid token as consumed, but game might still proceed:", response.data.message);
                        // This is a warning, not a critical error preventing game start,
                        // as payment has already occurred and game access granted.
                        // You might want to log this more verbosely on your server.
                        setLoadingMessage("Warning: Token status not updated. Initializing game engine...");
                    }
                } catch (error: any) {
                    console.error("WegenRace: Error marking paid entry token as consumed:", error);
                    // Again, a warning for logging, not preventing game start
                    setLoadingMessage("Warning: Failed to mark token. Initializing game engine...");
                }
            };
            markPaidEntryTokenConsumed();
        }

    }, [loadedGameConfig, isSessionAuthenticated, navigate, refreshProfile]); // Add refreshProfile to dependencies

    // Effect 3: Phaser Game Initialization
    useEffect(() => {
        console.log(`DEBUG: WegenRace.tsx: Effect 3 (Phaser Init) - Conditions: LoadedConfig=${!!loadedGameConfig}, SessionAuthenticated=${isSessionAuthenticated}, PhaserRunning=${isPhaserGameRunning}`);

        // Define conditions for Phaser to initialize
        const canInitializePhaser = loadedGameConfig && isSessionAuthenticated && !isPhaserGameRunning && (
            (loadedGameConfig.currency === 'SOL') || // Always allow SOL if authenticated
            (loadedGameConfig.currency === 'FREE' && freeTokenConsumedForSessionRef.current) // Only allow FREE if token is marked consumed
        );

        if (!canInitializePhaser) {
            if (!loadedGameConfig) console.log("DEBUG: WegenRace.tsx: Effect 3 - Skipping Phaser init: game config not yet loaded.");
            if (!isSessionAuthenticated) console.log("DEBUG: WegenRace.tsx: Effect 3 - Skipping Phaser init: session not yet authenticated.");
            if (isPhaserGameRunning) console.log("DEBUG: WegenRace.tsx: Effect 3 - Skipping Phaser init: game is already running.");
            if (loadedGameConfig?.currency === 'FREE' && !freeTokenConsumedForSessionRef.current) console.log("DEBUG: WegenRace.tsx: Effect 3 - Skipping Phaser init: Free token not yet consumed.");
            return;
        }

        const gameContainer = gameContainerRef.current;
        if (!gameContainer) {
            console.error("ERROR: WegenRace.tsx: Effect 3 - Game container ref is null. Cannot initialize Phaser.");
            setConnectionStatus('disconnected');
            return;
        }

        // Clean up any existing Phaser instance before creating a new one
        if (phaserGameRef.current) {
            console.log("DEBUG: WegenRace.tsx: Effect 3 - Destroying previous Phaser instance before re-initialization.");
            destroyWegenRaceGame(phaserGameRef.current);
            phaserGameRef.current = null;
        }

        try {
            gameContainer.innerHTML = ''; // Clear container to prevent duplicate canvases
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
                    enableDebugMode(game); // Ensure debug mode is enabled if desired
                    scene.onStateChange(handleGameStateChange);
                    scene.onGameEnd(handleGameEnd);
                    // Pass the necessary data to the Phaser game scene
                    scene.initializeRaceWithData( 
                        loadedGameConfig.players, 
                        loadedGameConfig.duration, 
                        loadedGameConfig.humanChoice 
                    );
                    scene.startRaceExternally(); // Tell Phaser to start the race
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

        // Cleanup function for this effect
        return () => {
            if (phaserGameRef.current) {
                console.log("DEBUG: WegenRace.tsx: Effect 3 Cleanup - Destroying Phaser instance on component unmount or re-render.");
                destroyWegenRaceGame(phaserGameRef.current);
                phaserGameRef.current = null;
            }
            setIsPhaserGameRunning(false);
            setLoadedGameConfig(null);
            setIsSessionAuthenticated(false);
            // Reset the freeTokenConsumedForSessionRef on unmount
            freeTokenConsumedForSessionRef.current = false; 
            setGameState({
                status: 'waiting', players: [], positions: {}, raceProgress: 0, winner: null,
                raceElapsedTime: 0, raceDuration: 0, currentPhase: 'Initializing',
                timeRemaining: 0, leaderboard: [], eventLog: []
            });
            setEventLog([]);
        };
    }, [loadedGameConfig, isSessionAuthenticated, isPhaserGameRunning, freeTokenConsumedForSessionRef, handleGameStateChange, handleGameEnd]); // Added freeTokenConsumedForSessionRef to dependencies

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
        if (!isFullscreen) { 
            if (element.requestFullscreen) {
                element.requestFullscreen();
            } else if ((element as any).mozRequestFullScreen) { /* Firefox */
                (element as any).mozRequestFullScreen();
            } else if ((element as any).webkitRequestFullscreen) { /* Chrome, Safari & Opera */
                (element as any).webkitRequestFullscreen();
            } else if ((element as any).msRequestFullscreen) { /* IE/Edge */
                (element as any).msRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if ((document as any).mozCancelFullScreen) { /* Firefox */
                (document as any).mozCancelFullScreen();
            } else if ((document as any).webkitExitFullscreen) { /* Chrome, Safari and Opera */
                (document as any).webkitExitFullscreen();
            } else if ((document as any).msExitFullscreen) { /* IE/Edge */
                (document as any).msExitFullscreen();
            }
        }
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
    // This state is shown until `isSessionAuthenticated` becomes true.
    // It also shows if `loadedGameConfig` is null.
    if (!loadedGameConfig || !isSessionAuthenticated) { // Consolidate conditions here
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
    
    // Phase 2: Session authenticated, but Phaser game not yet running or free token not consumed.
    // This overlay handles the transition while Phaser is setting up or waiting for token consumption.
    return (
        <div className={`wegenrace-root ${isFullscreen ? "fullscreen-mode" : ""}`}>
            {/* The Phaser game container needs to be present in the DOM for its ref to be set */}
            <div
                className="phaser-game-container"
                id="phaser-game-container"
                ref={gameContainerRef}
                style={{
                    position: 'absolute',
                    width: '100%',
                    height: '100%',
                    top: 0,
                    left: 0,
                    visibility: isPhaserGameRunning ? 'visible' : 'hidden', // Hide when not running
                    zIndex: isPhaserGameRunning ? 1 : -1, // Ensure it's behind the loading screen/overlay
                }}
            />

            {/* Loading/Setup Overlay */}
            {!isPhaserGameRunning && (
                <div style={{
                    position: "fixed", inset: 0, background: "#000000cc", display: "flex", 
                    flexDirection: "column", alignItems: "center", justifyContent: "center", 
                    color: "#fff", zIndex: 999
                }}>
                    <div style={{ fontSize: "1.5rem", marginBottom: 16 }}>Preparing Game...</div>
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