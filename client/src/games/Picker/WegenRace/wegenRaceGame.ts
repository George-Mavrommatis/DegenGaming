// src/games/Picker/WegenRace/wegenRaceGame.ts

import Phaser from 'phaser';

// --- Types ---
interface Player {
    key: string;
    name: string;
    username?: string;
    wallet?: string;
    avatarUrl?: string;
    isHumanPlayer?: boolean;
    isGuest?: boolean;
}

interface GameState {
    status: 'waiting' | 'countdown' | 'racing' | 'finished';
    raceProgress: number;
    raceElapsedTime: number;
    raceDuration: number;
    currentPhase: string;
    timeRemaining: number;
    players: Player[];
    positions: Record<string, number>;
    winner: Player | null;
    rankings: Player[];
    eventLog: GameEvent[];
}

interface GameEvent {
    id: string;
    timestamp: number;
    playerKey: string;
    eventType: string;
    description: string;
    effect?: string;
}

interface VisualBoost {
    isPositive: boolean;
    multiplier: number;
    duration: number;
    startTime: number;
    isStun?: boolean;
    stunEndTime?: number;
}

// --- Constants for Game Configuration and Visuals ---
export const GAME_CONSTANTS = {
    PHASES_COUNT: 10,
    MIN_RACE_DURATION: 1,
    MAX_RACE_DURATION: 60,
    MAX_PLAYERS: 50,
    MIN_PLAYERS: 2,

    REGULATION_TOLERANCE: 0.20,

    BOOST_DURATION_MIN: 2500,
    BOOST_DURATION_MAX: 7000,
    BOOST_MULTIPLIER_MIN: 1.5,
    BOOST_MULTIPLIER_MAX: 2.5,
    STUMBLE_DURATION_MIN: 2500,
    STUMBLE_DURATION_MAX: 7000,
    STUN_DURATION_MIN: 400,
    STUN_DURATION_MAX: 1000,

    LANE_HEIGHT_MIN: 60,
    LANE_HEIGHT_MAX: 100,
    LANE_PADDING: 5,
    AVATAR_SIZE_RATIO: 0.7,
    AVATAR_START_OFFSET_X: 30,
    PLAYER_NAME_OFFSET_X: 10,
    PROGRESS_BAR_HEIGHT_RATIO: 0.2,
    PROGRESS_BAR_ROUND_RADIUS: 5
} as const;

// --- Sprite Depths for Layering in Phaser ---
const enum spriteDepths {
    trackOutline = 0,
    trackBackground = 1,
    playerProgressBar = 2,
    laneHighlight = 3,
    phaseMarkers = 4,
    playerAvatar = 10,
    particles = 12,
    countdown = 100,
    confetti = 200,
    overallUI = 250
}

// --- Game Logic Engine ---
class WegenRaceGameLogic {
    private players: Player[] = [];
    private gameState: GameState;
    public phases: string[] = [
        'Starting Grid', 'Acceleration', 'Tight Corner', 'Mid-Race Push', 'Strategic Maneuver',
        'Power Lap', 'Challenge Zone', 'Final Stretch', 'Clash Ahead', 'Photo Finish'
    ];
    private currentPhaseIndex = 0;
    private raceStartTime: number | null = null;
    private playerProgress: Record<string, number> = {};
    private playerLastPhase: Record<string, number> = {};
    private playerBoosts: Record<string, VisualBoost> = {};
    private eventLog: GameEvent[] = [];
    private eventCounter = 0;
    private regulationTolerance: number = GAME_CONSTANTS.REGULATION_TOLERANCE;

    private finishedPlayersCount = 0;
    private finishThreshold: number = 0;

    private internalEventEmitter: Phaser.Events.EventEmitter;

    constructor() {
        this.internalEventEmitter = new Phaser.Events.EventEmitter();
        this.gameState = {
            status: 'waiting',
            raceProgress: 0,
            raceElapsedTime: 0,
            raceDuration: 300000,
            currentPhase: this.phases[0],
            timeRemaining: 300000,
            players: [],
            positions: {},
            winner: null,
            rankings: [],
            eventLog: []
        };
    }

