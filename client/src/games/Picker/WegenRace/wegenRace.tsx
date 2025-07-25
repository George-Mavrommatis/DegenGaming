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
import { toast } from "react-toastify";
import { useProfile } from '../../../context/ProfileContext';
import { api } from '../../../services/api';
// import FontFaceObserver from "fontfaceobserver";

interface WegenRaceConfig {
    players: Player[];
    duration: number;
    humanChoice: Player;
    betAmount?: number;
    currency?: 'SOL' | 'FREE';
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

export default function WegenRace() {
    const location = useLocation();
    const navigate = useNavigate();
    const freeTokenConsumedRef = useRef(false);

    const [showGameOverModal, setShowGameOverModal] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState("Loading game...");
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
    const [loadedGameConfig, setLoadedGameConfig] = useState<WegenRaceConfig | null>(null);
    const [isSessionAuthenticated, setIsSessionAuthenticated] = useState(true);
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
    const { refreshProfile } = useProfile();

    // State change handler
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
        if (
            loadedGameConfig &&
            loadedGameConfig.currency === "FREE" &&
            loadedGameConfig.authToken &&
            state.status === "running" &&
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

    const handleGameEnd = useCallback((winner: Player | null, rankings: Player[]) => {
        setGameState(prevState => ({
            ...prevState,
            status: 'finished',
            winner,
            leaderboard: rankings,
            raceEndTime: Date.now()
        }));
        setTimeout(() => setShowGameOverModal(true), 1500);
    }, []);

    // Game config load
    useEffect(() => {
        setLoadingMessage("Validating game configuration...");
        const config: WegenRaceConfig | undefined = (location.state as { gameConfig?: WegenRaceConfig })?.gameConfig;
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
        setLoadedGameConfig(config);
        setLoadingMessage("Configuration loaded. Authenticating session...");
    }, [location.state, navigate]);

    // Phaser game initialization (waits for font and prewarms)
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
        async function loadFontAndStartGame() {
            // const font = new FontFaceObserver('Comic Sans MS');
            try {
                // await font.load();
                const span = document.createElement('span');
                // span.innerText = "ComicSansFontPrewarm";
                span.style.fontFamily = ' Comic Sans MS, cursive';
                span.style.position = 'absolute';
                span.style.opacity = '0';
                span.style.pointerEvents = 'none';
                span.style.zIndex = '-9999';
                document.body.appendChild(span);
                await new Promise(res => setTimeout(res, 150));
                document.body.removeChild(span);
                if (cancelled) return;
                gameContainer.innerHTML = '';
                // const font = new FontFaceObserver('Comic Sans MS');
                // await font.load(); // Wait for this to finish!
                const game = createWegenRaceGame(gameContainer);
                phaserGameRef.current = game;

                const onSceneReady = () => {
                    const scene = getWegenRaceScene(game);
                    // Extra debug!
                    if (scene) {
                        console.log("[WegenRace.tsx] scene found:", scene.constructor.name, scene);
                    }
                    if (
                        scene &&
                        typeof scene.onStateChange === 'function' &&
                        typeof scene.onGameEnd === 'function' &&
                        typeof scene.initializeRaceWithData === 'function'
                    ) {
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
                        game.events.off('scene-ready', onSceneReady);
                    } else {
                        // Fix: else block should match if and not be inside if!
                        console.error("Scene instance at error check:", scene);
                        if (scene) {
                            console.error("typeof onStateChange", typeof scene.onStateChange);
                            console.error("typeof onGameEnd", typeof scene.onGameEnd);
                            console.error("typeof initializeRaceWithData", typeof scene.initializeRaceWithData);
                            console.error("Scene prototype:", Object.getPrototypeOf(scene));
                            console.error("Scene own props:", Object.getOwnPropertyNames(scene));
                        }
                        toast.error("Game engine error: Core scene not ready (custom methods missing).");
                        setConnectionStatus('disconnected');
                    }
                };
                game.events.on('scene-ready', onSceneReady);
            } catch (e) {
                toast.error('Failed to load COMICSANS FONT, cannot start game.');
                setConnectionStatus('disconnected');
            }
        }
        loadFontAndStartGame();

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
        };
    }, [
        loadedGameConfig,
        isSessionAuthenticated,
        isPhaserGameRunning,
        handleGameStateChange,
        handleGameEnd
    ]);

    // Fullscreen toggling (unchanged)
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


    // UI

    if (!loadedGameConfig || !isSessionAuthenticated) {
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

    return (
        <div className={`wegenrace-root ${isFullscreen ? "fullscreen-mode" : ""}`}>
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
                    visibility: isPhaserGameRunning ? 'visible' : 'hidden',
                    zIndex: isPhaserGameRunning ? 1 : -1,
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
            {isPhaserGameRunning && (
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