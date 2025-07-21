// src/firebase/chatService.ts

import { db } from '../firebase/firebaseConfig';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  doc, 
  setDoc, 
  updateDoc, 
  orderBy, 
  limit, 
  onSnapshot, 
  Timestamp, // Import Timestamp
  getDoc // <<-- IMPORTANT: Ensure getDoc is imported here!
} from 'firebase/firestore';
import { ProfileData } from '../types/profile'; 

// --- Interfaces ---
export interface ChatListItem {
  chatId: string;
  lastMessage?: {
    from: string; 
    sentAt: Date; // Always a Date object in frontend
    text: string;
  };
  participants: string[];
  friend: { // Simplified friend data needed for display in chat list
    uid: string;
    username: string;
    avatarUrl: string;
  };
  createdAt: Date; // Always a Date object in frontend
}

export interface ChatMessage {
  id: string; 
  from: string; 
  text: string;
  sentAt: Date; // Always a Date object in frontend
}


// --- Utility for converting Firestore Timestamp to Date ---
const toDate = (timestamp: Timestamp | any): Date => {
  if (timestamp instanceof Timestamp) {
    return timestamp.toDate();
  }
  // Fallback for non-Timestamp types (e.g., if saved as a number or string)
  if (typeof timestamp === 'number' || typeof timestamp === 'string') {
    return new Date(timestamp);
  }
  return new Date(); // Default to current date if conversion fails
};


// --- Functions ---

/**
 * Finds an existing chat between two users or creates a new one.
 * Ensures participants are sorted for consistent querying.
 * Returns a ChatListItem for the selected chat.
 */
export async function findOrCreateChat(myUid: string, targetUid: string): Promise<ChatListItem> {
  if (!myUid || !targetUid || myUid === targetUid) {
    // Improved error message for clarity
    throw new Error("Chat creation failed: Invalid UIDs provided. myUid, targetUid must be valid and different.");
  }

  const participants = [myUid, targetUid].sort();
  const chatsRef = collection(db, "chats");

  // Query for a chat with these two participants.
  // Using array-contains-all to ensure both UIDs are present.
  const q = query(
    chatsRef, 
    where("participants", "array-contains-all", participants),
    limit(1) 
  );
  
  const querySnapshot = await getDocs(q);

  let chatId: string;
  let chatData: any; 

  if (!querySnapshot.empty) {
    // Chat exists, use it
    const chatDoc = querySnapshot.docs[0];
    chatId = chatDoc.id;
    chatData = chatDoc.data();
    console.log(`findOrCreateChat: Found existing chat ${chatId} for participants: ${participants.join(', ')}`);
  } else {
    // Chat does not exist, create a new one
    console.log(`findOrCreateChat: Creating new chat between ${myUid} and ${targetUid}`);
    const newChatRef = doc(chatsRef); 
    chatId = newChatRef.id;
    const now = Timestamp.now();
    chatData = {
      participants: participants,
      createdAt: now,
      // lastMessage will be added on first message
    };
    await setDoc(newChatRef, chatData);
    console.log(`findOrCreateChat: New chat created with ID: ${chatId}`);
  }

  // Now, fetch the target user's profile to complete the ChatListItem's `friend` data
  let fetchedFriendProfile: ProfileData | null = null;
  const targetUserDocRef = doc(db, "users", targetUid);
  // FIX: Changed getdoc to getDoc (uppercase 'D')
  const targetUserDocSnap = await getDoc(targetUserDocRef); 
  if (targetUserDocSnap.exists()) {
    fetchedFriendProfile = targetUserDocSnap.data() as ProfileData;
  } else {
    console.warn(`findOrCreateChat: Target user profile not found for UID: ${targetUid}`);
  }

  // Construct the ChatListItem object
  // Ensure chatId is always a string and not undefined/null if the chat was just created
  if (!chatId) {
      console.error("findOrCreateChat: Chat ID is undefined after creation/finding.");
      throw new Error("Failed to determine chat ID.");
  }

  return {
    chatId: chatId,
    participants: chatData.participants,
    lastMessage: chatData.lastMessage ? {
      from: chatData.lastMessage.from,
      sentAt: toDate(chatData.lastMessage.sentAt),
      text: chatData.lastMessage.text,
    } : undefined,
    friend: {
      uid: targetUid,
      username: fetchedFriendProfile?.username || "Unknown User",
      avatarUrl: fetchedFriendProfile?.avatarUrl || "/WegenRaceAssets/G1small.png",
    },
    createdAt: toDate(chatData.createdAt),
  };
}