    initializeRace(players: Player[], durationMinutes: number): void {
        this.players = [...players];
        this.gameState.players = [...players];
        this.gameState.raceDuration = durationMinutes * 60 * 1000;
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

        this.finishThreshold = Math.max(1, Math.ceil(players.length * 0.4));
        console.log(`DEBUG: GameLogic: Race will end when ${this.finishThreshold} players finish.`);

        this.players.forEach(player => {
            this.playerProgress[player.key] = 0;
            this.playerLastPhase[player.key] = -1;
        });

        this.addEvent('system', 'race_initialized', `Race initialized with ${players.length} players for ${durationMinutes} minutes.`);
        console.log('🏁 Race initialized with players:', players.map(p => p.name));
    }

    startRace(): void {
        if (this.gameState.status !== 'waiting' && this.gameState.status !== 'countdown') return;

        this.gameState.status = 'racing';
        this.raceStartTime = Date.now();
        this.addEvent('system', 'race_start', 'Race has begun!');
    }

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

        if (this.finishedPlayersCount >= this.finishThreshold) {
            this.endRace();
        } else if (this.gameState.timeRemaining <= 0) {
            this.players.forEach(player => {
                if (this.playerProgress[player.key] < 100) {
                    this.playerProgress[player.key] = 100;
                }
            });
            this.endRace();
        }
    }

    private updatePhase(elapsedTime: number): void {
        const phaseDuration = this.gameState.raceDuration / this.phases.length;
        const targetPhaseIndex = Math.min(Math.floor(elapsedTime / phaseDuration), this.phases.length - 1);

        if (targetPhaseIndex !== this.currentPhaseIndex) {
            this.currentPhaseIndex = targetPhaseIndex;
            this.gameState.currentPhase = this.phases[this.currentPhaseIndex];
            this.addEvent('system', 'phase_change', `Entering ${this.gameState.currentPhase}`);
            this.triggerPhaseBoosts();
        }

        this.gameState.raceProgress = (elapsedTime / this.gameState.raceDuration) * 100;
        this.gameState.raceProgress = Math.min(100, Math.max(0, this.gameState.raceProgress));
    }

    private triggerPhaseBoosts(): void {
        const numPlayersToAffect = Math.max(1, Math.ceil(this.players.length * 0.5));
        const shuffledPlayers = [...this.players].sort(() => 0.5 - Math.random());

        for (let i = 0; i < numPlayersToAffect && i < shuffledPlayers.length; i++) {
            const player = shuffledPlayers[i];
            const isPositive = Math.random() < 0.6;
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

    private applyStumble(player: Player, effectDuration: number, stunDuration: number): void {
        const currentTime = Date.now();
        this.playerBoosts[player.key] = {
            isPositive: false,
            multiplier: 0,
            duration: effectDuration,
            startTime: currentTime,
            isStun: true,
            stunEndTime: currentTime + stunDuration
        };
        const eventDescription = `${player.name} stumbles and halts!`;
        this.addEvent(player.key, 'stumble', eventDescription, `Stunned for ${stunDuration / 1000}s`);
        this.internalEventEmitter.emit('playerBoostEffect', player.key, false, effectDuration, stunDuration);
    }

    private updatePlayerProgress(deltaTime: number, currentTime: number): void {
        const deltaTimeSeconds = deltaTime / 1000;
        const totalRaceDurationSeconds = this.gameState.raceDuration / 1000;
        const averageRequiredSpeed = 100 / totalRaceDurationSeconds;

        this.players.forEach(player => {
            let currentProgress = this.playerProgress[player.key] || 0;
            if (currentProgress >= 100) return;

            let progressChange = 0;
            const boost = this.playerBoosts[player.key];

            if (boost && boost.isStun && boost.stunEndTime && currentTime < boost.stunEndTime) {
                progressChange = 0;
            } else {
                const individualSpeedFactor = 0.4 + (Math.random() * 1.2);
                let baseSpeed = averageRequiredSpeed * individualSpeedFactor;
                if (player.isHumanPlayer) {
                    baseSpeed *= 1.05;
                }
                if (boost && !boost.isStun) {
                    baseSpeed *= boost.multiplier;
                }
                progressChange = baseSpeed * deltaTimeSeconds;
            }

            if (boost && currentTime - boost.startTime > boost.duration) {
                delete this.playerBoosts[player.key];
                this.internalEventEmitter.emit('playerBoostEffectEnd', player.key);
            }

            const newProgress = Math.min(100, Math.max(0, currentProgress + progressChange));
            if (newProgress >= 100 && this.playerProgress[player.key] < 100) {
                this.finishedPlayersCount++;
                this.addEvent(player.key, 'player_finished', `${player.name} has crossed the finish line!`);
            }
            this.playerProgress[player.key] = newProgress;

            const playerCurrentPhase = Math.floor(this.playerProgress[player.key] / (100 / this.phases.length));
            if (this.playerLastPhase[player.key] === undefined) {
                 this.playerLastPhase[player.key] = -1;
            }
            if (playerCurrentPhase > this.playerLastPhase[player.key] && playerCurrentPhase < this.phases.length) {
                this.playerLastPhase[player.key] = playerCurrentPhase;
                this.internalEventEmitter.emit('playerPhaseAdvance', player.key, playerCurrentPhase);
            }
        });
    }

    private updatePositions(): void {
        const sortedPlayers = this.players
            .map(player => ({ player, progress: this.playerProgress[player.key] || 0 }))
            .sort((a, b) => b.progress - a.progress);

        sortedPlayers.forEach(({ player }, index) => {
            const newPosition = index + 1;
            this.gameState.positions[player.key] = newPosition;
        });

        this.gameState.rankings = sortedPlayers.map(sp => sp.player);
    }

    private regulateRaceDuration(): void {
        const expectedProgressRatio = (Date.now() - (this.raceStartTime || Date.now())) / this.gameState.raceDuration;
        const actualOverallRaceProgressRatio = this.gameState.raceProgress / 100;

        if (actualOverallRaceProgressRatio < expectedProgressRatio - this.regulationTolerance) {
            this.players.forEach(player => {
                const currentBoost = this.playerBoosts[player.key];
                if (!currentBoost || (currentBoost.isPositive && !currentBoost.isStun)) {
                    this.applyBoost(player, true, 1.002, 100);
                }
            });
        } else if (actualOverallRaceProgressRatio > expectedProgressRatio + this.regulationTolerance) {
            this.players.forEach(player => {
                const currentBoost = this.playerBoosts[player.key];
                if (!currentBoost || (!currentBoost.isPositive && !currentBoost.isStun)) {
                    this.applyStumble(player, 100, 20);
                }
            });
        }
    }

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
        if (this.eventLog.length > 500) {
            this.eventLog.shift();
        }

        const filteredEvents = this.eventLog.filter(e =>
            e.eventType === 'boost_speed' ||
            e.eventType === 'stumble' ||
            e.eventType === 'phase_change' ||
            e.eventType === 'player_finished' ||
            e.eventType.startsWith('system')
        );
        this.gameState.eventLog = filteredEvents.slice(-50);
    }

    private endRace(): void {
        if (this.gameState.status === 'finished') {
            return;
        }

        this.gameState.status = 'finished';

        const sortedPlayersForRanking = this.players
            .map(player => ({
                player,
                progress: this.playerProgress[player.key] || 0,
                finishTime: (this.playerProgress[player.key] >= 100) ? this.gameState.raceElapsedTime : Infinity
            }))
            .sort((a, b) => {
                const aFinished = a.progress >= 100;
                const bFinished = b.progress >= 100;
                if (aFinished && !bFinished) return -1;
                if (!aFinished && bFinished) return 1;
                if (aFinished && bFinished) {
                    return a.finishTime - b.finishTime;
                }
                return b.progress - a.progress;
            })
            .map(({ player }) => player);

        this.gameState.winner = sortedPlayersForRanking[0] || null;
        this.gameState.rankings = sortedPlayersForRanking;

        this.addEvent('system', 'race_end', `Race finished! Winner: ${this.gameState.winner?.name || 'N/A'}`);
        this.internalEventEmitter.emit('raceFinished');
    }

    getState(): GameState {
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
        return (this.playerProgress[playerKey] || 0) / 100;
    }

    getVisualBoost(playerKey: string): VisualBoost | null {
        return this.playerBoosts[playerKey] || null;
    }

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
    private playerAvatarMaskGraphics: Map<string, Phaser.GameObjects.Graphics> = new Map();

    private trackGraphics!: Phaser.GameObjects.Graphics;
    private playerProgressBars: Map<string, Phaser.GameObjects.Graphics> = new Map();
    private playerLaneBackgrounds: Map<string, Phaser.GameObjects.Graphics> = new Map();

    private backgroundMusic?: Phaser.Sound.BaseSound;
    private sceneEventEmitter?: Phaser.Events.EventEmitter;
    private raceData?: { players: Player[]; duration: number; humanChoice: Player; };

    private countdownText?: Phaser.GameObjects.Text;
    private overallRaceProgressText?: Phaser.GameObjects.Text;
    private raceTitleText?: Phaser.GameObjects.Text;
    private phaseMarkers: Phaser.GameObjects.Graphics[] = [];

    private playerEffectAuras: Map<string, Phaser.GameObjects.Graphics> = new Map();
    private playerEffectIcons: Map<string, Phaser.GameObjects.Sprite> = new Map();
    private playerAuraLaneMasks: Map<string, Phaser.Display.Masks.GeometryMask> = new Map();
    private playerAuraLaneMaskGraphics: Map<string, Phaser.GameObjects.Graphics> = new Map();

    private trackStartX = 0;
    private trackStartY = 0;
    private trackWidth = 0;
    private trackHeight = 0;
    private laneHeight = 0;
    private lastStateEmit = 0;

    private waitingForRaceData: boolean = true;

    // Scene/data ready flags for robust initialization
    private sceneReady = false;
    private raceDataReady = false;
    private pendingRaceData: { players: Player[], duration: number, humanChoice: Player } | null = null;

    constructor() {
        super({ key: 'WegenRaceScene' });
    }

    preload(): void {
        this.load.image('G1small', '/WegenRaceAssets/G1small.png');
        this.load.image('boost_icon', '/WegenRaceAssets/turbo.png');
        this.load.image('stumble_icon', '/WegenRaceAssets/obstacle.png');
        this.load.audio('background_music', '/WegenRaceAssets/bg_music.mp3');
        this.load.audio('countdown_tick', '/WegenRaceAssets/beep.wav');
        this.load.audio('race_start_horn', '/WegenRaceAssets/whack.wav');
        this.load.audio('victory_music', '/WegenRaceAssets/finish.wav');
        this.load.audio('celebration_sound', '/WegenRaceAssets/applause.wav');
        this.load.audio('phase_advance_effect', '/WegenRaceAssets/boost1.wav');

        this.load.on('loaderror', (key: string, file: Phaser.Loader.File) => {
            console.error(`⚠️ Failed to load asset: ${key} at ${file.src}`);
        });

        this.load.on('filecomplete', (key: string, type: string) => {
            if (type === 'image' && key.startsWith('avatar_')) {
                const playerKey = key.substring('avatar_'.length);
                const avatarSprite = this.playerAvatars.get(playerKey);
                if (avatarSprite && this.textures.exists(key)) {
                    avatarSprite.setTexture(key);
                    const avatarSize = this.laneHeight * GAME_CONSTANTS.AVATAR_SIZE_RATIO;
                    avatarSprite.setDisplaySize(avatarSize, avatarSize);
                    this.updateAvatarMask(playerKey, avatarSprite);
                }
            }
        });
    }

    private safePlaySound(key: string, opts?: Phaser.Types.Sound.SoundConfig) {
        if (!this.sound) return;
        const snd = this.sound.get(key);
        if (snd) {
            try { return snd.play(opts); } catch (e) { }
        } else if (this.cache.audio.exists(key)) {
            try { return this.sound.add(key).play(opts); } catch (e) { }
        }
        return undefined;
    }

    create(): void {
        this.gameLogic = new WegenRaceGameLogic();
        this.trackGraphics = this.add.graphics();
        this.sceneEventEmitter = new Phaser.Events.EventEmitter();
        this.cameras.main.setBackgroundColor('#1a1a2e');

        this.raceTitleText = this.add.text(this.scale.width / 2, 30, 'Wegen Race', {
            fontSize: '36px',
            color: '#ffd93b',
            fontFamily: 'WegensFont, Comic Sans MS, cursive',
            shadow: { offsetX: 2, offsetY: 2, color: '#000', blur: 4, fill: true }
        }).setOrigin(0.5).setDepth(spriteDepths.overallUI);

        this.overallRaceProgressText = this.add.text(
            this.scale.width / 2,
            this.scale.height - 40,
            'Overall Progress: 0%  |  Time Left: 00:00',
            {
                fontSize: '18px',
                color: '#ddd',
                fontFamily: 'WegensFont, Comic Sans MS, cursive',
            }
        ).setOrigin(0.5).setDepth(spriteDepths.overallUI);

        this.tweens.add({ targets: this.raceTitleText, scale: 1.02, yoyo: true, repeat: -1, duration: 1500, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: this.overallRaceProgressText, alpha: 0.9, yoyo: true, repeat: -1, duration: 1000, ease: 'Sine.easeInOut' });

        this.gameLogic.onPlayerPhaseAdvance((playerKey, phaseIndex) => this.handlePlayerPhaseAdvance(playerKey, phaseIndex));
        this.gameLogic.onRaceFinished(() => this.handleRaceFinishedInternal());
        this.gameLogic.onPlayerBoostEffect((playerKey, isPositive, effectDuration, stunDuration) => this.handlePlayerBoostEffect(playerKey, isPositive, effectDuration, stunDuration));
        this.gameLogic.onPlayerBoostEffectEnd((playerKey) => this.handlePlayerBoostEffectEnd(playerKey));

        this.sceneReady = true;

        // Robust data/scene ready
        if (this.raceDataReady && this.pendingRaceData) {
            this._doRaceSetup(this.pendingRaceData.players, this.pendingRaceData.duration, this.pendingRaceData.humanChoice);
        }

        (this.game as Phaser.Game).events.on('init-race-data', (data: { players: Player[], duration: number, humanChoice: Player }) => {
            this.raceDataReady = true;
            this.pendingRaceData = data;
            if (this.sceneReady) {
                this._doRaceSetup(data.players, data.duration, data.humanChoice);
            }
        });

        (this.game as Phaser.Game).events.emit('scene-ready');
    }

    private _doRaceSetup(players: Player[], duration: number, humanChoice: Player) {
        let avatarsToLoad = 0;
        players.forEach(player => {
            const dynamicAvatarKey = `avatar_${player.key}`;
            if (player.avatarUrl && !this.textures.exists(dynamicAvatarKey)) {
                this.load.image(dynamicAvatarKey, player.avatarUrl);
                avatarsToLoad++;
            }
        });

        const realSetup = () => {
            this.gameLogic.initializeRace(players, duration);
            this.raceData = { players, duration, humanChoice };
            this.setupLayout();
            this.createTrack();

            players.forEach((player, index) => {
                this.createPlayerVisualContainer(player, index);
                const avatarSprite = this.playerAvatars.get(player.key);
                const dynamicAvatarKey = `avatar_${player.key}`;
                if (avatarSprite && this.textures.exists(dynamicAvatarKey)) {
                    avatarSprite.setTexture(dynamicAvatarKey);
                    avatarSprite.setDisplaySize(this.laneHeight * GAME_CONSTANTS.AVATAR_SIZE_RATIO, this.laneHeight * GAME_CONSTANTS.AVATAR_SIZE_RATIO);
                    this.updateAvatarMask(player.key, avatarSprite);
                }
            });

            if (typeof this.startRaceExternally === "function") {
                this.startRaceExternally();
            }
        };

        if (avatarsToLoad > 0) {
            let avatarLoadTimedOut = false;
            const timeout = setTimeout(() => {
                avatarLoadTimedOut = true;
                realSetup();
            }, 5000);

            this.load.once('complete', () => {
                if (!avatarLoadTimedOut) clearTimeout(timeout);
                realSetup();
            });
            this.load.once('loaderror', (file: any) => {
                // Log and fallback to continue
                console.warn("Avatar image failed to load, using fallback.", file);
            });
            this.load.start();
        } else {
            realSetup();
        }
    }

    public initializeRaceWithData(players: Player[], durationMinutes: number, humanChoice: Player): void {
        this.raceDataReady = true;
        this.pendingRaceData = { players, duration: durationMinutes, humanChoice };
        if (this.sceneReady) {
            this._doRaceSetup(players, durationMinutes, humanChoice);
        }
    }

    update(): void {
        if (!this.raceDataReady) return;
        if (!this.gameLogic) return;
        this.gameLogic.update(this.sys.game.loop.delta);

        this.updatePlayerVisuals();
        this.updateOverallRaceProgressUI();

        const now = Date.now();
        if (now - this.lastStateEmit > 100) {
            this.lastStateEmit = now;
            this.emitStateChange();
        }
    }

    private setupLayout(): void {
        const horizontalPadding = this.scale.width * 0.05;
        const verticalPaddingTop = this.scale.height * 0.12;
        const verticalPaddingBottom = this.scale.height * 0.05;

        if (this.raceTitleText && !this.raceTitleText.destroyed) {
            this.raceTitleText.y = verticalPaddingTop / 3;
            this.raceTitleText.setStyle({ fontSize: '48px', fontFamily: 'WegensFont, Comic Sans MS, cursive' });
        } else {
            console.warn("raceTitleText is not defined or destroyed!");
        }
        if (this.overallRaceProgressText && !this.overallRaceProgressText.destroyed) {
            this.overallRaceProgressText.y = this.scale.height - verticalPaddingBottom / 2;
            this.overallRaceProgressText.setStyle({ fontFamily: 'WegensFont, Comic Sans MS, cursive' });
        } else {
            console.warn("overallRaceProgressText is not defined or destroyed!");
        }

        this.trackStartX = horizontalPadding;
        this.trackStartY = verticalPaddingTop;
        this.trackWidth = this.scale.width - (horizontalPadding * 2);
        this.trackHeight = this.scale.height - verticalPaddingTop - verticalPaddingBottom;
    }

    // ... all other methods (createTrack, createPlayerVisualContainer, etc.) remain unchanged ...
    // ... omitted for brevity; see your previous versions ...
}

