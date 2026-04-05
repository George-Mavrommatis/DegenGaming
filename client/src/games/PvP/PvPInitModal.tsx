import React from "react";
import { useNavigate } from "react-router-dom";

interface PvPInitModalProps {
  isOpen: boolean;
  onClose: () => void;
  game?: { route?: string; title?: string };
  [key: string]: any;
}

export default function PvPInitModal({ isOpen, onClose, game }: PvPInitModalProps) {
  const navigate = useNavigate();

  if (!isOpen) return null;

  const route = game?.route || '/games/degenfighter';

  const handlePlay = () => {
    onClose();
    navigate(route);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80"
      style={{ backdropFilter: 'blur(4px)' }}
    >
      <div className="bg-slate-900 rounded-xl shadow-xl flex flex-col items-center p-8 max-w-xs gap-4 relative border-2 border-red-600">
        <button
          className="absolute top-2 right-2 text-gray-300 hover:text-white text-lg"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        <div className="w-28 h-28 flex items-center justify-center text-6xl mb-1">⚔️</div>

        <div className="text-3xl font-bold text-red-400 mb-1 text-center">
          {game?.title || 'DegenFighter'}
        </div>

        <div className="text-slate-300 text-sm text-center">
          1v1 fighting arena — chain combos, drain your opponent's HP, and earn GG Coins!
        </div>

        <div className="text-xs text-slate-500 text-center">
          Controls: ← → Move &nbsp;|&nbsp; ↑ Jump &nbsp;|&nbsp; Z Attack &nbsp;|&nbsp; X Special
        </div>

        <button
          onClick={handlePlay}
          className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 rounded-lg transition text-lg shadow-lg shadow-red-900/40 mt-2"
        >
          ⚔ Enter Arena
        </button>
      </div>
    </div>
  );
}
