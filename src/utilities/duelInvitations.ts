import { db } from "../firebase/firebaseConfig";
import { doc, updateDoc, arrayUnion, arrayRemove } from "firebase/firestore";
import { ensureUserHasArrays } from "../firebase/userProfile";
import { v4 as uuidv4 } from "uuid";

// Send a duel invitation
export async function sendDuelInvite(sender: any, recipient: any) {
  if (!sender || !recipient) return;
  const senderId = sender.uid || sender.id;
  const recipientId = recipient.uid || recipient.id;
  await ensureUserHasArrays(senderId);
  await ensureUserHasArrays(recipientId);

  const invitation = {
    invitationId: uuidv4(),
    from: senderId,
    to: recipientId,
    status: "pending", // pending | proposed | agreed | declined | cancelled
    suggestedTime: null,
    agreedTime: null,
    createdAt: Date.now(),
    lastActionBy: senderId,
  };
  await updateDoc(doc(db, "users", recipientId), {
    duelInvitations: arrayUnion(invitation),
  });
}

// Propose a time for an existing duel invitation
export async function proposeDuelTime(recipientId: string, invitationId: string, time: string, actorId: string) {
  // You must fetch, patch, and re-write duelInvitations array (Firestore can't update array element by id)
  const userRef = doc(db, "users", recipientId);
  const userSnap = await userRef.get();
  if (!userSnap.exists()) return;

  const data = userSnap.data();
  const duelInvitations = data.duelInvitations || [];
  const idx = duelInvitations.findIndex((inv: any) => inv.invitationId === invitationId);
  if (idx === -1) return;

  duelInvitations[idx].suggestedTime = time;
  duelInvitations[idx].status = "proposed";
  duelInvitations[idx].lastActionBy = actorId;

  await updateDoc(userRef, { duelInvitations });
}

// Accept the proposed time
export async function agreeDuelTime(recipientId: string, invitationId: string, actorId: string) {
  const userRef = doc(db, "users", recipientId);
  const userSnap = await userRef.get();
  if (!userSnap.exists()) return;

  const data = userSnap.data();
  const duelInvitations = data.duelInvitations || [];
  const idx = duelInvitations.findIndex((inv: any) => inv.invitationId === invitationId);
  if (idx === -1) return;

  duelInvitations[idx].agreedTime = duelInvitations[idx].suggestedTime;
  duelInvitations[idx].status = "agreed";
  duelInvitations[idx].lastActionBy = actorId;

  await updateDoc(userRef, { duelInvitations });
}

// Cancel duel invitation
export async function cancelDuelInvitation(recipientId: string, invitationId: string) {
  const userRef = doc(db, "users", recipientId);
  const userSnap = await userRef.get();
  if (!userSnap.exists()) return;

  const data = userSnap.data();
  const duelInvitations = (data.duelInvitations || []).filter((inv: any) => inv.invitationId !== invitationId);
  await updateDoc(userRef, { duelInvitations });
}
