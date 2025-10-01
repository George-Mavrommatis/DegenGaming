import React, { useEffect, useState, useCallback } from 'react';
import { apiService } from '../services/api';
import LoadingSpinner from './LoadingSpinner';
import { toast } from 'react-toastify';
import { FaUserPlus, FaEnvelope, FaUserFriends, FaTimes, FaCheck, FaComments } from 'react-icons/fa';
import { useProfile } from '../firebase/userProfile';

interface FriendForChat {
  uid: string;
  username: string;
  avatarUrl: string;
  isOnline?: boolean;
}

interface FriendsPanelProps {
  onStartChat: (friend: FriendForChat) => void;
}

const FriendsPanel: React.FC<FriendsPanelProps> = ({ onStartChat }) => {
  const { user } = useProfile();
  const [friends, setFriends] = useState<FriendForChat[]>([]);
  const [received, setReceived] = useState<FriendForChat[]>([]);
  const [sent, setSent] = useState<FriendForChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [targetUsername, setTargetUsername] = useState('');

  const hydrate = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [fRes, rRes, sRes] = await Promise.all([
        apiService.getFriends(),
        apiService.getReceivedFriendRequests(),
        apiService.getSentFriendRequests()
      ]);
      setFriends(fRes || []);
      setReceived(rRes || []);
      setSent(sRes || []);
    } catch (e) {
      console.error('[FriendsPanel] fetch error:', e);
      toast.error('Failed to load friends data.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    hydrate();
    const id = setInterval(hydrate, 60_000);
    return () => clearInterval(id);
  }, [hydrate]);

  const sendRequest = async () => {
    if (!targetUsername.trim()) {
      toast.info('Enter a username first.');
      return;
    }
    setActionLoading(true);
    try {
      await apiService.sendFriendRequest(targetUsername.trim());
      toast.success('Request sent.');
      setTargetUsername('');
      hydrate();
    } catch (e: any) {
      console.error('[FriendsPanel] send request error:', e);
    } finally {
      setActionLoading(false);
    }
  };

  const accept = async (uid: string) => {
    setActionLoading(true);
    try {
      await apiService.acceptFriendRequest(uid);
      toast.success('Friend request accepted');
      hydrate();
    } catch (e) {
      console.error('[FriendsPanel] accept error:', e);
    } finally {
      setActionLoading(false);
    }
  };

  const reject = async (uid: string) => {
    setActionLoading(true);
    try {
      await apiService.rejectFriendRequest(uid);
      toast.info('Friend request rejected');
      hydrate();
    } catch (e) {
      console.error('[FriendsPanel] reject error:', e);
    } finally {
      setActionLoading(false);
    }
  };

  if (!user) {
    return <div className="text-center py-4 text-sm text-gray-400">Log in to view friends.</div>;
  }

  if (loading) {
    return (
      <div className="text-center py-4">
        <LoadingSpinner />
        <p className="mt-2 text-gray-400 text-sm">Loading friends...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Send Request */}
      <section className="border-b border-slate-700 pb-4">
        <h3 className="text-xl font-bold mb-3 flex items-center gap-2"><FaUserPlus /> Send Request</h3>
        <div className="flex gap-2">
          <input
            value={targetUsername}
            onChange={(e) => setTargetUsername(e.target.value)}
            placeholder="Username"
            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
            disabled={actionLoading}
          />
          <button
            onClick={sendRequest}
            disabled={!targetUsername.trim() || actionLoading}
            className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg font-bold text-white shadow-md disabled:opacity-50 flex items-center gap-2"
          >
            {actionLoading ? <LoadingSpinner size="sm" /> : <FaUserPlus />} Send
          </button>
        </div>
      </section>

      {/* Received */}
      <section className="border-b border-slate-700 pb-4">
        <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
          <FaEnvelope /> Requests Received ({received.length})
        </h3>
        {received.length === 0 ? (
          <p className="text-gray-400 text-center py-2 text-sm">No incoming requests.</p>
        ) : (
          <ul className="space-y-3">
            {received.map(r => (
              <li key={r.uid} className="flex items-center justify-between bg-slate-700 p-3 rounded-lg">
                <div className="flex items-center gap-3">
                  <img
                    src={r.avatarUrl || '/avatars/default.png'}
                    alt={r.username}
                    className="w-10 h-10 rounded-full object-cover border-2 border-purple-500"
                    onError={(e)=>{ e.currentTarget.src='/avatars/default.png'; }}
                  />
                  <span className="font-semibold">{r.username}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={()=>accept(r.uid)}
                    disabled={actionLoading}
                    className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-md text-sm"
                  ><FaCheck /></button>
                  <button
                    onClick={()=>reject(r.uid)}
                    disabled={actionLoading}
                    className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-md text-sm"
                  ><FaTimes /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Sent */}
      <section className="border-b border-slate-700 pb-4">
        <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
          <FaUserPlus /> Requests Sent ({sent.length})
        </h3>
        {sent.length === 0 ? (
          <p className="text-gray-400 text-center py-2 text-sm">No pending sent requests.</p>
        ) : (
          <ul className="space-y-2">
            {sent.map(s => (
              <li key={s.uid} className="flex items-center gap-3 bg-slate-700 p-3 rounded-lg">
                <img
                  src={s.avatarUrl || '/avatars/default.png'}
                  alt={s.username}
                  className="w-10 h-10 rounded-full object-cover border-2 border-purple-500"
                  onError={(e)=>{ e.currentTarget.src='/avatars/default.png'; }}
                />
                <span>{s.username} <span className="text-gray-400">(Pending)</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Friends */}
      <section>
        <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
          <FaUserFriends /> My Friends ({friends.length})
        </h3>
        {friends.length === 0 ? (
          <p className="text-gray-400 text-center py-2 text-sm">No friends yet.</p>
        ) : (
          <ul className="space-y-3">
            {friends.map(f => (
              <li key={f.uid} className="flex items-center justify-between bg-slate-700 p-3 rounded-lg">
                <div className="flex items-center gap-3">
                  <img
                    src={f.avatarUrl || '/avatars/default.png'}
                    alt={f.username}
                    className="w-10 h-10 rounded-full object-cover border-2 border-purple-500"
                    onError={(e)=>{ e.currentTarget.src='/avatars/default.png'; }}
                  />
                  <span>{f.username}</span>
                  {f.isOnline !== undefined && (
                    <span
                      className={`w-3 h-3 rounded-full ${f.isOnline ? 'bg-green-500':'bg-gray-500'}`}
                      title={f.isOnline ? 'Online':'Offline'}
                    />
                  )}
                </div>
                <button
                  onClick={()=>onStartChat(f)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-md text-sm"
                >
                  <FaComments className="inline-block mr-1" /> Message
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default FriendsPanel;