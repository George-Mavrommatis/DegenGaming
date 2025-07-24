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
    sendAndConfirmTransaction, // Needed if backend signs transactions
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
import nacl from 'tweetnacl'; // For Solana message verification

import * as cron from 'node-cron'; // For scheduled tasks

import { fileURLToPath } from 'url'; // For __dirname in ES Modules
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
const SOLANA_CLUSTER = process.env.SOLANA_RPC_URL ; // Use a default devnet RPC
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
        // Optionally, you might want to exit here if admin wallet is critical for startup
        // process.exit(1);
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

    // Chat-related Socket.IO events
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


async function updatePlatformStatsAggregatedInSol() {
    console.log('Cron job: Running updatePlatformStatsAggregatedInSol...');
    try {
        const registeredUsersSnapshot = await db.collection('users').get();
        const registeredUsers = registeredUsersSnapshot.size;

        const statsDocRef = db.collection('platform').doc('stats');
        const statsDoc = await statsDocRef.get();

        let currentStats = {
            registeredUsers: 0,
            onlineUsers: 0,
            totalGamesPlayed: 0,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            currentMonthPeriod: new Date().getFullYear() + '-' + (new Date().getMonth() + 1).toString().padStart(2, '0'),
            lastMonthPeriod: new Date().getMonth() === 0 ? (new Date().getFullYear() - 1) + '-12' : new Date().getFullYear() + '-' + (new Date().getMonth()).toString().padStart(2, '0'),
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
        currentStats.registeredUsers = registeredUsers; // Update registered users count

        // Fetch total games played and other game-related stats (example logic)
        const gamesSnapshot = await db.collection('games').get();
        let totalGamesPlayed = 0;
        let totalSolDistributed = 0;
        gamesSnapshot.forEach(gameDoc => {
            const gameData = gameDoc.data();
            totalGamesPlayed += (gameData.plays || 0); // Assuming 'plays' field exists for games
            totalSolDistributed += (gameData.winningsDistributed || 0); // Assuming 'winningsDistributed'
            // Add more specific category calculations here if needed
        });
        currentStats.totalGamesPlayed = totalGamesPlayed;
        currentStats.totalSolDistributed = totalSolDistributed;
        currentStats.onlineUsers = (await getOnlineUserIds()).length; // Update current online users count


        await statsDocRef.set(currentStats, { merge: true }); // Merge to avoid overwriting unrelated fields
        console.log('Platform stats updated successfully in Firestore.');

    } catch (error) {
        console.error('Error updating platform stats:', error);
    }
}


// Cron job to clean up online status every 5 minutes
cron.schedule('*/5 * * * *', updateALLUsersOnlineStatus);

// Cron job to aggregate platform stats every 30 minutes (or adjust as needed)
cron.schedule('*/30 * * * *', updatePlatformStatsAggregatedInSol);

// Initial run for cron jobs on server start
updateALLUsersOnlineStatus();
updatePlatformStatsAggregatedInSol();


// --- API Routes ---

// Base route
app.get('/', (req, res) => {
    res.send('Degen Gaming Backend is running!');
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
        const message = `Sign in to Degen Gaming with this one-time code: ${nonce}`;
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

// Update Free Entry Tokens (Generate/Consume) (Protected)
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
            [`freeEntryTokens.${tokenType}`]: admin.firestore.FieldValue.increment(1)
        });
        res.status(200).json({ message: `Successfully added 1 ${tokenType} token.`, tokenType });
    } catch (error) {
        console.error(`Error generating ${tokenType} token for user ${userId}:`, error);
        res.status(500).json({ message: `Failed to generate ${tokenType} token.` });
    }
});

app.post('/tokens/consume', protect, async (req, res) => {
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
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: "User profile not found." });
        }
        const currentTokens = userDoc.data().freeEntryTokens || {};
        if ((currentTokens[tokenType] || 0) <= 0) {
            return res.status(400).json({ message: `No ${tokenType} tokens available to consume.` });
        }
        await userRef.update({
            [`freeEntryTokens.${tokenType}`]: admin.firestore.FieldValue.increment(-1)
        });
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



// In your server.js, import and call once:
// await ensurePlatformStatsSchema();

// --- General Error Handling ---
// This middleware should be last
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke on the server!');
});


// --- Server Start ---
// Starts the Express server and performs initial setup tasks
server.listen(PORT, async () => {
    console.log(`DegenGaming Backend listening on port ${PORT}`);
    // Ensure the game token mint is loaded or created when the server starts
    // Run initial cron jobs
    
    updateALLUsersOnlineStatus();
    updatePlatformStatsAggregatedInSol();
});