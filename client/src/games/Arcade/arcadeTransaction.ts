// arcadeTransaction.ts
// Handles GGW token payout claims after an arcade game session ends.
// Calls the backend /api/arcade/claim-payout endpoint which runs
// transferSolanaToken() from the admin treasury wallet to the player.

import { api } from '../../services/api';

export interface ArcadePayoutResult {
  success: boolean;
  /** true if the score met the minimum threshold for a payout */
  qualified: boolean;
  /** Number of GGW coins earned (score / 10, floored) */
  coinsEarned?: number;
  /** Raw token units transferred (coinsEarned * ARCADE_COIN_VALUE) */
  rawAmount?: number;
  error?: string;
}

/**
 * Claims a GGW token payout for an arcade game session.
 *
 * @param gameSessionId - UUID generated at game start; prevents duplicate claims
 * @param score         - Final score reported by the game scene
 * @returns             - Payout result with qualification status and coins earned
 */
export async function claimArcadePayout(
  gameSessionId: string,
  score: number
): Promise<ArcadePayoutResult> {
  try {
    const response = await api.post<ArcadePayoutResult>(
      '/api/arcade/claim-payout',
      { gameSessionId, score }
    );
    return response.data;
  } catch (err: any) {
    // 409 = already claimed — not an error to surface as a failure
    if (err.response?.status === 409) {
      return { success: false, qualified: false, error: 'Payout already claimed for this session.' };
    }
    const message =
      err.response?.data?.message || err.message || 'Arcade payout request failed.';
    return { success: false, qualified: false, error: message };
  }
}
