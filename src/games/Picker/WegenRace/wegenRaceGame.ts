// src/games/Wegen/wegenRaceGame.ts

import Phaser from 'phaser';

// --- Types ---
interface Player {
    key: string; // Unique identifier for the player (e.g., wallet address or internal ID)
    name: string; // Display name of the player
    username?: string; // Optional: Alias for name or a more technical username
    wallet?: string; // Optional: Player's wallet address
    avatarUrl?: string; // Optional: URL to the player's avatar image
    isHumanPlayer?: boolean; // Indicates if this player is the human user (for UI distinction)
    isGuest?: boolean; // Indicates if the player is a guest (for UI distinction)
}

interface GameState {
    status: 'waiting' | 'countdown' | 'racing' | 'finished'; // Current state of the race (e.g., before start, during, after)
    raceProgress: number; // Overall race progression (0-100%)
    raceElapsedTime: number; // Time elapsed since race started (in milliseconds)
    raceDuration: number; // Total intended duration of the race (in milliseconds)
    currentPhase: string; // The descriptive name of the current game phase (e.g., "Starting Grid")
    timeRemaining: number; // Time left until race concludes (in milliseconds)
    players: Player[]; // Array of all participating players
    positions: Record<string, number>; // Maps player key to their current rank (1-indexed)
    winner: Player | null; // The winning player, or null if no winner yet
    rankings: Player[]; // Ordered list of players by rank (from 1st to last)
    eventLog: GameEvent[]; // Filtered log of significant events for UI display
}

interface GameEvent {
    id: string; // Unique ID for the event
    timestamp: number; // Time when the event occurred (in milliseconds)
    playerKey: string; // Player associated with the event (if any)
    eventType: string; // Type of event (e.g., 'boost_speed', 'stumble', 'phase_change')
    description: string; // Human-readable description
    effect?: string; // Optional: Details about the effect (e.g., "+50% speed")
}

interface VisualBoost {
    isPositive: boolean; // True for boost, false for stumble/stun
    multiplier: number; // Speed multiplier (e.g., 1.5 for +50% speed)
    duration: number; // Total duration of the visual/mechanical effect (in milliseconds)
    startTime: number; // Timestamp when the effect started
    isStun?: boolean; // True if this effect includes a stun
    stunEndTime?: number; // Timestamp when stun effect ends (if `isStun` is true)
}

// --- Constants for Game Configuration and Visuals ---
export const GAME_CONSTANTS = {
    PHASES_COUNT: 10, // Number of distinct phases the race progresses through
    MIN_RACE_DURATION: 1, // Minimum race duration in minutes
    MAX_RACE_DURATION: 60, // Maximum race duration in minutes
    MAX_PLAYERS: 50, // Maximum number of players allowed
    MIN_PLAYERS: 2, // Minimum number of players required

    // Regulation mechanics
    REGULATION_TOLERANCE: 0.20, // Allows +/- 20% deviation from expected overall progress before regulation adjusts speeds

    // Boost/Stumble effect parameters (in milliseconds or as multipliers)
    BOOST_DURATION_MIN: 2500, // Minimum duration of a boost effect
    BOOST_DURATION_MAX: 7000, // Maximum duration of a boost effect
    BOOST_MULTIPLIER_MIN: 1.5, // Minimum speed multiplier for a boost
    BOOST_MULTIPLIER_MAX: 2.5, // Maximum speed multiplier for a boost
    STUMBLE_DURATION_MIN: 2500, // Minimum duration of a stumble effect
    STUMBLE_DURATION_MAX: 7000, // Maximum duration of a stumble effect
    STUN_DURATION_MIN: 400, // Minimum duration a player can be stunned (no progress)
    STUN_DURATION_MAX: 1000, // Maximum duration a player can be stunned

    // Visual layout constants
    LANE_HEIGHT_MIN: 60, // Minimum height of a player's lane in pixels
    LANE_HEIGHT_MAX: 100, // Maximum height of a player's lane in pixels
    LANE_PADDING: 5, // Vertical spacing between lanes in pixels
    AVATAR_SIZE_RATIO: 0.7, // Avatar size as a ratio of lane height (e.g., 0.7 means avatar is 70% of lane height)
    AVATAR_START_OFFSET_X: 30, // Initial X offset of avatar within its container (from left edge)
    PLAYER_NAME_OFFSET_X: 10, // Horizontal offset of player name text from avatar
    PROGRESS_BAR_HEIGHT_RATIO: 0.2, // Progress bar height as a ratio of lane height
    PROGRESS_BAR_ROUND_RADIUS: 5 // Corner radius for the progress bar
} as const;

// --- Sprite Depths for Layering in Phaser ---
const enum spriteDepths {
    trackOutline = 0, // Outermost border of the track
    trackBackground = 1, // Background of individual player lanes
    playerProgressBar = 2, // Progress bar in each lane
    laneHighlight = 3, // Aura/highlight effects (should be below avatar)
    phaseMarkers = 4, // Vertical lines marking phases
    playerAvatar = 10, // Player avatars themselves
    particles = 12, // Small particle effects
    countdown = 100, // Countdown text (e.g., "3, 2, 1, GO!")
    confetti = 200, // Confetti layer for celebrations
    overallUI = 250 // General UI elements (titles, scoreboards)
}

// --- Game Logic Engine ---
class WegenRaceGameLogic {
    private players: Player[] = []; // Array to hold all player data currently participating in the race
    private gameState: GameState; // The central object holding the current state of the game
    // Defining distinct phases to structure the game progression, providing narrative and triggering events
    public phases: string[] = [
        'Starting Grid', 'Acceleration', 'Tight Corner', 'Mid-Race Push', 'Strategic Maneuver',
        'Power Lap', 'Challenge Zone', 'Final Stretch', 'Clash Ahead', 'Photo Finish'
    ];
    private currentPhaseIndex = 0; // Index to track which phase the race is currently in
    private raceStartTime: number | null = null; // Timestamp when the race officially began
    private playerProgress: Record<string, number> = {}; // Tracks each player's individual progress from 0-100 units
    private playerLastPhase: Record<string, number> = {}; // Used to track when individual players advance through phases
    private playerBoosts: Record<string, VisualBoost> = {}; // Stores active boost/stumble effects for each player
    private eventLog: GameEvent[] = []; // A comprehensive internal log of all game events
    private eventCounter = 0; // Counter for generating unique event IDs
    private regulationTolerance: number = GAME_CONSTANTS.REGULATION_TOLERANCE; // Allows for +/- 20% deviation from expected overall progress

    private finishedPlayersCount = 0; // Tracks how many players have crossed the finish line
    private finishThreshold: number = 0; // Dynamic: Will be calculated based on player count

    private internalEventEmitter: Phaser.Events.EventEmitter; // An event emitter for internal communication with Phaser scene

    constructor() {
        this.internalEventEmitter = new Phaser.Events.EventEmitter();
        this.gameState = { // Initialize the game state with default values
            status: 'waiting',
            raceProgress: 0,
            raceElapsedTime: 0,
            raceDuration: 300000, // Default race duration: 5 minutes
            currentPhase: this.phases[0],
            timeRemaining: 300000,
            players: [],
            positions: {},
            winner: null,
            rankings: [],
            eventLog: []
        };
    }

    /**
     * Initializes a new race with the given players and duration.
     * Resets all internal game states for a fresh start.
     * @param players Array of Player objects participating in the race.
     * @param durationMinutes Total duration of the race in minutes.
     */
    initializeRace(players: Player[], durationMinutes: number): void {
        this.players = [...players];
        this.gameState.players = [...players];
        this.gameState.raceDuration = durationMinutes * 60 * 1000; // Convert to milliseconds
        this.gameState.timeRemaining = this.gameState.raceDuration;
        this.currentPhaseIndex = 0;
        this.gameState.currentPhase = this.phases[0];

        this.playerProgress = {};
        this.playerLastPhase = {};
        this.playerBoosts = {};
        this.eventLog = [];
        this.gameState.winner = null;
        this.gameState.rankings = [];
        this.finishedPlayersCount = 0;

        // Calculate dynamic finish threshold: Race ends when 40% of players finish, minimum 1.
        this.finishThreshold = Math.max(1, Math.ceil(players.length * 0.4));
        console.log(`DEBUG: GameLogic: Race will end when ${this.finishThreshold} players finish.`);


        this.players.forEach(player => {
            this.playerProgress[player.key] = 0;
            this.playerLastPhase[player.key] = -1; // -1 ensures first phase advance triggers
        });

        this.addEvent('system', 'race_initialized', `Race initialized with ${players.length} players for ${durationMinutes} minutes.`);
        console.log('🏁 Race initialized with players:', players.map(p => p.name));
    }

