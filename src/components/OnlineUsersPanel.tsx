// src/components/OnlineUsersPanel.tsx

import React, { useEffect, useState, useCallback } from 'react';
import { useProfile } from '../context/ProfileContext';
import { socket } from '../socket'; 
import { ProfileData } from '../types/profile'; 
import { doc, getDoc } from 'firebase/firestore'; 
import { db } from '../firebase/firebaseConfig';
import { toast } from 'react-toastify';

// Define the shape of the user object that can be selected for chat or duel
interface SelectableUser {
  uid: string; 
  username: string;
  avatarUrl?: string;
  wallet?: string; 
}

interface OnlineUsersPanelProps {
  onSelectChat: (user: SelectableUser) => void;
  onSendDuel: (targetUser: ProfileData) => void;
}

// Assuming your REST API URL for online users:
const ONLINE_USERS_API_URL = import.meta.env.PROD
  ? "/onlineUsers"
  : "http://localhost:4000/onlineUsers";

export default function OnlineUsersPanel({ onSelectChat, onSendDuel }: OnlineUsersPanelProps) {
  const { user, loading: profileLoading, isAuthenticated } = useProfile();
  const [onlineUserProfiles, setOnlineUserProfiles] = useState<ProfileData[]>([]);
  const [panelLoading, setPanelLoading] = useState(true);

  // Function to fetch profiles of online users given their UIDs
  const fetchOnlineUserProfiles = useCallback(async (uids: string[]) => {
    if (uids.length === 0) {
      setOnlineUserProfiles([]);
      return;
    }
    
    // Filter out the current user's UID from the list
    const filteredUids = uids.filter(uid => uid !== user?.uid);

    try {
      const profilePromises = filteredUids.map(async (uid) => {
        const userDocRef = doc(db, 'users', uid); 
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          return userDocSnap.data() as ProfileData;
        }
        return null;
      });

      const fetchedProfiles = (await Promise.all(profilePromises)).filter(p => p !== null) as ProfileData[];
      setOnlineUserProfiles(fetchedProfiles);
    } catch (error) {
      console.error("OnlineUsersPanel: Error fetching online user profiles:", error);
      toast.error("Failed to load online user details.");
      setOnlineUserProfiles([]);
    }
  }, [user]); 

  useEffect(() => {
    if (profileLoading) {
      setPanelLoading(true);
      return;
    }

    if (!isAuthenticated || !user) {
      setOnlineUserProfiles([]);
      setPanelLoading(false);
      return;
    }

    // --- Initial fetch via REST API ---
    const fetchInitialOnlineUsers = async () => {
      try {
        const response = await fetch(ONLINE_USERS_API_URL);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        const initialUids: string[] = data.onlineUserIds || [];
        await fetchOnlineUserProfiles(initialUids);
      } catch (error) {
        console.error("OnlineUsersPanel: Failed to fetch initial online users:", error);
        toast.error("Failed to load online users.");
      } finally {
        setPanelLoading(false);
      }
    };
    fetchInitialOnlineUsers();

    // --- Listen for real-time updates via Socket.IO ---
    socket.on('onlineUsers', async (uids: string[]) => {
      console.log("OnlineUsersPanel: Socket.IO received updated online users list:", uids);
      await fetchOnlineUserProfiles(uids); 
    });

    // Cleanup on unmount
    return () => {
      socket.off('onlineUsers');
    };
  }, [isAuthenticated, user, profileLoading, fetchOnlineUserProfiles]);

  if (panelLoading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading online users...
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Sign in to see online users.
      </div>
    );
  }

  // Filter out the current user from the displayed list
  const displayOnlineProfiles = onlineUserProfiles.filter(p => p.uid !== user?.uid);

  return (
    <div className="h-full bg-gray-900 overflow-y-auto">
      <div className="font-bold p-3 text-purple-400">Online Users ({displayOnlineProfiles.length})</div>
      {displayOnlineProfiles.length === 0 ? (
        <div className="p-4 text-gray-500">No other users online right now.</div>
      ) : (
        displayOnlineProfiles.map(onlineProfile => (
          <div key={onlineProfile.uid} className="flex items-center gap-2 px-3 py-2 hover:bg-purple-950 cursor-pointer">
            <img 
              src={onlineProfile.avatarUrl || "/WegenRaceAssets/G1small.png"} 
              alt={onlineProfile.username} 
              className="w-8 h-8 rounded-full object-cover" 
            />
            <div className="font-bold truncate">{onlineProfile.username}</div>
            <div className="ml-auto flex gap-2">
              <button 
                onClick={() => onSelectChat({ uid: onlineProfile.uid, username: onlineProfile.username, avatarUrl: onlineProfile.avatarUrl, wallet: onlineProfile.wallet })} 
                className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs"
              >Chat</button>
              <button 
                onClick={() => onSendDuel(onlineProfile)} 
                className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded text-xs"
              >Duel</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}