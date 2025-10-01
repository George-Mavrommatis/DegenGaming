/**
 * OnlineUsersPanel
 * Uses backend presence (optionally with socket.io if provided via window.__socket)
 */
import React, { useEffect, useState } from 'react';
import LoadingSpinner from './LoadingSpinner';
import { FaGlobe, FaComments } from 'react-icons/fa';
import { useProfile } from '../firebase/userProfile';
import { subscribeToOnlineUsers } from '../firebase/onlineUsers';
import { apiService } from '../services/api';

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
  const { user } = useProfile();
  const [onlineUsers, setOnlineUsers] = useState<FriendForChat[]>([]);
  const [loading, setLoading] = useState(true);

  // Resolve minimal profile data for each uid (could optimize with endpoint returning full objects)
  const hydrateProfiles = async (uids: string[]) => {
    try {
      // Optionally: backend endpoint returning all in one call; for now fetch sequentially
      const promises = uids.slice(0,50).map(async uid => {
        try {
          const profile = await apiService.getUserByUid(uid);
          return {
            uid,
            username: profile.username || uid,
            avatarUrl: profile.avatarUrl || '/avatars/default.png',
            isOnline: profile.isOnline || false
          } as FriendForChat;
        } catch {
          return {
            uid,
            username: uid,
            avatarUrl: '/avatars/default.png',
            isOnline: true
          };
        }
      });
      const resolved = await Promise.all(promises);
      setOnlineUsers(resolved.filter(Boolean));
    } catch (e) {
      console.error('[OnlineUsersPanel] hydrate error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) {
      setOnlineUsers([]);
      setLoading(false);
      return;
    }
    // Attempt to detect global socket (e.g. assigned in your root)
    // @ts-ignore
    const socket = (window && window.__socket) || undefined;
    const unsub = subscribeToOnlineUsers(async (uidList) => {
      await hydrateProfiles(uidList.filter(id => id !== user.uid));
    }, { socket });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!user) {
    return <div className="text-center py-4 text-sm text-gray-400">Log in to view online users.</div>;
  }

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
        <p className="text-gray-400 text-center py-2 text-sm">No other users online.</p>
      ) : (
        <ul className="space-y-2">
          {onlineUsers.map(u => (
            <li key={u.uid} className="flex items-center justify-between bg-slate-700 p-2 rounded-lg shadow-sm">
              <div className="flex items-center gap-3">
                <img
                  src={u.avatarUrl}
                  alt={u.username}
                  className="w-10 h-10 rounded-full object-cover border-2 border-green-500"
                  onError={(e)=>{ e.currentTarget.src='/avatars/default.png'; }}
                />
                <span className="font-semibold text-sm">{u.username}</span>
                <span className="ml-auto w-3 h-3 bg-green-500 rounded-full" title="Online"></span>
              </div>
              <button
                onClick={()=>onStartChat(u)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-md text-sm"
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