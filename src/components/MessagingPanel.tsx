import React, { useState, useEffect } from "react";
import { getUserChats } from "../utilities/chat";

export default function MessagingPanel({ myUid, onSelectChat, selectedChat }) {
  const [chatList, setChatList] = useState<any[]>([]);

  useEffect(() => {
    getUserChats(myUid).then(setChatList);
  }, [myUid]);

  return (
    <div className="h-full bg-gray-900 overflow-y-auto">
      <div className="font-bold p-3 text-purple-400">Chats</div>
      {chatList.length === 0 ? (
        <div className="p-4 text-gray-500">No chats yet.</div>
      ) : chatList.map(chat => (
        <div
          key={chat.chatId}
          className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-purple-950
            ${selectedChat?.chatId === chat.chatId ? "bg-purple-700" : ""}`}
          onClick={() => onSelectChat(chat)}
        >
          <img src={chat.friend.avatarUrl || "/placeholder-avatar.png"} className="w-8 h-8 rounded-full" alt="" />
          <div>
            <div className="font-bold truncate max-w-[110px]">{chat.friend.username}</div>
            <div className="text-xs text-gray-300 truncate max-w-[120px]">
              {chat.lastMessage ? chat.lastMessage.text : "No messages"}
            </div>
          </div>
          <span className="ml-auto text-[10px] text-gray-500">
            {chat.lastMessage && new Date(chat.lastMessage.sentAt).toLocaleTimeString()}
          </span>
        </div>
      ))}
    </div>
  );
}
