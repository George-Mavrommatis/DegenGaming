

import Phaser from 'phaser';

type CharacterType =
  | 'wegen_normal'
  | 'wegen_fast'
  | 'wegen_tanky'
  | 'wegen_golden'
  | 'bomb'
  | 'clock'
  | 'mystery_box';

const CHARACTER_DATA = {
  'wegen_normal':   { points: 10,  sprite: 'wegen_normal',       whackedSprite: 'wegen_normal_whacked', hits: 1 } as const,
  'wegen_fast':     { points: 25,  sprite: 'wegen_fast',         whackedSprite: 'wegen_fast_whacked',   hits: 1 } as const,
  'wegen_tanky':    { points: 50,  sprite: 'wegen_tanky',        whackedSprite: 'wegen_tanky_whacked',  hits: 3 } as const,
  'wegen_golden':   { points: 150, sprite: 'wegen_golden',       whackedSprite: 'wegen_golden_whacked', hits: 1 } as const,
  'bomb':           { points: -20, sprite: 'bomb',              timePenalty: -15,                     hits: 1 } as const,
  'clock':          { points: 0,   sprite: 'clock',             timeBonus: 10,                        hits: 1 } as const,
  'mystery_box':    { points: 0,   sprite: 'mystery_box',       hits: 2 } as const,
};

interface UIType {
  score: Phaser.GameObjects.Text;
  timer: Phaser.GameObjects.Text;
}

interface InstructionSlide {
  key: string;
  title: string;
  description: string;
}


// HAMMER
const hammerHeadOriginX = 0.85; // (estimate, replace with yours)
const hammerHeadOriginY = 0.8;  // (estimate, replace with yours)


export class WackAWegenScene extends Phaser.Scene {
  // ─── Game State ──────────────────────────────────────────────────────────────
  private score = 0;
  private timeLeft = 60;
  private isGameOver = false;
  private isPaused = false;
  private gameStartTime = 0;
  private skipInstructions = false;
  private comboCount = 0;
  private lastHitTime = 0;
  private missCount = 0;
  private perfectHits = 0;

  // ─── Layout ──────────────────────────────────────────────────────────────────
  private barHeight = 0;
  private barWidth = 0;
  private timeBar?: Phaser.GameObjects.Graphics;
  private wegens: Phaser.GameObjects.Sprite[] = [];
  private holes: Phaser.GameObjects.Image[] = [];
  private characterScale = 0.65; // Reduced scale for characters

  // ─── Timers & UI ─────────────────────────────────────────────────────────────
  private gameTimer?: Phaser.Time.TimerEvent;
  private popUpTimer?: Phaser.Time.TimerEvent;
  private ui?: UIType;

  // ─── Pause Overlay ───────────────────────────────────────────────────────────
  private pauseOverlay?: Phaser.GameObjects.Graphics;
  private pauseText?: Phaser.GameObjects.Text;
  private pauseButton?: Phaser.GameObjects.Text;

  // ─── Settings / Assets ───────────────────────────────────────────────────────
  private username = 'Guest';
  private avatarUrl = '/placeholder-avatar.png';

  // ─── Instruction Carousel ────────────────────────────────────────────────────
  private instructionContainer?: Phaser.GameObjects.Container;
  private instructionSlides: InstructionSlide[] = [];
  private currentSlide = 0;

  // ─── Resize Handler Fix ──────────────────────────────────────────────────────
  private hasResizeHandler = false;
  private resizeRestartTimer?: number;
  private lastWidth = 0;
  private lastHeight = 0;

  // ─── Hammer & Effects ────────────────────────────────────────────────────────
  private hammerCursor?: Phaser.GameObjects.Image;
  private clickIndicator?: Phaser.GameObjects.Graphics;
  private hasPointerListeners = false;
  private setHammerCursorMode(enabled: boolean) {
    if (enabled) {
      this.input.setDefaultCursor('none');
      this.hammerCursor?.setVisible(true);
    } else {
      this.input.setDefaultCursor('auto');
      this.hammerCursor?.setVisible(false);
    }
  }
  // ─── Audio ───────────────────────────────────────────────────────────────────
  private bgm?: Phaser.Sound.BaseSound;
  private audioEnabled = true;



  constructor() {
    super({ key: 'WackAWegenScene' });
  }

  init(data: {
       username: string;
       avatarUrl: string;
       onGameOver: (e: { score: number }) => void;
       skipInstructions?: boolean;
       txSig?: string; // If you want to use it
  }) {
    // Defensive: always use fallback
    this.username = data.username?.trim() || 'Guest';
    this.avatarUrl = data.avatarUrl?.trim() || '/placeholder-avatar.png';
    this.score = 0;
    this.timeLeft = 60;
    this.isGameOver = false;
    this.isPaused = false;
    this.wegens = [];
    this.holes = [];
    this.skipInstructions = !!data.skipInstructions;
    this.comboCount = 0;
    this.lastHitTime = 0;
    this.missCount = 0;
    this.perfectHits = 0;
    this.txSig = data.txSig;

    // ensure only one listener
    this.game.events.off('game-over');
    this.game.events.on('game-over', data.onGameOver, this);

    console.log('[WackAWegenScene] init:', {
      username: this.username,
      avatarUrl: this.avatarUrl,
      skipInstructions: this.skipInstructions,
    });
  }

