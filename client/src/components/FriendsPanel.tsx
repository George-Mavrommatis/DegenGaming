// DegenGamingFrontend/src/components/FriendsPanel.tsx
// Ensure this file matches the one I provided exactly.

import React, { useState, useEffect, useCallback } from 'react';
import { useProfile } from '../context/ProfileContext';
import { apiService } from '../services/api';
import { toast } from 'react-toastify';
import LoadingSpinner from './LoadingSpinner';
import { FaUserPlus, FaEnvelope, FaUserFriends, FaTimes, FaCheck, FaComments } from 'react-icons/fa';

interface FriendForChat { // Use this consistent interface
  uid: string;
  username: string;
  avatarUrl: string;
  isOnline?: boolean;
}

interface FriendsPanelProps {
  onStartChat: (friend: FriendForChat) => void;
}

const FriendsPanel: React.FC<FriendsPanelProps> = ({ onStartChat }) => {
  const { currentUser, firebaseAuthToken } = useProfile();
  const [friends, setFriends] = useState<FriendForChat[]>([]);
  const [receivedRequests, setReceivedRequests] = useState<FriendForChat[]>([]);
  const [sentRequests, setSentRequests] = useState<FriendForChat[]>([]); // Added for sent requests
  const [loading, setLoading] = useState(true);
  const [socialActionLoading, setSocialActionLoading] = useState(false);
  const [targetUsername, setTargetUsername] = useState('');

  const fetchFriendData = useCallback(async () => {
    if (!currentUser || !firebaseAuthToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [friendsData, receivedReqData, sentReqData] = await Promise.all([
        apiService.getFriends(),
        apiService.getReceivedFriendRequests(),
        apiService.getSentFriendRequests(), // Fetch sent requests
      ]);
      setFriends(friendsData);
      setReceivedRequests(receivedReqData);
      setSentRequests(sentReqData);
      console.log("FriendsPanel: Friend data fetched.");
    } catch (error) {
      console.error("FriendsPanel: Failed to fetch friend data:", error);
    } finally {
      setLoading(false);
    }
  }, [currentUser, firebaseAuthToken]);

  useEffect(() => {
    fetchFriendData();
    const interval = setInterval(fetchFriendData, 60 * 1000); 
    return () => clearInterval(interval);
  }, [fetchFriendData]);

  const handleSendFriendRequest = async () => {
    if (!targetUsername.trim()) {
      toast.info("Please enter a username to send a request.");
      return;
    }
    setSocialActionLoading(true);
    try {
      await apiService.sendFriendRequest(targetUsername);
      toast.success(`Friend request sent to ${targetUsername}!`);
      setTargetUsername('');
      await fetchFriendData();
    } catch (error: any) {
      console.error("FriendsPanel: Error sending friend request:", error);
    } finally {
      setSocialActionLoading(false);
    }
  };

  const handleAcceptFriendRequest = async (senderId: string) => {
    setSocialActionLoading(true);
    try {
      await apiService.acceptFriendRequest(senderId);
      toast.success("Friend request accepted!");
      await fetchFriendData();
    } catch (error: any) {
      console.error("FriendsPanel: Error accepting friend request:", error);
    } finally {
      setSocialActionLoading(false);
    }
  };

  const handleRejectFriendRequest = async (senderId: string) => {
    setSocialActionLoading(true);
    try {
      await apiService.rejectFriendRequest(senderId);
      toast.info("Friend request rejected.");
      await fetchFriendData();
    } catch (error: any) {
      console.error("FriendsPanel: Error rejecting friend request:", error);
    } finally {
      setSocialActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-4">
        <LoadingSpinner />
        <p className="mt-2 text-gray-400 text-sm">Loading friends data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-700 pb-4">
        <h3 className="text-xl font-bold mb-3 flex items-center gap-2"><FaUserPlus /> Send Request</h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Enter username"
            value={targetUsername}
            onChange={(e) => setTargetUsername(e.target.value)}
            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
            disabled={socialActionLoading}
          />
          <button
            onClick={handleSendFriendRequest}
            className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg font-bold text-white shadow-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={socialActionLoading || !targetUsername.trim()}
          >
            {socialActionLoading ? <LoadingSpinner size="sm" /> : <FaUserPlus />} Send
          </button>
        </div>
      </div>

      <div className="border-b border-slate-700 pb-4">
        <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
          <FaEnvelope /> Requests Received ({receivedRequests.length})
        </h3>
        {receivedRequests.length === 0 ? (
          <p className="text-gray-400 text-center py-2 text-sm">No new requests.</p>
        ) : (
          <ul className="space-y-3">
            {receivedRequests.map((request) => (
              <li key={request.uid} className="flex items-center justify-between bg-slate-700 p-3 rounded-lg shadow-sm">
                <div className="flex items-center gap-3">
                  <img
                    src={request.avatarUrl || "/avatars/default.png"}
                    className="w-10 h-10 rounded-full object-cover border-2 border-purple-500"
                    alt={request.username}
                    onError={(e) => { e.currentTarget.src = '/avatars/default.png'; }}
                  />
                  <span className="font-semibold">{request.username}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAcceptFriendRequest(request.uid)}
                    className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-md text-sm transition-colors duration-200"
                    disabled={socialActionLoading}
                  >
                    <FaCheck className="inline-block mr-1" /> Accept
                  </button>
                  <button
                    onClick={() => handleRejectFriendRequest(request.uid)}
                    className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-md text-sm transition-colors duration-200"
                    disabled={socialActionLoading}
                  >
                    <FaTimes className="inline-block mr-1" /> Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-b border-slate-700 pb-4">
        <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
          <FaUserPlus /> Requests Sent ({sentRequests.length})
        </h3>
        {sentRequests.length === 0 ? (
          <p className="text-gray-400 text-center py-2 text-sm">No pending outgoing requests.</p>
        ) : (
          <ul className="space-y-3">
            {sentRequests.map((request) => (
              <li key={request.uid} className="flex items-center gap-3 bg-slate-700 p-3 rounded-lg shadow-sm">
                <img
                  src={request.avatarUrl || "/avatars/default.png"}
                  className="w-10 h-10 rounded-full object-cover border-2 border-purple-500"
                  alt={request.username}
                  onError={(e) => { e.currentTarget.src = '/avatars/default.png'; }}
                />
                <span>{request.username} <span className="text-gray-400">(Pending)</span></span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
          <FaUserFriends /> My Friends ({friends.length})
        </h3>
        {friends.length === 0 ? (
          <p className="text-gray-400 text-center py-2 text-sm">You have no friends yet. Send a request!</p>
        ) : (
          <ul className="space-y-3">
            {friends.map((friend) => (
              <li key={friend.uid} className="flex items-center justify-between bg-slate-700 p-3 rounded-lg shadow-sm">
                <div className="flex items-center gap-3">
                  <img
                    src={friend.avatarUrl || "/avatars/default.png"}
                    className="w-10 h-10 rounded-full object-cover border-2 border-purple-500"
                    alt={friend.username}
                    onError={(e) => { e.currentTarget.src = '/avatars/default.png'; }}
                  />
                  <span>{friend.username}</span>
                  {friend.isOnline !== undefined && (
                    <span
                      className={`w-3 h-3 rounded-full ${
                        friend.isOnline ? 'bg-green-500' : 'bg-gray-500'
                      }`}
                      title={friend.isOnline ? 'Online' : 'Offline'}
                    ></span>
                  )}
                </div>
                <button
                  onClick={() => onStartChat(friend)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-md text-sm transition-colors duration-200"
                >
                  <FaComments className="inline-block mr-1" /> Message
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default FriendsPanel;