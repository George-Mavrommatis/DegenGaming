/**
 * DegenGaming Frontend API Layer
 * - Auth-bearing requests via Firebase token
 * - Smart method inference (GET when no data)
 * - Public route detection
 * - 401 retry with forced token refresh
 * - Sensible defaults (timeout)
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

/* ---------------------------- Public Endpoint Set --------------------------- */
/**
 * Endpoints that never require auth.
 * NOTE:
 *  - Submit score is PROTECTED; leaderboard fetch is public GET.
 */
const PUBLIC_EXACT = new Set([
  '/',                 // health
  '/register',
  '/login',
  '/verify-wallet',
  '/platform-stats',
  '/api/prices',
]);

function isPublic(url?: string, method?: string): boolean {
  if (!url) return false;
  const m = (method || 'GET').toUpperCase();
  const path = url.startsWith('/') ? url : `/${url}`;
  if (PUBLIC_EXACT.has(path)) return true;
  // Allow read-only leaderboard GETs
  if (m === 'GET' && path.startsWith('/leaderboards/')) return true;
  return false;
}

/* -------------------- Auth State Gate (avoid early race) ------------------- */
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

/* ---------------------------------- Types ---------------------------------- */
export interface EconomyPlayPayload { gameId: string; category: string; amount: number; }
export interface EconomyRewardPayload { gameId: string; category: string; amount: number; }
export interface EconomyBulkEntry { gameId: string; category: string; gathered?: number; distributed?: number; incrementPlay?: boolean; }
export interface CashierDepositPayload { txSignature?: string; solAmount?: number; solPriceOverride?: number; }
export interface CashierWithdrawPayload { ggAmount: number; destinationWallet?: string; solPriceOverride?: number; }
export interface PickerSessionCreate { gameId: string; paymentSignature?: string; currency: string; }
export interface VerifyWalletPayload { address: string; signedMessage: string; nonce: string; }

/* --------------------------------- Axios ----------------------------------- */
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000, // 15s
  withCredentials: false
});

// Extend request config for retry flag
declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    _retry401?: boolean;
  }
}

