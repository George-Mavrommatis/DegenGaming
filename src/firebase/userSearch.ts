import { db } from "./firebaseConfig";
import { collection, query, where, getDocs } from "firebase/firestore";

export async function searchUsers({ username, wallet }: { username?: string; wallet?: string }) {
  let results: any[] = [];

  if (username) {
    const q = query(
      collection(db, "users"),
      where("usernameLowercase", "==", username.trim().toLowerCase())
    );
    const snap = await getDocs(q);
    results.push(...snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  }

  if (wallet) {
    const q = query(
      collection(db, "users"),
      where("wallet", "==", wallet.trim())
    );
    const snap = await getDocs(q);
    results.push(...snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  }

  // Remove duplicates
  const seen = new Set();
  results = results.filter(u => {
    if (seen.has(u.id)) return false;
    seen.add(u.id);
    return true;
  });

  return results;
}