  preload(): void {
    this.load.image('background', '/WackAWegenAssets/BG.png');
    this.load.image('hole', '/WackAWegenAssets/hole.png');
    this.load.image('wegen_normal', '/WackAWegenAssets/wegen1.png');
    this.load.image('wegen_normal_whacked', '/WackAWegenAssets/whacked1.png');
    this.load.image('wegen_fast', '/WackAWegenAssets/wegen2.png');
    this.load.image('wegen_fast_whacked', '/WackAWegenAssets/whacked2.png');
    this.load.image('wegen_tanky', '/WackAWegenAssets/wegen3.png');
    this.load.image('wegen_tanky_whacked', '/WackAWegenAssets/whacked3.png');
    this.load.image('wegen_golden', '/WackAWegenAssets/wegen4.png');
    this.load.image('wegen_golden_whacked', '/WackAWegenAssets/whacked4.png');
    this.load.image('bomb', '/WackAWegenAssets/bomb.png');
    this.load.image('clock', '/WackAWegenAssets/clock.png');
    this.load.image('mystery_box', '/WackAWegenAssets/mysteryS.png');
    this.load.image('instr_1', '/WackAWegenAssets/BG-Wack.png');
    this.load.image('instr_2', '/WackAWegenAssets/BG-Wack.png');
    this.load.image('instr_3', '/WackAWegenAssets/BG-Wack.png');
    this.load.image('hammer', '/WackAWegenAssets/hammer.png');
    this.load.image('near_miss', '/WackAWegenAssets/miss.png');
    this.load.spritesheet('explosion', '/WackAWegenAssets/explosionS.png', {
      frameWidth: 128,
      frameHeight: 128,
    });


    // Load sounds with error handling
    // Try loading WAV files first, then fallback to MP3
    const audioFiles = [
      { key: 'bgm', paths: ['../sounds/WackAWegen/grid.mp3', '/sounds/WackAWegen/grid.mp3'] },
      { key: 'sfx_whack', paths: ['../sounds/WackAWegen/whack.wav', '/sounds/WackAWegen/whack.wav'] },
      { key: 'sfx_whack_golden', paths: ['../sounds/WackAWegen/whack.wav', '/sounds/WackAWegen/whack.wav'] },
      { key: 'sfx_bomb', paths: ['../sounds/WackAWegen/explosion.wav', '/sounds/WackAWegen/explosion.wav'] },
      { key: 'sfx_clock', paths: ['../sounds/WackAWegen/sweepTransition.wav', '/sounds/WackAWegen/sweepTransition.wav'] },
      { key: 'sfx_mystery', paths: ['../sounds/WackAWegen/notification.wav', '/sounds/WackAWegen/notification.wav'] },
      { key: 'sfx_miss', paths: ['../sounds/WackAWegen/miss.wav', '/sounds/WackAWegen/miss.wav'] },
      { key: 'sfx_combo', paths: ['../sounds/WackAWegen/combo.wav', '/sounds/WackAWegen/combo.wav'] },
    ];

    // Load audio with multiple format support
    audioFiles.forEach(({ key, paths }) => {
      this.load.audio(key, paths);
    });

    this.load.crossOrigin = 'anonymous';
    this.load.image('userAvatar', this.avatarUrl);
    this.load.crossOrigin = null;

    // Enhanced error handling
    this.load.on('loaderror', (file: any) => {
      console.error('[WackAWegenScene] Asset failed to load:', file.key, file.src);

      // Handle audio load errors gracefully
      if (file.type === 'audio') {
        console.warn(`Audio file ${file.key} failed to load. Audio will be disabled.`);
        this.audioEnabled = false;
      }

      if (file.key === 'userAvatar') {
        this.textures.remove('userAvatar');
        this.load.image('userAvatar', '/placeholder-avatar.png');
        this.load.start();
      }
    });

    // Add file processing error handler
    this.load.on('filecomplete', (key: string, type: string, data: any) => {
      if (type === 'audio') {
        console.log(`[WackAWegenScene] Audio loaded successfully: ${key}`);
      }
    });
  }

