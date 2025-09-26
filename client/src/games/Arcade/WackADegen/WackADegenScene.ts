import Phaser from 'phaser';

type CharacterType =
  | 'degen_normal'
  | 'degen_fast'
  | 'degen_tanky'
  | 'degen_golden'
  | 'degen_trouble'
  | 'bomb'
  | 'clock'
  | 'mystery_box';

const CHARACTER_DATA = {
  'degen_normal':   { points: 10,  sprite: 'degen_normal',       whackedSprite: 'degen_normal_whacked', hits: 1 } as const,
  'degen_fast':     { points: 25,  sprite: 'degen_fast',         whackedSprite: 'degen_fast_whacked',   hits: 1 } as const,
  'degen_tanky':    { points: 50,  sprite: 'degen_tanky',        whackedSprite: 'degen_tanky_whacked',  hits: 3 } as const,
  'degen_golden':   { points: 150, sprite: 'degen_golden',       whackedSprite: 'degen_golden_whacked', hits: 1 } as const,
  'degen_trouble':  { points: -30, sprite: 'degen_trouble',      whackedSprite: 'degen_trouble_whacked', hits: 1, timePenalty: -10 } as const,
  'bomb':           { points: -20, sprite: 'bomb',              whackedSprite: '', timePenalty: -15, hits: 1 } as const,
  'clock':          { points: 0,   sprite: 'clock',             whackedSprite: '', timeBonus: 10, hits: 1 } as const,
  'mystery_box':    { points: 0,   sprite: 'mystery_box',       whackedSprite: '', hits: 2 } as const,
};

interface UIType {
  score: Phaser.GameObjects.Text;
  timer: Phaser.GameObjects.Text;
  title: Phaser.GameObjects.Text;
  avatar: Phaser.GameObjects.Image;
}

export class WackADegenScene extends Phaser.Scene {
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
  private degens: Phaser.GameObjects.Sprite[] = [];
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
  private onGameOver?: (e: { score: number }) => void;
  private hasResizeHandler = false;
  private hammerCursor?: Phaser.GameObjects.Image;
  private clickIndicator?: Phaser.GameObjects.Graphics;
  private hasPointerListeners = false;

  constructor() {
    super({ key: 'WackADegenScene' });
  }

  init(data: any) {
    this.username = data.username?.trim() || 'Guest';
    this.avatarUrl = data.avatarUrl?.trim() || '/placeholder-avatar.png';
    this.txSig = data.txSig;
    this.paid = !!data.paid;
    this.onGameOver = data.onGameOver;
  }

