/**
 * friends.ts (refactored)
 * Previous direct Firestore mutation functions replaced with backend API calls.
 * Keeping this file as a compatibility layer so existing imports do not break.
 *
 * NOTE: These methods now return the backend response (or void) and will
 * throw on error. Make sure to handle in caller.
 */

import { apiService } from '../services/api';

// New canonical wrappers
export async function sendFriendRequest(fromUsernameOrTarget: string, deprecated?: string) {
  // Old signature (fromUid, toUid) is no longer used.
  // Now API uses targetUsername only (authenticated user inferred by backend).
  if (deprecated) {
    console.warn('[friends] Deprecated signature used. Use sendFriendRequest(targetUsername) instead.');
  }
  return apiService.sendFriendRequest(fromUsernameOrTarget);
}

export async function acceptFriendRequest(senderId: string) {
  return apiService.acceptFriendRequest(senderId);
}

export async function declineFriendRequest(senderId: string) {
  // Maps to reject
  return apiService.rejectFriendRequest(senderId);
}

export async function cancelSentInvitation(_myUid: string, _toUid: string) {
  console.warn('[friends] cancelSentInvitation no longer needed; ignoring.');
}

export async function removeFriend(friendUid: string) {
  return apiService.removeFriend(friendUid);
}

// (Optional) fetch lists if needed externally (Panels already use apiService directly)
export async function fetchFriends() {
  return apiService.getFriends();
}
export async function fetchSentRequests() {
  return apiService.getSentFriendRequests();
}
export async function fetchReceivedRequests() {
  return apiService.getReceivedFriendRequests();
}