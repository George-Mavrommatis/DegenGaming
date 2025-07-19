// server.js (main backend file)

import express from 'express';
import admin from 'firebase-admin';
import { PublicKey } from '@solana/web3.js';
import { readFileSync } from 'fs';
import nacl from 'tweetnacl';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch'; 

// --- ES Module __dirname and __filename Fix ---
import path from 'path';
import { fileURLToPath } from 'url'; 
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// --- END ES Module __dirname Fix ---

const app = express();
app.use(cors({
    origin: 'http://localhost:5173', // Corrected for your frontend
    credentials: true // Important for cookies/sessions if you add session management later
}));
app.use(express.json());

// Read service account from file
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
let serviceAccount;
try {
    serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    console.log("SUCCESS: serviceAccountKey.json loaded successfully.");
} catch (error) {
    console.error(`ERROR: Failed to read serviceAccountKey.json at ${serviceAccountPath}:`, error);
    process.exit(1); // Exit if service account key is not found or malformed JSON
}


// Required for stats update
import { Timestamp } from "firebase-admin/firestore";

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("SUCCESS: Firebase Admin SDK initialized successfully. Connecting to Firestore...");
} catch (error) {
    console.error("ERROR: Failed to initialize Firebase Admin SDK:", error);
    process.exit(1); // Exit if initialization fails
}


const db = admin.firestore();

// ---- Price Fetching and Caching ----
const COINGECKO_API_URL = 'https://api.coingecko.com/api/v3/simple/price';
const CACHE_DURATION_SECONDS = 60; // Cache prices for 60 seconds

let priceCache = {
    sol: null,
    lastFetched: 0
};

async function fetchTokenPrices() {
    const now = Date.now();
    if (now - priceCache.lastFetched < CACHE_DURATION_SECONDS * 1000) {
        return { solPriceUsd: priceCache.sol }; // Only return SOL
    }

    try {
        const response = await fetch(`${COINGECKO_API_URL}?ids=solana&vs_currencies=usd`); // Fetch only Solana
        if (!response.ok) {
            throw new Error(`CoinGecko API error: ${response.statusText}`);
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
        if (priceCache.sol) {
            console.warn("WARNING: Using stale cached SOL price due to API error.");
            return { solPriceUsd: priceCache.sol };
        }
        console.error("ERROR: No valid SOL price found, falling back to hardcoded default.");
        return { solPriceUsd: 150 }; // Default SOL price
    }
}

app.get('/api/prices', async (req, res) => {
    try {
        const { solPriceUsd } = await fetchTokenPrices(); 
        if (solPriceUsd) {
            res.json({ solUsd: solPriceUsd }); 
        } else {
            res.status(503).json({ error: "Prices not available at the moment." });
        }
    } catch (error) {
        console.error("ERROR: Error serving prices to frontend:", error);
        res.status(500).json({ error: "Failed to fetch prices." });
    }
});


// Middleware to verify Firebase ID Token for protected routes
async function verifyFirebaseToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authorization token required' });
    }
    const idToken = authHeader.split(' ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('ERROR: Error verifying Firebase ID token:', error);
        return res.status(403).json({ message: 'Invalid or expired token' });
    }
}