/**
 * Sends a message in a given chat. Updates the chat's lastMessage field.
 */
export async function sendMessage(chatId: string, from: string, text: string) {
  if (!chatId || !from || !text) {
      throw new Error("Cannot send message: chatId, sender, or text is missing.");
  }
  const msgData = {
    from,
    text,
    sentAt: Timestamp.now(), 
  };
  
  await addDoc(collection(db, "chats", chatId, "messages"), msgData);
  
  // Update lastMessage field in the chat document
  await updateDoc(doc(db, "chats", chatId), {
    lastMessage: msgData
  });
  console.log(`Message sent in chat ${chatId} by ${from}`);
}

/**
 * Fetches and prepares a list of chats for the given user, with friend's info and last message.
 * Returns ChatListItem[] for display in chat list.
 */
export async function getUserChats(currentUserId: string): Promise<ChatListItem[]> {
  if (!currentUserId) {
    console.warn("getUserChats: currentUserId is null or empty. Cannot fetch chats.");
    return [];
  }

  console.log(`Fetching chats for user: ${currentUserId}`);
  const chatsRef = collection(db, 'chats');
  const q = query(chatsRef, where('participants', 'array-contains', currentUserId));

  try {
    const querySnapshot = await getDocs(q);
    const chatPromises = querySnapshot.docs.map(async (chatDoc) => {
      const chatData = chatDoc.data();
      const chatId = chatDoc.id;

      const participants: string[] = chatData.participants || [];
      const otherParticipantId = participants.find(uid => uid !== currentUserId);

      let friendProfile: ProfileData | null = null;
      if (otherParticipantId) {
        const friendDocRef = doc(db, 'users', otherParticipantId);
        // Ensure getDoc is used here as well
        const friendDocSnap = await getDoc(friendDocRef); 
        if (friendDocSnap.exists()) {
          friendProfile = friendDocSnap.data() as ProfileData;
        } else {
            console.warn(`getUserChats: Friend profile not found for UID: ${otherParticipantId} in chat ${chatId}`);
        }
      }

      const friendDisplay = {
        uid: otherParticipantId || 'unknown',
        username: friendProfile?.username || 'Unknown User',
        avatarUrl: friendProfile?.avatarUrl || '/WegenRaceAssets/G1small.png', 
      };

      const lastMessage = chatData.lastMessage ? {
        from: chatData.lastMessage.from,
        sentAt: toDate(chatData.lastMessage.sentAt),
        text: chatData.lastMessage.text,
      } : undefined;

      return {
        chatId: chatId,
        lastMessage: lastMessage,
        participants: participants,
        friend: friendDisplay,
        createdAt: toDate(chatData.createdAt),
      } as ChatListItem; 
    });

    const chatList = await Promise.all(chatPromises);

    // Sort by last message time if available, newest first. Fallback to chat creation time.
    chatList.sort((a, b) => {
      const timeA = a.lastMessage?.sentAt?.getTime() || a.createdAt.getTime(); 
      const timeB = b.lastMessage?.sentAt?.getTime() || b.createdAt.getTime();
      return timeB - timeA; 
    });

    console.log("Fetched chat list:", chatList);
    return chatList;

  } catch (error) {
    console.error("Error fetching user chats:", error);
    return [];
  }
}

/**
 * Subscribes to real-time messages for a given chat.
 */
export function subscribeToMessages(chatId: string, callback: (messages: ChatMessage[]) => void): () => void {
  if (!chatId) {
      console.warn("subscribeToMessages: chatId is null or empty. Cannot subscribe.");
      // Return a no-op unsubscribe function
      return () => {}; 
  }
  return onSnapshot(
    query(collection(db, "chats", chatId, "messages"), orderBy("sentAt", "asc")),
    (snapshot) => {
      const messages: ChatMessage[] = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data(),
        sentAt: toDate(doc.data().sentAt)
      })) as ChatMessage[];
      callback(messages);
    },
    (error) => { // Added error callback for onSnapshot
        console.error("Error subscribing to messages:", error);
        // Optionally, you could pass this error to the UI via the callback
    }
  );
}