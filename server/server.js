// DegenGaming/server.js
// Complete, Consolidated, and Corrected Backend Server (with chat and social features)

import dotenv from 'dotenv';
dotenv.config(); // Load environment variables from .env file

import fs from 'fs';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';

import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Solana imports - ALL NECESSARY IMPORTS ARE HERE
import {
    Connection,
    PublicKey,
    clusterApiUrl,
    Transaction,
    Keypair,
    sendAndConfirmTransaction,
} from '@solana/web3.js';

import {
    getOrCreateAssociatedTokenAccount,
    mintTo,
    createMint,
    transfer,
    getAccount,
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
} from '@solana/spl-token';

import bs58 from 'bs58';
import nacl from 'tweetnacl';
import * as cron from 'node-cron';
import { fileURLToPath } from 'url';
import path from 'path';

// --- Import Backend Services ---
// IMPORTANT: This path assumes chatService.js is in the 'services' folder next to server.js
// Make sure you have moved DegenGaming/src/services/chatService.js to DegenGaming/services/chatService.js
import { initializeChatService, findOrCreateChat, sendMessage, getUserChats } from './services/chatService.js';


// --- Firebase Admin SDK Initialization ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
let db; // Firestore instance
let auth; // Firebase Auth instance

try {
    const serviceAccountData = fs.readFileSync(serviceAccountPath, 'utf8');
    const serviceAccount = JSON.parse(serviceAccountData);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        // No databaseURL as we are not using Firebase Realtime Database
    });

    db = getFirestore(); // Initialize Firestore
    auth = getAuth();    // Initialize Auth

    // Initialize the chatService with the Firestore DB and admin instance
    initializeChatService(db, admin); // Pass db and admin to chatService

    console.log("Firebase Admin SDK initialized successfully (Firestore, Auth).");
} catch (error) {
    console.error("Failed to load Firebase service account key or initialize Firebase Admin SDK:", error);
    if (error.code === 'ENOENT') {
        console.error("Please ensure 'serviceAccountKey.json' exists in the same directory as server.js.");
        console.error("Path attempted: " + serviceAccountPath);
    }
    process.exit(1); // Exit if Firebase cannot be initialized, as it's critical
}


// --- Solana Configuration ---
const SOLANA_CLUSTER = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'); // Default to devnet if SOLANA_RPC_URL not set
const connection = new Connection(SOLANA_CLUSTER, 'confirmed');
console.log(`Solana cluster: ${SOLANA_CLUSTER}`);

const ADMIN_WALLET_PRIVATE_KEY_BASE58 = process.env.ADMIN_WALLET_PRIVATE_KEY_BASE58;
let adminWalletKeypair; // Consistent naming: adminWalletKeypair

if (ADMIN_WALLET_PRIVATE_KEY_BASE58) {
    try {
        adminWalletKeypair = Keypair.fromSecretKey(bs58.decode(ADMIN_WALLET_PRIVATE_KEY_BASE58));
        console.log(`Admin wallet loaded: ${adminWalletKeypair.publicKey.toBase58()}`);
    } catch (e) {
        console.error("Failed to load ADMIN_WALLET_PRIVATE_KEY_BASE58. Check the key format or if it's set in .env.", e.message);
        adminWalletKeypair = null;
    }
} else {
    console.error("WARNING: ADMIN_WALLET_PRIVATE_KEY_BASE58 not set in .env. Solana operations will fail.");
    adminWalletKeypair = null;
}

// Load game token mint from env — required for all SPL token operations
const GAME_TOKEN_MINT_ADDRESS = process.env.GAME_TOKEN_MINT_ADDRESS;
let gameTokenMint = null;
if (GAME_TOKEN_MINT_ADDRESS) {
    try {
        gameTokenMint = new PublicKey(GAME_TOKEN_MINT_ADDRESS);
        console.log(`Game token mint loaded: ${gameTokenMint.toBase58()}`);
    } catch (e) {
        console.error("Failed to parse GAME_TOKEN_MINT_ADDRESS. Check the address format.", e.message);
        gameTokenMint = null;
    }
} else {
    console.warn("WARNING: GAME_TOKEN_MINT_ADDRESS not set in .env. SPL token operations will be disabled.");
}
const GAME_TOKEN_DECIMALS = 9; // Decimals for your game token


// --- Express App Setup ---
const app = express();
const PORT = process.env.PORT || 4000;

// CORS Options: Ensure all your frontend origins are listed
const corsOptions = {
    origin: process.env.CLIENT_URL || 'http://localhost:5173', // Use CLIENT_URL from .env
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json()); // Middleware to parse JSON body requests


const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: corsOptions // Apply CORS to Socket.IO as well
});


// --- Helper Functions (used across routes and Socket.IO) ---

// Helper function to get a Firestore user document reference
function getUserDocRef(uid) {
    return db.collection('users').doc(uid);
}

// Helper function to get online user UIDs for real-time updates and API endpoints
async function getOnlineUserIds() {
    try {
        const onlineUsersSnapshot = await db.collection('users')
            .where('isOnline', '==', true)
            .get();
        const onlineUserIds = [];
        onlineUsersSnapshot.forEach((doc) => {
            if (doc.exists) {
                onlineUserIds.push(doc.id); // doc.id is the UID in Firestore
            }
        });
        return onlineUserIds;
    } catch (error) {
        console.error("Error fetching online user IDs from Firestore:", error);
        return [];
    }
}

// Helper to fetch user display data for friends/chat lists
async function getUserDisplayData(uid) {
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists) {
        const data = userDoc.data();
        return {
            uid: userDoc.id,
            username: data.username,
            avatarUrl: data.avatarUrl,
            isOnline: data.isOnline || false, // Default to false if not set
        };
    }
    return null;
}


// In-memory PvP room registry (rooms are ephemeral — cleared on server restart)
const pvpRooms = new Map();