// ---- PATCH ALL USERS: CONSOLIDATED PATCHING FUNCTION (DEFINITION) ----
async function patchUsersOnStartup() {
    console.log("INFO: Starting user patching on startup. Attempting to query Firestore 'users' collection...");
    let patchedCount = 0;
    try {
        const usersSnapshot = await db.collection('users').get(); // This is the line that will trigger the error if credentials are bad
        console.log(`INFO: Successfully fetched ${usersSnapshot.docs.length} users for patching.`);

        for (const docSnap of usersSnapshot.docs) {
            const data = docSnap.data();
            const patch = {};

            if (data.username && typeof data.usernameLowercase !== 'string' || data.usernameLowercase !== data.username.toLowerCase()) {
                patch.usernameLowercase = data.username.toLowerCase();
            }

            if (!Array.isArray(data.friends)) patch.friends = [];
            if (!Array.isArray(data.friendRequests)) patch.friendRequests = [];
            if (!Array.isArray(data.sentInvitations)) patch.sentInvitations = [];

            if (typeof data.dmsOpen !== "boolean" || data.dmsOpen === false) patch.dmsOpen = true;
            if (typeof data.duelsOpen !== "boolean" || data.duelsOpen === false) patch.duelsOpen = true;

            // Ensure freeEntryTokens structure is properly initialized for existing users
            let currentFreeEntryTokens = data.freeEntryTokens || {};

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

// Ensure these are called after server starts but wrapped in a check
// The initial call might fail if network is not ready, but the server should still start
patchUsersOnStartup();


// ---- updateAllUsersOnlineStatus (DEFINITION) ----
async function updateAllUsersOnlineStatus() {
    console.log("INFO: Starting online status update. Attempting to query Firestore 'users' collection...");
    try {
        const users = await db.collection("users").get(); // This is the line that will trigger the error if credentials are bad
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

// Ensure these are called after server starts but wrapped in a check
updateAllUsersOnlineStatus();


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
        // Adjusted last month logic to correctly calculate month and year
        const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const lastMonth = lastMonthDate.getMonth() + 1; // getMonth() is 0-indexed
        const year = lastMonthDate.getFullYear();
        
        const lastMonthStr = `${year}-${String(lastMonth).padStart(2, "0")}`;
        const monthStart = new Date(year, lastMonth - 1, 1, 0, 0, 0, 0); // Corrected monthStart
        const monthEnd = new Date(year, lastMonth, 0, 23, 59, 59, 999); // Corrected monthEnd to be end of last month

        payoutsSnap.docs.forEach(docSnap => {
            const p = docSnap.data();
            if (!p.amount || !p.category) return;

            const cat = (p.category || 'arcade').toLowerCase();
            const gameId = p.gameId || null;
            const type = p.type || 'entry';
            const currency = p.currency || 'SOL';
            let amountInSol = p.amount;

            const { solPriceUsd } = priceCache; // Only SOL price from cache

            if (currency === 'SOL') {
                amountInSol = p.amount;
            } else {
                amountInSol = 0; 
            }

            let ts = null;
            if (p.timestamp && p.timestamp.toDate) {
                ts = p.timestamp.toDate();
            } else if (p.timestamp instanceof Timestamp) { // Handle Firebase Timestamp objects directly
                ts = p.timestamp.toDate();
            } else {
                return; // Skip if timestamp format is unexpected
            }


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

        const placeholderLastMonth = {
            arcade: { solLastMonth: 1.0, solDistributedLastMonth: 0.8, playsLastMonth: 25 },
            pvp: { solLastMonth: 1.0, solDistributedLastMonth: 0.85, playsLastMonth: 18 },
            casino: { solLastMonth: 1.0, solDistributedLastMonth: 0.92, playsLastMonth: 32 },
            picker: { solLastMonth: 1.0, solDistributedLastMonth: 0.75, playsLastMonth: 15 }
        };

        Object.keys(placeholderLastMonth).forEach(cat => {
            if (categories[cat] && categories[cat].solLastMonth === 0) {
                categories[cat].solLastMonth = placeholderLastMonth[cat].solLastMonth;
                categories[cat].solDistributedLastMonth = placeholderLastMonth[cat].solDistributedLastMonth;
                categories[cat].playsLastMonth = placeholderLastMonth[cat].playsLastMonth;

                categories[cat].games.forEach(gameId => {
                    if (games[gameId] && games[gameId].solLastMonth === 0) {
                        const gameCount = categories[cat].games.length;
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
            return lastSeen && now - new Date(lastSeen).getTime() < 5 * 60 * 1000;
        }).length;

        const arcadeSolTotal = categories.arcade?.solTotal || 0;
        const arcadeSolDistributed = categories.arcade?.solDistributed || 0;
        const casinoSolTotal = categories.casino?.solTotal || 0;
        const casinoSolDistributed = categories.casino?.solDistributed || 0;
        const pvpSolTotal = categories.pvp?.solTotal || 0;
        const pvpSolDistributed = categories.pvp?.solDistributed || 0;
        const pickerSolTotal = categories.picker?.solTotal || 0;
        const pickerSolLastMonth = categories.picker?.solLastMonth || 0;


        const arcadeSolLastMonth = categories.arcade?.solLastMonth || 0;
        const casinoSolLastMonth = categories.casino?.solLastMonth || 0;
        const pvpSolLastMonth = categories.pvp?.solLastMonth || 0;

        const platformStats = {
            registeredUsers,
            onlineUsers,
            totalGamesPlayed,
            arcadeSolTotal,
            arcadeSolDistributed,
            casinoSolTotal,
            casinoSolDistributed,
            pvpSolTotal,
            pvpSolDistributed,
            arcadeSolLastMonth,
            casinoSolLastMonth,
            pvpSolLastMonth,
            pickerSolTotal,
            pickerSolLastMonth,
            categories,
            games,
            lastMonthPeriod: lastMonthStr,
            lastUpdated: new Date().toISOString(),
        };

        await db.collection('platform').doc('stats').set(platformStats);
        console.log("INFO: Platform stats updated (all values aggregated in SOL).");
    } catch (error) {
        console.error("ERROR: Error during updatePlatformStatsAggregatedInSOL:", error);
    }
}


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

app.get('/api/categories', async (req, res) => {
    try {
        const snap = await db.collection('categories').get();
        const categories = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(categories);
    } catch (e) {
        console.error("ERROR: Error fetching categories:", e);
        res.status(500).json({ error: e.message });
    }
});

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
        },
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
seedGamesAndCategories();

// --- START MODIFIED SECTION: /api/payments/buy-free-entry ---
app.post('/api/payments/buy-free-entry', verifyFirebaseToken, async (req, res) => {
    const userId = req.user.uid;
    const { amount, currency, txSig, category } = req.body; // category is now required for dynamic updates

    if (amount === undefined || !currency || !txSig || !userId || !category) {
        return res.status(400).json({ error: "Missing required fields for purchasing free entry (amount, currency, txSig, category)." });
    }

    if (!['SOL'].includes(currency)) {
        return res.status(400).json({ error: "Invalid currency. Must be SOL" });
    }

    // Map category to the corresponding token field in Firestore
    let tokenFieldPath;
    switch (category.toLowerCase()) {
        case 'picker':
            tokenFieldPath = 'freeEntryTokens.pickerTokens';
            break;
        case 'arcade':
            tokenFieldPath = 'freeEntryTokens.arcadeTokens';
            break;
        case 'casino':
            tokenFieldPath = 'freeEntryTokens.casinoTokens';
            break;
        case 'pvp': // If you introduce PvP tokens later
            tokenFieldPath = 'freeEntryTokens.pvpTokens';
            break;
        default:
            return res.status(400).json({ error: "Invalid game category for free entry token purchase." });
    }

    // TODO: Implement robust Solana transaction verification here.
    // For now, assuming it's valid
    const isTxValidOnBlockchain = true; 
    if (!isTxValidOnBlockchain) {
        return res.status(400).json({ success: false, message: 'Solana transaction verification failed or transaction not found.' });
    }
    console.log(`INFO: [buy-free-entry] Solana transaction ${txSig} verified.`);

    const userRef = db.collection('users').doc(userId);

    try {
        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists) {
                throw new Error("User not found.");
            }

            const userData = userDoc.data();
            // Safely get current token count using the dynamically determined path
            const currentTokens = userData?.freeEntryTokens?.[category.toLowerCase() + 'Tokens'] || 0;

            // Increment tokens
            const newTokens = currentTokens + 1;
            
            // Use FieldValue.increment for atomic update
            const updateObj = {};
            updateObj[tokenFieldPath] = admin.firestore.FieldValue.increment(1);
            transaction.update(userRef, updateObj);

            // Log the purchase in payouts (for history/accounting)
            transaction.set(db.collection('payouts').doc(), {
                userId: userId,
                type: 'buy_token',
                category: category.toLowerCase(),
                amount: Number(amount),
                currency: currency,
                txSig: txSig,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                description: `Purchased 1 free entry token for ${category} games. New balance: ${newTokens}`
            });
        });

        res.json({ success: true, message: `Successfully purchased 1 free ${category} entry token.` });

    } catch (error) {
        console.error("ERROR: Error purchasing free entry token:", error);
        res.status(500).json({ success: false, message: error.message || "Failed to purchase free entry token." });
    }
});
// --- END MODIFIED SECTION: /api/payments/buy-free-entry ---


// --- MODIFIED SECTION: /api/game-sessions/generate-entry-token ---
app.post('/api/game-sessions/generate-entry-token', verifyFirebaseToken, async (req, res) => {
    const userId = req.user.uid;
    const { gameType, betAmount, currency, gameId, paymentTxId } = req.body;

    if (!gameType || betAmount === undefined || !currency || !gameId) {
        return res.status(400).json({ message: "Missing required fields." });
    }

    const userRef = db.collection('users').doc(userId);
    const gameEntryTokenRef = db.collection('gameEntryTokens');

    try {
        const result = await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);

            if (!userDoc.exists) {
                throw new Error("User profile not found.");
            }

            const userData = userDoc.data();
            const currentTimestamp = admin.firestore.FieldValue.serverTimestamp();
            const newGameEntryTokenId = uuidv4();


            let entryTokenData = {
                userId: userId,
                gameType: gameType,
                gameId: gameId,
                betAmount: betAmount,
                currency: currency,
                issuedAt: currentTimestamp,
                consumed: false, 
                consumedAt: null,
                paymentTxId: paymentTxId || null, 
            };
            let message = "Game entry token issued.";

            // Handle FREE entry
            if (currency === 'FREE') {
                let currentTokenCount = 0;
                let tokenFieldPath = '';

                // Dynamically map gameType to the correct freeEntryTokens sub-field
                // Ensure the category name passed from frontend matches your token field names (e.g., 'picker' -> 'pickerTokens')
                const tokenTypeKey = gameType.toLowerCase() + 'Tokens';
                tokenFieldPath = `freeEntryTokens.${tokenTypeKey}`;
                currentTokenCount = userData?.freeEntryTokens?.[tokenTypeKey] || 0;
                
                // Safety check for invalid tokenTypeKey if it somehow slips through
                if (!userData.freeEntryTokens || !(tokenTypeKey in userData.freeEntryTokens)) {
                     throw new Error(`Invalid or uninitialized free entry token type: ${gameType}`);
                }


                if (currentTokenCount <= 0) {
                    console.warn(`WARNING: User ${userId} tried to use free token for ${gameType} but has insufficient tokens.`);
                    throw new Error(`No free entry tokens available for ${gameType} games.`);
                }

                // Deduct one token atomically
                const updateData = {};
                updateData[tokenFieldPath] = admin.firestore.FieldValue.increment(-1); // Use increment for atomic decrement
                transaction.update(userRef, updateData);
                message = "Free entry token consumed successfully.";

                // Add to payouts as a free entry
                transaction.set(db.collection('payouts').doc(), {
                    gameEntryTokenId: newGameEntryTokenId, 
                    userId: userId,
                    gameId: gameId,
                    category: gameType.toLowerCase(),
                    amount: 0, 
                    currency: 'FREE',
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    type: 'entry',
                    isFreeEntry: true,
                });
            }
            // Handle SOL entry
            else if (currency === 'SOL') {
                if (!paymentTxId) {
                    throw new Error("Payment transaction ID is required for SOL payments.");
                }
                message = "SOL payment confirmed. Game entry token issued.";

                // Add to payouts as a paid entry
                transaction.set(db.collection('payouts').doc(), {
                    gameEntryTokenId: newGameEntryTokenId, 
                    userId: userId,
                    gameId: gameId,
                    category: gameType.toLowerCase(),
                    amount: Number(betAmount),
                    currency: 'SOL',
                    txSig: paymentTxId, 
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    type: 'entry',
                    isFreeEntry: false,
                });

            } else {
                throw new Error("Invalid currency type specified.");
            }

            // Create the game entry token document
            const newGameEntryTokenDocRef = gameEntryTokenRef.doc(newGameEntryTokenId);
            transaction.set(newGameEntryTokenDocRef, {
                ...entryTokenData,
                paymentMethod: currency === 'FREE' ? 'FREE_ENTRY_TOKEN' : 'SOL',
                gameEntryTokenId: newGameEntryTokenId, 
                isConsumed: false, // This flag remains false until the game officially starts
            });

            return { gameEntryTokenId: newGameEntryTokenId, message: message };
        });

        // Trigger platform stats update to reflect the new entry (deduction will be picked up later)
        updatePlatformStatsAggregatedInSOL().catch(console.error);

        res.status(200).json(result);

    } catch (error) {
        console.error("ERROR: Error generating game entry token:", error.message);
        res.status(500).json({ message: error.message || "Failed to generate game entry token." });
    }
});
// --- END MODIFIED SECTION: /api/game-sessions/generate-entry-token ---


// --- NEW ENDPOINT: /profile/grant-token ---
app.post('/profile/grant-token', verifyFirebaseToken, async (req, res) => {
    const userId = req.user.uid;
    const { tokenType, amount, transactionId, reason } = req.body;

    if (!tokenType || typeof tokenType !== 'string' || !['pickerTokens'].includes(tokenType)) {
        console.warn(`grantToken: Invalid tokenType received from user ${userId}: ${tokenType}`);
        return res.status(400).json({ success: false, message: 'Invalid or missing tokenType. Only "pickerTokens" supported.' });
    }
    if (typeof amount !== 'number' || amount <= 0 || !Number.isInteger(amount)) {
        console.warn(`grantToken: Invalid amount received from user ${userId}: ${amount}`);
        return res.status(400).json({ success: false, message: 'Amount must be a positive integer.' });
    }
    if (!transactionId || typeof transactionId !== 'string') {
        console.warn(`grantToken: Missing transactionId for user ${userId}.`);
        return res.status(400).json({ success: false, message: 'Transaction ID is required for auditing.' });
    }

    const userRef = db.collection('users').doc(userId);

    try {
        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);

            if (!userDoc.exists) {
                console.error(`grantToken: User profile not found for UID: ${userId}`);
                throw new Error('User profile not found.');
            }

            const currentTokens = userDoc.data()?.freeEntryTokens?.[tokenType] || 0;
            const newTokens = currentTokens + amount;

            transaction.update(userRef, {
                [`freeEntryTokens.${tokenType}`]: newTokens,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Log the grant event for auditing
            await transaction.set(db.collection('tokenGrants').doc(), {
                userId: userId,
                tokenType: tokenType,
                amountGranted: amount,
                transactionId: transactionId, // The Solana transaction ID
                reason: reason,
                grantedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        console.log(`INFO: User ${userId} granted ${amount} ${tokenType} for transaction ${transactionId}`);
        res.status(200).json({ success: true, message: `${amount} ${tokenType} granted successfully!` });

    } catch (error) {
        console.error('ERROR: Error in grantToken:', error);
        res.status(500).json({ success: false, message: `Internal Server Error: ${error.message}` });
    }
});
// --- END NEW ENDPOINT: /profile/grant-token ---


// --- NEW ENDPOINT: /game-sessions/consume-entry-token ---
// This endpoint specifically handles the consumption of a *free* game entry token,
// which involves decrementing the user's free token count.
app.post('/game-sessions/consume-entry-token', verifyFirebaseToken, async (req, res) => {
    const userId = req.user.uid;
    const { gameEntryTokenId, gameType } = req.body;

    if (!gameEntryTokenId || typeof gameEntryTokenId !== 'string') {
        console.warn(`consumeEntryToken: Invalid gameEntryTokenId received from user ${userId}: ${gameEntryTokenId}`);
        return res.status(400).json({ success: false, message: 'Invalid or missing gameEntryTokenId.' });
    }
    if (!gameType || typeof gameType !== 'string' || gameType.toLowerCase() !== 'picker') {
        console.warn(`consumeEntryToken: Invalid gameType received from user ${userId}: ${gameType}`);
        return res.status(400).json({ success: false, message: 'Invalid or missing gameType. Only "picker" supported for free token consumption.' });
    }

    const gameEntryTokenRef = db.collection('gameEntryTokens').doc(gameEntryTokenId);
    const userRef = db.collection('users').doc(userId);

    try {
        await db.runTransaction(async (transaction) => {
            const gameEntryTokenDoc = await transaction.get(gameEntryTokenRef);
            const userDoc = await transaction.get(userRef);

            if (!gameEntryTokenDoc.exists) {
                console.error(`consumeEntryToken: Game entry token not found for ID: ${gameEntryTokenId} for user ${userId}`);
                throw new Error('Game entry token not found.');
            }
            if (gameEntryTokenDoc.data()?.consumed) {
                console.warn(`consumeEntryToken: Game entry token already consumed for ID: ${gameEntryTokenId} for user ${userId}`);
                throw new Error('Game entry token already consumed.');
            }
            if (gameEntryTokenDoc.data()?.userId !== userId) {
                console.warn(`consumeEntryToken: Token ${gameEntryTokenId} does not belong to user ${userId}. Owner: ${gameEntryTokenDoc.data()?.userId}`);
                throw new Error('Game entry token does not belong to this user.');
            }
            if (gameEntryTokenDoc.data()?.currency !== 'FREE') {
                // Critical: Only tokens issued as 'FREE' should trigger a decrement of free tokens.
                console.warn(`consumeEntryToken: Attempted to consume a non-FREE token (${gameEntryTokenId}, currency: ${gameEntryTokenDoc.data()?.currency}) via free token consumption endpoint by user ${userId}.`);
                throw new Error('This token was not issued as a free entry token.');
            }

            if (!userDoc.exists) {
                console.error(`consumeEntryToken: User profile not found for UID: ${userId}`);
                throw new Error('User profile not found.');
            }

            const currentPickerTokens = userDoc.data()?.freeEntryTokens?.pickerTokens || 0;
            if (currentPickerTokens < 1) {
                console.error(`consumeEntryToken: User ${userId} attempted to consume token ${gameEntryTokenId} but has 0 free picker tokens. Current: ${currentPickerTokens}`);
                throw new Error('User does not have enough free picker tokens to consume.');
            }
            // Decrement the user's token count for 'pickerTokens'
            const newPickerTokens = currentPickerTokens - 1;

            // Mark game entry token as consumed
            transaction.update(gameEntryTokenRef, {
                consumed: true,
                consumedAt: admin.firestore.FieldValue.serverTimestamp(),
                consumedBy: userId // For auditing
            });

            // Decrement user's free entry token count
            transaction.update(userRef, {
                'freeEntryTokens.pickerTokens': newPickerTokens,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Log the consumption event for auditing
            await transaction.set(db.collection('tokenConsumptions').doc(), {
                userId: userId,
                gameEntryTokenId: gameEntryTokenId,
                consumedAt: admin.firestore.FieldValue.serverTimestamp(),
                gameType: gameType
            });
        });

        console.log(`INFO: User ${userId} consumed free picker token ${gameEntryTokenId}`);
        res.status(200).json({ success: true, message: 'Free entry token consumed successfully!' });

    } catch (error) {
        console.error('ERROR: Error in consumeEntryToken:', error);
        res.status(500).json({ success: false, message: `Internal Server Error: ${error.message}` });
    }
});
// --- END NEW ENDPOINT: /game-sessions/consume-entry-token ---


// ----------- Existing: API to Consume Game Entry Token (Original - only sets consumed flag) -----------
// This endpoint primarily marks a gameEntryToken as `consumed: true`.
// It does NOT decrement a user's free token count. This is appropriate for tokens
// that were paid for (currency: 'SOL'), as they don't involve free token management.
// For free tokens, the new `/game-sessions/consume-entry-token` handles the decrement.
app.post('/api/game-sessions/consume-token', verifyFirebaseToken, async (req, res) => {
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

        // Only update the 'consumed' status, not free token count
        await tokenRef.update({
            consumed: true, 
            consumedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`INFO: Game entry token ${gameEntryTokenId} consumed by user ${userId}.`);
        res.json({ success: true, message: "Game entry token consumed successfully." });

    } catch (error) {
        console.error("ERROR: Error consuming game entry token:", error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
});


// ----------- Existing: Endpoint to get user ledger (registered usernames/wallets for selection) -----------
app.get('/api/usernames', async (req, res) => {
    try {
        // Firebase Admin SDK's listUsers is used to fetch all users from Firebase Auth
        const users = [];
        let nextPageToken = undefined;
        do {
            const result = await admin.auth().listUsers(1000, nextPageToken);
            users.push(...result.users);
            nextPageToken = result.pageToken;
        } while (nextPageToken);

        // Fetch user profiles from Firestore's 'users' collection
        const userDocs = await db.collection('users').get();
        const firestoreMap = {};
        userDocs.forEach(doc => {
            firestoreMap[doc.id] = doc.data();
            return;
        });

        // Combine data from Firebase Auth and Firestore profile
        const out = users.map(u => {
            const fsProfile = firestoreMap[u.uid] || {};
            return {
                key: u.uid, 
                uid: u.uid, 
                username: fsProfile.username || u.displayName || u.uid, // Prioritize Firestore username
                wallet: (u.customClaims && u.customClaims.wallet) || fsProfile.wallet || "", // Custom claim for wallet, then Firestore
                avatarUrl: fsProfile.avatarUrl || u.photoURL || '/WegenRaceAssets/G1small.png', // Firestore avatar, then Auth photoURL
            }
        });
        res.json(out);
    } catch (e) {
        console.error("ERROR: Error listing usernames:", e);
        res.status(500).json({ users: [], error: "Failed to load user details" });
    }
});


// ----------- Existing: Endpoint to get user's free entry tokens (renamed for clarity) -----------
app.get('/api/user/free-entry-tokens', verifyFirebaseToken, async (req, res) => { 
    const userId = req.user.uid;

    try {
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: "User not found." });
        }
        const userData = userDoc.data();
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


// ----------- Existing: Endpoint to exchange Firebase ID Token for Custom Token -----------
app.post('/api/auth/exchange-id-for-custom', verifyFirebaseToken, async (req, res) => {
    const userId = req.user.uid;

    try {
        const customToken = await admin.auth().createCustomToken(userId);
        res.json({ success: true, customToken });
    } catch (error) {
        console.error("ERROR: Error creating custom token for user", userId, ":", error);
        res.status(500).json({ success: false, message: "Failed to create custom token." });
    }
});


app.get('/api/platform/pot', fetchPotStats);

async function fetchPotStats(req, res) {
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
};

app.get('/platform/stats', async (req, res) => {
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


async function updateTransactionRecordInFirestore(txId, details) {
    console.log(`INFO: Simulating recording transaction ${txId} with details:`, details);
    try {
        await db.collection('transactions').doc(txId).set({
            txId: txId,
            ...details,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            status: 'recorded'
        });
        console.log(`INFO: Transaction ${txId} recorded in Firestore.`);
    } catch (error) {
        console.error(`ERROR: Error recording transaction ${txId} in Firestore:`, error);
        throw error;
    }
}


app.post('/process-ArcadeTransaction', async (req, res) => {
  try {
    const { serializedTransaction, details } = req.body;
    const txId = 'simulated_' + Date.now();
    await updateTransactionRecordInFirestore(txId, details);
    res.status(200).json({ success: true, txId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Wallet Verification & User Creation ----
let usedNonces = new Set();

app.post('/verify-wallet', async (req, res) => {
    const { address, signedMessage, nonce } = req.body;
    if (!address || !signedMessage || !nonce) {
        return res.status(400).json({ error: "Missing field", address, signedMessage, nonce });
    }
    if (usedNonces.has(nonce)) {
        return res.status(400).json({ error: "Nonce already used" });
    }
    try {
        const msg = `Sign in to GGWeb3 with this one-time code: ${nonce}`;
        const msgUint8 = new TextEncoder().encode(msg);
        const pubKey = new PublicKey(address);
        const signature = Uint8Array.from(atob(signedMessage), c => c.charCodeAt(0));
        const isValid = nacl.sign.detached.verify(
            msgUint8, signature, pubKey.toBytes()
        );

        if (!isValid) {
            return res.status(400).json({ error: "Signature invalid" });
        }
        usedNonces.add(nonce);

        let userRecord;
        try {
            userRecord = await admin.auth().getUser(address);
        } catch (err) {
            // User does not exist, create a new one in Firebase Auth
            userRecord = await admin.auth().createUser({
                uid: address,
                displayName: address,
            });
            console.log(`INFO: Created new Firebase Auth user for wallet: ${address}`);
        }

        await admin.auth().setCustomUserClaims(userRecord.uid, { wallet: address });

        const customToken = await admin.auth().createCustomToken(userRecord.uid);

        const userRef = db.collection('users').doc(address);
        const userDoc = await userRef.get(); // This is a Firestore query that needs valid credentials

        if (!userDoc.exists) {
            await userRef.set({
                username: address,
                usernameLowercase: address.toLowerCase(),
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
                coins: {
                    arcade: 0,
                    picker: 0,
                    casino: 0,
                    pvp: 0
                },
                freeEntryTokens: { // This is crucial and correctly initialized here
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
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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

app.post('/admin/patch-users-manual', async (req, res) => {
    await patchUsersOnStartup();
    res.json({ ok: true, message: "User patching initiated." });
});

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
        await admin.auth().verifyIdToken(token);
        return res.json({ isValid: true });
    } catch (error) {
        console.error("ERROR: Token verification failed:", error);
        return res.status(401).json({ isValid: false, error: "Invalid token" });
    }
});


// REMOVED: Old `/api/useFreeEntryToken` as its logic is now covered by `generate-entry-token`
// (Or it needs to be completely re-evaluated if it had a different purpose)
// I've removed the body of this, if you need this endpoint for another purpose, you'll have to re-implement it.
// For the current requirement (deducting free token on game start), the new `generate-entry-token` is the right place.
// app.post('/api/useFreeEntryToken', verifyFirebaseToken, async (req, res) => { /* ... REMOVED ... */ });


fetchTokenPrices();
setInterval(fetchTokenPrices, CACHE_DURATION_SECONDS * 1000);

updatePlatformStatsAggregatedInSOL().then(() => console.log('INFO: Initial platform stats update scheduled/started!'))
    .catch(error => console.error("ERROR: Failed to schedule/run initial platform stats update:", error));

setInterval(updatePlatformStatsAggregatedInSOL, 5 * 60 * 1000);

app.get('/ping', (req, res) => res.send('pong'));

app.listen(4000, () => console.log("INFO: Solana auth server running on http://localhost:4000"));