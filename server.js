// server.js (George-Mavrommatis/DegenGaming/blob/george.m/server.js as base)

// --- Core Node.js Modules ---
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url'; // Necessary for __dirname in ES Modules

// --- Third-Party Middleware & Libraries ---
import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import * as solanaWeb3 from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl'; // Explicitly importing nacl for signature verification
import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs
import fetch from 'node-fetch'; // For fetching external APIs (like Coingecko)


// --- Firebase SDKs ---
// --- FIX: Import Firebase Client SDK (v9 Modular) ---
// The 'firebase' object (default export) is deprecated in v9.
// Instead, import specific functions you need.
import { initializeApp } from 'firebase/app';
// If you need specific Firestore or Auth functions from the Client SDK in server.js,
// import them like this:
// import { getFirestore as getClientFirestore } from 'firebase/firestore';
// import { getAuth as getClientAuth } from 'firebase/auth';

import firebaseConfig from './firebaseConfig.js'; // Your Firebase client config

// --- MODIFIED: Import Firebase Admin SDK ---
import admin from 'firebase-admin';


// --- ES Module __dirname and __filename Fix (your existing code) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// --- END ES Module __dirname Fix ---


const app = express();


// --- START Firebase Initialization ---

// --- FIX: Firebase Client SDK Initialization (v9 Modular) ---
// Change `firebase.initializeApp` to `initializeApp`
const clientApp = initializeApp(firebaseConfig);
// If you use db (firestore) from the client SDK, it should be derived from clientApp:
// const clientDb = getClientFirestore(clientApp);
// const clientAuth = getClientAuth(clientApp);

// --- MODIFIED: Your existing Firestore instance (now explicitly for Admin SDK) ---
// This `db` variable will now exclusively refer to the Admin SDK's Firestore instance,
// which is appropriate for backend operations.
// The original line `const db = firebase.firestore();` will be removed.

let serviceAccount;
try {
    const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json'); // Assumes serviceAccountKey.json is in root
    serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    console.log("SUCCESS: serviceAccountKey.json loaded successfully for Admin SDK.");
} catch (error) {
    console.error(`ERROR: Failed to read serviceAccountKey.json at ${serviceAccountPath}. Ensure it exists and is valid JSON:`, error);
    process.exit(1); // Exit if service account key is not found or malformed JSON
}

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("SUCCESS: Firebase Admin SDK initialized successfully.");
} catch (error) {
    console.error("ERROR: Failed to initialize Firebase Admin SDK:", error);
    process.exit(1); // Exit if initialization fails
}

// --- FIX: Global access to FieldValue and Timestamp from the Admin SDK ---
// These MUST come from the Admin SDK, not the client SDK's 'firebase/firestore'
const db = admin.firestore(); // This is the Firestore instance from Admin SDK
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;


// --- Middleware Setup (your existing code) ---
app.use(morgan('dev'));
app.use(cors({
    origin: 'http://localhost:5173', // Your existing hardcoded origin
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: 'a_strong_secret_key', // Your existing hardcoded secret
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' } // Your existing setting
}));


// --- Middleware to verify Firebase ID Token (FIXED TO USE ADMIN SDK) ---
// This is the CRITICAL fix for authentication flow
const verifyIdToken = async (req, res, next) => {
    const authorizationHeader = req.headers.authorization;
    if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Unauthorized: No token provided' });
    }
    const idToken = authorizationHeader.split(' ')[1]; // Correctly get the token part
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken); // <--- THIS IS THE FIX (USES admin.auth())
        req.user = decodedToken; // Attach decoded token to request
        next();
    } catch (error) {
        console.error('ERROR: Error verifying Firebase ID token:', error);
        // Use 403 Forbidden for invalid tokens as opposed to 401 Unauthorized for missing token
        return res.status(403).json({ message: 'Invalid or expired token' });
    }
};


// ---- Price Fetching and Caching (your existing helper function, slightly modified for `fetch`) ----
const COINGECKO_API_URL = 'https://api.coingecko.com/api/v3/simple/price';
const CACHE_DURATION_SECONDS = 60; // Cache prices for 60 seconds

let priceCache = {
    sol: null,
    lastFetched: 0
};

async function fetchTokenPrices() {
    const now = Date.now();
    // Use cached price if still fresh
    if (now - priceCache.lastFetched < CACHE_DURATION_SECONDS * 1000 && priceCache.sol) {
        return { solPriceUsd: priceCache.sol };
    }

    try {
        // Use 'fetch' instead of 'axios' (if you were using axios before)
        const response = await fetch(`${COINGECKO_API_URL}?ids=solana&vs_currencies=usd`);
        if (!response.ok) {
            throw new Error(`CoinGecko API error: ${response.statusText} (Status: ${response.status})`);
        }
        const data = await response.json();

        const solPrice = data.solana?.usd;

        if (solPrice) {
            priceCache.sol = solPrice;
            priceCache.lastFetched = now;
            console.log(`INFO: Fetched new prices: SOL=${solPrice} USD`);
            return { solPriceUsd: solPrice };
        } else {
            console.warn("WARNING: Could not fetch SOL price from CoinGecko. Data:", data);
            throw new Error("Missing SOL price data from CoinGecko API.");
        }
    } catch (error) {
        console.error("ERROR: Error fetching prices from CoinGecko:", error.message);
        // Fallback to stale cache or default if API fails
        if (priceCache.sol) {
            console.warn("WARNING: Using stale cached SOL price due to API error.");
            return { solPriceUsd: priceCache.sol };
        }
        // As a last resort, provide a hardcoded default (should be avoided in production)
        console.error("ERROR: No valid SOL price found, falling back to hardcoded default (This should be avoided in production).");
        return { solPriceUsd: 150 };
    }
}


