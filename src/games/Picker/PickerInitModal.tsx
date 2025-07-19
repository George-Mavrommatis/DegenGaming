// src/games/Picker/PickerInitModal.tsx

import React, { useState, useMemo, useEffect, useCallback } from "react";
import Modal from "react-modal";
import { toast } from "react-toastify";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { Player as LottiePlayer } from "@lottiefiles/react-lottie-player";
import { useProfile } from "../../context/ProfileContext"; // Ensure this path is correct
import { getAuth } from "firebase/auth"; // Make sure Firebase is initialized elsewhere

// Import the Player type from the WegenRaceGame module for type consistency.
// Adjust this path if your WegenRaceGame interface is located elsewhere.
import { Player as WegenRacePlayerType } from '../../games/Picker/WegenRace/wegenRaceGame';


// Constants for entry fees. Only SOL fee remains.
const FIXED_SOL_ENTRY_FEE = 0.01; // This is the fixed SOL fee for a picker game.

// Initialize Firebase auth (should ideally be done in a higher-level context or utility file)
const auth = getAuth();

// OnboardingPanel component: Handles player selection and race duration setup.
interface OnboardingPanelProps {
    ledger: any[]; // The list of available registered users for selection
    minPlayers: number; // Minimum players required to start
    onComplete: (players: WegenRacePlayerType[], raceDuration: number, playerChoice: WegenRacePlayerType) => void;
    onCancel: () => void;
}

