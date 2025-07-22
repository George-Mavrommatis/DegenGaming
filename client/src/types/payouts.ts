// types/payouts.ts (example)
import { Timestamp } from 'firebase/firestore'; // Or firebase-admin/firestore

export interface Payout {
  gameEntryTokenId: string;
  userId: string;
  gameId: string;
  category: string;
  amount: number;
  currency: 'SOL' | 'GGW';
  txSig: string;
  timestamp: Timestamp; // Or FieldValue.serverTimestamp() from admin SDK
  type: 'entry' | 'payout';
}