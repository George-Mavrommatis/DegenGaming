// DegenFighterScene.ts — Phaser 3 PvP fighting game scene for DegenFighter
import Phaser from 'phaser';
import type { Socket } from 'socket.io-client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FighterConfig {
  key: string;          // socket/player key
  username: string;
  avatarUrl: string;
  isLocal: boolean;     // true = this client's fighter
}

export interface DegenFighterSceneData {
  localFighter: FighterConfig;
  opponent: FighterConfig;
  onMatchEnd: (result: { won: boolean; score: number; coinsEarned: number }) => void;
  /** Optional: provide socket + roomId to enable real-time networked PvP */
  socket?: Socket;
  roomId?: string;
}

export interface FighterNetworkState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  lastAttack?: { isSpecial: boolean; damage: number };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const GAME_W = 960;
const GAME_H = 540;
const GROUND_Y = GAME_H - 80;
const MAX_HP = 100;
const ROUND_TIME = 60; // seconds
const PLAYER_SPEED = 250;
const JUMP_VELOCITY = -500;
const ATTACK_DAMAGE = 12;
const SPECIAL_DAMAGE = 28;
const ATTACK_COOLDOWN = 600;  // ms
const SPECIAL_COOLDOWN = 3000; // ms
const COMBO_WINDOW = 800; // ms between hits to count as combo

// ─── Scene ────────────────────────────────────────────────────────────────────

export class DegenFighterScene extends Phaser.Scene {
  // fighters
  private localSprite!: Phaser.GameObjects.Container;
  private opponentSprite!: Phaser.GameObjects.Container;
  private localHP = MAX_HP;
  private opponentHP = MAX_HP;
  private localHPBar!: Phaser.GameObjects.Rectangle;
  private opponentHPBar!: Phaser.GameObjects.Rectangle;

  // physics bodies
  private localBody!: Phaser.Physics.Arcade.Sprite;
  private opponentBody!: Phaser.Physics.Arcade.Sprite;

  // UI
  private timerText!: Phaser.GameObjects.Text;
  private localNameText!: Phaser.GameObjects.Text;
  private opponentNameText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;

  // state
  private timeLeft = ROUND_TIME;
  private gameTimer?: Phaser.Time.TimerEvent;
  private isGameOver = false;
  private localAttackCooldown = 0;
  private localSpecialCooldown = 0;
  private comboCount = 0;
  private lastHitTime = 0;
  private attackAnimTimer?: Phaser.Time.TimerEvent;

  // config
  private localFighter!: FighterConfig;
  private opponent!: FighterConfig;
  private onMatchEnd!: (result: { won: boolean; score: number; coinsEarned: number }) => void;

  // networked PvP (optional)
  private pvpSocket?: Socket;
  private pvpRoomId?: string;
  private isNetworked = false;
  private pendingOpponentState: FighterNetworkState | null = null;
  private stateEmitInterval = 0; // ms accumulator for throttled emit

  // controls
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private attackKey!: Phaser.Input.Keyboard.Key;
  private specialKey!: Phaser.Input.Keyboard.Key;

  // avatar textures
  private localAvatarLoaded = false;
  private opponentAvatarLoaded = false;

  constructor() {
    super({ key: 'DegenFighterScene' });
  }

  init(data: DegenFighterSceneData) {
    this.localFighter = data.localFighter;
    this.opponent = data.opponent;
    this.onMatchEnd = data.onMatchEnd;
    this.localHP = MAX_HP;
    this.opponentHP = MAX_HP;
    this.timeLeft = ROUND_TIME;
    this.isGameOver = false;
    this.comboCount = 0;

    // Networked PvP setup
    if (data.socket && data.roomId) {
      this.pvpSocket = data.socket;
      this.pvpRoomId = data.roomId;
      this.isNetworked = true;

      this.pvpSocket.on('pvp:opponentState', ({ state }: { state: FighterNetworkState }) => {
        this.pendingOpponentState = state;
        // Apply incoming HP authoritatively (opponent controls their own HP reporting)
        if (state.hp < this.opponentHP) {
          this.opponentHP = state.hp;
        }
      });

      this.pvpSocket.on('pvp:opponentLeft', () => {
        if (!this.isGameOver) {
          this.endMatch(true); // opponent forfeited — local player wins
        }
      });

      this.pvpSocket.on('pvp:matchEnded', ({ won }: { won: boolean }) => {
        if (!this.isGameOver) {
          this.endMatch(won);
        }
      });
    } else {
      this.isNetworked = false;
      this.pvpSocket = undefined;
      this.pvpRoomId = undefined;
    }
  }

