// src/services/api.ts

import axios from 'axios';
import { getAuth } from 'firebase/auth';
import { toast } from 'react-toastify';

// Define your API base URL.
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

// Create an Axios instance
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request Interceptor: Add Authorization header to every outgoing request
apiClient.interceptors.request.use(async (config) => {
  const auth = getAuth();
  const user = auth.currentUser;

  // Paths that do NOT require authentication (e.g., /register, /login, /).
  const publicPaths = ['/', '/register', '/login', '/platform-stats'];

  // Check if the current request URL (relative to base URL, removing leading slash for comparison) is in publicPaths
  const requestPath = config.url?.startsWith('/') ? config.url.substring(1) : config.url;
  const isPublicPath = publicPaths.some(path => {
    const publicPathClean = path.startsWith('/') ? path.substring(1) : path;
    return requestPath?.startsWith(publicPathClean);
  });

  if (!isPublicPath && user) {
    try {
      const idToken = await user.getIdToken();
      config.headers.Authorization = `Bearer ${idToken}`;
    } catch (error) {
      console.error("Error getting Firebase ID token (in interceptor):", error);
      toast.error("Authentication failed. Please refresh or log in again.");
    }
  } else if (!isPublicPath && !user) {
    console.warn(`Attempted to access protected route (${config.url}) without authenticated user. Backend will likely return 401.`);
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

// Response Interceptor: Handle common errors and display toasts
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    let errorMessage = "An unexpected error occurred.";
    if (error.response) {
      errorMessage = error.response.data?.message || `Error ${error.response.status}: ${error.response.statusText}`;

      if (error.response.status === 401) {
        errorMessage = "Session expired or unauthorized. Please log in again.";
      } else if (error.response.status === 403) {
        errorMessage = "You don't have permission to perform this action.";
      } else if (error.response.status === 404) {
        errorMessage = `Resource not found at ${error.config.url}. Check backend route or URL.`;
      } else if (error.response.status >= 500) {
        errorMessage = "Server error. Please try again later.";
      }
      console.error('API Error (Response):', error.response.data || error.response.statusText, error.response);
    } else if (error.request) {
      errorMessage = "No response from server. Check internet connection or server status.";
      console.error('API Error (Request):', error.request);
    } else {
      errorMessage = `Request setup error: ${error.message}`;
      console.error('API Error (Message):', error.message);
    }

    toast.error(errorMessage);
    return Promise.reject(error);
  }
);

// --- API Service Functions ---
export const apiService = {
  // Authentication
  register: async (userData: any) => {
    const response = await apiClient.post('/register', userData);
    return response.data;
  },
  login: async (credentials: any) => {
    const response = await apiClient.post('/login', credentials);
    return response.data;
  },

  // Profile
  getProfile: async () => {
    const response = await apiClient.get('/profile');
    return response.data;
  },
  updateProfile: async (profileData: any) => {
    const response = await apiClient.put('/profile', profileData);
    return response.data;
  },

  // Games & Categories
  getGames: async () => {
    const response = await apiClient.get('/games');
    return response.data;
  },
  getCategories: async () => {
    const response = await apiClient.get('/categories');
    return response.data;
  },

  // Game Initiation
  initiateGame: async (gameData: any) => {
    const response = await apiClient.post('/initiate-game', gameData);
    return response.data;
  },

  // Free Entry Tokens
  getFreeEntryTokens: async () => {
    const response = await apiClient.get('/user/free-entry-tokens');
    return response.data;
  },

  // Platform Stats
  getPlatformStats: async () => {
    const response = await apiClient.get('/platform-stats');
    return response.data;
  },

  // Friend System
  sendFriendRequest: async (targetUsername: string) => {
    const response = await apiClient.post('/friend-request/send', { targetUsername });
    return response.data;
  },
  acceptFriendRequest: async (senderId: string) => {
    const response = await apiClient.post('/friend-request/accept', { senderId });
    return response.data;
  },
  rejectFriendRequest: async (senderId: string) => {
    const response = await apiClient.post('/friend-request/reject', { senderId });
    return response.data;
  },
  getFriends: async () => {
    const response = await apiClient.get('/friends');
    return response.data;
  },
  getSentFriendRequests: async () => {
    const response = await apiClient.get('/friend-requests/sent');
    return response.data;
  },
  getReceivedFriendRequests: async () => {
    const response = await apiClient.get('/friend-requests/received');
    return response.data;
  },

  // Chat
  getUserChats: async () => {
    const response = await apiClient.get('/chats');
    return response.data;
  },
  findOrCreateChat: async (targetUid: string) => {
    const response = await apiClient.post('/chats/findOrCreate', { targetUid });
    return response.data;
  },
  sendChatMessage: async (chatId: string, text: string) => {
    const response = await apiClient.post(`/chats/${chatId}/messages`, { text });
    return response.data;
  },
};

export default apiClient;