/**
 * MessagingPanel
 * Now uses API for chat list & creation; messages stream via subscribeToMessages.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useProfile } from '../firebase/userProfile';
import { apiService } from '../services/api';
import LoadingSpinner from './LoadingSpinner';
import ChatWindow from './ChatWindow';
import { subscribeToMessages, ChatListItem, ChatMessage, toDate } from '../utilities/chat';
import { toast } from 'react-toastify';

interface FriendForChat {
  uid: string;
  username: string;
  avatarUrl: string;
  isOnline?: boolean;
}

interface MessagingPanelProps {
  friendToChatWith: FriendForChat | null;
}

const MessagingPanel: React.FC<MessagingPanelProps> = ({ friendToChatWith }) => {
  const { user } = useProfile();
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [selectedChat, setSelectedChat] = useState<ChatListItem | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [subUnsub, setSubUnsub] = useState<(() => void) | null>(null);

  const loadChats = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await apiService.getUserChats();
      // Convert date-like fields into Date objects
      const mapped: ChatListItem[] = (list || []).map((c: any) => ({
        chatId: c.chatId,
        participants: c.participants || [],
        friend: c.friend || null,
        lastMessage: c.lastMessage
          ? { ...c.lastMessage, sentAt: toDate(c.lastMessage.sentAt) }
          : null,
        createdAt: toDate(c.createdAt),
        lastMessageAt: c.lastMessageAt ? toDate(c.lastMessageAt) : null,
        usedFallback: c.usedFallback
      }));
      // Order by lastMessageAt desc fallback createdAt
      mapped.sort((a,b)=>{
        const aTime = (a.lastMessageAt || a.createdAt).getTime();
        const bTime = (b.lastMessageAt || b.createdAt).getTime();
        return bTime - aTime;
      });
      setChats(mapped);
    } catch (e) {
      console.error('[MessagingPanel] loadChats error:', e);
      toast.error('Failed to load chats.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Load chats on mount / user change
  useEffect(() => {
    loadChats();
  }, [loadChats]);

  // If friendToChatWith is passed (e.g., from friends panel), find/create chat
  useEffect(() => {
    const proceed = async () => {
      if (friendToChatWith && user) {
        try {
          // See if chat already exists in state
            const existing = chats.find(c => c.friend?.uid === friendToChatWith.uid);
          if (existing) {
            handleSelectChat(existing);
            return;
          }
          // Create using backend
          const newChat = await apiService.findOrCreateChat(friendToChatWith.uid);
          await loadChats();
          const found = (await apiService.getUserChats()).find((c: any)=> c.chatId === newChat.chatId);
          if (found) {
            const normalized: ChatListItem = {
              chatId: found.chatId,
              participants: found.participants || [],
              friend: found.friend || null,
              lastMessage: found.lastMessage
                ? { ...found.lastMessage, sentAt: toDate(found.lastMessage.sentAt) }
                : null,
              createdAt: toDate(found.createdAt),
              lastMessageAt: found.lastMessageAt ? toDate(found.lastMessageAt) : null
            };
            handleSelectChat(normalized);
          }
        } catch (e) {
          console.error('[MessagingPanel] friendToChatWith error:', e);
          toast.error('Failed to open chat.');
        }
      }
    };
    proceed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendToChatWith, user]);

  const handleSelectChat = (chat: ChatListItem) => {
    // Tear down previous subscription
    subUnsub?.();
    setSelectedChat(chat);
    const unsub = subscribeToMessages(
      chat.chatId,
      (msgs) => setMessages(msgs),
      (err) => console.error('[MessagingPanel] subscribe error:', err)
    );
    setSubUnsub(()=>unsub);
  };

  useEffect(() => {
    return () => {
      subUnsub?.();
    };
  }, [subUnsub]);

  if (!user) {
    return <div className="text-center py-4 text-gray-400 text-sm">Log in to view messages.</div>;
  }

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
          friend={selectedChat.friend || undefined}
          messages={messages}
          onBack={() => {
            subUnsub?.();
            setSelectedChat(null);
            setMessages([]);
          }}
        />
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <h3 className="text-xl font-bold mb-4">Your Chats ({chats.length})</h3>
          {chats.length === 0 ? (
            <p className="text-gray-400 text-center py-4 text-sm">
              No active chats. Start one from your friends list!
            </p>
          ) : (
            <ul className="space-y-3">
              {chats.map(chat => (
                <li
                  key={chat.chatId}
                  className="flex items-center justify-between bg-slate-700 p-3 rounded-lg shadow-sm cursor-pointer hover:bg-slate-600 transition-colors duration-200"
                  onClick={() => handleSelectChat(chat)}
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={chat.friend?.avatarUrl || '/avatars/default.png'}
                      className="w-10 h-10 rounded-full object-cover border-2 border-purple-500"
                      alt={chat.friend?.username || ''}
                      onError={(e)=>{ e.currentTarget.src='/avatars/default.png'; }}
                    />
                    <div>
                      <span className="font-semibold block">{chat.friend?.username || 'Unknown'}</span>
                      {chat.lastMessage ? (
                        <p className="text-sm text-gray-300 truncate w-48">
                          {chat.lastMessage.from === user.uid ? 'You: ' : ''}
                          {chat.lastMessage.text} – {chat.lastMessage.sentAt.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
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