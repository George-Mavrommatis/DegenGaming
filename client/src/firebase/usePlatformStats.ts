import { useEffect, useState } from "react";
import { doc,onSnapshot, getDoc } from "firebase/firestore";
import { db } from "./firebaseConfig";

export interface PlatformStats {
  registeredUsers: number;
  onlineUsers: number;
  totalGamesPlayed: number;
  pickerSolTotal: number;
  pickerSolLastMonth: number;
  arcadeSolTotal: number;
  casinoSolTotal: number;
  pvpSolTotal: number;
  arcadeSolLastMonth: number;
  casinoSolLastMonth: number;
  pvpSolLastMonth: number;
  lastMonthPeriod: string;  // like "2024-05"
  lastUpdated: string;
}

export function usePlatformStats() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "platform", "stats"), (docSnap) => {
      if (docSnap.exists()) {
        setStats(docSnap.data() as PlatformStats);
      } else {
        setStats(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  return { stats, loading };
}  
