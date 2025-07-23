// src/types/platformStats.ts

export interface GameStats {
  gameId: string;
  name: string;
  category: "arcade" | "pvp" | "casino" | "picker";
  solTotal: number;                   // gathered all time
  solDistributed: number;             // distributed all time (0 for picker)
  solLastMonth: number;               // gathered last month
  solDistributedLastMonth: number;    // distributed last month (0 for picker)
  playsTotal: number;
  playsLastMonth: number;
  lastPayoutMonth?: string;           // e.g. "2024-06"
  lastPayoutAmount?: number;
}

export interface CategoryStats {
  solTotal: number;                  // gathered all time
  solDistributed: number;            // distributed all time (0 for picker)
  solLastMonth: number;              // gathered last month
  solDistributedLastMonth: number;   // distributed last month (0 for picker)
  playsTotal: number;
  playsLastMonth: number;
  games: string[];                   // game IDs in this category
}

export interface PlatformStats {
  registeredUsers: number;
  onlineUsers: number;
  totalGamesPlayed: number;

  // Aggregate fields (legacy, for convenience)
  pickerSolTotal: number;
  pickerSolLastMonth: number;
  arcadeSolTotal: number;
  arcadeSolDistributed: number;
  arcadeSolLastMonth: number;
  arcadeSolDistributedLastMonth: number;
  casinoSolTotal: number;
  casinoSolDistributed: number;
  casinoSolLastMonth: number;
  casinoSolDistributedLastMonth: number;
  pvpSolTotal: number;
  pvpSolDistributed: number;
  pvpSolLastMonth: number;
  pvpSolDistributedLastMonth: number;

  // Scalable fields
  categories: { [cat in "picker" | "arcade" | "pvp" | "casino"]: CategoryStats };
  games: { [gameId: string]: GameStats };

  lastMonthPeriod: string;
  lastUpdated: string;
}