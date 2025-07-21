// src/components/FriendsPanel.tsx (REVISED)

import React, { useState, useEffect, useCallback } from 'react';
import { useProfile } from '../context/ProfileContext';
import { apiService } from '../services/api';
import { toast } from 'react-toastify';
import LoadingSpinner from './LoadingSpinner';
import { FaUserPlus, FaEnvelope, FaUserFriends, FaTimes, FaCheck, FaComments } from 'react-icons/fa';

// Interface for friend data that MessagingPanel can use to open a chat
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
  const { currentUser, firebaseAuthToken } = useProfile();
  const [friends, setFriends] = useState<FriendForChat[]>([]);
  const [receivedRequests, setReceivedRequests] = useState<FriendForChat[]>([]);
  const [sentRequests, setSentRequests] = useState<FriendForChat[]>([]); // New state for sent requests
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
      setSentRequests(sentReqData); // Set sent requests
      console.log("FriendsPanel: Friend data fetched:", { friendsData, receivedReqData, sentReqData });
    } catch (error) {
      console.error("FriendsPanel: Failed to fetch friend data:", error);
      toast.error("Failed to load friend data.");
    } finally {
      setLoading(false);
    }
  }, [currentUser, firebaseAuthToken]);

  useEffect(() => {
    fetchFriendData();
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
      await fetchFriendData(); // Re-fetch data to update sent requests list
    } catch (error: any) {
      console.error("FriendsPanel: Error sending friend request:", error);
      toast.error(error.response?.data?.message || "Failed to send friend request.");
    } finally {
      setSocialActionLoading(false);
    }
  };

  const handleAcceptFriendRequest = async (senderId: string) => {
    setSocialActionLoading(true);
    try {
      await apiService.acceptFriendRequest(senderId);
      toast.success("Friend request accepted!");
      await fetchFriendData(); // Re-fetch data to update friends and requests
    } catch (error: any) {
      console.error("FriendsPanel: Error accepting friend request:", error);
      toast.error(error.response?.data?.message || "Failed to accept friend request.");
    } finally {
      setSocialActionLoading(false);
    }
  };

  const handleRejectFriendRequest = async (senderId: string) => {
    setSocialActionLoading(true);
    try {
      await apiService.rejectFriendRequest(senderId);
      toast.info("Friend request rejected.");
      await fetchFriendData(); // Re-fetch data to update requests
    } catch (error: any) {
      console.error("FriendsPanel: Error rejecting friend request:", error);
      toast.error(error.response?.data?.message || "Failed to reject friend request.");
    } finally {
      setSocialActionLoading(false);
    }
  };

  if (!currentUser) {
    return (
      <div className="text-gray-400 text-center py-4">
        Please log in to manage your friends.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-4">
        <LoadingSpinner />
        <p className="mt-2">Loading friends data...</p>
      </div>
    );
  }

  return (
    <div>
      {/* Send Friend Request */}
      <div className="mb-6 border-b border-slate-700 pb-4">
        <h3 className="text-xl font-bold mb-3 flex items-center gap-2"><FaUserPlus /> Send Friend Request</h3>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Enter username"
            value={targetUsername}
            onChange={(e) => setTargetUsername(e.target.value)}
            className="flex-1 bg-slate-700 border border-slate-600 rounded-l-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
            disabled={socialActionLoading}
          />
          <button
            onClick={handleSendFriendRequest}
            className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-r-md font-bold text-white flex items-center gap-2"
            disabled={socialActionLoading || !targetUsername.trim()}
          >
            {socialActionLoading ? <LoadingSpinner size="sm" /> : <FaUserPlus />} Send
          </button>
        </div>
      </div>

      {/* Friend Requests Received */}
      <div className="mb-6 border-b border-slate-700 pb-4">
        <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
          <FaEnvelope /> Friend Requests Received ({receivedRequests.length})
        </h3>
        {receivedRequests.length === 0 ? (
          <p className="text-gray-400 text-center py-2">No new friend requests.</p>
        ) : (
          <ul className="space-y-3">
            {receivedRequests.map((request) => (
              <li key={request.uid} className="flex items-center justify-between bg-slate-700 p-3 rounded-md">
                <div className="flex items-center gap-3">
                  <img
                    src={request.avatarUrl || "/avatars/default.png"}
                    className="w-10 h-10 rounded-full object-cover"
                    alt={request.username}
                    onError={(e) => { e.currentTarget.src = '/avatars/default.png'; }}
                  />
                  <span className="font-semibold">{request.username}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAcceptFriendRequest(request.uid)}
                    className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded-md text-sm flex items-center gap-1"
                    disabled={socialActionLoading}
                  >
                    <FaCheck /> Accept
                  </button>
                  <button
                    onClick={() => handleRejectFriendRequest(request.uid)}
                    className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md text-sm flex items-center gap-1"
                    disabled={socialActionLoading}
                  >
                    <FaTimes /> Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Friend Requests Sent */}
      <div className="mb-6 border-b border-slate-700 pb-4">
        <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
          <FaUserPlus /> Friend Requests Sent ({sentRequests.length})
        </h3>
        {sentRequests.length === 0 ? (
          <p className="text-gray-400 text-center py-2">No pending outgoing requests.</p>
        ) : (
          <ul className="space-y-3">
            {sentRequests.map((request) => (
              <li key={request.uid} className="flex items-center gap-3 bg-slate-700 p-3 rounded-md">
                <img
                  src={request.avatarUrl || "/avatars/default.png"}
                  className="w-10 h-10 rounded-full object-cover"
                  alt={request.username}
                  onError={(e) => { e.currentTarget.src = '/avatars/default.png'; }}
                />
                <span>{request.username} (Pending)</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* My Friends List */}
      <div>
        <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
          <FaUserFriends /> My Friends ({friends.length})
        </h3>
        {friends.length === 0 ? (
          <p className="text-gray-400 text-center py-2">You have no friends yet. Send a request!</p>
        ) : (
          <ul className="space-y-3">
            {friends.map((friend) => (
              <li key={friend.uid} className="flex items-center justify-between bg-slate-700 p-3 rounded-md">
                <div className="flex items-center gap-3">
                  <img
                    src={friend.avatarUrl || "/avatars/default.png"}
                    className="w-10 h-10 rounded-full object-cover"
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
                  onClick={() => onStartChat(friend)} // Use the prop to initiate chat
                  className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-md text-sm flex items-center gap-1"
                >
                  <FaComments /> Message
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