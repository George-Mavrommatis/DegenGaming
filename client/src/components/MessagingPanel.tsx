// DegenGamingFrontend/src/components/MessagingPanel.tsx
// Ensure this file matches the one I provided exactly.

import React, { useState, useEffect, useCallback } from 'react';
import { useProfile } from '../context/ProfileContext';
import { apiService } from '../services/api';
import { toast } from 'react-toastify';
import LoadingSpinner from './LoadingSpinner';
import ChatWindow from './ChatWindow';
import { ChatListItem } from '../utilities/chat'; 

interface FriendForChat { // Consistent interface
  uid: string;
  username: string;
  avatarUrl: string;
  isOnline?: boolean;
}

interface MessagingPanelProps {
  friendToChatWith: FriendForChat | null; 
}

const MessagingPanel: React.FC<MessagingPanelProps> = ({ friendToChatWith }) => {
  const { currentUser, firebaseAuthToken } = useProfile();
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [selectedChat, setSelectedChat] = useState<ChatListItem | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchChats = useCallback(async () => {
    if (!currentUser || !firebaseAuthToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const fetchedChats = await apiService.getUserChats();
      setChats(fetchedChats);
      console.log("MessagingPanel: Chats fetched:", fetchedChats.length);
    } catch (error) {
      console.error("MessagingPanel: Failed to fetch chats:", error);
    } finally {
      setLoading(false);
    }
  }, [currentUser, firebaseAuthToken]);

  useEffect(() => {
    fetchChats();
    const interval = setInterval(fetchChats, 30 * 1000); 
    return () => clearInterval(interval);
  }, [fetchChats]);

  useEffect(() => {
    const handleInitialChat = async () => {
      if (friendToChatWith && currentUser) {
        setLoading(true);
        try {
          const chat = await apiService.findOrCreateChat(friendToChatWith.uid);
          setSelectedChat(chat);
        } catch (error) {
          console.error("MessagingPanel: Error finding/creating chat for prop:", error);
          toast.error("Failed to open chat with friend.");
          setSelectedChat(null);
        } finally {
          setLoading(false);
        }
      }
    };
    handleInitialChat();
  }, [friendToChatWith, currentUser]);

  const handleSelectChat = (chatItem: ChatListItem) => {
    setSelectedChat(chatItem);
  };

  if (loading) {
    return (
      <div className="text-center py-4">
        <LoadingSpinner />
        <p className="mt-2 text-gray-400 text-sm">Loading chats...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {selectedChat ? (
        <ChatWindow 
          chatId={selectedChat.chatId} 
          friend={selectedChat.friend} 
          onBack={() => setSelectedChat(null)} 
        />
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <h3 className="text-xl font-bold mb-4">Your Chats ({chats.length})</h3>
          {chats.length === 0 ? (
            <p className="text-gray-400 text-center py-4 text-sm">No active chats. Start one from your friends list!</p>
          ) : (
            <ul className="space-y-3">
              {chats.map((chat) => (
                <li
                  key={chat.chatId}
                  className="flex items-center justify-between bg-slate-700 p-3 rounded-lg shadow-sm cursor-pointer hover:bg-slate-600 transition-colors duration-200"
                  onClick={() => handleSelectChat(chat)}
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={chat.friend.avatarUrl || "/avatars/default.png"}
                      className="w-10 h-10 rounded-full object-cover border-2 border-purple-500"
                      alt={chat.friend.username}
                      onError={(e) => { e.currentTarget.src = '/avatars/default.png'; }}
                    />
                    <div>
                      <span className="font-semibold block">{chat.friend.username}</span>
                      {chat.lastMessage ? (
                        <p className="text-sm text-gray-300 truncate w-48">
                          {chat.lastMessage.from === currentUser?.uid ? 'You: ' : ''}
                          {chat.lastMessage.text} - {chat.lastMessage.sentAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400">No messages yet.</p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default MessagingPanel;