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

export class WackAWegenScene extends Phaser.Scene {
  private score = 0;
  private timeLeft = 60;
  private isGameOver = false;
  private isPaused = false;
  private gameStartTime = 0;
  private comboCount = 0;
  private lastHitTime = 0;
  private missCount = 0;
  private perfectHits = 0;
  private barHeight = 0;
  private barWidth = 0;
  private timeBar?: Phaser.GameObjects.Graphics;
  private wegens: Phaser.GameObjects.Sprite[] = [];
  private holes: Phaser.GameObjects.Image[] = [];
  private characterScale = 0.65;
  private gameTimer?: Phaser.Time.TimerEvent;
  private popUpTimer?: Phaser.Time.TimerEvent;
  private ui?: UIType;
  private pauseOverlay?: Phaser.GameObjects.Graphics;
  private pauseText?: Phaser.GameObjects.Text;
  private pauseButton?: Phaser.GameObjects.Text;
  private username = 'Guest';
  private avatarUrl = '/placeholder-avatar.png';
  private txSig?: string;
  private paid = false;
  private skipInstructionsFlag = false;
  private onReadyToStartGame?: () => void;
  private onGameOver?: (e: { score: number }) => void;
  private hasResizeHandler = false;
  private hammerCursor?: Phaser.GameObjects.Image;
  private clickIndicator?: Phaser.GameObjects.Graphics;
  private hasPointerListeners = false;
  private instructionsOverlayContainer?: Phaser.GameObjects.Container;

  constructor() {
    super({ key: 'WackAWegenScene' });
    console.log('[WACKAWEGEN CONSTRUCTOR]');
  }

  init(data: any) {
    this.username = data.username?.trim() || 'Guest';
    this.avatarUrl = data.avatarUrl?.trim() || '/placeholder-avatar.png';
    this.txSig = data.txSig;
    this.paid = !!data.paid;
    this.skipInstructionsFlag = !!data.skipInstructions;
    this.onReadyToStartGame = data.onReadyToStartGame;
    this.onGameOver = data.onGameOver;
    console.log('[WACKAWEGEN INIT]', { username: this.username, avatarUrl: this.avatarUrl, paid: this.paid, skipInstructionsFlag: this.skipInstructionsFlag });
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
    this.load.image('hammer', '/WackAWegenAssets/hammer.png');
    this.load.image('near_miss', '/WackAWegenAssets/miss.png');
    this.load.spritesheet('explosion', '/WackAWegenAssets/explosionS.png', {
      frameWidth: 128,
      frameHeight: 128,
    });

    if (this.avatarUrl && this.avatarUrl !== '/placeholder-avatar.png') {
      this.load.image('userAvatar', this.avatarUrl);
    }
    this.load.image('defaultAvatar', '/placeholder-avatar.png');

    this.load.audio('bgm', '/WackAWegenAssets/bgm.mp3');
    this.load.audio('sfx_whack', '/WackAWegenAssets/sfx_whack.mp3');
    this.load.audio('sfx_whack_golden', '/WackAWegenAssets/sfx_whack_golden.mp3');
    this.load.audio('sfx_bomb', '/WackAWegenAssets/sfx_bomb.mp3');
    this.load.audio('sfx_clock', '/WackAWegenAssets/sfx_clock.mp3');
    this.load.audio('sfx_mystery', '/WackAWegenAssets/sfx_mystery.mp3');
    this.load.audio('sfx_miss', '/WackAWegenAssets/sfx_miss.mp3');
    this.load.audio('sfx_combo', '/WackAWegenAssets/sfx_combo.mp3');

    this.load.crossOrigin = 'anonymous';
    this.load.on('loaderror', (file: any) => {
      if (file.key === 'userAvatar') {
        this.textures.remove('userAvatar');
      }
    });
    this.load.on('filecomplete', (key: string, type: string, data: any) => {
      if (type === 'audio') {
        console.log(`[WackAWegenScene] Audio loaded successfully: ${key}`);
      }
    });
  }

