// src/components/OnlineUsersPanel.tsx

import React, { useEffect, useState } from "react";
import { db } from "../firebase/firebaseConfig";
import { collection, onSnapshot, query, where } from "firebase/firestore";
// import { useFirebaseUser } from "../firebase/useFirebaseUser"; // <-- REMOVE THIS LINE
import { useProfile } from "../context/ProfileContext"; // <-- ADD THIS LINE
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
  // Destructure 'currentUser' from useProfile, aliasing it to 'user' for consistency
  const { currentUser: user, loadingAuth } = useProfile(); // Added loadingAuth for safety

  const [onlineUsers, setOnlineUsers] = useState<ProfileData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Only subscribe if authentication state is determined and user object is available (or null if not logged in)
    if (!loadingAuth) {
      console.log("OnlineUsersPanel: Subscribing to online users.");
      const q = query(
        collection(db, "users"),
        where("isOnline", "==", true)
      );

      const unsub = onSnapshot(q, (snap) => {
        const users: ProfileData[] = snap.docs
          .map(doc => ({ ...(doc.data() as ProfileData), uid: doc.id, id: doc.id }))
          .filter(u => u.uid !== user?.uid); // Filter out the current user
        
        setOnlineUsers(users);
        setLoading(false);
        console.log("OnlineUsersPanel: Fetched online users:", users);
      }, (error) => {
        console.error("OnlineUsersPanel: Error fetching online users:", error);
        toast.error("Failed to load online users.");
        setLoading(false);
      });

      // Cleanup function to unsubscribe when component unmounts or dependencies change
      return () => {
        console.log("OnlineUsersPanel: Unsubscribing from online users.");
        unsub();
      };
    } else {
      // If still loading auth, set loading to true and clear users
      setLoading(true);
      setOnlineUsers([]);
    }
  }, [user?.uid, loadingAuth]); // Add loadingAuth to dependencies

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
              // Use u.uid as key, as it's guaranteed to be unique and consistent
              <li key={u.uid} className="flex items-center bg-gray-800 p-3 rounded-lg">
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