    /**
     * Starts the race countdown and then transitions to the 'racing' state.
     * Only callable if the game is in 'waiting' state.
     */
    startRace(): void {
        if (this.gameState.status !== 'waiting') return;

        this.gameState.status = 'countdown';
        setTimeout(() => {
            this.gameState.status = 'racing';
            this.raceStartTime = Date.now();
            this.addEvent('system', 'race_start', 'Race has begun!');
        }, 3000); // 3-second countdown
    }

    /**
     * Main update loop for the game logic.
     * Called by Phaser's update method.
     * @param deltaTime Time elapsed since the last frame (in milliseconds).
     */
    update(deltaTime: number): void {
        if (this.gameState.status !== 'racing') return;

        const currentTime = Date.now();
        const elapsedTime = currentTime - (this.raceStartTime || currentTime);

        this.gameState.raceElapsedTime = elapsedTime;
        this.gameState.timeRemaining = Math.max(0, this.gameState.raceDuration - elapsedTime);

        this.updatePhase(elapsedTime);
        this.updatePlayerProgress(deltaTime, currentTime);
        this.updatePositions();
        this.regulateRaceDuration();

        // Check race end conditions: enough players finished OR time ran out.
        if (this.finishedPlayersCount >= this.finishThreshold) {
            console.log(`DEBUG: GameLogic: ${this.finishedPlayersCount} players finished (threshold ${this.finishThreshold}). Ending race.`);
            this.endRace();
        } else if (this.gameState.timeRemaining <= 0) {
            console.log("DEBUG: GameLogic: Time remaining is 0. Ending race.");
            // Force remaining players to 100% progress for consistent ranking if time runs out.
            this.players.forEach(player => {
                if (this.playerProgress[player.key] < 100) {
                    this.playerProgress[player.key] = 100;
                }
            });
            this.endRace();
        }
    }

    /**
     * Updates the current phase of the race based on elapsed time.
     * Triggers phase-specific events like boosts/stumbles.
     * @param elapsedTime Time since race started (in milliseconds).
     */
    private updatePhase(elapsedTime: number): void {
        const phaseDuration = this.gameState.raceDuration / this.phases.length;
        const targetPhaseIndex = Math.min(Math.floor(elapsedTime / phaseDuration), this.phases.length - 1);

        if (targetPhaseIndex !== this.currentPhaseIndex) {
            this.currentPhaseIndex = targetPhaseIndex;
            this.gameState.currentPhase = this.phases[this.currentPhaseIndex];
            this.addEvent('system', 'phase_change', `Entering ${this.gameState.currentPhase}`);
            this.triggerPhaseBoosts(); // Trigger new random events for the new phase
        }

        // Continually update overall race progress for UI
        this.gameState.raceProgress = (elapsedTime / this.gameState.raceDuration) * 100;
        this.gameState.raceProgress = Math.min(100, Math.max(0, this.gameState.raceProgress));
    }

    /**
     * Randomly applies boosts or stumbles to a subset of players when a new phase begins.
     */
    private triggerPhaseBoosts(): void {
        const numPlayersToAffect = Math.max(1, Math.ceil(this.players.length * 0.5)); // Affect ~50% of players

        const shuffledPlayers = [...this.players].sort(() => 0.5 - Math.random());
        
        for (let i = 0; i < numPlayersToAffect && i < shuffledPlayers.length; i++) {
            const player = shuffledPlayers[i];
            const isPositive = Math.random() < 0.6; // 60% chance for a positive effect
            const duration = Phaser.Math.Between(GAME_CONSTANTS.BOOST_DURATION_MIN, GAME_CONSTANTS.BOOST_DURATION_MAX);

            if (isPositive) {
                const multiplier = Phaser.Math.Between(GAME_CONSTANTS.BOOST_MULTIPLIER_MIN * 100, GAME_CONSTANTS.BOOST_MULTIPLIER_MAX * 100) / 100;
                this.applyBoost(player, true, multiplier, duration);
            } else {
                const stunDuration = Phaser.Math.Between(GAME_CONSTANTS.STUN_DURATION_MIN, GAME_CONSTANTS.STUN_DURATION_MAX);
                this.applyStumble(player, duration, stunDuration);
            }
        }
    }

    /**
     * Applies a speed boost effect to a player.
     * @param player The player to apply the boost to.
     * @param isPositive True for a positive boost, false otherwise (should be true for this method).
     * @param multiplier The speed multiplier for the boost.
     * @param duration The duration of the boost in milliseconds.
     */
    private applyBoost(player: Player, isPositive: boolean, multiplier: number, duration: number): void {
        this.playerBoosts[player.key] = {
            isPositive,
            multiplier,
            duration,
            startTime: Date.now()
        };
        const effectDescription = `+${Math.round((multiplier - 1) * 100)}% speed`;
        const eventDescription = `${player.name} gains a burst of speed!`;
        this.addEvent(player.key, 'boost_speed', eventDescription, effectDescription);
        this.internalEventEmitter.emit('playerBoostEffect', player.key, true, duration);
    }

    /**
     * Applies a stumble/stun effect to a player.
     * @param player The player to apply the stumble to.
     * @param effectDuration Total duration of the visual effect.
     * @param stunDuration How long the player is completely stopped (part of effectDuration).
     */
    private applyStumble(player: Player, effectDuration: number, stunDuration: number): void {
        const currentTime = Date.now();
        this.playerBoosts[player.key] = {
            isPositive: false,
            multiplier: 0, // Multiplier won't be used directly for stun, but good to set
            duration: effectDuration,
            startTime: currentTime,
            isStun: true,
            stunEndTime: currentTime + stunDuration
        };
        const eventDescription = `${player.name} stumbles and halts!`;
        this.addEvent(player.key, 'stumble', eventDescription, `Stunned for ${stunDuration / 1000}s`);
        this.internalEventEmitter.emit('playerBoostEffect', player.key, false, effectDuration, stunDuration);
    }

    /**
     * Updates each player's individual progress based on time and active effects.
     * @param deltaTime Time elapsed since last frame (in milliseconds).
     * @param currentTime Current timestamp (in milliseconds).
     */
    private updatePlayerProgress(deltaTime: number, currentTime: number): void {
        const deltaTimeSeconds = deltaTime / 1000;
        const totalRaceDurationSeconds = this.gameState.raceDuration / 1000;
        const averageRequiredSpeed = 100 / totalRaceDurationSeconds; // Progress units per second needed to finish on time

        this.players.forEach(player => {
            let currentProgress = this.playerProgress[player.key] || 0;
            if (currentProgress >= 100) return; // Player has already finished

            let progressChange = 0;
            const boost = this.playerBoosts[player.key];

            // Check if player is currently stunned
            if (boost && boost.isStun && boost.stunEndTime && currentTime < boost.stunEndTime) {
                progressChange = 0; // Stunned players make no progress
            } else {
                // Base speed with random individual variation
                const individualSpeedFactor = 0.4 + (Math.random() * 1.2); // Factor between 0.4 and 1.6
                let baseSpeed = averageRequiredSpeed * individualSpeedFactor;

                // Human player advantage
                if (player.isHumanPlayer) {
                    baseSpeed *= 1.05; // 5% speed boost for human players
                }

                // Apply temporary boost/stumble (if not stunned or stun has expired)
                if (boost && !boost.isStun) {
                    baseSpeed *= boost.multiplier;
                }
                progressChange = baseSpeed * deltaTimeSeconds;
            }

            // Remove expired boosts
            if (boost && currentTime - boost.startTime > boost.duration) {
                delete this.playerBoosts[player.key];
                this.internalEventEmitter.emit('playerBoostEffectEnd', player.key);
            }

            const newProgress = Math.min(100, Math.max(0, currentProgress + progressChange));
            
            // Check if player just crossed the 100% finish line
            if (newProgress >= 100 && this.playerProgress[player.key] < 100) {
                this.finishedPlayersCount++;
                console.log(`DEBUG: GameLogic: Player ${player.name} just finished. Total finished: ${this.finishedPlayersCount}`);
                this.addEvent(player.key, 'player_finished', `${player.name} has crossed the finish line!`);
            }
            this.playerProgress[player.key] = newProgress;

            // Individual Player Phase Advance Check (e.g., every 10 units of progress)
            const playerCurrentPhase = Math.floor(this.playerProgress[player.key] / (100 / this.phases.length)); // Calculate phase based on progress %
            
            if (this.playerLastPhase[player.key] === undefined) {
                 this.playerLastPhase[player.key] = -1; // Initialize to -1 for the first phase advance
            }

            if (playerCurrentPhase > this.playerLastPhase[player.key] && playerCurrentPhase < this.phases.length) {
                this.playerLastPhase[player.key] = playerCurrentPhase;
                this.internalEventEmitter.emit('playerPhaseAdvance', player.key, playerCurrentPhase);
            }
        });
    }