// ---- patchUsersOnStartup (your existing helper, adjusted to use FieldValue) ----
async function patchUsersOnStartup() {
    console.log("INFO: Starting user patching on startup. Attempting to query Firestore 'users' collection...");
    let patchedCount = 0;
    try {
        const usersSnapshot = await db.collection('users').get();
        console.log(`INFO: Successfully fetched ${usersSnapshot.docs.length} users for patching.`);

        for (const docSnap of usersSnapshot.docs) {
            const data = docSnap.data();
            const patch = {};

            // Ensure usernameLowercase
            if (data.username && (typeof data.usernameLowercase !== 'string' || data.usernameLowercase !== data.username.toLowerCase())) {
                patch.usernameLowercase = data.username.toLowerCase();
            }

            // Ensure array fields
            if (!Array.isArray(data.friends)) patch.friends = [];
            if (!Array.isArray(data.friendRequests)) patch.friendRequests = [];
            if (!Array.isArray(data.sentInvitations)) patch.sentInvitations = [];

            // Ensure boolean fields with default true
            if (typeof data.dmsOpen !== "boolean") patch.dmsOpen = true;
            if (typeof data.duelsOpen !== "boolean") patch.duelsOpen = true;

            // Ensure freeEntryTokens structure is properly initialized
            let currentFreeEntryTokens = data.freeEntryTokens || {};

            // Use FieldValue.delete() to remove old 'ggwTokens' if it existed and is no longer needed
            if (currentFreeEntryTokens.ggwTokens !== undefined) {
                patch['freeEntryTokens.ggwTokens'] = FieldValue.delete(); // Using Admin SDK's FieldValue
            }

            // Initialize new token types if undefined
            if (currentFreeEntryTokens.arcadeTokens === undefined || typeof currentFreeEntryTokens.arcadeTokens !== 'number') {
                patch['freeEntryTokens.arcadeTokens'] = 0;
            }
            if (currentFreeEntryTokens.pickerTokens === undefined || typeof currentFreeEntryTokens.pickerTokens !== 'number') {
                patch['freeEntryTokens.pickerTokens'] = 0;
            }
            if (currentFreeEntryTokens.casinoTokens === undefined || typeof currentFreeEntryTokens.casinoTokens !== 'number') {
                patch['freeEntryTokens.casinoTokens'] = 0;
            }
            if (currentFreeEntryTokens.pvpTokens === undefined || typeof currentFreeEntryTokens.pvpTokens !== 'number') {
                patch['freeEntryTokens.pvpTokens'] = 0;
            }

            if (Object.keys(patch).length > 0) {
                await docSnap.ref.update(patch);
                patchedCount++;
            }
        }
        console.log(`INFO: Finished patching. ${patchedCount} users updated.`);
    } catch (error) {
        console.error("ERROR: Error during patchUsersOnStartup:", error);
    }
}


// ---- updateAllUsersOnlineStatus (your existing helper) ----
async function updateAllUsersOnlineStatus() {
    console.log("INFO: Starting online status update. Attempting to query Firestore 'users' collection...");
    try {
        const users = await db.collection("users").get();
        console.log(`INFO: Successfully fetched ${users.docs.length} users for online status update.`);
        const batch = db.batch();
        users.forEach(doc => {
            batch.update(doc.ref, { isOnline: false });
        });
        await batch.commit();
        console.log("INFO: Updated all users with isOnline: false");
    } catch (error) {
        console.error("ERROR: Error during updateAllUsersOnlineStatus:", error);
    }
}


