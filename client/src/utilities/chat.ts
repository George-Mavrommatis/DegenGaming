/**
 * Frontend chat utilities (real-time messages only).
 * All CRUD for chats & messages (except real-time subscription) is now delegated to backend API.
 */

import { db } from '../firebase/firebaseConfig';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  Timestamp,
  DocumentData
} from 'firebase/firestore';

export interface ChatLastMessage {
  from: string;
  text: string;
  sentAt: Date;
}

export interface ChatFriend {
  uid: string;
  username: string;
  avatarUrl: string;
  isOnline?: boolean;
}

export interface ChatListItem {
  chatId: string;
  participants: string[];
  friend: ChatFriend | null;
  lastMessage?: ChatLastMessage | null;
  createdAt: Date;
  lastMessageAt?: Date | null;
  usedFallback?: boolean; // set by backend if index fallback used
}

export interface ChatMessage {
  id: string;
  from: string;
  text: string;
  sentAt: Date;
}

export function toDate(anyTs: any): Date {
  if (anyTs instanceof Date) return anyTs;
  if (anyTs instanceof Timestamp) return anyTs.toDate();
  if (typeof anyTs === 'number') {
    // Heuristic for seconds vs ms
    return new Date(anyTs > 1e12 ? anyTs : anyTs * 1000);
  }
  if (typeof anyTs === 'string') return new Date(anyTs);
  return new Date();
}

/**
 * subscribeToMessages
 * Real-time message stream for a given chatId. Backend handles writes, we just listen.
 */
export function subscribeToMessages(
  chatId: string,
  callback: (messages: ChatMessage[]) => void,
  onError?: (e: unknown) => void
): () => void {
  if (!chatId) {
    console.warn('[chat] subscribeToMessages called with empty chatId');
    return () => {};
  }

  const messagesRef = collection(db, 'chats', chatId, 'messages');
  const q = query(messagesRef, orderBy('sentAt', 'asc'));

  console.log('[chat] Subscribing messages for', chatId);

  const unsub = onSnapshot(
    q,
    (snap) => {
      const msgs: ChatMessage[] = snap.docs.map(d => {
        const data = d.data() as DocumentData;
        return {
          id: d.id,
          from: data.from,
          text: data.text,
          sentAt: toDate(data.sentAt)
        };
      });
      callback(msgs);
    },
    (err) => {
      console.error('[chat] onSnapshot error:', err);
      onError?.(err);
    }
  );

  return unsub;
}

// No client-side create/find/sending methods here—use apiService endpoints instead.