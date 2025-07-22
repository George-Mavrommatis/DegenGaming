import { db } from "./firebaseConfig";
import { collection, query, where, onSnapshot } from "firebase/firestore";

export function subscribeToOnlineUsers(callback: (users: any[]) => void) {
  const FIVE_MIN = 5 * 60 * 1000;
  const cutoff = new Date(Date.now() - FIVE_MIN).toISOString();

  const q = query(
    collection(db, "users"),
    where("lastSeen", ">", cutoff)
  );

  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() })));
  });
}