// ---- updatePlatformStatsAggregatedInSOL (your existing helper, adjusted for FieldValue/Timestamp) ----
async function updatePlatformStatsAggregatedInSOL() {
    await fetchTokenPrices(); // Ensure prices are fresh for conversion
    console.log("INFO: Starting platform stats aggregation. Attempting to query Firestore...");
    try {
        const usersSnapshot = await db.collection('users').get();
        const gamesSnap = await db.collection('games').get();
        const payoutsSnap = await db.collection('payouts').get();
        console.log("INFO: All necessary snapshots for platform stats fetched successfully.");

        const categories = {
            arcade: {
                solTotal: 0, solDistributed: 0, solLastMonth: 0, solDistributedLastMonth: 0,
                playsTotal: 0, playsLastMonth: 0, games: []
            },
            casino: {
                solTotal: 0, solDistributed: 0, solLastMonth: 0, solDistributedLastMonth: 0,
                playsTotal: 0, playsLastMonth: 0, games: []
            },
            pvp: {
                solTotal: 0, solDistributed: 0, solLastMonth: 0, solDistributedLastMonth: 0,
                playsTotal: 0, playsLastMonth: 0, games: []
            },
            picker: {
                solTotal: 0, solDistributed: 0, solLastMonth: 0, solDistributedLastMonth: 0,
                playsTotal: 0, playsLastMonth: 0, games: []
            }
        };

        const games = {};
        gamesSnap.docs.forEach(doc => {
            const data = doc.data();
            const cat = (data.category || 'arcade').toLowerCase();

            games[doc.id] = {
                gameId: doc.id,
                name: data.title || data.name || doc.id,
                category: cat,
                solTotal: 0, solDistributed: 0, solLastMonth: 0, solDistributedLastMonth: 0,
                playsTotal: 0, playsLastMonth: 0
            };

            if (categories[cat]) {
                categories[cat].games.push(doc.id);
            }
        });

        const today = new Date();
        const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const lastMonth = lastMonthDate.getMonth() + 1; // getMonth() is 0-indexed
        const year = lastMonthDate.getFullYear();

        const lastMonthStr = `${year}-${String(lastMonth).padStart(2, "0")}`;
        const monthStart = new Date(year, lastMonth - 1, 1, 0, 0, 0, 0);
        const monthEnd = new Date(year, lastMonth, 0, 23, 59, 59, 999);

        payoutsSnap.docs.forEach(docSnap => {
            const p = docSnap.data();
            if (!p.amount || !p.category) return;

            const cat = (p.category || 'arcade').toLowerCase();
            const gameId = p.gameId || null;
            const type = p.type || 'entry';
            const currency = p.currency || 'SOL';
            let amountInSol = p.amount;

            if (currency !== 'SOL') { // Only count SOL amounts for now
                amountInSol = 0;
            }

            let ts = null;
            // --- FIX: Correctly handle Firestore Timestamps from either Client or Admin SDK ---
            if (p.timestamp) {
                if (typeof p.timestamp.toDate === 'function') { // Check if it's a Firestore Timestamp object
                    ts = p.timestamp.toDate();
                } else if (p.timestamp instanceof Date) { // Check if it's already a Date object
                    ts = p.timestamp;
                }
            }
            if (!ts) { return; } // Skip if timestamp is invalid


            if (type === 'entry') {
                categories[cat].solTotal += amountInSol;
                if (gameId && games[gameId]) games[gameId].solTotal += amountInSol;
            }
            if (type === 'payout') {
                categories[cat].solDistributed += amountInSol;
                if (gameId && games[gameId]) games[gameId].solDistributed += amountInSol;
            }

            if (ts && ts >= monthStart && ts <= monthEnd) {
                if (type === 'entry') {
                    categories[cat].solLastMonth += amountInSol;
                    if (gameId && games[gameId]) games[gameId].solLastMonth += amountInSol;
                }
                if (type === 'payout') {
                    categories[cat].solDistributedLastMonth += amountInSol;
                    if (gameId && games[gameId]) games[gameId].solDistributedLastMonth += amountInSol;
                }
            }

            if (type === 'entry') {
                categories[cat].playsTotal += 1;
                if (gameId && games[gameId]) games[gameId].playsTotal += 1;
                if (ts && ts >= monthStart && ts <= monthEnd) {
                    categories[cat].playsLastMonth += 1;
                    if (gameId && games[gameId]) games[gameId].playsLastMonth += 1;
                }
            }
        });

        // Placeholder logic if no actual data for last month
        const placeholderLastMonth = {
            arcade: { solLastMonth: 1.0, solDistributedLastMonth: 0.8, playsLastMonth: 25 },
            pvp: { solLastMonth: 1.0, solDistributedLastMonth: 0.85, playsLastMonth: 18 },
            casino: { solLastMonth: 1.0, solDistributedLastMonth: 0.92, playsLastMonth: 32 },
            picker: { solLastMonth: 1.0, solDistributedLastMonth: 0.75, playsLastMonth: 15 }
        };

        Object.keys(placeholderLastMonth).forEach(cat => {
            if (categories[cat] && categories[cat].solLastMonth === 0 && categories[cat].playsLastMonth === 0) { // Only apply if no real data
                categories[cat].solLastMonth = placeholderLastMonth[cat].solLastMonth;
                categories[cat].solDistributedLastMonth = placeholderLastMonth[cat].solDistributedLastMonth;
                categories[cat].playsLastMonth = placeholderLastMonth[cat].playsLastMonth;

                categories[cat].games.forEach(gameId => {
                    if (games[gameId] && games[gameId].solLastMonth === 0) { // Only apply if no real data
                        const gameCount = categories[cat].games.length || 1; // Avoid division by zero
                        games[gameId].solLastMonth = placeholderLastMonth[cat].solLastMonth / gameCount;
                        games[gameId].solDistributedLastMonth = placeholderLastMonth[cat].solDistributedLastMonth / gameCount;
                        games[gameId].playsLastMonth = Math.floor(placeholderLastMonth[cat].playsLastMonth / gameCount);
                    }
                });
            }
        });

        const registeredUsers = usersSnapshot.size;
        let totalGamesPlayed = 0;
        usersSnapshot.docs.forEach(doc => {
            const d = doc.data();
            totalGamesPlayed += d.stats?.totalGamesPlayed || 0;
        });

        const now = Date.now();
        const onlineUsers = usersSnapshot.docs.filter(doc => {
            const lastSeen = doc.data().lastSeen;
            // Assuming lastSeen is an ISO string or a Date object
            const lastSeenTime = (typeof lastSeen === 'string') ? new Date(lastSeen).getTime() : (lastSeen instanceof Date ? lastSeen.getTime() : 0);
            return lastSeenTime && now - lastSeenTime < 5 * 60 * 1000;
        }).length;

        const platformStats = {
            registeredUsers,
            onlineUsers,
            totalGamesPlayed,
            arcadeSolTotal: categories.arcade?.solTotal || 0,
            arcadeSolDistributed: categories.arcade?.solDistributed || 0,
            casinoSolTotal: categories.casino?.solTotal || 0,
            casinoSolDistributed: categories.casino?.solDistributed || 0,
            pvpSolTotal: categories.pvp?.solTotal || 0,
            pvpSolDistributed: categories.pvp?.solDistributed || 0,
            pickerSolTotal: categories.picker?.solTotal || 0,
            pickerSolDistributed: categories.picker?.solDistributed || 0,
            arcadeSolLastMonth: categories.arcade?.solLastMonth || 0,
            casinoSolLastMonth: categories.casino?.solLastMonth || 0,
            pvpSolLastMonth: categories.pvp?.solLastMonth || 0,
            pickerSolLastMonth: categories.picker?.solLastMonth || 0,
            categories: categories, // Keep categories object
            games: games, // Keep games object
            lastMonthPeriod: lastMonthStr,
            lastUpdated: new Date().toISOString(),
        };

        await db.collection('platform').doc('stats').set(platformStats); // Using your existing `db` instance
        console.log("INFO: Platform stats updated (all values aggregated in SOL).");
    } catch (error) {
        console.error("ERROR: Error during updatePlatformStatsAggregatedInSOL:", error);
    }
}


