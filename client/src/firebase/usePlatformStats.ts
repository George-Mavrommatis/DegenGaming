/**
 * usePlatformStats
 * Real-time listener to platform/stats doc. This is fine to keep client-side read-only.
 * If you prefer to decouple entirely, you could fetch periodically via backend /platform-stats.
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebaseConfig';

export interface GGStatsMap {
  allTime: number;
  lastMonth: number;
}
export interface CategoryStats {
  ggCoinsGathered: GGStatsMap;
  ggCoinsDistributed: GGStatsMap;
  gamesPlayed: GGStatsMap;
  games: string[];
}
export interface PlatformStats {
  registeredUsers: number;
  onlineUsers: number;
  totalGamesPlayed: number;
  totalGGCoinsDeposited: GGStatsMap;
  totalGGCoinsWithdrawn: GGStatsMap;
  totalGGCoinsGathered: GGStatsMap;
  totalGGCoinsDistributed: GGStatsMap;
  categories: Record<string, CategoryStats>;
  games: Record<string, any>;
  lastUpdated?: any;
}

export function usePlatformStats() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'platform', 'stats'), (snap) => {
      if (snap.exists()) {
        setStats(snap.data() as PlatformStats);
      } else {
        setStats(null);
      }
      setLoading(false);
    }, (err)=>{
      console.error('[usePlatformStats] snapshot error:', err);
      setLoading(false);
    });
    return unsub;
  }, []);

  return { stats, loading };
}