    /**
     * Recalculates and updates player rankings based on their current progress.
     */
    private updatePositions(): void {
        const sortedPlayers = this.players
            .map(player => ({ player, progress: this.playerProgress[player.key] || 0 }))
            .sort((a, b) => b.progress - a.progress); // Sort in descending order of progress

        sortedPlayers.forEach(({ player }, index) => {
            const newPosition = index + 1;
            const oldPosition = this.gameState.positions[player.key];

            this.gameState.positions[player.key] = newPosition;

            // Overtake events are NOT logged to the UI event log to avoid spam.
            // if (oldPosition && oldPosition !== newPosition && oldPosition > newPosition) {
            //     this.addEvent(player.key, 'overtake', `${player.name} overtook to position ${newPosition}!`);
            // }
        });

        this.gameState.rankings = sortedPlayers.map(sp => sp.player); // Update the game state's official rankings
    }

    /**
     * Adjusts all player speeds slightly if the overall race progress deviates too much
     * from the expected pace, ensuring the race finishes within its intended duration.
     */
    private regulateRaceDuration(): void {
        const expectedProgressRatio = (Date.now() - (this.raceStartTime || Date.now())) / this.gameState.raceDuration;
        const actualOverallRaceProgressRatio = this.gameState.raceProgress / 100;

        if (actualOverallRaceProgressRatio < expectedProgressRatio - this.regulationTolerance) {
            // Race is too slow: apply a tiny boost to all
            this.players.forEach(player => {
                const currentBoost = this.playerBoosts[player.key];
                if (!currentBoost || (currentBoost.isPositive && !currentBoost.isStun)) {
                    this.applyBoost(player, true, 1.002, 100); // 0.2% boost for 0.1 seconds
                }
            });
        } else if (actualOverallRaceProgressRatio > expectedProgressRatio + this.regulationTolerance) {
            // Race is too fast: apply a tiny stumble to all
            this.players.forEach(player => {
                const currentBoost = this.playerBoosts[player.key];
                if (!currentBoost || (!currentBoost.isPositive && !currentBoost.isStun)) {
                    this.applyStumble(player, 100, 20); // 20ms stun for 0.1 seconds
                }
            });
        }
    }

    /**
     * Adds a new event to the internal event log and updates the filtered log for UI.
     * @param playerKey The key of the player involved.
     * @param eventType The type of event.
     * @param description A human-readable description.
     * @param effect Optional: Additional details about the effect.
     */
    private addEvent(playerKey: string, eventType: string, description: string, effect?: string): void {
        const event: GameEvent = {
            id: `event_${this.eventCounter++}`,
            timestamp: Date.now(),
            playerKey,
            eventType,
            description,
            effect
        };

        this.eventLog.push(event);
        if (this.eventLog.length > 500) { // Keep internal log larger but manageable
            this.eventLog.shift();
        }

        // Filter events for UI display: exclude 'overtake' to avoid spam
        const filteredEvents = this.eventLog.filter(e =>
            e.eventType === 'boost_speed' ||
            e.eventType === 'stumble' ||
            e.eventType === 'phase_change' ||
            e.eventType === 'player_finished' ||
            e.eventType.startsWith('system')
        );
        this.gameState.eventLog = filteredEvents.slice(-50); // Show last 50 filtered events in UI
    }

    /**
     * Ends the race, determines the winner and final rankings, and emits a race finished event.
     */
    private endRace(): void {
        if (this.gameState.status === 'finished') {
            console.log("DEBUG: GameLogic: endRace() called but race already finished. Aborting.");
            return;
        }

        console.log("DEBUG: GameLogic: endRace() called. Setting status to 'finished'.");
        this.gameState.status = 'finished';

        // Final sorting for rankings: finished players first (by time), then unfinished players (by progress)
        const sortedPlayersForRanking = this.players
            .map(player => ({
                player,
                progress: this.playerProgress[player.key] || 0,
                // If a player finished, record their raceElapsedTime; otherwise, assign Infinity for sorting
                finishTime: (this.playerProgress[player.key] >= 100) ? this.gameState.raceElapsedTime : Infinity
            }))
            .sort((a, b) => {
                const aFinished = a.progress >= 100;
                const bFinished = b.progress >= 100;

                if (aFinished && !bFinished) return -1; // 'a' finished, 'b' didn't: 'a' comes first
                if (!aFinished && bFinished) return 1;  // 'b' finished, 'a' didn't: 'b' comes first

                // If both finished, sort by finish time (earlier is better)
                if (aFinished && bFinished) {
                    return a.finishTime - b.finishTime;
                }

                // If both didn't finish, sort by progress (higher is better)
                return b.progress - a.progress;
            })
            .map(({ player }) => player); // Extract only the player objects

        this.gameState.winner = sortedPlayersForRanking[0] || null;
        this.gameState.rankings = sortedPlayersForRanking;

        this.addEvent('system', 'race_end', `Race finished! Winner: ${this.gameState.winner?.name || 'N/A'}`);
        console.log("DEBUG: GameLogic: Emitting 'raceFinished' event.");
        this.internalEventEmitter.emit('raceFinished');
    }

    // --- Public Getters ---
    getState(): GameState {
        // Return a defensive copy to prevent external modification
        return {
            ...this.gameState,
            players: [...this.gameState.players],
            rankings: [...this.gameState.rankings],
            eventLog: [...this.gameState.eventLog]
        };
    }

    getAllPlayers(): Player[] {
        return [...this.players];
    }

    getPlayerProgress(playerKey: string): number {
        return (this.playerProgress[playerKey] || 0) / 100; // Normalized 0-1 ratio
    }

    getVisualBoost(playerKey: string): VisualBoost | null {
        return this.playerBoosts[playerKey] || null;
    }

    // --- Event Emitters for Scene Communication ---
    onPlayerPhaseAdvance(callback: (playerKey: string, phaseIndex: number) => void): void {
        this.internalEventEmitter.on('playerPhaseAdvance', callback);
    }
    onRaceFinished(callback: () => void): void {
        this.internalEventEmitter.on('raceFinished', callback);
    }
    onPlayerBoostEffect(callback: (playerKey: string, isPositive: boolean, effectDuration: number, stunDuration?: number) => void): void {
        this.internalEventEmitter.on('playerBoostEffect', callback);
    }
    onPlayerBoostEffectEnd(callback: (playerKey: string) => void): void {
        this.internalEventEmitter.on('playerBoostEffectEnd', callback);
    }
}

// --- Phaser Scene ---
export class WegenRaceScene extends Phaser.Scene {
    private gameLogic!: WegenRaceGameLogic;
    private playerVisualContainers: Map<string, Phaser.GameObjects.Container> = new Map();
    private playerAvatars: Map<string, Phaser.GameObjects.Sprite> = new Map();
    private playerAvatarMasks: Map<string, Phaser.Display.Masks.GeometryMask> = new Map();
    private playerAvatarMaskGraphics: Map<string, Phaser.GameObjects.Graphics> = new Map(); // Graphics object used for mask

    private trackGraphics!: Phaser.GameObjects.Graphics; // For track lines and borders
    private playerProgressBars: Map<string, Phaser.GameObjects.Graphics> = new Map();
    private playerLaneBackgrounds: Map<string, Phaser.GameObjects.Graphics> = new Map();

    private backgroundMusic?: Phaser.Sound.BaseSound;
    private sceneEventEmitter?: Phaser.Events.EventEmitter; // For communicating with React component
    private raceData?: { players: Player[]; duration: number; humanChoice: Player; };

    private countdownText?: Phaser.GameObjects.Text;
    private overallRaceProgressText?: Phaser.GameObjects.Text;
    private raceTitleText?: Phaser.GameObjects.Text;
    private phaseMarkers: Phaser.GameObjects.Graphics[] = [];

    // Dynamic visual effects
    private playerEffectAuras: Map<string, Phaser.GameObjects.Graphics> = new Map();
    private playerEffectIcons: Map<string, Phaser.GameObjects.Sprite> = new Map();
    private playerAuraLaneMasks: Map<string, Phaser.Display.Masks.GeometryMask> = new Map();
    private playerAuraLaneMaskGraphics: Map<string, Phaser.GameObjects.Graphics> = new Map();


