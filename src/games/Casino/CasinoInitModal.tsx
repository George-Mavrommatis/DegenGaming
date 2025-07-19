import React from "react";

interface CasinoInitModalProps {
  isOpen: boolean;
  onClose: () => void;
  // ...accept any other props to be compatible
}

export default function CasinoInitModal({ isOpen, onClose }: CasinoInitModalProps) {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80"
      style={{backdropFilter: 'blur(4px)'}}
    >
      <div className="bg-slate-900 rounded-xl shadow-xl flex flex-col items-center p-8 max-w-xs gap-4 relative border-2 border-yellow-600">
        <button
          className="absolute top-2 right-2 text-gray-300 hover:text-white text-lg"
          onClick={onClose}
        >
          ×
        </button>
        <img 
          src="/mnt/data/ba7c85700b3c805bbe9c708ef1b5a275-image.png" 
          alt="Coming Soon" 
          className="w-28 h-28 object-contain mb-3"
        />
        <div className="text-3xl font-bold text-yellow-400 mb-2 text-center">
          Casino Games
        </div>
        <div className="text-lg text-slate-200 mb-1 text-center">
          Coming Soon!
        </div>
        <div className="text-slate-400 text-sm text-center">
          Exciting casino games will join Degen Gaming soon. Stay tuned for future updates!
        </div>
      </div>
    </div>
  );
}