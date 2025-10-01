/**
 * onlineUsers.ts (refactored)
 *
 * Replaces direct Firestore time-window query with:
 *  1. Socket.IO event 'onlineUsersUpdate' (if socket available)
 *  2. Fallback polling to backend GET /onlineUsers every 30s
 *
 * This avoids mismatch in Timestamp vs ISO string comparisons
 * and leverages server authoritative presence.
 */

import { apiService } from '../services/api';
import type { Socket } from 'socket.io-client';

export interface OnlineUser {
  uid: string;
  username?: string;
  avatarUrl?: string;
  isOnline?: boolean;
}

interface SubscribeOptions {
  socket?: Socket;
  intervalMs?: number;
}

/**
 * subscribeToOnlineUsers
 * Returns unsubscribe function.
 */
export function subscribeToOnlineUsers(
  callback: (uids: string[]) => void,
  options: SubscribeOptions = {}
): () => void {
  const { socket, intervalMs = 30000 } = options;
  let timer: any;

  const fetchOnce = async () => {
    try {
      const res = await apiService.getOnlineUsers();
      if (Array.isArray(res.onlineUserIds)) {
        callback(res.onlineUserIds);
      } else if (Array.isArray(res)) {
        callback(res);
      }
    } catch (e) {
      console.error('[onlineUsers] Poll error:', e);
    }
  };

  if (socket) {
    const handler = (list: string[]) => {
      callback(list);
    };
    socket.on('onlineUsersUpdate', handler);
    // seed
    fetchOnce();
    // Poll as safety net every few intervals in case we miss events
    timer = setInterval(fetchOnce, intervalMs * 2);
    return () => {
      socket.off('onlineUsersUpdate', handler);
      clearInterval(timer);
    };
  }

  // No socket: pure polling
  fetchOnce();
  timer = setInterval(fetchOnce, intervalMs);
  return () => clearInterval(timer);
}