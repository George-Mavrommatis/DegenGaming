import { db } from "../firebase/firebaseConfig";
import { collection, doc, setDoc } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";

export async function createPvPRoom(userA: string, userB: string, agreedTime: string) {
  const roomId = uuidv4();
  const password = Math.random().toString(36).slice(-8);
  await setDoc(doc(db, "roPvPRooms", roomId), {
    users: [userA, userB],
    agreedTime,
    password,
    createdAt: Date.now(),
    status: "open",
  });
  // Add room invitation to both users' profiles if needed
  return { roomId, password };
}
