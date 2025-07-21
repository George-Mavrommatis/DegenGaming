// src/types/profile.ts

import { Timestamp } from "firebase/firestore"; // Import Timestamp for strict typing if desired

export interface ChatMeta {
  userId: string; // The UID of the other participant in the chat
  lastMessageText?: string; // Text of the last message (optional for quick preview)
  lastMessageTimestamp?: Date; // Timestamp of the last message (converted to Date)
  unreadCount?: number;
  chatId: string; // Add chatId to ChatMeta for direct linking if using this list
}

export interface RecentGame {
  gameId: string;
  gameName?: string;
  playedAt: Date; // Converted to Date object
  score: number;
  coinsEarned: number;
  category?: 'arcade' | 'picker' | 'casino' | 'pvp';
}

export interface ProfileData {
  uid: string; // Firebase UID - REQUIRED for a full profile
  username: string;
  usernameLowercase: string; // Used for uniqueness checks
  wallet: string; // Solana wallet address
  avatarUrl: string;
  bio: string;
  level: number;
  accountXP: number;
  badges: string[];
  wegenNFTs: number; // Specific to your game
  isOnline: boolean; // Managed by backend Socket.IO
  lastSeen: string; // ISO string, managed by backend/frontend for presence
  createdAt: string; // ISO string, when profile was first created
  lastLogin?: string; // ISO string, last time user logged in

  // Social media links (optional)
  twitter: string;
  discord: string;
  telegram: string;
  instagram: string;

  // Game-specific settings
  dmsOpen: boolean; // Whether direct messages are open
  duelsOpen: boolean; // Whether duel invitations are open

  // Friend System (UIDs of related users)
  friends: string[]; // UIDs of accepted friends
  friendRequests: string[]; // UIDs who sent requests to current user
  sentInvitations: string[]; // UIDs to whom current user sent requests

  // Duel and PvP Invitations (consider more specific types for these if they are complex)
  duelInvitations: any[]; // Array of duel invitation objects (needs specific type)
  pvpRoomInvites: any[]; // Array of PvP room invitation objects (needs specific type)

  // Chat metadata for quick access/display (optional, but good for UI)
  chats?: ChatMeta[];

  // Game Statistics
  stats: {
    totalGamesPlayed: number;
    totalWins: number;
    bestScores: Record<string, number>; // Object mapping game names/ids to high scores
    arcadeGamesPlayed: number;
    pickerGamesPlayed: number;
    pvpGamesPlayed: number;
    casinoGamesPlayed: number;
    [key: string]: any; // Catch-all for other dynamic stats
  };

  // In-game Currency
  coins: {
    arcade: number;
    picker: number;
    casino: number;
    pvp: number;
    [key: string]: number; // Catch-all for other coin types
  };

  // Free Entry Tokens
  freeEntryTokens: {
    arcadeTokens: number;
    pickerTokens: number;
    casinoTokens: number;
    pvpTokens: number;
    [key: string]: number; // Catch-all for other token types
  };

  recentGames: RecentGame[]; // Array of recent game entries
}

// DEFAULT_PROFILE: Provides a consistent baseline for new or incomplete profiles
export const DEFAULT_PROFILE: ProfileData = {
  uid: "", 
  username: "Guest",
  usernameLowercase: "guest",
  wallet: "", 
  avatarUrl: "/WegenRaceAssets/G1small.png", // Default avatar
  bio: "",
  level: 1,
  accountXP: 0,
  badges: [],
  wegenNFTs: 0,
  isOnline: false,
  lastSeen: new Date().toISOString(),
  createdAt: new Date().toISOString(), 

  twitter: "",
  discord: "",
  telegram: "",
  instagram: "",

  dmsOpen: true, 
  duelsOpen: true, 

  friends: [],
  friendRequests: [],
  sentInvitations: [],

  duelInvitations: [],
  pvpRoomInvites: [],

  chats: [], // Initialize as empty array

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
    pvp: 0,
  },

  freeEntryTokens: {
    arcadeTokens: 0,
    pickerTokens: 0,
    casinoTokens: 0,
    pvpTokens: 0,
  },

  recentGames: [],
};