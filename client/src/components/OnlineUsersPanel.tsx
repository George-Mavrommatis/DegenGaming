import React, { useState, useEffect } from 'react';
import { useProfile } from '../context/ProfileContext';
import LoadingSpinner from './LoadingSpinner';
import { FaGlobe, FaComments } from 'react-icons/fa';
import { subscribeToOnlineUsers } from '../firebase/onlineUsers';

interface FriendForChat {
  uid: string;
  username: string;
  avatarUrl: string;
  isOnline: boolean;
}

interface OnlineUsersPanelProps {
  onStartChat: (friend: FriendForChat) => void;
}

const OnlineUsersPanel: React.FC<OnlineUsersPanelProps> = ({ onStartChat }) => {
  const { currentUser } = useProfile();
  const [onlineUsers, setOnlineUsers] = useState<FriendForChat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      setLoading(false);
      setOnlineUsers([]);
      return;
    }
    setLoading(true);

    // Subscribe to all online users (not just friends)
    const unsubscribe = subscribeToOnlineUsers((users) => {
      // Debug log:
      console.log("ONLINE USERS SNAPSHOT:", users);

      // Filter out yourself for display
      const othersOnline = users
        .filter((u: any) => u.uid !== currentUser.uid)
        .map((u: any) => ({
          uid: u.uid,
          username: u.username || u.uid,
          avatarUrl: u.avatarUrl || '/avatars/default.png',
          isOnline: true,
        }));
      setOnlineUsers(othersOnline);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  if (loading) {
    return (
      <div className="text-center py-4">
        <LoadingSpinner />
        <p className="mt-2 text-gray-400 text-sm">Loading online users...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
        <FaGlobe className="text-green-400" /> Online Users ({onlineUsers.length})
      </h3>
      {onlineUsers.length === 0 ? (
        <p className="text-gray-400 text-center py-2 text-sm">No other users currently online.</p>
      ) : (
        <ul className="space-y-2">
          {onlineUsers.map((user) => (
            <li key={user.uid} className="flex items-center justify-between bg-slate-700 p-2 rounded-lg shadow-sm">
              <div className="flex items-center gap-3">
                <img
                  src={user.avatarUrl}
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