/**
 * DegenGaming Frontend API Layer (Aligned with fixed server)
 *
 * Features:
 *  - Public endpoint detection (minimal)
 *  - Auth token injection (waits for Firebase auth state once if desired)
 *  - One-time 401 retry with forced token refresh
 *  - Full coverage of server endpoints (economy, cashier, friends, chats, leaderboard, picker sessions, etc.)
 *  - Chunking handled server-side; client just calls straight endpoints
 *  - Light types for core payloads
 *
 * NOTE: Previous build error fixed by removing duplicate 'apiCall' symbol.
 */

import axios, {
  AxiosError,
  AxiosRequestConfig,
  InternalAxiosRequestConfig
} from 'axios';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { toast } from 'react-toastify';
import { ChatListItem } from '../utilities/chat';

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const DEBUG = import.meta.env.VITE_API_DEBUG === 'true';
const WAIT_FOR_AUTH_INIT = true;

// Public endpoints (exact match or pattern-coded)
const PUBLIC_SET = new Set([
  '/',
  '/register',
  '/login',
  '/verify-wallet',
  '/platform-stats',
  '/api/prices',
]);

function isPublic(url?: string): boolean {
  if (!url) return false;
  const p = url.startsWith('/') ? url : `/${url}`;
  if (PUBLIC_SET.has(p)) return true;
  if (p.startsWith('/leaderboards/')) return true; // allow leaderboard viewing public
  return false;
}

// Wait for auth state (to avoid race on first load)
let authInit = false;
let authReadyResolver: (() => void) | null = null;
const authReadyPromise = new Promise<void>(resolve => { authReadyResolver = resolve; });

function initAuthListener() {
  if (authInit) return;
  authInit = true;
  const auth = getAuth();
  onAuthStateChanged(auth, () => {
    if (authReadyResolver) {
      authReadyResolver();
      authReadyResolver = null;
    }
  });
}
initAuthListener();

// Types
export interface EconomyPlayPayload { gameId: string; category: string; amount: number; }
export interface EconomyRewardPayload { gameId: string; category: string; amount: number; }
export interface EconomyBulkEntry { gameId: string; category: string; gathered?: number; distributed?: number; incrementPlay?: boolean; }
export interface CashierDepositPayload { txSignature?: string; solAmount?: number; solPriceOverride?: number; }
export interface CashierWithdrawPayload { ggAmount: number; destinationWallet?: string; solPriceOverride?: number; }
export interface PickerSessionCreate { gameId: string; paymentSignature?: string; currency: string; }
export interface VerifyWalletPayload { address: string; signedMessage: string; nonce: string; }

// Axios instance
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' }
});

// Augment Axios config for retry metadata
declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    _retry401?: boolean;
  }
}

// Request interceptor: attach token if needed
apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  if (!isPublic(config.url)) {
    if (WAIT_FOR_AUTH_INIT) {
      await authReadyPromise;
    }
    const auth = getAuth();
    const user = auth.currentUser;
    if (user) {
      try {
        const token = await user.getIdToken(); // normal refresh path
        config.headers.Authorization = `Bearer ${token}`;
      } catch (e) {
        console.error('[api] getIdToken failed:', e);
      }
    } else if (DEBUG) {
      console.warn('[api] No currentUser for protected request:', config.url);
    }
  }
  return config;
});

// Response interceptor: one-time 401 retry with forced refresh
apiClient.interceptors.response.use(
  res => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig | undefined;
    const status = error.response?.status;

    if (status === 401 && original && !original._retry401 && !isPublic(original.url)) {
      try {
        original._retry401 = true;
        const auth = getAuth();
        const user: User | null = auth.currentUser;
        if (user) {
          await user.getIdToken(true); // force refresh
          const refreshed = await user.getIdToken();
          original.headers = { ...(original.headers || {}), Authorization: `Bearer ${refreshed}` };
          if (DEBUG) console.log('[api] Retrying request after forced token refresh:', original.url);
          return apiClient(original);
        }
      } catch (refreshErr) {
        if (DEBUG) console.error('[api] Forced refresh failed:', refreshErr);
      }
    }

    // Generic error messaging
    let message = 'Unexpected error.';
    if (status === 401) message = error.response?.data?.message || 'Unauthorized / session expired.';
    else if (status === 403) message = 'Forbidden.';
    else if (status === 404) message = `Not found: ${original?.url}`;
    else if (status && status >= 500) message = 'Server error.';
    else if (error.code === 'ECONNABORTED') message = 'Request timeout.';
    else if (!error.response) message = 'Network error.';

    toast.error(message);
    if (DEBUG) {
      console.error('[api] Error:', {
        url: original?.url,
        status,
        data: error.response?.data,
        message: error.message
      });
    }
    return Promise.reject(error);
  }
);

// Config-based generic request (renamed from apiCall to avoid symbol collision)
export async function apiRequest<T = any>(config: AxiosRequestConfig): Promise<T> {
  const res = await apiClient.request<T>(config);
  return res.data;
}