    private trackStartX = 0;
    private trackStartY = 0;
    private trackWidth = 0;
    private trackHeight = 0;
    private laneHeight = 0;
    private lastStateEmit = 0; // Throttling state updates to React

    constructor() {
        super({ key: 'WegenRaceScene' });
    }

    preload(): void {
        console.log('📦 Preloading WegenRace assets...');

        // Load static image assets
        this.load.image('G1small', '/WegenRaceAssets/G1small.png');
        this.load.image('boost_icon', '/WegenRaceAssets/turbo.png');
        this.load.image('stumble_icon', '/WegenRaceAssets/obstacle.png');

        // Load audio assets
        this.load.audio('background_music', '/WegenRaceAssets/bg_music.mp3');
        this.load.audio('countdown_tick', '/WegenRaceAssets/beep.wav');
        this.load.audio('race_start_horn', '/WegenRaceAssets/whack.wav');
        this.load.audio('victory_music', '/WegenRaceAssets/finish.wav');
        this.load.audio('celebration_sound', '/WegenRaceAssets/applause.wav');
        this.load.audio('phase_advance_effect', '/WegenRaceAssets/boost1.wav');

        this.load.on('loaderror', (key: string, file: Phaser.Loader.File) => {
            console.error(`⚠️ Failed to load asset: ${key} at ${file.src}`);
        });

        // Handle dynamically loaded avatar images
        this.load.on('filecomplete', (key: string, type: string) => {
            if (type === 'image' && key.startsWith('avatar_')) {
                const playerKey = key.substring('avatar_'.length);
                const avatarSprite = this.playerAvatars.get(playerKey);
                
                if (avatarSprite && this.textures.exists(key)) {
                    console.log(`DEBUG_VISUAL: Applying loaded avatar texture for ${playerKey}.`);
                    avatarSprite.setTexture(key);
                    const avatarSize = this.laneHeight * GAME_CONSTANTS.AVATAR_SIZE_RATIO;
                    avatarSprite.setDisplaySize(avatarSize, avatarSize);
                    this.updateAvatarMask(playerKey, avatarSprite); // Re-apply mask as texture size might change
                } else if (!avatarSprite) {
                    console.warn(`DEBUG_VISUAL: No avatar sprite found for ${playerKey} when texture ${key} completed loading.`);
                } else if (!this.textures.exists(key)) {
                    console.warn(`DEBUG_VISUAL: Texture ${key} still doesn't exist after filecomplete for ${playerKey}.`);
                }
            }
        });
    }

    create(): void {
        console.log('🎮 WegenRaceScene created');

        this.gameLogic = new WegenRaceGameLogic();
        this.trackGraphics = this.add.graphics();
        this.sceneEventEmitter = new Phaser.Events.EventEmitter();

        this.cameras.main.setBackgroundColor('#1a1a2e');

        // Initialize UI elements
        this.raceTitleText = this.add.text(this.scale.width / 2, 30, 'Wegen Race', {
            fontSize: '36px',
            color: '#ffd93b',
            fontFamily: 'SiderFont, Arial',
            shadow: { offsetX: 2, offsetY: 2, color: '#000', blur: 4, fill: true }
        }).setOrigin(0.5).setDepth(spriteDepths.overallUI);

        this.overallRaceProgressText = this.add.text(
            this.scale.width / 2,
            this.scale.height - 40,
            'Overall Progress: 0%  |  Time Left: 00:00',
            {
                fontSize: '18px',
                color: '#ddd',
                fontFamily: 'SiderFont, Arial',
            }
        ).setOrigin(0.5).setDepth(spriteDepths.overallUI);

        // ENHANCEMENT: Animate the race title and progress text slightly
        this.tweens.add({ targets: this.raceTitleText, scale: 1.02, yoyo: true, repeat: -1, duration: 1500, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: this.overallRaceProgressText, alpha: 0.9, yoyo: true, repeat: -1, duration: 1000, ease: 'Sine.easeInOut' });

        // Set up event listeners from the game logic to trigger visual updates
        this.gameLogic.onPlayerPhaseAdvance((playerKey, phaseIndex) => this.handlePlayerPhaseAdvance(playerKey, phaseIndex));
        this.gameLogic.onRaceFinished(() => this.handleRaceFinishedInternal());
        this.gameLogic.onPlayerBoostEffect((playerKey, isPositive, effectDuration, stunDuration) => this.handlePlayerBoostEffect(playerKey, isPositive, effectDuration, stunDuration));
        this.gameLogic.onPlayerBoostEffectEnd((playerKey) => this.handlePlayerBoostEffectEnd(playerKey));

        // Play background music
        const bgMusicSound = this.sound.get('background_music');
        if (bgMusicSound) {
            this.backgroundMusic = this.sound.play('background_music', { loop: true, volume: 0.2 });
        } else {
            console.warn('⚠️ Background music not loaded or not found in sound cache');
        }

        // Emit 'create' event after all scene setup is done, for React to listen to
        this.events.emit('create');
    }

    /**
     * Calculates and sets up the layout dimensions for the track based on screen size.
     */
    private setupLayout(): void {
        const horizontalPadding = this.scale.width * 0.05;
        const verticalPaddingTop = this.scale.height * 0.12;
        const verticalPaddingBottom = this.scale.height * 0.05;

        if (this.raceTitleText) {
            this.raceTitleText.y = verticalPaddingTop / 3;
            this.raceTitleText.setStyle({ fontSize: '48px' });
        }
        if (this.overallRaceProgressText) {
            this.overallRaceProgressText.y = this.scale.height - verticalPaddingBottom / 2;
        }

        this.trackStartX = horizontalPadding;
        this.trackStartY = verticalPaddingTop;
        this.trackWidth = this.scale.width - (horizontalPadding * 2);
        this.trackHeight = this.scale.height - verticalPaddingTop - verticalPaddingBottom;

        console.log('🎯 Track layout:', {
            width: this.trackWidth, height: this.trackHeight,
            startX: this.trackStartX, startY: this.trackStartY
        });
    }

