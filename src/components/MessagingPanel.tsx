import React, { useState, useEffect } from "react";
import { getUserChats, ChatListItem } from "../utilities/chatService"; // Corrected import path

interface MessagingPanelProps {
  myUid: string;
  onSelectChat: (chat: ChatListItem) => void; // Callback to SocialPanel
  selectedChat: ChatListItem | null; // For highlighting the active chat
}

export default function MessagingPanel({ myUid, onSelectChat, selectedChat }: MessagingPanelProps) {
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!myUid) {
      setChatList([]);
      setLoadingChats(false);
      return;
    }

    setLoadingChats(true);
    setError(null);
    getUserChats(myUid)
      .then(chats => {
        setChatList(chats);
        setLoadingChats(false);
      })
      .catch(err => {
        console.error("Error fetching chat list:", err);
        setError("Failed to load chats.");
        setLoadingChats(false);
      });
  }, [myUid]); // Re-fetch when the current user's UID changes

  return (
    <div className="h-full bg-gray-900 overflow-y-auto flex flex-col"> {/* Added flex-col */}
      <div className="font-bold p-3 text-purple-400 border-b border-gray-700">Chats</div>
      {error && <div className="p-4 text-red-400">{error}</div>}
      {loadingChats ? (
        <div className="p-4 text-gray-500">Loading chats...</div>
      ) : chatList.length === 0 ? (
        <div className="p-4 text-gray-500">
          No chats yet. Start one from the Friends or Online Users tab!
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto"> {/* Added flex-1 and overflow-y-auto */}
          {chatList.map(chat => (
            <div
              key={chat.chatId}
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-purple-950
                ${selectedChat?.chatId === chat.chatId ? "bg-purple-700" : ""}`}
              onClick={() => onSelectChat(chat)}
            >
              <img 
                src={chat.friend.avatarUrl || "/WegenRaceAssets/G1small.png"} 
                className="w-8 h-8 rounded-full object-cover" 
                alt={`${chat.friend.username}'s avatar`} 
                onError={(e) => { e.currentTarget.src = '/WegenRaceAssets/G1small.png'; }}
              />
              <div className="flex-1">
                <div className="font-bold truncate max-w-[110px] text-white">{chat.friend.username}</div>
                <div className="text-xs text-gray-300 truncate max-w-[120px]">
                  {chat.lastMessage ? chat.lastMessage.text : "No messages"}
                </div>
              </div>
              <span className="ml-auto text-[10px] text-gray-500">
                {chat.lastMessage && new Date(chat.lastMessage.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}