// server.js - Complete and Final ESM Version (FIXED)

import express from 'express';
import admin from 'firebase-admin';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

// Ensure your serviceAccountKey.json path is correct relative to server.js
// For ESM, .json extension is required.
import serviceAccount from './serviceAccountKey.json';

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

console.log('Firebase Admin SDK initialized successfully (Firestore, Auth).');

const db = admin.firestore(); // Firestore instance
const auth = admin.auth();     // Firebase Auth instance

const app = express();
const PORT = process.env.PORT || 4000;

// Solana setup
import { Connection, Keypair, PublicKey } from '@solana/web3.js'; // Removed unused imports
import { TOKEN_PROGRAM_ID, transfer, getOrCreateAssociatedTokenAccount, getAssociatedTokenAddress } from '@solana/spl-token'; // Removed unused imports
import bs58 from 'bs58';
import cron from 'node-cron';

// Import backend chatService functions (ESM named imports)
// For ESM, .js extension is required for local modules.
import { initializeChatService, findOrCreateChat, sendMessage, getUserChats } from './services/chatService.js';

// Initialize the backend chatService with the Firestore DB and admin instance
initializeChatService(db, admin);

// Middleware
app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true
}));
app.use(express.json());

// --- Solana Admin Wallet Setup ---
const ADMIN_WALLET_PRIVATE_KEY_BASE58 = process.env.ADMIN_WALLET_PRIVATE_KEY_BASE58;
let adminWallet;

if (ADMIN_WALLET_PRIVATE_KEY_BASE58) {
  try {
    adminWallet = Keypair.fromSecretKey(bs58.decode(ADMIN_WALLET_PRIVATE_KEY_BASE58));
    console.log('Admin wallet loaded successfully:', adminWallet.publicKey.toBase58());
  } catch (e) {
    console.error('Failed to load admin wallet from private key:', e);
    adminWallet = null;
  }
} else {
  console.warn('WARNING: ADMIN_WALLET_PRIVATE_KEY_BASE58 not set in .env. Solana operations will fail.');
}

const solanaConnection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
console.log('Solana cluster:', process.env.SOLANA_RPC_URL || 'devnet');


// --- Middleware to protect routes ---
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decodedToken = await auth.verifyIdToken(token);
      req.user = decodedToken; // Attaching Firebase user to request
      next();
    } catch (error) {
      console.error('Error verifying token:', error);
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }
  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};


// --- Cron Jobs & Socket.IO ---
import http from 'http';
import { Server } from 'socket.io';

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ["GET", "POST"],
    credentials: true
  }
});

let onlineUsers = {};

async function updateALLUsersOnlineStatus() {
  console.log('Running updateALLUsersOnlineStatus...');
  try {
    const batch = db.batch();
    const usersRef = db.collection('users');
    const allUsersSnapshot = await usersRef.get();

    allUsersSnapshot.docs.forEach(docSnap => {
      const userData = docSnap.data();
      const lastOnline = userData.lastOnline?.toDate();
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

      const isOnlineInSystem = lastOnline && lastOnline > fiveMinutesAgo;
      const isOnlineInSocket = onlineUsers[docSnap.id];

      // Only update if status has changed
      if (userData.isOnline !== (isOnlineInSystem || isOnlineInSocket)) {
        batch.update(docSnap.ref, { isOnline: isOnlineInSystem || isOnlineInSocket });
      }
    });

    await batch.commit();
    console.log('Online users updated:', Object.keys(onlineUsers).length);
  } catch (error) {
    console.error('Error updating all users online status:', error);
  }
}

