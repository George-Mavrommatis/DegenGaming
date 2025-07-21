// src/components/SocialPanel.tsx (REVISED - Container Component)

import React, { useState } from 'react';
import FriendsPanel from './FriendsPanel'; // Your existing FriendsPanel
import OnlineUsersPanel from './OnlineUsersPanel'; // Your existing OnlineUsersPanel
import MessagingPanel from './MessagingPanel'; // Your existing MessagingPanel
import { FaUserFriends, FaGlobe, FaComments } from 'react-icons/fa';

const SocialPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState('friends'); // 'friends', 'online', 'messaging'

  return (
    <div className="bg-slate-800 text-white rounded-lg shadow-xl overflow-hidden h-full flex flex-col">
      {/* Tab Navigation */}
      <div className="flex bg-slate-700 border-b border-slate-600">
        <button
          className={`flex-1 py-3 text-lg font-semibold ${activeTab === 'friends' ? 'bg-purple-600' : 'hover:bg-slate-600'}`}
          onClick={() => setActiveTab('friends')}
        >
          <FaUserFriends className="inline-block mr-2" /> Friends
        </button>
        <button
          className={`flex-1 py-3 text-lg font-semibold ${activeTab === 'online' ? 'bg-purple-600' : 'hover:bg-slate-600'}`}
          onClick={() => setActiveTab('online')}
        >
          <FaGlobe className="inline-block mr-2" /> Online Users
        </button>
        <button
          className={`flex-1 py-3 text-lg font-semibold ${activeTab === 'messaging' ? 'bg-purple-600' : 'hover:bg-slate-600'}`}
          onClick={() => setActiveTab('messaging')}
        >
          <FaComments className="inline-block mr-2" /> Messaging
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'friends' && <FriendsPanel />}
        {activeTab === 'online' && <OnlineUsersPanel />}
        {activeTab === 'messaging' && <MessagingPanel />}
      </div>
    </div>
  );
};

export default SocialPanel;