// DegenGamingFrontend/src/components/OnlineUsersPanel.tsx
// Ensure this file matches the one I provided exactly.

import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../services/api';
import { useProfile } from '../context/ProfileContext';
import LoadingSpinner from './LoadingSpinner';
import { FaUserCircle, FaGlobe, FaComments } from 'react-icons/fa';
import { toast } from 'react-toastify';

interface FriendForChat { // Use this consistent interface
  uid: string;
  username: string;
  avatarUrl: string;
  isOnline: boolean; 
}

interface OnlineUsersPanelProps {
  onStartChat: (friend: FriendForChat) => void;
}

const OnlineUsersPanel: React.FC<OnlineUsersPanelProps> = ({ onStartChat }) => {
  const { currentUser, firebaseAuthToken } = useProfile();
  const [onlineUsers, setOnlineUsers] = useState<FriendForChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOnlineUsers = useCallback(async () => {
    if (!currentUser || !firebaseAuthToken) {
        setLoading(false);
        setOnlineUsers([]);
        return;
    }
    setLoading(true);
    setError(null);
    try {
      const friendsData = await apiService.getFriends();
      const onlineFriends = friendsData.filter((friend: FriendForChat) => friend.isOnline);
      setOnlineUsers(onlineFriends);
      console.log("OnlineUsersPanel: Online friends fetched:", onlineFriends.length);
    } catch (err: any) {
      console.error("OnlineUsersPanel: Error fetching online users:", err);
      setError(err.message || "Failed to load online users.");
    } finally {
      setLoading(false);
    }
  }, [currentUser, firebaseAuthToken]);

  useEffect(() => {
    fetchOnlineUsers();
    const interval = setInterval(fetchOnlineUsers, 15 * 1000); 
    return () => clearInterval(interval);
  }, [fetchOnlineUsers]);

  if (loading) {
    return (
      <div className="text-center py-4">
        <LoadingSpinner />
        <p className="mt-2 text-gray-400 text-sm">Loading online friends...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-500 text-center py-4 text-sm">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
        <FaGlobe className="text-green-400" /> Online Friends ({onlineUsers.length})
      </h3>
      {onlineUsers.length === 0 ? (
        <p className="text-gray-400 text-center py-2 text-sm">No friends currently online.</p>
      ) : (
        <ul className="space-y-2">
          {onlineUsers.map((user) => (
            <li key={user.uid} className="flex items-center justify-between bg-slate-700 p-2 rounded-lg shadow-sm">
              <div className="flex items-center gap-3">
                <img
                  src={user.avatarUrl || "/avatars/default.png"}
                  className="w-10 h-10 rounded-full object-cover border-2 border-green-500"
                  alt={user.username}
                  onError={(e) => { e.currentTarget.src = '/avatars/default.png'; }}
                />
                <span className="font-semibold text-sm">{user.username}</span>
                <span className="ml-auto w-3 h-3 bg-green-500 rounded-full" title="Online"></span>
              </div>
              <button
                onClick={() => onStartChat(user)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-md text-sm transition-colors duration-200"
              >
                <FaComments className="inline-block mr-1" /> Message
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default OnlineUsersPanel;