/* ------------------------- Request Interceptor ----------------------------- */
apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const method = (config.method || 'get').toUpperCase();

  if (!isPublic(config.url, method)) {
    if (WAIT_FOR_AUTH_INIT) {
      await authReadyPromise;
    }
    const auth = getAuth();
    const user = auth.currentUser;
    if (user) {
      try {
        const token = await user.getIdToken();
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

/* ------------------------- Response Interceptor ---------------------------- */
apiClient.interceptors.response.use(
  res => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig | undefined;
    const status = error.response?.status;
    const method = (original?.method || 'get').toUpperCase();

    if (status === 401 && original && !original._retry401 && !isPublic(original.url, method)) {
      try {
        original._retry401 = true;
        const auth = getAuth();
        const user: User | null = auth.currentUser;
        if (user) {
          await user.getIdToken(true); // force refresh
          const refreshed = await user.getIdToken();
          original.headers = { ...(original.headers || {}), Authorization: `Bearer ${refreshed}` };
          if (DEBUG) console.log('[api] Retrying after forced refresh:', original.url);
          return apiClient(original);
        }
      } catch (refreshErr) {
        if (DEBUG) console.error('[api] Forced refresh failed:', refreshErr);
      }
    }

    let message = 'Unexpected error.';
    if (status === 401) message = (error.response?.data as any)?.message || 'Unauthorized / session expired.';
    else if (status === 403) message = 'Forbidden.';
    else if (status === 404) message = `Not found: ${original?.url}`;
    else if (status && status >= 500) message = 'Server error.';
    else if (error.code === 'ECONNABORTED') message = 'Request timeout.';
    else if (!error.response) message = 'Network error.';

    toast.error(message);
    if (DEBUG) {
      console.error('[api] Error:', {
        method,
        url: original?.url,
        status,
        data: error.response?.data,
        message: error.message
      });
    }
    return Promise.reject(error);
  }
);

/* -------------------- Generic Request (method inference) ------------------- */
function apiCall<T = any>(
  url: string,
  data?: any,
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
): Promise<T> {
  let finalMethod = method;
  if (!finalMethod) {
    finalMethod = (data === undefined || data === null) ? 'GET' : 'POST';
  }
  const cfg: AxiosRequestConfig = { url, method: finalMethod };
  if (finalMethod === 'GET') {
    cfg.params = data;
  } else if (data !== undefined) {
    cfg.data = data;
  }
  return apiClient.request<T>(cfg).then(r => r.data);
}

export const api = apiClient;

/* ------------------------------- API Service ------------------------------- */
export const apiService = {
  /* Auth / Wallet */
  register: (data: { email: string; password: string; username: string }) =>
    apiCall('/register', data, 'POST'),
  login: (credentials: any) =>
    apiCall('/login', credentials, 'POST'),
  verifyWallet: (payload: VerifyWalletPayload) =>
    apiCall('/verify-wallet', payload, 'POST'),

  /* Profile / Users */
  getProfile: () => apiCall('/profile', undefined, 'GET'),
  updateProfile: (data: any) => apiCall('/profile', data, 'PUT'),
  getUserByUid: (uid: string) => apiCall(`/users/${uid}`, undefined, 'GET'),
  getUsernames: () => apiCall('/api/usernames', undefined, 'GET'),

  /* Games & Categories */
  getGames: () => apiCall('/games', undefined, 'GET'),
  getCategories: () => apiCall('/categories', undefined, 'GET'),

  /* Placeholder / Legacy Play Flow */
  playGame: (payload: { gameId: string; wagerAmount: number; prediction?: any }) =>
    apiCall('/play', payload, 'POST'),
  processReward: (payload: { gameId: string; amount?: number; isWinnerClaim?: boolean }) =>
    apiCall('/process-reward', payload, 'POST'),
  updateGameState: (payload: { gameId: string; transactionSignature: string; status: string }) =>
    apiCall('/game-state-update', payload, 'POST'),

  /* Economy */
  economyPlay: (p: EconomyPlayPayload) => apiCall('/economy/play', p, 'POST'),
  economyReward: (p: EconomyRewardPayload) => apiCall('/economy/reward', p, 'POST'),
  economyBulk: (entries: EconomyBulkEntry[]) => apiCall('/economy/bulk', { entries }, 'POST'),
  economySnapshot: (gameId: string, category: string) =>
    apiCall('/economy/snapshot', { gameId, category }, 'POST'),

  /* Direct increments (legacy admin-style) */
  incrementGGCoinsGathered: (gameId: string, category: string, amount: number) =>
    apiCall('/api/games/increment-ggcoins-gathered', { gameId, category, amount }, 'POST'),
  incrementGGCoinsDistributed: (gameId: string, category: string, amount: number) =>
    apiCall('/api/games/increment-ggcoins-distributed', { gameId, category, amount }, 'POST'),
  incrementGamesPlayed: (gameId: string, category: string) =>
    apiCall('/api/games/increment-games-played', { gameId, category }, 'POST'),
  incrementSolGathered: (gameId: string, category: string, amount: number) =>
    apiCall('/api/games/increment-sol-gathered', { gameId, category, amount }, 'POST'),

  /* Cashier */
  cashierDeposit: (p: CashierDepositPayload) => apiCall('/cashier/deposit', p, 'POST'),
  cashierWithdraw: (p: CashierWithdrawPayload) => apiCall('/cashier/withdraw', p, 'POST'),

  /* Picker sessions */
  createPickerSession: (p: PickerSessionCreate) =>
    apiCall('/api/picker/create-session', p, 'POST'),
  validatePickerSession: (id: string) =>
    apiCall(`/api/picker/validate-session/${id}`, undefined, 'GET'),

  /* Free entry tokens */
  getFreeEntryTokens: () => apiCall('/user/free-entry-tokens', undefined, 'GET'),
  generateToken: (tokenType: string) => apiCall('/tokens/generate', { tokenType }, 'POST'),
  consumeToken: (tokenType: string) => apiCall('/tokens/consume', { tokenType }, 'POST'),

  /* Platform / Online / Price */
  getPlatformStats: () => apiCall('/platform-stats', undefined, 'GET'),
  getOnlineUsers: () => apiCall('/onlineUsers', undefined, 'GET'),
  getSolPrice: () => apiCall('/api/prices', undefined, 'GET'),

  /* Leaderboards */
  submitScore: (gameId: string, score: number) =>
    apiCall('/leaderboards/submit-score', { gameId, score }, 'POST'),
  getLeaderboard: (gameId: string) =>
    apiCall(`/leaderboards/${gameId}`, undefined, 'GET'),

  /* Friends */
  sendFriendRequest: (targetUsername: string) =>
    apiCall('/friend-request/send', { targetUsername }, 'POST'),
  acceptFriendRequest: (senderId: string) =>
    apiCall('/friend-request/accept', { senderId }, 'POST'),
  rejectFriendRequest: (senderId: string) =>
    apiCall('/friend-request/reject', { senderId }, 'POST'),
  removeFriend: (friendId: string) =>
    apiCall('/friends/remove', { friendId }, 'POST'),
  getFriends: () => apiCall('/friends', undefined, 'GET'),
  getSentFriendRequests: () => apiCall('/friend-requests/sent', undefined, 'GET'),
  getReceivedFriendRequests: () => apiCall('/friend-requests/received', undefined, 'GET'),

  /* Chats */
  getUserChats: (): Promise<ChatListItem[]> => apiCall('/chats', undefined, 'GET'),
  findOrCreateChat: (targetUid: string) =>
    apiCall('/chats/findOrCreate', { targetUid }, 'POST'),
  sendChatMessage: (chatId: string, text: string) =>
    apiCall(`/chats/${chatId}/messages`, { text }, 'POST'),
};

export { apiCall };