  preload(): void {
    this.load.image('background', '/WackADegenAssets/BG.png');
    this.load.image('hole', '/WackADegenAssets/hole.png');
    this.load.image('degen_normal', '/WackADegenAssets/wegen1.png');
    this.load.image('degen_normal_whacked', '/WackADegenAssets/whacked1.png');
    this.load.image('degen_fast', '/WackADegenAssets/wegen2.png');
    this.load.image('degen_fast_whacked', '/WackADegenAssets/whacked2.png');
    this.load.image('degen_tanky', '/WackADegenAssets/wegen3.png');
    this.load.image('degen_tanky_whacked', '/WackADegenAssets/whacked3.png');
    this.load.image('degen_golden', '/WackADegenAssets/wegen4.png');
    this.load.image('degen_golden_whacked', '/WackADegenAssets/whacked4.png');
    this.load.image('degen_trouble', '/WackADegenAssets/whacked_trouble.png');
    this.load.image('bomb', '/WackADegenAssets/bomb.png');
    this.load.image('clock', '/WackADegenAssets/clock.png');
    this.load.image('mystery_box', '/WackADegenAssets/mysteryS.png');
    this.load.image('hammer', '/WackADegenAssets/hammer.png');
    this.load.image('near_miss', '/WackADegenAssets/miss.png');
    this.load.spritesheet('explosion', '/WackADegenAssets/explosionS.png', {
      frameWidth: 128,
      frameHeight: 128,
    });

    if (this.avatarUrl && this.avatarUrl !== '/placeholder-avatar.png') {
      this.load.image('userAvatar', this.avatarUrl);
    }
    this.load.image('defaultAvatar', '/placeholder-avatar.png');

    const audioFiles = [
      { key: 'bgm', paths: ['../sounds/WackADegen/grid.mp3', '/sounds/WackADegen/grid.mp3'] },
      { key: 'sfx_whack', paths: ['../sounds/WackADegen/whack.wav', '/sounds/WackADegen/whack.wav'] },
      { key: 'sfx_whack_golden', paths: ['../sounds/WackADegen/whack.wav', '/sounds/WackADegen/whack.wav'] },
      { key: 'sfx_bomb', paths: ['../sounds/WackADegen/explosion.wav', '/sounds/WackADegen/explosion.wav'] },
      { key: 'sfx_clock', paths: ['../sounds/WackADegen/sweepTransition.wav', '/sounds/WackADegen/sweepTransition.wav'] },
      { key: 'sfx_mystery', paths: ['../sounds/WackADegen/notification.wav', '/sounds/WackADegen/notification.wav'] },
      { key: 'sfx_miss', paths: ['../sounds/WackADegen/miss.wav', '/sounds/WackADegen/miss.wav'] },
      { key: 'sfx_combo', paths: ['../sounds/WackADegen/combo.wav', '/sounds/WackADegen/combo.wav'] },
    ];
    audioFiles.forEach(({ key, paths }) => {
      this.load.audio(key, paths);
    });

    this.load.crossOrigin = 'anonymous';
    this.load.on('loaderror', (file: any) => {
      console.error('[WackADegenScene] Asset failed to load:', file.key, file.src);
      if (file.key === 'userAvatar') {
        this.textures.remove('userAvatar');
        if (!this.textures.exists('defaultAvatar')) {
          this.load.image('defaultAvatar', '/placeholder-avatar.png');
          this.load.start();
        }
      }
    });

    this.load.on('filecomplete', (key: string, type: string, data: any) => {
      if (type === 'audio') {
        console.log(`[WackADegenScene] Audio loaded successfully: ${key}`);
      }
    });
  }