  // ── preload ──────────────────────────────────────────────────────────────────

  preload() {
    // Load avatar images with CORS-safe fallback
    this.load.on('filecomplete', (key: string) => {
      if (key === 'local-avatar') this.localAvatarLoaded = true;
      if (key === 'opp-avatar') this.opponentAvatarLoaded = true;
    });

    this.load.on('loaderror', (file: { key: string }) => {
      if (file.key === 'local-avatar') this.localAvatarLoaded = false;
      if (file.key === 'opp-avatar') this.opponentAvatarLoaded = false;
    });

    const localAv = this.localFighter.avatarUrl || '/DegenRaceAssets/G1small.png';
    const oppAv = this.opponent.avatarUrl || '/DegenRaceAssets/G1small.png';

    this.load.image('local-avatar', localAv);
    this.load.image('opp-avatar', oppAv);
    this.load.image('ground', '/DegenFighterAssets/ground.png');

    // Try to load the DegenFighter logo
    if (this.textures.exists('fighter-logo')) return;
    this.load.image('fighter-logo', '/DegenFighterAssets/DegenFighterII_Logo_Full.png');
  }

  // ── create ───────────────────────────────────────────────────────────────────

  create() {
    const W = GAME_W;
    const H = GAME_H;

    // Background gradient
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x0a0015, 0x0a0015, 0x1a0030, 0x1a0030, 1);
    bg.fillRect(0, 0, W, H);

    // Decorative arena lines
    const arena = this.add.graphics();
    arena.lineStyle(2, 0xff4400, 0.4);
    arena.strokeRect(40, 40, W - 80, H - 80);
    arena.lineStyle(1, 0xff4400, 0.15);
    arena.strokeRect(60, 60, W - 120, H - 120);

    // Ground platform
    const ground = this.add.rectangle(W / 2, GROUND_Y + 30, W - 40, 20, 0xff4400, 0.7);
    this.add.rectangle(W / 2, GROUND_Y + 30, W - 44, 18, 0x220000, 0.8);

    // Physics group for ground
    const groundGroup = this.physics.add.staticGroup();
    const groundBody = this.add.rectangle(W / 2, GROUND_Y + 30, W - 40, 20);
    groundGroup.add(groundBody);

    // ── Physics sprites (invisible, drive collision) ──────────────────────────
    this.localBody = this.physics.add.sprite(200, GROUND_Y - 40, '__DEFAULT');
    this.localBody.setAlpha(0);
    this.localBody.setDisplaySize(60, 90);
    this.localBody.setBounce(0.1);
    this.localBody.setCollideWorldBounds(true);
    (this.localBody.body as Phaser.Physics.Arcade.Body).setGravityY(600);

    this.opponentBody = this.physics.add.sprite(W - 200, GROUND_Y - 40, '__DEFAULT');
    this.opponentBody.setAlpha(0);
    this.opponentBody.setDisplaySize(60, 90);
    this.opponentBody.setBounce(0.1);
    this.opponentBody.setCollideWorldBounds(true);
    (this.opponentBody.body as Phaser.Physics.Arcade.Body).setGravityY(600);

    this.physics.add.collider(this.localBody, groundGroup);
    this.physics.add.collider(this.opponentBody, groundGroup);