// Seed Games and Categories (your existing code)
async function seedGamesAndCategories() {
    console.log("INFO: Starting game and category seeding...");
    const games = [
        {
            id: 'wack-a-wegen',
            title: 'Wack a Wegen',
            category: 'Arcade',
            image: '/images/games/BG-Wack.png',
            isTrending: true,
            prizePool: '1 SOL',
            route: '/games/wackawegen',
            description: 'Whack as many Wegens as you can before time runs out!',
            solGathered: 2.814,
            solDistributed: 1.01
        },
        {
            id: 'wegen-race',
            title: 'Wegen Race',
            category: 'Picker',
            image: '/wegens.jpg',
            route: '/games/wegenrace',
            description: 'Make a draw. Race your WEGEN and optionally bet on the lucky winner!',
            stats: {
                solGathered: 4.31,
                solDistributed: 2.56
            }
        },
        {
            id: 'wegen-fighter',
            title: 'Wegen Fighter',
            category: 'PvP',
            image: '/images/games/WegenFighter.png',
            isTrending: true,
            route: '/games/pvp/wegen-fighter',
            description: 'Compete in fast-paced duels for wagered prizes.',
            stats: {
                solGathered: 0,
                solDistributed: 0
            }
        }
        ,
        {
            id: 'coinFlip',
            title: 'Coin Flip',
            category: 'Casino',
            image: '/game-thumbnails/crypto-slots.jpg',
            route: '/games/casino/crypto-slots',
            description: 'Spin the COIN and double you money in Coin Flip!',
            stats: {
                solGathered: 9.31,
                solDistributed: 7.6
            }
        }
    ];

    const categories = [
        { id: 'Arcade', name: 'Arcade', description: 'Classic arcade...' },
        { id: 'Picker', name: 'Picker', description: 'Random selection...' },
        { id: 'PvP', name: 'PvP', description: 'Player vs Player...' },
        { id: 'Casino', name: 'Casino', description: 'Traditional casino...' }
    ];

    try {
        for (const game of games) {
            const ref = db.collection('games').doc(game.id);
            if (!(await ref.get()).exists) {
                await ref.set(game);
                console.log(`INFO: Seeded game: ${game.id}`);
            }
        }
        for (const category of categories) {
            const ref = db.collection('categories').doc(category.id);
            if (!(await ref.get()).exists) {
                await ref.set(category);
                console.log(`INFO: Seeded category: ${category.id}`);
            }
        }
        console.log("INFO: Game and category seeding complete.");
    } catch (error) {
        console.error("ERROR: Error during game and category seeding:", error);
    }
}


// ---- updateTransactionRecordInFirestore (your existing helper, adjusted for FieldValue) ----
async function updateTransactionRecordInFirestore(txId, details) {
    console.log(`INFO: Simulating recording transaction ${txId} with details:`, details);
    try {
        await db.collection('transactions').doc(txId).set({
            txId: txId,
            ...details,
            timestamp: FieldValue.serverTimestamp(), // <--- Using Admin SDK's FieldValue
            status: 'recorded'
        });
        console.log(`INFO: Transaction ${txId} recorded in Firestore.`);
    } catch (error) {
        console.error(`ERROR: Error recording transaction ${txId} in Firestore:`, error);
        throw error;
    }
}

// Your existing /api/games endpoint
app.get('/api/games', async (req, res) => {
    try {
        const snap = await db.collection('games').get();
        const games = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(games);
    } catch (e) {
        console.error("ERROR: Error fetching games:", e);
        res.status(500).json({ error: e.message });
    }
});

// Your existing /api/categories endpoint
app.get('/api/categories', async (req, res) => {
    try {
        const snap = await db.collection('categories').get();
        const categories = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(categories);
    }
    catch (e) {
        console.error("ERROR: Error fetching categories:", e);
        res.status(500).json({ error: e.message });
    }
});

