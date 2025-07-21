// server.js (Complete, Consolidated, and Corrected Version - NO REALTIME DATABASE AT ALL)

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';

import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore'; // Explicitly import getFirestore
import { getAuth } from 'firebase-admin/auth'; // Explicitly import getAuth

import {
    Connection,
    PublicKey,
    clusterApiUrl,
    Transaction,
    Keypair,
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
        // REALTIME DATABASE IS PERMANENTLY REMOVED: NO databaseURL IS SPECIFIED
    });

    // Initialize specific Firebase services
    db = getFirestore(); // Initialize Firestore
    auth = getAuth();    // Initialize Auth

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
const SOLANA_CLUSTER = 'devnet'; // Change to 'mainnet-beta' for production
const connection = new Connection(clusterApiUrl(SOLANA_CLUSTER), 'confirmed');

const ADMIN_WALLET_PRIVATE_KEY_BASE58 = process.env.ADMIN_WALLET_PRIVATE_KEY_BASE58;
let adminWalletKeypair;
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

let gameTokenMint = null;
const GAME_TOKEN_DECIMALS = 9; // Decimals for your game token


// --- Express App Setup ---
const app = express();
const PORT = process.env.PORT || 4000;

const corsOptions = {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173'], // Ensure all your frontend origins are listed
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());


const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: corsOptions // Apply CORS to Socket.IO as well
});


// --- Helper Functions ---
function getUserDocRef(uid) {
    return db.collection('users').doc(uid);
}

// Helper function to get online user UIDs - Now a standalone function
// This function will be used by both the API endpoint and Socket.IO events.
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
        return []; // Return empty array on error
    }
}


// --- Socket.IO Connection Handling (Presence now fully in Firestore) ---
io.on('connection', (socket) => {
    console.log('A user connected via Socket.IO');

    // Socket.on 'setUid' is crucial for associating a user with their socket
    socket.on('setUid', async (uid) => {
        socket.data.uid = uid; // Store UID in socket for later use (e.g., on disconnect)
        
        try {
            // Update isOnline and lastSeen in Firestore
            await db.collection('users').doc(uid).update({
                isOnline: true,
                lastSeen: admin.firestore.FieldValue.serverTimestamp(),
            });
            console.log(`User ${uid} connected and presence set in Firestore.`);
            
            // Emit the updated list of online users to all clients
            const onlineUserIds = await getOnlineUserIds(); // Call the helper function
            io.emit('onlineUsersUpdate', onlineUserIds); // Emit to all for real-time update
        } catch (error) {
            console.error(`Error setting online status for user ${uid} in Firestore:`, error);
        }
    });

    socket.on('disconnect', async () => {
        console.log('User disconnected from Socket.IO');
        const uid = socket.data.uid;
        if (uid) {
            try {
                // Update lastSeen and isOnline in Firestore
                await db.collection('users').doc(uid).update({
                    isOnline: false,
                    lastSeen: admin.firestore.FieldValue.serverTimestamp(),
                });
                console.log(`User ${uid} disconnected and presence updated in Firestore.`);

                // Emit the updated list of online users to all clients
                const onlineUserIds = await getOnlineUserIds(); // Call the helper function
                io.emit('onlineUsersUpdate', onlineUserIds); // Emit to all for real-time update
            } catch (error) {
                console.error(`Error setting offline status for user ${uid} in Firestore:`, error);
            }
        }
    });

    // Game-related Socket.IO events (as in your original)
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
});


// --- Solana Token Management Functions ---
// (These functions are critical for your Solana interactions)

// Creates a new SPL token mint if one doesn't exist or isn't configured
async function createGameTokenMint() {
    if (!adminWalletKeypair) {
        console.error("Admin wallet not loaded. Cannot create token mint.");
        return null;
    }
    try {
        console.log("Creating new SPL token mint...");
        const mint = await createMint(
            connection,
            adminWalletKeypair, // Payer
            adminWalletKeypair.publicKey, // Mint Authority
            null, // Freeze Authority (null means no freeze authority)
            GAME_TOKEN_DECIMALS // Decimals
        );
        gameTokenMint = mint;
        console.log('Game Token Mint created:', gameTokenMint.toBase58());

        // Store the mint address in Firestore settings for persistence
        await db.collection('settings').doc('solana').set({
            gameTokenMintAddress: gameTokenMint.toBase58()
        }, { merge: true });

        return mint;
    } catch (error) {
        console.error("Error creating game token mint:", error);
        return null;
    }
}

