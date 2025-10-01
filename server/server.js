// DegenGaming/server.js
// Original backend plus GG Coins multi-layer economy endpoints (games/categories/platform).

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';

import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

import {
  Connection,
  PublicKey,
  Transaction,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

import splToken from '@solana/spl-token';
const {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  createMint,
  transfer,
  getAccount,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} = splToken;

import bs58 from 'bs58';
import nacl from 'tweetnacl';
import * as cron from 'node-cron';
import { fileURLToPath } from 'url';
import path from 'path';

import {
  initializeChatService,
  findOrCreateChat,
  sendMessage,
  getUserChats
} from './services/chatService.js';

// -----------------------------------------------------------------------------
// Firebase Init
// -----------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
let db;
let auth;

try {
  const serviceAccountData = fs.readFileSync(serviceAccountPath, 'utf8');
  const serviceAccount = JSON.parse(serviceAccountData);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  db = getFirestore();
  auth = getAuth();

  initializeChatService(db, admin);
  console.log("Firebase Admin SDK initialized successfully (Firestore, Auth).");
} catch (error) {
  console.error("Failed to initialize Firebase:", error);
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Solana Config
// -----------------------------------------------------------------------------
const SOLANA_CLUSTER = process.env.SOLANA_RPC_URL;
const connection = new Connection(SOLANA_CLUSTER, 'confirmed');
console.log(`Solana cluster: ${SOLANA_CLUSTER}`);

const ADMIN_WALLET_PRIVATE_KEY_BASE58 = process.env.ADMIN_WALLET_PRIVATE_KEY_BASE58;
let adminWalletKeypair = null;
if (ADMIN_WALLET_PRIVATE_KEY_BASE58) {
  try {
    adminWalletKeypair = Keypair.fromSecretKey(bs58.decode(ADMIN_WALLET_PRIVATE_KEY_BASE58));
    console.log(`Admin wallet loaded: ${adminWalletKeypair.publicKey.toBase58()}`);
  } catch (e) {
    console.error("Failed to load admin private key:", e.message);
    adminWalletKeypair = null;
  }
} else {
  console.warn("ADMIN_WALLET_PRIVATE_KEY_BASE58 not set. Some SOL features disabled.");
}
const PLATFORM_SOL_ADDRESS = process.env.PLATFORM_SOL_ADDRESS || (adminWalletKeypair ? adminWalletKeypair.publicKey.toBase58() : null);

let gameTokenMint = null;
const GAME_TOKEN_DECIMALS = 9;

// -----------------------------------------------------------------------------
// Express
// -----------------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 4000;

const corsOptions = {
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());

const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: corsOptions });

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
const CATEGORY_KEYS = ['arcade', 'pvp', 'casino', 'picker'];
// Mapping from lowercase category key to categories collection doc ID (as shown in your screenshots)
const CATEGORY_COLLECTION_ID_MAP = {
  arcade: 'Arcade',
  casino: 'Casino',
  picker: 'Picker',
  pvp: 'PvP',
};

const emptyStatsMap = { allTime: 0, lastMonth: 0 };

function getUserDocRef(uid) {
  return db.collection('users').doc(uid);
}
async function getOnlineUserIds() {
  try {
    const snap = await db.collection('users').where('isOnline', '==', true).get();
    return snap.docs.map(d => d.id);
  } catch (e) {
    console.error('getOnlineUserIds error:', e);
    return [];
  }
}
async function getUserDisplayData(uid) {
  const doc = await db.collection('users').doc(uid).get();
  if (!doc.exists) return null;
  const d = doc.data();
  return {
    uid: doc.id,
    username: d.username,
    avatarUrl: d.avatarUrl,
    isOnline: d.isOnline || false,
  };
}
function validateCategory(cat) {
  return CATEGORY_KEYS.includes((cat || '').toLowerCase());
}
function getPeriodKeys(date = new Date()) {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2,'0');
  const current = `${year}-${month}`;
  const prev = new Date(year, date.getMonth() - 1, 1);
  const last = `${prev.getFullYear()}-${(prev.getMonth() + 1).toString().padStart(2,'0')}`;
  return { current, last };
}
async function fetchSolPrice() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const j = await r.json();
    return Number(j?.solana?.usd) || 0;
  } catch (e) {
    console.error('fetchSolPrice failed:', e);
    return 0;
  }
}