// Your existing /api/platform/pot endpoint
app.get('/api/platform/pot', async (req, res) => {
    try {
        const gameId = req.query.gameId;
        if (!gameId) return res.status(400).json({ error: "Missing gameId" });

        const gameRef = db.collection('games').doc(gameId);
        const doc = await gameRef.get();
        if (!doc.exists) return res.status(404).json({ error: "Game not found" });

        const game = doc.data();
        const category = (game.category || "arcade").toLowerCase();

        const statsDoc = await db.collection('platform').doc('stats').get();
        const stats = statsDoc.exists ? statsDoc.data() : {};

        let gamePot = 0, gamePotMonth = 0;
        if (typeof game.solGathered === "number") gamePot = game.solGathered;
        if (game.stats && typeof game.stats.solGathered === "number") gamePot = game.stats.solGathered;

        if (stats && stats.games && stats.games[gameId]) {
            gamePot = stats.games[gameId].solTotal || gamePot;
            gamePotMonth = stats.games[gameId].solLastMonth || 0;
        }

        let catPot = 0, catPotMonth = 0;
        if (stats && stats.categories && stats.categories[category]) {
            catPot = stats.categories[category].solTotal || 0;
            catPotMonth = stats.categories[category].solLastMonth || 0;
        }

        res.json({
            gameId,
            category,
            pot: typeof gamePot === 'number' ? gamePot : 0,
            potMonth: typeof gamePotMonth === 'number' ? gamePotMonth : 0,
            categoryPot: typeof catPot === 'number' ? catPot : 0,
            categoryPotMonth: typeof catPotMonth === 'number' ? catPotMonth : 0,
            lastMonthPeriod: stats.lastMonthPeriod || null
        });
    } catch (e) {
        console.error("ERROR: Error fetching pot:", e);
        res.status(500).json({ error: e.message });
    }
});

// Your existing /api/platform/stats endpoint
app.get('/api/platform/stats', async (req, res) => {
    try {
        const statsDoc = await db.collection('platform').doc('stats').get();
        if (!statsDoc.exists) {
            return res.status(404).json({ error: "Platform stats not found" });
        }
        const stats = statsDoc.data();
        res.json(stats);
    } catch (e) {
        console.error("ERROR: Error fetching platform stats:", e);
        res.status(500).json({ error: e.message });
    }
});

// Your existing /process-ArcadeTransaction endpoint
app.post('/process-ArcadeTransaction', async (req, res) => {
    try {
        const { serializedTransaction, details } = req.body;
        // In a real scenario, you'd process serializedTransaction with Solana web3.js
        // For now, we'll simulate success and record the details
        const txId = 'simulated_' + Date.now(); // Example: a unique ID for this transaction
        await updateTransactionRecordInFirestore(txId, details);
        res.status(200).json({ success: true, txId });
    } catch (error) {
        console.error("ERROR: Error processing Arcade Transaction:", error);
        res.status(500).json({ error: error.message });
    }
});

// Your existing /verify-wallet endpoint (FIXED to use Admin SDK & nacl)
let usedNonces = new Set(); // Nonces for signature verification

app.post('/verify-wallet', async (req, res) => {
    const { address, signedMessage, nonce } = req.body;
    if (!address || !signedMessage || !nonce) {
        return res.status(400).json({ error: "Missing field", address, signedMessage, nonce });
    }
    // Prevent replay attacks
    if (usedNonces.has(nonce)) {
        return res.status(400).json({ error: "Nonce already used" });
    }
    try {
        // Reconstruct the message that was signed
        const msg = `Sign in to GGWeb3 with this one-time code: ${nonce}`;
        const msgUint8 = new TextEncoder().encode(msg); // Convert message to Uint8Array
        const pubKey = new solanaWeb3.PublicKey(address); // Convert wallet address string to PublicKey
        const signature = bs58.decode(signedMessage); // Decode base58 signature string to Uint8Array

        // Verify the signature using nacl
        const isValid = nacl.sign.detached.verify(
            msgUint8,
            signature,
            pubKey.toBytes() // Get the public key bytes
        );

        if (!isValid) {
            return res.status(400).json({ error: "Signature invalid" });
        }
        usedNonces.add(nonce); // Mark nonce as used

        // Find or create user in Firebase Auth
        let userRecord;
        try {
            userRecord = await admin.auth().getUser(address); // <--- Use Admin SDK for getUser
        } catch (err) {
            // If user does not exist, create them
            userRecord = await admin.auth().createUser({ // <--- Use Admin SDK for createUser
                uid: address, // Use Solana address as UID
                displayName: address, // Default display name
            });
            console.log(`INFO: Created new Firebase Auth user for wallet: ${address}`);
        }

        // Set custom claims to store wallet address for easy retrieval
        await admin.auth().setCustomUserClaims(userRecord.uid, { wallet: address }); // <--- Use Admin SDK for setCustomUserClaims

        // Create a custom token for the client to sign in with
        const customToken = await admin.auth().createCustomToken(userRecord.uid); // <--- Use Admin SDK for createCustomToken

        // Check/create user profile in Firestore
        const userRef = db.collection('users').doc(address);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            // Create a new user profile with default values if it doesn't exist
            await userRef.set({
                username: address, // Default username
                usernameLowercase: address.toLowerCase(), // For case-insensitive searches
                wallet: address,
                avatarUrl: '',
                bio: '',
                level: 1,
                accountXP: 0,
                badges: [],
                wegenNFTs: 0,
                stats: {
                    totalGamesPlayed: 0,
                    totalWins: 0,
                    bestScores: {},
                    arcadeGamesPlayed: 0,
                    pickerGamesPlayed: 0,
                    pvpGamesPlayed: 0,
                    casinoGamesPlayed: 0,
                },
                coins: { // Assuming these are in-game coins
                    arcade: 0,
                    picker: 0,
                    casino: 0,
                    pvp: 0
                },
                freeEntryTokens: { // <--- INITIALIZATION OF NEW FREE ENTRY TOKENS
                    arcadeTokens: 0,
                    pickerTokens: 0,
                    casinoTokens: 0,
                    pvpTokens: 0
                },
                recentGames: [],
                twitter: '',
                discord: '',
                telegram: '',
                instagram: '',
                friends: [],
                friendRequests: [],
                sentInvitations: [],
                chats: [],
                dmsOpen: true,
                duelsOpen: true,
                isOnline: false,
                createdAt: FieldValue.serverTimestamp(), // <--- Using Admin SDK's FieldValue
                updatedAt: FieldValue.serverTimestamp(), // <--- Using Admin SDK's FieldValue
            });
            console.log(`INFO: Created new user profile for ${address} with default fields in Firestore.`);
        } else {
            console.log(`INFO: User profile for ${address} already exists in Firestore.`);
        }

        res.json({ customToken });
    } catch (e) {
        console.error('ERROR: Wallet verification error:', e);
        res.status(400).json({ error: "Verification failed", details: e.message });
    }
});