async function updatePlatformStatsAggregatedInSol() {
  console.log('Running updatePlatformStatsAggregatedInSol...');
  try {
    const gamesSnapshot = await db.collection('games').get();
    let totalGamesPlayed = 0;
    let totalArcadeSol = 0;
    let totalPickerSol = 0;
    let totalCasinoSol = 0;
    let totalPvPSol = 0;
    let totalSolDistributed = 0;

    const now = new Date();
    const currentMonth = now.getFullYear() + '-' + (now.getMonth() + 1).toString().padStart(2, '0');
    const lastMonth = now.getMonth() === 0 ? (now.getFullYear() - 1) + '-12' : now.getFullYear() + '-' + (now.getMonth()).toString().padStart(2, '0');

    let arcadeSolLastMonth = 0;
    let pickerSolLastMonth = 0;
    let casinoSolLastMonth = 0;
    let pvpSolLastMonth = 0;

    gamesSnapshot.forEach(doc => {
      const game = doc.data();
      totalGamesPlayed += game.totalPlays || 0;
      totalSolDistributed += game.totalSolDistributed || 0;

      if (game.category === 'Arcade') totalArcadeSol += game.solGathered || 0;
      if (game.category === 'Picker') totalPickerSol += game.solGathered || 0;
      if (game.category === 'Casino') totalCasinoSol += game.solGathered || 0;
      if (game.category === 'PvP') totalPvPSol += game.solGathered || 0;

      if (game.monthlyStats && game.monthlyStats[lastMonth]) {
        if (game.category === 'Arcade') arcadeSolLastMonth += game.monthlyStats[lastMonth].solGathered || 0;
        if (game.category === 'Picker') pickerSolLastMonth += game.monthlyStats[lastMonth].solGathered || 0;
        if (game.category === 'Casino') casinoSolLastMonth += game.monthlyStats[lastMonth].solGathered || 0;
        if (game.category === 'PvP') pvpSolLastMonth += game.monthlyStats[lastMonth].solGathered || 0;
      }
    });

    const platformStatsRef = db.collection('platformStats').doc('aggregated');
    await platformStatsRef.set({
      totalGamesPlayed,
      totalArcadeSol,
      totalPickerSol,
      totalCasinoSol,
      totalPvPSol,
      totalSolDistributed,
      arcadeSolLastMonth,
      pickerSolLastMonth,
      casinoSolLastMonth,
      pvpSolLastMonth,
      currentMonthPeriod: currentMonth,
      lastMonthPeriod: lastMonth,
      lastUpdated: admin.firestore.Timestamp.now(),
      categories: {
        Arcade: { totalSol: totalArcadeSol, lastMonthSol: arcadeSolLastMonth },
        Picker: { totalSol: totalPickerSol, lastMonthSol: pickerSolLastMonth },
        Casino: { totalSol: totalCasinoSol, lastMonthSol: casinoSolLastMonth },
        PvP: { totalSol: totalPvPSol, lastMonthSol: pvpSolLastMonth },
      }
    }, { merge: true });

    console.log('Platform stats updated successfully in Firestore.');
  } catch (error) {
    console.error('Error updating platform stats:', error);
  }
}

// Cron jobs
cron.schedule('*/5 * * * *', updateALLUsersOnlineStatus); // Every 5 minutes
cron.schedule('0 0 * * *', updatePlatformStatsAggregatedInSol); // Daily at midnight

// Initial run for cron jobs
updateALLUsersOnlineStatus();
updatePlatformStatsAggregatedInSol();

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('A user connected via Socket.IO');

  socket.on('user:connected', async (uid) => {
    if (uid) {
      onlineUsers[uid] = true;
      socket.userId = uid; // Store UID on the socket
      await db.collection('users').doc(uid).update({
        isOnline: true,
        lastOnline: admin.firestore.Timestamp.now()
      });
      console.log(`User ${uid} connected and presence set in Firestore.`);
    }
  });

  socket.on('disconnect', async () => {
    if (socket.userId && onlineUsers[socket.userId]) {
      delete onlineUsers[socket.userId];
      await db.collection('users').doc(socket.userId).update({
        isOnline: false,
        lastOnline: admin.firestore.Timestamp.now()
      });
    }
    console.log('User disconnected from Socket.IO');
  });

  socket.on('chat:message', async (message) => {
    // Assuming message object has senderId, receiverId, text, etc.
    try {
      // Use the chatService functions imported directly
      const senderUid = socket.userId;
      const receiverUid = message.receiverUid;
      const text = message.text;
      const chatId = message.chatId;

      // If sending to an existing chat
      if (chatId) {
        await sendMessage(chatId, senderUid, text);
        // You might want to broadcast this message to relevant users
        io.to(chatId).emit('chat:messageReceived', { senderUid, text, timestamp: new Date() });
      } else if (receiverUid) {
        // If initiating a new chat
        const chat = await findOrCreateChat(senderUid, receiverUid);
        await sendMessage(chat.id, senderUid, text);
        io.to(chat.id).emit('chat:messageReceived', { senderUid, text, timestamp: new Date() });
      }

      console.log('Chat message processed:', message);
    } catch (error) {
      console.error('Error handling chat message:', error);
    }
  });

  // Example: Join a chat room
  socket.on('chat:join', (chatId) => {
    socket.join(chatId);
    console.log(`User ${socket.userId} joined chat room ${chatId}`);
  });
});