  create(): void {
    this.barHeight = Math.max(48, Math.round(this.scale.height * 0.11));
    this.add.image(this.scale.width / 2, this.scale.height / 2, 'background')
      .setDisplaySize(this.scale.width, this.scale.height);

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
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.handleUnload();
        }
      });
      this.hasResizeHandler = true;
    }
    this.scale.on('resize', () => this.handleResize());

    this.handleResize();
    this.buildGame();
    this.startGame();
  }

  private handleResize() {
    const W = this.scale.width;
    const H = this.scale.height;
    this.characterScale = Math.max(0.5, Math.min(W / 1600, H / 900));
    this.barHeight = Math.max(48, Math.round(H * 0.11));

    if (this.ui) {
      this.ui.title.setPosition(W / 2, this.barHeight * 0.6);
      this.ui.title.setFontSize(Math.min(this.barHeight * 0.6, 46));
      this.ui.score.setPosition(36, this.barHeight * 0.6);
      this.ui.timer.setPosition(W / 2, this.barHeight * 0.88);
      this.ui.avatar.setPosition(W - 56, this.barHeight * 0.6);
      this.ui.avatar.setDisplaySize(this.barHeight * 0.7, this.barHeight * 0.7);
    }
    if (this.timeBar) {
      this.barWidth = W - 72;
      this.timeBar.setPosition(36, this.barHeight - 10);
      this.updateTimeBarGraphics();
    }
    if (this.pauseButton) {
      this.pauseButton.setPosition(W - 56, 16);
    }
    if (this.pauseOverlay) {
      this.pauseOverlay.clear().fillStyle(0x000000, 0.7).fillRect(0, 0, W, H);
    }
    if (this.pauseText) {
      this.pauseText.setPosition(W / 2, H / 2);
    }
  }

  private buildGame() {
    this.createTopBar();
    this.createHoleGrid();
    this.createPauseScreen();
  }

  private createTopBar() {
    const W = this.scale.width;
    const BH = this.barHeight;

    this.add.graphics().fillStyle(0x191a2d, 0.95).fillRect(0, 0, W, BH).setDepth(10);

    // Smaller, non-overlapping title
    const titleText = this.add.text(W / 2, BH * 0.6, "WHACK A DEGEN", {
      fontSize: `${Math.min(BH * 0.6, 46)}px`,
      fontFamily: "Orbitron, Arial, sans-serif",
      color: '#FFD700',
      fontStyle: 'bold',
      align: 'center',
      shadow: { offsetX: 2, offsetY: 2, color: '#FFD93B', blur: 10, fill: true }
    }).setOrigin(0.5).setDepth(12);

    // Score (left, spaced from edge)
    const scoreText = this.add.text(36, BH * 0.6, `Score: 0`, {
      fontSize: `${Math.round(BH * 0.32)}px`,
      fontFamily: "Orbitron, Arial, sans-serif",
      color: '#FFFFFF',
      fontStyle: 'bold',
      shadow: { offsetX: 2, offsetY: 2, color: '#FFD93B', blur: 8, fill: true }
    }).setOrigin(0, 0.5).setDepth(11);

    // Timer (center, under title)
    const timerText = this.add.text(W / 2, BH * 0.88, `${this.timeLeft}`, {
      fontSize: `${Math.round(BH * 0.38)}px`,
      fontFamily: "Orbitron, Arial, sans-serif",
      color: '#FFD93B',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4,
      shadow: { offsetX: 0, offsetY: 0, color: '#FFD93B', blur: 8, fill: true }
    }).setOrigin(0.5).setDepth(11);

    // Avatar (right, spaced from edge)
    let avatarTexture = 'defaultAvatar';
    if (this.textures.exists('userAvatar')) avatarTexture = 'userAvatar';
    const avatar = this.add.image(W - 56, BH * 0.6, avatarTexture)
      .setDisplaySize(BH * 0.7, BH * 0.7)
      .setOrigin(1, 0.5)
      .setDepth(11);
    const mask = this.add.graphics().fillCircle(avatar.x - BH * 0.35, avatar.y, BH * 0.35);
    avatar.setMask(mask.createGeometryMask());

    // Fullscreen button (top right, above avatar)
    this.pauseButton = this.add.text(W - 56, 16, '🖵', {
      fontSize: `${Math.round(BH * 0.36)}px`,
      fontFamily: "Orbitron, Arial, sans-serif",
      color: '#FFD93B',
      fontStyle: 'bold',
    }).setOrigin(1, 0).setDepth(11).setInteractive({ useHandCursor: true });
    this.pauseButton.on('pointerdown', () => {
      if (this.scale.isFullscreen) this.scale.stopFullscreen();
      else this.scale.startFullscreen();
    });

    this.barWidth = W - 72;
    this.timeBar = this.add.graphics().setPosition(36, BH - 10).setDepth(11);
    this.updateTimeBarGraphics();

    this.ui = { score: scoreText, timer: timerText, title: titleText, avatar };
  }

  private createHoleGrid() {
    // 5 rows for complexity
    const rows = 5;
    const cols = 4;
    const topPadding = this.barHeight + 80;
    const bottomPadding = 80;
    const sidePadding = 80;
    const gridW = Math.min(this.scale.width - (sidePadding * 2), 850);
    const gridH = Math.min(this.scale.height - topPadding - bottomPadding, 650);

    const startX = (this.scale.width - gridW) / 2;
    const startY = topPadding;

    const cellW = gridW / cols;
    const cellH = gridH / rows;

    this.holes = [];
    this.degens = [];

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const x = startX + cellW * (j + 0.5);
        const y = startY + cellH * (i + 0.5);

        // Add a little drop shadow effect for holes
        this.add.graphics().fillStyle(0x000000, 0.08).fillEllipse(x, y + 10, 48, 16);

        const hole = this.add.image(x, y, 'hole').setScale(0.42 * this.characterScale);
        this.holes.push(hole);

        const d = this.add
          .sprite(x, y + 10, 'degen_normal')
          .setOrigin(0.5, 0.95)
          .setScale(this.characterScale)
          .setVisible(false)
          .setData({ isUp: false, type: 'none', hitsLeft: 0 })
          .setInteractive({ pixelPerfect: true, useHandCursor: false });

        d.on('pointerdown', () => this.whack(d));
        this.degens.push(d);
      }
    }
  }

  private createPauseScreen() {
    const W = this.scale.width, H = this.scale.height;
    this.pauseOverlay = this.add.graphics().fillStyle(0x000000, 0.7)
      .fillRect(0, 0, W, H)
      .setDepth(20)
      .setVisible(false);

    this.pauseText = this.add.text(W / 2, H / 2, 'PAUSED', {
      fontSize: `${Math.round(this.barHeight * 1.2)}px`,
      fontFamily: "Orbitron, Arial, sans-serif",
      color: '#FFD93B',
      fontStyle: 'bold',
      shadow: { offsetX: 2, offsetY: 2, color: '#FFD93B', blur: 12, fill: true }
    }).setOrigin(0.5).setDepth(21).setVisible(false);
  }

  private updateTimeBarGraphics() {
    if (!this.timeBar) return;
    const ratio = Phaser.Math.Clamp(this.timeLeft / 60, 0, 1);
    let color = 0x00ff00;
    if (ratio < 0.33) color = 0xff0000;
    else if (ratio < 0.66) color = 0xffff00;
    this.timeBar.clear();
    this.timeBar.fillStyle(color, 1);
    this.timeBar.fillRect(0, 0, this.barWidth * ratio, 8);
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

    // Difficulty curve: spawn rate increases as time passes
    this.gameTimer = this.time.addEvent({
      delay: 1000,
      callback: this.updateSecond,
      callbackScope: this,
      loop: true,
    });

    this.popUpTimer = this.time.addEvent({
      delay: 850,
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

    // Increase spawn rate as timer drops
    if (this.popUpTimer) {
      this.popUpTimer.destroy();
      let delay = 850;
      if (this.timeLeft < 45) delay = 650;
      if (this.timeLeft < 30) delay = 500;
      if (this.timeLeft < 16) delay = 350;
      if (this.timeLeft < 7) delay = 220;
      this.popUpTimer = this.time.addEvent({
        delay,
        callback: this.popUp,
        callbackScope: this,
        loop: true,
      });
    }

    if (this.timeLeft <= 0) this.endGame();
  }

  private getDifficultyStage() {
    const elapsed = (this.time.now - this.gameStartTime) / 1000;
    const t = this.timeLeft;
    if (t <= 8 || elapsed > 55) return 4;
    if (t <= 20 || elapsed > 40) return 3;
    if (t <= 36 || elapsed > 22) return 2;
    return 1;
  }

  private getRandomCharacterType(): CharacterType {
    const stage = this.getDifficultyStage();
    let table: { type: CharacterType; weight: number }[] = [];
    if (stage === 4) {
      table = [
        { type: 'degen_normal', weight: 10 },
        { type: 'degen_fast',   weight: 25 },
        { type: 'degen_tanky',  weight: 10 },
        { type: 'degen_golden', weight: 6  },
        { type: 'degen_trouble',weight: 35 },
        { type: 'bomb',         weight: 28 },
        { type: 'clock',        weight: 2  },
        { type: 'mystery_box',  weight: 22 },
      ];
    } else if (stage === 3) {
      table = [
        { type: 'degen_normal', weight: 18 },
        { type: 'degen_fast',   weight: 18 },
        { type: 'degen_tanky',  weight: 10 },
        { type: 'degen_golden', weight: 4  },
        { type: 'degen_trouble',weight: 22 },
        { type: 'bomb',         weight: 20 },
        { type: 'clock',        weight: 4  },
        { type: 'mystery_box',  weight: 18 },
      ];
    } else if (stage === 2) {
      table = [
        { type: 'degen_normal', weight: 28 },
        { type: 'degen_fast',   weight: 15 },
        { type: 'degen_tanky',  weight: 7 },
        { type: 'degen_trouble',weight: 10 },
        { type: 'bomb',         weight: 12 },
        { type: 'clock',        weight: 3 },
        { type: 'mystery_box',  weight: 10 },
      ];
    } else {
      table = [
        { type: 'degen_normal', weight: 38 },
        { type: 'degen_fast',   weight: 12 },
        { type: 'degen_trouble',weight: 5 },
        { type: 'bomb',         weight: 7 },
        { type: 'clock',        weight: 5 },
        { type: 'mystery_box',  weight: 10 },
      ];
    }
    const total = table.reduce((sum, x) => sum + x.weight, 0);
    let pick = Math.random() * total;
    for (const item of table) {
      if (pick < item.weight) return item.type;
      pick -= item.weight;
    }
    return 'degen_normal';
  }

  private popUp() {
    if (this.isGameOver || this.isPaused) return;
    const avail = this.degens.filter((d) => !d.getData('isUp'));
    if (!avail.length) return;
    const stage = this.getDifficultyStage();
    let spawnCount = 1;
    if (stage >= 4) spawnCount = Phaser.Math.Between(2, 3);
    else if (stage === 3) spawnCount = Phaser.Math.Between(1, 2);
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
    const yOff = 30;
    const stage = this.getDifficultyStage();
    let hold = 650;
    let upSpeed = 200;
    let scaleOverride = undefined;

    if (type === 'bomb') {
      scaleOverride = 0.35 - Math.min(stage * 0.07, 0.18);
    }
    if (type === 'degen_trouble') {
      obj.setTint(0xff2222);
      hold = 350 - (stage * 20);
      upSpeed = 120;
    }
    obj.setTexture(info.sprite);
    obj.setScale(scaleOverride ?? this.characterScale);
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
        obj.clearTint();
      },
    });
  }

  private whack(obj: Phaser.GameObjects.Sprite) {
    if (!obj.getData('isUp') || this.isGameOver || this.isPaused) return;
    const type = obj.getData('type') as CharacterType;
    const info = CHARACTER_DATA[type];
    let hitsLeft = obj.getData('hitsLeft') ?? info.hits;
    hitsLeft--;
    obj.setData('hitsLeft', hitsLeft);

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

    if (hitsLeft > 0) {
      if (type === 'mystery_box') {
        obj.setTint(0xffff00);
        this.time.delayedCall(100, () => obj.clearTint());
      } else if (type === 'degen_tanky') {
        obj.setTint(0xff6666);
        this.time.delayedCall(100, () => obj.clearTint());
      }
      const t = this.add.text(obj.x, obj.y - obj.displayHeight - 4, `${hitsLeft}`, {
        fontSize: '32px', color: type === 'mystery_box' ? '#ff0' : '#fff', stroke: '#000', strokeThickness: 4,
      }).setOrigin(0.5);
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

    obj.setData('isUp', false);
    obj.setVisible(false);

    if (type === 'mystery_box') {
      if (this.cache.audio.exists('sfx_mystery')) {
        this.sound.play('sfx_mystery', { volume: 0.8 });
      }
      const stage = this.getDifficultyStage();
      let fx: number;
      if (stage >= 4) fx = Phaser.Math.Between(1, 2);
      else if (stage >= 3) fx = Phaser.Math.Between(1, 3);
      else fx = Phaser.Math.Between(1, 4);

      if (fx === 1) {
        this.timeLeft = Math.max(0, this.timeLeft - 10);
        this.cameras.main.shake(150, 0.02);
        const txt = this.add.text(obj.x, obj.y, '-10s', { fontSize: '32px', color: '#f00', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5);
        this.tweens.add({ targets: txt, y: txt.y - 50, alpha: 0, duration: 800, onComplete: () => txt.destroy() });
      } else if (fx === 2) {
        this.timeLeft += 5;
        const txt = this.add.text(obj.x, obj.y, '+5s', { fontSize: '32px', color: '#0f0', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5);
        this.tweens.add({ targets: txt, y: txt.y - 50, alpha: 0, duration: 800, onComplete: () => txt.destroy() });
      } else if (fx === 3) {
        const bonus = 50;
        this.score += bonus;
        const txt = this.add.text(obj.x, obj.y, `+${bonus}!`, { fontSize: '36px', color: '#ffd700', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5);
        this.tweens.add({
          targets: txt,
          y: txt.y - 50,
          scale: 1.5,
          alpha: 0,
          duration: 800,
          onComplete: () => txt.destroy()
        });
      } else {
        this.score += 15;
        const txt = this.add.text(obj.x, obj.y, '+15', { fontSize: '32px', color: '#ffd700', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5);
        this.tweens.add({ targets: txt, y: txt.y - 50, alpha: 0, duration: 800, onComplete: () => txt.destroy() });
      }
      this.ui?.score.setText(`Score: ${this.score}`);
      this.ui?.timer.setText(`${this.timeLeft}`);
      this.updateTimeBarGraphics();
      if (this.timeLeft <= 0) this.endGame();
      return;
    }

    if (type === 'degen_trouble') {
      this.score = Math.max(0, this.score + info.points);
      this.timeLeft = Math.max(0, this.timeLeft + (info.timePenalty ?? -10));
      obj.setTint(0xff2222);
      this.cameras.main.shake(100, 0.03);
      const txt = this.add.text(obj.x, obj.y, `${info.points} • ${info.timePenalty}s`, {
        fontSize: '28px', color: '#f00', stroke: '#000', strokeThickness: 4
      }).setOrigin(0.5);
      this.tweens.add({ targets: txt, y: txt.y - 30, alpha: 0, duration: 700, onComplete: () => txt.destroy() });
      this.ui?.score.setText(`Score: ${this.score}`);
      this.ui?.timer.setText(`${this.timeLeft}`);
      this.updateTimeBarGraphics();
      if (this.timeLeft <= 0) this.endGame();
      return;
    }

    if (type === 'bomb') {
      this.score = Math.max(0, this.score + info.points);
      this.cameras.main.shake(200, 0.025);
      if (this.cache.audio.exists('sfx_bomb')) {
        this.sound.play('sfx_bomb', { volume: 1 });
      }
      this.timeLeft = Math.max(0, this.timeLeft + (info.timePenalty ?? -15));
      const explosion = this.add.sprite(obj.x, obj.y - obj.displayHeight / 2, 'explosion').setScale(1.5).play('explode');
      this.ui?.score.setText(`Score: ${this.score}`);
      this.ui?.timer.setText(`${this.timeLeft}`);
      this.updateTimeBarGraphics();
      if (this.timeLeft <= 0) this.endGame();
      this.comboCount = 0;
      return;
    }

    if (type === 'clock') {
      this.timeLeft += info.timeBonus ?? 10;
      if (this.cache.audio.exists('sfx_clock')) {
        this.sound.play('sfx_clock', { volume: 0.8 });
      }
      const txt = this.add.text(obj.x, obj.y, `+${info.timeBonus}s`, {
        fontSize: '32px', color: '#0f0', stroke: '#000', strokeThickness: 4,
      }).setOrigin(0.5);
      this.tweens.add({ targets: txt, y: txt.y - 50, alpha: 0, duration: 800, onComplete: () => txt.destroy() });
      this.ui?.timer.setText(`${this.timeLeft}`);
      this.updateTimeBarGraphics();
      return;
    }

    if (type.startsWith('degen')) {
      const w = this.add.sprite(obj.x, obj.y, info.whackedSprite).setScale(obj.scaleX, obj.scaleY).setOrigin(0.5, 0.95);
      this.tweens.add({ targets: w, alpha: 0, duration: 400, onComplete: () => w.destroy() });

      const comboMultiplier = Math.min(1 + (this.comboCount * 0.1), 2);
      const points = Math.round(info.points * comboMultiplier);
      this.score += points;

      if (type === 'degen_fast') {
        this.perfectHits++;
      }

      if (type === 'degen_golden' && this.cache.audio.exists('sfx_whack_golden')) {
        this.sound.play('sfx_whack_golden', { volume: 1 });
      } else if (this.cache.audio.exists('sfx_whack')) {
        this.sound.play('sfx_whack', { volume: 0.7 });
      }

      if (this.comboCount > 2) {
        const comboText = this.add.text(obj.x, obj.y - 30, `COMBO x${this.comboCount}!`, {
          fontSize: '24px', color: '#ff00ff', stroke: '#000', strokeThickness: 4, fontStyle: 'bold'
        }).setOrigin(0.5);
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
      if (this.gameTimer) this.gameTimer.paused = true;
      if (this.popUpTimer) this.popUpTimer.paused = true;
      this.tweens.pauseAll();
      if (this.sound && typeof this.sound.pauseAll === "function") {
        try { this.sound.pauseAll(); } catch {}
      }
      this.hammerCursor?.setVisible(false);
    } else {
      this.pauseButton?.setText('⏸');
      this.pauseOverlay?.setVisible(false);
      this.pauseText?.setVisible(false);
      if (this.gameTimer) this.gameTimer.paused = false;
      if (this.popUpTimer) this.popUpTimer.paused = false;
      this.tweens.resumeAll();
      if (this.sound && typeof this.sound.resumeAll === "function") {
        try { this.sound.resumeAll(); } catch {}
      }
      this.hammerCursor?.setVisible(true);
    }
  }

  private endGame() {
    if (this.isGameOver) return;
    this.isGameOver = true;
    this.gameTimer?.destroy();
    this.popUpTimer?.destroy();
    if (this.sound && typeof this.sound.stopAll === "function") {
      try {
        this.sound.stopAll();
      } catch (e) {
        console.warn("Failed to stop all sounds:", e);
      }
    }
    this.hammerCursor?.setVisible(false);

    if (this.degens && Array.isArray(this.degens)) {
      for (const d of this.degens) {
        this.tweens.killTweensOf(d);
        d.setVisible(false);
      }
    }

    if (this.missCount === 0 && this.perfectHits > 10) {
      this.score = Math.round(this.score * 1.5);
      this.time.delayedCall(100, () => {
        const bonusText = this.add.text(this.scale.width / 2, this.scale.height / 2 - 100, 'PERFECT BONUS!', {
          fontSize: '48px',
          fontFamily: "Orbitron, Arial, sans-serif",
          color: '#ffd700',
          stroke: '#000',
          strokeThickness: 6,
          fontStyle: 'bold',
          shadow: { offsetX: 2, offsetY: 2, color: '#FFD93B', blur: 16, fill: true }
        }).setOrigin(0.5);
        this.tweens.add({
          targets: bonusText,
          scale: 1.5,
          alpha: 0,
          duration: 2000,
          onComplete: () => bonusText.destroy()
        });
      });
    }
    setTimeout(() => { if (this.onGameOver) this.onGameOver({ score: this.score }); }, 100);
  }

  shutdown() {
    window.removeEventListener('beforeunload', this.handleUnload);
    if (this.sound && typeof this.sound.stopAll === "function") {
      try { this.sound.stopAll(); } catch {}
    }
    this.gameTimer?.destroy();
    this.popUpTimer?.destroy();
    this.degens = [];
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