  create(): void {
    console.log('[WACKAWEGEN CREATE]', { timeLeft: this.timeLeft, isGameOver: this.isGameOver, paid: this.paid, skipInstructionsFlag: this.skipInstructionsFlag });

    this.barHeight = Math.max(60, Math.round(this.scale.height * 0.11));
    this.add.image(this.scale.width / 2, this.scale.height / 2, 'background').setDisplaySize(this.scale.width, this.scale.height);

    if (!this.anims.exists('explode')) {
      this.anims.create({
        key: 'explode',
        frames: this.anims.generateFrameNumbers('explosion', { start: 0, end: 4 }),
        frameRate: 20,
        hideOnComplete: true,
      });
    }

    if (!this.hasResizeHandler) {
      window.addEventListener('beforeunload', this.handleUnload);
      this.scale.on('resize', () => this.handleResize());
      this.hasResizeHandler = true;
    }

    // Defensive: clean/reset all state and timers
    this.cleanupAll();

    this.buildGame();
    this.createHammerCursor();
    this.setupPointerEvents();

    // Show instructions overlay ONCE, then call startGame() only after user closes the overlay
    this.showInstructionsOverlay();
    if (this.onReadyToStartGame) this.onReadyToStartGame();
  }

  private cleanupAll() {
    this.isGameOver = false;
    this.isPaused = false;
    this.score = 0;
    this.timeLeft = 60;
    this.comboCount = 0;
    this.lastHitTime = 0;
    this.missCount = 0;
    this.perfectHits = 0;

    this.gameTimer?.destroy();
    this.popUpTimer?.destroy();
    this.gameTimer = undefined;
    this.popUpTimer = undefined;
    if (this.sound && typeof this.sound.stopAll === 'function') {
      try { this.sound.stopAll(); } catch {}
    }
  }

  private handleResize() {
    this.scene.restart();
  }