// --- Game Factory Functions ---
export function createWegenRaceGame(container: HTMLElement): Phaser.Game {
    const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        width: container.clientWidth || 800,
        height: container.clientHeight || 500,
        parent: container,
        backgroundColor: '#1a1a2e',
        scene: WegenRaceScene,
        physics: { default: 'arcade', arcade: { gravity: { y: 0, x: 0 }, debug: false } },
        audio: { disableWebAudio: false },
        scale: {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.CENTER_BOTH,
            width: container.clientWidth || 800,
            height: container.clientHeight || 500
        }
    };
    return new Phaser.Game(config);
}
export function destroyWegenRaceGame(game: Phaser.Game): void {
    if (game && !game.isDestroyed) {
        game.scene.stop('WegenRaceScene');
        game.scene.remove('WegenRaceScene');
        game.destroy(true);
    }
}
export function getWegenRaceScene(game: Phaser.Game): WegenRaceScene | null {
    if (!game || game.isDestroyed) return null;
    return game.scene.getScene('WegenRaceScene') as WegenRaceScene;
}
export function isGameValid(game: Phaser.Game): boolean {
    return !!game && !game.isDestroyed && !!game.scene && !!game.scene.getScene('WegenRaceScene');
}
export { WegenRaceGameLogic };
export type { Player, GameState, GameEvent, VisualBoost };
export function enableDebugMode(game: Phaser.Game): void {
    const scene = getWegenRaceScene(game);
    if (scene) {
        (window as any).wegenRaceDebug = {
            game,
            scene,
            gameLogic: (scene as any).gameLogic,
            getState: () => scene.getGameState(),
            exportData: () => scene.exportRaceData()
        };
    }
}
console.log("🎮 WegenRaceGame.ts loaded successfully.");