/* -------------------------------------------------------------------------- */
/* API Service                                                                */
/* -------------------------------------------------------------------------- */
export const apiService = {
  // Auth / Wallet
  register: (data: { email: string; password: string; username: string }) =>
    apiCall('/register', data),
  login: (credentials: any) =>
    apiCall('/login', credentials),
  verifyWallet: (payload: VerifyWalletPayload) =>
    apiCall('/verify-wallet', payload),

  // Profile / Users
  getProfile: () => apiCall('/profile'),
  updateProfile: (data: any) => apiCall('/profile', data, 'PUT'),
  getUserByUid: (uid: string) => apiCall(`/users/${uid}`, undefined, 'GET'),
  getUsernames: () => apiCall('/api/usernames'),

  // Games & Categories
  getGames: () => apiCall('/games'),
  getCategories: () => apiCall('/categories'),

  // Legacy / placeholder
  playGame: (payload: { gameId: string; wagerAmount: number; prediction?: any }) =>
    apiCall('/play', payload),
  processReward: (payload: { gameId: string; amount?: number; isWinnerClaim?: boolean }) =>
    apiCall('/process-reward', payload),
  updateGameState: (payload: { gameId: string; transactionSignature: string; status: string }) =>
    apiCall('/game-state-update', payload),

  // Economy
  economyPlay: (p: EconomyPlayPayload) => apiCall('/economy/play', p),
  economyReward: (p: EconomyRewardPayload) => apiCall('/economy/reward', p),
  economyBulk: (entries: EconomyBulkEntry[]) => apiCall('/economy/bulk', { entries }),
  economySnapshot: (gameId: string, category: string) =>
    apiCall('/economy/snapshot', { gameId, category }),

  // Direct increments
  incrementGGCoinsGathered: (gameId: string, category: string, amount: number) =>
    apiCall('/api/games/increment-ggcoins-gathered', { gameId, category, amount }),
  incrementGGCoinsDistributed: (gameId: string, category: string, amount: number) =>
    apiCall('/api/games/increment-ggcoins-distributed', { gameId, category, amount }),
  incrementGamesPlayed: (gameId: string, category: string) =>
    apiCall('/api/games/increment-games-played', { gameId, category }),
  incrementSolGathered: (gameId: string, category: string, amount: number) =>
    apiCall('/api/games/increment-sol-gathered', { gameId, category, amount }),

  // Cashier
  cashierDeposit: (p: CashierDepositPayload) => apiCall('/cashier/deposit', p),
  cashierWithdraw: (p: CashierWithdrawPayload) => apiCall('/cashier/withdraw', p),

  // Picker sessions
  createPickerSession: (p: PickerSessionCreate) =>
    apiCall('/api/picker/create-session', p),
  validatePickerSession: (id: string) =>
    apiCall(`/api/picker/validate-session/${id}`, undefined, 'GET'),

  // Free entry tokens
  getFreeEntryTokens: () => apiCall('/user/free-entry-tokens'),
  generateToken: (tokenType: string) => apiCall('/tokens/generate', { tokenType }),
  consumeToken: (tokenType: string) => apiCall('/tokens/consume', { tokenType }),

  // Platform / Online / Price
  getPlatformStats: () => apiCall('/platform-stats'),
  getOnlineUsers: () => apiCall('/onlineUsers'),
  getSolPrice: () => apiCall('/api/prices'),

  // Leaderboards
  submitScore: (gameId: string, score: number) =>
    apiCall('/leaderboards/submit-score', { gameId, score }),
  getLeaderboard: (gameId: string) =>
    apiCall(`/leaderboards/${gameId}`, undefined, 'GET'),

  // Friends
  sendFriendRequest: (targetUsername: string) =>
    apiCall('/friend-request/send', { targetUsername }),
  acceptFriendRequest: (senderId: string) =>
    apiCall('/friend-request/accept', { senderId }),
  rejectFriendRequest: (senderId: string) =>
    apiCall('/friend-request/reject', { senderId }),
  removeFriend: (friendId: string) =>
    apiCall('/friends/remove', { friendId }),
  getFriends: () => apiCall('/friends'),
  getSentFriendRequests: () => apiCall('/friend-requests/sent'),
  getReceivedFriendRequests: () => apiCall('/friend-requests/received'),

  // Chats
  getUserChats: (): Promise<ChatListItem[]> => apiCall('/chats'),
  findOrCreateChat: (targetUid: string) =>
    apiCall('/chats/findOrCreate', { targetUid }),
  sendChatMessage: (chatId: string, text: string) =>
    apiCall(`/chats/${chatId}/messages`, { text }),

  // Placeholder (not implemented on server)
  getGameHistory: async () => {
    console.warn('[api] /user/game-history not implemented.');
    return { message: 'Not implemented' };
  },
};

// Generic convenience wrapper (final retained version)
function apiCall<T = any>(
  url: string,
  data?: any,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST'
): Promise<T> {
  const cfg: AxiosRequestConfig = { url, method };
  if (method === 'GET') {
    cfg.params = data;
  } else if (data !== undefined) {
    cfg.data = data;
  }
  return apiClient.request<T>(cfg).then(r => r.data);
}

export const api = apiClient;