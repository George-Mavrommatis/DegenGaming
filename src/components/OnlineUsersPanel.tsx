import React, { useEffect, useState } from "react";
import { db } from "../firebase/firebaseConfig";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useFirebaseUser } from "../firebase/useFirebaseUser";
import type { ProfileData } from "../types/profile";
import { FaEnvelope, FaCrosshairs } from "react-icons/fa";
import { toast } from "react-toastify";

interface OnlineUsersPanelProps {
  onSelectChat: (user: ProfileData) => void;
  onSendDuel?: (user: ProfileData) => void;
}

export default function OnlineUsersPanel({
  onSelectChat,
  onSendDuel,
}: OnlineUsersPanelProps) {
  const { user } = useFirebaseUser();
  const [onlineUsers, setOnlineUsers] = useState<ProfileData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "users"), where("isOnline", "==", true));
    const unsub = onSnapshot(q, (snap) => {
      const users: ProfileData[] = snap.docs
        .map(doc => ({ ...(doc.data() as ProfileData), uid: doc.id, id: doc.id }))
        .filter(u => u.uid !== user?.uid);
      setOnlineUsers(users);
      setLoading(false);
      console.log("SNAPSHOT USERS ONLINE:", users);
    });
    return () => unsub();
  }, [user?.uid]);

  const handleSendMessage = (target: ProfileData) => {
    if (!target.dmsOpen) {
      toast.error(`${target.username || target.wallet} has closed direct messages.`);
      return;
    }
    if (onSelectChat) {
      onSelectChat(target);
    } else {
      toast.success(`DM window to ${target.username || target.wallet} would open here!`);
    }
  };

  const handleSendDuel = (target: ProfileData) => {
    if (!target.duelsOpen) {
      toast.error(`${target.username || target.wallet} is not accepting duel invitations.`);
      return;
    }
    if (onSendDuel) {
      onSendDuel(target);
    } else {
      toast.success(`Duel invite sent to ${target.username || target.wallet}!`);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-900 rounded-xl shadow-lg p-3 relative min-h-[220px] max-h-[340px]">
      <div className="overflow-y-auto flex-1 pr-1">
        {loading ? (
          <div className="text-gray-400 mt-12 mb-4 text-center">Loading online users…</div>
        ) : onlineUsers.length === 0 ? (
          <div className="text-gray-400 mt-10 mb-8 text-center">No users online.</div>
        ) : (
          <ul className="flex flex-col gap-3">
            {onlineUsers.map(u => (
              <li key={u.id || u.wallet} className="flex items-center bg-gray-800 p-3 rounded-lg">
                <img src={u.avatarUrl || "/placeholder-avatar.png"} alt="avatar" className="w-9 h-9 rounded-full border-2 border-purple-400 object-cover mr-3" />
                <div className="mr-auto min-w-0">
                  <div className="font-bold text-[#FFA600] truncate">{u.username || (u.wallet ? u.wallet.slice(0, 7) + "..." : "Unknown")}</div>
                  <div className="text-xs text-gray-400 truncate max-w-[120px]">{u.wallet}</div>
                </div>
                <button
                  className={`ml-3 mr-2 text-white p-2 rounded-full hover:bg-purple-600 transition ${!u.dmsOpen && "opacity-50 pointer-events-none"}`}
                  title={u.dmsOpen ? "Send Message" : "DMs Closed"}
                  onClick={() => handleSendMessage(u)}
                  disabled={!u.dmsOpen}
                >
                  <FaEnvelope />
                </button>
                <button
                  className={`text-white p-2 rounded-full hover:bg-pink-600 transition ${!u.duelsOpen && "opacity-50 pointer-events-none"}`}
                  title={u.duelsOpen ? "Send Duel Invite" : "Not Accepting Duels"}
                  onClick={() => handleSendDuel(u)}
                  disabled={!u.duelsOpen}
                >
                  <FaCrosshairs />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
