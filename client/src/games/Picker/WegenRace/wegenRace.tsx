import React, { useRef, useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
    createWegenRaceGame,
    destroyWegenRaceGame,
    enableDebugMode,
    WegenRaceScene,
    Player
} from './wegenRaceGame';
import GameOverModal from "../PickerGameOverModal";
import "./wegenrace.css";
import { toast } from "react-toastify";
import { useProfile } from '../../../context/ProfileContext';
import { api } from '../../../services/api';

export default function WegenRace() {
    const location = useLocation();
    const navigate = useNavigate();
    const freeTokenConsumedRef = useRef(false);

    const [showGameOverModal, setShowGameOverModal] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState("Loading game...");
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
    const [loadedGameConfig, setLoadedGameConfig] = useState<any>(null);
    const [isSessionAuthenticated, setIsSessionAuthenticated] = useState(true);
    const [isPhaserGameRunning, setIsPhaserGameRunning] = useState(false);

    const [gameState, setGameState] = useState<any>({
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

    const [eventLog, setEventLog] = useState<any[]>([]);
    const gameContainerRef = useRef<HTMLDivElement>(null);
    const phaserGameRef = useRef<Phaser.Game | null>(null);
    const { refreshProfile } = useProfile();

    // --- State change handler ---
    const handleGameStateChange = useCallback((state: any) => {
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
            eventLog: state.eventLog || [],
        }));
        setEventLog(state.eventLog || []);
        setConnectionStatus('connected');
        if (
            loadedGameConfig &&
            loadedGameConfig.currency &&
            loadedGameConfig.authToken &&
            state.status === "racing" &&
            !freeTokenConsumedRef.current
        ) {
            api.post(
                "/tokens/consume",
                { tokenType: "picker" },
                { headers: { Authorization: `Bearer ${loadedGameConfig.authToken}` } }
            ).then(() => {
                toast.success("Free Entry Token consumed!");
                refreshProfile();
            }).catch(() => {
                toast.error("Failed to consume Picker Free Entry Token.");
            });
            freeTokenConsumedRef.current = true;
        }
    }, [loadedGameConfig, refreshProfile]);

    const handleGameEnd = useCallback((winner: any, rankings: any[]) => {
        setGameState(prevState => ({
            ...prevState,
            status: 'finished',
            winner,
            leaderboard: rankings,
            raceEndTime: Date.now()
        }));
        setTimeout(() => setShowGameOverModal(true), 1500);
    }, []);

    // --- Game config load ---
    useEffect(() => {
        setLoadingMessage("Validating game configuration...");
        const config = (location.state as { gameConfig?: any })?.gameConfig;
        if (!config) {
            toast.error("Game configuration not found. Please start the game from the Games page.");
            navigate("/games");
            return;
        }
        if (!config.players || config.players.length === 0 || !config.humanChoice || !config.authToken) {
            toast.error("Invalid game data. Please restart from games page.");
            navigate("/games");
            return;
        }
        const normalizedPlayers = config.players.map((p: Player) => ({
            ...p,
            avatarUrl: p.avatarUrl && p.avatarUrl !== "" ? p.avatarUrl : '/WegenRaceAssets/G1small.png',
            name: p.username && p.username !== "" ? p.username : (
                p.wallet ? `${p.wallet.slice(0, 3)}...${p.wallet.slice(-3)}` : 'Guest'
            )
        }));
        config.players = normalizedPlayers;
        if (config.humanChoice) {
            config.humanChoice.avatarUrl = config.humanChoice.avatarUrl && config.humanChoice.avatarUrl !== "" ? config.humanChoice.avatarUrl : '/WegenRaceAssets/G1small.png';
            config.humanChoice.name = config.humanChoice.username && config.humanChoice.username !== "" ? config.humanChoice.username : (
                config.humanChoice.wallet ? `${config.humanChoice.wallet.slice(0, 3)}...${config.humanChoice.wallet.slice(-3)}` : 'Guest'
            );
        }
        setLoadedGameConfig(config);
        setLoadingMessage("Configuration loaded. Authenticating session...");
    }, [location.state, navigate]);

    useEffect(() => {
        console.log("isPhaserGameRunning:", isPhaserGameRunning);
    }, [isPhaserGameRunning]);

    // --- Phaser game initialization ---
    useEffect(() => {
        const canInitializePhaser =
            loadedGameConfig &&
            isSessionAuthenticated &&
            !isPhaserGameRunning &&
            (loadedGameConfig.currency === 'SOL' || loadedGameConfig.currency === 'FREE');
        if (!canInitializePhaser) return;

        const gameContainer = gameContainerRef.current;
        if (!gameContainer) {
            setConnectionStatus('disconnected');
            return;
        }
        if (phaserGameRef.current) {
            destroyWegenRaceGame(phaserGameRef.current);
            phaserGameRef.current = null;
        }
        let cancelled = false;
        gameContainer.innerHTML = '';
        const game = createWegenRaceGame(gameContainer, loadedGameConfig.players, loadedGameConfig.duration);
        phaserGameRef.current = game;

        setTimeout(() => {
            const sceneRaw = game.scene.getScene('WegenRaceScene');
            const scene = sceneRaw as WegenRaceScene;
            if (scene && typeof scene.onStateChange === 'function' && typeof scene.onGameEnd === 'function') {
                scene.events.once('race-scene-fully-ready', () => {
                    console.log("React: received race-scene-fully-ready event, setting running TRUE!");
                    if (cancelled) return;
                    enableDebugMode(game);

                    scene.onStateChange(handleGameStateChange);
                    scene.onGameEnd(handleGameEnd);

                    scene.initializeRaceWithData(
                        loadedGameConfig.players,
                        loadedGameConfig.duration,
                        loadedGameConfig.humanChoice
                    );
                    setConnectionStatus('connected');
                    setIsPhaserGameRunning(true);
                    setLoadingMessage("Game is running!");
                });
            } else {
                console.error("WegenRaceScene missing custom methods! Did you forget to cast or export them?");
            }
        }, 10);

        // Responsive resize
        const resizePhaser = () => {
            if (phaserGameRef.current && gameContainerRef.current) {
                const width = gameContainerRef.current.offsetWidth;
                const height = gameContainerRef.current.offsetHeight;
                phaserGameRef.current.scale.resize(width, height);
            }
        };
        window.addEventListener("resize", resizePhaser);
        resizePhaser();

        return () => {
            cancelled = true;
            if (phaserGameRef.current) {
                destroyWegenRaceGame(phaserGameRef.current);
                phaserGameRef.current = null;
            }
            setIsPhaserGameRunning(false);
            setLoadedGameConfig(null);
            setIsSessionAuthenticated(false);
            freeTokenConsumedRef.current = false;
            setGameState({
                status: 'waiting', players: [], positions: {}, raceProgress: 0, winner: null,
                raceElapsedTime: 0, raceDuration: 0, currentPhase: 'Initializing',
                timeRemaining: 0, leaderboard: [], eventLog: []
            });
            setEventLog([]);
            window.removeEventListener("resize", resizePhaser);
        };
    }, [
        loadedGameConfig,
        isSessionAuthenticated
    ]);

    // --- Fullscreen handler ---
    const handleBackToGames = useCallback(() => {
        if (phaserGameRef.current) {
            destroyWegenRaceGame(phaserGameRef.current);
            phaserGameRef.current = null;
        }
        navigate("/games");
    }, [navigate]);
    const handlePlayAgain = useCallback(() => { handleBackToGames(); }, [handleBackToGames]);
    const toggleFullscreen = useCallback(() => {
        const element = document.documentElement;
        if (!isFullscreen) {
            if (element.requestFullscreen) element.requestFullscreen();
            else if ((element as any).webkitRequestFullscreen) (element as any).webkitRequestFullscreen();
            else if ((element as any).mozRequestFullScreen) (element as any).mozRequestFullScreen();
            else if ((element as any).msRequestFullscreen) (element as any).msRequestFullscreen();
        } else {
            if (document.exitFullscreen) document.exitFullscreen();
            else if ((document as any).webkitExitFullscreen) (document as any).webkitExitFullscreen();
            else if ((document as any).mozCancelFullScreen) (document as any).mozCancelFullScreen();
            else if ((document as any).msExitFullscreen) (document as any).msExitFullscreen();
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

    if (!loadedGameConfig || !isSessionAuthenticated) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center" style={{ fontFamily: 'WegensFont, Arial, sans-serif' }}>
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

    return (
        <div className={`wegenrace-root${isFullscreen ? " fullscreen-mode" : ""}`} style={{ fontFamily: 'WegensFont, Arial, sans-serif', width: "100vw", minHeight: "100vh" }}>
            {/* === TOP BAR === */}
            <div className="wegenrace-topbar">
                <div className="wegenrace-topbar-content">
                    <span className="race-title">{loadedGameConfig?.gameTitle || "Wegen Race"}</span>
                    <span className="race-details">
                        <span>Players: <b>{gameState.players.length}</b></span>
                        <span>Status: <span style={{ color: "#76ffb4" }}>{gameState.status}</span></span>
                        <span className="race-phase">Phase: {gameState.currentPhase}</span>
                        <span>🕐 {formatTimeRemaining()}</span>
                        <span>
                            Your pick: <b style={{ color: "#ffd93b" }}>{loadedGameConfig?.humanChoice?.name}</b>
                            <img src={loadedGameConfig?.humanChoice?.avatarUrl || '/WegenRaceAssets/G1small.png'} alt="Your pick" style={{
                                width: 28, height: 28, borderRadius: '50%',
                                marginLeft: 7, verticalAlign: 'middle', border: '2px solid #ffd93b'
                            }} />
                        </span>
                    </span>
                    <div className="race-bar-controls">
                        <button onClick={handleBackToGames} className="back-to-games-btn">Back</button>
                        <button className="fullscreen-btn" onClick={toggleFullscreen}>
                            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                        </button>
                    </div>
                </div>
            </div>
            {/* === MAIN CONTENT === */}
            <div className="wegenrace-content">
                <div className="wegenrace-sidebar">
                    <div className="leaderboard-panel">
                        <h4>Leaderboard</h4>
                        <div className="leaderboard-scroll">
                            {(gameState.leaderboard || loadedGameConfig.players)
                                .slice(0, 50)
                                .map((player: any, idx: number) => (
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
                                            {player.name || player.username || (player.wallet ? `${player.wallet.slice(0, 3)}...${player.wallet.slice(-3)}` : "Guest")}
                                        </span>
                                        {player.key === loadedGameConfig?.humanChoice.key && <span style={{ marginLeft: 3 }}>👤</span>}
                                    </div>
                                ))}
                        </div>
                    </div>
                    <div className="eventlog-panel">
                        <h4>Event Log</h4>
                        <div className="eventlog-scroll">
                            {eventLog
                                .filter((event) =>
                                    event.eventType !== "phase_change" // Only show boosts/stumbles/finishes
                                )
                                .map((event) => (
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
                <div className="wegenrace-game-area">
                    <div
                        className="phaser-game-container"
                        id="phaser-game-container"
                        ref={gameContainerRef}
                        style={{
                            position: 'relative',
                            width: '100%',
                            height: '100%',
                            background: '#181828',
                            zIndex: 1,
                            visibility: isPhaserGameRunning ? 'visible' : 'hidden'
                        }}
                    />
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
                    <div className="participants-panel">
                        {loadedGameConfig?.players.map((player: any) => (
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
                                    {player.name || player.username || (player.wallet ? `${player.wallet.slice(0, 3)}...${player.wallet.slice(-3)}` : "Guest")}
                                    {player.key === loadedGameConfig.humanChoice.key && <span style={{ marginLeft: 2 }}>👤</span>}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            {showGameOverModal && loadedGameConfig && (
                <GameOverModal
                    isOpen={showGameOverModal}
                    onClose={() => setShowGameOverModal(false)}
                    winner={gameState.winner}
                    rankings={
                        (gameState.leaderboard || [])
                            .map((player: any) => ({
                                ...player,
                                progress: phaserGameRef.current
                                    ? (phaserGameRef.current.scene && phaserGameRef.current.scene.getScene('WegenRaceScene')?.getPlayerProgress(player.key) * 100) || 0
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