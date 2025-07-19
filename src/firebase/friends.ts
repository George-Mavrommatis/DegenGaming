import { db } from './firebaseConfig';
import { doc, getDoc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';

export async function sendFriendRequest(fromUid: string, toUid: string) {
  if (fromUid === toUid) throw new Error('Cannot friend yourself');
  const toRef = doc(db, 'users', toUid);
  const fromRef = doc(db, 'users', fromUid);
  const toSnap = await getDoc(toRef);
  if (toSnap.exists()) {
    const data = toSnap.data();
    const incoming: string[] = data.friendRequests || [];
    const friends: string[] = data.friends || [];
    const alreadyRequested = incoming.includes(fromUid);
    const alreadyFriends = friends.includes(fromUid);
    if (!alreadyRequested && !alreadyFriends) {
      // Add to recipient's friendRequests
      await updateDoc(toRef, {
        friendRequests: arrayUnion(fromUid)
      });
      // Add to sender's sentInvitations
      await updateDoc(fromRef, {
        sentInvitations: arrayUnion(toUid)
      });
    }
  }
}

export async function acceptFriendRequest(myUid: string, fromUid: string) {
  const me = doc(db, 'users', myUid);
  const them = doc(db, 'users', fromUid);

  // Remove request and add as friend for both
  await updateDoc(me, {
    friendRequests: arrayRemove(fromUid),
    friends: arrayUnion(fromUid)
  });
  await updateDoc(them, {
    friends: arrayUnion(myUid),
    sentInvitations: arrayRemove(myUid)
  });
}

export async function declineFriendRequest(myUid: string, fromUid: string) {
  const me = doc(db, 'users', myUid);
  const them = doc(db, 'users', fromUid);
  await updateDoc(me, {
    friendRequests: arrayRemove(fromUid)
  });
  await updateDoc(them, {
    sentInvitations: arrayRemove(myUid)
  });
}

// Cancel an outgoing invitation
export async function cancelSentInvitation(myUid: string, toUid: string) {
  const me = doc(db, 'users', myUid);
  const them = doc(db, 'users', toUid);
  await updateDoc(me, {
    sentInvitations: arrayRemove(toUid)
  });
  await updateDoc(them, {
    friendRequests: arrayRemove(myUid)
  });
}

export async function removeFriend(myUid: string, friendUid: string) {
  const me = doc(db, 'users', myUid);
  const them = doc(db, 'users', friendUid);
  await updateDoc(me, {
    friends: arrayRemove(friendUid)
  });
  await updateDoc(them, {
    friends: arrayRemove(myUid)
  });
}
