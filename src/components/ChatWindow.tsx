// DegenGamingFrontend/src/components/ChatWindow.tsx
// Ensure this file matches the one I provided exactly.

import React, { useState, useEffect, useRef } from 'react';
import { useProfile } from '../context/ProfileContext';
import { subscribeToMessages, ChatMessage, ChatListItem } from '../utilities/chat';
import { apiService } from '../services/api';

interface ChatWindowProps {
  chatId: string;
  friend: ChatListItem['friend'];
  onBack: () => void;
}

export default function ChatWindow({ chatId, friend, onBack }: ChatWindowProps) {
  const { currentUser } = useProfile(); // Use currentUser
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    if (chatId) { 
      unsubscribe = subscribeToMessages(chatId, (fetchedMessages) => {
        setMessages(fetchedMessages);
      });
    }
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [chatId]);

  useEffect(() => {
    if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !currentUser?.uid || !chatId) return;

    setIsSending(true);
    try {
      await apiService.sendChatMessage(chatId, messageInput);
      setMessageInput('');
    } catch (error) {
      console.error("ChatWindow: Error sending message:", error);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-800 rounded-lg">
      <div className="flex items-center p-4 border-b border-slate-700 bg-slate-900 sticky top-0 z-10">
        <button 
          onClick={onBack} 
          className="text-gray-400 hover:text-white text-2xl mr-3 transition-colors duration-200" 
          title="Back to Chats"
        >
          &larr;
        </button>
        <img
          src={friend.avatarUrl || "/avatars/default.png"}
          className="w-10 h-10 rounded-full object-cover border-2 border-purple-500"
          alt={friend.username}
          onError={(e) => { e.currentTarget.src = '/avatars/default.png'; }}
        />
        <span className="text-xl font-semibold text-white ml-3">{friend.username}</span>
      </div>

      <div className="flex-1 p-4 overflow-y-auto space-y-4 custom-scrollbar">
        {messages.length === 0 ? (
          <div className="text-gray-500 text-center py-10">Say hello! No messages yet.</div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.from === currentUser?.uid ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[70%] p-3 rounded-lg shadow-md ${
                  msg.from === currentUser?.uid
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-700 text-gray-200'
                }`}
              >
                <p className="text-sm">{msg.text}</p>
                <span className="text-xs opacity-75 mt-1 block text-right">
                  {msg.sentAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-700 bg-slate-900 sticky bottom-0 z-10 flex gap-2">
        <input
          type="text"
          value={messageInput}
          onChange={(e) => setMessageInput(e.target.value)}
          placeholder="Type your message..."
          className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
          disabled={!currentUser?.uid || isSending}
        />
        <button
          type="submit"
          className="bg-purple-600 hover:bg-purple-700 active:bg-purple-800 px-4 py-2 rounded-lg font-bold text-white shadow-md transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!messageInput.trim() || !currentUser?.uid || isSending}
        >
          {isSending ? <LoadingSpinner size="sm" /> : 'Send'}
        </button>
      </form>
    </div>
  );
}