// --- Socket.IO Connection Handling (Presence fully in Firestore) ---
io.on('connection', (socket) => {
    console.log('A user connected via Socket.IO');

    // Store user ID on socket when they connect and identify themselves
    socket.on('setUid', async (uid) => {
        socket.data.uid = uid; // Attach UID to socket object
        console.log(`Socket ${socket.id} identified as user ${uid}`);

        try {
            // Update isOnline and lastSeen in Firestore
            await db.collection('users').doc(uid).update({
                isOnline: true,
                lastSeen: admin.firestore.FieldValue.serverTimestamp(),
            });
            console.log(`User ${uid} connected and presence set in Firestore.`);

            // Emit the updated list of online users to all clients
            const onlineUserIds = await getOnlineUserIds();
            io.emit('onlineUsersUpdate', onlineUserIds); // Emit to all connected clients
        } catch (error) {
            console.error(`Error setting online status for user ${uid} in Firestore:`, error);
        }
    });

    socket.on('disconnect', async () => {
        console.log('User disconnected from Socket.IO');
        const uid = socket.data.uid; // Get UID from socket data
        if (uid) {
            try {
                // Update lastSeen and isOnline in Firestore
                await db.collection('users').doc(uid).update({
                    isOnline: false,
                    lastSeen: admin.firestore.FieldValue.serverTimestamp(),
                });
                console.log(`User ${uid} disconnected and presence updated in Firestore.`);

                // Emit the updated list of online users to all clients
                const onlineUserIds = await getOnlineUserIds();
                io.emit('onlineUsersUpdate', onlineUserIds);
            } catch (error) {
                console.error(`Error setting offline status for user ${uid} in Firestore:`, error);
            }
        }
    });

    // Game-related Socket.IO events (from your original code)
    socket.on('joinGame', (gameId) => {
        socket.join(gameId);
        console.log(`Socket ${socket.id} joined game room: ${gameId}`);
    });

    socket.on('gameAction', (data) => {
        const { gameId, actionType, payload } = data;
        console.log(`Game action received for game ${gameId}: ${actionType}`);
        // Emit game event to all sockets in the specific game room
        io.to(gameId).emit('gameEvent', { actionType, payload, fromUser: socket.data.uid });
    });

    socket.on('leaveGame', (gameId) => {
        socket.leave(gameId);
        console.log(`Socket ${socket.id} left game room: ${gameId}`);
    });

    // ─── PvP Room Events ────────────────────────────────────────────────────
    // pvp:createRoom  → host creates a room
    socket.on('pvp:createRoom', ({ username, avatarUrl }) => {
        const roomId = `pvp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        socket.join(roomId);
        pvpRooms.set(roomId, {
            roomId,
            host: { socketId: socket.id, uid: socket.data.uid, username, avatarUrl },
            guest: null,
            state: 'waiting',
            results: {},
        });
        socket.emit('pvp:roomCreated', { roomId });
        console.log(`[PvP] Room created: ${roomId} by ${socket.data.uid}`);
    });

    // pvp:joinRoom  → guest joins an existing room
    socket.on('pvp:joinRoom', ({ roomId, username, avatarUrl }) => {
        const room = pvpRooms.get(roomId);
        if (!room) { socket.emit('pvp:error', { message: 'Room not found.' }); return; }
        if (room.state !== 'waiting') { socket.emit('pvp:error', { message: 'Room is already in progress.' }); return; }
        if (room.host.socketId === socket.id) { socket.emit('pvp:error', { message: 'Cannot join your own room.' }); return; }

        socket.join(roomId);
        room.guest = { socketId: socket.id, uid: socket.data.uid, username, avatarUrl };
        room.state = 'active';
        pvpRooms.set(roomId, room);

        io.to(roomId).emit('pvp:matchStart', {
            roomId,
            host: { uid: room.host.uid, username: room.host.username, avatarUrl: room.host.avatarUrl },
            guest: { uid: room.guest.uid, username: room.guest.username, avatarUrl: room.guest.avatarUrl },
        });
        console.log(`[PvP] Match started: ${roomId}`);
    });

    // pvp:inputState  → relay player input/position to opponent
    socket.on('pvp:inputState', ({ roomId, state }) => {
        socket.to(roomId).emit('pvp:opponentState', { state, fromUid: socket.data.uid });
    });

    // pvp:matchResult  → each client reports outcome; server resolves and emits pvp:matchEnded
    socket.on('pvp:matchResult', ({ roomId, won }) => {
        const room = pvpRooms.get(roomId);
        if (!room) return;
        room.results[socket.data.uid] = won;

        const hostReported  = room.results[room.host.uid]  !== undefined;
        const guestReported = room.results[room.guest?.uid] !== undefined;
        if (hostReported && guestReported) {
            const hostWon  = room.results[room.host.uid];
            const guestWon = room.results[room.guest.uid];
            // Canonical result: exactly one wins; fall back to host's report if contradictory
            const resolvedHostWon = (hostWon === true && guestWon === false) ? true
                : (hostWon === false && guestWon === true) ? false
                : hostWon;

            io.to(room.host.socketId).emit('pvp:matchEnded', { won: resolvedHostWon });
            io.to(room.guest.socketId).emit('pvp:matchEnded', { won: !resolvedHostWon });
            pvpRooms.delete(roomId);
            console.log(`[PvP] Match ended: ${roomId} — host won: ${resolvedHostWon}`);
        }
    });

    // pvp:leaveRoom  → forfeit: opponent wins
    socket.on('pvp:leaveRoom', ({ roomId }) => {
        const room = pvpRooms.get(roomId);
        if (!room) return;
        const opponentSocketId = room.host.socketId === socket.id ? room.guest?.socketId : room.host.socketId;
        if (opponentSocketId) io.to(opponentSocketId).emit('pvp:opponentLeft', { roomId });
        pvpRooms.delete(roomId);
        socket.leave(roomId);
        console.log(`[PvP] Room ${roomId} closed — forfeit.`);
    });

    // ─── Chat-related Socket.IO events ──────────────────────────────────────
    socket.on('chat:join', (chatId) => {
        socket.join(chatId);
        console.log(`User ${socket.data.uid} joined chat room ${chatId}`);
    });

    socket.on('chat:message', async (messageData) => {
        const { chatId, text } = messageData;
        const senderUid = socket.data.uid;

        if (!senderUid) {
            console.warn('chat:message received without a recognized sender UID.');
            return;
        }
        if (!chatId || !text) {
            console.warn('chat:message received with missing chatId or text.');
            return;
        }

        try {
            // Use the imported sendMessage function from chatService.js
            await sendMessage(chatId, senderUid, text);

            // Fetch sender's display info (username, avatar) for real-time broadcast
            const senderDisplayData = await getUserDisplayData(senderUid);

            // Broadcast the new message to all participants in the chat room
            io.to(chatId).emit('chat:messageReceived', {
                senderId: senderUid,
                text: text,
                createdAt: admin.firestore.Timestamp.now().toDate(), // Provide a Date object for frontend
                senderUsername: senderDisplayData ? senderDisplayData.username : 'Unknown User',
                senderAvatarUrl: senderDisplayData ? senderDisplayData.avatarUrl : '',
            });
            console.log(`Message sent in chat ${chatId} by ${senderUid}.`);
        } catch (error) {
            console.error('Error sending message via socket:', error);
            // Optionally, emit an error back to the sender
            socket.emit('chat:error', 'Failed to send message.');
        }
    });
});


// --- Solana Token Management Functions ---
// (These functions are critical for your Solana interactions)


// Transfers tokens from admin wallet to a recipient's ATA
async function transferSolanaToken(recipientPublicKey, amount) {
    if (!adminWalletKeypair || !gameTokenMint) {
        console.error("Admin wallet or game token mint not initialized.");
        return false;
    }
    try {
        // Get or create admin's ATA
        const adminATA = await getOrCreateAssociatedTokenAccount(
            connection,
            adminWalletKeypair,
            gameTokenMint,
            adminWalletKeypair.publicKey
        );

        // Get or create recipient's ATA
        const recipientATA = await getOrCreateAssociatedTokenAccount(
            connection,
            adminWalletKeypair, // Payer if recipient ATA needs creation
            gameTokenMint,
            recipientPublicKey
        );

        // Transfer tokens
        const signature = await transfer(
            connection,
            adminWalletKeypair, // Payer
            adminATA.address, // Source ATA (admin's)
            recipientATA.address, // Destination ATA (recipient's)
            adminWalletKeypair.publicKey, // Source Owner (admin wallet)
            amount // Amount to transfer
        );
        console.log(`Transferred ${amount} tokens from admin to ${recipientPublicKey.toBase58()}. Tx: ${signature}`);
        return signature; // Return txSig string for audit trail
    } catch (error) {
        console.error("Error transferring Solana token:", error);
        return null;
    }
}

// Gets the balance of a specific token account
async function getTokenAccountBalance(tokenAccountPublicKey) {
    try {
        const accountInfo = await getAccount(connection, tokenAccountPublicKey, 'confirmed', TOKEN_PROGRAM_ID);
        return Number(accountInfo.amount); // Returns raw amount (e.g., 1_000_000_000 for 1 token if decimals is 9)
    } catch (error) {
        // If account does not exist, balance is 0
        if (error.message.includes('Account does not exist') || error.message.includes('could not find account')) {
            return 0;
        }
        console.error("Error getting token account balance:", error);
        return 0;
    }
}


// --- Middleware to protect routes (Firebase Authentication) ---
const protect = async (req, res, next) => {
    let idToken;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        idToken = req.headers.authorization.split(' ')[1];
        try {
            const decodedToken = await auth.verifyIdToken(idToken);
            req.user = decodedToken; // Attach decoded Firebase user data to the request
            next(); // Proceed to the next middleware or route handler
        } catch (error) {
            console.error("Firebase auth verification error (invalid/expired token):", error);
            return res.status(401).json({ message: 'Unauthorized: Invalid or expired token.' });
        }
    } else {
        return res.status(401).json({ message: 'Unauthorized: No token provided.' });
    }
};


// --- Cron Jobs & Scheduled Tasks ---


async function updateALLUsersOnlineStatus() {
    console.log('Cron job: Running updateALLUsersOnlineStatus...');
    try {
        // This cron job will check users who were marked online by Socket.IO but might have disconnected
        // without proper Socket.IO disconnect event (e.g., browser crash).
        // It sets users offline if their lastSeen is older than 5 minutes.
        const fiveMinutesAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 5 * 60 * 1000);

        const onlineUsersSnapshot = await db.collection('users')
            .where('isOnline', '==', true)
            .where('lastSeen', '<', fiveMinutesAgo) // Find users marked online but last seen long ago
            .get();

        const batch = db.batch();
        onlineUsersSnapshot.forEach(doc => {
            batch.update(doc.ref, {
                isOnline: false,
                lastSeen: admin.firestore.FieldValue.serverTimestamp() // Update lastSeen to now
            });
            console.log(`User ${doc.id} set offline by cron job.`);
        });
        await batch.commit();

        // After updating, broadcast the new online users list
        const currentOnlineUserIds = await getOnlineUserIds();
        io.emit('onlineUsersUpdate', currentOnlineUserIds);

        console.log('Online status cleanup complete.');
    } catch (error) {
        console.error('Error in cron updateALLUsersOnlineStatus:', error);
    }
}


// --- Platform Stats Aggregation ---
// This cron function ensures each category and game has "ggCoinsGathered", "ggCoinsDistributed", and "gamesPlayed" ONLY.
async function updatePlatformStatsAggregatedGGCoins() {
    console.log('Cron job: Running updatePlatformStatsAggregatedGGCoins...');
    try {
        const registeredUsersSnapshot = await db.collection('users').get();
        const registeredUsers = registeredUsersSnapshot.size;

        const statsDocRef = db.collection('platform').doc('stats');
        const statsDoc = await statsDocRef.get();

        // Default structure
        let currentStats = {
            registeredUsers,
            onlineUsers: 0,
            totalGamesPlayed: 0,
            totalGGCoinsDeposited: { allTime: 0, lastMonth: 0 },
            totalGGCoinsWithdrawn: { allTime: 0, lastMonth: 0 },
            totalGGCoinsGathered: { allTime: 0, lastMonth: 0 },
            totalGGCoinsDistributed: { allTime: 0, lastMonth: 0 },
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            currentMonthPeriod: new Date().getFullYear() + '-' + (new Date().getMonth() + 1).toString().padStart(2, '0'),
            lastMonthPeriod: new Date().getMonth() === 0 ? (new Date().getFullYear() - 1) + '-12' : new Date().getFullYear() + '-' + (new Date().getMonth()).toString().padStart(2, '0'),
            categories: {
                arcade: { ggCoinsGathered: { allTime: 0, lastMonth: 0 }, ggCoinsDistributed: { allTime: 0, lastMonth: 0 }, gamesPlayed: { allTime: 0, lastMonth: 0 }, games: [] },
                pvp:    { ggCoinsGathered: { allTime: 0, lastMonth: 0 }, ggCoinsDistributed: { allTime: 0, lastMonth: 0 }, gamesPlayed: { allTime: 0, lastMonth: 0 }, games: [] },
                casino: { ggCoinsGathered: { allTime: 0, lastMonth: 0 }, ggCoinsDistributed: { allTime: 0, lastMonth: 0 }, gamesPlayed: { allTime: 0, lastMonth: 0 }, games: [] },
                picker: { ggCoinsGathered: { allTime: 0, lastMonth: 0 }, ggCoinsDistributed: { allTime: 0, lastMonth: 0 }, gamesPlayed: { allTime: 0, lastMonth: 0 }, games: [] },
            },
            games: {}
        };

        if (statsDoc.exists) {
            Object.assign(currentStats, statsDoc.data());
        }

        const gamesSnapshot = await db.collection('games').get();
        let totalGamesPlayed = 0;
        let totalGamesPlayedLastMonth = 0;
        let totalGGCoinsGathered = 0;
        let totalGGCoinsGatheredLastMonth = 0;
        let totalGGCoinsDistributed = 0;
        let totalGGCoinsDistributedLastMonth = 0;
        let totalGGCoinsDeposited = currentStats.totalGGCoinsDeposited?.allTime ?? 0;
        let totalGGCoinsWithdrawn = currentStats.totalGGCoinsWithdrawn?.allTime ?? 0;

        const categoryKeys = Object.keys(currentStats.categories);

        categoryKeys.forEach(cat => {
            currentStats.categories[cat].ggCoinsGathered = { allTime: 0, lastMonth: 0 };
            currentStats.categories[cat].ggCoinsDistributed = { allTime: 0, lastMonth: 0 };
            currentStats.categories[cat].gamesPlayed = { allTime: 0, lastMonth: 0 };
            currentStats.categories[cat].games = [];
        });

        gamesSnapshot.forEach(gameDoc => {
            const g = gameDoc.data();
            const cat = (g.category || '').toLowerCase();
            if (!categoryKeys.includes(cat)) return;
            const catStats = currentStats.categories[cat];
            catStats.games.push(gameDoc.id);

            // Defensive: support both map and number
            const ggCoinsGathered = g.ggCoinsGathered ?? { allTime: 0, lastMonth: 0 };
            const ggCoinsDistributed = g.ggCoinsDistributed ?? { allTime: 0, lastMonth: 0 };
            catStats.ggCoinsGathered.allTime += ggCoinsGathered.allTime || 0;
            catStats.ggCoinsGathered.lastMonth += ggCoinsGathered.lastMonth || 0;
            catStats.ggCoinsDistributed.allTime += ggCoinsDistributed.allTime || 0;
            catStats.ggCoinsDistributed.lastMonth += ggCoinsDistributed.lastMonth || 0;

            // --- Games Played aggregation ---
            catStats.gamesPlayed.allTime += g.gamesPlayed?.allTime ?? 0;
            catStats.gamesPlayed.lastMonth += g.gamesPlayed?.lastMonth ?? 0;

            // --- Per-game stats for frontend ---
            currentStats.games[gameDoc.id] = {
                gameId: gameDoc.id,
                name: g.name ?? null,
                category: cat,
                playCost: g.playCost ?? null,
                ggCoinsGathered,
                ggCoinsDistributed,
                gamesPlayed: g.gamesPlayed ?? { allTime: 0, lastMonth: 0 },
                image: g.image ?? null,
                description: g.description ?? null,
            };

            totalGamesPlayed += g.gamesPlayed?.allTime ?? 0;
            totalGamesPlayedLastMonth += g.gamesPlayed?.lastMonth ?? 0;
            totalGGCoinsGathered += ggCoinsGathered.allTime || 0;
            totalGGCoinsGatheredLastMonth += ggCoinsGathered.lastMonth || 0;
            totalGGCoinsDistributed += ggCoinsDistributed.allTime || 0;
            totalGGCoinsDistributedLastMonth += ggCoinsDistributed.lastMonth || 0;
        });

        currentStats.totalGamesPlayed = totalGamesPlayed;
        currentStats.totalGGCoinsGathered = { allTime: totalGGCoinsGathered, lastMonth: totalGGCoinsGatheredLastMonth };
        currentStats.totalGGCoinsDistributed = { allTime: totalGGCoinsDistributed, lastMonth: totalGGCoinsDistributedLastMonth };
        currentStats.onlineUsers = (await getOnlineUserIds()).length;

        await statsDocRef.set(currentStats, { merge: true });
        console.log('Platform stats updated successfully in Firestore.');
    } catch (error) {
        console.error('Error updating platform stats:', error);
    }
}

// Cron job to aggregate platform stats every 30 minutes (or adjust as needed)
cron.schedule('*/30 * * * *', updatePlatformStatsAggregatedGGCoins);

// Monthly reset: zero out lastMonth counters on games and platform stats at midnight on the 1st
cron.schedule('0 0 1 * *', async () => {
    console.log('[monthlyReset] Resetting lastMonth counters...');
    try {
        const gamesSnapshot = await db.collection('games').get();
        const batch = db.batch();
        gamesSnapshot.forEach(gameDoc => {
            batch.update(gameDoc.ref, {
                'gamesPlayed.lastMonth': 0,
                'ggCoinsGathered.lastMonth': 0,
                'ggCoinsDistributed.lastMonth': 0,
            });
        });
        await batch.commit();

        const now = new Date();
        const currentMonth = now.getFullYear() + '-' + (now.getMonth() + 1).toString().padStart(2, '0');
        const lastMonth = now.getMonth() === 0
            ? (now.getFullYear() - 1) + '-12'
            : now.getFullYear() + '-' + now.getMonth().toString().padStart(2, '0');

        await db.collection('platform').doc('stats').update({
            'totalGGCoinsGathered.lastMonth': 0,
            'totalGGCoinsDistributed.lastMonth': 0,
            'categories.arcade.ggCoinsGathered.lastMonth': 0,
            'categories.arcade.ggCoinsDistributed.lastMonth': 0,
            'categories.arcade.gamesPlayed.lastMonth': 0,
            'categories.picker.ggCoinsGathered.lastMonth': 0,
            'categories.picker.ggCoinsDistributed.lastMonth': 0,
            'categories.picker.gamesPlayed.lastMonth': 0,
            'categories.pvp.ggCoinsGathered.lastMonth': 0,
            'categories.pvp.ggCoinsDistributed.lastMonth': 0,
            'categories.pvp.gamesPlayed.lastMonth': 0,
            'categories.casino.ggCoinsGathered.lastMonth': 0,
            'categories.casino.ggCoinsDistributed.lastMonth': 0,
            'categories.casino.gamesPlayed.lastMonth': 0,
            'currentMonthPeriod': currentMonth,
            'lastMonthPeriod': lastMonth,
        });
        console.log(`[monthlyReset] Done. New period: ${currentMonth}`);
    } catch (err) {
        console.error('[monthlyReset] Failed:', err);
    }
});

// Seed game definitions on startup (idempotent — skips existing docs)
async function seedGamesOnStartup() {
  const GAME_DEFINITIONS = [
    { gameId: 'whack-a-degen', name: 'Whack a Degen', category: 'arcade', playCost: 0.005, description: 'Whack degens for points — avoid bombs, grab power-ups!' },
    { gameId: 'degen-race', name: 'DegenRace', category: 'picker', playCost: 0.01, description: 'Pick your racer and watch them compete for the finish line.' },
    { gameId: 'degen-fighter', name: 'DegenFighter', category: 'pvp', playCost: 0.1, description: '1v1 fighting arena — chain combos and drain HP to win.' },
    { gameId: 'casino', name: 'Casino', category: 'casino', playCost: 0.01, description: 'Try your luck at the degen casino.' },
  ];
  try {
    for (const def of GAME_DEFINITIONS) {
      const ref = db.collection('games').doc(def.gameId);
      const existing = await ref.get();
      if (!existing.exists) {
        await ref.set({
          ...def,
          gamesPlayed: { allTime: 0, lastMonth: 0 },
          ggCoinsGathered: { allTime: 0, lastMonth: 0 },
          ggCoinsDistributed: { allTime: 0, lastMonth: 0 },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[seed] Created games/${def.gameId}`);
      }
    }
    console.log('[seed] Game definitions seeded.');
  } catch (e) {
    console.error('[seed] Failed to seed game definitions:', e);
  }
}

