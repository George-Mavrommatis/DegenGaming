import React, { useState, useEffect, useRef } from 'react';
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

const PANEL_WIDTH = 420;
const PANEL_HEIGHT = 500;

const SocialPanel: React.FC<SocialPanelProps> = ({ isOpen, onClose }) => {
  const { currentUser } = useProfile();
  const [activeTab, setActiveTab] = useState('friends');
  const [friendToChatWith, setFriendToChatWith] = useState<FriendForChat | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab('friends');
      setFriendToChatWith(null);
    }
  }, [isOpen]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, onClose]);

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
    <div
      ref={panelRef}
      className="fixed z-50 bg-gradient-to-b from-gray-900 to-slate-900 text-white shadow-2xl flex flex-col rounded-2xl overflow-hidden font-[WegensFont] border border-yellow-500"
      style={{
        width: PANEL_WIDTH,
        height: PANEL_HEIGHT,
        bottom: 40,
        right: 40,
        maxWidth: '90vw',
        maxHeight: '70vh',
        minWidth: 320,
      }}
    >
      <div className="flex justify-between items-center p-4 bg-slate-800 border-b border-slate-700">
        <h2 className="text-2xl font-extrabold text-yellow-400 font-[WegensFont] tracking-wider">SOCIAL HUB</h2>
        <button onClick={onClose} className="text-yellow-400 hover:text-white text-3xl transition-colors duration-200">
          <FaTimes />
        </button>
      </div>
      <div className="flex bg-slate-800 border-b border-slate-700">
        <button
          className={`flex-1 py-3 text-sm md:text-lg font-bold transition-all duration-200 ${activeTab === 'friends' ? 'bg-yellow-400 text-black' : 'hover:bg-slate-700 text-yellow-300'}`}
          onClick={() => setActiveTab('friends')}
        >
          <FaUserFriends className="inline-block mr-2" /> FRIENDS
        </button>
        <button
          className={`flex-1 py-3 text-sm md:text-lg font-bold transition-all duration-200 ${activeTab === 'online' ? 'bg-yellow-400 text-black' : 'hover:bg-slate-700 text-yellow-300'}`}
          onClick={() => setActiveTab('online')}
        >
          <FaGlobe className="inline-block mr-2" /> ONLINE
        </button>
        <button
          className={`flex-1 py-3 text-sm md:text-lg font-bold transition-all duration-200 ${activeTab === 'messaging' ? 'bg-yellow-400 text-black' : 'hover:bg-slate-700 text-yellow-300'}`}
          onClick={() => setActiveTab('messaging')}
        >
          <FaComments className="inline-block mr-2" /> MESSAGING
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {!currentUser ? (
          <div className="text-center text-yellow-300 py-10 font-[WegensFont] text-lg">
            PLEASE LOG IN TO ACCESS THE SOCIAL HUB.
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
  );
};

export default SocialPanel;