    // ── Fighter visuals ───────────────────────────────────────────────────────
    this.localSprite = this.createFighterVisual(200, GROUND_Y - 40, 'local-avatar', 0x4488ff, this.localAvatarLoaded);
    this.opponentSprite = this.createFighterVisual(W - 200, GROUND_Y - 40, 'opp-avatar', 0xff4444, this.opponentAvatarLoaded);

    // ── HP bars ───────────────────────────────────────────────────────────────
    this.createHPBars();

    // ── Names ─────────────────────────────────────────────────────────────────
    this.localNameText = this.add.text(80, 28, this.localFighter.username || 'You', {
      fontSize: '14px', fontFamily: 'monospace', color: '#88bbff',
      stroke: '#000000', strokeThickness: 3,
    });
    this.opponentNameText = this.add.text(W - 80, 28, this.opponent.username || 'Opponent', {
      fontSize: '14px', fontFamily: 'monospace', color: '#ff8888',
      stroke: '#000000', strokeThickness: 3,
      align: 'right',
    }).setOrigin(1, 0);

    // ── Timer ─────────────────────────────────────────────────────────────────
    this.timerText = this.add.text(W / 2, 18, `${ROUND_TIME}`, {
      fontSize: '28px', fontFamily: 'monospace', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5, 0);

    // ── Combo ─────────────────────────────────────────────────────────────────
    this.comboText = this.add.text(W / 2, H / 2, '', {
      fontSize: '36px', fontFamily: 'monospace', color: '#ffe36d',
      stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5).setAlpha(0);

    // ── Controls hint ─────────────────────────────────────────────────────────
    this.add.text(W / 2, H - 18, '← → Move   ↑ Jump   Z Attack   X Special', {
      fontSize: '11px', fontFamily: 'monospace', color: '#888888',
    }).setOrigin(0.5, 1);

    // ── Keyboard ─────────────────────────────────────────────────────────────
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.attackKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this.specialKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.X);

    // ── Round start flash ─────────────────────────────────────────────────────
    this.roundText = this.add.text(W / 2, H / 2 - 40, 'FIGHT!', {
      fontSize: '64px', fontFamily: 'monospace', color: '#ff4400',
      stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: this.roundText,
      alpha: { from: 1, to: 0 },
      scaleX: { from: 0.5, to: 1.5 },
      scaleY: { from: 0.5, to: 1.5 },
      duration: 1200,
      ease: 'Expo.Out',
    });

    // ── Game timer ────────────────────────────────────────────────────────────
    this.gameTimer = this.time.addEvent({
      delay: 1000,
      callback: this.tickTimer,
      callbackScope: this,
      loop: true,
    });

    // ── AI opponent movement (only in solo/offline mode) ──────────────────────
    if (!this.isNetworked) {
      this.time.addEvent({
        delay: 1200,
        callback: this.aiTick,
        callbackScope: this,
        loop: true,
      });
    }
  }

  // ── update ───────────────────────────────────────────────────────────────────

