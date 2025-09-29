export interface GameStats {
  gameId: string;
  name: string | null;
  playCost: number | null;
  category: "arcade" | "pvp" | "casino" | "picker";
  ggCoinsGathered: { allTime: number; lastMonth: number };
  ggCoinsDistributed: { allTime: number; lastMonth: number };
  gamesPlayed: { allTime: number; lastMonth: number };
  image?: string | null;
  description?: string | null;
}

export interface CategoryStats {
  ggCoinsGathered: { allTime: number; lastMonth: number };
  ggCoinsDistributed: { allTime: number; lastMonth: number };
  gamesPlayed: { allTime: number; lastMonth: number };
  games: string[];         // game IDs in this category
}

export interface PlatformStats {
  registeredUsers: number;
  onlineUsers: number;
  totalGamesPlayed: number;
  categories: { [cat in "picker" | "arcade" | "pvp" | "casino"]: CategoryStats };
  games: { [gameId: string]: GameStats };
  TotalGGCoinsDeposited: { allTime: number; lastMonth: number };
  TotalGGCoinsWithdrawn: { allTime: number; lastMonth: number };
  TotalGGCoinsGathered: { allTime: number; lastMonth: number };
  TotalGGCoinsDistributed: { allTime: number; lastMonth: number };
  lastMonthPeriod: string;
  currentMonthPeriod: string;
  lastUpdated: string;
}