function OnboardingPanel({ ledger, minPlayers, onComplete, onCancel }: OnboardingPanelProps) {
    // State to manage the currently selected players for the race
    const [selectedUsers, setSelectedUsers] = useState<WegenRacePlayerType[]>([]);
    // State for the search input to filter users
    const [search, setSearch] = useState("");
    // State for the chosen race duration, defaulting to 2 minutes
    const [raceDuration, setRaceDuration] = useState<number>(2);
    // State to identify which of the selected players is controlled by the human user
    const [humanPlayerChoice, setHumanPlayerChoice] = useState<WegenRacePlayerType | null>(null);

    // Get the current Firebase authenticated user
    const { currentUser } = auth;

    // Predefined options for race duration buttons
    const timeOptions = [
        { value: 1, label: "1 Min", color: "from-blue-500 to-blue-600" },
        { value: 2, label: "2 Mins", color: "from-green-500 to-green-600" },
        { value: 3, label: "3 Mins", color: "from-yellow-500 to-yellow-600" },
        { value: 4, label: "4 Mins", color: "from-orange-500 to-orange-600" },
        { value: 5, label: "5 Mins", color: "from-red-500 to-red-600" },
        { value: 8, label: "8 Mins", color: "from-purple-500 to-purple-600" },
        { value: 15, label: "15 Mins", color: "from-pink-500 to-pink-600" },
        { value: 30, label: "30 Mins", color: "from-indigo-500 to-indigo-600" },
    ];

    // Effect to automatically add the current authenticated user as the first selected player
    // and set them as the human-controlled player if they haven't been added yet.
    useEffect(() => {
        if (currentUser && !humanPlayerChoice && !selectedUsers.some(u => u.key === currentUser.uid)) {
            const userPlayer: WegenRacePlayerType = {
                key: currentUser.uid, // Unique identifier for the player
                name: currentUser.displayName || 'You', // Display name for the player
                username: currentUser.displayName || 'You', // Store username for display within this component
                avatarUrl: currentUser.photoURL || '/WegenRaceAssets/G1small.png', // User's avatar URL
                isHumanPlayer: true, // This player is controlled by the current user
                // wallet: currentUser.uid, // Uncomment if your WegenRacePlayerType explicitly requires a wallet for Firebase users
            };
            setSelectedUsers([userPlayer]);
            setHumanPlayerChoice(userPlayer);
        }
    }, [currentUser, humanPlayerChoice, selectedUsers]); // Dependencies: re-run if currentUser, humanPlayerChoice, or selectedUsers change

    // Memoized filtering of the user ledger based on search input,
    // excluding users that are already selected for the race.
    const filteredLedger = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return []; // If search is empty, return no suggestions

        const safeLedger = Array.isArray(ledger) ? ledger : []; // Ensure ledger is an array
        if (safeLedger.length === 0) return []; // If ledger is empty, return no suggestions

        return safeLedger.filter(u =>
            // Check if username or wallet address includes the search query
            ((u.username && u.username.toLowerCase().includes(query)) ||
             (u.wallet && u.wallet.toLowerCase().includes(query))) &&
            // Exclude users already in the selected list
            !selectedUsers.some(su =>
                (su.key === (u.key || u.wallet || u.uid)) || // Prefer unique key, then wallet, then uid for comparison
                (su.username && u.username && su.username.toLowerCase() === u.username.toLowerCase()) ||
                ((su as any).wallet && (u as any).wallet && (su as any).wallet.toLowerCase() === (u as any).wallet.toLowerCase())
            )
        );
    }, [search, ledger, selectedUsers]); // Dependencies: re-filter when search, ledger, or selectedUsers change

    // Function to add a user (either from ledger or as a new guest) to the selected players.
    const addUser = (user: any) => {
        const userWithKey: WegenRacePlayerType = {
            key: user.key || user.wallet || user.uid || `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`, // Generate a unique key
            name: user.username || user.name || 'Guest Player', // Use 'name' for WegenRacePlayerType
            username: user.username || user.name, // Keep 'username' for internal component display
            avatarUrl: user.avatarUrl || '/WegenRaceAssets/G1small.png', // Default avatar
            isHumanPlayer: false, // Initially assume not human-controlled
            // wallet: user.wallet, // Uncomment if your WegenRacePlayerType explicitly requires a wallet for Firebase users
        };
        setSelectedUsers(prev => [...prev, userWithKey]); // Add to the list
        if (!humanPlayerChoice) { // If no human player is chosen yet, set this one
            setHumanPlayerChoice(userWithKey);
        }
        setSearch(""); // Clear search input after adding
    };

    // Function to attempt adding a user based on the current search input value.
    const tryAdd = (val: string) => {
        const trimmedVal = val.trim();
        if (!trimmedVal) return; // Do nothing if input is empty

        // Check if the player is already selected
        if (selectedUsers.some(su => (su.username || su.name)?.toLowerCase() === trimmedVal.toLowerCase() || (su as any).wallet?.toLowerCase() === trimmedVal.toLowerCase())) {
            toast.info("This player is already in the race.");
            return;
        }

        const safeLedger = Array.isArray(ledger) ? ledger : [];
        // Try to find a registered user matching the input
        const userFound = safeLedger.find(u =>
            (u.username?.toLowerCase() === trimmedVal.toLowerCase() || u.wallet?.toLowerCase() === trimmedVal.toLowerCase())
        );

        if (userFound) {
            addUser(userFound); // Add registered user
        } else {
            // If not found, add as a new guest player
            const guestPlayer: WegenRacePlayerType = {
                key: `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                name: trimmedVal,
                username: trimmedVal, // Use the input as username for display
                avatarUrl: '/WegenRaceAssets/G1small.png',
                isHumanPlayer: false,
                // wallet: `guest_${Date.now()}`, // Optional: Assign a mock wallet for guests if needed by WegenRacePlayerType
            };
            addUser(guestPlayer);
        }
    };

    // Function to remove a player from the selected list by index.
    const removeAt = (idx: number) => {
        const removedUser = selectedUsers[idx];
        setSelectedUsers(prev => {
            const newUsers = prev.filter((_, i) => i !== idx); // Filter out the user at the given index
            // If the removed user was the human player, re-assign the human player choice
            if (humanPlayerChoice?.key === removedUser?.key) {
                setHumanPlayerChoice(newUsers.length > 0 ? newUsers[0] : null); // Set to first remaining or null
            }
            return newUsers;
        });
    };

    // Determine if all conditions are met to start the race
    const canStartRace = selectedUsers.length >= minPlayers &&
                         raceDuration > 0 &&
                         humanPlayerChoice !== null;

    return (
        <div className="max-w-md w-full m-auto text-white">
            <h2 className="text-yellow-300 text-center font-bold text-xl mb-4">Set Up The Race</h2>

            {/* Input for searching/adding users */}
            <div className="mb-4 relative">
                <input
                    className="w-full bg-gray-800 text-yellow-200 text-center font-bold rounded px-3 py-2 mb-1 border-2 border-gray-700 focus:border-yellow-400 outline-none"
                    placeholder="Search registered user or add a guest…"
                    value={search}
                    autoFocus
                    onChange={e => setSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") tryAdd(search); }}
                />
                <p className="text-center text-xs text-gray-400 mt-1">
                    Add at least {minPlayers} players to start!
                </p>
                {/* Display search suggestions from filtered ledger */}
                {Array.isArray(filteredLedger) && filteredLedger.length > 0 && (
                    <div className="absolute w-full bg-slate-800 shadow rounded mt-1 max-h-48 overflow-y-auto z-20">
                        {filteredLedger.slice(0, 8).map((u, i) => (
                            <div key={(u as any).key || (u as any).wallet || `user-${i}`}
                                className="flex gap-2 items-center px-3 py-2 cursor-pointer hover:bg-yellow-400 hover:text-black text-zinc-200"
                                onMouseDown={() => addUser(u)}> {/* Use onMouseDown to prevent losing focus before click fires */}
                                <img
                                    src={(u as any).avatarUrl || '/WegenRaceAssets/G1small.png'}
                                    alt={(u as any).username || (u as any).name}
                                    className="w-6 h-6 rounded-full object-cover"
                                    onError={(e) => { e.currentTarget.src = '/WegenRaceAssets/G1small.png'; }}
                                />
                                <b className="font-semibold">{(u as any).username || (u as any).name}</b>
                                <span className="ml-auto text-xs text-yellow-500">
                                    [{(u as any).wallet ? `${(u as any).wallet.slice(0, 4)}...${(u as any).wallet.slice(-4)}` : 'Guest'}]
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Display of selected players */}
            <div className="mb-4 p-3 bg-black bg-opacity-20 rounded-lg">
                <div className="mb-2 text-zinc-300 font-semibold">Selected Players ({selectedUsers.length}):</div>
                <ul className="mb-2 space-y-2 max-h-[250px] overflow-y-auto pr-2">
                    {selectedUsers.length === 0 ? (
                        <li className="text-gray-400 italic text-sm text-center py-2">No players selected.</li>
                    ) : (
                        selectedUsers.map((u, idx) => (
                            <li key={u.key} // Use the robust key assigned during addUser
                                className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-all duration-200 ${humanPlayerChoice?.key === u.key ? 'bg-yellow-400 text-black scale-105 shadow-lg' : 'bg-gray-700 hover:bg-gray-600'}`}
                                onClick={() => setHumanPlayerChoice(u)} // Allow changing human player choice
                            >
                                <div className="font-bold text-lg w-6 text-center">{idx + 1}.</div>
                                <img
                                    src={u.avatarUrl || '/WegenRaceAssets/G1small.png'}
                                    alt={u.username || u.name}
                                    className="w-8 h-8 rounded-full border-2 border-gray-500 object-cover"
                                    onError={(e) => { e.currentTarget.src = '/WegenRaceAssets/G1small.png'; }}
                                />
                                <div className="flex-grow overflow-hidden">
                                    <b className="truncate block">{u.username || u.name || "Guest Player"}</b>
                                    {/* Display wallet if present and not a temporary guest ID */}
                                    {(u as any).wallet && !(u.key.startsWith('guest_')) && (
                                        <div className="text-xs opacity-80 font-mono">
                                            {(u as any).wallet.length > 8 ? `${(u as any).wallet.slice(0, 4)}...${(u as any).wallet.slice(-4)}` : (u as any).wallet}
                                        </div>
                                    )}
                                    {/* Indicate if default avatar is used */}
                                    {(!u.avatarUrl || u.avatarUrl === '/WegenRaceAssets/G1small.png') && (
                                        <div className="text-xs opacity-60">🦒 Default Avatar</div>
                                    )}
                                </div>
                                <button
                                    className="ml-auto flex-shrink-0 text-xs font-bold text-red-500 hover:text-red-300 px-2 py-1 rounded bg-black bg-opacity-20"
                                    onClick={(e) => { e.stopPropagation(); removeAt(idx); }} // Prevent parent onClick when removing
                                >
                                    X
                                </button>
                            </li>
                        ))
                    )}
                </ul>
                {/* Display current human player choice */}
                {humanPlayerChoice && (
                    <div className="text-center text-sm mt-3 p-2 bg-blue-900/50 border border-blue-500 rounded-md">
                        You are picking: <b className="text-blue-300">{humanPlayerChoice.username || humanPlayerChoice.name || 'Guest Player'}</b>
                        <div className="flex items-center justify-center gap-2 mt-1">
                            <img
                                src={humanPlayerChoice.avatarUrl || '/WegenRaceAssets/G1small.png'}
                                alt={humanPlayerChoice.username || humanPlayerChoice.name}
                                className="w-6 h-6 rounded-full border border-blue-400 object-cover"
                                onError={(e) => { e.currentTarget.src = '/WegenRaceAssets/G1small.png'; }}
                            />
                            <span className="text-xs text-blue-200">
                                {(!humanPlayerChoice.avatarUrl || humanPlayerChoice.avatarUrl === '/WegenRaceAssets/G1small.png') ? '🦒 Default' : '✅ Custom'}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* Race duration selection */}
            <div className="mb-5">
                <label className="text-zinc-300 block mb-3 font-semibold text-center">
                    Select Race Duration
                    <span className="block text-yellow-300 text-sm mt-1">
                        Selected: {raceDuration} minute{raceDuration !== 1 ? 's' : ''}
                    </span>
                </label>
                <div className="grid grid-cols-4 gap-2 mb-3">
                    {timeOptions.slice(0, 4).map((option) => (
                        <button
                            key={option.value}
                            onClick={() => setRaceDuration(option.value)}
                            className={`px-2 py-2 text-xs font-bold rounded-lg transition-all duration-200 ${raceDuration === option.value
                                ? `bg-gradient-to-r ${option.color} text-white scale-105 shadow-lg`
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
                <div className="grid grid-cols-4 gap-2">
                    {timeOptions.slice(4).map((option) => (
                        <button
                            key={option.value}
                            onClick={() => setRaceDuration(option.value)}
                            className={`px-2 py-2 text-xs font-bold rounded-lg transition-all duration-200 ${raceDuration === option.value
                                ? `bg-gradient-to-r ${option.color} text-white scale-105 shadow-lg`
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Start Race button */}
            <button
                className={`w-full px-4 py-3 text-lg font-bold rounded-lg shadow-lg border-2 transition-all duration-200 ${canStartRace
                    ? 'bg-gradient-to-r from-green-500 to-lime-400 hover:from-green-600 hover:to-lime-700 text-white border-green-400 hover:scale-105 shadow-green-400/50'
                    : 'bg-gray-600 text-gray-300 border-gray-500 cursor-not-allowed opacity-75'
                    }`}
                disabled={!canStartRace}
                onClick={() => onComplete(selectedUsers, raceDuration, humanPlayerChoice!)} // Assert humanPlayerChoice as non-null
            >
                {canStartRace ? (
                    <>🏁 Start {raceDuration}min Race!</>
                ) : (
                    <>
                        {selectedUsers.length < minPlayers
                            ? `Need ${minPlayers - selectedUsers.length} more players`
                            : !humanPlayerChoice
                                ? 'Select your player'
                                : 'Setup incomplete'
                        }
                    </>
                )}
            </button>

            {/* Cancel button */}
            <button
                className="w-full mt-3 py-2 rounded-lg bg-gray-700 text-white font-bold shadow hover:bg-gray-800 transition-colors"
                onClick={onCancel}
            >
                Cancel
            </button>
        </div>
    );
}

// Modal styling for react-modal library
const modalStyles = {
    overlay: { backgroundColor: "rgba(10, 10, 20, 0.9)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" },
    content: { position: "static", maxWidth: 480, width: "100%", maxHeight: "90vh", border: "none", borderRadius: "1.2em", background: "none", padding: 0 }
};

// Custom hook to fetch only SOL prices (GGW removed)
const useTokenPricing = () => {
    const [prices, setPrices] = useState<{ solUsd: number | null }>({ solUsd: null }); // Only SOL price
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchPrices() {
            setLoading(true);
            setError(null);
            try {
                // Fetch only SOL price
                const response = await fetch('http://localhost:4000/api/prices'); // Assuming this API can return only SOL too
                if (!response.ok) {
                    throw new Error('Failed to fetch prices from backend');
                }
                const data = await response.json();
                const solPrice = data.solUsd;

                // Validate received SOL price data
                if (typeof solPrice !== 'number' || solPrice <= 0) {
                    throw new Error("Invalid SOL price data received from backend.");
                }
                setPrices({ solUsd: solPrice });

            } catch (err: any) {
                console.error("Failed to fetch SOL price:", err);
                setError("Could not load real-time SOL price. Using fixed estimates.");
                setPrices({ solUsd: null }); // Reset prices on error to trigger fallback calculations
            } finally {
                setLoading(false);
            }
        }
        fetchPrices();
    }, []); // Empty dependency array ensures this runs only once on mount

    // Memoized calculation for SOL ticket price (fixed from constant)
    // This value is directly used as the entry fee.
    const ticketPriceSol = useMemo(() => FIXED_SOL_ENTRY_FEE, []);

    return { loading, error, ticketPriceSol }; // Return only relevant values
};

// Main PickerInitModal component: orchestrates the payment and game setup flow.
interface PickerInitModalProps {
    isOpen: boolean;
    onClose: () => void;
    gameId: string; // Unique identifier for the game
    gameTitle: string; // Title of the game (e.g., "Wegen Race")
    category: string; // Category of the game (e.g., "picker")
    destinationWallet: string; // Solana public key string for the recipient of payment
    minPlayers: number; // Minimum players required (passed to OnboardingPanel)
    // Callback for successful game setup, returning the complete game configuration
    onSuccess: (gameConfig: {
        players: WegenRacePlayerType[];
        duration: number; // Race duration in minutes
        humanChoice: WegenRacePlayerType;
        betAmount: number;
        currency: 'SOL' | 'FREE'; // Updated currency types
        gameTitle: string;
        authToken: string; // Firebase ID token for authentication
        gameEntryTokenId: string; // Token received from backend for game entry validation
        paymentSignature?: string | null; // Solana transaction signature if a payment occurred
    }) => void;
    onError: (message: string) => void; // Callback for errors during the process
}

export default function PickerInitModal(props: PickerInitModalProps) {
    const {
        gameId, category, destinationWallet, onSuccess,
        onError, onClose, gameTitle, minPlayers = 2,
    } = props;

    // Solana wallet context
    const wallet = useWallet();
    const { connection } = useConnection();
    // User profile context to access free entry tokens
    const { profile, loading: loadingProfile, refreshProfile } = useProfile();
    // Firebase current user
    const { currentUser } = auth;

    // State to manage the current step of the modal flow
    const [step, setStep] = useState<"pay" | "paying" | "onboarding" | "done" | "error">("pay");
    // State to store Solana transaction signature (if payment occurs)
    const [txSig, setTxSig] = useState<string | null>(null);
    // State for displaying payment-related errors
    const [paymentError, setPaymentError] = useState<string | null>(null);
    // State to track the chosen payment method
    const [paymentMethod, setPaymentMethod] = useState<'SOL' | 'FREE' | null>(null); // Updated type
    // State to hold the list of registered users (for OnboardingPanel)
    const [ledger, setLedger] = useState<any[]>([]);
    // Loading state for fetching the user ledger
    const [loadingLedger, setLoadingLedger] = useState(false);
    // State to store the Firebase ID token for authenticating backend calls
    const [firebaseIdToken, setFirebaseIdToken] = useState<string | null>(null);
    // State to store the game entry token ID received from the backend
    const [gameEntryTokenId, setGameEntryTokenId] = useState<string | null>(null);

    // Utilize the custom hook for token pricing (only SOL now)
    const { loading: loadingPrices, error: pricingError, ticketPriceSol } = useTokenPricing();

    // State to track the number of free entry tokens the user has for this game type
    const [pickerFreeEntryTokens, setPickerFreeEntryTokens] = useState<number>(0);

    // Effect to obtain the Firebase ID token when the user is authenticated.
    // This token is crucial for authenticating requests to your backend.
    useEffect(() => {
        async function getToken() {
            if (currentUser) {
                try {
                    const token = await currentUser.getIdToken();
                    setFirebaseIdToken(token);
                } catch (error) {
                    console.error("Error getting Firebase ID token:", error);
                    setFirebaseIdToken(null);
                }
            } else {
                setFirebaseIdToken(null);
            }
        }
        // Listener for Firebase Auth state changes
        const unsubscribe = auth.onIdTokenChanged(user => {
            if (user) {
                getToken(); // Get token if user is logged in
            } else {
                setFirebaseIdToken(null); // Clear token if user logs out
            }
        });
        getToken(); // Initial token fetch
        return () => unsubscribe(); // Cleanup subscription on component unmount
    }, [currentUser]); // Dependency: re-run if currentUser object changes

    // Update the count of free entry tokens from the user's profile context.
    useEffect(() => {
        if (profile && profile.freeEntryTokens) {
            setPickerFreeEntryTokens(profile.freeEntryTokens.pickerTokens || 0);
        }
    }, [profile]); // Dependency: re-run if profile changes

    // Fetch the user ledger (list of registered users) when transitioning to the 'onboarding' step.
    useEffect(() => {
        if (step === "onboarding") fetchLedger();
    }, [step]); // Dependency: re-run when `step` changes

    // Asynchronously fetches the list of registered usernames/wallets from the backend.
    async function fetchLedger() {
        setLoadingLedger(true);
        try {
            const res = await fetch("http://localhost:4000/api/usernames"); // Endpoint to fetch registered users
            const data = await res.json();
            const usersArray = Array.isArray(data) ? data : []; // Ensure data is an array
            console.log("📋 Fetched user ledger:", usersArray);
            setLedger(usersArray);
        } catch (err) {
            console.error("Error fetching ledger:", err);
            toast.error("Problem loading users for selection.");
            setLedger([]); // Clear ledger on error
        }
        setLoadingLedger(false);
    }

    // Handles the payment process, supporting SOL or FREE entry tokens.
    async function handlePay(currency: 'SOL' | 'FREE') { // Updated currency type
        // Wallet connection check for SOL payment
        if (currency === 'SOL' && (!wallet.publicKey || !wallet.sendTransaction)) { // Explicitly check for SOL
            const msg = "Wallet not available. Please connect your wallet.";
            setPaymentError(msg);
            onError(msg);
            return;
        }

        // Firebase authentication token check
        if (!firebaseIdToken) {
            const msg = "Authentication required. Please log in to proceed.";
            setPaymentError(msg);
            onError(msg);
            toast.error(msg);
            return;
        }

        setStep("paying"); // Transition to the 'paying' state
        setPaymentError(null); // Clear previous errors
        setPaymentMethod(currency); // Set the current payment method
        setGameEntryTokenId(null); // Clear any previous game entry token

        try {
            let transactionSignature: string | null = null; // To store Solana transaction signature
            let paymentAmountForBackend: number = 0; // Amount to report to backend
            let paymentCurrencyForBackend: 'SOL' | 'FREE' = currency; // Currency to report to backend

            // Logic for 'FREE' entry token
            if (currency === 'FREE') {
                if (pickerFreeEntryTokens <= 0) {
                    throw new Error("No Degen Gaming Picker Free Entry Tokens available.");
                }

                console.log("Attempting to generate game entry token using free entry...");
                // Call backend API to use a free entry token and generate a game entry token
                const response = await fetch('http://localhost:4000/api/game-sessions/generate-entry-token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${firebaseIdToken}`, // Authenticate with Firebase ID token
                    },
                    body: JSON.stringify({
                        gameType: category.toLowerCase(), // e.g., 'picker'
                        gameId: gameId,
                        betAmount: 0, // Free entry, so bet amount is 0
                        currency: 'FREE' // Indicate free entry to backend
                    }),
                });

                const data = await response.json();

                if (!response.ok || !data.gameEntryTokenId) { // Check for success and token ID
                    throw new Error(data.message || "Failed to consume free entry token on the server.");
                }

                toast.success(data.message || "Free entry token used successfully!");
                await refreshProfile(); // Refresh profile to reflect consumed token
                setGameEntryTokenId(data.gameEntryTokenId); // Store the received game entry token
                setStep("onboarding"); // Move to player selection
                return; // Exit function as free entry path is complete
            }
                        // Logic for SOL payment
            paymentAmountForBackend = ticketPriceSol;
            paymentCurrencyForBackend = 'SOL'; // Explicitly set to SOL

            if (ticketPriceSol <= 0 || isNaN(ticketPriceSol)) {
                throw new Error("Invalid SOL amount for payment.");
            }

            const tx = new Transaction();
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
            tx.recentBlockhash = blockhash;
            tx.lastValidBlockHeight = lastValidBlockHeight;
            tx.feePayer = wallet.publicKey!; // Assert publicKey is not null for SOL payments

            tx.add(
                SystemProgram.transfer({
                    fromPubkey: wallet.publicKey!,
                    toPubkey: new PublicKey(destinationWallet),
                    lamports: Math.ceil(ticketPriceSol * 1e9) // Convert SOL to lamports
                })
            );

            // Send and confirm the Solana transaction
            transactionSignature = await wallet.sendTransaction(tx, connection);
            // Wait for confirmation to ensure transaction is processed
            const confirmation = await connection.confirmTransaction({
                signature: transactionSignature,
                blockhash: blockhash,
                lastValidBlockHeight: lastValidBlockHeight,
            }, "confirmed");

            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${confirmation.value.err.toString()}`);
            }

            setTxSig(transactionSignature); // Store the successful transaction signature
            toast.success("Payment successful on Solana!");

            // After successful Solana payment, call backend to issue game entry token
            console.log("Solana payment confirmed. Now generating game entry token...");
            const generatePaidEntryTokenResponse = await fetch('http://localhost:4000/api/game-sessions/generate-entry-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${firebaseIdToken}`,
                },
                body: JSON.stringify({
                    gameType: category.toLowerCase(),
                    gameId: gameId,
                    betAmount: paymentAmountForBackend,
                    currency: paymentCurrencyForBackend, // This will be 'SOL'
                    paymentTxId: transactionSignature, // Link to the Solana transaction
                }),
            });

            const generatePaidEntryTokenData = await generatePaidEntryTokenResponse.json();
            if (!generatePaidEntryTokenResponse.ok || !generatePaidEntryTokenData.gameEntryTokenId) {
                // If token generation fails AFTER Solana payment, it's a critical error
                throw new Error(generatePaidEntryTokenData.message || 'Failed to generate game entry token after successful payment. Contact support with transaction ID: ' + transactionSignature);
            }

            setGameEntryTokenId(generatePaidEntryTokenData.gameEntryTokenId); // Store the received game entry token
            setStep("onboarding"); // Move to player selection

        } catch (err: any) {
            console.error("Payment error:", err);
            let msg = err?.message || "Transaction failed. Please check your balance and try again.";
            // User-friendly error messages for common Solana/wallet errors
            if (msg.includes("insufficient funds")) {
                msg = "Insufficient funds. Please check your wallet balance.";
            } else if (msg.includes("user rejected transaction")) {
                msg = "Transaction cancelled by user.";
            }
            setStep("error"); // Transition to error state
            setPaymentError(msg); // Set the error message
            onError(msg); // Propagate error to parent
        }
    }

    // Callback function executed when the OnboardingPanel finishes setting up the game parameters.
    const handleOnboardingComplete = useCallback((players: WegenRacePlayerType[], raceDuration: number, playerChoice: WegenRacePlayerType) => {
        // Basic validation for the received parameters
        if (!Array.isArray(players) || players.length === 0) {
            toast.error("No players selected.");
            return;
        }
        if (!raceDuration || raceDuration <= 0) {
            toast.error("Invalid race duration.");
            return;
        }
        if (!playerChoice) {
            toast.error("No player choice selected.");
            return;
        }
        // Critical: Ensure Firebase ID token and game entry token are present
        if (!firebaseIdToken) {
            toast.error("Authentication token missing. Please try again or refresh.");
            onError("Authentication token missing.");
            return;
        }
        if (!gameEntryTokenId) {
            toast.error("Game entry token missing. Please re-initiate payment or free entry.");
            onError("Game entry token missing.");
            return;
        }

        // Format players to ensure consistency with `WegenRacePlayerType`
        const formattedPlayers: WegenRacePlayerType[] = players.map(player => ({
            ...player,
            isHumanPlayer: player.key === playerChoice.key, // Mark human player
            avatarUrl: player.avatarUrl || '/WegenRaceAssets/G1small.png',
            name: player.username || player.name || 'Guest Player' // Ensure 'name' is always set for game consumption
        }));

        // Construct the final game configuration object.
        const gameConfig = {
            players: formattedPlayers,
            duration: raceDuration,
            humanChoice: {
                ...playerChoice, // Ensure humanChoice itself is also a valid WegenRacePlayerType
                isHumanPlayer: true,
                avatarUrl: playerChoice.avatarUrl || '/WegenRaceAssets/G1small.png',
                name: playerChoice.username || playerChoice.name || 'Guest Player'
            },
            betAmount: paymentMethod === 'SOL' ? ticketPriceSol : 0, // betAmount is ticketPriceSol for SOL, 0 for FREE
            currency: paymentMethod as 'SOL' | 'FREE', // Cast to specific union type
            paymentSignature: txSig,
            gameId: gameId,
            gameTitle: gameTitle,
            authToken: firebaseIdToken, // Pass Firebase token for game validation
            gameEntryTokenId: gameEntryTokenId, // Pass game entry token for backend validation
        };

        console.log("DEBUG: PickerInitModal: gameConfig prepared for navigation:", gameConfig);

        try {
            setStep("done"); // Transition to 'done' state (e.g., show confetti)
            onSuccess(gameConfig); // Trigger the parent's onSuccess callback to start the game
        } catch (error) {
            console.error("❌ Error initiating game:", error);
            toast.error("Failed to start game. Please try again.");
            setStep("error"); // Transition to error state
            onError("Failed to initiate game configuration.");
        }
    }, [onSuccess, onError, firebaseIdToken, gameEntryTokenId, txSig, gameId, gameTitle, paymentMethod, ticketPriceSol]); // Updated dependencies

    // Handles the modal cancellation, closing the modal.
    const handleCancel = () => {
        onClose();
    };

    // Helper function to format Solana wallet addresses for display.
    const safeWalletDisplay = (walletAddress: string) => {
        if (!walletAddress || typeof walletAddress !== 'string') return 'Invalid Address';
        if (walletAddress.length < 8) return walletAddress; // Short addresses are just displayed fully
        return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
    };

    return (
        <Modal
            isOpen={props.isOpen}
            onRequestClose={handleCancel}
            ariaHideApp={false} // Prevents issues with screen readers if not strictly necessary
            style={modalStyles}
            contentLabel="Init Game Modal"
            // Allow closing on overlay click only if not in 'paying' state
            shouldCloseOnOverlayClick={step !== "paying"}
        >
            <div className="w-full mx-auto px-6 py-6 rounded-2xl bg-gradient-to-br from-zinc-900 via-zinc-800 to-black shadow-2xl flex flex-col items-center relative min-w-[320px] border-2 border-yellow-500">
                {/* Close button, hidden when payment is in progress */}
                {step !== "paying" && (
                    <button className="absolute right-4 top-4 text-gray-400 text-2xl font-bold hover:text-yellow-200 z-10" onClick={handleCancel}>×</button>
                )}
                <h2 className="text-3xl font-extrabold mb-2 text-yellow-300 text-center font-orbitron">🎮 Play {gameTitle || "Game"}</h2>
                <div className="mb-2 text-xs text-purple-300 uppercase font-semibold tracking-widest">{category}</div>

                {/* Payment Step: User chooses payment method */}
                {step === "pay" && (
                    <div className="w-full flex flex-col items-center gap-3 mt-3">
                        {loadingProfile ? (
                            <div className="text-sm text-yellow-200 animate-pulse">Loading token balance…</div>
                        ) : (
                            <div className="text-base text-white font-medium">
                                Available <span className="font-bold text-yellow-300">Degen Gaming Picker Free Entry Tokens</span>: <span className="text-lime-300">{pickerFreeEntryTokens}</span>
                            </div>
                        )}
                        <div className="text-lg text-white font-medium">
                            Entry Fee: <span className="font-bold text-lime-300">{FIXED_SOL_ENTRY_FEE.toFixed(2)} SOL</span>
                        </div>
                        <div className="text-xs text-gray-400 mb-2 text-center">
                            To: <span className="font-mono text-slate-300">{safeWalletDisplay(destinationWallet)}</span>
                        </div>
                        {/* Display payment-related errors */}
                        {paymentError && <div className="bg-red-800 w-full rounded py-2 px-3 mb-1 text-center text-red-200 text-xs font-semibold shadow">{paymentError}</div>}
                        {/* Display pricing-related errors/warnings */}
                        {pricingError && <div className="bg-orange-800 w-full rounded py-2 px-3 mb-1 text-center text-orange-200 text-xs font-semibold shadow">{pricingError}</div>}

                        {loadingPrices ? (
                            <div className="flex items-center justify-center gap-2 py-3 text-yellow-200 animate-pulse">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                <span>Fetching latest prices...</span>
                            </div>
                        ) : (
                            <div className="w-full space-y-3">
                                <button
                                    className="w-full py-3 rounded-lg bg-gradient-to-r from-green-500 to-lime-500 text-white text-lg font-bold font-orbitron shadow-lg hover:scale-105 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                                    onClick={() => handlePay('SOL')} disabled={step === "paying" || ticketPriceSol <= 0}>
                                    Pay {ticketPriceSol.toFixed(2)} SOL
                                </button>

                                {/* "Use Free Tokens" button, enabled only if tokens > 0 */}
                                <button
                                    className={`w-full py-3 rounded-lg bg-gradient-to-r from-sky-500 to-blue-500 text-white text-lg font-bold font-orbitron shadow-lg transition-transform ${pickerFreeEntryTokens > 0 && step !== "paying" ? 'hover:scale-105' : 'opacity-50 cursor-not-allowed'}`}
                                    onClick={() => handlePay('FREE')}
                                    disabled={step === "paying" || pickerFreeEntryTokens <= 0}
                                >
                                    Use Free Token! ({pickerFreeEntryTokens} available)
                                </button>
                            </div>
                        )}
                        <button className="w-full py-2 mt-2 rounded-lg bg-gray-700 text-gray-200 font-bold hover:bg-gray-600" onClick={handleCancel}>Cancel</button>
                    </div>
                )}

                {/* Payment Processing Step: Shows loading animation while payment is in progress */}
                {step === "paying" && (
                    <div className="w-full py-9 flex flex-col items-center">
                        <LottiePlayer src="/assets/lottie/loading-spinner.json" autoplay loop style={{ width: 68, height: 68 }} />
                        {paymentMethod === 'FREE' ? (
                            <p className="text-base text-yellow-200 text-center animate-pulse font-medium">Using free tokens…</p>
                        ) : (
                            <p className="text-base text-yellow-200 text-center animate-pulse font-medium">Waiting for wallet confirmation…</p>
                        )}
                        {paymentMethod === 'FREE' ? (
                            <p className="text-xs text-gray-400 text-center">Updating your token balance…</p>
                        ) : (
                            <p className="text-xs text-gray-400 text-center">Please approve the transaction in your wallet.</p>
                        )}
                    </div>
                )}

                {/* Onboarding Step: User selects players and race duration */}
                {step === "onboarding" && (
                    <div className="w-full mt-4">
                        {loadingLedger ? (
                            <div className="flex flex-col items-center py-8">
                                <LottiePlayer src="/assets/lottie/loading-spinner.json" autoplay loop style={{ width: 54, height: 54 }} />
                                <span className="mt-2 text-yellow-200 animate-pulse">Loading player list…</span>
                            </div>
                        ) : (
                            <OnboardingPanel
                                ledger={ledger}
                                minPlayers={minPlayers}
                                onComplete={handleOnboardingComplete}
                                onCancel={handleCancel}
                            />
                        )}
                    </div>
                )}

                {/* Game Ready Step: Short celebratory screen before game starts */}
                {step === "done" && (
                    <div className="w-full py-8 flex flex-col items-center">
                        <LottiePlayer src="/assets/lottie/confetti.json" autoplay loop={false} style={{ width: 250, height: 250, position: "absolute", top: -50, left: "50%", transform: "translateX(-50%)" }} />
                        <div className="mt-24 text-green-300 font-orbitron font-black text-2xl text-center animate-pulse">GET READY!</div>
                        <p className="text-white text-center mt-2">The race is about to begin...</p>
                    </div>
                )}

                {/* Error Step: Displays payment errors and allows retrying or cancelling */}
                {step === "error" && (
                    <div className="w-full py-9 flex flex-col items-center">
                        <span className="text-4xl mb-2 text-red-400">❌</span>
                        <p className="font-bold text-red-300 text-center text-lg">Payment Failed</p>
                        <p className="mb-4 text-gray-300 text-sm text-center px-4 break-words">Error: {paymentError}</p>
                        <button className="w-full py-2 mb-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-bold shadow" onClick={() => setStep("pay")}>Try Again</button>
                        <button className="w-full py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm" onClick={handleCancel}>Cancel</button>
                    </div>
                )}
            </div>
        </Modal>
    );
}