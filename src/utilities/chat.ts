import { db } from "../firebase/firebaseConfig";
import { collection,limit, getDoc, query, where, getDocs, addDoc, doc, setDoc, orderBy, onSnapshot } from "firebase/firestore";
import { updateDoc } from "firebase/firestore";

export async function findOrCreateChat(myUid: string, friendUid: string) {
  // Chats are between two participants; order the ids for consistency
  const [a, b] = [myUid, friendUid].sort();
  // Query for a chat with these two participants
  const q = query(collection(db, "chats"), where("participants", "==", [a, b]));
  const chats = await getDocs(q);
  if (!chats.empty) return { chatId: chats.docs[0].id, ...chats.docs[0].data() };
  // Doesn't exist, create new
  const newChat = await addDoc(collection(db, "chats"), {
    participants: [a, b],
    createdAt: Date.now(),
  });
  return { chatId: newChat.id, participants: [a, b] };
}


export async function sendMessage(chatId: string, from: string, text: string) {
  const msg = {
    from,
    text,
    sentAt: Date.now(),
  };
  await addDoc(collection(db, "chats", chatId, "messages"), msg);
  await updateDoc(doc(db, "chats", chatId), {
    lastMessage: msg
  });
}

// For chat list sidebar: get all chats this user participates in, with friend's info and last message
export async function getUserChats(myUid: string) {
  const q = query(collection(db, "chats"), where("participants", "array-contains", myUid));
  const snapshot = await getDocs(q);

  // For each chat, determine the friend & pull their user profile
  const chats: any[] = [];
  for (const chatDoc of snapshot.docs) {
    const data = chatDoc.data();
    const friendUid = data.participants.find((uid: string) => uid !== myUid);
    const friendSnap = await getDoc(doc(db, "users", friendUid));
    const friend = friendSnap.exists() ? { id: friendUid, ...friendSnap.data() } : { id: friendUid, username: "Unknown" };

    // Get the last message in this chat
    let lastMsg = null;
    const lastMsgSnap = await getDocs(query(collection(db, "chats", chatDoc.id, "messages"), orderBy("sentAt", "desc"), limit(1)));
    if (!lastMsgSnap.empty) lastMsg = lastMsgSnap.docs[0].data();

    chats.push({
      chatId: chatDoc.id,
      friend,
      lastMessage: lastMsg
    });
  }

  // Sort by last message time, descending
  return chats.sort((a, b) => (b.lastMessage?.sentAt || 0) - (a.lastMessage?.sentAt || 0));
}


export function subscribeToMessages(chatId: string, callback: (messages: any[]) => void) {
  return onSnapshot(
    query(collection(db, "chats", chatId, "messages"), orderBy("sentAt", "asc")),
    (snapshot) => {
      callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }
  );
}