  create(): void {
  console.log('[WackAWegenScene] create called, skipInstructions:', this.skipInstructions);

  this.barHeight = Math.max(60, Math.round(this.scale.height * 0.11));


  this.add
  .image(this.scale.width / 2, this.scale.height / 2, 'background')
  .setDisplaySize(this.scale.width, this.scale.height);

  if (!this.anims.exists('explode')) {
    this.anims.create({
      key: 'explode',
      frames: this.anims.generateFrameNumbers('explosion', { start: 0, end: 4 }),
      frameRate: 20,
      hideOnComplete: true,
    });
  }

  // Create hammer cursor (check if image loaded)
  if (this.textures.exists('hammer')) {
    this.hammerCursor = this.add.image(0, 0, 'hammer')
      .setScale(0.5)
      .setOrigin(hammerHeadOriginX, hammerHeadOriginY)
      .setDepth(100)
      .setVisible(true);

    // Make the hammer follow the pointer
    if (!this.hasPointerListeners) {
      this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
        this.hammerCursor!.setPosition(pointer.x, pointer.y);
      });
      this.input.on('pointerover', () => {
      if (!this.isPaused && !this.isGameOver) this.hammerCursor?.setVisible(true);
      });
      this.input.on('pointerout', () => {
        this.hammerCursor?.setVisible(false);
      });
      this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        this.showClickEffect(pointer.x, pointer.y);
      });
      this.hasPointerListeners = true;
    }


  // Create click indicator
  this.clickIndicator = this.add.graphics().setDepth(99);

  // Hide default cursor in game area
  this.input.setDefaultCursor('auto');
  this.setHammerCursorMode(false);

  // Listen for page unload or visibility change (do this ONCE, not every create if scene restarts)
  if (!this.hasResizeHandler) {
    window.addEventListener('beforeunload', this.handleUnload);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.handleUnload();
      }
    });
    this.hasResizeHandler = true;
  }

  this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
  // Adjust UI elements here based on new gameSize.width/height
});

  // --- THIS IS THE IMPORTANT PART ---
  if (this.skipInstructions) {
    this.buildGame();
    this.startGame();
  } else {
    this.buildInstructionSlides();
    this.showInstructions();
  }
} // <--- CLOSE create() method here!

}

