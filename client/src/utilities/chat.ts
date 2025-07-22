// src/utilities/chat.ts (REVISED - Client-side ONLY for onSnapshot)

import { db } from '../firebase/firebaseConfig'; // Your client-side Firebase Firestore instance
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  Timestamp 
} from 'firebase/firestore';

// --- Interfaces ---
// These interfaces should ideally be shared or derived from backend API responses
// but we'll define them here for clarity in frontend components.
export interface ChatListItem {
  chatId: string;
  lastMessage?: {
    from: string; 
    sentAt: Date; // Always a Date object in frontend after API conversion
    text: string;
  };
  participants: string[];
  friend: { // Simplified friend data needed for display in chat list
    uid: string;
    username: string;
    avatarUrl: string;
    isOnline?: boolean; // Add online status for consistency
  };
  createdAt: Date; // Always a Date object in frontend after API conversion
}

export interface ChatMessage {
  id: string; // Document ID of the message
  from: string; 
  text: string;
  sentAt: Date; // Always a Date object in frontend after API conversion
}

// --- Utility for converting Firestore Timestamp to Date ---
// This is still useful if you're directly consuming Firebase Timestamps from onSnapshot
const toDate = (timestamp: Timestamp | any): Date => {
  if (timestamp instanceof Timestamp) {
    return timestamp.toDate();
  }
  // Fallback for non-Timestamp types (e.g., if saved as a number or string or already a Date)
  if (typeof timestamp === 'number' || typeof timestamp === 'string' || timestamp instanceof Date) {
    return new Date(timestamp);
  }
  return new Date(); // Default to current date if conversion fails
};


// --- Functions ---

/**
 * Subscribes to real-time messages for a given chat.
 * This is the ONLY function that remains client-side for real-time updates.
 * All other chat operations (findOrCreateChat, sendMessage, getUserChats) are now via backend API.
 *
 * @param chatId The ID of the chat to subscribe to.
 * @param callback Function to call with the new messages array.
 * @returns An unsubscribe function to clean up the listener.
 */
export function subscribeToMessages(chatId: string, callback: (messages: ChatMessage[]) => void): () => void {
  if (!chatId) {
    console.warn("subscribeToMessages: chatId is null or empty. Cannot subscribe.");
    return () => {}; // Return a no-op unsubscribe function
  }

  // Ensure 'db' is correctly initialized from firebaseConfig.ts and available.
  const messagesCollectionRef = collection(db, "chats", chatId, "messages");
  const q = query(messagesCollectionRef, orderBy("sentAt", "asc"));

  console.log(`Subscribing to messages for chat ID: ${chatId}`);

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const messages: ChatMessage[] = snapshot.docs.map(doc => ({
        id: doc.id,
        // Firebase Timestamp objects are directly in doc.data(), convert them
        ...doc.data(),
        sentAt: toDate(doc.data().sentAt) 
      })) as ChatMessage[]; 

      callback(messages);
    },
    (error) => {
      console.error("Error subscribing to messages:", error);
      // You might want to handle this error in the UI or retry subscription.
      // For now, it just logs.
    }
  );

  return unsubscribe;
}

// *** REMOVED FUNCTIONS (Now handled by backend via apiService) ***
// export async function findOrCreateChat(...) { ... }
// export async function sendMessage(...) { ... }
// export async function getUserChats(...) { ... }