// Initial run for cron jobs on server start
seedGamesOnStartup();
updatePlatformStatsAggregatedGGCoins();

// --- API Routes ---

// Increment ggCoinsGathered for a game and category
app.post('/api/games/increment-ggcoins-gathered', protect, async (req, res) => {
  const { gameId, category, amount } = req.body;
  try {
    const incrementValue = Number(amount);
    if (isNaN(incrementValue) || incrementValue <= 0) {
      return res.status(400).json({ success: false, error: "Invalid amount" });
    }

    // Game doc — set+merge so it auto-creates if missing
    const gameRef = db.collection('games').doc(gameId);
    await gameRef.set({
      'ggCoinsGathered': {
        allTime: admin.firestore.FieldValue.increment(incrementValue),
        lastMonth: admin.firestore.FieldValue.increment(incrementValue),
      }
    }, { merge: true });

    // Platform stats doc — set+merge so it auto-creates if missing
    const statsRef = db.collection('platform').doc('stats');
    await statsRef.set({
      [`categories.${category}.ggCoinsGathered.allTime`]: admin.firestore.FieldValue.increment(incrementValue),
      [`categories.${category}.ggCoinsGathered.lastMonth`]: admin.firestore.FieldValue.increment(incrementValue),
      'totalGGCoinsGathered.allTime': admin.firestore.FieldValue.increment(incrementValue),
      'totalGGCoinsGathered.lastMonth': admin.firestore.FieldValue.increment(incrementValue)
    }, { merge: true });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error incrementing ggCoinsGathered:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Increment ggCoinsDistributed for a game and category
app.post('/api/games/increment-ggcoins-distributed', protect, async (req, res) => {
  const { gameId, category, amount } = req.body;
  try {
    const incrementValue = Number(amount);
    if (isNaN(incrementValue) || incrementValue <= 0) {
      return res.status(400).json({ success: false, error: "Invalid amount" });
    }

    // Game doc — set+merge so it auto-creates if missing
    const gameRef = db.collection('games').doc(gameId);
    await gameRef.set({
      'ggCoinsDistributed': {
        allTime: admin.firestore.FieldValue.increment(incrementValue),
        lastMonth: admin.firestore.FieldValue.increment(incrementValue),
      }
    }, { merge: true });

    // Platform stats doc — set+merge so it auto-creates if missing
    const statsRef = db.collection('platform').doc('stats');
    await statsRef.set({
      [`categories.${category}.ggCoinsDistributed.allTime`]: admin.firestore.FieldValue.increment(incrementValue),
      [`categories.${category}.ggCoinsDistributed.lastMonth`]: admin.firestore.FieldValue.increment(incrementValue),
      'totalGGCoinsDistributed.allTime': admin.firestore.FieldValue.increment(incrementValue),
      'totalGGCoinsDistributed.lastMonth': admin.firestore.FieldValue.increment(incrementValue)
    }, { merge: true });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error incrementing ggCoinsDistributed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Increment gamesPlayed for a game and category
app.post('/api/games/increment-games-played', protect, async (req, res) => {
  const { gameId, category } = req.body;
  try {
    // Game doc — auto-create with full definition if missing
    const gameRef = db.collection('games').doc(gameId);
    const gameDoc = await gameRef.get();
    if (!gameDoc.exists) {
      await gameRef.set({
        gameId,
        name: gameId,
        category,
        gamesPlayed: { allTime: 0, lastMonth: 0 },
        ggCoinsGathered: { allTime: 0, lastMonth: 0 },
        ggCoinsDistributed: { allTime: 0, lastMonth: 0 },
      });
    }
    await gameRef.update({
      'gamesPlayed.allTime': admin.firestore.FieldValue.increment(1),
      'gamesPlayed.lastMonth': admin.firestore.FieldValue.increment(1)
    });

    // Platform stats doc — set+merge so it auto-creates if missing
    const statsRef = db.collection('platform').doc('stats');
    await statsRef.set({
      'totalGamesPlayed': admin.firestore.FieldValue.increment(1),
      [`categories.${category}.gamesPlayed.allTime`]: admin.firestore.FieldValue.increment(1),
      [`categories.${category}.gamesPlayed.lastMonth`]: admin.firestore.FieldValue.increment(1)
    }, { merge: true });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error incrementing gamesPlayed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Seed games collection with all known game definitions (idempotent — only creates if doc missing)
app.post('/api/games/seed', protect, async (req, res) => {
  const GAME_DEFINITIONS = [
    { gameId: 'whack-a-degen', name: 'Whack a Degen', category: 'arcade', playCost: 0.005, description: 'Whack degens for points — avoid bombs, grab power-ups!' },
    { gameId: 'degen-race', name: 'DegenRace', category: 'picker', playCost: 0.01, description: 'Pick your racer and watch them compete for the finish line.' },
    { gameId: 'degen-fighter', name: 'DegenFighter', category: 'pvp', playCost: 0.1, description: '1v1 fighting arena — chain combos and drain HP to win.' },
    { gameId: 'casino', name: 'Casino', category: 'casino', playCost: 0.01, description: 'Try your luck at the degen casino.' },
  ];

  try {
    const results = [];
    for (const def of GAME_DEFINITIONS) {
      const ref = db.collection('games').doc(def.gameId);
      const doc = await ref.get();
      if (!doc.exists) {
        await ref.set({
          ...def,
          gamesPlayed: { allTime: 0, lastMonth: 0 },
          ggCoinsGathered: { allTime: 0, lastMonth: 0 },
          ggCoinsDistributed: { allTime: 0, lastMonth: 0 },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        results.push({ gameId: def.gameId, status: 'created' });
      } else {
        results.push({ gameId: def.gameId, status: 'exists' });
      }
    }
    res.status(200).json({ success: true, games: results });
  } catch (error) {
    console.error('Error seeding games:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Platform Stats (Public - no protect middleware)
app.get('/platform-stats', async (req, res) => {
    try {
        const statsDoc = await db.collection('platform').doc('stats').get();
        if (!statsDoc.exists) {
            return res.status(200).json({
                registeredUsers: 0,
                onlineUsers: 0,
                totalGamesPlayed: 0,
                totalGGCoinsDeposited: { allTime: 0, lastMonth: 0 },
                totalGGCoinsWithdrawn: { allTime: 0, lastMonth: 0 },
                totalGGCoinsGathered: { allTime: 0, lastMonth: 0 },
                totalGGCoinsDistributed: { allTime: 0, lastMonth: 0 },
                lastUpdated: null,
                currentMonthPeriod: new Date().getFullYear() + '-' + (new Date().getMonth() + 1).toString().padStart(2, '0'),
                lastMonthPeriod: new Date().getMonth() === 0 ? (new Date().getFullYear() - 1) + '-12' : new Date().getFullYear() + '-' + (new Date().getMonth()).toString().padStart(2, '0'),
                categories: {
                    arcade: { ggCoinsGathered: emptyStatsMap, ggCoinsDistributed: emptyStatsMap, gamesPlayed: emptyStatsMap, games: [] },
                    pvp: { ggCoinsGathered: emptyStatsMap, ggCoinsDistributed: emptyStatsMap, gamesPlayed: emptyStatsMap, games: [] },
                    casino: { ggCoinsGathered: emptyStatsMap, ggCoinsDistributed: emptyStatsMap, gamesPlayed: emptyStatsMap, games: [] },
                    picker: { ggCoinsGathered: emptyStatsMap, ggCoinsDistributed: emptyStatsMap, gamesPlayed: emptyStatsMap, games: [] },
                },
                games: {}
            });
        }
        res.status(200).json(statsDoc.data());
    } catch (error) {
        console.error('Error fetching platform stats:', error);
        res.status(500).json({ message: 'Failed to fetch platform stats.' });
    }
});


// --- API Routes ---

// Base route
app.get('/', (req, res) => {
    res.send('GG Web3 Backend is running!');
});

// User Registration (Public - no protect middleware)
app.get('/api/prices', async (req, res) => {
  // You can fetch price from coingecko or similar
  try {
    // Example with coingecko:
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = await response.json();
    const price = data.solana.usd;
    res.json({ solUsd: price });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch SOL price' });
  }
});

app.post('/register', async (req, res) => {
    const { email, password, username } = req.body;
    try {
        // Create user in Firebase Auth
        const userRecord = await auth.createUser({ email, password });

        // Create user profile in Firestore
        await db.collection('users').doc(userRecord.uid).set({
            username: username,
            usernameLowercase: username.toLowerCase(), // For case-insensitive search
            email: email,
            uid: userRecord.uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            avatarUrl: "/avatars/default.png", // Default avatar
            freeEntryTokens: { // Initialize free entry tokens
                arcade: 0,
                picker: 0,
                casino: 0,
                pvp: 0,
            },
            isOnline: false, // Default to false, Socket.IO handles live status
            lastSeen: null,  // Updated by Socket.IO
            friends: [],
            friendRequestsSent: [],
            friendRequestsReceived: [],
            // Add other default profile fields here
        });
        res.status(201).json({ message: 'User registered successfully!' });
    } catch (error) {
        console.error('Error registering user:', error);
        // Firebase Auth errors have specific codes
        let errorMessage = 'Failed to register user.';
        if (error.code === 'auth/email-already-in-use') {
            errorMessage = 'Email is already in use.';
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = 'Invalid email address.';
        } else if (error.code === 'auth/weak-password') {
            errorMessage = 'Password is too weak.';
        }
        res.status(400).json({ message: errorMessage, code: error.code });
    }
});

// User Login (Public - handled client-side by Firebase SDK, but keep for clarity/future extension)
app.post('/login', (req, res) => {
    res.status(200).json({ message: 'Login handled by Firebase client SDK. Backend route is a placeholder.' });
});

// Wallet Verification Endpoint (Solana Sign-In) - Public route, no `protect`
app.post("/verify-wallet", async (req, res) => {
    try {
        const { address, signedMessage, nonce } = req.body;

        if (!address || !signedMessage || !nonce) {
            return res.status(400).json({ error: "Missing parameters" });
        }

        // IMPORTANT: The message string MUST EXACTLY match what the frontend signs.
        const message = `Sign in to GG Web3 with this one-time code: ${nonce}`;
        const messageBytes = new TextEncoder().encode(message);

        let signatureBytes;
        try {
            signatureBytes = Buffer.from(signedMessage, 'base64');
        } catch (decodeError) {
            console.error("Failed to decode base64 signature:", decodeError);
            return res.status(400).json({ error: "Invalid signature format" });
        }

        const publicKey = new PublicKey(address);

        // Verify the signature using tweetnacl
        const verified = nacl.sign.detached.verify(
            messageBytes, // Original message bytes
            signatureBytes, // Signed message (signature) bytes
            publicKey.toBytes() // Public key bytes of the signer
        );

        if (!verified) {
            console.warn("Signature verification failed for address:", address);
            return res.status(400).json({ error: "Verification failed" });
        }

        // Use the raw Solana address as the Firebase UID for consistent mapping
        const firebaseUID = address;

        let userRecord;
        let isNewUser = false;
        try {
            // Try to get existing Firebase user
            userRecord = await auth.getUser(firebaseUID);
            console.log(`API (Public): Firebase Auth user found with raw Solana address as UID: ${firebaseUID}`);
        } catch (error) {
            // If user not found, create a new one
            if (error.code === 'auth/user-not-found') {
                console.log(`API (Public): Firebase Auth user for raw Solana address ${firebaseUID} not found. Creating new Firebase Auth user.`);
                userRecord = await auth.createUser({
                    uid: firebaseUID,
                    displayName: `Player_${address.substring(0, 4)}`, // Default display name
                });
                console.log(`New Firebase user created for Solana address: ${address} with UID: ${firebaseUID}`);

                // Create initial user profile in Firestore
                await db.collection('users').doc(firebaseUID).set({
                    uid: firebaseUID,
                    wallet: address, // Store the raw Solana address
                    username: `Player_${address.substring(0, 4)}`,
                    usernameLowercase: `player_${address.substring(0, 4)}`.toLowerCase(),
                    avatarUrl: '/avatars/default.png', // Default avatar URL
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    isOnline: true, // Set to true as they just logged in
                    lastSeen: admin.firestore.FieldValue.serverTimestamp(),
                    friends: [],
                    friendRequestsSent: [],
                    friendRequestsReceived: [],
                    freeEntryTokens: { arcade: 0, picker: 0, casino: 0, pvp: 0 },
                    // ... other default profile fields you need
                }, { merge: true }); // Use merge:true to ensure it doesn't overwrite if document somehow exists

                isNewUser = true;
            } else {
                console.error("API (Public): Unexpected Firebase Auth error during user lookup/creation:", error);
                throw error;
            }
        }

        // Create a custom Firebase token for the frontend to sign in
        const customToken = await auth.createCustomToken(firebaseUID, {
            solanaWalletAddress: address,
            isSolanaVerified: true,
        });

        res.status(200).json({ customToken, isNew: isNewUser });

    } catch (error) {
        console.error("Error in /verify-wallet:", error);
        res.status(500).json({ error: "Internal server error during wallet verification." });
    }
});


//Get USERS 
// Fetch all users for Picker onboarding (Protected)
app.get('/api/usernames', protect, async (req, res) => {
    try {
        const usersSnapshot = await db.collection('users').get();
        const users = [];
        usersSnapshot.forEach(doc => {
            const data = doc.data();
            users.push({
                key: doc.id,
                username: data.username || '',
                avatarUrl: data.avatarUrl || '',
                wallet: data.wallet || '',
            });
        });
        res.status(200).json(users);
    } catch (error) {
        console.error('Error fetching usernames:', error);
        res.status(500).json({ message: 'Failed to fetch usernames.' });
    }
});

// Get User Profile (Protected)
app.get('/profile', protect, async (req, res) => {
    try {
        const userRef = db.collection('users').doc(req.user.uid);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json(userDoc.data());
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ message: 'Failed to fetch profile' });
    }
});

// Update User Profile (Protected)
app.put('/profile', protect, async (req, res) => {
    const { username, avatarUrl, bio, dmsOpen, duelsOpen, twitter, discord, telegram, instagram } = req.body;
    try {
        const userRef = db.collection('users').doc(req.user.uid);
        const updateData = {};
        if (username !== undefined) updateData.username = username;
        if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
        if (bio !== undefined) updateData.bio = bio;
        if (dmsOpen !== undefined) updateData.dmsOpen = dmsOpen;
        if (duelsOpen !== undefined) updateData.duelsOpen = duelsOpen;
        if (twitter !== undefined) updateData.twitter = twitter;
        if (discord !== undefined) updateData.discord = discord;
        if (telegram !== undefined) updateData.telegram = telegram;
        if (instagram !== undefined) updateData.instagram = instagram;


        // Update usernameLowercase if username is being updated
        if (username !== undefined) {
            updateData.usernameLowercase = username.toLowerCase();
        }

        await userRef.update(updateData);
        res.status(200).json({ message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Error updating user profile:', error);
        res.status(500).json({ message: 'Failed to update profile' });
    }
});

// Get User Profile by UID (Protected - for fetching other users' profiles)
app.get('/users/:uid', protect, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.params.uid).get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: 'User not found' });
        }
        const userData = userDoc.data();
        // Optionally, filter sensitive data before sending:
        delete userData.email;
        delete userData.freeEntryTokens; // These are for the user themselves
        // ... and other internal fields
        res.status(200).json(userData);
    } catch (error) {
        console.error('Error fetching user by UID:', error);
        res.status(500).json({ message: 'Failed to fetch user data' });
    }
});

// Fetch all users for Picker onboarding (Protected)
app.get('/api/usernames', protect, async (req, res) => {
    try {
        const usersSnapshot = await db.collection('users').get();
        const users = [];
        usersSnapshot.forEach(doc => {
            const data = doc.data();
            users.push({
                key: doc.id,
                username: data.username || '',
                avatarUrl: data.avatarUrl || '',
                wallet: data.wallet || '',
            });
        });
        res.status(200).json(users);
    } catch (error) {
        console.error('Error fetching usernames:', error);
        res.status(500).json({ message: 'Failed to fetch usernames.' });
    }
});

// Get Free Entry Tokens (Protected)
app.get('/user/free-entry-tokens', protect, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: 'User not found' });
        }
        const userData = userDoc.data();
        res.status(200).json(userData.freeEntryTokens || { arcade: 0, picker: 0, casino: 0, pvp: 0 });
    } catch (error) {
        console.error('Error fetching free entry tokens:', error);
        res.status(500).json({ message: 'Failed to fetch free entry tokens.' });
    }
});

// CREATE SESSION TOKEN (Game Entry Token)
app.post('/api/picker/create-session', protect, async (req, res) => {
    const userId = req.user.uid;
    const { gameId, paymentSignature, currency } = req.body;

    try {
        // Compose new entry token doc
        const tokenDoc = {
            userId,
            category: "Picker",
            gameId,
            issuedAt: admin.firestore.FieldValue.serverTimestamp(),
            isConsumed: false,
            paymentCurrency: currency,
            paymentAmount: currency === "SOL" ? 0.01 : 0,
            txSig: paymentSignature || null,
        };
        // Add document to gameEntryTokens collection
        const docRef = await db.collection('gameEntryTokens').add(tokenDoc);

        // Track ggCoinsGathered for paid picker sessions
        if (currency === 'SOL') {
            const amount = 0.01; // picker play cost
            try {
                await db.collection('games').doc('degen-race').set({
                    'ggCoinsGathered': {
                        allTime: admin.firestore.FieldValue.increment(amount),
                        lastMonth: admin.firestore.FieldValue.increment(amount),
                    }
                }, { merge: true });
                await db.collection('platform').doc('stats').set({
                    'categories.picker.ggCoinsGathered.allTime': admin.firestore.FieldValue.increment(amount),
                    'categories.picker.ggCoinsGathered.lastMonth': admin.firestore.FieldValue.increment(amount),
                    'totalGGCoinsGathered.allTime': admin.firestore.FieldValue.increment(amount),
                    'totalGGCoinsGathered.lastMonth': admin.firestore.FieldValue.increment(amount),
                }, { merge: true });
            } catch (statsErr) {
                console.warn('[picker/create-session] Non-fatal: failed to update ggCoinsGathered:', statsErr.message);
            }
        }

        res.status(200).json({ gameEntryTokenId: docRef.id });
    } catch (error) {
        console.error("Error creating game entry token:", error);
        res.status(500).json({ message: "Failed to create game session token." });
    }
});

// VALIDATE SESSION TOKEN (Game Entry Token)
app.get('/api/picker/validate-session/:id', protect, async (req, res) => {
    const userId = req.user.uid;
    const tokenId = req.params.id;

    try {
        const docRef = db.collection('gameEntryTokens').doc(tokenId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
            return res.status(404).json({ valid: false, message: "Session token does not exist." });
        }
        const data = docSnap.data();
        if (data.isConsumed) {
            return res.status(400).json({ valid: false, message: "Session token already consumed." });
        }
        if (data.userId !== userId) {
            return res.status(403).json({ valid: false, message: "Session token does not belong to this user." });
        }
        // You can check more: category, gameId, etc.
        return res.status(200).json({ valid: true });
    } catch (error) {
        console.error("Error validating game entry token:", error);
        res.status(500).json({ valid: false, message: "Failed to validate session token." });
    }
});

// --- Update Free Entry Tokens (Generate) (Protected) ---
// Play cost lookup by category (SOL amounts used as ggCoinsGathered unit)
const PLAY_COST_BY_CATEGORY = {
    arcade: { cost: 0.005, defaultGameId: 'whack-a-degen' },
    picker: { cost: 0.01, defaultGameId: 'degen-race' },
    pvp:    { cost: 0.1, defaultGameId: 'degen-fighter' },
    casino: { cost: 0.01, defaultGameId: 'casino' },
};

app.post('/tokens/generate', protect, async (req, res) => {
    const userId = req.user.uid;
    const { tokenType, gameId } = req.body;

    if (!tokenType) {
        return res.status(400).json({ message: "Token type is required (e.g., 'arcade', 'picker', 'casino', 'pvp')." });
    }
    const validTokenTypes = ['arcade', 'picker', 'casino', 'pvp'];
    if (!validTokenTypes.includes(tokenType)) {
        return res.status(400).json({ message: `Invalid token type: ${tokenType}. Must be one of: ${validTokenTypes.join(', ')}.` });
    }
    try {
        await db.collection('users').doc(userId).update({
            [`freeEntryTokens.${tokenType}`]: admin.firestore.FieldValue.increment(1),
            [`freeEntryTokens.${tokenType}Tokens`]: admin.firestore.FieldValue.increment(1),
        });

        // Track ggCoinsGathered (SOL entry fee) — tokens/generate is only called on paid plays
        const playCostInfo = PLAY_COST_BY_CATEGORY[tokenType];
        if (playCostInfo) {
            const resolvedGameId = gameId || playCostInfo.defaultGameId;
            const amount = playCostInfo.cost;
            try {
                await db.collection('games').doc(resolvedGameId).set({
                    'ggCoinsGathered': {
                        allTime: admin.firestore.FieldValue.increment(amount),
                        lastMonth: admin.firestore.FieldValue.increment(amount),
                    }
                }, { merge: true });
                await db.collection('platform').doc('stats').set({
                    [`categories.${tokenType}.ggCoinsGathered.allTime`]: admin.firestore.FieldValue.increment(amount),
                    [`categories.${tokenType}.ggCoinsGathered.lastMonth`]: admin.firestore.FieldValue.increment(amount),
                    'totalGGCoinsGathered.allTime': admin.firestore.FieldValue.increment(amount),
                    'totalGGCoinsGathered.lastMonth': admin.firestore.FieldValue.increment(amount),
                }, { merge: true });
            } catch (statsErr) {
                console.warn(`[tokens/generate] Non-fatal: failed to update ggCoinsGathered:`, statsErr.message);
            }
        }

        res.status(200).json({ message: `Successfully added 1 ${tokenType} token.`, tokenType });
    } catch (error) {
        console.error(`Error generating ${tokenType} token for user ${userId}:`, error);
        res.status(500).json({ message: `Failed to generate ${tokenType} token.` });
    }
});

// --- Update Free Entry Tokens (Consume) (Protected) ---
app.post('/tokens/consume', protect, async (req, res) => {
    const userId = req.user.uid;
    const { tokenType } = req.body;
    const pluralKey = `${tokenType}Tokens`;
    try {
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            console.log("User profile not found for:", userId);
            return res.status(404).json({ message: "User profile not found." });
        }
        const currentTokens = userDoc.data().freeEntryTokens || {};
        console.log("TokenType:", tokenType, "PluralKey:", pluralKey, "CurrentTokens:", currentTokens);
        const available = currentTokens[pluralKey] || 0;
        console.log("Available tokens:", available);
        if (available <= 0) {
            console.log("No tokens available to consume.");
            return res.status(400).json({ message: `No ${tokenType} tokens available to consume.` });
        }
        await userRef.update({
            [`freeEntryTokens.${pluralKey}`]: admin.firestore.FieldValue.increment(-1)
        });
        console.log("Successfully consumed one token.");
        res.status(200).json({ message: `Successfully consumed 1 ${tokenType} token.`, tokenType });
    } catch (error) {
        console.error(`Error consuming ${tokenType} token for user ${userId}:`, error);
        res.status(500).json({ message: `Failed to consume ${tokenType} token.` });
    }
});

// Get Platform Stats (Public - no protect middleware)
app.get('/platform-stats', async (req, res) => {
    try {
        const statsDoc = await db.collection('platform').doc('stats').get(); // Assuming 'platform/stats'
        if (!statsDoc.exists) {
            return res.status(200).json({
                // Default structure if no stats exist yet
                registeredUsers: 0,
                onlineUsers: 0,
                totalGamesPlayed: 0,
                totalSolDistributed: 0,
                lastUpdated: null,
                currentMonthPeriod: new Date().getFullYear() + '-' + (new Date().getMonth() + 1).toString().padStart(2, '0'),
                lastMonthPeriod: new Date().getMonth() === 0 ? (new Date().getFullYear() - 1) + '-12' : new Date().getFullYear() + '-' + (new Date().getMonth()).toString().padStart(2, '0'),
                categories: {
                    arcade: { solTotal: 0, solLastMonth: 0, solDistributed: 0, solDistributedLastMonth: 0, playsTotal: 0, playsLastMonth: 0, games: [] },
                    pvp: { solTotal: 0, solLastMonth: 0, solDistributed: 0, solDistributedLastMonth: 0, playsTotal: 0, playsLastMonth: 0, games: [] },
                    casino: { solTotal: 0, solLastMonth: 0, solDistributed: 0, solDistributedLastMonth: 0, playsTotal: 0, playsLastMonth: 0, games: [] },
                    picker: { solTotal: 0, solLastMonth: 0, solDistributed: 0, solDistributedLastMonth: 0, playsTotal: 0, playsLastMonth: 0, games: [] },
                },
                games: {}
            });
        }
        res.status(200).json(statsDoc.data());
    } catch (error) {
        console.error('Error fetching platform stats:', error);
        res.status(500).json({ message: 'Failed to fetch platform stats.' });
    }
});


// Get currently online user UIDs (Public - no protect middleware)
app.get('/onlineUsers', async (req, res) => {
    try {
        const onlineUserIds = await getOnlineUserIds(); // Uses the helper function defined above
        res.json({ onlineUserIds });
    } catch (error) {
        console.error("Error fetching online users in API:", error);
        res.status(500).json({ message: "Failed to fetch online users." });
    }
});

// Increment solGathered for a game and category
app.post('/api/games/increment-sol-gathered', protect, async (req, res) => {
  const { gameId, category, amount } = req.body;
  const now = new Date();
  const lastMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  try {
    // Game doc
    const gameRef = db.collection('games').doc(gameId);
    await gameRef.update({
      'solGathered.allTime': admin.firestore.FieldValue.increment(amount),
      'solGathered.lastMonth': admin.firestore.FieldValue.increment(amount)
    });

    // Platform stats doc
    const statsRef = db.collection('platform').doc('stats');
    await statsRef.update({
      [`categories.${category}.solGathered.allTime`]: admin.firestore.FieldValue.increment(amount),
      [`categories.${category}.solGathered.lastMonth`]: admin.firestore.FieldValue.increment(amount)
    });

    res.status(200).json({ success: true });
    // Optionally, emit socket.io update to all clients here!
  } catch (error) {
    console.error('Error incrementing solGathered:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// NOTE: duplicate increment-games-played route removed — primary definition is above (near line 586)

app.post('/api/games/increment-sol-gathered', protect, async (req, res) => {
  const { gameId, category, amount } = req.body; // amount in SOL
  try {
    // Defensive: ensure amount is a number
    const incrementValue = Number(amount);
    if (isNaN(incrementValue) || incrementValue <= 0) {
      return res.status(400).json({ success: false, error: "Invalid amount" });
    }

    // Increment game doc
    const gameRef = db.collection('games').doc(gameId);
    await gameRef.update({
      'solGathered.allTime': admin.firestore.FieldValue.increment(incrementValue),
      'solGathered.lastMonth': admin.firestore.FieldValue.increment(incrementValue)
    });

    // Increment category in platform stats doc
    const statsRef = db.collection('platform').doc('stats');
    await statsRef.update({
      [`categories.${category}.solGathered.allTime`]: admin.firestore.FieldValue.increment(incrementValue),
      [`categories.${category}.solGathered.lastMonth`]: admin.firestore.FieldValue.increment(incrementValue)
    });

    res.status(200).json({ success: true });
    // Optionally: Emit socket.io event for live updates here!
  } catch (error) {
    console.error('Error incrementing solGathered:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// Game and Category Routes (Protected)
app.get('/games', protect, async (req, res) => {
    try {
        const gamesRef = db.collection('games');
        const snapshot = await gamesRef.get();

        if (snapshot.empty) {
            return res.status(200).json([]);
        }
        const games = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        res.status(200).json(games);
    } catch (error) {
        console.error("Error fetching games:", error);
        res.status(500).json({ message: "Failed to fetch games.", error: error.message });
    }
});

app.get('/categories', protect, async (req, res) => {
    try {
        const categoriesRef = db.collection('categories');
        const snapshot = await categoriesRef.get();

        if (snapshot.empty) {
            return res.status(200).json([]);
        }
        const categories = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        res.status(200).json(categories);
    } catch (error) {
        console.error("Error fetching categories:", error);
        res.status(500).json({ message: "Failed to fetch categories.", error: error.message });
    }
});


// Solana Game Play (Protected)
app.post('/play', protect, async (req, res) => {
    const userId = req.user.uid;
    const { gameId, wagerAmount, prediction } = req.body; // wagerAmount should be in native token units (e.g., lamports)

    try {
        const userDoc = await getUserDocRef(userId).get();
        if (!userDoc.exists || !userDoc.data().wallet) {
            return res.status(400).send('User or Solana wallet address is not linked.');
        }
        const userSolanaAddress = new PublicKey(userDoc.data().wallet);

        if (!adminWalletKeypair || !gameTokenMint) {
            return res.status(500).send('Server wallet or token mint not initialized.');
        }

        // Ensure ATAs exist
        const userATA = await getOrCreateAssociatedTokenAccount(
            connection,
            adminWalletKeypair, // Payer
            gameTokenMint,
            userSolanaAddress // Owner of ATA
        );
        const adminATA = await getOrCreateAssociatedTokenAccount(
            connection,
            adminWalletKeypair, // Payer
            gameTokenMint,
            adminWalletKeypair.publicKey // Owner of ATA
        );

        const userTokenBalance = await getTokenAccountBalance(userATA.address);
        if (userTokenBalance < wagerAmount) {
            return res.status(400).json({ error: 'Insufficient token balance for wager.' });
        }

        // Create a Solana transaction for the token transfer
        // Note: The frontend will sign this transaction, not the backend.
        const transaction = new Transaction().add(
            transfer(
                userATA.address, // Source (user's ATA)
                adminATA.address, // Destination (admin's ATA)
                userSolanaAddress, // Owner of the source ATA (user's public key)
                wagerAmount // Amount to transfer
            )
        );
        // Set fee payer and recent blockhash for the transaction
        transaction.feePayer = userSolanaAddress;
        transaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;

        // Serialize the transaction to send to the frontend for signing
        const serializedTransaction = transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');

        // Store initial game state in Firestore
        await db.collection('games').doc(gameId).set({
            gameId,
            userId,
            wagerAmount,
            prediction,
            status: 'pending_transaction', // Game status while waiting for transaction
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            userSolanaAddress: userSolanaAddress.toBase58()
        }, { merge: true });

        console.log(`User ${userId} placed wager of ${wagerAmount / (10 ** GAME_TOKEN_DECIMALS)} in game ${gameId}`);
        // Respond with success and the serialized transaction for frontend signing
        res.json({ success: true, message: 'Game initiated, please sign transaction.', transaction: serializedTransaction });

    } catch (error) {
        console.error("Error initiating play:", error);
        res.status(500).send('Failed to initiate play');
    }
});

// Updates game state after a Solana transaction is confirmed (Protected)
app.post('/game-state-update', protect, async (req, res) => {
    const userId = req.user.uid;
    const { gameId, transactionSignature, status } = req.body;

    try {
        // Confirm the Solana transaction (server-side confirmation for security)
        const confirmation = await connection.confirmTransaction(transactionSignature, 'confirmed');
        if (confirmation.value.err) {
            console.error("Transaction failed on Solana:", confirmation.value.err);
            await db.collection('games').doc(gameId).update({ status: 'failed_wager', transactionError: confirmation.value.err.toString() });
            return res.status(400).send('Solana transaction failed or was not confirmed.');
        }

        // Update game state in Firestore with transaction details
        await db.collection('games').doc(gameId).update({
            status: status,
            transactionSignature: transactionSignature,
            confirmedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`Game ${gameId} status updated to ${status} by user ${userId}`);
        res.status(200).send('Game state updated.');
    } catch (error) {
        console.error("Error updating game state:", error);
        res.status(500).send('Failed to update game state.');
    }
});

// Reward processing (Protected)
app.post('/process-reward', protect, async (req, res) => {
    const userId = req.user.uid;
    const { gameId, amount, isWinnerClaim = false } = req.body; // amount should be in native units (lamports)

    try {
        // This function would contain your game-specific logic for distributing rewards.
        // For now, it's a placeholder that mimics your previous `processReward` function.

        if (!adminWalletKeypair || !gameTokenMint) {
            return res.status(500).send('Server wallet or token mint not initialized.');
        }

        const gameDocRef = db.collection('games').doc(gameId);
        const gameDoc = await gameDocRef.get();
        if (!gameDoc.exists) throw new Error('Game not found.');

        const gameData = gameDoc.data();
        let recipientSolanaAddress;

        if (isWinnerClaim) {
            // Logic for a winner claiming their specific reward
            if (gameData.winnerId !== userId || gameData.status !== 'completed_winnings' || gameData.claimed) {
                return res.status(400).json({ message: 'Not eligible to claim reward for this game or already claimed.' });
            }
            const userDoc = await getUserDocRef(userId).get();
            if (!userDoc.exists || !userDoc.data().wallet) {
                return res.status(400).json({ message: 'User Solana wallet address not found for claiming.' });
            }
            recipientSolanaAddress = new PublicKey(userDoc.data().wallet);
        } else {
            // General collection (e.g., by admin or a system process)
            // This is more complex and depends on your game's economy.
            // For simplicity, if not a winner claim, assume it's for the current user's wallet.
            const userDoc = await getUserDocRef(userId).get();
            if (userDoc.exists && userDoc.data().wallet) {
                recipientSolanaAddress = new PublicKey(userDoc.data().wallet);
            } else {
                return res.status(400).json({ message: 'User Solana wallet address not found for general reward.' });
            }
        }

        const transferSuccess = await transferSolanaToken(recipientSolanaAddress, amount);
        if (!transferSuccess) {
            return res.status(500).json({ message: 'Failed to transfer Solana tokens for reward.' });
        }

        // Update game state (e.g., mark as claimed/rewarded)
        if (isWinnerClaim) {
            await gameDocRef.update({
                claimed: true,
                claimedAt: admin.firestore.FieldValue.serverTimestamp(),
                status: 'claimed', // Update status to reflect claiming
            });
            console.log(`Winner's reward of ${amount / (10 ** GAME_TOKEN_DECIMALS)} tokens claimed by ${userId} for game ${gameId}`);
        } else {
            await gameDocRef.update({
                [`collectedBy.${userId}`]: admin.firestore.FieldValue.serverTimestamp(), // Mark as collected by user
                status: 'rewarded', // General rewarded status
            });
            console.log(`General reward of ${amount / (10 ** GAME_TOKEN_DECIMALS)} tokens collected by ${userId} for game ${gameId}`);
        }

        res.status(200).json({ success: true, message: 'Reward processed successfully!' });

    } catch (error) {
        console.error("Error in /process-reward endpoint:", error);
        res.status(500).json({ message: error.message || 'Internal server error during reward processing.' });
    }
});


// --- Game Payout Constants ---
const ARCADE_COIN_VALUE = 1_000_000;        // 0.001 GGW per arcade coin (raw units, 9 decimals)
const PICKER_WIN_REWARD = 5_000_000_000;    // 5 GGW tokens for correctly picking a race winner
const MIN_ARCADE_PAYOUT_SCORE = 50;         // Minimum score to qualify for arcade payout

// In-memory per-user rate limit: userId → last payout timestamp (ms)
const payoutRateLimitMap = new Map();
const PAYOUT_RATE_LIMIT_MS = 30_000; // 30 seconds between payout requests per user

// POST /api/arcade/claim-payout (Protected)
// Called after WhackADegen ends. Transfers GGW tokens based on final score.
app.post('/api/arcade/claim-payout', protect, async (req, res) => {
    const userId = req.user.uid;
    const { gameSessionId, score } = req.body;

    if (!gameSessionId || typeof score !== 'number' || score < 0) {
        return res.status(400).json({ message: 'gameSessionId and a valid score are required.' });
    }
    if (score < MIN_ARCADE_PAYOUT_SCORE) {
        return res.status(200).json({
            success: false, qualified: false,
            message: `Score must be at least ${MIN_ARCADE_PAYOUT_SCORE} to qualify for a payout.`
        });
    }

    // Rate limiting
    const lastPayout = payoutRateLimitMap.get(userId);
    if (lastPayout && (Date.now() - lastPayout) < PAYOUT_RATE_LIMIT_MS) {
        return res.status(429).json({ message: 'Too many payout requests. Please wait before claiming again.' });
    }

    try {
        // Duplicate prevention: one payout per gameSessionId per user
        const existingPayout = await db.collection('payouts')
            .where('gameSessionId', '==', gameSessionId)
            .where('userId', '==', userId)
            .limit(1)
            .get();
        if (!existingPayout.empty) {
            return res.status(409).json({ message: 'Payout already claimed for this game session.' });
        }

        // Resolve user wallet
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists || !userDoc.data().wallet) {
            return res.status(400).json({ message: 'No Solana wallet linked. Connect a wallet to claim payouts.' });
        }
        const recipientPublicKey = new PublicKey(userDoc.data().wallet);

        const coinsEarned = Math.floor(score / 10);
        const rawAmount = coinsEarned * ARCADE_COIN_VALUE;
        if (rawAmount <= 0) {
            return res.status(200).json({ success: false, qualified: false, message: 'Score too low for token payout.', coinsEarned });
        }

        // Treasury balance check
        if (adminWalletKeypair && gameTokenMint) {
            try {
                const adminATA = await getOrCreateAssociatedTokenAccount(
                    connection, adminWalletKeypair, gameTokenMint, adminWalletKeypair.publicKey
                );
                const treasuryBalance = await getTokenAccountBalance(adminATA.address);
                if (treasuryBalance < rawAmount) {
                    console.error(`[ArcadePayout] Insufficient treasury. Have: ${treasuryBalance}, need: ${rawAmount}`);
                    return res.status(503).json({ message: 'Treasury temporarily low. Please try again later.' });
                }
            } catch (balErr) {
                console.warn('[ArcadePayout] Could not verify treasury balance:', balErr.message);
            }
        }

        const transferSuccess = await transferSolanaToken(recipientPublicKey, rawAmount);
        if (!transferSuccess) {
            return res.status(500).json({ message: 'Token transfer failed. Please try again.' });
        }

        payoutRateLimitMap.set(userId, Date.now());

        // Audit log in Firestore
        await db.collection('payouts').add({
            gameSessionId,
            userId,
            gameId: 'whack-a-degen',
            category: 'arcade',
            score,
            coinsEarned,
            amount: rawAmount,
            currency: 'GGW',
            type: 'payout',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Update per-game doc + platform stats (non-fatal)
        try {
            await db.collection('games').doc('whack-a-degen').set({
                'ggCoinsDistributed': {
                    allTime: admin.firestore.FieldValue.increment(coinsEarned),
                    lastMonth: admin.firestore.FieldValue.increment(coinsEarned),
                }
            }, { merge: true });
            await db.collection('platform').doc('stats').update({
                'totalGGCoinsDistributed.allTime': admin.firestore.FieldValue.increment(coinsEarned),
                'totalGGCoinsDistributed.lastMonth': admin.firestore.FieldValue.increment(coinsEarned),
                'categories.arcade.ggCoinsDistributed.allTime': admin.firestore.FieldValue.increment(coinsEarned),
                'categories.arcade.ggCoinsDistributed.lastMonth': admin.firestore.FieldValue.increment(coinsEarned),
            });
        } catch (statsErr) {
            console.warn('[ArcadePayout] Non-fatal: failed to update stats:', statsErr.message);
        }

        console.log(`[ArcadePayout] ${userId} claimed ${coinsEarned} GGW coins (score ${score}). Session: ${gameSessionId}`);
        res.status(200).json({ success: true, qualified: true, coinsEarned, rawAmount });

    } catch (error) {
        console.error('[ArcadePayout] Error:', error);
        res.status(500).json({ message: error.message || 'Internal server error during payout.' });
    }
});

// POST /api/picker/claim-payout (Protected)
// Called after DegenRace ends. Pays out winner's backer if their pick won.
app.post('/api/picker/claim-payout', protect, async (req, res) => {
    const userId = req.user.uid;
    const { sessionId, chosenPlayerKey, winnerKey } = req.body;

    if (!sessionId || !chosenPlayerKey || !winnerKey) {
        return res.status(400).json({ message: 'sessionId, chosenPlayerKey, and winnerKey are required.' });
    }

    // Rate limiting (separate key space from arcade)
    const rlKey = `picker_${userId}`;
    const lastPayout = payoutRateLimitMap.get(rlKey);
    if (lastPayout && (Date.now() - lastPayout) < PAYOUT_RATE_LIMIT_MS) {
        return res.status(429).json({ message: 'Too many payout requests. Please wait before claiming again.' });
    }

    try {
        // Validate session token
        const sessionRef = db.collection('gameEntryTokens').doc(sessionId);
        const sessionDoc = await sessionRef.get();
        if (!sessionDoc.exists) {
            return res.status(404).json({ message: 'Game session not found.' });
        }
        const sessionData = sessionDoc.data();
        if (sessionData.userId !== userId) {
            return res.status(403).json({ message: 'Session does not belong to this user.' });
        }
        if (sessionData.payoutClaimed) {
            return res.status(409).json({ message: 'Payout already claimed for this session.' });
        }

        const isWinner = (chosenPlayerKey === winnerKey);

        if (!isWinner) {
            // Mark completed with no payout
            await sessionRef.update({
                payoutClaimed: true,
                payoutClaimedAt: admin.firestore.FieldValue.serverTimestamp(),
                isWinner: false,
            });
            return res.status(200).json({
                success: true, isWinner: false,
                message: "Your pick didn't win this race. Better luck next time!"
            });
        }

        // Resolve user wallet
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists || !userDoc.data().wallet) {
            return res.status(400).json({ message: 'No Solana wallet linked. Connect a wallet to claim payouts.' });
        }
        const recipientPublicKey = new PublicKey(userDoc.data().wallet);

        // Treasury balance check
        if (adminWalletKeypair && gameTokenMint) {
            try {
                const adminATA = await getOrCreateAssociatedTokenAccount(
                    connection, adminWalletKeypair, gameTokenMint, adminWalletKeypair.publicKey
                );
                const treasuryBalance = await getTokenAccountBalance(adminATA.address);
                if (treasuryBalance < PICKER_WIN_REWARD) {
                    console.error(`[PickerPayout] Insufficient treasury. Have: ${treasuryBalance}, need: ${PICKER_WIN_REWARD}`);
                    return res.status(503).json({ message: 'Treasury temporarily low. Please try again later.' });
                }
            } catch (balErr) {
                console.warn('[PickerPayout] Could not verify treasury balance:', balErr.message);
            }
        }

        const transferSuccess = await transferSolanaToken(recipientPublicKey, PICKER_WIN_REWARD);
        if (!transferSuccess) {
            return res.status(500).json({ message: 'Token transfer failed. Please try again.' });
        }

        payoutRateLimitMap.set(rlKey, Date.now());

        // Mark session as claimed
        await sessionRef.update({
            payoutClaimed: true,
            payoutClaimedAt: admin.firestore.FieldValue.serverTimestamp(),
            isWinner: true,
            payoutAmount: PICKER_WIN_REWARD,
        });

        // Audit log
        const pickerRewardDisplay = PICKER_WIN_REWARD / 1_000_000_000;
        await db.collection('payouts').add({
            sessionId,
            userId,
            gameId: 'degen-race',
            category: 'picker',
            chosenPlayerKey,
            winnerKey,
            amount: PICKER_WIN_REWARD,
            currency: 'GGW',
            txSig,
            type: 'payout',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Per-user transaction history for audit trail
        await db.collection('users').doc(userId).collection('transactions').add({
            sessionId,
            gameId: 'degen-race',
            category: 'picker',
            type: 'payout',
            amount: PICKER_WIN_REWARD,
            currency: 'GGW',
            txSig,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Update per-game doc + platform stats (non-fatal)
        try {
            await db.collection('games').doc('degen-race').set({
                'ggCoinsDistributed': {
                    allTime: admin.firestore.FieldValue.increment(pickerRewardDisplay),
                    lastMonth: admin.firestore.FieldValue.increment(pickerRewardDisplay),
                }
            }, { merge: true });
            await db.collection('platform').doc('stats').update({
                'totalGGCoinsDistributed.allTime': admin.firestore.FieldValue.increment(pickerRewardDisplay),
                'totalGGCoinsDistributed.lastMonth': admin.firestore.FieldValue.increment(pickerRewardDisplay),
                'categories.picker.ggCoinsDistributed.allTime': admin.firestore.FieldValue.increment(pickerRewardDisplay),
                'categories.picker.ggCoinsDistributed.lastMonth': admin.firestore.FieldValue.increment(pickerRewardDisplay),
            });
        } catch (statsErr) {
            console.warn('[PickerPayout] Non-fatal: failed to update stats:', statsErr.message);
        }

        console.log(`[PickerPayout] ${userId} won picker race. Session: ${sessionId}. Payout: ${PICKER_WIN_REWARD} raw GGW. Tx: ${txSig}`);
        res.status(200).json({ success: true, isWinner: true, reward: PICKER_WIN_REWARD, txSig });

    } catch (error) {
        console.error('[PickerPayout] Error:', error);
        res.status(500).json({ message: error.message || 'Internal server error during picker payout.' });
    }
});



// POST /api/pvp/claim-payout (Protected)
// Called after a DegenFighter match ends. Pays GGW tokens to the winner.
// Uses a server-generated matchSessionId for dedup — client cannot spoof win results.
const PVP_WIN_REWARD = 10_000_000_000; // 10 GGW tokens for winning a PvP match (raw units, 9 decimals)

app.post('/api/pvp/claim-payout', protect, async (req, res) => {
    const userId = req.user.uid;
    const { matchSessionId, won, score } = req.body;

    if (!matchSessionId || typeof won !== 'boolean' || typeof score !== 'number') {
        return res.status(400).json({ message: 'matchSessionId, won (boolean), and score (number) are required.' });
    }

    // Rate limiting (separate key space from arcade/picker)
    const rlKey = `pvp_${userId}`;
    const lastPayout = payoutRateLimitMap.get(rlKey);
    if (lastPayout && (Date.now() - lastPayout) < PAYOUT_RATE_LIMIT_MS) {
        return res.status(429).json({ message: 'Too many payout requests. Please wait before claiming again.' });
    }

    try {
        // Dedup: one payout claim per matchSessionId per user
        const existingPayout = await db.collection('payouts')
            .where('matchSessionId', '==', matchSessionId)
            .where('userId', '==', userId)
            .limit(1)
            .get();
        if (!existingPayout.empty) {
            return res.status(409).json({ message: 'Payout already claimed for this match session.' });
        }

        // Mark session as claimed regardless of win/loss so we always store the result
        if (!won) {
            // Record the loss in per-user history but pay nothing
            await db.collection('users').doc(userId).collection('transactions').add({
                matchSessionId,
                gameId: 'degen-fighter',
                category: 'pvp',
                type: 'match_loss',
                score,
                amount: 0,
                currency: 'GGW',
                txSig: null,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });
            return res.status(200).json({ success: true, won: false, reward: 0 });
        }

        // Resolve user wallet
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists || !userDoc.data().wallet) {
            return res.status(400).json({ message: 'No Solana wallet linked. Connect a wallet to claim payouts.' });
        }
        const recipientPublicKey = new PublicKey(userDoc.data().wallet);

        // Treasury balance check (non-fatal if admin wallet not configured)
        if (adminWalletKeypair && gameTokenMint) {
            try {
                const adminATA = await getOrCreateAssociatedTokenAccount(
                    connection, adminWalletKeypair, gameTokenMint, adminWalletKeypair.publicKey
                );
                const treasuryBalance = await getTokenAccountBalance(adminATA.address);
                if (treasuryBalance < PVP_WIN_REWARD) {
                    console.error(`[PvPPayout] Insufficient treasury. Have: ${treasuryBalance}, need: ${PVP_WIN_REWARD}`);
                    return res.status(503).json({ message: 'Treasury temporarily low. Please try again later.' });
                }
            } catch (balErr) {
                console.warn('[PvPPayout] Could not verify treasury balance:', balErr.message);
            }
        }

        const txSig = await transferSolanaToken(recipientPublicKey, PVP_WIN_REWARD);
        if (!txSig) {
            return res.status(500).json({ message: 'Token transfer failed. Please try again.' });
        }

        payoutRateLimitMap.set(rlKey, Date.now());

        // Global audit log
        await db.collection('payouts').add({
            matchSessionId,
            userId,
            gameId: 'degen-fighter',
            category: 'pvp',
            score,
            amount: PVP_WIN_REWARD,
            currency: 'GGW',
            txSig,
            type: 'payout',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Per-user transaction history for audit trail
        await db.collection('users').doc(userId).collection('transactions').add({
            matchSessionId,
            gameId: 'degen-fighter',
            category: 'pvp',
            type: 'payout',
            score,
            amount: PVP_WIN_REWARD,
            currency: 'GGW',
            txSig,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Update platform stats (non-fatal)
        const pvpRewardDisplay = PVP_WIN_REWARD / 1_000_000_000;
        try {
            await db.collection('platform').doc('stats').update({
                'totalGGCoinsDistributed.allTime': admin.firestore.FieldValue.increment(pvpRewardDisplay),
                'totalGGCoinsDistributed.lastMonth': admin.firestore.FieldValue.increment(pvpRewardDisplay),
                'categories.pvp.ggCoinsDistributed.allTime': admin.firestore.FieldValue.increment(pvpRewardDisplay),
                'categories.pvp.ggCoinsDistributed.lastMonth': admin.firestore.FieldValue.increment(pvpRewardDisplay),
            });
        } catch (statsErr) {
            console.warn('[PvPPayout] Non-fatal: failed to update platform stats:', statsErr.message);
        }

        console.log(`[PvPPayout] ${userId} won PvP match (score ${score}). Session: ${matchSessionId}. Reward: ${PVP_WIN_REWARD} raw GGW. Tx: ${txSig}`);
        res.status(200).json({ success: true, won: true, reward: PVP_WIN_REWARD, txSig });

    } catch (error) {
        console.error('[PvPPayout] Error:', error);
        res.status(500).json({ message: error.message || 'Internal server error during PvP payout.' });
    }
});


// --- Friend System Routes (Protected) ---
app.post('/friend-request/send', protect, async (req, res) => {
    const { targetUsername } = req.body;
    const currentUserId = req.user.uid;

    if (!targetUsername) {
        return res.status(400).json({ message: 'Target username is required.' });
    }

    try {
        const usersRef = db.collection('users');
        // Find target user by username (case-insensitive search)
        const targetUserQuery = await usersRef.where('usernameLowercase', '==', targetUsername.toLowerCase()).limit(1).get();

        if (targetUserQuery.empty) {
            return res.status(404).json({ message: 'Target user not found.' });
        }

        const targetUserDoc = targetUserQuery.docs[0];
        const targetUserId = targetUserDoc.id;

        if (currentUserId === targetUserId) {
            return res.status(400).json({ message: 'Cannot send friend request to yourself.' });
        }

        const currentUserDoc = await usersRef.doc(currentUserId).get();
        const currentUserData = currentUserDoc.data();

        // Check if already friends
        if (currentUserData.friends && currentUserData.friends.includes(targetUserId)) {
            return res.status(400).json({ message: 'You are already friends with this user.' });
        }
        // Check if request already sent
        if (currentUserData.friendRequestsSent && currentUserData.friendRequestsSent.includes(targetUserId)) {
            return res.status(400).json({ message: 'Friend request already sent.' });
        }
        // Check if target has already sent a request to current user (mutual request = accept)
        if (currentUserData.friendRequestsReceived && currentUserData.friendRequestsReceived.includes(targetUserId)) {
            const batch = db.batch();
            // Add to friends lists
            batch.update(usersRef.doc(currentUserId), {
                friends: admin.firestore.FieldValue.arrayUnion(targetUserId),
                friendRequestsReceived: admin.firestore.FieldValue.arrayRemove(targetUserId) // Remove from received
            });
            batch.update(usersRef.doc(targetUserId), {
                friends: admin.firestore.FieldValue.arrayUnion(currentUserId),
                friendRequestsSent: admin.firestore.FieldValue.arrayRemove(currentUserId) // Remove from sent
            });
            await batch.commit();
            console.log(`Friend request from ${targetUserId} to ${currentUserId} auto-accepted.`);
            return res.status(200).json({ message: 'Friend request accepted and you are now friends!' });
        }

        // Send new friend request
        const batch = db.batch();
        batch.update(usersRef.doc(currentUserId), {
            friendRequestsSent: admin.firestore.FieldValue.arrayUnion(targetUserId)
        });
        batch.update(usersRef.doc(targetUserId), {
            friendRequestsReceived: admin.firestore.FieldValue.arrayUnion(currentUserId)
        });
        await batch.commit();

        res.status(200).json({ message: 'Friend request sent successfully.' });

    } catch (error) {
        console.error('Error sending friend request:', error);
        res.status(500).json({ message: 'Failed to send friend request.' });
    }
});

app.post('/friend-request/accept', protect, async (req, res) => {
    const { senderId } = req.body; // ID of the user who sent the request
    const currentUserId = req.user.uid; // ID of the user accepting the request

    if (!senderId) {
        return res.status(400).json({ message: 'Sender ID is required.' });
    }

    try {
        const usersRef = db.collection('users');
        const batch = db.batch();

        // Update current user's document
        batch.update(usersRef.doc(currentUserId), {
            friends: admin.firestore.FieldValue.arrayUnion(senderId), // Add sender to friends
            friendRequestsReceived: admin.firestore.FieldValue.arrayRemove(senderId) // Remove from received requests
        });

        // Update sender's document
        batch.update(usersRef.doc(senderId), {
            friends: admin.firestore.FieldValue.arrayUnion(currentUserId), // Add current user to sender's friends
            friendRequestsSent: admin.firestore.FieldValue.arrayRemove(currentUserId) // Remove current user from sender's sent requests
        });

        await batch.commit();
        res.status(200).json({ message: 'Friend request accepted.' });

    } catch (error) {
        console.error('Error accepting friend request:', error);
        res.status(500).json({ message: 'Failed to accept friend request.' });
    }
});

app.post('/friend-request/reject', protect, async (req, res) => {
    const { senderId } = req.body; // ID of the user who sent the request
    const currentUserId = req.user.uid; // ID of the user rejecting the request

    if (!senderId) {
        return res.status(400).json({ message: 'Sender ID is required.' });
    }

    try {
        const usersRef = db.collection('users');
        const batch = db.batch();

        // Update current user's document
        batch.update(usersRef.doc(currentUserId), {
            friendRequestsReceived: admin.firestore.FieldValue.arrayRemove(senderId) // Remove from received requests
        });

        // Update sender's document
        batch.update(usersRef.doc(senderId), {
            friendRequestsSent: admin.firestore.FieldValue.arrayRemove(currentUserId) // Remove current user from sender's sent requests
        });

        await batch.commit();
        res.status(200).json({ message: 'Friend request rejected.' });

    } catch (error) {
        console.error('Error rejecting friend request:', error);
        res.status(500).json({ message: 'Failed to reject friend request.' });
    }
});

app.post('/friends/remove', protect, async (req, res) => {
    const { friendId } = req.body;
    const currentUserId = req.user.uid;

    if (!friendId) {
        return res.status(400).json({ message: 'Friend ID is required.' });
    }

    try {
        const usersRef = db.collection('users');
        const batch = db.batch();

        // Remove friend from current user's friends list
        batch.update(usersRef.doc(currentUserId), {
            friends: admin.firestore.FieldValue.arrayRemove(friendId)
        });

        // Remove current user from friend's friends list
        batch.update(usersRef.doc(friendId), {
            friends: admin.firestore.FieldValue.arrayRemove(currentUserId)
        });

        await batch.commit();
        res.status(200).json({ message: 'Friend removed successfully.' });
    } catch (error) {
        console.error('Error removing friend:', error);
        res.status(500).json({ message: 'Failed to remove friend.' });
    }
});


// Get Friends (Protected)
app.get('/friends', protect, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: 'User not found' });
        }
        const friendIds = userDoc.data().friends || [];

        const friendsData = [];
        if (friendIds.length > 0) {
            // Fetch friend user data in batches if friendIds array is very large (Firestore limit 10 'in' queries)
            // For now, assuming reasonable number of friends (less than 10) for a single query
            const friendsSnapshot = await db.collection('users').where(admin.firestore.FieldPath.documentId(), 'in', friendIds).get();
            friendsSnapshot.forEach(doc => {
                const user = doc.data();
                friendsData.push({
                    uid: doc.id,
                    username: user.username,
                    avatarUrl: user.avatarUrl,
                    isOnline: user.isOnline || false, // Default to false
                });
            });
        }
        res.status(200).json(friendsData);
    } catch (error) {
        console.error('Error fetching friends:', error);
        res.status(500).json({ message: 'Failed to fetch friends.' });
    }
});

// Get Sent Friend Requests (Protected)
app.get('/friend-requests/sent', protect, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: 'User not found' });
        }
        const sentRequestIds = userDoc.data().friendRequestsSent || [];

        const sentRequestsData = [];
        if (sentRequestIds.length > 0) {
            const requestsSnapshot = await db.collection('users').where(admin.firestore.FieldPath.documentId(), 'in', sentRequestIds).get();
            requestsSnapshot.forEach(doc => {
                const user = doc.data();
                sentRequestsData.push({
                    uid: doc.id,
                    username: user.username,
                    avatarUrl: user.avatarUrl,
                });
            });
        }
        res.status(200).json(sentRequestsData);
    } catch (error) {
        console.error('Error fetching sent friend requests:', error);
        res.status(500).json({ message: 'Failed to fetch sent requests.' });
    }
});

// Get Received Friend Requests (Protected)
app.get('/friend-requests/received', protect, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: 'User not found' });
        }
        const receivedRequestIds = userDoc.data().friendRequestsReceived || [];

        const receivedRequestsData = [];
        if (receivedRequestIds.length > 0) {
            const requestsSnapshot = await db.collection('users').where(admin.firestore.FieldPath.documentId(), 'in', receivedRequestIds).get();
            requestsSnapshot.forEach(doc => {
                const user = doc.data();
                receivedRequestsData.push({
                    uid: doc.id,
                    username: user.username,
                    avatarUrl: user.avatarUrl,
                });
            });
        }
        res.status(200).json(receivedRequestsData);
    } catch (error) {
        console.error('Error fetching received friend requests:', error);
        res.status(500).json({ message: 'Failed to fetch received requests.' });
    }
});


// --- Chat Routes (Protected - using imported chatService functions) ---
app.get('/chats', protect, async (req, res) => {
    try {
        // getUserChats is imported from chatService.js
        const chats = await getUserChats(req.user.uid);
        res.status(200).json(chats);
    } catch (error) {
        console.error('Error fetching user chats:', error);
        res.status(500).json({ message: 'Failed to fetch user chats.' });
    }
});

app.post('/chats/findOrCreate', protect, async (req, res) => {
    const { targetUid } = req.body;
    if (!targetUid) {
        return res.status(400).json({ message: 'targetUid is required.' });
    }
    try {
        // findOrCreateChat is imported from chatService.js
        const chat = await findOrCreateChat(req.user.uid, targetUid);
        res.status(200).json(chat);
    } catch (error) {
        console.error('Error finding or creating chat:', error);
        res.status(500).json({ message: error.message || 'Failed to find or create chat.' });
    }
});

app.post('/chats/:chatId/messages', protect, async (req, res) => {
    const { chatId } = req.params;
    const { text } = req.body;
    if (!chatId || !text) {
        return res.status(400).json({ message: 'Chat ID and message text are required.' });
    }
    try {
        // sendMessage is imported from chatService.js
        await sendMessage(chatId, req.user.uid, text);
        res.status(200).json({ message: 'Message sent successfully.' });
    } catch (error) {
        console.error('Error sending message via HTTP:', error);
        res.status(500).json({ message: 'Failed to send message.' });
    }
});

// --- Leaderboard Score Submission API ---
app.post('/leaderboards/submit-score', protect, async (req, res) => {
  const { gameId, score } = req.body;
  const userId = req.user.uid;
  if (!gameId || !userId || typeof score !== 'number') {
    return res.status(400).json({ message: "Missing required fields." });
  }

  // Disallow for Picker games (no leaderboard)
  const gameDoc = await db.collection('games').doc(gameId).get();
  if (gameDoc.exists && ['picker', 'Picker'].includes((gameDoc.data().category || '').toLowerCase())) {
    return res.status(400).json({ message: "Picker games do not have leaderboards." });
  }

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const leaderboardRef = db.collection('leaderboards').doc(gameId);

  const leaderboardDoc = await leaderboardRef.get();
  let data = leaderboardDoc.exists ? leaderboardDoc.data() : {};
  if (!data.allTimeScores) data.allTimeScores = {};
  if (!data.monthlyScores) data.monthlyScores = {};

  // 1. Update monthlyScores
  if (!data.monthlyScores[monthKey]) data.monthlyScores[monthKey] = {};
  data.monthlyScores[monthKey][userId] = {
    score,
    timestamp: now.toISOString(),
  };

  // 2. Update allTimeScores if new score is higher
  const prevAllTime = data.allTimeScores[userId]?.score || 0;
  let updatedAllTime = false;
  if (score > prevAllTime) {
    data.allTimeScores[userId] = {
      score,
      timestamp: now.toISOString(),
    };
    updatedAllTime = true;
  }

  await leaderboardRef.set(data, { merge: true });
  res.status(200).json({ message: "Score submitted.", updatedAllTime });
});

// --- API: Get leaderboard for a game ---
app.get('/leaderboards/:gameId', protect, async (req, res) => {
  const { gameId } = req.params;
  const leaderboardDoc = await db.collection('leaderboards').doc(gameId).get();
  if (!leaderboardDoc.exists) {
    return res.status(404).json({ message: "Leaderboard not found." });
  }
  res.status(200).json(leaderboardDoc.data());
});



// --- Server Start ---
// Starts the Express server and performs initial setup tasks
server.listen(PORT, async () => {
    console.log(`GG Web3 Backend listening on port ${PORT}`);
    // Ensure the game token mint is loaded or created when the server starts
    // Run initial cron jobs
    
    updateALLUsersOnlineStatus();
    updatePlatformStatsAggregatedInSol();
});