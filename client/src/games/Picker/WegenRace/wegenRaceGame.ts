import Phaser from 'phaser';

// --- Types ---
export interface Player {
    key: string;
    name: string;
    username?: string;
    wallet?: string;
    avatarUrl?: string;
    color?: number;
    isHumanPlayer?: boolean;
    isGuest?: boolean;
}

export interface GameEvent {
    id: string;
    timestamp: number;
    playerKey: string;
    eventType: string;
    description: string;
    effect?: string;
}

export interface VisualBoost {
    isPositive: boolean;
    multiplier: number;
    duration: number;
    startTime: number;
    isStun?: boolean;
    stunEndTime?: number;
}

export interface GameState {
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
    PROGRESS_BAR_ROUND_RADIUS: 5,
    PHASE_TITLES: [
        'Starting Grid', 'Acceleration', 'Tight Corner', 'Mid-Race Push', 'Strategic Maneuver',
        'Power Lap', 'Challenge Zone', 'Final Stretch', 'Clash Ahead', 'Photo Finish'
    ]
} as const;

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
    public phases: string[] = GAME_CONSTANTS.PHASE_TITLES;
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

    public initializeRace(players: Player[], durationMinutes: number): void {
        this.players = players;
        this.gameState.players = players;
        this.finishedPlayersCount = 0;
        this.finishThreshold = Math.max(1, Math.floor(players.length * 0.5));
        this.playerProgress = {};
        this.playerLastPhase = {};
        this.playerBoosts = {};
        this.eventLog = [];
        this.eventCounter = 0;
        this.currentPhaseIndex = 0;
        this.raceStartTime = null;
        this.gameState.rankings = [];
        this.gameState.positions = {};
        this.gameState.status = 'countdown';
        this.gameState.currentPhase = this.phases[0];
        this.gameState.raceElapsedTime = 0;
        this.gameState.raceProgress = 0;
        this.gameState.timeRemaining = durationMinutes * 60 * 1000;
        this.gameState.raceDuration = durationMinutes * 60 * 1000;
        this.gameState.eventLog = [];
    }

    public update(delta: number): void {
        if (this.gameState.status !== 'racing') return;
        const now = Date.now();
        if (this.raceStartTime === null) {
            this.raceStartTime = now;
            return;
        }
        this.gameState.raceElapsedTime = now - this.raceStartTime;
        this.gameState.timeRemaining = Math.max(0, this.gameState.raceDuration - this.gameState.raceElapsedTime);
        this.updatePhase(this.gameState.raceElapsedTime);
        this.updatePlayerProgress(delta, now);
        this.updatePositions();
        this.regulateRaceDuration();
        if (
            this.finishedPlayersCount >= this.finishThreshold ||
            this.gameState.raceElapsedTime >= this.gameState.raceDuration
        ) {
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
        const averageRequiredSpeed = 1 / totalRaceDurationSeconds;
        this.players.forEach(player => {
            let currentProgress = this.playerProgress[player.key] || 0;
            if (currentProgress >= 1) return;
            let progressChange = 0;
            const boost = this.playerBoosts[player.key];
            if (boost && boost.isStun && boost.stunEndTime && currentTime < boost.stunEndTime) {
                progressChange = 0;
            } else {
                let speed = averageRequiredSpeed * (0.85 + Math.random() * 0.4);
                if (player.isHumanPlayer) speed *= 1.05;
                if (boost && !boost.isStun) speed *= boost.multiplier;
                progressChange = speed * deltaTimeSeconds;
            }
            if (boost && currentTime - boost.startTime > boost.duration) {
                delete this.playerBoosts[player.key];
                this.internalEventEmitter.emit('playerBoostEffectEnd', player.key);
            }
            const newProgress = Math.min(1, Math.max(0, currentProgress + progressChange));
            if (newProgress >= 1 && this.playerProgress[player.key] < 1) {
                this.finishedPlayersCount++;
                this.addEvent(player.key, 'player_finished', `${player.name} has crossed the finish line!`);
            }
            this.playerProgress[player.key] = newProgress;
            const playerCurrentPhase = Math.floor(this.playerProgress[player.key] * this.phases.length);
            if (this.playerLastPhase[player.key] === undefined) this.playerLastPhase[player.key] = -1;
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
            this.gameState.positions[player.key] = index + 1;
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
                finishTime: (this.playerProgress[player.key] >= 1) ? this.gameState.raceElapsedTime : Infinity
            }))
            .sort((a, b) => {
                const aFinished = a.progress >= 1;
                const bFinished = b.progress >= 1;
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
        return this.playerProgress[playerKey] || 0;
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

    public startRace(): void {
        this.gameState.status = 'racing';
        this.raceStartTime = Date.now();
    }
}

// --- Scene Class ---
export class WegenRaceScene extends Phaser.Scene {
    public gameLogic!: WegenRaceGameLogic;
    public players: Player[] = [];
    public duration: number = 2;

    private trackGraphics!: Phaser.GameObjects.Graphics;
    private laneGraphics: Phaser.GameObjects.Graphics[] = [];
    private compartmentGraphics: Phaser.GameObjects.Graphics[] = [];
    private playerVisualContainers: Map<string, Phaser.GameObjects.Container> = new Map();
    private playerAvatars: Map<string, Phaser.GameObjects.Image> = new Map();
    private playerBoostIcons: Map<string, Phaser.GameObjects.Image> = new Map();
    private playerProgressBars: Map<string, Phaser.GameObjects.Graphics> = new Map();
    private playerBoostTrails: Map<string, Phaser.GameObjects.Particles.ParticleEmitterManager> = new Map();
    private playerEmoteTexts: Map<string, Phaser.GameObjects.Text> = new Map();
    private raceTitleText?: Phaser.GameObjects.Text;
    private overallRaceProgressText?: Phaser.GameObjects.Text;
    private phaseText?: Phaser.GameObjects.Text;
    private countdownText?: Phaser.GameObjects.Text;
    private countdownOverlay?: Phaser.GameObjects.Graphics;
    private sceneEventEmitter: Phaser.Events.EventEmitter = new Phaser.Events.EventEmitter();
    private muteMusic: boolean = false;
    private muteSfx: boolean = false;
    private musicTrack?: Phaser.Sound.BaseSound;
    private trackStartX = 0;
    private trackStartY = 0;
    private trackWidth = 0;
    private trackHeight = 0;
    private laneHeight = 0;

    init(data: any) {
        this.players = data.players || [];
        this.duration = data.duration || 2;
    }

    preload(): void {
        this.load.image('boost_icon', '/WegenRaceAssets/turbo.png');
        this.load.image('stumble_icon', '/WegenRaceAssets/obstacle.png');
        this.load.audio('bg_music', '/WegenRaceAssets/bg_music.mp3');
        this.load.audio('countdown_tick', '/WegenRaceAssets/beep.wav');
        this.load.audio('race_start_horn', '/WegenRaceAssets/whack.wav');
        this.load.audio('victory_music', '/WegenRaceAssets/finish.wav');
        this.load.audio('celebration_sound', '/WegenRaceAssets/applause.wav');
    }

    create(): void {
        if (!this.players.length) {
            this.add.text(80, 80, 'No player data found. Please restart!', { color: '#f00', fontSize: '32px' });
            return;
        }
        const players = this.players;
        const duration = this.duration;
        const { width, height } = this.sys.game.canvas;

        this.laneHeight = Math.max(
            Math.min(
                (height - 120) / players.length - GAME_CONSTANTS.LANE_PADDING,
                GAME_CONSTANTS.LANE_HEIGHT_MAX
            ),
            GAME_CONSTANTS.LANE_HEIGHT_MIN
        );
        this.trackHeight = this.laneHeight * players.length + GAME_CONSTANTS.LANE_PADDING * (players.length - 1);
        this.trackWidth = Math.max(width - 120, 400);
        this.trackStartX = 60;
        this.trackStartY = (height - this.trackHeight) / 2;

        this.trackGraphics = this.add.graphics().setDepth(spriteDepths.trackBackground);
        this.drawTrackBackgroundGradient();

        // Lane compartments for phases
        this.compartmentGraphics = [];
        for (let i = 0; i < players.length; i++) {
            const g = this.add.graphics().setDepth(spriteDepths.laneHighlight);
            this.drawLaneCompartments(g, i);
            this.compartmentGraphics.push(g);
        }

        this.laneGraphics = [];
        players.forEach((player, idx) => {
            const g = this.add.graphics().setDepth(spriteDepths.laneHighlight);
            this.drawLaneBackground(g, player, idx);
            this.laneGraphics.push(g);
        });

        this.playerVisualContainers.clear();
        this.playerAvatars.clear();
        this.playerBoostIcons.clear();
        this.playerProgressBars.clear();

        // Avatars: robust loading
        players.forEach((player, idx) => {
            const container = this.add.container(0, 0);
            const avatarRadius = this.laneHeight * GAME_CONSTANTS.AVATAR_SIZE_RATIO / 2;
            const avatarKey = `avatar_${player.key}`;
            let avatarImg: Phaser.GameObjects.Image;
            if (player.avatarUrl && !this.textures.exists(avatarKey)) {
                try {
                    this.textures.addBase64(avatarKey, player.avatarUrl);
                } catch {}
            }
            if (this.textures.exists(avatarKey)) {
                avatarImg = this.add.image(0, 0, avatarKey)
                    .setDisplaySize(avatarRadius * 2, avatarRadius * 2)
                    .setOrigin(0.5)
                    .setDepth(spriteDepths.playerAvatar);
            } else {
                avatarImg = this.add.circle(0, 0, avatarRadius, player.color ?? 0xffd93b) as unknown as Phaser.GameObjects.Image;
            }
            avatarImg.setInteractive();
            this.playerAvatars.set(player.key, avatarImg);
            container.add(avatarImg);

            const nameText = this.add.text(
                avatarRadius + 16, 0,
                player.name,
                {
                    fontSize: Math.floor(this.laneHeight * 0.41) + 'px',
                    color: '#fff',
                    fontFamily: 'WegensFont, Orbitron, Arial, sans-serif',
                    fontWeight: 'bold',
                    shadow: { offsetX: 2, offsetY: 2, color: '#000', blur: 4, fill: true }
                }
            ).setOrigin(0, 0.5).setAlpha(0.98);
            container.add(nameText);

            const progressBar = this.add.graphics().setDepth(spriteDepths.playerProgressBar);
            this.playerProgressBars.set(player.key, progressBar);

            this.playerVisualContainers.set(player.key, container);
        });

        this.phaseText = this.add.text(width / 2, 54, GAME_CONSTANTS.PHASE_TITLES[0], {
            fontSize: '28px',
            color: '#9fedff',
            fontFamily: 'WegensFont, Orbitron, Arial, sans-serif',
            fontWeight: 'bold',
            shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 3, fill: true }
        }).setOrigin(0.5).setDepth(spriteDepths.overallUI);

        this.overallRaceProgressText = this.add.text(
            width / 2,
            height - 32,
            'Overall Progress: 0%  |  Time Left: 00:00',
            {
                fontSize: '21px',
                color: '#ffd93b',
                fontFamily: 'WegensFont, Orbitron, Arial, sans-serif',
                fontWeight: 'bold',
                shadow: { offsetX: 2, offsetY: 2, color: '#000', blur: 4, fill: true }
            }
        ).setOrigin(0.5).setDepth(spriteDepths.overallUI);

        this.gameLogic = new WegenRaceGameLogic();
        this.gameLogic.initializeRace(players, duration);

        this.gameLogic.onPlayerPhaseAdvance((playerKey, phaseIndex) => this.handlePlayerPhaseAdvance(playerKey, phaseIndex));
        this.gameLogic.onRaceFinished(() => this.handleRaceFinishedInternal());
        this.gameLogic.onPlayerBoostEffect((playerKey, isPositive, effectDuration, stunDuration) => this.handlePlayerBoostEffect(playerKey, isPositive, effectDuration, stunDuration));
        this.gameLogic.onPlayerBoostEffectEnd((playerKey) => this.handlePlayerBoostEffectEnd(playerKey));
    }

    drawTrackBackgroundGradient() {
        const g = this.trackGraphics;
        g.clear();
        const { trackStartX, trackStartY, trackWidth, trackHeight } = this;
        g.fillGradientStyle(0x23233e, 0x191e26, 0x23233e, 0x191e26, 1);
        g.fillRoundedRect(trackStartX - 14, trackStartY - 14, trackWidth + 28, trackHeight + 28, 38);
        g.lineStyle(8, 0x2222ff, 0.15);
        g.strokeRoundedRect(trackStartX - 14, trackStartY - 14, trackWidth + 28, trackHeight + 28, 38);
        g.lineStyle(4, 0x181828, 0.85);
        g.strokeRoundedRect(trackStartX - 8, trackStartY - 8, trackWidth + 16, trackHeight + 16, 24);
    }

    drawLaneCompartments(g: Phaser.GameObjects.Graphics, idx: number) {
        const y = this.trackStartY + idx * (this.laneHeight + GAME_CONSTANTS.LANE_PADDING);
        const laneCompartmentWidth = this.trackWidth / GAME_CONSTANTS.PHASES_COUNT;
        for (let p = 0; p < GAME_CONSTANTS.PHASES_COUNT; p++) {
            g.lineStyle(2, 0x444466, 0.25);
            g.strokeRoundedRect(this.trackStartX + p * laneCompartmentWidth, y, laneCompartmentWidth, this.laneHeight, GAME_CONSTANTS.PROGRESS_BAR_ROUND_RADIUS);
        }
    }

    drawLaneBackground(g: Phaser.GameObjects.Graphics, player: Player, idx: number) {
        const y = this.trackStartY + idx * (this.laneHeight + GAME_CONSTANTS.LANE_PADDING);
        const radius = GAME_CONSTANTS.PROGRESS_BAR_ROUND_RADIUS;
        g.clear();
        g.fillStyle((player as any).color ?? 0x23233e, 0.21);
        g.fillRoundedRect(this.trackStartX, y, this.trackWidth, this.laneHeight, radius);
        g.lineStyle(3, 0x222242, 0.92);
        g.strokeRoundedRect(this.trackStartX, y, this.trackWidth, this.laneHeight, radius);

        if (player.isHumanPlayer) {
            g.lineStyle(4, 0xffd93b, 0.47);
            g.strokeRoundedRect(this.trackStartX + 2, y + 2, this.trackWidth - 4, this.laneHeight - 4, radius - 4);
        }
        (g as any).__laneIndex = idx;
        (g as any).__playerKey = player.key;
    }

    public startRaceExternally(): void {
        if (this.sound.context && this.sound.context.state === "suspended") {
            this.sound.context.resume();
        }
        this.playMusicAndCountdown();
    }

    private playMusicAndCountdown() {
        if (!this.sound.get('bg_music')) {
            if (!this.cache.audio.exists('bg_music')) {
                this.load.audio('bg_music', '/WegenRaceAssets/bg_music.mp3');
                this.load.once('complete', () => this.playMusicAndCountdown());
                this.load.start();
                return;
            } else {
                setTimeout(() => this.playMusicAndCountdown(), 100);
                return;
            }
        }
        this.sound.stopAll();
        this.musicTrack = this.sound.add('bg_music', { loop: true, volume: 0.36 });
        this.musicTrack.play();
        this.musicTrack.setMute(this.muteMusic);
        this.startCountdown();
    }

    private startCountdown(): void {
        const width = this.sys.game.canvas.width;
        const height = this.sys.game.canvas.height;
        const centerX = width / 2;
        const centerY = height / 2;
        this.countdownOverlay = this.add.graphics();
        this.countdownOverlay.fillStyle(0x181828, 0.96);
        this.countdownOverlay.fillRoundedRect(0, 0, width, height, 32);

        this.countdownText = this.add.text(centerX, centerY, '3', {
            fontSize: '164px',
            color: '#ffd93b',
            fontFamily: 'WegensFont, Orbitron, Arial, sans-serif',
            fontWeight: 'bold',
            stroke: '#000',
            strokeThickness: 12,
            shadow: { offsetX: 0, offsetY: 0, color: '#ffd93b', blur: 40, fill: true }
        }).setOrigin(0.5).setDepth(spriteDepths.countdown);

        const flash = this.add.rectangle(centerX, centerY, width, height, 0xffffff, 0.14).setDepth(spriteDepths.countdown + 2).setAlpha(0);

        const playTick = () => { 
            if (!this.muteSfx) this.sound.play('countdown_tick', { volume: 0.6 });
            this.tweens.add({ targets: flash, alpha: { from: 0.75, to: 0 }, duration: 200 });
        };
        this.tweens.add({ targets: this.countdownText, scale: { from: 1.1, to: 1.5 }, duration: 800, yoyo: true, repeat: 0 });
        this.time.delayedCall(1000, () => { this.countdownText!.setText('2'); playTick(); });
        this.time.delayedCall(2000, () => { this.countdownText!.setText('1'); playTick(); });
        this.time.delayedCall(3000, () => {
            if (this.countdownText) {
                this.countdownText.setText('GO!');
                playTick();
                this.tweens.add({
                    targets: this.countdownText,
                    scale: 1.7,
                    alpha: 0,
                    duration: 600,
                    onComplete: () => {
                        this.countdownText?.destroy();
                        this.countdownOverlay?.destroy();
                        this.countdownText = undefined;
                        this.countdownOverlay = undefined;
                    }
                });
                if (!this.muteSfx) this.sound.play('race_start_horn', { volume: 0.38 });
                if (this.gameLogic) this.gameLogic.startRace();
            }
        });
    }

    update(): void {
        if (!this.gameLogic) return;
        this.gameLogic.update(this.sys.game.loop.delta);
        this.updatePlayerVisuals();
        this.updateOverallRaceProgressUI();
        this.updatePhaseUI();
        this.sceneEventEmitter.emit('stateChange', this.gameLogic.getState());
    }

    private updatePlayerVisuals(): void {
        const players = this.gameLogic.getAllPlayers();
        players.forEach((player, idx) => {
            const container = this.playerVisualContainers.get(player.key);
            const avatar = this.playerAvatars.get(player.key);
            const progressBar = this.playerProgressBars.get(player.key);
            if (!container || !avatar || !progressBar) return;
            const progress = this.gameLogic.getPlayerProgress(player.key);
            const avatarRadius = this.laneHeight * GAME_CONSTANTS.AVATAR_SIZE_RATIO / 2;
            const barY = this.trackStartY + idx * (this.laneHeight + GAME_CONSTANTS.LANE_PADDING) + this.laneHeight / 2 + avatarRadius + 7;
            const y = this.trackStartY + idx * (this.laneHeight + GAME_CONSTANTS.LANE_PADDING) + this.laneHeight / 2;

            const turbo = this.gameLogic.getVisualBoost(player.key);
            const bounceY = Math.sin(Date.now() / 180 + idx * 0.77 + progress * 2.8) * avatarRadius * 0.23 * (turbo ? 1.2 : 1);
            container.x = this.trackStartX + progress * this.trackWidth;
            container.y = y + bounceY;

            progressBar.clear();
            let barColor = (player as any).color ?? 0xffd93b;
            if (turbo) {
                barColor = turbo.isPositive ? 0x32ff5f : 0xff3b3b;
            }
            const barHeight = this.laneHeight * GAME_CONSTANTS.PROGRESS_BAR_HEIGHT_RATIO;
            progressBar.fillStyle(barColor, turbo ? 0.92 : 0.72);
            progressBar.fillRoundedRect(this.trackStartX, barY, Math.max(2, progress * this.trackWidth), barHeight, avatarRadius);

            if (avatar instanceof Phaser.GameObjects.Image) {
                avatar.setStrokeStyle(turbo ? 6 : 4, turbo ? (turbo.isPositive ? 0x11ff44 : 0xee3366) : 0x000000, 1);
                avatar.setShadow(0, 2, turbo ? (turbo.isPositive ? '#44ff77' : '#ff4444') : '#ffd93b', turbo ? 23 : 10, true, true);
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
    private updatePhaseUI(): void {
        if (this.phaseText) {
            this.phaseText.setText(this.gameLogic.getState().currentPhase);
        }
    }

    private handlePlayerPhaseAdvance(playerKey: string, phaseIndex: number): void {
        const avatar = this.playerAvatars.get(playerKey);
        if (avatar) {
            this.tweens.add({
                targets: avatar,
                scaleX: { from: 1, to: 1.19 },
                scaleY: { from: 1, to: 1.19 },
                duration: 120, yoyo: true, onComplete: () => avatar.setScale(1)
            });
        }
    }

    private handlePlayerBoostEffect(playerKey: string, isPositive: boolean, effectDuration: number, stunDuration?: number): void {
        const avatar = this.playerAvatars.get(playerKey);
        const container = this.playerVisualContainers.get(playerKey);
        if (!avatar || !container) return;

        if (isPositive) {
            let particles = this.playerBoostTrails.get(playerKey);
            if (!particles) {
                particles = this.add.particles(0, 0, undefined, {
                    speed: 85,
                    lifespan: 550,
                    angle: { min: 160, max: 200 },
                    scale: { start: 0.36, end: 0 },
                    alpha: { start: 0.93, end: 0 },
                    tint: [0x11ff44, 0x00eedd, 0xffffff]
                });
                container.add(particles);
                this.playerBoostTrails.set(playerKey, particles);
            }
            particles.setPosition(0, 0);
            particles.emitParticleAt(0, 0, 8);
            this.tweens.add({
                targets: particles,
                alpha: { from: 1, to: 0 },
                duration: effectDuration,
                onComplete: () => {
                    particles?.destroy();
                    this.playerBoostTrails.delete(playerKey);
                }
            });
        } else {
            let emote = this.playerEmoteTexts.get(playerKey);
            if (!emote) {
                emote = this.add.text(0, -this.laneHeight * 0.35, "😱", {
                    fontSize: Math.floor(this.laneHeight * 0.6) + "px", color: "#ff4444", fontFamily: "Arial"
                }).setOrigin(0.5);
                container.add(emote);
                this.playerEmoteTexts.set(playerKey, emote);
            }
            emote.alpha = 1;
            emote.setText(stunDuration ? "😵" : "😱");
            this.tweens.add({
                targets: emote,
                alpha: { from: 1, to: 0 },
                y: emote.y - 20,
                duration: effectDuration,
                onComplete: () => {
                    emote?.destroy();
                    this.playerEmoteTexts.delete(playerKey);
                }
            });
        }

        let icon = this.playerBoostIcons.get(playerKey);
        const iconKey = isPositive ? 'boost_icon' : 'stumble_icon';
        if (!icon) {
            icon = this.add.image(avatar.x + avatar.displayWidth / 2 + 18, avatar.y, iconKey).setOrigin(0.5).setScale(0.8);
            container.add(icon);
            this.playerBoostIcons.set(playerKey, icon);
        }
        icon.setTexture(iconKey);
        icon.x = avatar.displayWidth / 2 + 16;
        icon.y = 0;
        icon.setVisible(true);
        avatar.setStrokeStyle(7, isPositive ? 0x11ff44 : 0xee3366, 0.97);
        this.tweens.add({
            targets: icon,
            scale: { from: 0.85, to: 1.2 },
            duration: 90, yoyo: true, repeat: 2
        });
        if (stunDuration && !isPositive) {
            this.tweens.add({
                targets: avatar,
                alpha: { from: 1, to: 0.45 }, duration: stunDuration / 2, yoyo: true,
                repeat: Math.floor(effectDuration / (stunDuration / 2)), onComplete: () => avatar.alpha = 1
            });
        }
    }

    private handlePlayerBoostEffectEnd(playerKey: string): void {
        const avatar = this.playerAvatars.get(playerKey);
        const icon = this.playerBoostIcons.get(playerKey);
        const trail = this.playerBoostTrails.get(playerKey);
        const emote = this.playerEmoteTexts.get(playerKey);
        if (avatar) {
            avatar.setStrokeStyle(0);
            avatar.alpha = 1;
        }
        if (icon) {
            icon.setVisible(false);
            icon.destroy();
            this.playerBoostIcons.delete(playerKey);
        }
        if (trail) { trail.destroy(); this.playerBoostTrails.delete(playerKey); }
        if (emote) { emote.destroy(); this.playerEmoteTexts.delete(playerKey); }
    }

    private handleRaceFinishedInternal(): void {
        if (this.gameLogic.getState().status !== 'finished') {
            this.gameLogic.getState().status = 'finished';
        }
        this.addCelebrationEffect();
        const victorySound = this.sound.get('victory_music');
        if (victorySound) victorySound.play({ volume: 0.3 });
        const state = this.gameLogic.getState();
        this.sceneEventEmitter.emit('gameEnd', state.winner, state.rankings);
    }
    private addCelebrationEffect(): void {
        const { width, height } = this.sys.game.canvas;
        for (let i = 0; i < 36; i++) {
            const confetti = this.add.rectangle(
                Phaser.Math.Between(0, width),
                -48,
                Phaser.Math.Between(7, 17),
                Phaser.Math.Between(7, 17),
                Phaser.Display.Color.GetColor(
                    Phaser.Math.Between(0, 255), Phaser.Math.Between(0, 255), Phaser.Math.Between(0, 255)
                )
            ).setDepth(spriteDepths.confetti);
            this.tweens.add({
                targets: confetti,
                y: height + 50,
                rotation: Phaser.Math.Between(0, Math.PI * 4),
                duration: Phaser.Math.Between(1800, 3500),
                ease: 'Power2',
                onComplete: () => confetti.destroy()
            });
        }
        const applauseSound = this.sound.get('celebration_sound');
        if (applauseSound) applauseSound.play({ volume: 0.3 });
    }
}

// --- Game Factory Functions ---
export function createWegenRaceGame(container: HTMLElement, players: Player[], duration: number): Phaser.Game {
    const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        width: container.clientWidth || 900,
        height: container.clientHeight || 600,
        parent: container,
        backgroundColor: '#191e26',
        scene: [WegenRaceScene],
        physics: { default: 'arcade', arcade: { gravity: { y: 0, x: 0 }, debug: false } },
        audio: { disableWebAudio: false },
        scale: {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.CENTER_BOTH,
            width: container.clientWidth || 900,
            height: container.clientHeight || 600
        }
    };
    const game = new Phaser.Game(config);
    game.scene.start('WegenRaceScene', { players, duration });
    return game;
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

export function enableDebugMode(game: Phaser.Game): void {
    const scene = getWegenRaceScene(game);
    if (scene) {
        (window as any).wegenRaceDebug = {
            game,
            scene,
            gameLogic: (scene as any).gameLogic,
            getState: () => scene.gameLogic?.getState?.(),
        };
    }
}

console.log("🎮 WegenRaceGame.ts loaded successfully.");