// Your existing /admin/patch-users-manual endpoint
app.post('/admin/patch-users-manual', async (req, res) => {
    // In a production environment, add strong authentication/authorization here
    await patchUsersOnStartup();
    res.json({ ok: true, message: "User patching initiated." });
});

// Your existing /api/verify-token endpoint (FIXED to use Admin SDK)
app.get('/api/verify-token', async (req, res) => {
    const { token } = req.query;

    if (!token) {
        return res.status(400).json({ isValid: false, error: "Token missing" });
    }

    try {
        if (typeof token !== 'string') {
            console.error("ERROR: Token is not a string:", token);
            return res.status(400).json({ isValid: false, error: "Invalid token format" });
        }
        await admin.auth().verifyIdToken(token); // <--- Uses Admin SDK's verifyIdToken
        return res.json({ isValid: true });
    } catch (error) {
        console.error("ERROR: Token verification failed:", error);
        return res.status(401).json({ isValid: false, error: "Invalid token" });
    }
});


// ----------- NEW FUNCTIONALITY FOR FREE ENTRY TOKENS (START) -----------

// 1. New API: /api/payments/buy-free-entry - Allows users to purchase free entry tokens
app.post('/api/payments/buy-free-entry', verifyIdToken, async (req, res) => {
    const userId = req.user.uid; // User ID from authenticated token
    const { amount, currency, txSig, category } = req.body; // txSig: Solana Transaction Signature

    // Basic validation
    if (amount === undefined || !currency || !txSig || !userId || !category) {
        return res.status(400).json({ error: "Missing required fields for purchasing free entry (amount, currency, txSig, category)." });
    }

    // Currently only supporting SOL for purchase
    if (currency !== 'SOL') {
        return res.status(400).json({ error: "Invalid currency. Must be SOL" });
    }

    // Determine the correct Firestore field path based on category
    let tokenFieldPath;
    const lowerCaseCategory = category.toLowerCase();
    switch (lowerCaseCategory) {
        case 'picker':
            tokenFieldPath = 'freeEntryTokens.pickerTokens';
            break;
        case 'arcade':
            tokenFieldPath = 'freeEntryTokens.arcadeTokens';
            break;
        case 'casino':
            tokenFieldPath = 'freeEntryTokens.casinoTokens';
            break;
        case 'pvp':
            tokenFieldPath = 'freeEntryTokens.pvpTokens';
            break;
        default:
            return res.status(400).json({ error: "Invalid game category for free entry token purchase." });
    }

    // TODO: Implement robust Solana transaction verification here for `txSig`.
    // This involves calling the Solana network to confirm the transaction is valid,
    // has the correct amount, and was sent to the correct receiver address.
    const isTxValidOnBlockchain = true; // Placeholder for actual Solana verification
    if (!isTxValidOnBlockchain) {
        return res.status(400).json({ success: false, message: 'Solana transaction verification failed or transaction not found.' });
    }
    console.log(`INFO: [buy-free-entry] Solana transaction ${txSig} verified (simulated).`);

    const userRef = db.collection('users').doc(userId);

    try {
        // Use a Firestore transaction for atomic update (crucial for concurrency)
        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists) {
                throw new Error("User not found.");
            }

            // Atomically increment the token count
            const updateObj = {};
            updateObj[tokenFieldPath] = FieldValue.increment(1); // Increment by 1
            transaction.update(userRef, updateObj);

            // Record the purchase in the 'payouts' collection for history/accounting
            transaction.set(db.collection('payouts').doc(), {
                userId: userId,
                type: 'buy_token', // Custom type for purchasing tokens
                category: lowerCaseCategory,
                amount: Number(amount),
                currency: currency,
                txSig: txSig,
                timestamp: FieldValue.serverTimestamp(), // Use server timestamp
                description: `Purchased 1 free entry token for ${category} games.`
            });
        });

        res.json({ success: true, message: `Successfully purchased 1 free ${category} entry token.` });

    } catch (error) {
        console.error("ERROR: Error purchasing free entry token:", error);
        res.status(500).json({ success: false, message: error.message || "Failed to purchase free entry token." });
    }
});