    /**
     * Draws the main track, including lane backgrounds, borders, and phase markers.
     * Destroys existing visuals before redrawing.
     */
    private createTrack(): void {
        const numPlayers = this.raceData ? this.raceData.players.length : 0;
        if (numPlayers === 0) {
            console.warn('⚠️ No players specified for track creation.');
            return;
        }

        // Clear and destroy all previous visual elements
        this.trackGraphics.clear();
        this.phaseMarkers.forEach(m => m.destroy()); this.phaseMarkers = [];
        
        // Destroy player-specific visuals
        this.playerVisualContainers.forEach(container => container.destroy()); this.playerVisualContainers.clear();
        this.playerAvatars.clear();
        this.playerAvatarMasks.forEach(mask => mask.destroy()); this.playerAvatarMasks.clear();
        this.playerAvatarMaskGraphics.forEach(graphics => graphics.destroy()); this.playerAvatarMaskGraphics.clear();
        this.playerEffectAuras.forEach(aura => aura.destroy()); this.playerEffectAuras.clear();
        this.playerEffectIcons.forEach(icon => icon.destroy()); this.playerEffectIcons.clear();
        this.playerProgressBars.forEach(bar => bar.destroy()); this.playerProgressBars.clear();
        this.playerLaneBackgrounds.forEach(bg => bg.destroy()); this.playerLaneBackgrounds.clear();
        this.playerAuraLaneMasks.forEach(mask => mask.destroy()); this.playerAuraLaneMasks.clear();
        this.playerAuraLaneMaskGraphics.forEach(graphics => graphics.destroy()); this.playerAuraLaneMaskGraphics.clear();

        // Calculate dynamic lane height
        const maxSingleLaneHeight = this.trackHeight / 1.5;
        this.laneHeight = Math.min(
            GAME_CONSTANTS.LANE_HEIGHT_MAX,
            Math.max(GAME_CONSTANTS.LANE_HEIGHT_MIN, (this.trackHeight - (numPlayers - 1) * GAME_CONSTANTS.LANE_PADDING) / numPlayers),
            maxSingleLaneHeight
        );
        
        const totalLanesRenderHeight = numPlayers * this.laneHeight + (numPlayers > 1 ? (numPlayers - 1) * GAME_CONSTANTS.LANE_PADDING : 0);

        // Draw outer border for the whole track area
        this.trackGraphics.lineStyle(3, 0x4a4a6e, 0.8);
        this.trackGraphics.strokeRoundedRect(this.trackStartX, this.trackStartY, this.trackWidth, totalLanesRenderHeight, 10);
        this.trackGraphics.setDepth(spriteDepths.trackOutline);

        this.raceData?.players.forEach((player, index) => {
            const laneY = this.trackStartY + (index * (this.laneHeight + GAME_CONSTANTS.LANE_PADDING));
            
            // Player Lane Background
            const laneGraphics = this.add.graphics().setDepth(spriteDepths.trackBackground);
            this.playerLaneBackgrounds.set(player.key, laneGraphics);
            laneGraphics.name = `laneBackground_${player.key}`;

            laneGraphics.fillStyle(0x00FF00, 0.1); // Light transparent green
            laneGraphics.fillRoundedRect(this.trackStartX + 2, laneY + 2, this.trackWidth - 4, this.laneHeight - 4, 10);
            laneGraphics.lineStyle(1.5, 0x309930, 0.6); // Darker green border
            laneGraphics.strokeRoundedRect(this.trackStartX + 2, laneY + 2, this.trackWidth - 4, this.laneHeight - 4, 10);
            // console.log(`DEBUG_VISUAL: Created lane background for ${player.name} at (${this.trackStartX + 2}, ${laneY + 2})`);

            // Create graphics for player progress bar
            const progressBar = this.add.graphics().setDepth(spriteDepths.playerProgressBar);
            this.playerProgressBars.set(player.key, progressBar);
            progressBar.name = `progressBar_${player.key}`;

            // Create mask for player auras to clip to lane boundaries
            const laneMaskGraphics = this.make.graphics({ add: false });
            laneMaskGraphics.name = `auraLaneMaskGraphics_${player.key}`;
            laneMaskGraphics.fillStyle(0xffffff);
            laneMaskGraphics.fillRoundedRect(this.trackStartX, laneY, this.trackWidth, this.laneHeight, 10);
            const laneMask = laneMaskGraphics.createGeometryMask();
            this.playerAuraLaneMasks.set(player.key, laneMask);
            this.playerAuraLaneMaskGraphics.set(player.key, laneMaskGraphics);
            this.add.existing(laneMaskGraphics); // Add to scene to prevent GC
            laneMaskGraphics.setVisible(false);
            // console.log(`DEBUG_VISUAL: Created aura mask graphics for ${player.name} at (${this.trackStartX}, ${laneY})`);
        });

        // Start and Finish lines
        this.trackGraphics.lineStyle(3, 0xFFFFFF, 1);
        this.trackGraphics.lineBetween(this.trackStartX, this.trackStartY, this.trackStartX, this.trackStartY + totalLanesRenderHeight);
        this.add.text(this.trackStartX + 5, this.trackStartY - 20, 'START', {
            fontSize: '14px', color: '#FFFFFF', fontFamily: 'SiderFont, Arial', shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 2, fill: true }
        }).setOrigin(0, 0.5).setDepth(spriteDepths.overallUI);

