import React, { useState, useRef, useEffect } from "react";
import FriendsPanel from "./FriendsPanel";
import MessagingPanel from "./MessagingPanel";
import OnlineUsersPanel from "./OnlineUsersPanel";
import ChatWindow from "./ChatWindow";
import DuelInviteModal from "../games/PvP/DuelInviteModal"; 
import { useProfile } from "../context/ProfileContext";
import { findOrCreateChat } from "../utilities/chat";

const TABS = [
  { key: "friends", label: "Friends" },
  { key: "online", label: "Online Users" },
  { key: "messages", label: "Messages" },
] as const;

type TabKey = typeof TABS[number]["key"];

export default function SocialPanel() {
  const { user } = useProfile();
  const [selectedChat, setSelectedChat] = useState<{ chatId: string, friend: any } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("friends");
  const [duelTarget, setDuelTarget] = useState<any>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handle(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSelectedChat(null);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [isOpen]);

  // Select a friend/online user to chat
  const handleSelectChat = async (friend: any) => {
    if (!user) return;
    const chat = await findOrCreateChat(user.uid, friend.id);
    setSelectedChat({ chatId: chat.chatId, friend });
    setActiveTab("messages");
  };

  // Open duel modal
  const handleSendDuelInvite = (user: any) => {
    setDuelTarget(user);
  };

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-5 right-5 bg-purple-600 text-white p-4 rounded-full shadow-lg hover:bg-purple-700 z-50 text-lg"
          title="Open Social Panel"
        >💬</button>
      )}

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-end">
          <div
            ref={panelRef}
            className="relative w-[95vw] max-w-xl h-[80vh] max-h-[600px] min-h-[340px] mb-4 sm:mb-8 mr-2 sm:mr-8 border border-purple-700 rounded-xl shadow-2xl bg-gray-900 flex flex-col"
          >
            {/* Close button */}
            <button
              onClick={() => { setIsOpen(false); setSelectedChat(null); }}
              className="absolute top-2 right-3 text-gray-400 hover:text-white text-2xl font-bold z-10"
            >×</button>
            {/* Tabs */}
            <div className="flex bg-gray-800 rounded-t-xl">
              {TABS.map(tab => (
                <button
                  key={tab.key}
                  className={`flex-1 px-3 py-2 text-sm font-bold font-orbitron transition
                    ${activeTab===tab.key ? "bg-purple-700 text-white" : "text-purple-200"}
                  `}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {/* Panel Content */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              {activeTab === "friends" && (
                <div className="flex-1 min-h-0">
                  <FriendsPanel onSelectChat={handleSelectChat} onSendDuel={handleSendDuelInvite} />
                </div>
              )}
              {activeTab === "online" && (
                <div className="flex-1 min-h-0">
                  <OnlineUsersPanel onSelectChat={handleSelectChat} onSendDuel={handleSendDuelInvite} />
                </div>
              )}
              {activeTab === "messages" && (
                <div className="flex h-full min-h-0">
                  {/* Left: Chat list */}
                  <div className="w-1/3 border-r border-gray-800 h-full min-h-0">
                    <MessagingPanel
                      myUid={user.uid}
                      onSelectChat={(chat) => setSelectedChat(chat)}
                      selectedChat={selectedChat}
                    />
                  </div>
                  {/* Right: Chat window */}
                  <div className="flex-1 h-full min-h-0">
                    {selectedChat ? (
                      <ChatWindow
                        chatId={selectedChat.chatId}
                        friend={selectedChat.friend}
                        myUid={user.uid}
                        onBack={() => setSelectedChat(null)}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-gray-400 px-5 text-center">
                        Select a chat to start messaging.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Duel Modal */}
          {duelTarget && (
            <DuelInviteModal
              target={duelTarget}
              onClose={() => setDuelTarget(null)}
            />
          )}
        </div>
      )}
    </>
  );
}
