/**
 * DegenGaming Backend (Unified)
 *
 * Includes:
 *  - Auth (email/password + wallet verify)
 *  - Presence (Socket.IO + cron cleanup)
 *  - GG Coins Economy (economy/play, reward, bulk, snapshot)
 *  - Direct increment endpoints (ggCoins & legacy sol) – retained
 *  - Cashier (deposit / withdraw)
 *  - Free Entry Tokens (generate / consume)
 *  - Picker session tokens
 *  - Chats, Friends, Leaderboards
 *  - Platform stats aggregation cron
 *  - Migration helpers (normalize games)
 *
 * CHANGE (2025-10-01):
 *  - Inlined chatService.js logic here (initializeChatService, findOrCreateChat, sendMessage,
 *    getUserChats, backfillChatLastMessageAt) to eliminate duplicate export/import issues.
 */

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
  transfer,
  getAccount,
  TOKEN_PROGRAM_ID,
} = splToken;

import bs58 from 'bs58';
import nacl from 'tweetnacl';
import * as cron from 'node-cron';
import { fileURLToPath } from 'url';
import path from 'path';

/* -------------------------------------------------------------------------- */
/* Firebase Initialization                                                    */
/* -------------------------------------------------------------------------- */
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
  console.log('[INIT] Firebase initialized.');
} catch (error) {
  console.error('[INIT] Failed to initialize Firebase:', error);
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Chat Service (Inlined)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * (Optional) Initialization marker. We already have db/admin, so this just logs once.
 */
let chatServiceReady = false;
const initializeChatService = () => {
  if (!chatServiceReady) {
    console.log('[CHAT] Inlined chat service initialized.');
    chatServiceReady = true;
  }
};

/**
 * Finds or creates a 1:1 chat between two users.
 * Ensures participants are sorted for idempotent detection.
 */
const findOrCreateChat = async (user1Uid, user2Uid) => {
  if (!db) throw new Error('Firestore not initialized.');
  if (!user1Uid || !user2Uid || user1Uid === user2Uid) {
    throw new Error('Invalid participant UIDs.');
  }

  const participants = [user1Uid, user2Uid].sort();
  const chatsRef = db.collection('chats');

  const existingSnap = await chatsRef
    .where('participants', 'array-contains', user1Uid)
    .get();

  let existingChat = null;
  existingSnap.forEach(doc => {
    const data = doc.data();
    const list = data.participants || [];
    if (list.length === 2 && list.includes(user2Uid) && list.includes(user1Uid)) {
      existingChat = { id: doc.id, ...data };
    }
  });

  if (existingChat) {
    return {
      chatId: existingChat.id,
      participants: existingChat.participants,
      lastMessage: existingChat.lastMessage || null,
      lastMessageAt: existingChat.lastMessageAt || null,
      createdAt: existingChat.createdAt || null
    };
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const newDoc = await chatsRef.add({
    participants,
    createdAt: now,
    lastMessageAt: now,
    lastMessage: null
  });

  return {
    chatId: newDoc.id,
    participants,
    lastMessage: null,
    lastMessageAt: null,
    createdAt: null
  };
};

/**
 * Sends a message and updates lastMessage + lastMessageAt on the chat.
 */
const sendMessage = async (chatId, senderUid, text) => {
  if (!db) throw new Error('Firestore not initialized.');
  if (!chatId || !senderUid || !text) throw new Error('Missing chat message params.');

  const chatRef = db.collection('chats').doc(chatId);
  const chatSnap = await chatRef.get();
  if (!chatSnap.exists) throw new Error('Chat not found.');

  const now = admin.firestore.FieldValue.serverTimestamp();
  await chatRef.collection('messages').add({
    from: senderUid,
    text,
    sentAt: now
  });

  await chatRef.update({
    lastMessage: { from: senderUid, text, sentAt: now },
    lastMessageAt: now
  });
};

/**
 * Returns list of chats for a user (ordering by lastMessageAt if index exists).
 */
const getUserChats = async (currentUserId) => {
  if (!db) throw new Error('Firestore not initialized.');
  if (!currentUserId) return [];

  try {
    const snap = await db.collection('chats')
      .where('participants', 'array-contains', currentUserId)
      .get();

    const chats = [];

    for (const docSnap of snap.docs) {
      const data = docSnap.data() || {};
      const participants = Array.isArray(data.participants) ? data.participants : [];
      const otherId = participants.find(p => p !== currentUserId);

      // Resolve friend info
      let friend = null;
      if (otherId) {
        const uSnap = await db.collection('users').doc(otherId).get();
        if (uSnap.exists) {
          const u = uSnap.data();
            friend = {
            uid: otherId,
            username: u.username || otherId,
            avatarUrl: u.avatarUrl || '/avatars/default.png',
            isOnline: !!u.isOnline
          };
        }
      }

      // Normalize lastMessage
      let lastMessage = null;
      if (data.lastMessage && typeof data.lastMessage === 'object') {
        const lm = data.lastMessage;
        const sentAtDate = safeToDate(lm.sentAt);
        lastMessage = {
          from: lm.from || null,
          text: lm.text || '',
          sentAt: sentAtDate
        };
      }

      const createdAtDate = safeToDate(data.createdAt) || new Date(0);
      const lastMessageAtDate = safeToDate(data.lastMessageAt);

      chats.push({
        chatId: docSnap.id,
        participants,
        friend,
        lastMessage,
        createdAt: createdAtDate,
        lastMessageAt: lastMessageAtDate,
        usedFallback: true
      });
    }

    // Sort newest first by lastMessageAt then createdAt
    chats.sort((a, b) => {
      const aT = (a.lastMessageAt || a.lastMessage?.sentAt || a.createdAt).getTime();
      const bT = (b.lastMessageAt || b.lastMessage?.sentAt || b.createdAt).getTime();
      return bT - aT;
    });

    return chats;
  } catch (e) {
    console.error('[CHAT] getUserChats (safe) error:', e);
    return [];
  }
};
/**
 * Backfill lastMessageAt for older chat documents missing that field.
 */
const backfillChatLastMessageAt = async () => {
  if (!db) throw new Error('Firestore not initialized.');
  const all = await db.collection('chats').get();
  let batch = db.batch();
  let ops = 0;

  for (const doc of all.docs) {
    const data = doc.data();
    if (!data.lastMessageAt) {
      batch.update(doc.ref, {
        lastMessageAt: data.createdAt || admin.firestore.FieldValue.serverTimestamp()
      });
      ops++;
      if (ops === 400) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
        console.log('[CHAT] Partial backfill commit.');
      }
    }
  }
  if (ops) await batch.commit();
  console.log('[CHAT] Backfill complete.');
};

// Initialize the chat service (just logs; real resources already set)
initializeChatService();

/* -------------------------------------------------------------------------- */
/* Solana (optional / legacy)                                                 */
/* -------------------------------------------------------------------------- */
const SOLANA_CLUSTER = process.env.SOLANA_RPC_URL;
const connection = new Connection(SOLANA_CLUSTER, 'confirmed');
console.log(`[SOLANA] Cluster: ${SOLANA_CLUSTER}`);

const ADMIN_WALLET_PRIVATE_KEY_BASE58 = process.env.ADMIN_WALLET_PRIVATE_KEY_BASE58;
let adminWalletKeypair = null;
if (ADMIN_WALLET_PRIVATE_KEY_BASE58) {
  try {
    adminWalletKeypair = Keypair.fromSecretKey(bs58.decode(ADMIN_WALLET_PRIVATE_KEY_BASE58));
    console.log(`[SOLANA] Admin wallet: ${adminWalletKeypair.publicKey.toBase58()}`);
  } catch (e) {
    console.error('[SOLANA] Failed to decode admin wallet key:', e.message);
  }
} else {
  console.warn('[SOLANA] ADMIN_WALLET_PRIVATE_KEY_BASE58 not set (on-chain payouts disabled).');
}

const PLATFORM_SOL_ADDRESS = process.env.PLATFORM_SOL_ADDRESS ||
  (adminWalletKeypair ? adminWalletKeypair.publicKey.toBase58() : null);

let gameTokenMint = null; // optional custom token mint
const GAME_TOKEN_DECIMALS = 9;


/* -------------------------------------------------------------------------- */
/* Get Solana Price          & Month                                          */
/* -------------------------------------------------------------------------- */

// 2) Helper: current month key "YYYY-MM"
function getMonthPeriod(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,'0')}`;
}

async function ensurePlatformStatsMonthRollover() {
  const statsRef = db.collection('platform').doc('stats');
  const nowPeriod = getMonthPeriod();

async function resetCategoriesMonthlyFields() {
  const catsSnap = await db.collection('categories').get();
  let batch = db.batch();
  let writes = 0;

  for (const doc of catsSnap.docs) {
    batch.set(doc.ref, {
      ggCoinsGathered: { lastMonth: 0 },
      ggCoinsDistributed: { lastMonth: 0 },
      gamesPlayed: { lastMonth: 0 },
    }, { merge: true });
    writes++;

    if (writes >= 450) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();
}

async function resetGamesMonthlyFields() {
  const gamesSnap = await db.collection('games').get();
  let batch = db.batch();
  let writes = 0;

  for (const doc of gamesSnap.docs) {
    batch.set(doc.ref, {
      ggCoinsGathered: { lastMonth: 0 },
      ggCoinsDistributed: { lastMonth: 0 },
      gamesPlayed: { lastMonth: 0 },
    }, { merge: true });
    writes++;

    if (writes >= 450) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();
}

// Month Rollover Function
async function ensurePlatformStatsMonthRollover() {
  const statsRef = db.collection('platform').doc('stats');
  const nowPeriod = getMonthPeriod();

  // Read current stats once
  const snap = await statsRef.get();

  if (!snap.exists) {
    // Create minimal doc with required maps
    await statsRef.set({
      currentMonthPeriod: nowPeriod,
      lastMonthPeriod: null,
      ggCoinsDeposited: { allTime: 0, lastMonth: 0 },
      ggCoinsWithdrawn: { allTime: 0, lastMonth: 0 },
      totalGGCoinsGathered: { allTime: 0, lastMonth: 0 },
      totalGGCoinsDistributed: { allTime: 0, lastMonth: 0 },
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      categories: {} // will be filled by your aggregation or economy endpoints later
    }, { merge: true });
    return;
  }

  const data = snap.data() || {};
  const storedPeriod = data.currentMonthPeriod;

  // If no month change, just touch lastUpdated
  if (storedPeriod === nowPeriod) {
    await statsRef.set({ lastUpdated: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return;
  }

  // Month changed: zero all lastMonth counters mentioned above
  const platUpdate = {
    currentMonthPeriod: nowPeriod,
    lastMonthPeriod: storedPeriod || null,
    'ggCoinsDeposited.lastMonth': 0,
    'ggCoinsWithdrawn.lastMonth': 0,
    'totalGGCoinsGathered.lastMonth': 0,
    'totalGGCoinsDistributed.lastMonth': 0,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };

  const categoriesNode = data.categories || {};
  const catKeys = Object.keys(categoriesNode);
  for (const catKey of catKeys) {
    platUpdate[`categories.${catKey}.ggCoinsGathered.lastMonth`] = 0;
    platUpdate[`categories.${catKey}.ggCoinsDistributed.lastMonth`] = 0;
    // If you later want monthly reset for plays:
    // platUpdate[`categories.${catKey}.gamesPlayed.lastMonth`] = 0;
  }

  // Update platform stats doc
  await statsRef.update(platUpdate);

  // Reset in categories collection and games collection
  await resetCategoriesMonthlyFields();
  await resetGamesMonthlyFields();
}


// 3) Helper: resolve SOL price on server
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

// 4) Helper: ensure platform/stats exists (minimal) and reset lastMonth on month change
async function ensurePlatformStatsMonthRollover() {
  const statsRef = db.collection('platform').doc('stats');
  await db.runTransaction(async (t) => {
    const snap = await t.get(statsRef);
    const nowPeriod = getMonthPeriod();

    if (!snap.exists) {
      // Create minimal doc with required maps
      t.set(statsRef, {
        currentMonthPeriod: nowPeriod,
        lastMonthPeriod: null,
        ggCoinsDeposited: { allTime: 0, lastMonth: 0 },
        ggCoinsWithdrawn: { allTime: 0, lastMonth: 0 },
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    const data = snap.data() || {};
    const storedPeriod = data.currentMonthPeriod;

    // If a new month has begun, zero out lastMonth for the two cashier maps
    if (storedPeriod !== nowPeriod) {
      t.update(statsRef, {
        currentMonthPeriod: nowPeriod,
        lastMonthPeriod: storedPeriod || null,
        'ggCoinsDeposited.lastMonth': 0,
        'ggCoinsWithdrawn.lastMonth': 0,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      // Touch lastUpdated occasionally
      t.set(statsRef, { lastUpdated: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
  });
}

// 5) Schedule automatic rollover at midnight on the 1st of each month
//    This complements the "call before deposit/withdraw" safety checks.
cron.schedule('0 0 1 * *', ensurePlatformStatsMonthRollover);

// 6) Cashier: DEPOSIT (1 GG = $1; integer-only credit)
//    - If txSignature is provided, verify on-chain SOL delta to platform address.
//    - Convert SOL to $ via SOL price, credit integer GG = floor(sol * price).
//    - Increment platform stats: ggCoinsDeposited.{allTime,lastMonth}


/* -------------------------------------------------------------------------- */
/* Express & Socket.IO                                                        */
/* -------------------------------------------------------------------------- */
const app = express();
const PORT = process.env.PORT || 4000;

const corsOptions = {
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  methods: ['GET','POST','PUT','DELETE'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());

const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: corsOptions });

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */
const CATEGORY_KEYS = ['arcade','pvp','casino','picker'];
const CATEGORY_COLLECTION_ID_MAP = {
  arcade: 'Arcade',
  casino: 'Casino',
  picker: 'Picker',
  pvp: 'PvP',
};
const emptyStatsMap = { allTime: 0, lastMonth: 0 };

function getUserDocRef(uid) { return db.collection('users').doc(uid); }
function validateCategory(cat) { return CATEGORY_KEYS.includes((cat || '').toLowerCase()); }
function getPeriodKeys(date = new Date()) {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2,'0');
  const current = `${y}-${m}`;
  const prev = new Date(y, date.getMonth() - 1, 1);
  const last = `${prev.getFullYear()}-${(prev.getMonth()+1).toString().padStart(2,'0')}`;
  return { current, last };
}
async function fetchSolPrice() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const j = await r.json();
    return Number(j?.solana?.usd) || 0;
  } catch {
    return 0;
  }
}
async function getOnlineUserIds() {
  try {
    const snap = await db.collection('users').where('isOnline','==',true).get();
    return snap.docs.map(d=>d.id);
  } catch {
    return [];
  }
}
async function getUserDisplayData(uid) {
  const doc = await db.collection('users').doc(uid).get();
  if (!doc.exists) return null;
  const data = doc.data();
  return {
    uid: doc.id,
    username: data.username,
    avatarUrl: data.avatarUrl,
    isOnline: data.isOnline || false,
  };
}
function chunkArray(arr, size) {
  const out = [];
  for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size));
  return out;
}

/* -------------------------------------------------------------------------- */
/* Socket.IO                                                                  */
/* -------------------------------------------------------------------------- */
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
      console.error('[SOCKET] setUid error:', e);
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
      console.error('[SOCKET] disconnect error:', e);
    }
  });

  socket.on('joinGame', gameId => socket.join(gameId));
  socket.on('leaveGame', gameId => socket.leave(gameId));
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
      console.error('[CHAT] message error:', e);
      socket.emit('chat:error', 'Failed to send message.');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Legacy Solana token helpers (optional)                                    */
/* -------------------------------------------------------------------------- */
async function transferSolanaToken(recipientPublicKey, amount) {
  if (!adminWalletKeypair || !gameTokenMint) return false;
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
    console.error('[SOLANA] transferSolanaToken error:', e);
    return false;
  }
}
async function getTokenAccountBalance(tokenAccountPublicKey) {
  try {
    const info = await getAccount(connection, tokenAccountPublicKey, 'confirmed', TOKEN_PROGRAM_ID);
    return Number(info.amount);
  } catch (e) {
    if (e.message.includes('does not exist')) return 0;
    return 0;
  }
}

/* -------------------------------------------------------------------------- */
/* Auth Middleware                                                            */
/* -------------------------------------------------------------------------- */
const protect = async (req, res, next) => {
  if (!req.headers.authorization?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized: No token provided.' });
  }
  const token = req.headers.authorization.split(' ')[1];
  try {
    const decoded = await auth.verifyIdToken(token);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized: Invalid or expired token.' });
  }
};

/* -------------------------------------------------------------------------- */
/* Presence Cron                                                              */
/* -------------------------------------------------------------------------- */
async function updateALLUsersOnlineStatus() {
  try {
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 5*60*1000);
    const snap = await db.collection('users')
      .where('isOnline','==',true)
      .where('lastSeen','<',cutoff)
      .get();
    const batch = db.batch();
    snap.forEach(doc => {
      batch.update(doc.ref, {
        isOnline:false,
        lastSeen: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    await batch.commit();
    io.emit('onlineUsersUpdate', await getOnlineUserIds());
  } catch (e) {
    console.error('[CRON] presence cleanup error:', e);
  }
}

/* -------------------------------------------------------------------------- */
/* Platform Stats Aggregation                                                 */
/* -------------------------------------------------------------------------- */
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
        arcade:{ ggCoinsGathered:{...emptyStatsMap}, ggCoinsDistributed:{...emptyStatsMap}, gamesPlayed:{...emptyStatsMap}, games:[] },
        pvp:{ ggCoinsGathered:{...emptyStatsMap}, ggCoinsDistributed:{...emptyStatsMap}, gamesPlayed:{...emptyStatsMap}, games:[] },
        casino:{ ggCoinsGathered:{...emptyStatsMap}, ggCoinsDistributed:{...emptyStatsMap}, gamesPlayed:{...emptyStatsMap}, games:[] },
        picker:{ ggCoinsGathered:{...emptyStatsMap}, ggCoinsDistributed:{...emptyStatsMap}, gamesPlayed:{...emptyStatsMap}, games:[] },
      },
      games:{}
    });
  }
  return statsRef;
}

async function updatePlatformStatsAggregatedGGCoins() {
  console.log('[CRON] Aggregating platform stats (GG coins)...');
  try {
    const statsRef = await ensurePlatformStatsBase();
    const statsSnap = await statsRef.get();
    const existing = statsSnap.data();

    const preservedDeposited = existing.totalGGCoinsDeposited || { ...emptyStatsMap };
    const preservedWithdrawn = existing.totalGGCoinsWithdrawn || { ...emptyStatsMap };

    const catAgg = {
      arcade:{ ggCoinsGathered:{...emptyStatsMap}, ggCoinsDistributed:{...emptyStatsMap}, gamesPlayed:{...emptyStatsMap}, games:[] },
      pvp:{ ggCoinsGathered:{...emptyStatsMap}, ggCoinsDistributed:{...emptyStatsMap}, gamesPlayed:{...emptyStatsMap}, games:[] },
      casino:{ ggCoinsGathered:{...emptyStatsMap}, ggCoinsDistributed:{...emptyStatsMap}, gamesPlayed:{...emptyStatsMap}, games:[] },
      picker:{ ggCoinsGathered:{...emptyStatsMap}, ggCoinsDistributed:{...emptyStatsMap}, gamesPlayed:{...emptyStatsMap}, games:[] },
    };

    const gamesSnap = await db.collection('games').get();
    let totalGamesPlayed = 0;
    let gatheredAll = 0, gatheredLast = 0;
    let distributedAll = 0, distributedLast = 0;
    const gamesOut = {};

    gamesSnap.forEach(doc => {
      const g = doc.data();
      const catKey = (g.category || '').toLowerCase();
      if (!validateCategory(catKey)) return;

      const gathered = g.ggCoinsGathered || { allTime:0, lastMonth:0 };
      const distributed = g.ggCoinsDistributed || { allTime:0, lastMonth:0 };
      const plays = g.gamesPlayed || { allTime:0, lastMonth:0 };

      catAgg[catKey].games.push(doc.id);
      catAgg[catKey].ggCoinsGathered.allTime += gathered.allTime || 0;
      catAgg[catKey].ggCoinsGathered.lastMonth += gathered.lastMonth || 0;
      catAgg[catKey].ggCoinsDistributed.allTime += distributed.allTime || 0;
      catAgg[catKey].ggCoinsDistributed.lastMonth += distributed.lastMonth || 0;
      catAgg[catKey].gamesPlayed.allTime += plays.allTime || 0;
      catAgg[catKey].gamesPlayed.lastMonth += plays.lastMonth || 0;

      totalGamesPlayed += plays.allTime || 0;
      gatheredAll += gathered.allTime || 0;
      gatheredLast += gathered.lastMonth || 0;
      distributedAll += distributed.allTime || 0;
      distributedLast += distributed.lastMonth || 0;

      gamesOut[doc.id] = {
        gameId: doc.id,
        name: g.name ?? null,
        category: catKey,
        playCost: g.playCost ?? null,
        ggCoinsGathered: gathered,
        ggCoinsDistributed: distributed,
        gamesPlayed: plays,
        image: g.image ?? null,
        description: g.description ?? null,
      };
    });

    await statsRef.set({
      registeredUsers: existing.registeredUsers || 0,
      onlineUsers: (await getOnlineUserIds()).length,
      totalGamesPlayed,
      totalGGCoinsDeposited: preservedDeposited,
      totalGGCoinsWithdrawn: preservedWithdrawn,
      totalGGCoinsGathered: { allTime: gatheredAll, lastMonth: gatheredLast },
      totalGGCoinsDistributed: { allTime: distributedAll, lastMonth: distributedLast },
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      currentMonthPeriod: existing.currentMonthPeriod || getPeriodKeys().current,
      lastMonthPeriod: existing.lastMonthPeriod || getPeriodKeys().last,
      categories: catAgg,
      games: gamesOut
    }, { merge:false });
    console.log('[CRON] Aggregation complete.');
  } catch (e) {
    console.error('[CRON] Aggregation error:', e);
  }
}

/* -------------------------------------------------------------------------- */
/* Economy Core (applyEconomyDeltas + endpoints below)                        */
/* -------------------------------------------------------------------------- */
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

  await db.runTransaction(async (t) => {
    const gameRef = db.collection('games').doc(gameId);
    const statsRef = db.collection('platform').doc('stats');
    const catRef = db.collection('categories').doc(CATEGORY_COLLECTION_ID_MAP[lowerCat]);

    const [gameSnap, statsSnap, catSnap] = await Promise.all([
      t.get(gameRef),
      t.get(statsRef),
      t.get(catRef)
    ]);

    if (!gameSnap.exists) {
      t.set(gameRef, {
        id: gameId,
        category: CATEGORY_COLLECTION_ID_MAP[lowerCat] || lowerCat,
        ggCoinsGathered: { ...emptyStatsMap },
        ggCoinsDistributed: { ...emptyStatsMap },
        gamesPlayed: { ...emptyStatsMap }
      }, { merge:true });
    }

    if (!catSnap.exists) {
      t.set(catRef, {
        id: CATEGORY_COLLECTION_ID_MAP[lowerCat],
        name: CATEGORY_COLLECTION_ID_MAP[lowerCat],
        description: `${CATEGORY_COLLECTION_ID_MAP[lowerCat]} category`,
        ggCoinsGathered: { ...emptyStatsMap },
        ggCoinsDistributed: { ...emptyStatsMap },
        gamesPlayed: { ...emptyStatsMap },
        games: [gameId]
      }, { merge:true });
    } else {
      t.update(catRef, { games: admin.firestore.FieldValue.arrayUnion(gameId) });
    }

    const statsData = statsSnap.exists ? statsSnap.data() : {};
    if (!(statsData.categories?.[lowerCat])) {
      t.set(statsRef, {
        [`categories.${lowerCat}`]: {
          ggCoinsGathered: { ...emptyStatsMap },
          ggCoinsDistributed: { ...emptyStatsMap },
          gamesPlayed: { ...emptyStatsMap },
          games: []
        }
      }, { merge:true });
    }

    const gameInc = {};
    const catInc = {};
    const platInc = { lastUpdated: admin.firestore.FieldValue.serverTimestamp() };

    if (gatheredDelta > 0) {
      gameInc['ggCoinsGathered.allTime'] = admin.firestore.FieldValue.increment(gatheredDelta);
      gameInc['ggCoinsGathered.lastMonth'] = admin.firestore.FieldValue.increment(gatheredDelta);
      catInc['ggCoinsGathered.allTime'] = admin.firestore.FieldValue.increment(gatheredDelta);
      catInc['ggCoinsGathered.lastMonth'] = admin.firestore.FieldValue.increment(gatheredDelta);
      platInc[`categories.${lowerCat}.ggCoinsGathered.allTime`] = admin.firestore.FieldValue.increment(gatheredDelta);
      platInc[`categories.${lowerCat}.ggCoinsGathered.lastMonth`] = admin.firestore.FieldValue.increment(gatheredDelta);
      platInc['totalGGCoinsGathered.allTime'] = admin.firestore.FieldValue.increment(gatheredDelta);
      platInc['totalGGCoinsGathered.lastMonth'] = admin.firestore.FieldValue.increment(gatheredDelta);
    }

    if (distributedDelta > 0) {
      gameInc['ggCoinsDistributed.allTime'] = admin.firestore.FieldValue.increment(distributedDelta);
      gameInc['ggCoinsDistributed.lastMonth'] = admin.firestore.FieldValue.increment(distributedDelta);
      catInc['ggCoinsDistributed.allTime'] = admin.firestore.FieldValue.increment(distributedDelta);
      catInc['ggCoinsDistributed.lastMonth'] = admin.firestore.FieldValue.increment(distributedDelta);
      platInc[`categories.${lowerCat}.ggCoinsDistributed.allTime`] = admin.firestore.FieldValue.increment(distributedDelta);
      platInc[`categories.${lowerCat}.ggCoinsDistributed.lastMonth`] = admin.firestore.FieldValue.increment(distributedDelta);
      platInc['totalGGCoinsDistributed.allTime'] = admin.firestore.FieldValue.increment(distributedDelta);
      platInc['totalGGCoinsDistributed.lastMonth'] = admin.firestore.FieldValue.increment(distributedDelta);
    }

    if (incrementPlay) {
      gameInc['gamesPlayed.allTime'] = admin.firestore.FieldValue.increment(1);
      gameInc['gamesPlayed.lastMonth'] = admin.firestore.FieldValue.increment(1);
      catInc['gamesPlayed.allTime'] = admin.firestore.FieldValue.increment(1);
      catInc['gamesPlayed.lastMonth'] = admin.firestore.FieldValue.increment(1);
      platInc[`categories.${lowerCat}.gamesPlayed.allTime`] = admin.firestore.FieldValue.increment(1);
      platInc[`categories.${lowerCat}.gamesPlayed.lastMonth`] = admin.firestore.FieldValue.increment(1);
      platInc['totalGamesPlayed'] = admin.firestore.FieldValue.increment(1);
    }

    if (Object.keys(gameInc).length) t.set(gameRef, gameInc, { merge:true });
    if (Object.keys(catInc).length) t.set(catRef, catInc, { merge:true });
    if (Object.keys(platInc).length) t.set(statsRef, platInc, { merge:true });
  });
}

async function getEconomySnapshot(gameId, category) {
  const lowerCat = category?.toLowerCase();
  const gameRef = db.collection('games').doc(gameId);
  const statsRef = db.collection('platform').doc('stats');
  const catRef = lowerCat ? db.collection('categories').doc(CATEGORY_COLLECTION_ID_MAP[lowerCat]) : null;

  const [g, s, c] = await Promise.all([
    gameRef.get(),
    statsRef.get(),
    catRef ? catRef.get() : Promise.resolve(null)
  ]);

  return {
    game: g.exists ? g.data() : null,
    categoryDoc: c && c.exists ? c.data() : null,
    platformCategory: (s.exists && lowerCat) ? (s.data().categories?.[lowerCat] || null) : null,
    platformTotals: s.exists ? {
      totalGGCoinsGathered: s.data().totalGGCoinsGathered || null,
      totalGGCoinsDistributed: s.data().totalGGCoinsDistributed || null,
      totalGamesPlayed: s.data().totalGamesPlayed || 0
    } : null
  };
}

/* -------------------------------------------------------------------------- */
/* CRON Schedules                                                             */
/* -------------------------------------------------------------------------- */
cron.schedule('*/30 * * * *', updatePlatformStatsAggregatedGGCoins);
cron.schedule('*/5 * * * *', updateALLUsersOnlineStatus);

/* -------------------------------------------------------------------------- */
/* Economy Endpoints                                                          */
/* -------------------------------------------------------------------------- */

app.post('/economy/play', protect, async (req,res)=>{
  const { gameId, category, amount } = req.body;
  if (!gameId || !category || typeof amount !== 'number' || amount <= 0)
    return res.status(400).json({ success:false, message:'Invalid payload.' });
  try {
    await ensurePlatformStatsMonthRollover(); // <-- added
    await applyEconomyDeltas({ gameId, category, gatheredDelta: amount, incrementPlay:true });
    res.json({ success:true, type:'play', amount, snapshot: await getEconomySnapshot(gameId, category) });
  } catch (e) {
    res.status(500).json({ success:false, message:e.message });
  }
});

app.post('/economy/reward', protect, async (req,res)=>{
  const { gameId, category, amount } = req.body;
  if (!gameId || !category || typeof amount !== 'number' || amount <= 0)
    return res.status(400).json({ success:false, message:'Invalid payload.' });
  try {
    await ensurePlatformStatsMonthRollover(); // <-- added
    await applyEconomyDeltas({ gameId, category, distributedDelta: amount });
    res.json({ success:true, type:'reward', amount, snapshot: await getEconomySnapshot(gameId, category) });
  } catch (e) {
    res.status(500).json({ success:false, message:e.message });
  }
});


app.post('/economy/bulk', protect, async (req,res)=>{
   const { entries } = req.body;
  if (!Array.isArray(entries) || !entries.length)
    return res.status(400).json({ success:false, message:'entries array required.' });
  try {
    await ensurePlatformStatsMonthRollover(); // <-- added
  } catch (e) {
    return res.status(500).json({ success:false, message:'Failed month rollover check.' });
  }
  const results = [];
  for (const entry of entries) {
    const { gameId, category, gathered=0, distributed=0, incrementPlay=false } = entry;
    try {
      if (!gameId || !category || (gathered <= 0 && distributed <= 0 && !incrementPlay)) {
        results.push({ gameId, ok:false, error:'Invalid entry' });
        continue;
      }
      await applyEconomyDeltas({
        gameId,
        category,
        gatheredDelta: gathered>0?gathered:0,
        distributedDelta: distributed>0?distributed:0,
        incrementPlay
      });
      results.push({ gameId, ok:true });
    } catch (e) {
      results.push({ gameId, ok:false, error:e.message });
    }
  }
  res.json({ success:true, results });
});
app.post('/economy/snapshot', protect, async (req,res)=>{
  const { gameId, category } = req.body;
  if (!gameId || !category)
    return res.status(400).json({ success:false, message:'gameId & category required.' });
  try {
    res.json({ success:true, snapshot: await getEconomySnapshot(gameId, category) });
  } catch (e) {
    res.status(500).json({ success:false, message:e.message });
  }
});

/* -------------------------------------------------------------------------- */
/* Cashier                                                                    */
/* -------------------------------------------------------------------------- */
app.post('/cashier/deposit', protect, async (req, res) => {
  const { txSignature, solAmount, solPriceOverride } = req.body;
  if (!PLATFORM_SOL_ADDRESS)
    return res.status(500).json({ message: 'Platform SOL address not configured.' });

  try {
    // Make sure lastMonth is valid for the current period
    await ensurePlatformStatsMonthRollover();

    let resolvedSol = 0;

    if (txSignature) {
      const tx = await connection.getTransaction(txSignature, { commitment: 'confirmed' });
      if (!tx) return res.status(400).json({ message: 'Transaction not found.' });

      const keys = tx.transaction.message.accountKeys.map(k => k.toBase58());
      const idx = keys.indexOf(PLATFORM_SOL_ADDRESS);
      if (idx === -1) return res.status(400).json({ message: 'Platform address not in transaction.' });

      const pre = tx.meta?.preBalances?.[idx] ?? 0;
      const post = tx.meta?.postBalances?.[idx] ?? 0;
      const delta = post - pre;
      if (delta <= 0) return res.status(400).json({ message: 'No net SOL received.' });

      resolvedSol = delta / LAMPORTS_PER_SOL;
    } else if (typeof solAmount === 'number' && solAmount > 0) {
      // Fallback/manual mode (only if SOL transfer is handled externally)
      resolvedSol = solAmount;
    } else {
      return res.status(400).json({ message: 'Provide txSignature or positive solAmount.' });
    }

    const price = solPriceOverride || await fetchSolPrice();
    if (price <= 0) return res.status(500).json({ message: 'SOL price unavailable.' });

    // Integer-only credit of GG (1 GG = $1)
    const credit = Math.floor(resolvedSol * price);
    if (!Number.isFinite(credit) || credit <= 0) {
      return res.status(400).json({ message: 'Deposit too small to credit at least 1 GG Coin.' });
    }

    await db.runTransaction(async (t) => {
      const userRef = db.collection('users').doc(req.user.uid);
      const statsRef = db.collection('platform').doc('stats');

      const userSnap = await t.get(userRef);
      if (!userSnap.exists) throw new Error('User not found.');

      const currentGG = Number(userSnap.data()?.coins?.gg ?? 0);
      t.update(userRef, { 'coins.gg': currentGG + credit });

      // Increment platform stats (deposit totals)
      t.set(statsRef, {
        totalGGCoinsDeposited: {
          allTime: admin.firestore.FieldValue.increment(credit),
          lastMonth: admin.firestore.FieldValue.increment(credit),
        },
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    res.json({
      success: true,
      mode: txSignature ? 'on-chain-verified' : 'manual',
      solAmount: resolvedSol,
      solPriceUsed: price,
      ggCoinsCredited: credit,
      txSignature: txSignature || null,
    });
  } catch (e) {
    console.error('/cashier/deposit error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// 7) Cashier: WITHDRAW (integer-only GG; server sends SOL to user wallet)
//    - Debit integer ggAmount.
//    - Convert to SOL via price and send from admin wallet.
//    - Increment ggCoinsWithdrawn.{allTime,lastMonth}
app.post('/cashier/withdraw', protect, async (req, res) => {
  const { ggAmount, destinationWallet, solPriceOverride } = req.body;

  if (!adminWalletKeypair) return res.status(500).json({ message: 'Admin wallet unavailable.' });
  if (!Number.isInteger(ggAmount) || ggAmount <= 0)
    return res.status(400).json({ message: 'ggAmount must be a positive integer.' });

  try {
    // Make sure lastMonth is valid for the current period
    await ensurePlatformStatsMonthRollover();

    const price = solPriceOverride || await fetchSolPrice();
    if (price <= 0) return res.status(500).json({ message: 'SOL price unavailable.' });

    const solNeeded = ggAmount / price;
    const lamports = Math.round(solNeeded * LAMPORTS_PER_SOL);
    if (lamports <= 0) return res.status(400).json({ message: 'Withdrawal < 1 lamport.' });

    let signature = null;

    await db.runTransaction(async (t) => {
      const userRef = db.collection('users').doc(req.user.uid);
      const statsRef = db.collection('platform').doc('stats');
      const userSnap = await t.get(userRef);
      if (!userSnap.exists) throw new Error('User not found.');

      const data = userSnap.data();
      const currentGG = Number(data?.coins?.gg ?? 0);
      if (currentGG < ggAmount) throw new Error('Insufficient GG Coins.');

      const toWallet = destinationWallet || data.wallet;
      if (!toWallet) throw new Error('Destination wallet missing.');

      // Prepare SOL transfer from admin to user
      const tx = new Transaction().add(SystemProgram.transfer({
        fromPubkey: adminWalletKeypair.publicKey,
        toPubkey: new PublicKey(toWallet),
        lamports,
      }));
      tx.feePayer = adminWalletKeypair.publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
      tx.recentBlockhash = blockhash;
      tx.sign(adminWalletKeypair);

      signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, 'confirmed');

      // Debit user GG and increment platform withdrawn totals
      t.update(userRef, { 'coins.gg': currentGG - ggAmount });
      t.set(statsRef, {
         totalGGCoinsWithdrawn: {
          allTime: admin.firestore.FieldValue.increment(ggAmount),
          lastMonth: admin.firestore.FieldValue.increment(ggAmount),
        },
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    res.json({
      success: true,
      ggCoinsDebited: ggAmount,
      solAmountSent: solNeeded,
      lamportsSent: lamports,
      solPriceUsed: price,
      txSignature: signature,
    });
  } catch (e) {
    console.error('/cashier/withdraw error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});
/* -------------------------------------------------------------------------- */
/* Direct Increment Endpoints                                                 */
/* -------------------------------------------------------------------------- */
app.post('/api/games/increment-ggcoins-gathered', protect, async (req,res)=>{
  const { gameId, category, amount } = req.body;
  const inc = Number(amount);
  if (!gameId || !category || isNaN(inc) || inc <= 0)
    return res.status(400).json({ success:false, error:'Invalid payload.' });
  try {
    await db.collection('games').doc(gameId).update({
      'ggCoinsGathered.allTime': admin.firestore.FieldValue.increment(inc),
      'ggCoinsGathered.lastMonth': admin.firestore.FieldValue.increment(inc)
    });
    await db.collection('platform').doc('stats').update({
      [`categories.${category}.ggCoinsGathered.allTime`]: admin.firestore.FieldValue.increment(inc),
      [`categories.${category}.ggCoinsGathered.lastMonth`]: admin.firestore.FieldValue.increment(inc),
      'totalGGCoinsGathered.allTime': admin.firestore.FieldValue.increment(inc),
      'totalGGCoinsGathered.lastMonth': admin.firestore.FieldValue.increment(inc)
    });
    res.json({ success:true });
  } catch (e) {
    res.status(500).json({ success:false, error:e.message });
  }
});

app.post('/api/games/increment-ggcoins-distributed', protect, async (req,res)=>{
  const { gameId, category, amount } = req.body;
  const inc = Number(amount);
  if (!gameId || !category || isNaN(inc) || inc <= 0)
    return res.status(400).json({ success:false, error:'Invalid payload.' });
  try {
    await db.collection('games').doc(gameId).update({
      'ggCoinsDistributed.allTime': admin.firestore.FieldValue.increment(inc),
      'ggCoinsDistributed.lastMonth': admin.firestore.FieldValue.increment(inc)
    });
    await db.collection('platform').doc('stats').update({
      [`categories.${category}.ggCoinsDistributed.allTime`]: admin.firestore.FieldValue.increment(inc),
      [`categories.${category}.ggCoinsDistributed.lastMonth`]: admin.firestore.FieldValue.increment(inc),
      'totalGGCoinsDistributed.allTime': admin.firestore.FieldValue.increment(inc),
      'totalGGCoinsDistributed.lastMonth': admin.firestore.FieldValue.increment(inc)
    });
    res.json({ success:true });
  } catch (e) {
    res.status(500).json({ success:false, error:e.message });
  }
});

app.post('/api/games/increment-games-played', protect, async (req,res)=>{
  const { gameId, category } = req.body;
  if (!gameId || !category)
    return res.status(400).json({ success:false, error:'Invalid payload.' });
  try {
    const gameRef = db.collection('games').doc(gameId);
    const snap = await gameRef.get();
    if (!snap.exists) {
      await gameRef.set({
        id: gameId,
        category,
        gamesPlayed: { ...emptyStatsMap }
      }, { merge:true });
    }
    await gameRef.update({
      'gamesPlayed.allTime': admin.firestore.FieldValue.increment(1),
      'gamesPlayed.lastMonth': admin.firestore.FieldValue.increment(1)
    });
    await db.collection('platform').doc('stats').update({
      [`categories.${category}.gamesPlayed.allTime`]: admin.firestore.FieldValue.increment(1),
      [`categories.${category}.gamesPlayed.lastMonth`]: admin.firestore.FieldValue.increment(1),
      'totalGamesPlayed': admin.firestore.FieldValue.increment(1)
    });
    res.json({ success:true });
  } catch (e) {
    res.status(500).json({ success:false, error:e.message });
  }
});

/* Legacy SOL gather endpoint */
app.post('/api/games/increment-sol-gathered', protect, async (req,res)=>{
  const { gameId, category, amount } = req.body;
  const inc = Number(amount);
  if (!gameId || !category || isNaN(inc) || inc <= 0)
    return res.status(400).json({ success:false, error:'Invalid payload.' });
  try {
    await db.collection('games').doc(gameId).set({
      solGathered: {
        allTime: admin.firestore.FieldValue.increment(inc),
        lastMonth: admin.firestore.FieldValue.increment(inc)
      }
    }, { merge:true });
    await db.collection('platform').doc('stats').set({
      [`categories.${category}.solGathered.allTime`]: admin.firestore.FieldValue.increment(inc),
      [`categories.${category}.solGathered.lastMonth`]: admin.firestore.FieldValue.increment(inc)
    }, { merge:true });
    res.json({ success:true });
  } catch (e) {
    res.status(500).json({ success:false, error:e.message });
  }
});

/* -------------------------------------------------------------------------- */
/* Public Base & Price                                                        */
/* -------------------------------------------------------------------------- */
app.get('/', (_req,res)=> res.send('GG Web3 Backend is running!'));
app.get('/api/prices', async (_req,res)=> {
  res.json({ solUsd: await fetchSolPrice() });
});

/* -------------------------------------------------------------------------- */
/* Auth & Wallet                                                              */
/* -------------------------------------------------------------------------- */
app.post('/register', async (req,res)=>{
  const { email, password, username } = req.body;
  if (!email || !password || !username)
    return res.status(400).json({ message:'Missing fields.' });
  try {
    const record = await auth.createUser({ email, password });
    await getUserDocRef(record.uid).set({
      username,
      usernameLowercase: username.toLowerCase(),
      email,
      uid: record.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      avatarUrl: '/avatars/default.png',
      freeEntryTokens:{ arcade:0, picker:0, casino:0, pvp:0 },
      coins: { gg: 0 },
      isOnline: false,
      lastSeen: null,
      friends: [],
      friendRequestsSent: [],
      friendRequestsReceived: [],
    });
    res.status(201).json({ message:'User registered' });
  } catch (e) {
    let msg = 'Registration failed';
    if (e.code === 'auth/email-already-in-use') msg = 'Email already in use';
    if (e.code === 'auth/invalid-email') msg = 'Invalid email';
    if (e.code === 'auth/weak-password') msg = 'Weak password';
    res.status(400).json({ message: msg, code:e.code });
  }
});
app.post('/login', (_req,res)=> {
  res.json({ message:'Login handled via Firebase client SDK.' });
});

app.post('/verify-wallet', async (req,res)=>{
  try {
    const { address, signedMessage, nonce } = req.body;
    if (!address || !signedMessage || !nonce)
      return res.status(400).json({ error:'Missing parameters' });
    const message = `Sign in to GG Web3 with this one-time code: ${nonce}`;
    const msgBytes = new TextEncoder().encode(message);
    let sigBytes;
    try { sigBytes = Buffer.from(signedMessage,'base64'); }
    catch { return res.status(400).json({ error:'Invalid signature format' }); }
    const pk = new PublicKey(address);
    const verified = nacl.sign.detached.verify(msgBytes, sigBytes, pk.toBytes());
    if (!verified) return res.status(400).json({ error:'Verification failed' });

    try { await auth.getUser(address); }
    catch (e) {
      if (e.code === 'auth/user-not-found') {
        await auth.createUser({ uid: address, displayName:`Player_${address.slice(0,4)}` });
        await getUserDocRef(address).set({
          uid: address,
          wallet: address,
          username: `Player_${address.slice(0,4)}`,
          usernameLowercase: `player_${address.slice(0,4)}`,
          avatarUrl: '/avatars/default.png',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          isOnline: true,
          lastSeen: admin.firestore.FieldValue.serverTimestamp(),
          friends: [],
          friendRequestsSent: [],
          friendRequestsReceived: [],
          freeEntryTokens:{ arcade:0, picker:0, casino:0, pvp:0 },
          coins:{ gg:0 }
        }, { merge:true });
      } else throw e;
    }
    const customToken = await auth.createCustomToken(address, {
      solanaWalletAddress: address,
      isSolanaVerified: true
    });
    res.json({ customToken });
  } catch (e) {
    res.status(500).json({ error:'Internal error' });
  }
});

/* -------------------------------------------------------------------------- */
/* Profile & Users                                                            */
/* -------------------------------------------------------------------------- */
app.get('/profile', protect, async (req,res)=>{
  const snap = await getUserDocRef(req.user.uid).get();
  if (!snap.exists) return res.status(404).json({ message:'User not found' });
  res.json(snap.data());
});
app.put('/profile', protect, async (req,res)=>{
  const allowed = ['username','avatarUrl','bio','dmsOpen','duelsOpen','twitter','discord','telegram','instagram'];
  const update = {};
  for (const k of allowed) if (req.body[k] !== undefined) update[k] = req.body[k];
  if (update.username) update.usernameLowercase = update.username.toLowerCase();
  if (!Object.keys(update).length) return res.status(400).json({ message:'No fields to update' });
  await getUserDocRef(req.user.uid).update(update);
  res.json({ message:'Profile updated' });
});
app.get('/users/:uid', protect, async (req,res)=>{
  const snap = await getUserDocRef(req.params.uid).get();
  if (!snap.exists) return res.status(404).json({ message:'User not found' });
  const data = snap.data();
  delete data.email;
  delete data.freeEntryTokens;
  res.json(data);
});
app.get('/api/usernames', protect, async (_req,res)=>{
  const snap = await db.collection('users').get();
  res.json(snap.docs.map(d=>{
    const u = d.data();
    return { key:d.id, username:u.username||'', avatarUrl:u.avatarUrl||'', wallet:u.wallet||'' };
  }));
});

/* -------------------------------------------------------------------------- */
/* Free Entry Tokens                                                          */
/* -------------------------------------------------------------------------- */
app.get('/user/free-entry-tokens', protect, async (req,res)=>{
  const snap = await getUserDocRef(req.user.uid).get();
  if (!snap.exists) return res.status(404).json({ message:'User not found' });
  res.json(snap.data().freeEntryTokens || { arcade:0, picker:0, casino:0, pvp:0 });
});
app.post('/tokens/generate', protect, async (req,res)=>{
  const { tokenType } = req.body;
  const valid = ['arcade','picker','casino','pvp'];
  if (!valid.includes(tokenType)) return res.status(400).json({ message:'Invalid tokenType' });
  await getUserDocRef(req.user.uid).update({
    [`freeEntryTokens.${tokenType}`]: admin.firestore.FieldValue.increment(1),
    [`freeEntryTokens.${tokenType}Tokens`]: admin.firestore.FieldValue.increment(1),
  });
  res.json({ message:'Token granted', tokenType });
});
app.post('/tokens/consume', protect, async (req,res)=>{
  const { tokenType } = req.body;
  const key = `${tokenType}Tokens`;
  try {
    await db.runTransaction(async t=>{
      const ref = getUserDocRef(req.user.uid);
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('User not found');
      const tokens = snap.data().freeEntryTokens || {};
      const available = tokens[key] || 0;
      if (available <= 0) throw new Error(`No ${tokenType} tokens`);
      t.update(ref, { [`freeEntryTokens.${key}`]: admin.firestore.FieldValue.increment(-1) });
    });
    res.json({ message:'Token consumed', tokenType });
  } catch (e) {
    res.status(400).json({ message:e.message });
  }
});

/* -------------------------------------------------------------------------- */
/* Platform Stats / Online Users                                              */
/* -------------------------------------------------------------------------- */
app.get('/platform-stats', async (_req,res)=>{
  const statsDoc = await db.collection('platform').doc('stats').get();
  if (!statsDoc.exists) {
    const { current, last } = getPeriodKeys();
    return res.json({
      registeredUsers:0,
      onlineUsers:0,
      totalGamesPlayed:0,
      totalGGCoinsDeposited:{...emptyStatsMap},
      totalGGCoinsWithdrawn:{...emptyStatsMap},
      totalGGCoinsGathered:{...emptyStatsMap},
      totalGGCoinsDistributed:{...emptyStatsMap},
      lastUpdated:null,
      currentMonthPeriod: current,
      lastMonthPeriod: last,
      categories:{
        arcade:{ ggCoinsGathered:{...emptyStatsMap}, ggCoinsDistributed:{...emptyStatsMap}, gamesPlayed:{...emptyStatsMap}, games:[] },
        pvp:{ ggCoinsGathered:{...emptyStatsMap}, ggCoinsDistributed:{...emptyStatsMap}, gamesPlayed:{...emptyStatsMap}, games:[] },
        casino:{ ggCoinsGathered:{...emptyStatsMap}, ggCoinsDistributed:{...emptyStatsMap}, gamesPlayed:{...emptyStatsMap}, games:[] },
        picker:{ ggCoinsGathered:{...emptyStatsMap}, ggCoinsDistributed:{...emptyStatsMap}, gamesPlayed:{...emptyStatsMap}, games:[] },
      },
      games:{}
    });
  }
  res.json(statsDoc.data());
});
app.get('/onlineUsers', async (_req,res)=>{
  res.json({ onlineUserIds: await getOnlineUserIds() });
});

/* -------------------------------------------------------------------------- */
/* Games & Categories Lists                                                   */
/* -------------------------------------------------------------------------- */
app.get('/games', protect, async (_req,res)=>{
  const snap = await db.collection('games').get();
  res.json(snap.docs.map(d=>({ id:d.id, ...d.data() })));
});
app.get('/categories', protect, async (_req,res)=>{
  const snap = await db.collection('categories').get();
  res.json(snap.docs.map(d=>({ id:d.id, ...d.data() })));
});

/* -------------------------------------------------------------------------- */
/* Legacy / Placeholder Token Play & Reward                                   */
/* -------------------------------------------------------------------------- */
app.post('/play', protect, async (req,res)=>{
  const { gameId, wagerAmount, prediction } = req.body;
  const userId = req.user.uid;
  try {
    const userSnap = await getUserDocRef(userId).get();
    if (!userSnap.exists || !userSnap.data().wallet)
      return res.status(400).json({ error:'Wallet not linked.' });
    if (!adminWalletKeypair || !gameTokenMint)
      return res.status(500).json({ error:'Server token mint not initialized.' });

    await db.collection('games').doc(gameId).set({
      gameId,
      userId,
      wagerAmount,
      prediction,
      status:'pending_transaction',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      userSolanaAddress: userSnap.data().wallet
    }, { merge:true });

    res.json({ success:true, message:'Game initiated (placeholder)' });
  } catch {
    res.status(500).json({ error:'Failed to initiate play.' });
  }
});
app.post('/game-state-update', protect, async (req,res)=>{
  const { gameId, transactionSignature, status } = req.body;
  try {
    const confirmation = await connection.confirmTransaction(transactionSignature,'confirmed');
    if (confirmation.value.err) {
      await db.collection('games').doc(gameId).update({
        status:'failed_wager',
        transactionError: JSON.stringify(confirmation.value.err)
      });
      return res.status(400).json({ message:'Transaction failed.' });
    }
    await db.collection('games').doc(gameId).update({
      status,
      transactionSignature,
      confirmedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ message:'Game state updated.' });
  } catch {
    res.status(500).json({ message:'Failed to update game state.' });
  }
});
app.post('/process-reward', protect, async (req,res)=>{
  const { gameId, amount=0, isWinnerClaim=false } = req.body;
  try {
    const gameRef = db.collection('games').doc(gameId);
    const snap = await gameRef.get();
    if (!snap.exists) return res.status(404).json({ message:'Game not found.' });

    if (isWinnerClaim) {
      await gameRef.update({
        claimed:true,
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
        status:'claimed'
      });
    } else {
      await gameRef.update({
        status:'rewarded',
        [`collectedBy.${req.user.uid}`]: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    res.json({ success:true, message:'Reward processed (placeholder).' });
  } catch (e) {
    res.status(500).json({ message:e.message });
  }
});

/* -------------------------------------------------------------------------- */
/* Picker Session Tokens                                                      */
/* -------------------------------------------------------------------------- */
app.post('/api/picker/create-session', protect, async (req,res)=>{
  const { gameId, paymentSignature, currency } = req.body;
  try {
    const docRef = await db.collection('gameEntryTokens').add({
      userId: req.user.uid,
      category: 'Picker',
      gameId,
      issuedAt: admin.firestore.FieldValue.serverTimestamp(),
      isConsumed:false,
      paymentCurrency: currency,
      paymentAmount: currency === 'SOL' ? 0.01 : 0,
      txSig: paymentSignature || null
    });
    res.json({ gameEntryTokenId: docRef.id });
  } catch {
    res.status(500).json({ message:'Failed to create session token.' });
  }
});
app.get('/api/picker/validate-session/:id', protect, async (req,res)=>{
  try {
    const doc = await db.collection('gameEntryTokens').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ valid:false, message:'Session token not found.' });
    const data = doc.data();
    if (data.isConsumed) return res.status(400).json({ valid:false, message:'Token already consumed.' });
    if (data.userId !== req.user.uid) return res.status(403).json({ valid:false, message:'Token belongs to another user.' });
    res.json({ valid:true });
  } catch {
    res.status(500).json({ valid:false, message:'Failed to validate token.' });
  }
});

/* -------------------------------------------------------------------------- */
/* Friends System                                                             */
/* -------------------------------------------------------------------------- */
app.post('/friend-request/send', protect, async (req,res)=>{
  const { targetUsername } = req.body;
  if (!targetUsername) return res.status(400).json({ message:'targetUsername required' });
  try {
    const usersRef = db.collection('users');
    const q = await usersRef.where('usernameLowercase','==', targetUsername.toLowerCase()).limit(1).get();
    if (q.empty) return res.status(404).json({ message:'User not found' });
    const targetId = q.docs[0].id;
    if (targetId === req.user.uid) return res.status(400).json({ message:'Cannot friend yourself' });

    const currentSnap = await usersRef.doc(req.user.uid).get();
    const data = currentSnap.data();
    if (data.friends?.includes(targetId)) return res.status(400).json({ message:'Already friends' });
    if (data.friendRequestsSent?.includes(targetId)) return res.status(400).json({ message:'Request already sent' });

    if (data.friendRequestsReceived?.includes(targetId)) {
      const batch = db.batch();
      batch.update(usersRef.doc(req.user.uid), {
        friends: admin.firestore.FieldValue.arrayUnion(targetId),
        friendRequestsReceived: admin.firestore.FieldValue.arrayRemove(targetId)
      });
      batch.update(usersRef.doc(targetId), {
        friends: admin.firestore.FieldValue.arrayUnion(req.user.uid),
        friendRequestsSent: admin.firestore.FieldValue.arrayRemove(req.user.uid)
      });
      await batch.commit();
      return res.json({ message:'Friend request auto-accepted' });
    }

    const batch = db.batch();
    batch.update(usersRef.doc(req.user.uid), {
      friendRequestsSent: admin.firestore.FieldValue.arrayUnion(targetId)
    });
    batch.update(usersRef.doc(targetId), {
      friendRequestsReceived: admin.firestore.FieldValue.arrayUnion(req.user.uid)
    });
    await batch.commit();
    res.json({ message:'Friend request sent' });
  } catch {
    res.status(500).json({ message:'Failed to send request' });
  }
});
app.post('/friend-request/accept', protect, async (req,res)=>{
  const { senderId } = req.body;
  if (!senderId) return res.status(400).json({ message:'senderId required' });
  try {
    const usersRef = db.collection('users');
    const batch = db.batch();
    batch.update(usersRef.doc(req.user.uid), {
      friends: admin.firestore.FieldValue.arrayUnion(senderId),
      friendRequestsReceived: admin.firestore.FieldValue.arrayRemove(senderId)
    });
    batch.update(usersRef.doc(senderId), {
      friends: admin.firestore.FieldValue.arrayUnion(req.user.uid),
      friendRequestsSent: admin.firestore.FieldValue.arrayRemove(req.user.uid)
    });
    await batch.commit();
    res.json({ message:'Friend request accepted' });
  } catch {
    res.status(500).json({ message:'Failed to accept request' });
  }
});
app.post('/friend-request/reject', protect, async (req,res)=>{
  const { senderId } = req.body;
  if (!senderId) return res.status(400).json({ message:'senderId required' });
  try {
    const usersRef = db.collection('users');
    const batch = db.batch();
    batch.update(usersRef.doc(req.user.uid), {
      friendRequestsReceived: admin.firestore.FieldValue.arrayRemove(senderId)
    });
    batch.update(usersRef.doc(senderId), {
      friendRequestsSent: admin.firestore.FieldValue.arrayRemove(req.user.uid)
    });
    await batch.commit();
    res.json({ message:'Friend request rejected' });
  } catch {
    res.status(500).json({ message:'Failed to reject request' });
  }
});
app.post('/friends/remove', protect, async (req,res)=>{
  const { friendId } = req.body;
  if (!friendId) return res.status(400).json({ message:'friendId required' });
  try {
    const usersRef = db.collection('users');
    const batch = db.batch();
    batch.update(usersRef.doc(req.user.uid), {
      friends: admin.firestore.FieldValue.arrayRemove(friendId)
    });
    batch.update(usersRef.doc(friendId), {
      friends: admin.firestore.FieldValue.arrayRemove(req.user.uid)
    });
    await batch.commit();
    res.json({ message:'Friend removed' });
  } catch {
    res.status(500).json({ message:'Failed to remove friend' });
  }
});
app.get('/friends', protect, async (req,res)=>{
  try {
    const snap = await getUserDocRef(req.user.uid).get();
    if (!snap.exists) return res.status(404).json({ message:'User not found' });
    const friendIds = snap.data().friends || [];
    if (!friendIds.length) return res.json([]);
    const chunks = chunkArray(friendIds, 10);
    const friendsData = [];
    for (const ch of chunks) {
      const q = await db.collection('users')
        .where(admin.firestore.FieldPath.documentId(),'in', ch)
        .get();
      q.forEach(doc=>{
        const u = doc.data();
        friendsData.push({
          uid: doc.id,
          username: u.username,
          avatarUrl: u.avatarUrl || '/avatars/default.png',
          isOnline: u.isOnline || false
        });
      });
    }
    res.json(friendsData);
  } catch (e) {
    res.status(500).json({ message:'Failed to fetch friends' });
  }
});
app.get('/friend-requests/sent', protect, async (req,res)=>{
  try {
    const user = await getUserDocRef(req.user.uid).get();
    if (!user.exists) return res.status(404).json({ message:'User not found' });
    const ids = user.data().friendRequestsSent || [];
    if (!ids.length) return res.json([]);
    const chunks = chunkArray(ids, 10);
    const out = [];
    for (const ch of chunks) {
      const q = await db.collection('users')
        .where(admin.firestore.FieldPath.documentId(),'in', ch)
        .get();
      q.forEach(doc=>{
        const u = doc.data();
        out.push({ uid: doc.id, username:u.username, avatarUrl:u.avatarUrl });
      });
    }
    res.json(out);
  } catch {
    res.status(500).json({ message:'Failed to fetch sent requests' });
  }
});
app.get('/friend-requests/received', protect, async (req,res)=>{
  try {
    const user = await getUserDocRef(req.user.uid).get();
    if (!user.exists) return res.status(404).json({ message:'User not found' });
    const ids = user.data().friendRequestsReceived || [];
    if (!ids.length) return res.json([]);
    const chunks = chunkArray(ids, 10);
    const out = [];
    for (const ch of chunks) {
      const q = await db.collection('users')
        .where(admin.firestore.FieldPath.documentId(),'in', ch)
        .get();
      q.forEach(doc=>{
        const u = doc.data();
        out.push({ uid: doc.id, username:u.username, avatarUrl:u.avatarUrl });
      });
    }
    res.json(out);
  } catch {
    res.status(500).json({ message:'Failed to fetch received requests' });
  }
});

/* -------------------------------------------------------------------------- */
/* Chat Routes (using inlined functions)                                      */
/* -------------------------------------------------------------------------- */
app.get('/chats', protect, async (req,res)=>{
  try {
    res.json(await getUserChats(req.user.uid));
  } catch (e) {
    res.status(500).json({ message:'Failed to fetch chats' });
  }
});
app.post('/chats/findOrCreate', protect, async (req,res)=>{
  const { targetUid } = req.body;
  if (!targetUid) return res.status(400).json({ message:'targetUid required' });
  try {
    const chat = await findOrCreateChat(req.user.uid, targetUid);
    res.json(chat);
  } catch (e) {
    res.status(500).json({ message:e.message || 'Failed to create chat' });
  }
});
app.post('/chats/:chatId/messages', protect, async (req,res)=>{
  const { chatId } = req.params;
  const { text } = req.body;
  if (!chatId || !text) return res.status(400).json({ message:'chatId & text required' });
  try {
    await sendMessage(chatId, req.user.uid, text);
    res.json({ message:'Message sent' });
  } catch {
    res.status(500).json({ message:'Failed to send message' });
  }
});

/* -------------------------------------------------------------------------- */
/* Leaderboards                                                               */
/* -------------------------------------------------------------------------- */
app.post('/leaderboards/submit-score', protect, async (req,res)=>{
  const { gameId, score } = req.body;
  if (!gameId || typeof score !== 'number')
    return res.status(400).json({ message:'Invalid payload' });
  const gameSnap = await db.collection('games').doc(gameId).get();
  if (gameSnap.exists && (gameSnap.data().category||'').toLowerCase()==='picker')
    return res.status(400).json({ message:'Picker games have no leaderboard.' });

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const lbRef = db.collection('leaderboards').doc(gameId);
  const lbSnap = await lbRef.get();
  const data = lbSnap.exists ? lbSnap.data() : {};
  data.allTimeScores = data.allTimeScores || {};
  data.monthlyScores = data.monthlyScores || {};
  data.monthlyScores[monthKey] = data.monthlyScores[monthKey] || {};
  data.monthlyScores[monthKey][req.user.uid] = { score, timestamp: now.toISOString() };
  const prev = data.allTimeScores[req.user.uid]?.score || 0;
  let updatedAllTime = false;
  if (score > prev) {
    data.allTimeScores[req.user.uid] = { score, timestamp: now.toISOString() };
    updatedAllTime = true;
  }
  await lbRef.set(data, { merge:true });
  res.json({ message:'Score submitted', updatedAllTime });
});
app.get('/leaderboards/:gameId', protect, async (req,res)=>{
  const snap = await db.collection('leaderboards').doc(req.params.gameId).get();
  if (!snap.exists) return res.status(404).json({ message:'Leaderboard not found' });
  res.json(snap.data());
});

/* -------------------------------------------------------------------------- */
/* Migration / Normalization                                                  */
/* -------------------------------------------------------------------------- */
function safeToDate(value) {
  try {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate(); // Firestore Timestamp
    if (value instanceof Date) return value;
    if (typeof value === 'number') {
      // Heuristic: > 1e12 ≈ ms, else seconds
      return new Date(value > 1e12 ? value : value * 1000);
    }
    if (typeof value === 'string') {
      const ts = Date.parse(value);
      if (!isNaN(ts)) return new Date(ts);
    }
  } catch (e) {
    console.warn('[CHAT] safeToDate failed for value:', value, e);
  }
  return null;
}

// --- REPLACE your existing getUserChats with this version ---


// TEMP migration script (run with admin initialized)
async function migrateChatTimestamps() {
  const chatsSnap = await db.collection('chats').get();
  let batch = db.batch();
  let count = 0;
  for (const doc of chatsSnap.docs) {
    const data = doc.data();
    let needs = false;
    const update = {};

    // lastMessage.sentAt
    if (data.lastMessage?.sentAt && typeof data.lastMessage.sentAt.toDate !== 'function') {
      const d = safeToDate(data.lastMessage.sentAt);
      if (d) {
        update['lastMessage.sentAt'] = admin.firestore.Timestamp.fromDate(d);
        needs = true;
      }
    }

    // lastMessageAt
    if (data.lastMessageAt && typeof data.lastMessageAt.toDate !== 'function') {
      const d = safeToDate(data.lastMessageAt);
      if (d) {
        update['lastMessageAt'] = admin.firestore.Timestamp.fromDate(d);
        needs = true;
      }
    }

    // If chat never had lastMessageAt but has createdAt, add it
    if (!data.lastMessageAt && data.createdAt) {
      const d = safeToDate(data.createdAt);
      if (d) {
        update['lastMessageAt'] = admin.firestore.Timestamp.fromDate(d);
        needs = true;
      }
    }

    if (needs) {
      batch.update(doc.ref, update);
      count++;
      if (count === 400) {
        await batch.commit();
        console.log('[MIGRATE] Partial commit (400).');
        batch = db.batch();
        count = 0;
      }
    }
  }
  if (count) await batch.commit();
  console.log('[MIGRATE] Chat timestamp normalization complete.');
}

// Call it manually once:
 migrateChatTimestamps().catch(console.error);

/* -------------------------------------------------------------------------- */
/* Error Handler                                                              */
/* -------------------------------------------------------------------------- */
app.use((err, _req, res, _next)=>{
  console.error('[ERROR] Unhandled:', err);
  res.status(500).json({ message:'Internal server error' });
});

/* -------------------------------------------------------------------------- */
/* Start Server                                                               */
/* -------------------------------------------------------------------------- */
server.listen(PORT, async () => {
  console.log(`GG Web3 Backend listening on port ${PORT}`);
  await ensurePlatformStatsBase();
  if (process.env.CHAT_BACKFILL_LASTMESSAGEAT === 'true') {
    try {
      await backfillChatLastMessageAt();
    } catch (e) {
      console.error('[CHAT] Backfill failed:', e);
    }
  }
  updateALLUsersOnlineStatus();
  updatePlatformStatsAggregatedGGCoins();
});