        this.trackGraphics.lineBetween(this.trackStartX + this.trackWidth, this.trackStartY, this.trackStartX + this.trackWidth, this.trackStartY + totalLanesRenderHeight);
        this.add.text(this.trackStartX + this.trackWidth - 5, this.trackStartY - 20, 'FINISH', {
            fontSize: '14px', color: '#FFFFFF', fontFamily: 'SiderFont, Arial', shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 2, fill: true }
        }).setOrigin(1, 0.5).setDepth(spriteDepths.overallUI);

        // Phase markers and labels
        const numPhases = this.gameLogic.phases.length;
        const phaseSectionWidth = this.trackWidth / numPhases;
        for (let i = 1; i < numPhases; i++) {
            const markerX = this.trackStartX + (phaseSectionWidth * i);
            const markerLine = this.add.graphics().setDepth(spriteDepths.phaseMarkers);
            markerLine.name = `phaseMarkerLine_${i}`;

            markerLine.lineStyle(2, 0x6a6a6a, 0.5);
            markerLine.lineBetween(
                markerX, this.trackStartY,
                markerX, this.trackStartY + totalLanesRenderHeight
            );
            this.phaseMarkers.push(markerLine);

            this.add.text(markerX - phaseSectionWidth / 2, this.trackStartY - 15, `Phase ${i}`, {
                fontSize: '12px', color: '#aaa', fontFamily: 'SiderFont, Arial', align: 'center', shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 1, fill: true }
            }).setOrigin(0.5).setDepth(spriteDepths.overallUI);
        }

        console.log('✅ Track drawn with', numPlayers, 'lanes and phase markers.');
    }

    /**
     * Creates a circular mask for an avatar sprite and applies it.
     * @param playerKey Unique key of the player.
     * @param avatarSprite The avatar sprite to mask.
     */
    private createAvatarMask(playerKey: string, avatarSprite: Phaser.GameObjects.Sprite) {
        // Mask graphics needs to be added to the scene but invisible
        const maskGraphics = this.make.graphics({ add: true, visible: false });
        maskGraphics.name = `avatarMaskGraphics_${playerKey}`;
        this.playerAvatarMaskGraphics.set(playerKey, maskGraphics);

        // Draw a filled circle at the avatar's *local* position within its container
        const radius = avatarSprite.displayWidth / 2;
        maskGraphics.fillCircle(avatarSprite.x, avatarSprite.y, radius);

        const mask = maskGraphics.createGeometryMask();
        avatarSprite.setMask(mask);
        
        this.playerAvatarMasks.set(playerKey, mask);
        // console.log(`DEBUG_VISUAL: Created mask for ${playerKey}. Mask graphics at (${maskGraphics.x}, ${maskGraphics.y})`);
    }

    /**
     * Updates an existing avatar mask's shape when the avatar's texture or size changes.
     * @param playerKey Unique key of the player.
     * @param avatarSprite The avatar sprite whose mask needs updating.
     */
    private updateAvatarMask(playerKey: string, avatarSprite: Phaser.GameObjects.Sprite) {
        let maskGraphics = this.playerAvatarMaskGraphics.get(playerKey);
        if (!maskGraphics) {
            console.warn(`DEBUG_VISUAL: No existing mask graphics for ${playerKey}, creating new one.`);
            this.createAvatarMask(playerKey, avatarSprite);
            maskGraphics = this.playerAvatarMaskGraphics.get(playerKey);
            if (!maskGraphics) return;
        }
        
        maskGraphics.clear(); // Clear previous mask shape
        const radius = avatarSprite.displayWidth / 2;
        maskGraphics.fillCircle(avatarSprite.x, avatarSprite.y, radius);
        // console.log(`DEBUG_VISUAL: Updated mask for ${playerKey} at (${avatarSprite.x}, ${avatarSprite.y}) with radius ${radius}`);
    }

    /**
     * Creates the visual container for a player, including their avatar, name, and border.
     * @param player The player object.
     * @param laneIndex The index of the player's lane.
     */
    private createPlayerVisualContainer(player: Player, laneIndex: number): void {
        const laneYTop = this.trackStartY + (laneIndex * (this.laneHeight + GAME_CONSTANTS.LANE_PADDING));
        const laneCenterY = laneYTop + (this.laneHeight / 2);

        // Container's X is initially set to trackStartX. Its position will be updated based on player progress.
        // Its Y is the center of its lane.
        const container = this.add.container(this.trackStartX, laneCenterY).setDepth(spriteDepths.playerAvatar);
        container.name = `playerContainer_${player.key}`;
        this.playerVisualContainers.set(player.key, container);

        const avatarSize = this.laneHeight * GAME_CONSTANTS.AVATAR_SIZE_RATIO;
        const avatarRadius = avatarSize / 2;
        const avatarLocalX = GAME_CONSTANTS.AVATAR_START_OFFSET_X; // X position of avatar's center relative to container's 0,0
        const avatarLocalY = 0; // Y position of avatar's center relative to container's 0,0 (middle)

        // Create avatar sprite, using default first, then dynamically loaded one
        const currentAvatar = this.add.sprite(avatarLocalX, avatarLocalY, 'G1small'); // Placeholder texture
        currentAvatar.setDisplaySize(avatarSize, avatarSize);
        currentAvatar.setOrigin(0.5); // Center origin for easier positioning and mask
        currentAvatar.name = `avatarSprite_${player.key}`;
        container.add(currentAvatar);
        this.playerAvatars.set(player.key, currentAvatar);
        // console.log(`DEBUG_VISUAL: Created avatar for ${player.name} at local (${avatarLocalX}, ${avatarLocalY}), display size ${avatarSize}`);

        // Create and apply the circular mask
        this.createAvatarMask(player.key, currentAvatar);
        
        // Thick Black Border for the Avatar
        const borderGraphics = this.add.graphics();
        borderGraphics.lineStyle(3, 0x000000, 1);
        borderGraphics.strokeCircle(avatarLocalX, avatarLocalY, avatarRadius);
        container.add(borderGraphics);
        borderGraphics.name = `avatarBorder_${player.key}`;

        // Player Name Text
        const nameTextX = avatarLocalX - avatarRadius - GAME_CONSTANTS.PLAYER_NAME_OFFSET_X;
        const nameText = this.add.text(nameTextX, avatarLocalY, player.name, {
            fontSize: '15px', color: '#fff', fontFamily: 'SiderFont, Arial', align: 'right',
            wordWrap: { width: 100, useWebFonts: true },
            shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 2, fill: true }
        }).setOrigin(1, 0.5);
        nameText.name = `nameText_${player.key}`;
        container.add(nameText);
    }

    update(): void {
        if (!this.gameLogic) return;

        this.gameLogic.update(this.sys.game.loop.delta);

        this.updatePlayerVisuals();
        this.updateOverallRaceProgressUI();

        const now = Date.now();
        if (now - this.lastStateEmit > 100) { // Throttle state emissions
            this.lastStateEmit = now;
            this.emitStateChange();
        }
    }

    /**
     * Updates the position of player avatars and their progress bars based on game logic.
     * Also applies subtle bouncing animation.
     */
    private updatePlayerVisuals(): void {
        const players = this.gameLogic.getAllPlayers();

        players.forEach((player, index) => {
            const container = this.playerVisualContainers.get(player.key);
            const avatar = this.playerAvatars.get(player.key);
            const progressBar = this.playerProgressBars.get(player.key);

            if (!container || !avatar || !progressBar) {
                // This might happen if player data is somehow inconsistent or cleanup is partial
                // console.warn(`DEBUG_VISUAL: Missing component for ${player.key}.`);
                return;
            }

            const progress = this.gameLogic.getPlayerProgress(player.key); // 0-1 ratio

            // Calculate the target X position for the avatar's center in *scene* coordinates.
            // It starts at `trackStartX` + `avatar.width/2` and moves to `trackStartX + trackWidth - avatar.width/2`
            const startX_scene_for_avatar_center = this.trackStartX + (avatar.displayWidth / 2);
            const endX_scene_for_avatar_center = this.trackStartX + this.trackWidth - (avatar.displayWidth / 2);
            const totalTravelDistance_scene = endX_scene_for_avatar_center - startX_scene_for_avatar_center;

            const desiredAvatarCenterX_scene = startX_scene_for_avatar_center + (progress * totalTravelDistance_scene);

            // Now, calculate the container's X position.
            // The container's X + the avatar's local X (GAME_CONSTANTS.AVATAR_START_OFFSET_X) should equal desiredAvatarCenterX_scene.
            container.x = desiredAvatarCenterX_scene - GAME_CONSTANTS.AVATAR_START_OFFSET_X;


            // Apply subtle vertical bounce
            const time = Date.now();
            const bounceOffset = Math.sin(time / 200 + index * 0.5) * 4;
            const laneYTop = this.trackStartY + (index * (this.laneHeight + GAME_CONSTANTS.LANE_PADDING));
            const laneCenterY = laneYTop + (this.laneHeight / 2);
            container.y = laneCenterY + bounceOffset;

            // Update player's progress bar
            progressBar.clear();
            const progressBarWidth = progress * this.trackWidth;
            const progressBarHeight = this.laneHeight * GAME_CONSTANTS.PROGRESS_BAR_HEIGHT_RATIO;
            const progressBarX = this.trackStartX + 2; // Keep it slightly inside the track border
            const progressBarY = laneYTop + this.laneHeight - progressBarHeight - 2; // Position at bottom of lane

            progressBar.fillStyle(0xFFD700, 0.8); // Gold color
            progressBar.fillRoundedRect(progressBarX, progressBarY, progressBarWidth, progressBarHeight, GAME_CONSTANTS.PROGRESS_BAR_ROUND_RADIUS);

            // Reset avatar scale and tint if no boost effect is active
            const boost = this.gameLogic.getVisualBoost(player.key);
            if (!boost) {
                avatar.clearTint();
                avatar.setScale(1);
            }
        });
    }

    /**
     * Updates the text display for the overall race progress and time remaining.
     */
    private updateOverallRaceProgressUI(): void {
        if (this.overallRaceProgressText) {
            const overallProgress = this.gameLogic.getState().raceProgress;
            const timeRemaining = this.gameLogic.getState().timeRemaining;
            const timeLeftFormatted = new Date(timeRemaining).toISOString().substr(14, 5); // MM:SS

            this.overallRaceProgressText.setText(
                `Overall Progress: ${Math.floor(overallProgress)}%  |  Time Left: ${timeLeftFormatted}`
            );
            // Position the text relative to the track bounds for consistency
            this.overallRaceProgressText.x = this.trackStartX + (this.trackWidth / 2);
        }
    }

    /**
     * Emits the current game state to the React component.
     */
    private emitStateChange(): void {
        if (this.sceneEventEmitter) {
            this.sceneEventEmitter.emit('stateChange', this.gameLogic.getState());
        }
    }

    /**
     * Handles visual feedback when a player advances a phase (e.g., subtle avatar bounce, tint).
     * @param playerKey Unique key of the player.
     * @param phaseIndex The index of the phase the player entered.
     */
    private handlePlayerPhaseAdvance(playerKey: string, phaseIndex: number): void {
        const avatar = this.playerAvatars.get(playerKey);
        if (avatar) {
            // Avatar scale and tint animation
            this.tweens.add({
                targets: avatar,
                scaleX: { from: avatar.scaleX, to: avatar.scaleX * 1.15 },
                scaleY: { from: avatar.scaleY, to: avatar.scaleY * 1.15 },
                duration: 150, ease: 'Power1', yoyo: true,
                onComplete: () => {
                    const boost = this.gameLogic.getVisualBoost(playerKey);
                    if (!boost) avatar.setScale(1);
                }
            });

            const boost = this.gameLogic.getVisualBoost(playerKey);
            if (!boost) { // Apply temporary tint only if no other boost is active
                avatar.setTint(0xffd700); // Golden tint
                this.time.delayedCall(200, () => avatar.clearTint());
            }
        }
        const phaseSound = this.sound.get('phase_advance_effect');
        if (phaseSound) phaseSound.play({ volume: 0.1 });
    }

    /**
     * Handles visual effects for player boosts or stumbles (auras, icons, tints).
     * @param playerKey Unique key of the player.
     * @param isPositive True for a boost, false for a stumble.
     * @param effectDuration Total duration of the effect.
     * @param stunDuration Optional: Duration of stun if applicable.
     */
    private handlePlayerBoostEffect(playerKey: string, isPositive: boolean, effectDuration: number, stunDuration?: number): void {
        const container = this.playerVisualContainers.get(playerKey);
        const avatar = this.playerAvatars.get(playerKey);
        const laneBackground = this.playerLaneBackgrounds.get(playerKey);
        const auraLaneMask = this.playerAuraLaneMasks.get(playerKey);

        if (!container || !avatar || !laneBackground || !auraLaneMask) {
            console.warn(`Missing visual component for ${playerKey}. Cannot apply boost effect.`);
            return;
        }

        const playerIndex = this.gameLogic.getAllPlayers().findIndex(p => p.key === playerKey);
        const laneYTop = this.trackStartY + (playerIndex * (this.laneHeight + GAME_CONSTANTS.LANE_PADDING));
        const laneX = this.trackStartX;
        const laneWidth = this.trackWidth;
        const laneHeight = this.laneHeight;

        // Lane Background Flash Effect
        const originalColor = 0x00FF00;
        const originalAlpha = 0.1;
        const flashColor = isPositive ? 0x00AA00 : 0xAA0000; // Darker green/red
        const flashAlpha = 0.3;

        laneBackground.clear();
        laneBackground.fillStyle(flashColor, flashAlpha);
        laneBackground.fillRoundedRect(laneX + 2, laneYTop + 2, laneWidth - 4, laneHeight - 4, 10);
        laneBackground.lineStyle(1.5, 0x309930, 0.6); // Darker green border
        laneBackground.strokeRoundedRect(laneX + 2, laneYTop + 2, laneWidth - 4, laneHeight - 4, 10);

        this.tweens.add({
            targets: laneBackground,
            alpha: { from: flashAlpha, to: originalAlpha },
            duration: 500, ease: 'Linear',
            onComplete: () => {
                laneBackground.alpha = 1;
                laneBackground.clear();
                laneBackground.fillStyle(originalColor, originalAlpha);
                laneBackground.fillRoundedRect(laneX + 2, laneYTop + 2, laneWidth - 4, this.laneHeight - 4, 10);
                laneBackground.lineStyle(1.5, 0x309930, 0.6);
                laneBackground.strokeRoundedRect(laneX + 2, laneYTop + 2, laneWidth - 4, this.laneHeight - 4, 10);
            }
        });

        // Aura Effect (around avatar)
        let aura = this.playerEffectAuras.get(playerKey);
        const auraRadius = avatar.displayWidth / 2 + 10;
        const highlightColor = isPositive ? 0x00FF00 : 0xFF0000;

        if (!aura) {
            aura = this.add.graphics();
            aura.name = `aura_${playerKey}`;
            this.playerEffectAuras.set(playerKey, aura);
            container.add(aura);
            aura.setDepth(spriteDepths.laneHighlight); // Aura should be behind avatar
            aura.setMask(auraLaneMask); // Mask to lane
        }
        aura.clear();
        aura.fillStyle(highlightColor, 0.4);
        aura.fillCircle(avatar.x, avatar.y, auraRadius); // Position relative to container
        this.tweens.killTweensOf(aura);
        aura.alpha = 1;
        this.tweens.add({ targets: aura, alpha: { from: 0.8, to: 0.2 }, yoyo: true, repeat: -1, duration: 500 });

        // Icon Effect (above avatar)
        let icon = this.playerEffectIcons.get(playerKey);
        const iconKey = isPositive ? 'boost_icon' : 'stumble_icon';
        const iconOffsetX = avatar.displayWidth / 2 + 5;
        const iconOffsetY = avatar.displayHeight / 2 + 5;

        if (icon) {
            icon.setTexture(iconKey);
            icon.setPosition(avatar.x + iconOffsetX, avatar.y - iconOffsetY);
            icon.setVisible(true);
        } else {
            icon = this.add.sprite(avatar.x + iconOffsetX, avatar.y - iconOffsetY, iconKey);
            icon.setDisplaySize(24, 24);
            icon.setOrigin(0.5);
            icon.setDepth(spriteDepths.playerAvatar + 2); // Above avatar
            icon.name = `effectIcon_${playerKey}`;
            container.add(icon);
            this.playerEffectIcons.set(playerKey, icon);
        }

        // Apply tint and scale changes directly to the avatar
        avatar.setTint(highlightColor);
        avatar.setScale(isPositive ? 1.15 : 0.85);

        // Stun specific visual: pulsating alpha
        if (stunDuration && !isPositive) {
            this.tweens.add({
                targets: avatar,
                alpha: { from: 1, to: 0.5 },
                duration: stunDuration / 2,
                yoyo: true,
                repeat: Math.floor(effectDuration / (stunDuration / 2)),
                onComplete: () => avatar.alpha = 1
            });
        }
    }

    /**
     * Handles the end of a player's boost/stumble effect, resetting visuals.
     * @param playerKey Unique key of the player.
     */
    private handlePlayerBoostEffectEnd(playerKey: string): void {
        const avatar = this.playerAvatars.get(playerKey);
        const aura = this.playerEffectAuras.get(playerKey);
        const icon = this.playerEffectIcons.get(playerKey);
        
        if (avatar) {
            avatar.clearTint();
            avatar.setScale(1);
            avatar.alpha = 1;
        }

        if (aura) {
            this.tweens.killTweensOf(aura);
            this.tweens.add({
                targets: aura,
                alpha: 0,
                duration: 300,
                onComplete: () => { aura.destroy(); this.playerEffectAuras.delete(playerKey); }
            });
        }
        if (icon) {
            icon.setVisible(false);
            icon.destroy();
            this.playerEffectIcons.delete(playerKey);
        }
    }

    /**
     * Internal callback for when the race finishes, triggers celebration and emits 'gameEnd'.
     */
    private handleRaceFinishedInternal(): void {
        if (this.gameLogic.getState().status !== 'finished') {
             console.warn("DEBUG: Phaser: handleRaceFinishedInternal called, but gameLogic status is not 'finished'. Forcing state.");
             this.gameLogic.getState().status = 'finished';
        }
        
        console.log('🏆 Internal race finished callback triggered in Phaser scene.');
        this.addCelebrationEffect();
        const victorySound = this.sound.get('victory_music');
        if (victorySound) victorySound.play({ volume: 0.3 });
        else console.warn('⚠️ Victory music not loaded.');

        console.log("DEBUG: Phaser: Emitting 'gameEnd' event to React. Winner:", this.gameLogic.getState().winner?.name, "Rankings count:", this.gameLogic.getState().rankings.length);
        this.sceneEventEmitter.emit('gameEnd', this.gameLogic.getState().winner, this.gameLogic.getState().rankings);
    }

    /**
     * Adds confetti and plays a celebration sound when the race finishes.
     */
    private addCelebrationEffect(): void {
        const { width, height } = this.sys.game.canvas;

        for (let i = 0; i < 70; i++) {
            const confetti = this.add.rectangle(
                Phaser.Math.Between(0, width),
                -50, // Start above screen
                Phaser.Math.Between(5, 17), // Random width
                Phaser.Math.Between(5, 17), // Random height
                Phaser.Display.Color.GetColor( // Random color
                    Phaser.Math.Between(0, 255), Phaser.Math.Between(0, 255), Phaser.Math.Between(0, 255)
                )
            ).setDepth(spriteDepths.confetti);

            this.tweens.add({
                targets: confetti,
                y: height + 50, // Fall below screen
                rotation: Phaser.Math.Between(0, Math.PI * 4), // Spin
                duration: Phaser.Math.Between(2500, 4000), // Random duration
                ease: 'Power2',
                onComplete: () => confetti.destroy()
            });
        }
        const applauseSound = this.sound.get('celebration_sound');
        if (applauseSound) applauseSound.play({ volume: 0.3 });
        else console.warn('⚠️ Celebration sound not loaded.');
    }

    /**
     * Initializes the race data in the Phaser scene, queues avatar loading,
     * sets up the layout, and creates the track and player visuals.
     * @param players Array of players.
     * @param durationMinutes Race duration in minutes.
     * @param humanChoice The human player's chosen participant.
     */
    public initializeRaceWithData(players: Player[], durationMinutes: number, humanChoice: Player): void {
        console.log('🚀 Initializing race with data:', { players: players.length, durationMinutes, humanChoice: humanChoice.name });

        // Queue all player avatars for loading
        players.forEach(player => {
            const dynamicAvatarKey = `avatar_${player.key}`;
            if (player.avatarUrl && !this.textures.exists(dynamicAvatarKey)) {
                console.log(`Queuing avatar for ${player.name} (${player.key}) from ${player.avatarUrl}`);
                this.load.image(dynamicAvatarKey, player.avatarUrl);
            } else if (!player.avatarUrl) {
                console.warn(`Player ${player.name} (${player.key}) has no avatarUrl. Using default 'G1small.png'.`);
                // 'G1small' is always preloaded, so no extra load needed here.
            } else if (this.textures.exists(dynamicAvatarKey)) {
                console.log(`Avatar for ${player.name} (${player.key}) already loaded/cached.`);
            }
        });
        this.load.start(); // Start the queued loading process

        this.gameLogic.initializeRace(players, durationMinutes);
        this.raceData = { players, duration: durationMinutes, humanChoice };
        
        this.setupLayout();
        this.createTrack(); // This also cleans up previous visuals if any

        // Create player visuals and attempt to set their correct avatar texture
        players.forEach((player, index) => {
            this.createPlayerVisualContainer(player, index);
            const avatarSprite = this.playerAvatars.get(player.key);
            const dynamicAvatarKey = `avatar_${player.key}`;
            if (avatarSprite) {
                // If avatar image is already loaded (either from cache or finished loading quickly)
                if (this.textures.exists(dynamicAvatarKey)) {
                    console.log(`DEBUG_VISUAL: Applying already loaded avatar texture for ${player.name} on creation.`);
                    avatarSprite.setTexture(dynamicAvatarKey);
                    const avatarSize = this.laneHeight * GAME_CONSTANTS.AVATAR_SIZE_RATIO;
                    avatarSprite.setDisplaySize(avatarSize, avatarSize);
                    this.updateAvatarMask(player.key, avatarSprite);
                } else {
                    console.log(`DEBUG_VISUAL: Dynamic avatar for ${player.name} not yet loaded. Using 'G1small'.`);
                }
            }
        });
        console.log('✅ Race initialized with', players.length, 'players in scene.');
    }

    /**
     * Starts the race countdown logic within the scene.
     */
    public startRaceExternally(): void {
        console.log('🏁 Starting race externally (countdown initiated)');
        this.startCountdown();
    }

    /**
     * Manages the visual and audio countdown sequence before the race starts.
     */
    private startCountdown(): void {
        const centerX = this.scale.width / 2;
        const centerY = this.scale.height / 2;

        this.countdownText = this.add.text(centerX, centerY, '3', {
            fontSize: '96px', color: '#ffd93b', fontFamily: 'SiderFont, Arial', fontStyle: 'bold',
            shadow: { offsetX: 3, offsetY: 3, color: '#000', blur: 5, fill: true }
        }).setOrigin(0.5).setDepth(spriteDepths.countdown);

        const tickSound = this.sound.get('countdown_tick');
        const startSound = this.sound.get('race_start_horn');

        const playTick = () => { if (tickSound) tickSound.play({ volume: 0.3 }); };

        this.time.delayedCall(1000, () => {
            if (this.countdownText) { this.countdownText.setText('2'); this.tweens.add({ targets: this.countdownText, scale: 1.1, duration: 200, yoyo: true }); playTick(); }
        });
        this.time.delayedCall(2000, () => {
            if (this.countdownText) { this.countdownText.setText('1'); this.tweens.add({ targets: this.countdownText, scale: 1.1, duration: 200, yoyo: true }); playTick(); }
        });
        this.time.delayedCall(3000, () => {
            if (this.countdownText) {
                this.countdownText.setText('GO!');
                this.tweens.add({
                    targets: this.countdownText, scale: 1.5, alpha: 0, duration: 500,
                    onComplete: () => { this.countdownText?.destroy(); this.countdownText = undefined; }
                });
                if (startSound) startSound.play({ volume: 0.3 });
                else console.warn('⚠️ Race start sound not loaded.');
                this.gameLogic.startRace();
            }
        });
    }

    /**
     * Returns the current game state from the game logic.
     */
    public getGameState(): GameState {
        if (!this.gameLogic) {
            console.warn("Attempted to get game state before gameLogic was initialized.");
            return {
                status: 'waiting', raceProgress: 0, raceElapsedTime: 0, raceDuration: 0,
                currentPhase: 'Initializing', timeRemaining: 0, players: [], positions: {},
                winner: null, rankings: [], eventLog: []
            };
        }
        return this.gameLogic.getState();
    }

    /**
     * Subscribes a callback to state change events emitted by the scene.
     * @param callback Function to call when game state changes.
     */
    public onStateChange(callback: (state: GameState) => void): void {
        if (this.sceneEventEmitter) {
            this.sceneEventEmitter.on('stateChange', callback);
        }
    }

    /**
     * Subscribes a callback to the game end event.
     * @param callback Function to call when the game finishes.
     */
    public onGameEnd(callback: (winner: Player | null, rankings: Player[]) => void): void {
        if (this.sceneEventEmitter) {
            console.log("DEBUG: Phaser Scene: Subscribing to 'gameEnd' event.");
            this.sceneEventEmitter.on('gameEnd', callback);
        }
    }

    /**
     * Exports race data for post-game analysis or display.
     */
    public exportRaceData(): any {
        if (!this.gameLogic) {
            console.warn("Attempted to export race data before gameLogic was initialized. Returning null.");
            return null;
        }
        const state = this.gameLogic.getState();
        return {
            winner: state.winner,
            rankings: state.rankings,
            finalProgress: state.raceProgress, // Overall race final progress
            raceTime: state.raceElapsedTime, // Total elapsed time of the race
            eventLog: state.eventLog,
            playerCount: state.players.length
        };
    }

    /**
     * Cleans up all Phaser objects and event listeners when the scene is shut down.
     */
    destroy(): void {
        console.log("Cleaning up WegenRaceScene...");
        if (this.sceneEventEmitter) { this.sceneEventEmitter.destroy(); this.sceneEventEmitter = undefined; }

        this.playerVisualContainers.forEach(container => container.destroy()); this.playerVisualContainers.clear();
        this.playerAvatars.clear(); // Sprites are destroyed with their containers, but clear map references
        this.playerAvatarMasks.forEach(mask => mask.destroy()); this.playerAvatarMasks.clear();
        this.playerAvatarMaskGraphics.forEach(graphics => graphics.destroy()); this.playerAvatarMaskGraphics.clear();

        this.phaseMarkers.forEach(m => m.destroy()); this.phaseMarkers = [];

        this.playerEffectAuras.forEach(aura => aura.destroy()); this.playerEffectAuras.clear();
        this.playerEffectIcons.forEach(icon => icon.destroy()); this.playerEffectIcons.clear();
        this.playerProgressBars.forEach(bar => bar.destroy()); this.playerProgressBars.clear();
        this.playerLaneBackgrounds.forEach(bg => bg.destroy()); this.playerLaneBackgrounds.clear();
        this.playerAuraLaneMasks.forEach(mask => mask.destroy()); this.playerAuraLaneMasks.clear();
        this.playerAuraLaneMaskGraphics.forEach(graphics => graphics.destroy()); this.playerAuraLaneMaskGraphics.clear();

        if (this.trackGraphics) this.trackGraphics.destroy();
        if (this.countdownText) this.countdownText.destroy();
        if (this.overallRaceProgressText) this.overallRaceProgressText.destroy();
        if (this.raceTitleText) this.raceTitleText.destroy();

        if (this.backgroundMusic && this.backgroundMusic.isPlaying) {
            this.backgroundMusic.stop();
            this.backgroundMusic = undefined;
        }

        // Destroy internal event emitter of game logic
        if ((this.gameLogic as any)?.internalEventEmitter) {
             (this.gameLogic as any).internalEventEmitter.destroy();
        }

        super.destroy();
        console.log("WegenRaceScene cleanup complete.");
    }
}

