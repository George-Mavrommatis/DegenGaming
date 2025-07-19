// src/types/platformStats.ts
export interface GameStats {
  gameId: string;
  name: string;
  category: "arcade" | "pvp" | "casino" | "picker"; // Added 'picker' to category type
  solTotal: number;            // gathered
  solDistributed: number;      // NEW: distributed
  solLastMonth: number;
  solDistributedLastMonth?: number; // Added: distributed last month
  playsTotal: number;
  playsLastMonth: number;
  lastPayoutMonth?: string; // e.g. "2024-06"
  lastPayoutAmount?: number;
}

export interface CategoryStats {
  solTotal: number;           // gathered
  solDistributed: number;     // NEW: distributed
  solLastMonth: number;
  solDistributedLastMonth?: number; // Added: distributed last month
  playsTotal: number;
  playsLastMonth: number;
  games: string[];
}

export interface PlatformStats {
  registeredUsers: number;
  onlineUsers: number;
  totalGamesPlayed: number;

  // Aggregate fields (legacy) - these should continue to be accurate as they pull from the aggregated 'categories'
  pickerSolTotal: number;
  pickerSolLastMonth: number;
  arcadeSolTotal: number;      // gathered
  arcadeSolDistributed: number; // NEW: distributed
  casinoSolTotal: number;
  casinoSolDistributed: number;
  pvpSolTotal: number;
  pvpSolDistributed: number;
  arcadeSolLastMonth: number;
  casinoSolLastMonth: number;
  pvpSolLastMonth: number;

  // Scalable fields
  categories: { [cat in "picker" | "arcade" | "pvp" | "casino"]: CategoryStats };
  games: { [gameId: string]: GameStats };

  lastMonthPeriod: string;
  lastUpdated: string;
}