private handleUnload = () => {
  if (!this.isGameOver) {
    this.endGame();
    // Save score to server (fire-and-forget)
    if (navigator.sendBeacon) {
      const payload = JSON.stringify({
        username: this.username,
        score: this.score,
        // add more fields if needed
          onGameOver: (e: { score: number }) => this.game.events.emit('game-over', e),
      });
    //  navigator.sendBeacon('/api/save-score', payload);
    } else {
      // fallback: maybe localStorage or fetch (not reliable on unload)
      localStorage.setItem('lastWackAWegenScore', this.score.toString());
    }
  }
}

  // --- FIX: Proper debounced resize handler ---
  private handleResize(): void {
    // Force get current dimensions
    const w = this.game.scale.width;
    const h = this.game.scale.height;

    // Always restart on any size change or fullscreen toggle
    if (this.resizeRestartTimer) {
      clearTimeout(this.resizeRestartTimer);
    }

    this.resizeRestartTimer = window.setTimeout(() => {
      if (!this.isGameOver) {
        // Store current game state
        const currentScore = this.score;
        const currentTime = this.timeLeft;

        this.scene.restart({
          username: this.username,
          avatarUrl: this.avatarUrl,
          onGameOver: (e: { score: number }) => this.game.events.emit('game-over', e),
          skipInstructions: true, // Skip instructions on resize
        });

        // Restore game state after restart
        this.time.delayedCall(100, () => {
          this.score = currentScore;
          this.timeLeft = currentTime;
          this.ui?.score.setText(`Score: ${this.score}`);
          this.ui?.timer.setText(`${this.timeLeft}`);
          this.updateTimeBarGraphics();
        });
      }
    }, 150);
  }

  // ─── HAMMER EFFECTS ──────────────────────────────────────────────────────────
  private showClickEffect(x: number, y: number) {
    // Hammer animation
    if (this.hammerCursor) {
      this.tweens.add({
        targets: this.hammerCursor,
        angle: -30,
        duration: 100,
        yoyo: true,
        onComplete: () => {
          this.hammerCursor?.setAngle(0);
        }
      });
    }

    // Click indicator
    this.clickIndicator?.clear();
    this.clickIndicator?.lineStyle(3, 0xffffff, 0.8);
    this.clickIndicator?.strokeCircle(x, y, 10);
    this.clickIndicator?.setAlpha(1);

    this.tweens.add({
      targets: this.clickIndicator,
      alpha: 0,
      duration: 300,
      onUpdate: (tween) => {
        const scale = 1 + tween.progress * 2;
        this.clickIndicator?.clear();
        this.clickIndicator?.lineStyle(3, 0xffffff, 0.8 * (1 - tween.progress));
        this.clickIndicator?.strokeCircle(x, y, 10 * scale);
      }
    });

  } // ← close the showClickEffect method

  private checkNearMiss(x: number, y: number) {
    // Check if click was near any active wegen
    let nearMiss = false;
    const missThreshold = 50; // pixels

    for (const wegen of this.wegens) {
      if (wegen.getData('isUp') && wegen.visible) {
        const distance = Phaser.Math.Distance.Between(x, y, wegen.x, wegen.y);
        if (distance > wegen.displayWidth / 2 && distance < missThreshold) {
          nearMiss = true;
          break;
        }
      }
    }

    if (nearMiss) {
      this.missCount++;
      if (this.cache.audio.exists('sfx_miss')) {
        this.sound.play('sfx_miss', { volume: 0.5 });
      }

      // Show near miss text or image
      const missText = this.add.text(x, y - 20, 'NEAR MISS!', {
        fontSize: '24px',
        color: '#ff6666',
        stroke: '#000',
        strokeThickness: 4,
        fontStyle: 'bold'
      }).setOrigin(0.5);

      this.tweens.add({
        targets: missText,
        y: missText.y - 40,
        alpha: 0,
        scale: 1.5,
        duration: 800,
        onComplete: () => missText.destroy()
      });

      // Reset combo on miss
      this.comboCount = 0;
    }
  }



  // ─── INSTRUCTION CAROUSEL ─────────────────────────────────────────────────────
  private buildInstructionSlides() {
    this.instructionSlides = [
      {
        key: 'instr_1',
        title: 'Power-Ups & Penalties',
        description:
          '- Bombs: lose time & shake\n- Clock: gain time\n- Mystery: random bonus\n- Golden Wegen: big points!',
      },
      {
        key: 'instr_2',
        title: 'Scoring & Combos',
        description: '- Normal: 10pts\n- Fast: 25pts\n- Tanky: 50pts (3 hits)\n- Golden: 150pts\n\nHit fast for COMBOS!',
      },
      {
        key: 'instr_3',
        title: 'Pro Tips',
        description:
          '- Chain hits for combo multipliers\n- Avoid near misses\n- Time bonuses get harder\n- Watch for patterns!',
      },
    ];
  }

  private showInstructions() {
    const w = this.scale.width;
    const h = this.scale.height;
    const overlay = this.add.graphics().fillStyle(0x000000, 0.8).fillRect(0, 0, w, h);
    const c = this.add.container(0, 0);
    this.instructionContainer = c;

    // placeholders
    const imgY = h * 0.35;
    const titleY = h * 0.60;
    const descY = h * 0.68;
    const btnY = h * 0.85;

    const img = this.add.image(w / 2, imgY, '').setOrigin(0.5).setDisplaySize(w * 0.7, h * 0.4);
    const title = this.add
      .text(w / 2, titleY, '', { fontSize: '32px', color: '#FFD93B', fontStyle: 'bold' })
      .setOrigin(0.5);
    const desc = this.add
      .text(w / 2, descY, '', { fontSize: '24px', color: '#FFFFFF', align: 'center' })
      .setOrigin(0.5);

    const back = this.add
      .text(w * 0.25, btnY, '< Back', { fontSize: '28px', color: '#FFF' })
      .setOrigin(0.5)
      .setAlpha(0.6)
      .setInteractive({ useHandCursor: true });
    const next = this.add
      .text(w * 0.75, btnY, 'Next >', { fontSize: '28px', color: '#FFF' })
      .setOrigin(0.5)
      .setAlpha(0.6)
      .setInteractive({ useHandCursor: true });
    const start = this.add
      .text(w / 2, btnY, 'Start Game', { fontSize: '32px', color: '#00FF00', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });

    c.add([overlay, img, title, desc, back, next, start]);

    const render = () => {
      const slide = this.instructionSlides[this.currentSlide];
      img.setTexture(slide.key);
      title.setText(slide.title);
      desc.setText(slide.description);
      back.setVisible(this.currentSlide > 0);
      next.setVisible(this.currentSlide < this.instructionSlides.length - 1);
      start.setVisible(this.currentSlide === this.instructionSlides.length - 1);
    };
    render();

    back.on('pointerdown', () => {
      this.currentSlide = Math.max(0, this.currentSlide - 1);
      render();
    });
    next.on('pointerdown', () => {
      this.currentSlide = Math.min(this.instructionSlides.length - 1, this.currentSlide + 1);
      render();
    });
    start.on('pointerdown', () => {
      c.destroy(true);
      this.buildGame();
      this.startGame();
    });
  }

  // --- BUILD ACTUAL GAME ---
  private buildGame() {
    console.log('[WackAWegenScene] buildGame');
    this.createHoleGrid();
    this.createTopBar();
    this.createPauseScreen();
  }

  private createHoleGrid() {
    console.log('[WackAWegenScene] createHoleGrid');
    const rows = 4;
    const cols = 4;

    // Increased padding from borders
    const topPadding = this.barHeight + 80;
    const bottomPadding = 100;
    const sidePadding = 80;

    const gridW = Math.min(this.scale.width - (sidePadding * 2), 850);
    const gridH = Math.min(this.scale.height - topPadding - bottomPadding, 500);

    const startX = (this.scale.width - gridW) / 2;
    const startY = topPadding;

    const cellW = gridW / cols;
    const cellH = gridH / rows;

    this.holes = [];
    this.wegens = [];

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const x = startX + cellW * (j + 0.5);
        const y = startY + cellH * (i + 0.5);

        const hole = this.add.image(x, y, 'hole').setScale(0.4);
        this.holes.push(hole);

        const w = this.add
          .sprite(x, y + 10, 'wegen_normal') // Slight offset to overlap with hole
          .setOrigin(0.5, 0.95) // Changed origin to bottom for better overlap
          .setScale(this.characterScale)
          .setVisible(false)
          .setData({ isUp: false, type: 'none', hitsLeft: 0 })
          .setInteractive({ pixelPerfect: true, useHandCursor: false }); // Use pixel perfect hit detection

        w.on('pointerdown', () => this.whack(w));
        this.wegens.push(w);
      }
    }
  }

  private createTopBar() {
    const W = this.scale.width;
    const BH = this.barHeight;

    this.add
      .graphics()
      .fillStyle(0x2d3748, 0.85)
      .fillRect(0, 0, W, BH)
      .setDepth(10);

    const scoreText = this.add
      .text(20, BH / 2, `Score: 0`, {
        fontSize: `${Math.round(BH * 0.4)}px`,
        color: '#FFFFFF',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0.5)
      .setDepth(11);

    this.pauseButton = this.add
      .text(scoreText.getRightCenter().x + 60, BH / 2, '||', {
        fontSize: `${Math.round(BH * 0.5)}px`,
        color: '#FFFFFF',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(11)
      .setInteractive({ useHandCursor: true });
    this.pauseButton.on('pointerdown', () => this.togglePause());

    const timerText = this.add
      .text(W / 2, BH / 2, `${this.timeLeft}`, {
        fontSize: `${Math.round(BH * 0.65)}px`,
        color: '#FFD93B',
        fontStyle: '900',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(11);

    const userTxt = this.add
      .text(W / 2 + 100, BH / 2, this.username, {
        fontSize: `${Math.round(BH * 0.3)}px`,
        color: '#FFFFFF',
      })
      .setOrigin(0, 0.5)
      .setDepth(11);

    const avatar = this.add
      .image(userTxt.getRightCenter().x + 10, BH / 2, 'userAvatar')
      .setDisplaySize(BH * 0.7, BH * 0.7)
      .setOrigin(0, 0.5)
      .setDepth(11);
    const mask = this.add
      .graphics()
      .fillCircle(avatar.getCenter().x, avatar.getCenter().y, BH * 0.35);
    avatar.setMask(mask.createGeometryMask());

    const fs = this.add
      .text(W - 40, BH / 2, '[ ]', {
        fontSize: `${Math.round(BH * 0.5)}px`,
        color: '#FFFFFF',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(11)
      .setInteractive({ useHandCursor: true });
      fs.on('pointerdown', () => {
      if (this.scale.isFullscreen) {
        this.scale.stopFullscreen();
      } else {
        this.scale.startFullscreen();
      }
    });

    this.ui = { score: scoreText, timer: timerText };

    this.barWidth = W - 40;
    this.timeBar = this.add.graphics().setDepth(11);
    this.updateTimeBarGraphics();
  }

  private updateTimeBarGraphics() {
    if (!this.timeBar) return;
    const ratio = Phaser.Math.Clamp(this.timeLeft / 60, 0, 1);
    let color = 0x00ff00; // Green
    if (ratio < 0.33) color = 0xff0000; // Red
    else if (ratio < 0.66) color = 0xffff00; // Yellow

    this.timeBar.clear();
    this.timeBar.fillStyle(color, 1);
    this.timeBar.fillRect(20, this.barHeight - 6, this.barWidth * ratio, 8);
  }

  private createPauseScreen() {
    this.pauseOverlay = this.add
      .graphics()
      .fillStyle(0x000000, 0.7)
      .fillRect(0, 0, this.scale.width, this.scale.height)
      .setDepth(20)
      .setVisible(false);

    this.pauseText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'PAUSED', {
        fontSize: `${Math.round(this.barHeight * 1.2)}px`,
        color: '#FFFFFF',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(21)
      .setVisible(false);
  }

  // ─── MAIN GAMELOOP ────────────────────────────────────────────────────────────
  private startGame() {
    this.isGameOver = false;
    this.isPaused = false;
    this.score = 0;
    this.timeLeft = 60;
    this.gameStartTime = this.time.now;
    this.comboCount = 0;
    this.lastHitTime = 0;
    this.missCount = 0;
    this.perfectHits = 0;

    this.ui?.score.setText(`Score: 0`);
    this.ui?.timer.setText(`${this.timeLeft}`);
    this.updateTimeBarGraphics();

    // Start background music
    if (this.cache.audio.exists('bgm')) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: 0.3 });
      this.bgm.play();
    }

    this.gameTimer?.destroy();
    this.popUpTimer?.destroy();

    this.gameTimer = this.time.addEvent({
      delay: 1000,
      callback: this.updateSecond,
      callbackScope: this,
      loop: true,
    });

    // Dynamic popup timing based on difficulty
    this.popUpTimer = this.time.addEvent({
      delay: 800,
      callback: this.popUp,
      callbackScope: this,
      loop: true,
    });
  }

  private updateSecond() {
    if (this.isGameOver || this.isPaused) return;
    this.timeLeft--;
    this.ui?.timer.setText(`${this.timeLeft}`);
    this.updateTimeBarGraphics();

    // Update popup frequency based on time left
    if (this.timeLeft < 20 && this.popUpTimer) {
      this.popUpTimer.destroy();
      this.popUpTimer = this.time.addEvent({
        delay: 500, // Faster spawns in final seconds
        callback: this.popUp,
        callbackScope: this,
        loop: true,
      });
    }

    if (this.timeLeft <= 0) this.endGame();
  }

  private getDifficultyStage() {
    const elapsed = (this.time.now - this.gameStartTime) / 1000;
    const survivalBonus = Math.floor(this.timeLeft / 20); // Harder with more time

    if (elapsed > 60 || survivalBonus > 2) return 4; // Ultra hard
    if (elapsed > 40 || survivalBonus > 1) return 3;
    if (elapsed > 20) return 2;
    return 1;
  }

  private getRandomCharacterType(): CharacterType {
    const stage = this.getDifficultyStage();
    let table: { type: CharacterType; weight: number }[] = [];

    if (stage === 4) {
      // Ultra hard - more bombs, faster enemies
      table = [
        { type: 'wegen_normal', weight: 15 },
        { type: 'wegen_fast',   weight: 35 },
        { type: 'wegen_tanky',  weight: 20 },
        { type: 'wegen_golden', weight: 8  },
        { type: 'bomb',         weight: 20 },
        { type: 'clock',        weight: 2  },
        { type: 'mystery_box',  weight: 25 },
      ];
    } else if (stage === 3) {
      table = [
        { type: 'wegen_normal', weight: 25 },
        { type: 'wegen_fast',   weight: 25 },
        { type: 'wegen_tanky',  weight: 15 },
        { type: 'wegen_golden', weight: 5  },
        { type: 'bomb',         weight: 15 },
        { type: 'clock',        weight: 5  },
        { type: 'mystery_box',  weight: 20 },
      ];
    } else if (stage === 2) {
      table = [
        { type: 'wegen_normal', weight: 40 },
        { type: 'wegen_fast',   weight: 25 },
        { type: 'wegen_tanky',  weight: 10 },
        { type: 'bomb',         weight: 10 },
        { type: 'clock',        weight: 5  },
        { type: 'mystery_box',  weight: 15 },
      ];
    } else {
      table = [
        { type: 'wegen_normal', weight: 60 },
        { type: 'wegen_fast',   weight: 15 },
        { type: 'bomb',         weight: 5  },
        { type: 'clock',        weight: 5  },
        { type: 'mystery_box',  weight: 10 },
      ];
    }

    const total = table.reduce((sum, x) => sum + x.weight, 0);
    let pick = Math.random() * total;
    for (const item of table) {
      if (pick < item.weight) return item.type;
      pick -= item.weight;
    }
    return 'wegen_normal';
  }

  private popUp() {
    if (this.isGameOver || this.isPaused) return;

    const avail = this.wegens.filter((w) => !w.getData('isUp'));
    if (!avail.length) return;

    // Multiple spawns at higher difficulties
    const stage = this.getDifficultyStage();
    const spawnCount = stage >= 3 ? Phaser.Math.Between(1, 2) : 1;

    for (let i = 0; i < spawnCount && avail.length > i; i++) {
      const slot = Phaser.Utils.Array.RemoveRandomElement(avail);
      if (slot) {
        const type = this.getRandomCharacterType();
        this.show(slot, type);
      }
    }
  }

  private show(obj: Phaser.GameObjects.Sprite, type: CharacterType) {
    const info = CHARACTER_DATA[type];
    const yOff = 30; // Much smaller movement for better overlap

    // Dynamic hold times based on difficulty
    const stage = this.getDifficultyStage();
    let hold = 650;
    let upSpeed = 200;

    if (type === 'wegen_fast') {
      hold = 250 - (stage * 20);
      upSpeed = 120;
    } else if (type === 'wegen_golden') {
      hold = 400 - (stage * 30);
      upSpeed = 150;
    } else if (type === 'wegen_tanky') {
      hold = 800;
      upSpeed = 250;
    } else {
      hold = Math.max(300, 650 - (stage * 50));
    }

    obj.setTexture(info.sprite);
    obj.setScale(this.characterScale);
    obj.setData({ isUp: true, type, hitsLeft: info.hits });
    obj.setVisible(true);

    this.tweens.add({
      targets: obj,
      y: obj.y - yOff,
      duration: upSpeed,
      yoyo: true,
      hold,
      onComplete: () => {
        obj.setVisible(false);
        obj.setData('isUp', false);
        obj.y += yOff;
      },
    });
  }

  private whack(obj: Phaser.GameObjects.Sprite) {
    if (!obj.getData('isUp') || this.isGameOver || this.isPaused) {
      return;
    }

    const type = obj.getData('type') as CharacterType;
    const info = CHARACTER_DATA[type];
    let hitsLeft = obj.getData('hitsLeft') ?? info.hits;
    hitsLeft--;
    obj.setData('hitsLeft', hitsLeft);

    // Calculate combo
    const now = this.time.now;
    if (now - this.lastHitTime < 1000) {
      this.comboCount++;
      if (this.comboCount > 2 && this.cache.audio.exists('sfx_combo')) {
        this.sound.play('sfx_combo', { volume: 0.6 });
      }
    } else {
      this.comboCount = 1;
    }
    this.lastHitTime = now;

    // MULTI-HIT FEEDBACK
    if (hitsLeft > 0) {
      const style: Phaser.Types.GameObjects.Text.TextStyle = {
        fontSize: '32px',
        color: type === 'mystery_box' ? '#ff0' : '#fff',
        stroke: '#000',
        strokeThickness: 4,
      };
      if (type === 'mystery_box') {
        obj.setTint(0xffff00);
        this.time.delayedCall(100, () => obj.clearTint());
      } else if (type === 'wegen_tanky') {
        // Flash red for tanky hits
        obj.setTint(0xff6666);
        this.time.delayedCall(100, () => obj.clearTint());
      }

      const t = this.add
        .text(obj.x, obj.y - obj.displayHeight - 4, `${hitsLeft}`, style)
        .setOrigin(0.5);
      this.tweens.add({
        targets: t,
        alpha: 0,
        duration: 400,
        onComplete: () => t.destroy(),
      });

      if (this.cache.audio.exists('sfx_whack')) {
        this.sound.play('sfx_whack', { volume: 0.7 });
      }
      return;
    }

    // FINAL HIT
    obj.setData('isUp', false);
    obj.setVisible(false);

    // Mystery Box
    if (type === 'mystery_box') {
      if (this.cache.audio.exists('sfx_mystery')) {
        this.sound.play('sfx_mystery', { volume: 0.8 });
      }

      const fx = Phaser.Math.Between(1, 4);
      if (fx === 1) {
        // Time penalty
        this.timeLeft = Math.max(0, this.timeLeft - 10);
        this.cameras.main.shake(150, 0.02);
        const txt = this.add
          .text(obj.x, obj.y, '-10s', { fontSize: '32px', color: '#f00', stroke: '#000', strokeThickness: 4 })
          .setOrigin(0.5);
        this.tweens.add({ targets: txt, y: txt.y - 50, alpha: 0, duration: 800, onComplete: () => txt.destroy() });
      } else if (fx === 2) {
        // Time bonus
        this.timeLeft += 5;
        const txt = this.add
          .text(obj.x, obj.y, '+5s', { fontSize: '32px', color: '#0f0', stroke: '#000', strokeThickness: 4 })
          .setOrigin(0.5);
        this.tweens.add({ targets: txt, y: txt.y - 50, alpha: 0, duration: 800, onComplete: () => txt.destroy() });
      } else if (fx === 3) {
        // Big points
        const bonus = 50;
        this.score += bonus;
        const txt = this.add
          .text(obj.x, obj.y, `+${bonus}!`, { fontSize: '36px', color: '#ffd700', stroke: '#000', strokeThickness: 4 })
          .setOrigin(0.5);
        this.tweens.add({
          targets: txt,
          y: txt.y - 50,
          scale: 1.5,
          alpha: 0,
          duration: 800,
          onComplete: () => txt.destroy()
        });
      } else {
        // Small points
        this.score += 15;
        const txt = this.add
          .text(obj.x, obj.y, '+15', { fontSize: '32px', color: '#ffd700', stroke: '#000', strokeThickness: 4 })
          .setOrigin(0.5);
        this.tweens.add({ targets: txt, y: txt.y - 50, alpha: 0, duration: 800, onComplete: () => txt.destroy() });
      }
      this.ui?.score.setText(`Score: ${this.score}`);
      this.ui?.timer.setText(`${this.timeLeft}`);
      this.updateTimeBarGraphics();
      if (this.timeLeft <= 0) this.endGame();
      return;
    }

    // Bomb
    if (type === 'bomb') {
      this.score = Math.max(0, this.score + info.points);
      this.cameras.main.shake(200, 0.025);
      if (this.cache.audio.exists('sfx_bomb')) {
        this.sound.play('sfx_bomb', { volume: 1 });
      }
      this.timeLeft = Math.max(0, this.timeLeft + (info.timePenalty ?? -15));
      const explosion = this.add
        .sprite(obj.x, obj.y - obj.displayHeight / 2, 'explosion')
        .setScale(1.5)
        .play('explode');
      this.ui?.score.setText(`Score: ${this.score}`);
      this.ui?.timer.setText(`${this.timeLeft}`);
      this.updateTimeBarGraphics();
      if (this.timeLeft <= 0) this.endGame();
      this.comboCount = 0; // Reset combo on bomb
      return;
    }

    // Clock
    if (type === 'clock') {
      this.timeLeft += info.timeBonus ?? 10;
      if (this.cache.audio.exists('sfx_clock')) {
        this.sound.play('sfx_clock', { volume: 0.8 });
      }
      const txt = this.add
        .text(obj.x, obj.y, `+${info.timeBonus}s`, {
          fontSize: '32px',
          color: '#0f0',
          stroke: '#000',
          strokeThickness: 4,
        })
        .setOrigin(0.5);
      this.tweens.add({ targets: txt, y: txt.y - 50, alpha: 0, duration: 800, onComplete: () => txt.destroy() });
      this.ui?.timer.setText(`${this.timeLeft}`);
      this.updateTimeBarGraphics();
      return;
    }

    // Wegen types
    if (type.startsWith('wegen')) {
      const w = this.add
        .sprite(obj.x, obj.y, info.whackedSprite)
        .setScale(obj.scaleX, obj.scaleY)
        .setOrigin(0.5, 0.95);
      this.tweens.add({ targets: w, alpha: 0, duration: 400, onComplete: () => w.destroy() });

      // Apply combo multiplier
      const comboMultiplier = Math.min(1 + (this.comboCount * 0.1), 2); // Max 2x
      const points = Math.round(info.points * comboMultiplier);
      this.score += points;

      // Perfect hit tracking
      if (type === 'wegen_fast') {
        this.perfectHits++;
      }

      // Different sounds for different wegens
      if (type === 'wegen_golden' && this.cache.audio.exists('sfx_whack_golden')) {
        this.sound.play('sfx_whack_golden', { volume: 1 });
      } else if (this.cache.audio.exists('sfx_whack')) {
        this.sound.play('sfx_whack', { volume: 0.7 });
      }

      // Show combo text
      if (this.comboCount > 2) {
        const comboText = this.add
          .text(obj.x, obj.y - 30, `COMBO x${this.comboCount}!`, {
            fontSize: '24px',
            color: '#ff00ff',
            stroke: '#000',
            strokeThickness: 4,
            fontStyle: 'bold'
          })
          .setOrigin(0.5);
        this.tweens.add({
          targets: comboText,
          y: comboText.y - 40,
          scale: 1.5,
          alpha: 0,
          duration: 1000,
          onComplete: () => comboText.destroy()
        });
      }

      this.ui?.score.setText(`Score: ${this.score}`);
      return;
    }
  }

  private togglePause() {
    if (this.isGameOver) return;
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      this.pauseButton?.setText('▶');
      this.pauseOverlay?.setVisible(true);
      this.pauseText?.setVisible(true);
      this.setHammerCursorMode(false);
      if (this.gameTimer) this.gameTimer.paused = true;
      if (this.popUpTimer) this.popUpTimer.paused = true;
      this.tweens.pauseAll();
      this.bgm?.pause();
      this.hammerCursor?.setVisible(false);
    } else {
      this.setHammerCursorMode(true);
      this.pauseButton?.setText('||');
      this.pauseOverlay?.setVisible(false);
      this.pauseText?.setVisible(false);
      if (this.gameTimer) this.gameTimer.paused = false;
      if (this.popUpTimer) this.popUpTimer.paused = false;
      this.tweens.resumeAll();
      this.bgm?.resume();
      this.hammerCursor?.setVisible(true);
    }
  }

  private endGame() {
    if (this.isGameOver) return;
    this.isGameOver = true;
    this.setHammerCursorMode(false);
    this.gameTimer?.destroy();
    this.popUpTimer?.destroy();
    this.wegens.forEach((w) => {
      this.tweens.killTweensOf(w);
      w.setVisible(false);
    });
    this.bgm?.stop();
    this.hammerCursor?.setVisible(false);

    // Apply bonus for perfect play
    if (this.missCount === 0 && this.perfectHits > 10) {
      this.score = Math.round(this.score * 1.5);
      this.time.delayedCall(100, () => {
        const bonusText = this.add
          .text(this.scale.width / 2, this.scale.height / 2 - 100, 'PERFECT BONUS!', {
            fontSize: '48px',
            color: '#ffd700',
            stroke: '#000',
            strokeThickness: 6,
            fontStyle: 'bold'
          })
          .setOrigin(0.5);
        this.tweens.add({
          targets: bonusText,
          scale: 1.5,
          alpha: 0,
          duration: 2000,
          onComplete: () => bonusText.destroy()
        });
      });
    }

    // emit global event once
    setTimeout(() => this.game.events.emit('game-over', { score: this.score }), 100);
  }

  // --- FIX: Clean up resize handler on shutdown ---
  shutdown() {
  // Remove event listeners
  window.removeEventListener('beforeunload', this.handleUnload);
  // Remove other listeners if needed

  // Stop and destroy all music
  if (this.bgm) {
    this.bgm.stop();
    this.bgm.destroy();
    this.bgm = undefined;
  }
  if (this.instrBgm) {
    this.instrBgm.stop();
    this.instrBgm.destroy();
    this.instrBgm = undefined;
  }

  // Optionally stop all sounds
  // this.sound.stopAll();

  // Destroy timers
  this.gameTimer?.destroy();
  this.popUpTimer?.destroy();

  // Clear arrays and UI
  this.wegens = [];
  this.holes = [];
  this.ui = undefined;
  this.pauseOverlay = undefined;
  this.pauseText = undefined;
  this.pauseButton = undefined;
  this.instructionContainer = undefined;
  this.hammerCursor = undefined;
  this.clickIndicator = undefined;
  if (this.hasPointerListeners) {
    this.input.off('pointermove');
    this.input.off('pointerover');
    this.input.off('pointerout');
    this.input.off('pointerdown');
    this.hasPointerListeners = false;
  }
  // Restore cursor
  this.input.setDefaultCursor('auto');
}
}