// --- Game Factory Functions ---
/**
 * Creates and returns a new Phaser.Game instance.
 * @param container The HTML element where the game canvas will be appended.
 */
export function createWegenRaceGame(container: HTMLElement): Phaser.Game {
    const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        width: container.clientWidth || 800, // Use container size or default
        height: container.clientHeight || 500,
        parent: container,
        backgroundColor: '#1a1a2e',
        scene: WegenRaceScene,
        physics: {
            default: 'arcade',
            arcade: {
                gravity: { y: 0, x: 0 },
                debug: false // Set to true for physics debugging visuals
            }
        },
        audio: { disableWebAudio: false },
        scale: {
            mode: Phaser.Scale.FIT, // Scale game to fit parent container
            autoCenter: Phaser.Scale.CENTER_BOTH, // Center canvas in parent
            width: container.clientWidth || 800,
            height: container.clientHeight || 500
        }
    };

    return new Phaser.Game(config);
}

/**
 * Destroys a Phaser.Game instance, safely stopping its scene and removing it from the DOM.
 * @param game The Phaser.Game instance to destroy.
 */
export function destroyWegenRaceGame(game: Phaser.Game): void {
    if (game && !game.isDestroyed) {
        game.scene.stop('WegenRaceScene');
        game.scene.remove('WegenRaceScene');
        game.destroy(true); // Destroy game and its canvas
    }
}

