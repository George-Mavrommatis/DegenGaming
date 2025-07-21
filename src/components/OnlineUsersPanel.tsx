// src/components/OnlineUsersPanel.tsx (REVISED)

import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../services/api';
import { useProfile } from '../context/ProfileContext';
import LoadingSpinner from './LoadingSpinner';
import { FaUserCircle, FaGlobe, FaComments } from 'react-icons/fa';
import { toast } from 'react-toastify';

interface OnlineUser {
  uid: string;
  username: string;
  avatarUrl: string;
  isOnline: boolean;
}

interface OnlineUsersPanelProps {
  onStartChat: (friend: OnlineUser) => void; // Reusing the same interface
}

const OnlineUsersPanel: React.FC<OnlineUsersPanelProps> = ({ onStartChat }) => {
  const { currentUser, firebaseAuthToken } = useProfile();
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
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
      const onlineFriends = friendsData.filter((friend: OnlineUser) => friend.isOnline);
      setOnlineUsers(onlineFriends);
      console.log("OnlineUsersPanel: Online friends fetched:", onlineFriends);
    } catch (err: any) {
      console.error("OnlineUsersPanel: Error fetching online users:", err);
      setError(err.message || "Failed to load online users.");
      // toast.error is handled by interceptor
    } finally {
      setLoading(false);
    }
  }, [currentUser, firebaseAuthToken]);

  useEffect(() => {
    fetchOnlineUsers();
    // Refresh online status more frequently for this panel
    const interval = setInterval(fetchOnlineUsers, 15 * 1000); // Every 15 seconds
    return () => clearInterval(interval);
  }, [fetchOnlineUsers]);

  if (!currentUser) {
    return (
      <div className="text-gray-400 text-center py-4">
        Log in to see online friends.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-4">
        <LoadingSpinner />
        <p className="mt-2">Loading online friends...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-500 text-center py-4">
        Error: {error}
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
        <FaGlobe className="text-green-400" /> Online Friends ({onlineUsers.length})
      </h3>
      {onlineUsers.length === 0 ? (
        <p className="text-gray-400 text-center py-2">No friends currently online.</p>
      ) : (
        <ul className="space-y-2">
          {onlineUsers.map((user) => (
            <li key={user.uid} className="flex items-center justify-between bg-slate-700 p-2 rounded-md">
              <div className="flex items-center gap-3">
                <img
                  src={user.avatarUrl || "/avatars/default.png"}
                  className="w-8 h-8 rounded-full object-cover"
                  alt={user.username}
                  onError={(e) => { e.currentTarget.src = '/avatars/default.png'; }}
                />
                <span className="font-semibold text-sm">{user.username}</span>
                <span className="w-3 h-3 bg-green-500 rounded-full" title="Online"></span>
              </div>
              <button
                onClick={() => onStartChat(user)} // Use the prop to initiate chat
                className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-md text-sm flex items-center gap-1"
              >
                <FaComments /> Message
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default OnlineUsersPanel;