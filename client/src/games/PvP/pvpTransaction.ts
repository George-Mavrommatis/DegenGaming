// pvpTransaction.ts
// Handles GGW token payout claims after a DegenFighter PvP match ends.
// Winners call the backend /api/pvp/claim-payout endpoint which verifies
// the result and runs transferSolanaToken() from the admin treasury to the winner.
// Losers' sessions are also recorded server-side so each matchSessionId
// can only be claimed once, preventing replay/spoof attacks.

import { api } from '../../services/api';

export interface PvPPayoutResult {
  success: boolean;
  /** true if the player won and a payout was issued */
  won: boolean;
  /** Raw GGW token units transferred (PVP_WIN_REWARD on backend, 0 for losses) */
  reward?: number;
  /** Solana transaction signature for the payout (null for losses) */
  txSig?: string | null;
  error?: string;
}

/**
 * Claims a GGW token payout after a DegenFighter match.
 * Both winners and losers should call this so the session is recorded
 * and replay claims are blocked.
 *
 * @param matchSessionId - UUID generated at match start; prevents duplicate claims
 * @param won            - Whether the local player won
 * @param score          - Final score from the match scene
 * @returns              - Payout result with win status and reward amount
 */
export async function claimPvpPayout(
  matchSessionId: string,
  won: boolean,
  score: number
): Promise<PvPPayoutResult> {
  try {
    const response = await api.post<PvPPayoutResult>(
      '/api/pvp/claim-payout',
      { matchSessionId, won, score }
    );
    return response.data;
  } catch (err: any) {
    // 409 = already claimed — not a failure to surface
    if (err.response?.status === 409) {
      return { success: false, won: false, error: 'Payout already claimed for this match session.' };
    }
    const message =
      err.response?.data?.message || err.message || 'PvP payout request failed.';
    return { success: false, won: false, error: message };
  }
}
