import React, { useState, useEffect, useRef } from 'react';
import { useProfile } from '../context/ProfileContext';
import { sendMessage, subscribeToMessages, ChatMessage } from '../utilities/chatService'; // Corrected import path
import { ChatListItem } from '../utilities/chatService'; // Assuming ChatListItem is used here for type inference if needed

interface ChatWindowProps {
  chatId: string; // The ID of the current chat
  friend: ChatListItem['friend']; // The friend's info for display
  onBack: () => void; // Function to go back to the chat list view
}

export default function ChatWindow({ chatId, friend, onBack }: ChatWindowProps) {
  const { user } = useProfile(); // Get current user's UID from context
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    if (chatId) { // Use chatId directly from props
      unsubscribe = subscribeToMessages(chatId, (fetchedMessages) => {
        setMessages(fetchedMessages);
      });
    }
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [chatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !user?.uid || !chatId) return; // Use user.uid and chatId

    try {
      await sendMessage(chatId, user.uid, messageInput);
      setMessageInput('');
    } catch (error) {
      console.error("Error sending message:", error);
      // Optionally display an error to the user
    }
  };

  // No specific "no chat selected" state here, as SocialPanel handles that.
  // This component expects a valid 'chat' prop.

  return (
    <div className="flex flex-col h-full bg-gray-800 rounded-lg shadow-lg">
      {/* Chat Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <button 
          onClick={onBack} 
          className="text-gray-400 hover:text-white text-2xl mr-2" 
          title="Back to Chats"
        >
          &larr; {/* Left arrow icon */}
        </button>
        <div className="flex items-center gap-3 flex-grow"> {/* Added flex-grow */}
          <img
            src={friend.avatarUrl || "/WegenRaceAssets/G1small.png"}
            className="w-10 h-10 rounded-full object-cover"
            alt={friend.username}
            onError={(e) => { e.currentTarget.src = '/WegenRaceAssets/G1small.png'; }}
          />
          <span className="text-xl font-semibold text-white">{friend.username}</span>
        </div>
        {/* Removed extra close button as onBack serves that purpose */}
      </div>

      {/* Messages Area */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {messages.length === 0 ? (
          <div className="text-gray-500 text-center py-10">Say hello! No messages yet.</div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.from === user?.uid ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[70%] p-3 rounded-lg shadow-md ${
                  msg.from === user?.uid
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

      {/* Message Input */}
      <form onSubmit={handleSendMessage} className="p-4 border-t border-gray-700 flex gap-2">
        <input
          type="text"
          value={messageInput}
          onChange={(e) => setMessageInput(e.target.value)}
          placeholder="Type your message..."
          className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
          disabled={!user?.uid}
        />
        <button
          type="submit"
          className="bg-purple-600 hover:bg-purple-700 active:bg-purple-800 px-4 py-2 rounded-lg font-bold text-white shadow disabled:opacity-50"
          disabled={!messageInput.trim() || !user?.uid}
        >
          Send
        </button>
      </form>
    </div>
  );
}