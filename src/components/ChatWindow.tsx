import React, { useState, useRef, useEffect } from "react";
import { subscribeToMessages, sendMessage } from "../utilities/chat";
import { FaArrowLeft, FaPaperPlane } from "react-icons/fa";

type User = {
  username: string;
  avatarUrl?: string;
  [key: string]: any;
};

type Message = {
  id: string;
  from: string;
  text: string;
  sentAt: number;
};

interface ChatWindowProps {
  chatId: string;
  friend: User;
  myUid: string;
  onBack: () => void;
}

export default function ChatWindow({ chatId, friend, myUid, onBack }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const msgEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError("");
    const unsub = subscribeToMessages(chatId, (msgs: Message[]) => {
      setMessages(msgs);
      setLoading(false);
    });
    return () => unsub();
  }, [chatId]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!input.trim()) return;
    try {
      await sendMessage(chatId, myUid, input.trim());
      setInput("");
      setError("");
    } catch (err: any) {
      setError(err.message || "Send failed.");
    }
  }

  return (
    <div className="h-full flex flex-col bg-gray-900 shadow-md rounded-lg">
      {/* Header */}
      <div className="flex items-center border-b border-gray-800 px-4 py-2 bg-gray-800">
        <button onClick={onBack} className="text-purple-400 hover:text-purple-200 mr-3">
          <FaArrowLeft size={18} />
        </button>
        <img src={friend.avatarUrl || "/placeholder-avatar.png"} className="w-8 h-8 rounded-full" alt={friend.username} />
        <span className="ml-3 font-bold">{friend.username}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" style={{ minHeight: 0 }}>
        {loading ? (
          <div className="text-center text-gray-400 mt-10">Loading messages…</div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={
                msg.from === myUid
                  ? "flex justify-end"
                  : "flex justify-start"
              }
            >
              <div className={`max-w-xs sm:max-w-md px-3 py-2 rounded-lg text-sm shadow
                ${msg.from === myUid
                  ? "bg-purple-600 text-white"
                  : "bg-gray-800 text-gray-100"}`
              }>
                <span>{msg.text}</span>
                <div className="text-xs opacity-60 text-right mt-1">
                  {new Date(msg.sentAt).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={msgEndRef}></div>
      </div>

      {/* Input */}
      <form
        onSubmit={handleSend}
        className="flex items-center border-t border-gray-800 px-3 py-2 bg-gray-800 gap-2"
        autoComplete="off"
      >
        <input
          className="flex-1 rounded px-3 py-2 bg-gray-900 text-white border border-gray-700 focus:ring focus:ring-purple-600 outline-none"
          value={input}
          placeholder="Type your message…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) handleSend(e);
          }}
          disabled={loading}
          maxLength={1000}
        />
        <button
          type="submit"
          className="bg-purple-600 text-white px-4 py-2 rounded flex items-center gap-2 hover:bg-purple-700 transition"
          disabled={loading || !input.trim()}
        >
          <FaPaperPlane />
        </button>
      </form>
      {error && (
        <div className="px-4 py-2 bg-red-900 text-red-300 rounded text-xs">{error}</div>
      )}
    </div>
  );
}
