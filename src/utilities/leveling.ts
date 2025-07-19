  // src/utils/leveling.ts

  /** Returns: { level, currentXP, needed, ... } from raw accountXP */
  export function getLevelProgress(accountXP: number) {
    let xpTable = [0];  // index 0 is XP for level 1, index 1 is cumulative XP for level 2, etc
    let last = 0, req = 100;
    // We build enough levels for anybody:
    for (let i = 1; i < 100; i++) {
      last += req;
      xpTable.push(last);
      req = Math.ceil(req * 1.4);
    }

    // Find the current level
    let level = 1;
    for (let i = 1; i < xpTable.length; i++) {
      if (accountXP < xpTable[i]) break;
      level = i + 1;
    }

    const currentLevelIdx = level - 2; // (level 2, index 0)
    const prevLevelXP = xpTable[level - 2] || 0;
    const nextLevelXP = xpTable[level - 1];

    const currentXP = accountXP - prevLevelXP;
    const xpNeeded = nextLevelXP - prevLevelXP;
    const xpToNext = xpNeeded - currentXP;
    const percent = (currentXP / xpNeeded) * 100;

    return {
      level,
      currentXP,
      xpNeeded,
      xpToNext,
      percent: Math.max(0, Math.min(100, percent)),
      raw: { accountXP }
    };
  }
