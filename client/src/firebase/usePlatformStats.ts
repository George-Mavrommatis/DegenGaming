import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebaseConfig";
import { PlatformStats } from "../types/platformStats";

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