// Ensures the game token mint is loaded, either from Firestore or by creating a new one
async function ensureGameTokenMint() {
    if (gameTokenMint) return gameTokenMint; // Already loaded

    const settingsDoc = await db.collection('settings').doc('solana').get();
    if (settingsDoc.exists && settingsDoc.data().gameTokenMintAddress) {
        gameTokenMint = new PublicKey(settingsDoc.data().gameTokenMintAddress);
        console.log('Game Token Mint loaded from Firestore:', gameTokenMint.toBase58());
        return gameTokenMint;
    }

    // If not found in Firestore, create a new one
    return await createGameTokenMint();
}

// Mints new tokens to a recipient's ATA
async function mintSolanaToken(recipientPublicKey, amount) {
    if (!adminWalletKeypair || !gameTokenMint) {
        console.error("Admin wallet or game token mint not initialized.");
        return false;
    }
    try {
        // Get or create the Associated Token Account (ATA) for the recipient
        const recipientATA = await getOrCreateAssociatedTokenAccount(
            connection,
            adminWalletKeypair, // Payer for creating ATA if it doesn't exist
            gameTokenMint,
            recipientPublicKey // Owner of the ATA
        );

        // Mint tokens to the recipient's ATA
        const signature = await mintTo(
            connection,
            adminWalletKeypair, // Payer
            gameTokenMint, // Mint Public Key
            recipientATA.address, // Destination ATA
            adminWalletKeypair.publicKey, // Mint Authority (admin wallet owns the mint)
            amount // Amount to mint
        );
        console.log(`Minted ${amount} tokens to ${recipientPublicKey.toBase58()}. Tx: ${signature}`);
        return true;
    } catch (error) {
        console.error("Error minting Solana token:", error);
        return false;
    }
}

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
        return true;
    } catch (error) {
        console.error("Error transferring Solana token:", error);
        return false;
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


// --- Game Logic Functions (Firestore-based) ---
async function getGameState(gameId) {
    const gameDoc = await db.collection('games').doc(gameId).get();
    return gameDoc.exists ? gameDoc.data() : null;
}

async function updateGameState(gameId, newState) {
    const gameRef = db.collection('games').doc(gameId);
    await gameRef.update(newState);
    // Optionally, fetch full state to emit, or just emit partial update
    const updatedGame = await getGameState(gameId);
    io.to(gameId).emit('gameStateUpdate', updatedGame); // Notify clients in game room
}

// Consolidated Reward Function: handles both claiming winnings and general collection
// This function will replace both claimReward and collectReward
async function processReward(gameId, userId, amount, isWinnerClaim = false) {
    try {
        const gameDocRef = db.collection('games').doc(gameId);
        const gameDoc = await gameDocRef.get();
        if (!gameDoc.exists) throw new Error('Game not found.');

        const gameData = gameDoc.data();
        let userSolanaAddress;

        // Determine the recipient based on whether it's a winner's claim or general collection
        if (isWinnerClaim) {
            // Logic for a winner claiming their specific reward
            if (gameData.winnerId !== userId || gameData.status !== 'completed_winnings' || gameData.claimed) {
                throw new Error('Not eligible to claim reward for this game or already claimed.');
            }
            const userDoc = await getUserDocRef(userId).get();
            if (!userDoc.exists || !userDoc.data().wallet) {
                throw new Error('User Solana wallet address not found for claiming.');
            }
            userSolanaAddress = new PublicKey(userDoc.data().wallet);
        } else {
            // Logic for general collection (e.g., by admin or a system process)
            // This assumes 'amount' is already the raw amount to transfer for this collection instance
            if (gameData.status !== 'completed' && gameData.status !== 'rewarded') {
                throw new Error('Game is not in a state to collect rewards.');
            }
            if (gameData.collectedBy && gameData.collectedBy[userId]) {
                 // You might want to allow multiple collections per user in some cases,
                 // but for this example, assuming one per user per game for general collection
                throw new Error('Reward already collected by this user for this game.');
            }

            const userDoc = await getUserDocRef(userId).get();
            if (userDoc.exists && userDoc.data().wallet) {
                userSolanaAddress = new PublicKey(userDoc.data().wallet);
            } else {
                if (!adminWalletKeypair) throw new Error('Admin wallet not initialized for fallback.');
                console.warn(`User ${userId} has no linked Solana wallet address. Reward will be collected to admin wallet as fallback.`);
                userSolanaAddress = adminWalletKeypair.publicKey;
            }
        }
        
        const transferSuccess = await transferSolanaToken(userSolanaAddress, amount);
        if (!transferSuccess) {
            throw new Error('Failed to transfer Solana tokens for reward.');
        }

        // Update game state based on type of claim
        if (isWinnerClaim) {
            await gameDocRef.update({
                claimed: true,
                claimedAt: admin.firestore.FieldValue.serverTimestamp(),
                // Optionally change status for the game from 'completed_winnings' to 'claimed'
            });
            console.log(`Winner's reward of ${amount / (10 ** GAME_TOKEN_DECIMALS)} tokens claimed by ${userId} for game ${gameId}`);
        } else {
            await gameDocRef.update({
                [`collectedBy.${userId}`]: admin.firestore.FieldValue.serverTimestamp(),
                status: 'rewarded' // Mark game as rewarded in Firestore
            });
            console.log(`General reward of ${amount / (10 ** GAME_TOKEN_DECIMALS)} tokens collected by ${userId} (or admin) for game ${gameId}`);
        }
        
        return { success: true, message: 'Reward processed successfully!' };
    } catch (error) {
        console.error(`Error processing reward for user ${userId} in game ${gameId}:`, error);
        return { success: false, message: error.message };
    }
}


async function finishRound(gameId, roundResult) {
    console.log(`Finishing round for game ${gameId} with result:`, roundResult);
    const currentGameState = await getGameState(gameId); // Get current state from Firestore
    await updateGameState(gameId, { // Update in Firestore
        currentRound: (currentGameState ? currentGameState.currentRound : 0) + 1, // Handle potential null state
        lastRoundResult: roundResult,
        status: 'round_ended',
    });
}


// --- Scheduled Tasks (Cron Jobs) ---
// (These run periodically to update platform stats)

async function updatePlatformStatsAggregatedInSol() {
    console.log('Running updatePlatformStatsAggregatedInSol...');
    try {
        const registeredUsersSnapshot = await db.collection('users').get();
        const registeredUsers = registeredUsersSnapshot.size;

        const statsDocRef = db.collection('platform').doc('stats');
        const statsDoc = await statsDocRef.get();

        // Initialize or retrieve current stats, ensuring all fields exist
        let currentStats = {
            registeredUsers: 0,
            onlineUsers: 0, 
            totalGamesPlayed: 0,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            lastMonthPeriod: new Date().getFullYear() + '-' + (new Date().getMonth()).toString().padStart(2, '0'),
            categories: { 
                arcade: { solTotal: 0, solLastMonth: 0, solDistributed: 0, solDistributedLastMonth: 0, playsTotal: 0, playsLastMonth: 0, games: [] },
                pvp: { solTotal: 0, solLastMonth: 0, solDistributed: 0, solDistributedLastMonth: 0, playsTotal: 0, playsLastMonth: 0, games: [] },
                casino: { solTotal: 0, solLastMonth: 0, solDistributed: 0, solDistributedLastMonth: 0, playsTotal: 0, playsLastMonth: 0, games: [] },
                picker: { solTotal: 0, solLastMonth: 0, solDistributed: 0, solDistributedLastMonth: 0, playsTotal: 0, playsLastMonth: 0, games: [] },
            },
            games: {} // Placeholder for per-game stats if needed
        };

        if (statsDoc.exists) {
            Object.assign(currentStats, statsDoc.data());
        }
        currentStats.registeredUsers = registeredUsers; 

        await statsDocRef.set(currentStats, { merge: true }); // Merge to avoid overwriting unrelated fields
        console.log('Platform stats updated successfully in Firestore.');

    } catch (error) {
        console.error('Error updating platform stats:', error);
    }
}

async function updateALLUsersOnlineStatus() {
    console.log('Running updateALLUsersOnlineStatus...');
    try {
        // Query Firestore for users where isOnline is true
        const onlineUsersSnapshot = await db.collection('users')
            .where('isOnline', '==', true)
            .get();
        const onlineUsersCount = onlineUsersSnapshot.size;

        const statsDocRef = db.collection('platform').doc('stats');
        await statsDocRef.set({
            onlineUsers: onlineUsersCount,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log(`Online users updated: ${onlineUsersCount}`);
    } catch (error) {
        console.error('Error updating online users status:', error);
    }
}

// Cron job to aggregate platform stats every 5 minutes
cron.schedule('*/5 * * * *', () => { 
    console.log('Cron job: Aggregating platform stats...');
    updatePlatformStatsAggregatedInSol();
});

// Cron job to update online user status every 1 minute
cron.schedule('*/1 * * * *', () => { 
    console.log('Cron job: Updating online user status...');
    updateALLUsersOnlineStatus();
});


// --- Public API Routes (NO authentication middleware applied) ---
// These routes can be accessed without a Firebase ID token.

app.get('/', (req, res) => {
    res.send('DegenGaming Backend is running!');
});

app.get("/platform/stats", async (req, res) => {
    try {
        const statsDoc = await db.collection('platform').doc('stats').get();
        if (!statsDoc.exists) {
            return res.status(404).json({ message: "Platform statistics not found." });
        }
        res.json(statsDoc.data());
    } catch (error) {
        console.error("Error fetching platform stats:", error);
        res.status(500).json({ message: "Internal server error fetching platform stats." });
    }
});

app.get('/games', async (req, res) => {
    try {
        const gamesSnapshot = await db.collection('games').get();
        const games = gamesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(games);
    }
    catch (error) {
        console.error("Error fetching games:", error);
        res.status(500).json({ message: "Internal server error fetching games." });
    }
});

app.get('/games/categories', async (req, res) => {
    try {
        const categoriesSnapshot = await db.collection('categories').get();
        const categories = categoriesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(categories);
    } catch (error) {
        console.error("Error fetching game categories:", error);
        res.status(500).json({ message: "Internal server error fetching game categories." });
    }
});

app.get('/game-tokens/:address', async (req, res) => {
    try {
        const { address } = req.params;
        const mintPublicKey = await ensureGameTokenMint(); // Ensure game token mint is loaded
        if (!mintPublicKey) {
            return res.status(500).json({ error: "Game token mint not initialized on server." });
        }

        const ownerPublicKey = new PublicKey(address);
        let tokenAmount = 0;
        try {
            // Get the Associated Token Account (ATA) address for this owner and mint
            const tokenAccountAddress = await getAssociatedTokenAddress(mintPublicKey, ownerPublicKey, true); // `true` for allowUnfunded
            // Fetch the account info and get the amount
            const accountInfo = await getAccount(connection, tokenAccountAddress);
            tokenAmount = Number(accountInfo.amount); // Returns raw amount (e.g., 1_000_000_000 for 1 token if decimals is 9)
        } catch (e) {
            // If the ATA doesn't exist, it means the balance is 0 for that mint
            if (e.message.includes('Account does not exist') || e.message.includes('could not find account')) {
                tokenAmount = 0;
            } else {
                console.error(`Error fetching token account for ${address} and mint ${mintPublicKey.toBase58()}:`, e);
                return res.status(500).json({ error: "Failed to fetch token balance." });
            }
        }
        // Return balance along with decimals so frontend can format it correctly
        res.json({ address, balance: tokenAmount, decimals: GAME_TOKEN_DECIMALS });
    } catch (error) {
        console.error("Error in /game-tokens/:address:", error);
        res.status(500).json({ error: "Internal server error fetching game tokens." });
    }
});

// PUBLIC ROUTE: Endpoint to get currently online user UIDs (publicly accessible)
app.get('/onlineUsers', async (req, res) => {
    try {
        const onlineUserIds = await getOnlineUserIds(); // Uses the helper function defined above
        res.json({ onlineUserIds });
    } catch (error) {
        // Error already logged in getOnlineUserIds, just send generic response
        res.status(500).json({ message: "Failed to fetch online users." });
    }
});


// Wallet Verification Endpoint (Solana Sign-In) - Crucial for initial login flow
app.post("/verify-wallet", async (req, res) => {
    try {
        const { address, signedMessage, nonce } = req.body;

        if (!address || !signedMessage || !nonce) {
            return res.status(400).json({ error: "Missing parameters" });
        }

        // IMPORTANT: The message string MUST EXACTLY match what the frontend signs.
        const message = `Sign in to Degen Gaming with this one-time code: ${nonce}`;
        const messageBytes = new TextEncoder().encode(message); 

        let signatureBytes;
        try {
            // Convert base64 signature string back to a Buffer/Uint8Array
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
                    avatarUrl: '/WegenRaceAssets/G1small.png', // Default avatar URL (matches your DEFAULT_PROFILE)
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    isOnline: true, // Set to true as they just logged in
                    lastSeen: admin.firestore.FieldValue.serverTimestamp(), 
                    dmsOpen: true,
                    duelsOpen: true,
                    stats: { 
                        arcadeXP: 0, 
                        pickerArcade: 0, 
                        pickerCasino: 0, 
                        totalGamesPlayed: 0, 
                        totalWins: 0, 
                        bestScores: {}, 
                        arcadeGamesPlayed: 0, 
                        pickerGamesPlayed: 0, 
                        pvpGamesPlayed: 0, 
                        casinoGamesPlayed: 0 
                    },
                    coins: { arcade: 0, picker: 0, casino: 0, pvp: 0 },
                    freeEntryTokens: { arcade: 0, picker: 0, casino: 0, pvp: 0 }, // Initial free entry tokens
                    recentGames: [],
                    friends: [],
                    friendRequests: [],
                    sentInvitations: [],
                    duelInvitations: [],
                    twitter: "",
                    discord: "",
                    telegram: "",
                    instagram: "",
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


// --- Firebase Authentication Middleware ---
// All routes defined AFTER this middleware will require a valid Firebase ID token
// The token is passed in the 'Authorization' header as 'Bearer <idToken>'
app.use(async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const idToken = authHeader.split(' ')[1];
        try {
            const decodedToken = await auth.verifyIdToken(idToken);
            req.user = decodedToken; // Attach decoded token (Firebase user data) to the request object
            next(); // Proceed to the next middleware or route handler
        } catch (error) {
            console.error("Firebase auth verification error (invalid/expired token):", error);
            res.status(401).send('Unauthorized: Invalid or expired token.');
        }
    } else {
        res.status(401).send('Unauthorized: No token provided.');
    }
});


// --- Authenticated Routes ---
// These routes require a valid Firebase ID token (handled by the middleware above)

// Connects/updates a user's Solana wallet address in their Firestore profile
app.post('/connect-to-wallet', async (req, res) => {
    const userId = req.user.uid; // UID from decoded Firebase token
    const { solanaAddress } = req.body;

    if (!solanaAddress) {
        return res.status(400).send('Solana address is required');
    }

    try {
        const userDocRef = getUserDocRef(userId);
        await userDocRef.update({
            wallet: solanaAddress, 
            lastSeen: admin.firestore.FieldValue.serverTimestamp() // Update last seen on wallet connection
        });
        console.log(`User ${userId} connected Solana wallet ${solanaAddress}`);
        res.status(200).send('Wallet connected successfully');
    } catch (error) {
        console.error("Error connecting wallet:", error);
        res.status(500).send('Failed to connect wallet');
    }
});

// Initiates a game play, potentially involving a token wager
app.post('/play', async (req, res) => {
    const userId = req.user.uid;
    const { gameId, wagerAmount, prediction } = req.body; 

    try {
        const userDoc = await getUserDocRef(userId).get();
        if (!userDoc.exists || !userDoc.data().wallet) {
            return res.status(400).send('User or Solana wallet address is not linked.');
        }
        const userSolanaAddress = new PublicKey(userDoc.data().wallet);

        if (!adminWalletKeypair || !gameTokenMint) {
            return res.status(500).send('Server wallet or token mint not initialized.');
        }

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
        // Use set to create if not exists, update if exists (or merge for partial updates)
        await db.collection('games').doc(gameId).set({
            gameId,
            userId,
            wagerAmount,
            prediction,
            status: 'pending_transaction', // Game status while waiting for transaction
            createdAt: admin.firestore.FieldValue.serverTimestamp(), // Use Firestore timestamp
            userSolanaAddress: userSolanaAddress.toBase58()
        }, { merge: true }); // Merge to avoid overwriting existing fields if document already exists
        
        console.log(`User ${userId} placed wager of ${wagerAmount / (10 ** GAME_TOKEN_DECIMALS)} in game ${gameId}`);
        // Respond with success and the serialized transaction for frontend signing
        res.json({ success: true, message: 'Game initiated, please sign transaction.', transaction: serializedTransaction });

    } catch (error) {
        console.error("Error initiating play:", error);
        res.status(500).send('Failed to initiate play');
    }
});

// Updates game state after a Solana transaction is confirmed
app.post('/game-state-update', async (req, res) => {
    const userId = req.user.uid;
    const { gameId, transactionSignature, status } = req.body; 

    try {
        // Confirm the Solana transaction
        const confirmation = await connection.confirmTransaction(transactionSignature, 'confirmed');
        if (confirmation.value.err) {
            console.error("Transaction failed on Solana:", confirmation.value.err);
            await updateGameState(gameId, { status: 'failed_wager', transactionError: confirmation.value.err.toString() }); // Update in Firestore
            return res.status(400).send('Solana transaction failed or was not confirmed.');
        }

        // Update game state in Firestore with transaction details
        await updateGameState(gameId, { // Update in Firestore
            status: status, 
            transactionSignature: transactionSignature,
            confirmedAt: admin.firestore.FieldValue.serverTimestamp() // Use Firestore timestamp
        });

        console.log(`Game ${gameId} status updated to ${status} by user ${userId}`);
        res.status(200).send('Game state updated.');
    } catch (error) {
        console.error("Error updating game state:", error);
        res.status(500).send('Failed to update game state.');
    }
});

// CONSOLIDATED REWARD ENDPOINT: /process-reward
// This endpoint now handles both winner claims and general collection.
app.post('/process-reward', async (req, res) => {
    const userId = req.user.uid;
    const { gameId, amount, isWinnerClaim = false } = req.body; 

    try {
        // Ensure amount is converted to raw (lamports) for transfer if it's not already
        const rawAmount = amount * (10 ** GAME_TOKEN_DECIMALS); 
        
        const result = await processReward(gameId, userId, rawAmount, isWinnerClaim);
        if (result.success) {
            res.status(200).send(result.message);
        } else {
            res.status(400).send(result.message);
        }
    } catch (error) {
        console.error("Error in /process-reward endpoint:", error);
        res.status(500).send('Internal server error during reward processing.');
    }
});


// Logs out the user from Firebase and updates their online status
app.post('/logout', async (req, res) => {
    const userId = req.user.uid;
    try {
        // Update user's online status and last seen in Firestore
        await getUserDocRef(userId).update({
            lastSeen: admin.firestore.FieldValue.serverTimestamp(), 
            isOnline: false 
        });

        console.log(`User ${userId} logged out and presence updated in Firestore.`);
        // Emit updated online users list
        const onlineUserIds = await getOnlineUserIds(); // Call the helper function
        io.emit('onlineUsersUpdate', onlineUserIds);

        res.status(200).send('Logged out successfully');
    } catch (error) {
        console.error("Error logging out:", error);
        res.status(500).send('Failed to log out');
    }
});

// GET authenticated user's profile data
app.get('/user-profile', async (req, res) => {
    const userId = req.user.uid; // UID from decoded Firebase token
    try {
        const userDoc = await getUserDocRef(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: "User profile not found." });
        }
        res.status(200).json(userDoc.data());
    } catch (error) {
        console.error("Error fetching user profile:", error);
        res.status(500).json({ message: "Failed to fetch user profile." });
    }
});

// GET any user's profile data by their UID
app.get('/users/:uid', async (req, res) => {
    const { uid } = req.params;
    try {
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(userDoc.data());
    } catch (error) {
        console.error(`Error fetching user ${uid}:`, error);
        res.status(500).send('Failed to fetch user data');
    }
});

// Update authenticated user's username
app.post('/profile/updateUsername', async (req, res) => {
    const userId = req.user.uid;
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ message: "Username is required." });
    }
    try {
        await db.collection('users').doc(userId).update({
            username: username,
            usernameLowercase: username.toLowerCase() // Store lowercase for easy searching
        });
        res.json({ message: 'Username updated successfully' });
    } catch (error) {
        console.error("Error updating username:", error);
        res.status(500).send('Failed to update username');
    }
});

