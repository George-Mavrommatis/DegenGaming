// services/chatService.js - Backend Specific ESM Version

// This module provides chat-related functionalities for the backend,
// using the Firebase Admin SDK.

let _db; // Private variable to hold the Firebase Admin Firestore DB instance
let _admin; // Private variable to hold the firebase-admin module to access FieldValue, Timestamp

// Function to initialize the chat service with the Firestore DB and admin instance
export const initializeChatService = (dbInstance, adminInstance) => {
    _db = dbInstance;
    _admin = adminInstance; // Store admin to access FieldValue, Timestamp, etc.
    console.log("Backend Chat Service Initialized with Firebase Admin Firestore.");
};

/**
 * Finds an existing chat between two users or creates a new one.
 * Ensures participants are sorted for consistent querying.
 */
export const findOrCreateChat = async (user1Uid, user2Uid) => {
    if (!_db) throw new Error("Firestore DB not initialized in chatService.");
    if (!user1Uid || !user2Uid || user1Uid === user2Uid) {
        throw new Error("Invalid UIDs provided for chat creation. UIDs must be valid and different.");
    }

    // Ensure UIDs are sorted for consistent chat ID generation (e.g., userA_userB vs userB_userA)
    const participants = [user1Uid, user2Uid].sort();
    const chatId = participants.join('_'); // Simple chat ID, consistent with frontend if possible

    const chatRef = _db.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();

    if (chatDoc.exists) {
        console.log(`findOrCreateChat: Found existing chat ${chatId}`);
        // Return existing chat data, possibly converting Timestamp objects to Date for consistency
        const data = chatDoc.data();
        return {
            id: chatId,
            ...data,
            createdAt: data.createdAt ? data.createdAt.toDate() : null,
            lastMessageAt: data.lastMessageAt ? data.lastMessageAt.toDate() : null
        };
    } else {
        console.log(`findOrCreateChat: Creating new chat with ID: ${chatId}`);
        const now = _admin.firestore.FieldValue.serverTimestamp();
        const newChatData = {
            participants: participants,
            createdAt: now,
            lastMessage: null, // Will be updated when first message is sent
            lastMessageAt: null,
        };
        await chatRef.set(newChatData);
        // Return new chat data, converting serverTimestamp to a temporary Date for immediate use
        return {
            id: chatId,
            ...newChatData,
            createdAt: new Date(), // Approximate, actual timestamp set by server
            lastMessageAt: null
        };
    }
};

/**
 * Sends a message in a given chat. Updates the chat's lastMessage field.
 */
export const sendMessage = async (chatId, senderUid, text) => {
    if (!_db) throw new Error("Firestore DB not initialized in chatService.");
    if (!chatId || !senderUid || !text) {
        throw new Error("Cannot send message: chatId, senderUid, or text is missing.");
    }

    const chatRef = _db.collection('chats').doc(chatId);
    const messagesRef = chatRef.collection('messages');
    const now = _admin.firestore.FieldValue.serverTimestamp();

    const msgData = {
        from: senderUid,
        text: text,
        sentAt: now,
    };

    await messagesRef.add(msgData);

    // Update lastMessage and lastMessageAt in the chat document for display purposes
    await chatRef.update({
        lastMessage: {
            from: msgData.from,
            text: msgData.text,
            // For lastMessage field, store the server timestamp directly or its converted value if needed by frontend
            sentAt: now, 
        },
        lastMessageAt: now,
    });
    console.log(`Message sent in chat ${chatId} by ${senderUid}`);
};

/**
 * Fetches and prepares a list of chats for the given user.
 * Returns a list of chat objects including friend's info and last message.
 */
export const getUserChats = async (currentUserId) => {
    if (!_db) throw new Error("Firestore DB not initialized in chatService.");
    if (!currentUserId) {
        console.warn("getUserChats: currentUserId is null or empty. Cannot fetch chats.");
        return [];
    }

    console.log(`Fetching chats for user: ${currentUserId}`);
    const chatsRef = _db.collection('chats');
    // Query for chats where the current user is a participant.
    // Order by lastMessageAt to show most recent chats first.
    const q = chatsRef.where('participants', 'array-contains', currentUserId)
                       .orderBy('lastMessageAt', 'desc');

    try {
        const querySnapshot = await q.get();
        const chatPromises = querySnapshot.docs.map(async (chatDoc) => {
            const chatData = chatDoc.data();
            const chatId = chatDoc.id;

            const participants = chatData.participants || [];
            const otherParticipantId = participants.find(uid => uid !== currentUserId);

            let otherParticipantInfo = null;
            if (otherParticipantId) {
                const userDocRef = _db.collection('users').doc(otherParticipantId);
                const userDocSnap = await userDocRef.get();
                if (userDocSnap.exists) {
                    const userData = userDocSnap.data();
                    otherParticipantInfo = {
                        uid: otherParticipantId,
                        username: userData.username,
                        avatarUrl: userData.avatarUrl || '/avatars/default.png', // Default avatar if not set
                        isOnline: userData.isOnline || false, // Assuming online status tracking
                    };
                } else {
                    console.warn(`getUserChats: Other participant profile not found for UID: ${otherParticipantId} in chat ${chatId}`);
                }
            }

            const lastMessage = chatData.lastMessage ? {
                from: chatData.lastMessage.from,
                // Convert Firestore Timestamp to JavaScript Date object for consistency with frontend expectations
                sentAt: chatData.lastMessage.sentAt ? chatData.lastMessage.sentAt.toDate() : null,
                text: chatData.lastMessage.text,
            } : undefined;

            return {
                chatId: chatId,
                lastMessage: lastMessage,
                participants: participants,
                // `friend` key for frontend compatibility if needed, or `otherParticipant`
                friend: otherParticipantInfo, // Renamed 'otherParticipant' to 'friend' for frontend API compatibility
                // Convert Firestore Timestamp to JavaScript Date object
                createdAt: chatData.createdAt ? chatData.createdAt.toDate() : null,
            };
        });

        const chatList = await Promise.all(chatPromises);
        console.log(`Fetched ${chatList.length} chats for user ${currentUserId}.`);
        return chatList;

    } catch (error) {
        console.error(`Error fetching user chats for ${currentUserId}:`, error);
        return [];
    }
};