  update(time: number, delta: number) {
    if (this.isGameOver) return;

    this.localAttackCooldown = Math.max(0, this.localAttackCooldown - delta);
    this.localSpecialCooldown = Math.max(0, this.localSpecialCooldown - delta);

    // ── Movement ─────────────────────────────────────────────────────────────
    const body = this.localBody.body as Phaser.Physics.Arcade.Body;

    if (this.cursors.left.isDown) {
      this.localBody.setVelocityX(-PLAYER_SPEED);
    } else if (this.cursors.right.isDown) {
      this.localBody.setVelocityX(PLAYER_SPEED);
    } else {
      this.localBody.setVelocityX(0);
    }

    if (this.cursors.up.isDown && body.blocked.down) {
      this.localBody.setVelocityY(JUMP_VELOCITY);
    }

    // ── Track visual to physics body ─────────────────────────────────────────
    this.localSprite.setPosition(this.localBody.x + 30, this.localBody.y + 45);
    this.opponentSprite.setPosition(this.opponentBody.x + 30, this.opponentBody.y + 45);

    // ── Attack ───────────────────────────────────────────────────────────────
    if (Phaser.Input.Keyboard.JustDown(this.attackKey) && this.localAttackCooldown === 0) {
      this.performAttack(false);
    }
    if (Phaser.Input.Keyboard.JustDown(this.specialKey) && this.localSpecialCooldown === 0) {
      this.performAttack(true);
    }

    // ── Networked PvP: emit local state + apply opponent state ────────────────
    if (this.isNetworked && this.pvpSocket && this.pvpRoomId) {
      // Throttle to ~20 updates/sec
      this.stateEmitInterval += delta;
      if (this.stateEmitInterval >= 50) {
        this.stateEmitInterval = 0;
        const state: FighterNetworkState = {
          x: this.localBody.x,
          y: this.localBody.y,
          vx: (this.localBody.body as Phaser.Physics.Arcade.Body).velocity.x,
          vy: (this.localBody.body as Phaser.Physics.Arcade.Body).velocity.y,
          hp: this.localHP,
        };
        this.pvpSocket.emit('pvp:inputState', { roomId: this.pvpRoomId, state });
      }

      // Apply buffered opponent network state
      if (this.pendingOpponentState) {
        const s = this.pendingOpponentState;
        this.pendingOpponentState = null;
        // Lerp opponent body position toward received state
        const lerpFactor = 0.25;
        this.opponentBody.x = Phaser.Math.Linear(this.opponentBody.x, s.x, lerpFactor);
        this.opponentBody.y = Phaser.Math.Linear(this.opponentBody.y, s.y, lerpFactor);
        // Update opponent HP bar
        this.updateOpponentHPBar();
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private createFighterVisual(
    x: number,
    y: number,
    textureKey: string,
    color: number,
    avatarLoaded: boolean
  ): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);

    // Body glow
    const glow = this.add.ellipse(0, 20, 70, 20, color, 0.25);
    container.add(glow);

    // Avatar or colored box fallback
    if (avatarLoaded && this.textures.exists(textureKey)) {
      const av = this.add.image(0, -20, textureKey).setDisplaySize(60, 60);
      container.add(av);
    } else {
      const box = this.add.rectangle(0, -20, 56, 70, color, 0.9);
      container.add(box);
      const label = this.add.text(0, -20, '⚔', {
        fontSize: '32px', color: '#ffffff',
      }).setOrigin(0.5);
      container.add(label);
    }

    return container;
  }

  private createHPBars() {
    const W = GAME_W;
    const barY = 60;
    const barW = 280;
    const barH = 14;

    // Local HP (left side)
    this.add.rectangle(80 + barW / 2, barY, barW, barH, 0x333333);
    this.localHPBar = this.add.rectangle(80 + barW / 2, barY, barW, barH, 0x00ee44);

    // Opponent HP (right side, reversed)
    this.add.rectangle(W - 80 - barW / 2, barY, barW, barH, 0x333333);
    this.opponentHPBar = this.add.rectangle(W - 80 - barW / 2, barY, barW, barH, 0xee2222);
  }

  private performAttack(isSpecial: boolean) {
    const damage = isSpecial ? SPECIAL_DAMAGE : ATTACK_DAMAGE;
    const range = isSpecial ? 200 : 120;

    const dist = Math.abs(this.localBody.x - this.opponentBody.x);
    const hit = dist < range;

    if (isSpecial) {
      this.localSpecialCooldown = SPECIAL_COOLDOWN;
      this.flashFighter(this.localSprite, 0xffee00);
    } else {
      this.localAttackCooldown = ATTACK_COOLDOWN;
      this.flashFighter(this.localSprite, 0xffffff);
    }

    if (hit) {
      const now = this.time.now;
      if (now - this.lastHitTime < COMBO_WINDOW) {
        this.comboCount++;
      } else {
        this.comboCount = 1;
      }
      this.lastHitTime = now;

      const comboDamage = damage * (1 + (this.comboCount - 1) * 0.15);
      this.dealDamageToOpponent(Math.round(comboDamage));
      this.flashFighter(this.opponentSprite, 0xff0000);
      this.showCombo(this.comboCount);
    }
  }

  private dealDamageToOpponent(damage: number) {
    this.opponentHP = Math.max(0, this.opponentHP - damage);
    const pct = this.opponentHP / MAX_HP;
    this.opponentHPBar.setScale(pct, 1);
    this.cameras.main.shake(80, 0.006);
    if (this.opponentHP <= 0) {
      this.endMatch(true);
    }
  }

  private dealDamageToLocal(damage: number) {
    this.localHP = Math.max(0, this.localHP - damage);
    const pct = this.localHP / MAX_HP;
    this.localHPBar.setScale(pct, 1);
    if (this.localHP <= 0) {
      this.endMatch(false);
    }
  }

  private flashFighter(container: Phaser.GameObjects.Container, color: number) {
    this.tweens.add({
      targets: container,
      alpha: 0.3,
      duration: 80,
      yoyo: true,
      repeat: 1,
    });
  }

  private showCombo(count: number) {
    if (count < 2) {
      this.comboText.setAlpha(0);
      return;
    }
    this.comboText.setText(`${count}x COMBO!`);
    this.comboText.setAlpha(1);
    this.tweens.add({
      targets: this.comboText,
      alpha: 0,
      delay: 900,
      duration: 400,
    });
  }

  private tickTimer() {
    if (this.isGameOver) return;
    this.timeLeft--;
    this.timerText.setText(`${this.timeLeft}`);
    if (this.timeLeft <= 10) {
      this.timerText.setColor('#ff4400');
    }
    if (this.timeLeft <= 0) {
      // Whoever has more HP wins
      this.endMatch(this.localHP > this.opponentHP);
    }
  }

  /** Simple deterministic AI for the opponent (single-player / waiting for real socket opponent) */
  private aiTick() {
    if (this.isGameOver) return;

    const dist = this.localBody.x - this.opponentBody.x;
    const absD = Math.abs(dist);

    // Move toward player
    if (absD > 100) {
      const dir = dist > 0 ? 1 : -1;
      this.opponentBody.setVelocityX(dir * 180);
    } else {
      this.opponentBody.setVelocityX(0);
      // Attack when close
      if (absD < 110 && Phaser.Math.Between(0, 2) === 0) {
        const dmg = Phaser.Math.Between(6, 14);
        this.dealDamageToLocal(dmg);
        this.flashFighter(this.localSprite, 0xff0000);
      }
    }

    // Occasional jump
    const oppBody = this.opponentBody.body as Phaser.Physics.Arcade.Body;
    if (oppBody.blocked.down && Phaser.Math.Between(0, 4) === 0) {
      this.opponentBody.setVelocityY(JUMP_VELOCITY * 0.8);
    }
  }

  private endMatch(localWon: boolean) {
    if (this.isGameOver) return;
    this.isGameOver = true;

    this.gameTimer?.remove();

    const W = GAME_W;
    const H = GAME_H;

    // Result overlay
    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.65);
    const resultText = this.add.text(W / 2, H / 2 - 30, localWon ? '🏆 YOU WIN!' : '💀 DEFEAT', {
      fontSize: '52px', fontFamily: 'monospace',
      color: localWon ? '#ffe36d' : '#ff4444',
      stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5);

    // Score calculation
    const hpRemaining = localWon ? this.localHP : 0;
    const timeBonus = this.timeLeft * 5;
    const comboBonus = this.comboCount * 10;
    const score = hpRemaining * 8 + timeBonus + comboBonus + (localWon ? 200 : 0);
    const coinsEarned = Math.floor(score / 20);

    this.add.text(W / 2, H / 2 + 40, `Score: ${score}   Coins: ${coinsEarned}`, {
      fontSize: '20px', fontFamily: 'monospace', color: '#cccccc',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5);

    this.tweens.add({
      targets: [overlay, resultText],
      alpha: { from: 0, to: 1 },
      duration: 600,
    });

    // Fire callback after short delay so player can see result
    this.time.delayedCall(2500, () => {
      this.onMatchEnd({ won: localWon, score, coinsEarned });
    });
  }
}