  private showInstructionsOverlay() {
    if (this.instructionsOverlayContainer) {
      this.instructionsOverlayContainer.destroy(true);
    }
    const w = Math.min(this.scale.width - 40, 640);
    const h = Math.min(this.scale.height - 40, 440);

    const slides = [
      {
        icon: 'bomb',
        title: 'Power-Ups & Penalties',
        text: '💣 Bombs lose time\n⏰ Clock gains time\n❓ Mystery is random\n⭐ Golden Wegen gives big points!'
      },
      {
        icon: 'wegen_golden',
        title: 'Scoring & Combos',
        text: '👊 Normal: 10pts\n⚡ Fast: 25pts\n🛡️ Tanky: 50pts (3 hits)\n⭐ Golden: 150pts\nHit fast for COMBOS!'
      },
      {
        icon: 'clock',
        title: 'Pro Tips',
        text: 'Chain hits for combos\nAvoid near misses\nTime bonuses get harder\nWatch for patterns!'
      }
    ];

    let idx = 0;
    const container = this.add.container(this.scale.width / 2, this.scale.height / 2).setDepth(110);

    const bg = this.add.rectangle(0, 0, w, h, 0x23272e, 0.98)
      .setStrokeStyle(5, 0xffd700);
    const iconSprite = this.add.sprite(0, -h / 2 + 80, slides[idx].icon)
      .setScale(1.4);
    const titleText = this.add.text(0, -h / 2 + 150, slides[idx].title, {
      fontSize: "32px", fontStyle: "bold", color: "#FFD700", align: "center", fontFamily: "Orbitron, Arial, sans-serif"
    }).setOrigin(0.5);
    const bodyText = this.add.text(0, -h / 2 + 210, slides[idx].text, {
      fontSize: "21px", color: "#fff", align: "center", fontFamily: "Orbitron, Arial, sans-serif", wordWrap: { width: w - 60 }
    }).setOrigin(0.5);

    const prevBtn = this.add.text(-w / 2 + 100, h / 2 - 50, "◀ Prev", {
      fontSize: "22px", color: "#fff", backgroundColor: "#333", padding: { left: 18, right: 18, top: 8, bottom: 8 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const nextBtn = this.add.text(w / 2 - 100, h / 2 - 50, "Next ▶", {
      fontSize: "22px", color: "#fff", backgroundColor: "#333", padding: { left: 18, right: 18, top: 8, bottom: 8 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const closeBtn = this.add.text(0, h / 2 - 50, "Start Game", {
      fontSize: "26px", color: "#fff", backgroundColor: "#28a745", fontWeight: "bold",
      padding: { left: 28, right: 28, top: 10, bottom: 10 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    prevBtn.setAlpha(0.5);
    prevBtn.disableInteractive();

    container.add([bg, iconSprite, titleText, bodyText, prevBtn, nextBtn, closeBtn]);
    this.instructionsOverlayContainer = container;

    nextBtn.on("pointerdown", () => {
      if (idx < slides.length - 1) {
        idx++;
        updateSlide();
      }
    });
    prevBtn.on("pointerdown", () => {
      if (idx > 0) {
        idx--;
        updateSlide();
      }
    });
    closeBtn.on("pointerdown", () => {
      if (this.instructionsOverlayContainer) this.instructionsOverlayContainer.destroy(true);
      this.instructionsOverlayContainer = undefined;
      this.startGame(); // <-- Start the game only when instructions are closed!
    });

    function updateSlide() {
      iconSprite.setTexture(slides[idx].icon);
      titleText.setText(slides[idx].title);
      bodyText.setText(slides[idx].text);

      if (idx === 0) {
        prevBtn.setAlpha(0.5); prevBtn.disableInteractive();
      } else {
        prevBtn.setAlpha(1); prevBtn.setInteractive({ useHandCursor: true });
      }
      if (idx === slides.length - 1) {
        nextBtn.setAlpha(0.5); nextBtn.disableInteractive();
      } else {
        nextBtn.setAlpha(1); nextBtn.setInteractive({ useHandCursor: true });
      }
    }
  }

  private buildGame() {
    this.createHoleGrid();
    this.createTopBar();
    this.createPauseScreen();
  }

  private createHoleGrid() {
    const rows = 4;
    const cols = 4;
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
          .sprite(x, y + 10, 'wegen_normal')
          .setOrigin(0.5, 0.95)
          .setScale(this.characterScale)
          .setVisible(false)
          .setData({ isUp: false, type: 'none', hitsLeft: 0 })
          .setInteractive({ pixelPerfect: true, useHandCursor: false });

        w.on('pointerdown', () => this.whack(w));
        this.wegens.push(w);
      }
    }
  }

  private createTopBar() {
    const W = this.scale.width;
    const BH = this.barHeight;

    this.add.graphics().fillStyle(0x2d3748, 0.85).fillRect(0, 0, W, BH).setDepth(10);

    const scoreText = this.add
      .text(20, BH / 2, `Score: 0`, {
        fontSize: `${Math.round(BH * 0.4)}px`,
        color: '#FFFFFF',
        fontStyle: 'bold',
      }).setOrigin(0, 0.5).setDepth(11);

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

    let avatarTexture = 'defaultAvatar';
    if (this.textures.exists('userAvatar')) avatarTexture = 'userAvatar';
    const avatar = this.add
      .image(userTxt.getRightCenter().x + 10, BH / 2, avatarTexture)
      .setDisplaySize(BH * 0.7, BH * 0.7)
      .setOrigin(0, 0.5)
      .setDepth(11);

    const mask = this.add.graphics().fillCircle(avatar.getCenter().x, avatar.getCenter().y, BH * 0.35);
    avatar.setMask(mask.createGeometryMask());

    const fs = this.add.text(W - 40, BH / 2, '[ ]', {
      fontSize: `${Math.round(BH * 0.5)}px`,
      color: '#FFFFFF',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(11).setInteractive({ useHandCursor: true });

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
    let color = 0x00ff00;
    if (ratio < 0.33) color = 0xff0000;
    else if (ratio < 0.66) color = 0xffff00;
    this.timeBar.clear();
    this.timeBar.fillStyle(color, 1);
    this.timeBar.fillRect(20, this.barHeight - 6, this.barWidth * ratio, 8);
  }

  private createPauseScreen() {
    this.pauseOverlay = this.add.graphics().fillStyle(0x000000, 0.7)
      .fillRect(0, 0, this.scale.width, this.scale.height)
      .setDepth(20)
      .setVisible(false);

    this.pauseText = this.add.text(this.scale.width / 2, this.scale.height / 2, 'PAUSED', {
      fontSize: `${Math.round(this.barHeight * 1.2)}px`,
      color: '#FFFFFF',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(21).setVisible(false);
  }

  private createHammerCursor() {
    this.hammerCursor = this.add.image(0, 0, 'hammer')
      .setVisible(false)
      .setDepth(100)
      .setScale(0.5);
  }

  private setupPointerEvents() {
    if (this.hasPointerListeners) return;
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.hammerCursor) {
        this.hammerCursor.setPosition(pointer.worldX, pointer.worldY);
      }
    });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.hammerCursor) {
        this.hammerCursor.setRotation(-0.5);
        this.time.delayedCall(100, () => {
          if (this.hammerCursor) this.hammerCursor.setRotation(0);
        });
      }
    });
    this.input.on('pointerup', () => {
      if (this.hammerCursor) {
        this.hammerCursor.setRotation(0);
      }
    });
    this.hasPointerListeners = true;
    this.input.setDefaultCursor('none');
    if (this.hammerCursor) this.hammerCursor.setVisible(true);
  }

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
    console.log('[WACKAWEGEN STARTGAME]', { timeLeft: this.timeLeft, isGameOver: this.isGameOver });

    this.ui?.score.setText(`Score: 0`);
    this.ui?.timer.setText(`${this.timeLeft}`);
    this.updateTimeBarGraphics();

    if (this.cache.audio.exists('bgm')) {
      const bgm = this.sound.add('bgm', { loop: true, volume: 0.3 });
      bgm.play();
      this.events.once('destroy', () => bgm.stop());
    }

    this.gameTimer?.destroy();
    this.popUpTimer?.destroy();

    this.gameTimer = this.time.addEvent({
      delay: 1000,
      callback: this.updateSecond,
      callbackScope: this,
      loop: true,
    });

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
    console.log('[WACKAWEGEN TIMER]', { timeLeft: this.timeLeft, isGameOver: this.isGameOver });
    this.ui?.timer.setText(`${this.timeLeft}`);
    this.updateTimeBarGraphics();
    if (this.timeLeft < 20 && this.popUpTimer) {
      this.popUpTimer.destroy();
      this.popUpTimer = this.time.addEvent({
        delay: 500,
        callback: this.popUp,
        callbackScope: this,
        loop: true,
      });
    }
    if (this.timeLeft <= 0) {
      console.log('[WACKAWEGEN TIMER TRIGGER ENDGAME]');
      this.endGame();
    }
  }

  // ... (keep all your gameplay logic below unchanged, like popUp, whack, etc.)

  private handleUnload = () => {
    if (!this.isGameOver) {
      this.endGame();
    }
  };

  private endGame() {
    if (this.isGameOver) return;
    this.isGameOver = true;
    console.log('[WACKAWEGEN ENDGAME]', { score: this.score, timeLeft: this.timeLeft });
    this.gameTimer?.destroy();
    this.popUpTimer?.destroy();
    if (this.sound && typeof this.sound.stopAll === 'function') {
      try {
        this.sound.stopAll();
      } catch (e) {
        console.warn('Failed to stop all sounds:', e);
      }
    }
    if (this.hammerCursor) this.hammerCursor.setVisible(false);
    if (this.wegens && Array.isArray(this.wegens)) {
      for (const w of this.wegens) {
        this.tweens.killTweensOf(w);
        w.setVisible(false);
      }
    }
    if (this.onGameOver) this.onGameOver({ score: this.score });
  }

  shutdown() {
    window.removeEventListener('beforeunload', this.handleUnload);
    if (this.sound && typeof this.sound.stopAll === 'function') {
      try { this.sound.stopAll(); } catch {}
    }
    this.gameTimer?.destroy();
    this.popUpTimer?.destroy();
    this.wegens = [];
    this.holes = [];
    this.ui = undefined;
    this.pauseOverlay = undefined;
    this.pauseText = undefined;
    this.pauseButton = undefined;
    this.hammerCursor = undefined;
    this.clickIndicator = undefined;
    if (this.hasPointerListeners) {
      this.input.off('pointermove');
      this.input.off('pointerover');
      this.input.off('pointerout');
      this.input.off('pointerdown');
      this.hasPointerListeners = false;
    }
    this.input.setDefaultCursor('auto');
  }
}