// Update authenticated user's avatar URL
app.post('/profile/updateAvatar', async (req, res) => {
    const userId = req.user.uid;
    const { avatarUrl } = req.body;
    if (!avatarUrl) {
        return res.status(400).json({ message: "Avatar URL is required." });
    }
    try {
        await db.collection('users').doc(userId).update({ avatarUrl });
        res.json({ message: 'Avatar updated successfully' });
    } catch (error) {
        console.error("Error updating avatar:", error);
        res.status(500).send('Failed to update avatar');
    }
});

// Update authenticated user's bio
app.post('/profile/updateBio', async (req, res) => {
    const userId = req.user.uid;
    const { bio } = req.body;
    if (bio === undefined) { // Allow empty string bio
        return res.status(400).json({ message: "Bio is required." });
    }
    try {
        await db.collection('users').doc(userId).update({ bio });
        res.json({ message: 'Bio updated successfully' });
    } catch (error) {
        console.error("Error updating bio:", error);
        res.status(500).send('Failed to update bio');
    }
});

// GET chat messages for a specific chat ID
app.get('/chats/:chatId/messages', async (req, res) => {
    const { chatId } = req.params;
    // You might want to add authorization here to ensure the requesting user is a participant
    try {
        const chatDoc = await db.collection('chats').doc(chatId).get();
        if (!chatDoc.exists) {
            return res.status(404).json({ message: 'Chat not found' });
        }
        // Assuming messages are stored in a subcollection named 'messages' within the chat document
        const messagesSnapshot = await db.collection('chats').doc(chatId).collection('messages').orderBy('createdAt').get();
        const messages = messagesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(messages);
    } catch (error) {
        console.error(`Error fetching messages for chat ${chatId}:`, error);
        res.status(500).send('Failed to fetch chat messages');
    }
});


