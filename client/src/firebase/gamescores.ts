// src/firebase/gameScores.ts

import {
  doc,
  runTransaction,
  serverTimestamp,
  increment,
  collection,
  query,
  getDocs,
  orderBy,
  limit,
  getDoc,
} from "firebase/firestore";
import { db } from "./firebaseConfig";
import { ProfileData } from "../types/profile";


// ACOUNT EXP LEADERBOARD

export interface AccountRankEntry {
  rank: number;
  accountXP: number;
  level: number;
  player: {
    username?: string;
    wallet: string;
    avatarUrl?: string;
  };
}

export async function fetchAccountRankingLeaderboard(limitCount = 100): Promise<AccountRankEntry[]> {
  // Note: if you're using large leaderboards, you may want to paginate.
  const q = query(collection(db, "users"), orderBy("accountXP", "desc"), limit(limitCount));
  const snapshot = await getDocs(q);
  let rank = 1;
  const result: AccountRankEntry[] = [];

  snapshot.forEach(doc => {
    const user = doc.data() as ProfileData;
    result.push({
      rank,
      accountXP: user.accountXP ?? 0,
      level: user.level ?? 1,
      player: {
        username: user.username,
        wallet: user.wallet,
        avatarUrl: user.avatarUrl
      }
    });
    rank++;
  });
  return result;
}
// =========================================================================
//  SAVE SCORE FUNCTION (Your original code - no changes needed here)
// =========================================================================
export const saveWackAWegenScore = async (profile: ProfileData, score: number) => {
  if (!profile?.wallet) {
    throw new Error("User profile or wallet address is not available.");
  }

  const userProfileRef = doc(db, 'users', profile.wallet);
  const gameHistoryCollectionRef = collection(db, 'users', profile.wallet, 'gameHistory');
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const monthlyLeaderboardId = `${year}-${month}`;
  const allTimeScoreRef = doc(db, 'leaderboards/wack-a-wegen/allTimeScores', profile.wallet);
  const monthlyScoreRef = doc(db, `leaderboards/wack-a-wegen/monthlyScores/${monthlyLeaderboardId}/scores`, profile.wallet);
  const coinsEarned = Math.floor(score / 10);
  const gameRunData = {
    gameId: 'wack-a-wegen',
    gameName: 'Wack a Wegen',
    gameType: 'arcade',
    score: score,
    coinsEarned: coinsEarned,
    timestamp: serverTimestamp(),
  };

  try {
    await runTransaction(db, async (transaction) => {
      const userProfileSnap = await transaction.get(userProfileRef);
      const allTimeDoc = await transaction.get(allTimeScoreRef);
      const monthlyDoc = await transaction.get(monthlyScoreRef);

      if (!userProfileSnap.exists()) {
        throw new Error("User profile not found. Cannot save game data.");
      }

      const newScoreData = {
        score: score,
        userId: profile.wallet,
        username: profile.username || 'Anonymous',
        avatarUrl: profile.avatarUrl || '/placeholder-avatar.png',
        createdAt: serverTimestamp(),
      };

      if (!allTimeDoc.exists() || score > (allTimeDoc.data()?.score || 0)) {
        transaction.set(allTimeScoreRef, newScoreData);
      }
      if (!monthlyDoc.exists() || score > (monthlyDoc.data()?.score || 0)) {
        transaction.set(monthlyScoreRef, newScoreData);
      }

      const newHistoryDocRef = doc(gameHistoryCollectionRef);
      transaction.set(newHistoryDocRef, gameRunData);
      const currentProfileData = userProfileSnap.data() as ProfileData;
      const recentGames = currentProfileData.recentGames || [];
      const newRecentGame = {
        gameName: 'Wack a Wegen',
        score: score,
        playedAt: now.toISOString()
      };
      const updatedRecentGames = [newRecentGame, ...recentGames].slice(0, 10);

      transaction.update(userProfileRef, {
        'stats.totalGamesPlayed': increment(1),
        'stats.bestScores.wackawegen': Math.max(score, currentProfileData.stats?.bestScores?.wackawegen || 0),
        'accountXP': increment(score),
        'coins.arcade': increment(coinsEarned),
        'recentGames': updatedRecentGames,
        'lastPlayed': serverTimestamp(),
      });
    });

    console.log(`Transaction successful: Score ${score}, Coins ${coinsEarned}. All stats saved!`);
  } catch (e) {
    console.error("Game save transaction failed:", e);
    throw e;
  }
};


// =========================================================================
//  FETCH LEADERBOARD FUNCTION (NEWLY ADDED)
// =========================================================================

// This is the new data type we will use in our Leaderboard component
export interface LeaderboardEntry {
  rank: number;
  score: number;
  player: ProfileData; // This will hold the fresh profile data from the 'users' collection
}

/**
 * Fetches the leaderboard for Wack-a-Wegen, enriching score data with fresh user profiles.
 * @param timeframe - The leaderboard period to fetch ('allTime' or 'monthly').
 * @param count - The number of top scores to fetch.
 * @returns A promise that resolves to an array of LeaderboardEntry objects.
 */
export async function fetchLeaderboard(
  timeframe: 'allTime' | 'monthly' = 'allTime',
  count: number = 100
): Promise<LeaderboardEntry[]> {
  try {
    let scoresCollectionPath: string;

    if (timeframe === 'monthly') {
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');
      const monthlyLeaderboardId = `${year}-${month}`;
      scoresCollectionPath = `leaderboards/wack-a-wegen/monthlyScores/${monthlyLeaderboardId}/scores`;
    } else {
      scoresCollectionPath = 'leaderboards/wack-a-wegen/allTimeScores';
    }

    // 1. Fetch the raw scores, ordered from highest to lowest.
    const scoresQuery = query(
      collection(db, scoresCollectionPath),
      orderBy('score', 'desc'),
      limit(count)
    );
    const scoreSnapshots = await getDocs(scoresQuery);

    const scoreEntries = scoreSnapshots.docs.map(doc => ({
      uid: doc.id, // The document ID is the user's wallet address (UID)
      score: doc.data().score as number
    }));

    // 2. For each score, fetch the LATEST user profile from the 'users' collection.
    const leaderboardData = await Promise.all(
      scoreEntries.map(async (entry, index) => {
        const profileDocRef = doc(db, 'users', entry.uid);
        const profileDocSnap = await getDoc(profileDocRef);

        if (profileDocSnap.exists()) {
          const freshProfile = profileDocSnap.data() as ProfileData;
          return {
            rank: index + 1,
            score: entry.score,
            player: freshProfile, // Use the fresh, up-to-date profile data
          };
        } else {
          // Fallback for the rare case where a profile is missing for a score entry.
          console.warn(`Profile not found for UID: ${entry.uid}`);
          return {
            rank: index + 1,
            score: entry.score,
            player: {
              wallet: entry.uid,
              username: '', // Explicitly empty so the fallback logic works
              avatarUrl: '', // Explicitly empty
              // Add other required fields from ProfileData with default values
              stats: { totalGamesPlayed: 0, bestScores: { wackawegen: 0 } },
              coins: { arcade: 0 },
              createdAt: new Date(),
              lastPlayed: new Date(),
            } as ProfileData,
          };
        }
      })
    );

    return leaderboardData;

  } catch (error) {
    console.error(`Error fetching ${timeframe} leaderboard:`, error);
    return []; // Return an empty array to prevent crashes
  }
}
