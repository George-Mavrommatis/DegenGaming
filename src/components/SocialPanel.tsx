// DegenGamingFrontend/src/components/SocialPanel.tsx
// Ensure this file matches the one I provided exactly.

import React, { useState, useEffect } from 'react';
import FriendsPanel from './FriendsPanel';
import OnlineUsersPanel from './OnlineUsersPanel';
import MessagingPanel from './MessagingPanel';
import { FaUserFriends, FaGlobe, FaComments, FaTimes } from 'react-icons/fa';
import { useProfile } from '../context/ProfileContext'; 
import { toast } from 'react-toastify';

interface FriendForChat {
  uid: string;
  username: string;
  avatarUrl: string;
  isOnline?: boolean;
}

interface SocialPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const SocialPanel: React.FC<SocialPanelProps> = ({ isOpen, onClose }) => {
  const { currentUser } = useProfile();
  const [activeTab, setActiveTab] = useState('friends');
  const [friendToChatWith, setFriendToChatWith] = useState<FriendForChat | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab('friends');
      setFriendToChatWith(null);
    }
  }, [isOpen]);

  const handleStartChatWithFriend = (friend: FriendForChat) => {
    if (!currentUser) {
      toast.error("You must be logged in to chat.");
      return;
    }
    setFriendToChatWith(friend);
    setActiveTab('messaging');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black bg-opacity-75 backdrop-blur-sm">
      <div className="w-full max-w-md bg-gradient-to-b from-gray-900 to-slate-900 text-white shadow-2xl flex flex-col h-full rounded-l-lg overflow-hidden">
        <div className="flex justify-between items-center p-4 bg-slate-800 border-b border-slate-700">
          <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-600">Social Hub</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-3xl transition-colors duration-200">
            <FaTimes />
          </button>
        </div>

        <div className="flex bg-slate-800 border-b border-slate-700">
          <button
            className={`flex-1 py-3 text-sm md:text-lg font-semibold transition-all duration-200 ${activeTab === 'friends' ? 'bg-purple-700' : 'hover:bg-slate-700'}`}
            onClick={() => setActiveTab('friends')}
          >
            <FaUserFriends className="inline-block mr-2" /> Friends
          </button>
          <button
            className={`flex-1 py-3 text-sm md:text-lg font-semibold transition-all duration-200 ${activeTab === 'online' ? 'bg-purple-700' : 'hover:bg-slate-700'}`}
            onClick={() => setActiveTab('online')}
          >
            <FaGlobe className="inline-block mr-2" /> Online
          </button>
          <button
            className={`flex-1 py-3 text-sm md:text-lg font-semibold transition-all duration-200 ${activeTab === 'messaging' ? 'bg-purple-700' : 'hover:bg-slate-700'}`}
            onClick={() => setActiveTab('messaging')}
          >
            <FaComments className="inline-block mr-2" /> Messaging
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {!currentUser ? (
            <div className="text-center text-gray-400 py-10">
              <p>Please log in to access the Social Hub.</p>
            </div>
          ) : (
            <>
              {activeTab === 'friends' && <FriendsPanel onStartChat={handleStartChatWithFriend} />}
              {activeTab === 'online' && <OnlineUsersPanel onStartChat={handleStartChatWithFriend} />}
              {activeTab === 'messaging' && <MessagingPanel friendToChatWith={friendToChatWith} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SocialPanel;