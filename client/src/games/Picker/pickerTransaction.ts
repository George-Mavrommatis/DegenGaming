// pickerTransaction.ts
// Handles GGW token payout claims after a Degen Race game ends.
// Only pays out if the human player's chosen racer won.
// Calls the backend /api/picker/claim-payout endpoint which runs
// transferSolanaToken() from the admin treasury wallet to the player.

import { api } from '../../services/api';

export interface PickerPayoutResult {
  success: boolean;
  /** true if the user's chosen player won the race */
  isWinner: boolean;
  /** Raw GGW token units transferred (PICKER_WIN_REWARD on backend) */
  reward?: number;
  error?: string;
}

/**
 * Claims a GGW token payout after a Degen Race session.
 * Sends the result to the backend which validates the win and
 * processes the token transfer. Non-winners receive no payout but
 * the session is still marked as resolved to prevent replay claims.
 *
 * @param sessionId        - gameEntryTokenId from PickerInitModal session creation
 * @param chosenPlayerKey  - Key of the player the user bet on
 * @param winnerKey        - Key of the actual race winner
 * @returns                - Payout result with win status and reward amount
 */
export async function claimPickerPayout(
  sessionId: string,
  chosenPlayerKey: string,
  winnerKey: string
): Promise<PickerPayoutResult> {
  try {
    const response = await api.post<PickerPayoutResult>(
      '/api/picker/claim-payout',
      { sessionId, chosenPlayerKey, winnerKey }
    );
    return response.data;
  } catch (err: any) {
    // 409 = already claimed
    if (err.response?.status === 409) {
      return { success: false, isWinner: false, error: 'Payout already claimed for this session.' };
    }
    const message =
      err.response?.data?.message || err.message || 'Picker payout request failed.';
    return { success: false, isWinner: false, error: message };
  }
}
