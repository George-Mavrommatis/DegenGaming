// types/profile.ts
export interface ChatMeta {
  userId: string;
  lastMessage?: string;
  lastTimestamp?: string;
  unreadCount?: number;
}

export interface ProfileData {
  username: string;
  wallet: string;
  avatarUrl: string;
  bio: string;
  level: number;
  accountXP: number;
  badges: string[];
  wegenNFTs: number;
  stats: {
    totalGamesPlayed: number;
    totalWins: 0;
    bestScores: Record<string, number>;
    arcadeGamesPlayed?: number;
    pickerGamesPlayed?: number;
    pvpGamesPlayed?: number;
    casinoGamesPlayed?: number;
  };
  coins: {
    arcade: number;
    picker: number;
    casino: number;
    pvp: number;
  };
  // ADDED THIS SECTION (already present in your example, just confirming placement)
  freeEntryTokens: {
    arcadeTokens: number;
    pickerTokens: number;
    casinoTokens: number;
    pvpTokens: number;
  };
  recentGames: Array<{
    gameId: string;
    gameName?: string;
    playedAt: any;
    score: number;
    coinsEarned: number;
    category?: 'arcade' | 'picker' | 'casino' | 'pvp';
  }>;
  twitter?: string;
  discord?: string;
  telegram?: string;
  instagram?: string;
  friends?: string[];
  friendRequests?: string[];
  sentInvitations?: string[];
  duelInvitations?: any[];
  pvpRoomInvites?: any[];
  chats?: ChatMeta[];           // <--- for client chat previews
  isOnline?: boolean;
  dmsOpen?: boolean;
  duelsOpen?: boolean;
}

export const DEFAULT_PROFILE: ProfileData = {
  username: "",
  wallet: "",
  avatarUrl: "",
  bio: "",
  level: 1,
  accountXP: 0,
  badges: [],
  wegenNFTs: 0,
  stats: {
    totalGamesPlayed: 0,
    totalWins: 0,
    bestScores: {},
    arcadeGamesPlayed: 0,
    pickerGamesPlayed: 0,
    pvpGamesPlayed: 0,
    casinoGamesPlayed: 0,
  },
  coins: {
    arcade: 0,
    picker: 0,
    casino: 0,
    pvp: 0
  },
  // ADDED THIS SECTION (already present in your example, just confirming placement)
  freeEntryTokens: {
    arcadeTokens: 0,
    pickerTokens: 0,
    casinoTokens: 0,
    pvpTokens: 0
  },
  recentGames: [],
  twitter: "",
  discord: "",
  telegram: "",
  instagram: "",
  friends: [],
  friendRequests: [],
  sentInvitations: [],
  chats: [],
  dmsOpen: true,
  duelsOpen: true,
};