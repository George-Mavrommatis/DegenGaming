export interface GameStats {
  gameId: string;
  name: string | null;
  category: "arcade" | "pvp" | "casino" | "picker";
  solGathered: { allTime: number; lastMonth: number };
  solDistributed: { allTime: number; lastMonth: number };
  gamesPlayed: { allTime: number; lastMonth: number };
  image?: string | null;
  description?: string | null;
}

export interface CategoryStats {
  solGathered: { allTime: number; lastMonth: number };
  solDistributed: { allTime: number; lastMonth: number };
  gamesPlayed: { allTime: number; lastMonth: number };
  games: string[];         // game IDs in this category
}

export interface PlatformStats {
  registeredUsers: number;
  onlineUsers: number;
  totalGamesPlayed: number;
  totalSolDistributed: number;
  categories: { [cat in "picker" | "arcade" | "pvp" | "casino"]: CategoryStats };
  games: { [gameId: string]: GameStats };
  lastMonthPeriod: string;
  currentMonthPeriod: string;
  lastUpdated: string;
}