// --- Token Management Endpoints (for free entry tokens) ---

/**
 * POST /tokens/generate
 * Generates (adds) a free entry token of a specific type to the user's profile.
 * Requires: tokenType (e.g., 'arcade', 'picker', 'casino', 'pvp')
 */
app.post('/tokens/generate', async (req, res) => {
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
        const userRef = getUserDocRef(userId);
        // Increment the specific token type count by 1
        await userRef.update({
            [`freeEntryTokens.${tokenType}`]: admin.firestore.FieldValue.increment(1)
        });
        console.log(`User ${userId} generated 1 ${tokenType} token.`);
        res.status(200).json({ message: `Successfully added 1 ${tokenType} token.`, tokenType });
    } catch (error) {
        console.error(`Error generating ${tokenType} token for user ${userId}:`, error);
        res.status(500).json({ message: `Failed to generate ${tokenType} token.` });
    }
});

/**
 * POST /tokens/consume
 * Consumes (removes) a free entry token of a specific type from the user's profile.
 * Requires: tokenType (e.g., 'arcade', 'picker', 'casino', 'pvp')
 * Checks if the user has at least one token of that type before consuming.
 */
app.post('/tokens/consume', async (req, res) => {
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
        const userRef = getUserDocRef(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ message: "User profile not found." });
        }

        const currentTokens = userDoc.data().freeEntryTokens || {};
        // Check if there are tokens to consume
        if ((currentTokens[tokenType] || 0) <= 0) {
            return res.status(400).json({ message: `No ${tokenType} tokens available to consume.` });
        }

        // Decrement the specific token type count by 1
        await userRef.update({
            [`freeEntryTokens.${tokenType}`]: admin.firestore.FieldValue.increment(-1)
        });
        console.log(`User ${userId} consumed 1 ${tokenType} token.`);
        res.status(200).json({ message: `Successfully consumed 1 ${tokenType} token.`, tokenType });
    } catch (error) {
        console.error(`Error consuming ${tokenType} token for user ${userId}:`, error);
        res.status(500).json({ message: `Failed to consume ${tokenType} token.` });
    }
});


// --- Server Start ---
// Starts the Express server and performs initial setup tasks
server.listen(PORT, async () => {
    console.log(`DegenGaming Backend listening on port ${PORT}`);
    console.log(`Solana cluster: ${SOLANA_CLUSTER}`);

    // Ensure the game token mint is loaded or created when the server starts
    await ensureGameTokenMint();

    // Run initial cron jobs
    updatePlatformStatsAggregatedInSol();
    updateALLUsersOnlineStatus();
});