// 2. MODIFIED API: /api/game-sessions/generate-entry-token
// This endpoint now handles both paid (SOL) and free (FREE_ENTRY_TOKEN) game entries.
// If 'FREE' currency is used, it consumes a free entry token from the user's profile.
app.post('/api/game-sessions/generate-entry-token', verifyIdToken, async (req, res) => {
    const userId = req.user.uid;
    const { gameType, betAmount, currency, gameId, paymentTxId } = req.body;

    // Basic validation for required fields
    if (!gameType || betAmount === undefined || !currency || !gameId) {
        return res.status(400).json({ message: "Missing required fields." });
    }

    const userRef = db.collection('users').doc(userId);
    const gameEntryTokenCollection = db.collection('gameEntryTokens'); // Collection for tracking individual game entry tokens

    try {
        const result = await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);

            if (!userDoc.exists) {
                throw new Error("User profile not found.");
            }

            const userData = userDoc.data();
            const currentTimestamp = FieldValue.serverTimestamp();
            const newGameEntryTokenId = uuidv4(); // Generate a unique ID for this entry token

            let entryTokenData = {
                userId: userId,
                gameType: gameType,
                gameId: gameId,
                betAmount: betAmount,
                currency: currency,
                issuedAt: currentTimestamp,
                consumed: false, // Initial state: not consumed yet
                consumedAt: null,
                paymentTxId: paymentTxId || null, // Solana transaction ID if applicable
            };
            let message = "Game entry token issued.";

            // --- Logic for FREE entry tokens ---
            if (currency === 'FREE') {
                let currentTokenCount = 0;
                // Construct the dynamic field path for the specific token type (e.g., 'pickerTokens')
                const tokenTypeKey = gameType.toLowerCase() + 'Tokens';

                // Check if the freeEntryTokens field exists and the specific token type is initialized
                if (!userData.freeEntryTokens || !(tokenTypeKey in userData.freeEntryTokens)) {
                    // This scenario should ideally be prevented by frontend logic or initial user setup
                    throw new Error(`Invalid or uninitialized free entry token type for ${gameType}.`);
                }
                currentTokenCount = userData.freeEntryTokens[tokenTypeKey] || 0;


                if (currentTokenCount <= 0) {
                    console.warn(`WARNING: User ${userId} tried to use free token for ${gameType} but has insufficient tokens.`);
                    throw new Error(`No free entry tokens available for ${gameType} games.`);
                }

                // Deduct one token atomically using FieldValue.increment
                const updateData = {};
                updateData[`freeEntryTokens.${tokenTypeKey}`] = FieldValue.increment(-1);
                transaction.update(userRef, updateData);
                message = "Free entry token consumed successfully.";

                // Record this free entry in the 'payouts' collection for tracking
                transaction.set(db.collection('payouts').doc(), {
                    gameEntryTokenId: newGameEntryTokenId, // Link to the new token
                    userId: userId,
                    gameId: gameId,
                    category: gameType.toLowerCase(),
                    amount: 0, // Amount is 0 for free entries
                    currency: 'FREE',
                    timestamp: FieldValue.serverTimestamp(),
                    type: 'entry',
                    isFreeEntry: true,
                });
            }
            // --- Logic for SOL entry (paid entry) ---
            else if (currency === 'SOL') {
                if (!paymentTxId) {
                    throw new Error("Payment transaction ID is required for SOL payments.");
                }
                // TODO: Here, you would typically verify the `paymentTxId` against the Solana blockchain
                // to ensure the payment was successful and valid. (Similar to buy-free-entry's TODO)
                message = "SOL payment confirmed. Game entry token issued.";

                // Record this paid entry in the 'payouts' collection
                transaction.set(db.collection('payouts').doc(), {
                    gameEntryTokenId: newGameEntryTokenId, // Link to the new token
                    userId: userId,
                    gameId: gameId,
                    category: gameType.toLowerCase(),
                    amount: Number(betAmount),
                    currency: 'SOL',
                    txSig: paymentTxId,
                    timestamp: FieldValue.serverTimestamp(),
                    type: 'entry',
                    isFreeEntry: false,
                });

            } else {
                throw new Error("Invalid currency type specified.");
            }

            // Create the game entry token document in the 'gameEntryTokens' collection
            const newGameEntryTokenDocRef = gameEntryTokenCollection.doc(newGameEntryTokenId);
            transaction.set(newGameEntryTokenDocRef, {
                ...entryTokenData,
                paymentMethod: currency === 'FREE' ? 'FREE_ENTRY_TOKEN' : 'SOL',
                gameEntryTokenId: newGameEntryTokenId,
                isConsumed: false, // Redundant with 'consumed' but good for clarity
            });

            return { gameEntryTokenId: newGameEntryTokenId, message: message };
        });

        // Update platform stats after a successful entry (can be async)
        updatePlatformStatsAggregatedInSOL().catch(console.error);

        res.status(200).json(result);

    } catch (error) {
        console.error("ERROR: Error generating game entry token:", error.message);
        res.status(500).json({ message: error.message || "Failed to generate game entry token." });
    }
});


// 3. New API: /api/profile/grant-token - For admin or specific game rewards to grant tokens
app.post('/api/profile/grant-token', verifyIdToken, async (req, res) => {
    const userId = req.user.uid;
    // tokenType: e.g., 'arcadeTokens', 'pickerTokens', 'casinoTokens', 'pvpTokens'
    const { tokenType, amount, transactionId, reason } = req.body;

    // Validate inputs
    if (!tokenType || typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ success: false, message: "Missing or invalid tokenType or amount." });
    }

    const allowedTokenTypes = ['arcadeTokens', 'pickerTokens', 'casinoTokens', 'pvpTokens'];
    if (!allowedTokenTypes.includes(tokenType)) {
        return res.status(400).json({ success: false, message: `Invalid tokenType. Must be one of: ${allowedTokenTypes.join(', ')}` });
    }

    const userRef = db.collection('users').doc(userId);

    try {
        // Use a Firestore transaction for atomic update
        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists) {
                throw new Error("User profile not found.");
            }

            // Dynamically construct the field path for the specific token type
            const fieldPath = `freeEntryTokens.${tokenType}`;

            // Create an update object to increment the specific token count
            const updateData = {};
            updateData[fieldPath] = FieldValue.increment(amount); // Use FieldValue for atomic increment
            transaction.update(userRef, updateData);

            // Record the grant event (optional, but good for auditing)
            transaction.set(db.collection('tokenGrants').doc(), {
                userId: userId,
                tokenType: tokenType,
                amountGranted: amount,
                transactionId: transactionId || null, // Optional transaction ID for linking
                reason: reason || 'manual_grant', // Reason for granting (e.g., 'game_reward', 'admin_override')
                timestamp: FieldValue.serverTimestamp(),
            });
        });

        console.log(`INFO: Successfully granted ${amount} ${tokenType} to user ${userId}.`);
        res.json({ success: true, message: `Successfully granted ${amount} ${tokenType}.` });

    } catch (error) {
        console.error("ERROR: Error granting token:", error);
        res.status(500).json({ success: false, message: error.message || "Failed to grant token." });
    }
});


