// src/components/ArcadeGameOverModal.tsx

import { FaUser, FaTrophy, FaRedo, FaCoins } from "react-icons/fa"; // ✅ Add FaCoins
import { ProfileData } from "../../types/profile";

interface ArcadeGameOverModalProps {
    score: number;
    coinsEarned: number; // ✅ ADD the new prop to the interface
    profile: ProfileData;
    onRestart: () => void;
    onGoToProfile: () => void;
    onGoToLeaderboards: () => void;
}

const DEFAULT_AVATAR = "/placeholder-avatar.png";

export default function ArcadeGameOverModal({
    score,
    coinsEarned, // ✅ RECEIVE the new prop
    profile,
    onRestart,
    onGoToProfile,
    onGoToLeaderboards
}: ArcadeGameOverModalProps) {
    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="bg-gray-800 text-white rounded-2xl shadow-lg border-2 border-yellow-400 p-8 w-full max-w-md text-center transform transition-all animate-jump-in">
                <h1 className="text-5xl font-bold text-yellow-400 mb-4 tracking-wider font-orbitron">GAME OVER</h1>
                <div className="flex items-center justify-center space-x-4 my-6">
                    <img
                        src={profile?.avatarUrl || DEFAULT_AVATAR}
                        alt="Player Avatar"
                        className="w-20 h-20 rounded-full border-4 border-gray-600"
                    />
                    <div>
                        <p className="text-xl font-semibold font-orbitron">{profile?.username || 'Guest'}</p>
                        <p className="text-3xl font-bold text-yellow-300 mt-1">{score.toLocaleString()} points</p>

                        {/* ✅ DISPLAY the coins earned */}
                        <div className="flex items-center justify-center text-lg text-yellow-500 mt-2">
                            <FaCoins className="mr-2" />
                            <span>+ {coinsEarned} Arcade Coins</span>
                        </div>

                    </div>
                </div>

                {/* --- Buttons remain unchanged --- */}
                <div className="grid grid-cols-1 gap-4 mt-8">
                    <button
                        onClick={onRestart}
                        className="flex items-center justify-center w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-4 rounded-lg text-xl transition-transform transform hover:scale-105"
                    >
                        <FaRedo className="mr-3" />
                        Play Again
                    </button>
                    <div className="grid grid-cols-2 gap-4">
                         <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onGoToProfile();
                            }}
                            className="flex items-center justify-center w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-lg text-lg transition-transform transform hover:scale-105"
                        >
                            <FaUser className="mr-2" />
                            Profile
                        </button>
                         <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onGoToLeaderboards();
                            }}
                            className="flex items-center justify-center w-full bg-purple-500 hover:bg-purple-600 text-white font-bold py-3 px-4 rounded-lg text-lg transition-transform transform hover:scale-105"
                        >
                             <FaTrophy className="mr-2" />
                            Leaderboards
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
