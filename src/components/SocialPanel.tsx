// src/components/SocialPanel.tsx

import React, { useState, useRef, useEffect, useCallback } from "react";
import FriendsPanel from "./FriendsPanel";
import MessagingPanel from "./MessagingPanel"; // Your chat list panel
import OnlineUsersPanel from "./OnlineUsersPanel";
import ChatWindow from "./ChatWindow"; // Your chat window panel
import DuelInviteModal from "../games/PvP/DuelInviteModal"; 
import { useProfile } from "../context/ProfileContext";
import { findOrCreateChat, ChatListItem } from "../utilities/chatService"; // Corrected import path
import { ProfileData } from "../types/profile";

const TABS = [
  { key: "friends", label: "Friends" },
  { key: "online", label: "Online Users" },
  { key: "messages", label: "Messages" },
] as const;

type TabKey = typeof TABS[number]["key"];

// Type for a friend/user object that can be selected for chat or duel
interface SelectableUser extends ProfileData { // Extend ProfileData as it often contains these fields
  // uid: string; // Already in ProfileData.id
  // username: string; // Already in ProfileData
  // avatarUrl?: string; // Already in ProfileData
  // wallet?: string; // Already in ProfileData
}

export default function SocialPanel() {
  const { user, loading, isAuthenticated } = useProfile(); 

  const [selectedChat, setSelectedChat] = useState<ChatListItem | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("messages"); // Start on messages tab by default, as that's where we expect interaction
  const [duelTarget, setDuelTarget] = useState<ProfileData | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handle(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSelectedChat(null); // Clear selected chat when panel closes
        setActiveTab("messages"); // Return to messages tab when re-opening
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [isOpen]);

  // Select a friend/online user to chat
  const handleSelectChat = useCallback(async (selectedUser: SelectableUser) => {
    if (!user?.uid) { 
      console.warn("SocialPanel: User not logged in, cannot select chat.");
      return;
    }
    
    try {
        // Use the selectedUser.id as targetUid, since ProfileData has 'id'
        const chatFound: ChatListItem = await findOrCreateChat(user.uid, selectedUser.id);
        
        // The findOrCreateChat already returns a ChatListItem with a 'friend' object,
        // so we can directly use `chatFound`. No need to reconstruct `friendForChatWindow`.
        setSelectedChat(chatFound);
        setActiveTab("messages");
    } catch (error) {
        console.error("SocialPanel: Failed to find or create chat:", error);
        // Optionally display a toast error to the user
    }
  }, [user]); 

  // Open duel modal
  const handleSendDuelInvite = useCallback((targetUser: ProfileData) => { 
    setDuelTarget(targetUser);
  }, []);

  if (loading) {
    return (
      <div className="fixed bottom-5 right-5 z-50">
        <button className="bg-purple-600 text-white p-4 rounded-full shadow-lg text-lg animate-pulse">
          Loading...
        </button>
      </div>
    );
  }

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
              onClick={() => { setIsOpen(false); setSelectedChat(null); }} // Clear chat when panel closes
              className="absolute top-2 right-3 text-gray-400 hover:text-white text-2xl font-bold z-10"
            >×</button>
            {/* Tabs */}
            <div className="flex bg-gray-800 rounded-t-xl">
              {TABS.map(tab => (
                <button
                  key={tab.key}
                  className={`flex-1 px-3 py-2 text-sm font-bold font-orbitron transition
                    ${activeTab===tab.key ? "bg-purple-700 text-white" : "text-purple-200 hover:bg-purple-900/60"}
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
                      myUid={user?.uid || ""} // Pass myUid for fetching chat list
                      onSelectChat={setSelectedChat} // Callback to update selectedChat in SocialPanel
                      selectedChat={selectedChat} // Pass the currently selected chat for highlighting
                    />
                  </div>
                  {/* Right: Chat window */}
                  <div className="flex-1 h-full min-h-0">
                    {selectedChat && isAuthenticated ? (
                      <ChatWindow
                        chatId={selectedChat.chatId}
                        friend={selectedChat.friend} 
                        // myUid is retrieved internally by ChatWindow using useProfile()
                        onBack={() => setSelectedChat(null)} // Allows ChatWindow to signal back to list view
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-gray-400 px-5 text-center">
                        {isAuthenticated ? "Select a chat to start messaging." : "Please log in to view messages."}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Duel Modal */}
          {duelTarget && isAuthenticated && user?.uid && ( 
            <DuelInviteModal
              myUid={user.uid} 
              target={duelTarget}
              onClose={() => setDuelTarget(null)}
            />
          )}
        </div>
      )}
    </>
  );
}