// src/services/api.ts
// (This file is exactly the same as provided in my last comprehensive answer)

import axios from 'axios';
import { auth as firebaseAuth } from '../firebase/firebaseConfig'; // Import your Firebase client SDK auth instance

const api = axios.create({
    baseURL: 'http://localhost:4000', // <-- IMPORTANT: Ensure this matches your backend server's address
    headers: {
        'Content-Type': 'application/json',
    },
});

api.interceptors.request.use(
    async (config) => {
        const currentUser = firebaseAuth.currentUser;
        if (currentUser) {
            try {
                const token = await currentUser.getIdToken();
                config.headers.Authorization = `Bearer ${token}`;
            } catch (error) {
                console.error("Axios Interceptor: Error getting Firebase ID Token for request:", error);
                delete config.headers.Authorization; // Remove if token acquisition fails
            }
        } else {
            delete config.headers.Authorization; // No user, no token
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            console.error("Axios Interceptor: Unauthorized or Forbidden response.", error.response.data);
            // Optionally, force a logout or redirect if tokens are consistently failing
            // e.g., if (firebaseAuth.currentUser) firebaseAuth.signOut();
        }
        return Promise.reject(error);
    }
);

export { api };