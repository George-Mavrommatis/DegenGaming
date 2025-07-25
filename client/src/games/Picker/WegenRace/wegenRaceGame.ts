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

        // Do NOT start music here -- it will start after countdown!
        // this.safePlaySound('background_music', { loop: true, volume: 0.2 });

        (this.game as Phaser.Game).events.on('init-race-data', (data: { players: Player[]; duration: number; humanChoice: Player }) => {
            this.initializeRaceWithData(data.players, data.duration, data.humanChoice);
            this.waitingForRaceData = false;
        });

        (this.game as Phaser.Game).events.emit('scene-ready');
    }

    public initializeRaceWithData(players: Player[], durationMinutes: number, humanChoice: Player): void {
        let avatarsToLoad = 0;
        players.forEach(player => {
            const dynamicAvatarKey = `avatar_${player.key}`;
            if (player.avatarUrl && !this.textures.exists(dynamicAvatarKey)) {
                this.load.image(dynamicAvatarKey, player.avatarUrl);
                avatarsToLoad++;
            }
        });

        const continueSetup = () => {
            this.gameLogic.initializeRace(players, durationMinutes);
            this.raceData = { players, duration: durationMinutes, humanChoice };
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
                continueSetup();
            }, 5000);

            this.load.once('complete', () => {
                if (!avatarLoadTimedOut) clearTimeout(timeout);
                continueSetup();
            });
            this.load.once('loaderror', (file: any) => {
                // Log and fallback to continue
            });
            this.load.start();
        } else {
            continueSetup();
        }
    }

    update(): void {
        if (this.waitingForRaceData) return;
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

        if (this.raceTitleText) {
            this.raceTitleText.y = verticalPaddingTop / 3;
            this.raceTitleText.setStyle({ fontSize: '48px', fontFamily: 'WegensFont, Comic Sans MS, cursive' });
        }
        if (this.overallRaceProgressText) {
            this.overallRaceProgressText.y = this.scale.height - verticalPaddingBottom / 2;
            this.overallRaceProgressText.setStyle({ fontFamily: 'WegensFont, Comic Sans MS, cursive' });
        }

        this.trackStartX = horizontalPadding;
        this.trackStartY = verticalPaddingTop;
        this.trackWidth = this.scale.width - (horizontalPadding * 2);
        this.trackHeight = this.scale.height - verticalPaddingTop - verticalPaddingBottom;
    }

    private createTrack(): void {
        const numPlayers = this.raceData ? this.raceData.players.length : 0;
        if (numPlayers === 0) return;

        this.trackGraphics.clear();
        this.phaseMarkers.forEach(m => m.destroy()); this.phaseMarkers = [];
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

        const maxSingleLaneHeight = this.trackHeight / 1.5;
        this.laneHeight = Math.min(
            GAME_CONSTANTS.LANE_HEIGHT_MAX,
            Math.max(GAME_CONSTANTS.LANE_HEIGHT_MIN, (this.trackHeight - (numPlayers - 1) * GAME_CONSTANTS.LANE_PADDING) / numPlayers),
            maxSingleLaneHeight
        );
        const totalLanesRenderHeight = numPlayers * this.laneHeight + (numPlayers > 1 ? (numPlayers - 1) * GAME_CONSTANTS.LANE_PADDING : 0);

        this.trackGraphics.lineStyle(3, 0x4a4a6e, 0.8);
        this.trackGraphics.strokeRoundedRect(this.trackStartX, this.trackStartY, this.trackWidth, totalLanesRenderHeight, 10);
        this.trackGraphics.setDepth(spriteDepths.trackOutline);

        this.raceData?.players.forEach((player, index) => {
            const laneY = this.trackStartY + (index * (this.laneHeight + GAME_CONSTANTS.LANE_PADDING));
            const laneGraphics = this.add.graphics().setDepth(spriteDepths.trackBackground);
            this.playerLaneBackgrounds.set(player.key, laneGraphics);
            laneGraphics.name = `laneBackground_${player.key}`;

            laneGraphics.fillStyle(0x00FF00, 0.1);
            laneGraphics.fillRoundedRect(this.trackStartX + 2, laneY + 2, this.trackWidth - 4, this.laneHeight - 4, 10);
            laneGraphics.lineStyle(1.5, 0x309930, 0.6);
            laneGraphics.strokeRoundedRect(this.trackStartX + 2, laneY + 2, this.trackWidth - 4, this.laneHeight - 4, 10);

            const progressBar = this.add.graphics().setDepth(spriteDepths.playerProgressBar);
            this.playerProgressBars.set(player.key, progressBar);
            progressBar.name = `progressBar_${player.key}`;

            const laneMaskGraphics = this.make.graphics({ add: false });
            laneMaskGraphics.name = `auraLaneMaskGraphics_${player.key}`;
            laneMaskGraphics.fillStyle(0xffffff);
            laneMaskGraphics.fillRoundedRect(this.trackStartX, laneY, this.trackWidth, this.laneHeight, 10);
            const laneMask = laneMaskGraphics.createGeometryMask();
            this.playerAuraLaneMasks.set(player.key, laneMask);
            this.playerAuraLaneMaskGraphics.set(player.key, laneMaskGraphics);
            // DO NOT add laneMaskGraphics to scene!
            // laneMaskGraphics.setVisible(false);
        });

        this.trackGraphics.lineStyle(3, 0xFFFFFF, 1);
        this.trackGraphics.lineBetween(this.trackStartX, this.trackStartY, this.trackStartX, this.trackStartY + totalLanesRenderHeight);
        this.add.text(this.trackStartX + 5, this.trackStartY - 20, 'START', {
            fontSize: '14px', color: '#FFFFFF', fontFamily: 'WegensFont, Comic Sans MS, cursive', shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 2, fill: true }
        }).setOrigin(0, 0.5).setDepth(spriteDepths.overallUI);

        this.trackGraphics.lineBetween(this.trackStartX + this.trackWidth, this.trackStartY, this.trackStartX + this.trackWidth, this.trackStartY + totalLanesRenderHeight);
        this.add.text(this.trackStartX + this.trackWidth - 5, this.trackStartY - 20, 'FINISH', {
            fontSize: '14px', color: '#FFFFFF', fontFamily: 'WegensFont, Comic Sans MS, cursive', shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 2, fill: true }
        }).setOrigin(1, 0.5).setDepth(spriteDepths.overallUI);

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
                fontSize: '12px', color: '#aaa', fontFamily: 'WegensFont, Comic Sans MS, cursive', align: 'center', shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 1, fill: true }
            }).setOrigin(0.5).setDepth(spriteDepths.overallUI);
        }
    }

    private createAvatarMask(playerKey: string, avatarSprite: Phaser.GameObjects.Sprite) {
        const maskGraphics = this.make.graphics({ add: true, visible: false });
        maskGraphics.name = `avatarMaskGraphics_${playerKey}`;
        this.playerAvatarMaskGraphics.set(playerKey, maskGraphics);

        const radius = avatarSprite.displayWidth / 2;
        maskGraphics.fillCircle(avatarSprite.x, avatarSprite.y, radius);

        const mask = maskGraphics.createGeometryMask();
        avatarSprite.setMask(mask);

        this.playerAvatarMasks.set(playerKey, mask);
    }

    private updateAvatarMask(playerKey: string, avatarSprite: Phaser.GameObjects.Sprite) {
        let maskGraphics = this.playerAvatarMaskGraphics.get(playerKey);
        if (!maskGraphics) {
            this.createAvatarMask(playerKey, avatarSprite);
            maskGraphics = this.playerAvatarMaskGraphics.get(playerKey);
            if (!maskGraphics) return;
        }
        maskGraphics.clear();
        const radius = avatarSprite.displayWidth / 2;
        maskGraphics.fillCircle(avatarSprite.x, avatarSprite.y, radius);
    }

    private createPlayerVisualContainer(player: Player, laneIndex: number): void {
        const laneYTop = this.trackStartY + (laneIndex * (this.laneHeight + GAME_CONSTANTS.LANE_PADDING));
        const laneCenterY = laneYTop + (this.laneHeight / 2);

        const container = this.add.container(this.trackStartX, laneCenterY).setDepth(spriteDepths.playerAvatar);
        container.name = `playerContainer_${player.key}`;
        this.playerVisualContainers.set(player.key, container);

        const avatarSize = this.laneHeight * GAME_CONSTANTS.AVATAR_SIZE_RATIO;
        const avatarRadius = avatarSize / 2;
        const avatarLocalX = GAME_CONSTANTS.AVATAR_START_OFFSET_X;
        const avatarLocalY = 0;

        const dynamicAvatarKey = `avatar_${player.key}`;
        let avatarTextureKey = 'G1small';
        if (this.textures.exists(dynamicAvatarKey)) {
            avatarTextureKey = dynamicAvatarKey;
        }

        const currentAvatar = this.add.sprite(avatarLocalX, avatarLocalY, avatarTextureKey);
        currentAvatar.setDisplaySize(avatarSize, avatarSize);
        currentAvatar.setOrigin(0.5);
        currentAvatar.name = `avatarSprite_${player.key}`;
        container.add(currentAvatar);
        this.playerAvatars.set(player.key, currentAvatar);

        this.createAvatarMask(player.key, currentAvatar);

        const borderGraphics = this.add.graphics();
        borderGraphics.lineStyle(3, 0x000000, 1);
        borderGraphics.strokeCircle(avatarLocalX, avatarLocalY, avatarRadius);
        container.add(borderGraphics);
        borderGraphics.name = `avatarBorder_${player.key}`;

        const nameTextX = avatarLocalX - avatarRadius - GAME_CONSTANTS.PLAYER_NAME_OFFSET_X;
        const nameText = this.add.text(nameTextX, avatarLocalY, player.name, {
            fontSize: '15px', color: '#fff', fontFamily: 'WegensFont, Comic Sans MS, cursive', align: 'right',
            wordWrap: { width: 100, useWebFonts: true },
            shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 2, fill: true }
        }).setOrigin(1, 0.5);
        nameText.name = `nameText_${player.key}`;
        container.add(nameText);
    }

    private updatePlayerVisuals(): void {
        const players = this.gameLogic.getAllPlayers();
        players.forEach((player, index) => {
            const container = this.playerVisualContainers.get(player.key);
            const avatar = this.playerAvatars.get(player.key);
            const progressBar = this.playerProgressBars.get(player.key);

            if (!container || !avatar || !progressBar) return;

            const progress = this.gameLogic.getPlayerProgress(player.key);

            const avatarWidth = avatar.displayWidth;
            const trackLeft = this.trackStartX;
            const trackRight = this.trackStartX + this.trackWidth;
            let avatarCenterX = trackLeft + progress * this.trackWidth;
            avatarCenterX = Math.max(trackLeft + avatarWidth / 2, Math.min(trackRight - avatarWidth / 2, avatarCenterX));
            container.x = avatarCenterX;

            const time = Date.now();
            const bounceOffset = Math.sin(time / 200 + index * 0.5) * 4;
            const laneYTop = this.trackStartY + (index * (this.laneHeight + GAME_CONSTANTS.LANE_PADDING));
            const laneCenterY = laneYTop + (this.laneHeight / 2);
            container.y = laneCenterY + bounceOffset;

            progressBar.clear();
            const progressBarX = this.trackStartX + 2;
            const progressBarY = laneYTop + this.laneHeight - (this.laneHeight * GAME_CONSTANTS.PROGRESS_BAR_HEIGHT_RATIO) - 2;
            const progressBarWidth = Math.max(2, progress * this.trackWidth);
            const progressBarHeight = this.laneHeight * GAME_CONSTANTS.PROGRESS_BAR_HEIGHT_RATIO;

            progressBar.fillStyle(0xFFD700, 0.8);
            progressBar.fillRoundedRect(progressBarX, progressBarY, progressBarWidth, progressBarHeight, GAME_CONSTANTS.PROGRESS_BAR_ROUND_RADIUS);

            const boost = this.gameLogic.getVisualBoost(player.key);
            if (!boost) {
                avatar.clearTint();
                avatar.setScale(1);
            }
        });
    }

    private updateOverallRaceProgressUI(): void {
        if (this.overallRaceProgressText) {
            const overallProgress = this.gameLogic.getState().raceProgress;
            const timeRemaining = this.gameLogic.getState().timeRemaining;
            const timeLeftFormatted = new Date(timeRemaining).toISOString().substr(14, 5);

            this.overallRaceProgressText.setText(
                `Overall Progress: ${Math.floor(overallProgress)}%  |  Time Left: ${timeLeftFormatted}`
            );
            this.overallRaceProgressText.x = this.trackStartX + (this.trackWidth / 2);
        }
    }

    private emitStateChange(): void {
        if (this.sceneEventEmitter) {
            this.sceneEventEmitter.emit('stateChange', this.gameLogic.getState());
        }
    }

    private handlePlayerPhaseAdvance(playerKey: string, phaseIndex: number): void {
        const avatar = this.playerAvatars.get(playerKey);
        if (avatar) {
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
            if (!boost) {
                avatar.setTint(0xffd700);
                this.time.delayedCall(200, () => avatar.clearTint());
            }
        }
        const phaseSound = this.sound.get('phase_advance_effect');
        if (phaseSound) phaseSound.play({ volume: 0.1 });
    }

    private handlePlayerBoostEffect(playerKey: string, isPositive: boolean, effectDuration: number, stunDuration?: number): void {
        const container = this.playerVisualContainers.get(playerKey);
        const avatar = this.playerAvatars.get(playerKey);
        const laneBackground = this.playerLaneBackgrounds.get(playerKey);
        const auraLaneMask = this.playerAuraLaneMasks.get(playerKey);

        if (!container || !avatar || !laneBackground || !auraLaneMask) {
            return;
        }

        const playerIndex = this.gameLogic.getAllPlayers().findIndex(p => p.key === playerKey);
        const laneYTop = this.trackStartY + (playerIndex * (this.laneHeight + GAME_CONSTANTS.LANE_PADDING));
        const laneX = this.trackStartX;
        const laneWidth = this.trackWidth;
        const laneHeight = this.laneHeight;

        const originalColor = 0x00FF00;
        const originalAlpha = 0.1;
        const flashColor = isPositive ? 0x00AA00 : 0xAA0000;
        const flashAlpha = 0.3;

        laneBackground.clear();
        laneBackground.fillStyle(flashColor, flashAlpha);
        laneBackground.fillRoundedRect(laneX + 2, laneYTop + 2, laneWidth - 4, laneHeight - 4, 10);
        laneBackground.lineStyle(1.5, 0x309930, 0.6);
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

        let aura = this.playerEffectAuras.get(playerKey);
        const auraRadius = avatar.displayWidth / 2 + 10;
        const highlightColor = isPositive ? 0x00FF00 : 0xFF0000;

        if (!aura) {
            aura = this.add.graphics();
            aura.name = `aura_${playerKey}`;
            this.playerEffectAuras.set(playerKey, aura);
            container.add(aura);
            aura.setDepth(spriteDepths.laneHighlight);
            aura.setMask(auraLaneMask);
        }
        aura.clear();
        aura.fillStyle(highlightColor, 0.4);
        aura.fillCircle(avatar.x, avatar.y, auraRadius);
        this.tweens.killTweensOf(aura);
        aura.alpha = 1;
        this.tweens.add({ targets: aura, alpha: { from: 0.8, to: 0.2 }, yoyo: true, repeat: -1, duration: 500 });

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
            icon.setDepth(spriteDepths.playerAvatar + 2);
            icon.name = `effectIcon_${playerKey}`;
            container.add(icon);
            this.playerEffectIcons.set(playerKey, icon);
        }

        avatar.setTint(highlightColor);
        avatar.setScale(isPositive ? 1.15 : 0.85);

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

    private handleRaceFinishedInternal(): void {
        if (this.gameLogic.getState().status !== 'finished') {
             this.gameLogic.getState().status = 'finished';
        }
        this.addCelebrationEffect();
        const victorySound = this.sound.get('victory_music');
        if (victorySound) victorySound.play({ volume: 0.3 });
        this.sceneEventEmitter.emit('gameEnd', this.gameLogic.getState().winner, this.gameLogic.getState().rankings);
    }

    private addCelebrationEffect(): void {
        const { width, height } = this.sys.game.canvas;

        for (let i = 0; i < 70; i++) {
            const confetti = this.add.rectangle(
                Phaser.Math.Between(0, width),
                -50,
                Phaser.Math.Between(5, 17),
                Phaser.Math.Between(5, 17),
                Phaser.Display.Color.GetColor(
                    Phaser.Math.Between(0, 255), Phaser.Math.Between(0, 255), Phaser.Math.Between(0, 255)
                )
            ).setDepth(spriteDepths.confetti);

            this.tweens.add({
                targets: confetti,
                y: height + 50,
                rotation: Phaser.Math.Between(0, Math.PI * 4),
                duration: Phaser.Math.Between(2500, 4000),
                ease: 'Power2',
                onComplete: () => confetti.destroy()
            });
        }
        const applauseSound = this.sound.get('celebration_sound');
        if (applauseSound) applauseSound.play({ volume: 0.3 });
    }

    public startRaceExternally(): void {
        this.startCountdown();
    }

    private startCountdown(): void {
        const centerX = this.scale.width / 2;
        const centerY = this.scale.height / 2;

        this.countdownText = this.add.text(centerX, centerY, '3', {
            fontSize: '96px', color: '#ffd93b', fontFamily: 'WegensFont, Comic Sans MS, cursive', fontStyle: 'bold',
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
                // Start music ONLY now after the countdown
                this.safePlaySound('background_music', { loop: true, volume: 0.2 });
                this.gameLogic.startRace();
            }
        });
    }

    public getGameState(): GameState {
        return this.gameLogic.getState();
    }

    public onStateChange(callback: (state: GameState) => void): void {
        if (this.sceneEventEmitter) {
            this.sceneEventEmitter.on('stateChange', callback);
        }
    }

    public onGameEnd(callback: (winner: Player | null, rankings: Player[]) => void): void {
        if (this.sceneEventEmitter) {
            this.sceneEventEmitter.on('gameEnd', callback);
        }
    }

    public exportRaceData(): any {
        const state = this.gameLogic.getState();
        return {
            winner: state.winner,
            rankings: state.rankings,
            finalProgress: state.raceProgress,
            raceTime: state.raceElapsedTime,
            eventLog: state.eventLog,
            playerCount: state.players.length
        };
    }

    destroy(): void {
        if (this.sceneEventEmitter) { this.sceneEventEmitter.destroy(); this.sceneEventEmitter = undefined; }

        this.playerVisualContainers.forEach(container => container.destroy()); this.playerVisualContainers.clear();
        this.playerAvatars.clear();
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

        if ((this.gameLogic as any)?.internalEventEmitter) {
             (this.gameLogic as any).internalEventEmitter.destroy();
        }

        super.destroy();
    }
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