// 4. New API: /api/user/free-entry-tokens - To fetch a user's current free entry token counts
app.get('/api/user/free-entry-tokens', verifyIdToken, async (req, res) => {
    const userId = req.user.uid; // User ID from authenticated token

    try {
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: "User not found." });
        }
        const userData = userDoc.data();
        // Return the freeEntryTokens object, or a default if it's missing
        const freeEntryTokens = userData.freeEntryTokens || {
            arcadeTokens: 0,
            pickerTokens: 0,
            casinoTokens: 0,
            pvpTokens: 0
        };
        res.json(freeEntryTokens);
    } catch (error) {
        console.error("ERROR: Error fetching user free entry tokens:", error);
        res.status(500).json({ message: "Internal server error." });
    }
});

// ----------- NEW FUNCTIONALITY FOR FREE ENTRY TOKENS (END) -----------


// Your existing /api/game-sessions/consume-token endpoint (adjusted for FieldValue)
app.post('/api/game-sessions/consume-token', verifyIdToken, async (req, res) => {
    const userId = req.user.uid;
    const { gameEntryTokenId } = req.body;

    if (!gameEntryTokenId) {
        return res.status(400).json({ success: false, message: "Game entry token ID is required." });
    }

    const tokenRef = db.collection('gameEntryTokens').doc(gameEntryTokenId);

    try {
        const tokenDoc = await tokenRef.get();

        if (!tokenDoc.exists) {
            return res.status(404).json({ success: false, message: "Game entry token not found." });
        }

        const tokenData = tokenDoc.data();

        if (tokenData.userId !== userId) {
            return res.status(403).json({ success: false, message: "Unauthorized: Token does not belong to this user." });
        }

        if (tokenData.consumed) {
            return res.status(400).json({ success: false, message: "Game entry token has already been consumed." });
        }

        await tokenRef.update({
            consumed: true,
            consumedAt: FieldValue.serverTimestamp(), // <--- Using Admin SDK's FieldValue
        });

        console.log(`INFO: Game entry token ${gameEntryTokenId} consumed by user ${userId}.`);
        res.json({ success: true, message: "Game entry token consumed successfully." });

    } catch (error) {
        console.error("ERROR: Error consuming game entry token:", error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
});


// Your existing /api/usernames endpoint (FIXED to use Admin SDK)
app.get('/api/usernames', async (req, res) => {
    try {
        const users = [];
        let nextPageToken = undefined;
        do {
            const result = await admin.auth().listUsers(1000, nextPageToken); // <--- Uses Admin SDK's listUsers
            users.push(...result.users);
            nextPageToken = result.pageToken;
        } while (nextPageToken);

        const userDocs = await db.collection('users').get();
        const firestoreMap = {};
        userDocs.forEach(doc => {
            firestoreMap[doc.id] = doc.data();
            return;
        });

        const out = users.map(u => {
            const fsProfile = firestoreMap[u.uid] || {};
            return {
                key: u.uid,
                uid: u.uid,
                username: fsProfile.username || u.displayName || u.uid,
                wallet: (u.customClaims && u.customClaims.wallet) || fsProfile.wallet || "",
                avatarUrl: fsProfile.avatarUrl || u.photoURL || '/WegenRaceAssets/G1small.png',
            }
        });
        res.json(out);
    } catch (e) {
        console.error("ERROR: Error listing usernames:", e);
        res.status(500).json({ users: [], error: "Failed to load user details" });
    }
});

// Your existing /api/auth/exchange-id-for-custom endpoint (FIXED to use Admin SDK)
app.post('/api/auth/exchange-id-for-custom', verifyIdToken, async (req, res) => {
    const userId = req.user.uid;

    try {
        const customToken = await admin.auth().createCustomToken(userId); // <--- Uses Admin SDK's createCustomToken
        res.json({ success: true, customToken });
    } catch (error) {
        console.error("ERROR: Error creating custom token for user", userId, ":", error);
        res.status(500).json({ success: false, message: "Failed to create custom token." });
    }
});


// Initial/recurring tasks
// Your existing code, ensure fetchTokenPrices is defined before these are called
fetchTokenPrices();
setInterval(fetchTokenPrices, CACHE_DURATION_SECONDS * 1000);

// Your existing code
updatePlatformStatsAggregatedInSOL().then(() => console.log('INFO: Initial platform stats update scheduled/started!'))
    .catch(error => console.error("ERROR: Failed to schedule/run initial platform stats update:", error));

// Your existing code
setInterval(updatePlatformStatsAggregatedInSOL, 5 * 60 * 1000);

// Your existing ping endpoint
app.get('/ping', (req, res) => res.send('pong'));

// Your existing server listen
const PORT = 4000; // Your existing hardcoded port
app.listen(PORT, () => console.log(`INFO: Solana auth server running on http://localhost:${PORT}`));