/**
 * Retrieves the WegenRaceScene instance from a Phaser.Game.
 * @param game The Phaser.Game instance.
 */
export function getWegenRaceScene(game: Phaser.Game): WegenRaceScene | null {
    if (!game || game.isDestroyed) return null;
    return game.scene.getScene('WegenRaceScene') as WegenRaceScene;
}

/**
 * Checks if the Phaser game and its scene are valid and running.
 * @param game The Phaser.Game instance.
 */
export function isGameValid(game: Phaser.Game): boolean {
    return !!game && !game.isDestroyed && !!game.scene && !!game.scene.getScene('WegenRaceScene');
}

// --- Exports ---
export { WegenRaceGameLogic };
export type { Player, GameState, GameEvent, VisualBoost };

// --- Debug Utilities ---
/**
 * Enables debug mode, exposing game and scene objects on the window for console inspection.
 * @param game The Phaser.Game instance.
 */
export function enableDebugMode(game: Phaser.Game): void {
    const scene = getWegenRaceScene(game);
    if (scene) {
        console.log("🐛 Debug mode enabled for Wegen Race. Access via window.wegenRaceDebug");
        (window as any).wegenRaceDebug = {
            game,
            scene,
            gameLogic: (scene as any).gameLogic, // Direct access to game logic
            getState: () => scene.getGameState(),
            exportData: () => scene.exportRaceData()
        };
    }
}

console.log("🎮 WegenRaceGame.ts loaded successfully.");