// -----------------------------------------------------------------------------
// Socket.IO
// -----------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.on('setUid', async (uid) => {
    socket.data.uid = uid;
    try {
      await db.collection('users').doc(uid).update({
        isOnline: true,
        lastSeen: admin.firestore.FieldValue.serverTimestamp(),
      });
      io.emit('onlineUsersUpdate', await getOnlineUserIds());
    } catch (e) {
      console.error('setUid error:', e);
    }
  });

  socket.on('disconnect', async () => {
    const uid = socket.data.uid;
    if (!uid) return;
    try {
      await db.collection('users').doc(uid).update({
        isOnline: false,
        lastSeen: admin.firestore.FieldValue.serverTimestamp(),
      });
      io.emit('onlineUsersUpdate', await getOnlineUserIds());
    } catch (e) {
      console.error('disconnect presence error:', e);
    }
  });

  socket.on('joinGame', (gameId) => socket.join(gameId));
  socket.on('leaveGame', (gameId) => socket.leave(gameId));
  socket.on('gameAction', ({ gameId, actionType, payload }) => {
    io.to(gameId).emit('gameEvent', { actionType, payload, fromUser: socket.data.uid });
  });

  socket.on('chat:join', chatId => socket.join(chatId));
  socket.on('chat:message', async ({ chatId, text }) => {
    const senderUid = socket.data.uid;
    if (!senderUid || !chatId || !text) return;
    try {
      await sendMessage(chatId, senderUid, text);
      const senderData = await getUserDisplayData(senderUid);
      io.to(chatId).emit('chat:messageReceived', {
        senderId: senderUid,
        text,
        createdAt: new Date(),
        senderUsername: senderData?.username || 'Unknown',
        senderAvatarUrl: senderData?.avatarUrl || '',
      });
    } catch (e) {
      socket.emit('chat:error', 'Failed to send message.');
    }
  });
});

// -----------------------------------------------------------------------------
// Minimal Solana Token Helpers (existing)
// -----------------------------------------------------------------------------
async function transferSolanaToken(recipientPublicKey, amount) {
  if (!adminWalletKeypair || !gameTokenMint) {
    console.warn("transferSolanaToken: admin or mint not ready.");
    return false;
  }
  try {
    const adminATA = await getOrCreateAssociatedTokenAccount(
      connection,
      adminWalletKeypair,
      gameTokenMint,
      adminWalletKeypair.publicKey
    );
    const recipientATA = await getOrCreateAssociatedTokenAccount(
      connection,
      adminWalletKeypair,
      gameTokenMint,
      recipientPublicKey
    );
    await transfer(
      connection,
      adminWalletKeypair,
      adminATA.address,
      recipientATA.address,
      adminWalletKeypair.publicKey,
      amount
    );
    return true;
  } catch (e) {
    console.error('transferSolanaToken error:', e);
    return false;
  }
}
async function getTokenAccountBalance(tokenAccountPublicKey) {
  try {
    const info = await getAccount(connection, tokenAccountPublicKey, 'confirmed', TOKEN_PROGRAM_ID);
    return Number(info.amount);
  } catch (e) {
    if (e.message.includes('does not exist')) return 0;
    console.error('getTokenAccountBalance error:', e);
    return 0;
  }
}

// -----------------------------------------------------------------------------
// Auth Middleware
// -----------------------------------------------------------------------------
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  } else {
    return res.status(401).json({ message: 'Unauthorized: No token provided.' });
  }
  try {
    const decoded = await auth.verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Unauthorized: Invalid or expired token.' });
  }
};

// -----------------------------------------------------------------------------
// Cron Jobs (legacy SOL stats left intact)
// -----------------------------------------------------------------------------


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
        let totalGGCoinsGathered = 0;
        let totalGGCoinsDistributed = 0;
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
            if ((g.gamesPlayed?.allTime ?? 0) > 0) {
                catStats.gamesPlayed.allTime += g.gamesPlayed.allTime;
            }
            if ((g.gamesPlayed?.lastMonth ?? 0) > 0) {
                catStats.gamesPlayed.lastMonth += g.gamesPlayed.lastMonth;
            }

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
            totalGGCoinsGathered += ggCoinsGathered.allTime || 0;
            totalGGCoinsDistributed += ggCoinsDistributed.allTime || 0;
        });

        currentStats.totalGamesPlayed = totalGamesPlayed;
        currentStats.totalGGCoinsGathered = { allTime: totalGGCoinsGathered, lastMonth: totalGGCoinsGathered }; // You may want to aggregate lastMonth properly
        currentStats.totalGGCoinsDistributed = { allTime: totalGGCoinsDistributed, lastMonth: totalGGCoinsDistributed };
        currentStats.onlineUsers = (await getOnlineUserIds()).length;

        await statsDocRef.set(currentStats, { merge: true });
        console.log('Platform stats updated successfully in Firestore.');
    } catch (error) {
        console.error('Error updating platform stats:', error);
    }
}

