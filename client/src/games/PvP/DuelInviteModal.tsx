import React from "react";

export default function DuelInviteModal({ target, onClose }: { target: any, onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center">
      <div className="bg-gray-900 p-6 rounded-xl shadow-xl max-w-md w-full relative">
        <button onClick={onClose} className="absolute top-2 right-3 text-gray-400 hover:text-white text-2xl font-bold">×</button>
        <h2 className="text-xl font-bold text-white mb-2">Invite to Duel</h2>
        <div className="mb-4 text-purple-200">{target.username || target.wallet}</div>
        {/* TODO: Add duel options/form here */}
        <button className="bg-purple-700 px-4 py-2 rounded text-white font-bold" onClick={onClose}>Send Invitation</button>
      </div>
    </div>
  );
}
