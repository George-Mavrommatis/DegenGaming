// src/socket.ts
import { io } from 'socket.io-client';

// Determine the backend URL.
// If your frontend and backend are on the same domain in production,
// window.location.origin is often suitable. Otherwise, specify your prod URL.
const BACKEND_URL = import.meta.env.PROD
  ? 'https://your-production-backend-url.com' // <-- CHANGE THIS TO YOUR ACTUAL PRODUCTION BACKEND URL
  : 'http://localhost:4000'; // This matches your server.js port

export const socket = io(BACKEND_URL, {
    autoConnect: false // We will manually connect it when needed (e.g., after login)
});

// You might also want to add some basic error handling/logging for the socket connection
socket.on('connect', () => {
    console.log('Socket.IO connected:', socket.id);
});

socket.on('disconnect', (reason) => {
    console.log('Socket.IO disconnected:', reason);
    // Handle reconnection logic if needed
});

socket.on('connect_error', (err) => {
    console.error('Socket.IO connection error:', err.message);
});