// Start the Socket.IO server
server.listen(PORT, () => {
  console.log(`DegenGaming Backend listening on port ${PORT}`);
});


// --- API Routes ---

// Base route
app.get('/', (req, res) => {
    res.send('Degen Gaming Backend is running!');
});

// User Registration
app.post('/register', async (req, res) => {
  const { email, password, username } = req.body;
  try {
    const userRecord = await auth.createUser({ email, password });
    await db.collection('users').doc(userRecord.uid).set({
      username,
      email,
      uid: userRecord.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      avatarUrl: "/avatars/default.png",
      freeEntryTokens: { // Initialize free entry tokens
        arcade: 0,
        picker: 0,
        casino: 0,
        pvp: 0,
      },
      isOnline: false,
      lastOnline: null,
      friends: [],
      friendRequestsSent: [],
      friendRequestsReceived: [],
    });
    res.status(201).json({ message: 'User registered successfully!' });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(400).json({ message: error.message, code: error.code });
  }
});

// User Login (placeholder)
app.post('/login', async (req, res) => {
  res.status(200).json({ message: 'Login handled by Firebase client SDK. Backend route is a placeholder.' });
});

// Get User Profile
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

// Update User Profile
app.put('/profile', protect, async (req, res) => {
  const { username, email, avatarUrl } = req.body;
  try {
    const userRef = db.collection('users').doc(req.user.uid);
    await userRef.update({ username, email, avatarUrl });
    res.status(200).json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

// Initiate Game
app.post('/initiate-game', protect, async (req, res) => {
  console.log("Game initiation requested:", req.body);
  try {
    const gameEntryTokenId = `game_token_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    res.status(200).json({ message: 'Game initiated successfully', gameEntryTokenId });
  } catch (error) {
    console.error('Error initiating game:', error);
    res.status(500).json({ message: 'Failed to initiate game' });
  }
});

// Get Games
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

// Get Categories
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


// Get Free Entry Tokens
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

// Get Platform Stats
app.get('/platform-stats', async (req, res) => {
  try {
    const statsDoc = await db.collection('platformStats').doc('aggregated').get();
    if (!statsDoc.exists) {
      return res.status(200).json({
        totalGamesPlayed: 0,
        totalArcadeSol: 0,
        totalPickerSol: 0,
        totalCasinoSol: 0,
        totalPvPSol: 0,
        totalSolDistributed: 0,
        arcadeSolLastMonth: 0,
        pickerSolLastMonth: 0,
        casinoSolLastMonth: 0,
        pvpSolLastMonth: 0,
        currentMonthPeriod: new Date().getFullYear() + '-' + (new Date().getMonth() + 1).toString().padStart(2, '0'),
        lastMonthPeriod: new Date().getMonth() === 0 ? (new Date().getFullYear() - 1) + '-12' : new Date().getFullYear() + '-' + (new Date().getMonth()).toString().padStart(2, '0'),
        lastUpdated: admin.firestore.Timestamp.now(),
        categories: {
          Arcade: { totalSol: 0, lastMonthSol: 0 },
          Picker: { totalSol: 0, lastMonthSol: 0 },
          Casino: { totalSol: 0, lastMonthSol: 0 },
          PvP: { totalSol: 0, lastMonthSol: 0 },
        }
      });
    }
    res.status(200).json(statsDoc.data());
  } catch (error) {
    console.error('Error fetching platform stats:', error);
    res.status(500).json({ message: 'Failed to fetch platform stats.' });
  }
});

// --- Friend System Routes ---
app.post('/friend-request/send', protect, async (req, res) => {
    const { targetUsername } = req.body;
    const currentUserId = req.user.uid;

    if (!targetUsername) {
        return res.status(400).json({ message: 'Target username is required.' });
    }

    try {
        const usersRef = db.collection('users');
        const targetUserQuery = await usersRef.where('username', '==', targetUsername).limit(1).get();

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
        const targetUserData = targetUserDoc.data();

        if (currentUserData.friends && currentUserData.friends.includes(targetUserId)) {
            return res.status(400).json({ message: 'You are already friends with this user.' });
        }
        if (currentUserData.friendRequestsSent && currentUserData.friendRequestsSent.includes(targetUserId)) {
            return res.status(400).json({ message: 'Friend request already sent.' });
        }
        if (currentUserData.friendRequestsReceived && currentUserData.friendRequestsReceived.includes(targetUserId)) {
            const batch = db.batch();
            batch.update(usersRef.doc(currentUserId), {
                friends: admin.firestore.FieldValue.arrayUnion(targetUserId),
                friendRequestsReceived: admin.firestore.FieldValue.arrayRemove(targetUserId)
            });
            batch.update(usersRef.doc(targetUserId), {
                friends: admin.firestore.FieldValue.arrayUnion(currentUserId),
                friendRequestsSent: admin.firestore.FieldValue.arrayRemove(currentUserId)
            });
            await batch.commit();
            return res.status(200).json({ message: 'Friend request accepted and you are now friends!' });
        }

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
    const { senderId } = req.body;
    const currentUserId = req.user.uid;

    if (!senderId) {
        return res.status(400).json({ message: 'Sender ID is required.' });
    }

    try {
        const usersRef = db.collection('users');
        const batch = db.batch();

        batch.update(usersRef.doc(currentUserId), {
            friends: admin.firestore.FieldValue.arrayUnion(senderId),
            friendRequestsReceived: admin.firestore.FieldValue.arrayRemove(senderId)
        });

        batch.update(usersRef.doc(senderId), {
            friends: admin.firestore.FieldValue.arrayUnion(currentUserId),
            friendRequestsSent: admin.firestore.FieldValue.arrayRemove(currentUserId)
        });

        await batch.commit();
        res.status(200).json({ message: 'Friend request accepted.' });

    } catch (error) {
        console.error('Error accepting friend request:', error);
        res.status(500).json({ message: 'Failed to accept friend request.' });
    }
});

app.post('/friend-request/reject', protect, async (req, res) => {
    const { senderId } = req.body;
    const currentUserId = req.user.uid;

    if (!senderId) {
        return res.status(400).json({ message: 'Sender ID is required.' });
    }

    try {
        const usersRef = db.collection('users');
        const batch = db.batch();

        batch.update(usersRef.doc(currentUserId), {
            friendRequestsReceived: admin.firestore.FieldValue.arrayRemove(senderId)
        });

        batch.update(usersRef.doc(senderId), {
            friendRequestsSent: admin.firestore.FieldValue.arrayRemove(currentUserId)
        });

        await batch.commit();
        res.status(200).json({ message: 'Friend request rejected.' });

    } catch (error) {
        console.error('Error rejecting friend request:', error);
        res.status(500).json({ message: 'Failed to reject friend request.' });
    }
});

app.get('/friends', protect, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: 'User not found' });
        }
        const friendIds = userDoc.data().friends || [];

        const friendsData = [];
        if (friendIds.length > 0) {
            const friendsSnapshot = await db.collection('users').where(admin.firestore.FieldPath.documentId(), 'in', friendIds).get();
            friendsSnapshot.forEach(doc => {
                const user = doc.data();
                friendsData.push({
                    uid: doc.id,
                    username: user.username,
                    avatarUrl: user.avatarUrl,
                    isOnline: user.isOnline,
                });
            });
        }
        res.status(200).json(friendsData);
    } catch (error) {
        console.error('Error fetching friends:', error);
        res.status(500).json({ message: 'Failed to fetch friends.' });
    }
});

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

// --- Chat Routes (Now using direct calls to imported chatService functions) ---
app.get('/chats', protect, async (req, res) => {
    try {
        const chats = await getUserChats(req.user.uid);
        res.status(200).json(chats);
    } catch (error) {
        console.error('Error fetching user chats:', error);
        res.status(500).json({ message: 'Failed to fetch user chats.' });
    }
});

app.post('/chats/findOrCreate', protect, async (req, res) => {
    const { targetUid } = req.body;
    try {
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
    try {
        await sendMessage(chatId, req.user.uid, text);
        res.status(200).json({ message: 'Message sent successfully.' });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ message: 'Failed to send message.' });
    }
});


// --- General Error Handling ---
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});