// Cron job to aggregate platform stats every 30 minutes (or adjust as needed)
cron.schedule('*/30 * * * *', updatePlatformStatsAggregatedGGCoins);



// --- API Routes ---

// Increment ggCoinsGathered for a game and category
app.post('/api/games/increment-ggcoins-gathered', protect, async (req, res) => {
  const { gameId, category, amount } = req.body;
  try {
    const incrementValue = Number(amount);
    if (isNaN(incrementValue) || incrementValue <= 0) {
      return res.status(400).json({ success: false, error: "Invalid amount" });
    }

    // Game doc
    const gameRef = db.collection('games').doc(gameId);
    await gameRef.update({
      'ggCoinsGathered.allTime': admin.firestore.FieldValue.increment(incrementValue),
      'ggCoinsGathered.lastMonth': admin.firestore.FieldValue.increment(incrementValue)
    });

    // Platform stats doc
    const statsRef = db.collection('platform').doc('stats');
    await statsRef.update({
      [`categories.${category}.ggCoinsGathered.allTime`]: admin.firestore.FieldValue.increment(incrementValue),
      [`categories.${category}.ggCoinsGathered.lastMonth`]: admin.firestore.FieldValue.increment(incrementValue),
      'totalGGCoinsGathered.allTime': admin.firestore.FieldValue.increment(incrementValue),
      'totalGGCoinsGathered.lastMonth': admin.firestore.FieldValue.increment(incrementValue)
    });

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

    // Game doc
    const gameRef = db.collection('games').doc(gameId);
    await gameRef.update({
      'ggCoinsDistributed.allTime': admin.firestore.FieldValue.increment(incrementValue),
      'ggCoinsDistributed.lastMonth': admin.firestore.FieldValue.increment(incrementValue)
    });

    // Platform stats doc
    const statsRef = db.collection('platform').doc('stats');
    await statsRef.update({
      [`categories.${category}.ggCoinsDistributed.allTime`]: admin.firestore.FieldValue.increment(incrementValue),
      [`categories.${category}.ggCoinsDistributed.lastMonth`]: admin.firestore.FieldValue.increment(incrementValue),
      'totalGGCoinsDistributed.allTime': admin.firestore.FieldValue.increment(incrementValue),
      'totalGGCoinsDistributed.lastMonth': admin.firestore.FieldValue.increment(incrementValue)
    });

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
    // Game doc
    const gameRef = db.collection('games').doc(gameId);
    const gameDoc = await gameRef.get();
    if (!gameDoc.exists) {
      await gameRef.set({
        name: gameId,
        category,
        gamesPlayed: { allTime: 0, lastMonth: 0 }
      });
    }
    await gameRef.update({
      'gamesPlayed.allTime': admin.firestore.FieldValue.increment(1),
      'gamesPlayed.lastMonth': admin.firestore.FieldValue.increment(1)
    });

    // Platform stats doc
    const statsRef = db.collection('platform').doc('stats');
    await statsRef.update({
      [`categories.${category}.gamesPlayed.allTime`]: admin.firestore.FieldValue.increment(1),
      [`categories.${category}.gamesPlayed.lastMonth`]: admin.firestore.FieldValue.increment(1)
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error incrementing gamesPlayed:', error);
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

        res.status(200).json({ customToken });

    } catch (error) {
        console.error("Error in /verify-wallet:", error);
        res.status(500).json({ error: "Internal server error during wallet verification." });
    }
});

// -----------------------------------------------------------------------------
// GG COINS MULTI-LAYER ECONOMY SERVICE (NEW)
// -----------------------------------------------------------------------------
/**
 * Ensure platform stats doc exists with minimal structure.
 */
async function ensurePlatformStatsBase() {
  const statsRef = db.collection('platform').doc('stats');
  const snap = await statsRef.get();
  if (!snap.exists) {
    const { current, last } = getPeriodKeys();
    await statsRef.set({
      registeredUsers: 0,
      onlineUsers: 0,
      totalGamesPlayed: 0,
      totalGGCoinsDeposited: { ...emptyStatsMap },
      totalGGCoinsWithdrawn: { ...emptyStatsMap },
      totalGGCoinsGathered: { ...emptyStatsMap },
      totalGGCoinsDistributed: { ...emptyStatsMap },
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      currentMonthPeriod: current,
      lastMonthPeriod: last,
      categories: {
        arcade: { ggCoinsGathered: { ...emptyStatsMap }, ggCoinsDistributed: { ...emptyStatsMap }, gamesPlayed: { ...emptyStatsMap }, games: [] },
        pvp: { ggCoinsGathered: { ...emptyStatsMap }, ggCoinsDistributed: { ...emptyStatsMap }, gamesPlayed: { ...emptyStatsMap }, games: [] },
        casino: { ggCoinsGathered: { ...emptyStatsMap }, ggCoinsDistributed: { ...emptyStatsMap }, gamesPlayed: { ...emptyStatsMap }, games: [] },
        picker: { ggCoinsGathered: { ...emptyStatsMap }, ggCoinsDistributed: { ...emptyStatsMap }, gamesPlayed: { ...emptyStatsMap }, games: [] },
      },
      games: {}
    }, { merge: false });
  }
  return statsRef;
}

/**
 * Ensure category document exists (categories collection).
 */
async function ensureCategoryDoc(t, lowerCat) {
  const docId = CATEGORY_COLLECTION_ID_MAP[lowerCat];
  if (!docId) return null;
  const catRef = db.collection('categories').doc(docId);
  const snap = await t.get(catRef);
  if (!snap.exists) {
    t.set(catRef, {
      id: docId,
      name: docId,
      description: docId + " category",
      ggCoinsGathered: { allTime: 0, lastMonth: 0 },
      ggCoinsDistributed: { allTime: 0, lastMonth: 0 },
      gamesPlayed: { allTime: 0, lastMonth: 0 },
      games: []
    }, { merge: false });
  }
  return catRef;
}

/**
 * Apply economy deltas (atomic).
 * @param {object} opts
 *   gameId
 *   category (lowercase)
 *   gatheredDelta (number >=0)
 *   distributedDelta (number >=0)
 *   incrementPlay (boolean) - whether to increment gamesPlayed
 */
async function applyEconomyDeltas({
  gameId,
  category,
  gatheredDelta = 0,
  distributedDelta = 0,
  incrementPlay = false
}) {
  if (!gameId) throw new Error('Missing gameId');
  if (!validateCategory(category)) throw new Error('Invalid category');

  const lowerCat = category.toLowerCase();
  await ensurePlatformStatsBase();

  // Run transaction
  await db.runTransaction(async (t) => {
    const gameRef = db.collection('games').doc(gameId);
    const statsRef = db.collection('platform').doc('stats');
    const catRef = db.collection('categories').doc(CATEGORY_COLLECTION_ID_MAP[lowerCat]);

    // Preload docs
    const [gameSnap, statsSnap, catSnap] = await Promise.all([
      t.get(gameRef),
      t.get(statsRef),
      t.get(catRef)
    ]);

    if (!gameSnap.exists) {
      // Initialize the game doc with baseline if missing
      t.set(gameRef, {
        id: gameId,
        category: CATEGORY_COLLECTION_ID_MAP[lowerCat] || lowerCat,
        ggCoinsGathered: { allTime: 0, lastMonth: 0 },
        ggCoinsDistributed: { allTime: 0, lastMonth: 0 },
        gamesPlayed: { allTime: 0, lastMonth: 0 },
      }, { merge: true });
    }

    // Ensure category doc
    if (!catSnap.exists) {
      t.set(catRef, {
        id: CATEGORY_COLLECTION_ID_MAP[lowerCat],
        name: CATEGORY_COLLECTION_ID_MAP[lowerCat],
        description: `${CATEGORY_COLLECTION_ID_MAP[lowerCat]} category`,
        ggCoinsGathered: { allTime: 0, lastMonth: 0 },
        ggCoinsDistributed: { allTime: 0, lastMonth: 0 },
        gamesPlayed: { allTime: 0, lastMonth: 0 },
        games: [gameId]
      }, { merge: true });
    } else {
      // Add game reference if not present
      t.update(catRef, {
        games: admin.firestore.FieldValue.arrayUnion(gameId)
      });
    }

    // Defensive: ensure stats category child structure
    const statsData = statsSnap.exists ? statsSnap.data() : {};
    if (!(statsData.categories?.[lowerCat])) {
      t.set(statsRef, {
        categories: {
          [lowerCat]: {
            ggCoinsGathered: { allTime: 0, lastMonth: 0 },
            ggCoinsDistributed: { allTime: 0, lastMonth: 0 },
            gamesPlayed: { allTime: 0, lastMonth: 0 },
            games: []
          }
        }
      }, { merge: true });
    }

    const increments = {};

    if (gatheredDelta > 0) {
      increments['ggCoinsGathered.allTime'] = admin.firestore.FieldValue.increment(gatheredDelta);
      increments['ggCoinsGathered.lastMonth'] = admin.firestore.FieldValue.increment(gatheredDelta);
      increments[`categories.${lowerCat}.ggCoinsGathered.allTime`] = admin.firestore.FieldValue.increment(gatheredDelta);
      increments[`categories.${lowerCat}.ggCoinsGathered.lastMonth`] = admin.firestore.FieldValue.increment(gatheredDelta);
      increments['totalGGCoinsGathered.allTime'] = admin.firestore.FieldValue.increment(gatheredDelta);
      increments['totalGGCoinsGathered.lastMonth'] = admin.firestore.FieldValue.increment(gatheredDelta);
    }

    if (distributedDelta > 0) {
      increments['ggCoinsDistributed.allTime'] = admin.firestore.FieldValue.increment(distributedDelta);
      increments['ggCoinsDistributed.lastMonth'] = admin.firestore.FieldValue.increment(distributedDelta);
      increments[`categories.${lowerCat}.ggCoinsDistributed.allTime`] = admin.firestore.FieldValue.increment(distributedDelta);
      increments[`categories.${lowerCat}.ggCoinsDistributed.lastMonth`] = admin.firestore.FieldValue.increment(distributedDelta);
      increments['totalGGCoinsDistributed.allTime'] = admin.firestore.FieldValue.increment(distributedDelta);
      increments['totalGGCoinsDistributed.lastMonth'] = admin.firestore.FieldValue.increment(distributedDelta);
    }

    if (incrementPlay) {
      increments['gamesPlayed.allTime'] = admin.firestore.FieldValue.increment(1);
      increments['gamesPlayed.lastMonth'] = admin.firestore.FieldValue.increment(1);
      increments[`categories.${lowerCat}.gamesPlayed.allTime`] = admin.firestore.FieldValue.increment(1);
      increments[`categories.${lowerCat}.gamesPlayed.lastMonth`] = admin.firestore.FieldValue.increment(1);
      increments['totalGamesPlayed'] = admin.firestore.FieldValue.increment(1);
    }

    // Apply increments to game doc
    const gameUpdate = {};
    if (gatheredDelta > 0) {
      gameUpdate['ggCoinsGathered.allTime'] = admin.firestore.FieldValue.increment(gatheredDelta);
      gameUpdate['ggCoinsGathered.lastMonth'] = admin.firestore.FieldValue.increment(gatheredDelta);
    }
    if (distributedDelta > 0) {
      gameUpdate['ggCoinsDistributed.allTime'] = admin.firestore.FieldValue.increment(distributedDelta);
      gameUpdate['ggCoinsDistributed.lastMonth'] = admin.firestore.FieldValue.increment(distributedDelta);
    }
    if (incrementPlay) {
      gameUpdate['gamesPlayed.allTime'] = admin.firestore.FieldValue.increment(1);
      gameUpdate['gamesPlayed.lastMonth'] = admin.firestore.FieldValue.increment(1);
    }

    if (Object.keys(gameUpdate).length) {
      t.set(gameRef, gameUpdate, { merge: true });
    }

    // Update categories collection doc fields
    const catFieldUpdate = {};
    if (gatheredDelta > 0) {
      catFieldUpdate['ggCoinsGathered.allTime'] = admin.firestore.FieldValue.increment(gatheredDelta);
      catFieldUpdate['ggCoinsGathered.lastMonth'] = admin.firestore.FieldValue.increment(gatheredDelta);
    }
    if (distributedDelta > 0) {
      catFieldUpdate['ggCoinsDistributed.allTime'] = admin.firestore.FieldValue.increment(distributedDelta);
      catFieldUpdate['ggCoinsDistributed.lastMonth'] = admin.firestore.FieldValue.increment(distributedDelta);
    }
    if (incrementPlay) {
      catFieldUpdate['gamesPlayed.allTime'] = admin.firestore.FieldValue.increment(1);
      catFieldUpdate['gamesPlayed.lastMonth'] = admin.firestore.FieldValue.increment(1);
    }
    if (Object.keys(catFieldUpdate).length) {
      t.set(catRef, catFieldUpdate, { merge: true });
    }

    // Platform stats increments
    if (Object.keys(increments).length) {
      t.set(statsRef, {
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        ...Object.entries(increments).reduce((acc, [k, v]) => {
          acc[k] = v;
          return acc;
        }, {})
      }, { merge: true });
    }
  });
}

/**
 * Fetch a snapshot summary after an update
 */
async function getEconomySnapshot(gameId, category) {
  const lowerCat = category?.toLowerCase();
  const gameRef = db.collection('games').doc(gameId);
  const statsRef = db.collection('platform').doc('stats');
  const catRef = lowerCat ? db.collection('categories').doc(CATEGORY_COLLECTION_ID_MAP[lowerCat]) : null;

  const docs = await Promise.all([
    gameRef.get(),
    statsRef.get(),
    catRef ? catRef.get() : Promise.resolve(null)
  ]);

  return {
    game: docs[0].exists ? docs[0].data() : null,
    categoryDoc: docs[2] && docs[2].exists ? docs[2].data() : null,
    platformCategory: (docs[1].exists && lowerCat && docs[1].data().categories?.[lowerCat]) ? docs[1].data().categories[lowerCat] : null,
    platformTotals: docs[1].exists ? {
      totalGGCoinsGathered: docs[1].data().totalGGCoinsGathered || null,
      totalGGCoinsDistributed: docs[1].data().totalGGCoinsDistributed || null,
      totalGamesPlayed: docs[1].data().totalGamesPlayed || 0
    } : null
  };
}

// -----------------------------------------------------------------------------
// ECONOMY ENDPOINTS (NEW)
// -----------------------------------------------------------------------------

// Player pays to play a game (gathered)
app.post('/economy/play', protect, async (req, res) => {
  const { gameId, category, amount } = req.body;
  if (!gameId || !category || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid payload.' });
  }
  try {
    await applyEconomyDeltas({
      gameId,
      category,
      gatheredDelta: amount,
      distributedDelta: 0,
      incrementPlay: true
    });
    const snapshot = await getEconomySnapshot(gameId, category);
    res.json({ success: true, type: 'play', amount, snapshot });
  } catch (e) {
    console.error('/economy/play error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// Platform distributes reward (distributed)
app.post('/economy/reward', protect, async (req, res) => {
  const { gameId, category, amount } = req.body;
  if (!gameId || !category || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid payload.' });
  }
  try {
    await applyEconomyDeltas({
      gameId,
      category,
      gatheredDelta: 0,
      distributedDelta: amount,
      incrementPlay: false
    });
    const snapshot = await getEconomySnapshot(gameId, category);
    res.json({ success: true, type: 'reward', amount, snapshot });
  } catch (e) {
    console.error('/economy/reward error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// Bulk updates (array of entries)
app.post('/economy/bulk', protect, async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries) || !entries.length) {
    return res.status(400).json({ success: false, message: 'entries array required.' });
  }
  const results = [];
  for (const entry of entries) {
    const { gameId, category, gathered = 0, distributed = 0, incrementPlay = false } = entry;
    try {
      if (!gameId || !category || (gathered <= 0 && distributed <= 0 && !incrementPlay)) {
        results.push({ gameId, ok: false, error: 'Invalid entry' });
        continue;
      }
      await applyEconomyDeltas({
        gameId,
        category,
        gatheredDelta: gathered > 0 ? gathered : 0,
        distributedDelta: distributed > 0 ? distributed : 0,
        incrementPlay: !!incrementPlay
      });
      results.push({ gameId, ok: true });
    } catch (e) {
      results.push({ gameId, ok: false, error: e.message });
    }
  }
  res.json({ success: true, results });
});

// Fetch snapshot for a single game/category
app.post('/economy/snapshot', protect, async (req, res) => {
  const { gameId, category } = req.body;
  if (!gameId || !category) {
    return res.status(400).json({ success: false, message: 'gameId & category required.' });
  }
  try {
    const snapshot = await getEconomySnapshot(gameId, category);
    res.json({ success: true, snapshot });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// -----------------------------------------------------------------------------
// CASHIER ENDPOINTS (existing deposit/withdraw concept extended to update platform maps)
// -----------------------------------------------------------------------------
app.post('/cashier/deposit', protect, async (req, res) => {
  const { txSignature, solAmount, solPriceOverride } = req.body;
  if (!PLATFORM_SOL_ADDRESS) {
    return res.status(500).json({ message: 'Platform SOL address not configured.' });
  }
  try {
    let resolvedSolAmount = 0;
    if (txSignature) {
      const tx = await connection.getTransaction(txSignature, { commitment: 'confirmed' });
      if (!tx) return res.status(400).json({ message: 'Transaction not found.' });
      const accountKeys = tx.transaction.message.accountKeys.map(k => k.toBase58());
      const idx = accountKeys.indexOf(PLATFORM_SOL_ADDRESS);
      if (idx === -1) return res.status(400).json({ message: 'Platform address not involved.' });
      const pre = tx.meta?.preBalances?.[idx] ?? 0;
      const post = tx.meta?.postBalances?.[idx] ?? 0;
      const delta = post - pre;
      if (delta <= 0) return res.status(400).json({ message: 'No net SOL received.' });
      resolvedSolAmount = delta / LAMPORTS_PER_SOL;
    } else if (typeof solAmount === 'number' && solAmount > 0) {
      resolvedSolAmount = solAmount;
    } else {
      return res.status(400).json({ message: 'Provide txSignature or positive solAmount.' });
    }

    const solPrice = solPriceOverride || await fetchSolPrice();
    if (solPrice <= 0) return res.status(500).json({ message: 'Could not resolve SOL price.' });
    const ggCredit = Number((resolvedSolAmount * solPrice).toFixed(2));

    await db.runTransaction(async (t) => {
      const userRef = getUserDocRef(req.user.uid);
      const statsRef = db.collection('platform').doc('stats');
      const userSnap = await t.get(userRef);
      if (!userSnap.exists) throw new Error('User not found.');
      const currentGG = Number(userSnap.data()?.coins?.gg ?? 0);
      t.update(userRef, { 'coins.gg': currentGG + ggCredit });
      t.set(statsRef, {
        totalGGCoinsDeposited: {
          allTime: admin.firestore.FieldValue.increment(ggCredit),
          lastMonth: admin.firestore.FieldValue.increment(ggCredit),
        }
      }, { merge: true });
    });

    res.json({
      success: true,
      mode: txSignature ? 'on-chain-verified' : 'manual',
      solAmount: resolvedSolAmount,
      solPriceUsed: solPrice,
      ggCoinsCredited: ggCredit,
      txSignature: txSignature || null
    });
  } catch (e) {
    console.error('/cashier/deposit error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/cashier/withdraw', protect, async (req, res) => {
  const { ggAmount, destinationWallet, solPriceOverride } = req.body;
  if (!adminWalletKeypair) return res.status(500).json({ message: 'Admin wallet unavailable.' });
  if (typeof ggAmount !== 'number' || ggAmount <= 0) return res.status(400).json({ message: 'Invalid ggAmount.' });

  try {
    const solPrice = solPriceOverride || await fetchSolPrice();
    if (solPrice <= 0) return res.status(500).json({ message: 'Failed to resolve SOL price.' });
    const solNeeded = ggAmount / solPrice;
    const lamportsNeeded = Math.round(solNeeded * LAMPORTS_PER_SOL);
    if (lamportsNeeded <= 0) return res.status(400).json({ message: 'Withdrawal < 1 lamport.' });

    let txSig = null;
    await db.runTransaction(async (t) => {
      const userRef = getUserDocRef(req.user.uid);
      const statsRef = db.collection('platform').doc('stats');
      const userSnap = await t.get(userRef);
      if (!userSnap.exists) throw new Error('User not found.');
      const userData = userSnap.data();
      const currentGG = Number(userData?.coins?.gg ?? 0);
      if (currentGG < ggAmount) throw new Error('Insufficient GG Coins.');
      const wallet = destinationWallet || userData.wallet;
      if (!wallet) throw new Error('Destination wallet missing.');
      // Prepare SOL transfer
      const toPubkey = new PublicKey(wallet);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: adminWalletKeypair.publicKey,
          toPubkey,
          lamports: lamportsNeeded
        })
      );
      tx.feePayer = adminWalletKeypair.publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
      tx.recentBlockhash = blockhash;
      tx.sign(adminWalletKeypair);
      const raw = tx.serialize();
      txSig = await connection.sendRawTransaction(raw, { skipPreflight: false });
      await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: txSig }, 'confirmed');

      t.update(userRef, { 'coins.gg': currentGG - ggAmount });
      t.set(statsRef, {
        totalGGCoinsWithdrawn: {
          allTime: admin.firestore.FieldValue.increment(ggAmount),
          lastMonth: admin.firestore.FieldValue.increment(ggAmount),
        }
      }, { merge: true });
    });

    res.json({
      success: true,
      ggCoinsDebited: ggAmount,
      solAmountSent: solNeeded,
      lamportsSent: lamportsNeeded,
      solPriceUsed: solPrice,
      txSignature: txSig
    });
  } catch (e) {
    console.error('/cashier/withdraw error:', e);
    res.status(500).json({ success: false, message: e.message });
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
    const { username, avatarUrl, bio, dmsOpen, duelsOpen, twitter, discord,  } = req.body;
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
app.post('/tokens/generate', protect, async (req, res) => {
    const userId = req.user.uid;
    const { tokenType } = req.body;

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

// Increment gamesPlayed for a game and category
app.post('/api/games/increment-games-played', protect, async (req, res) => {
  const { gameId, category } = req.body;
  try {
    // Game doc
    const gameRef = db.collection('games').doc(gameId);
    const gameDoc = await gameRef.get();
    if (!gameDoc.exists) {
      // Create minimal doc if missing
      await gameRef.set({
        name: gameId,
        category,
        gamesPlayed: { allTime: 0, lastMonth: 0 }
      });
    }
    await gameRef.update({
      'gamesPlayed.allTime': admin.firestore.FieldValue.increment(1),
      'gamesPlayed.lastMonth': admin.firestore.FieldValue.increment(1)
    });

    // Platform stats doc
    const statsRef = db.collection('platform').doc('stats');
    await statsRef.update({
      [`categories.${category}.gamesPlayed.allTime`]: admin.firestore.FieldValue.increment(1),
      [`categories.${category}.gamesPlayed.lastMonth`]: admin.firestore.FieldValue.increment(1)
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error incrementing gamesPlayed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

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

const defaultMap = { allTime: 0, lastMonth: 0 };

async function fixGamesCollection() {
  const gamesSnapshot = await db.collection('games').get();
  let updated = 0;
  for (const gameDoc of gamesSnapshot.docs) {
    const data = gameDoc.data();
    let updateData = {};
    let needsUpdate = false;

    // Remove old sol fields
    if ('solDistributed' in data) {
      updateData['solDistributed'] = admin.firestore.FieldValue.delete();
      needsUpdate = true;
    }
    if ('solGathered' in data) {
      updateData['solGathered'] = admin.firestore.FieldValue.delete();
      needsUpdate = true;
    }

    // Ensure required GG Coins maps
    if (!data.ggCoinsGathered || typeof data.ggCoinsGathered.allTime !== 'number' || typeof data.ggCoinsGathered.lastMonth !== 'number') {
      updateData['ggCoinsGathered'] = defaultMap;
      needsUpdate = true;
    }
    if (!data.ggCoinsDistributed || typeof data.ggCoinsDistributed.allTime !== 'number' || typeof data.ggCoinsDistributed.lastMonth !== 'number') {
      updateData['ggCoinsDistributed'] = defaultMap;
      needsUpdate = true;
    }
    if (!data.gamesPlayed || typeof data.gamesPlayed.allTime !== 'number' || typeof data.gamesPlayed.lastMonth !== 'number') {
      updateData['gamesPlayed'] = defaultMap;
      needsUpdate = true;
    }
    if (needsUpdate) {
      await gameDoc.ref.update(updateData);
      updated++;
      console.log(`Updated game: ${gameDoc.id}`);
    }
  }
  console.log(`Games collection: updated ${updated} documents.`);
}


async function run() {
 ensurePlatformStatsBase();
    ensureCategoryDoc();
    fixGamesCollection();
}

run().catch(err => {
  console.error("Migration failed:", err);
});

// --- Server Start ---
// Starts the Express server and performs initial setup tasks
server.listen(PORT, async () => {
    console.log(`GG Web3 Backend listening on port ${PORT}`);
    // Ensure the game token mint is loaded or created when the server starts
    // Run initial cron jobs
    
    updateALLUsersOnlineStatus();
    updatePlatformStatsAggregatedGGCoins();
});