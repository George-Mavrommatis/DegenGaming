import React, { useState, useMemo, useEffect, useCallback } from "react";
import Modal from "react-modal";
import { toast } from "react-toastify";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, Connection } from "@solana/web3.js";
import { Player as LottiePlayer } from "@lottiefiles/react-lottie-player";
import { useProfile } from "../../context/ProfileContext";
import { api } from '../../services/api';

// --- CONSTANTS ---
const FIXED_SOL_ENTRY_FEE = 0.01;

const modalStyles = {
  overlay: { backgroundColor: "rgba(10, 10, 10, 0.90)", zIndex: 1000 },
  content: {
    borderRadius: "18px",
    border: "none",
    background: "none",
    padding: 0,
    overflow: "visible",
    top: "50%", left: "50%", right: "auto", bottom: "auto",
    marginRight: "-50%",
    transform: "translate(-50%, -50%)",
    minWidth: 320, maxWidth: 420, minHeight: 200, maxHeight: "95vh",
    boxShadow: "0 4px 48px 0 rgba(0,0,0,0.7)",
  },
};

export interface PickerPlayer {
    key: string;
    name: string;
    username?: string;
    avatarUrl?: string;
    wallet?: string;
    isHumanPlayer?: boolean;
    isGuest?: boolean;
}

export interface PickerGameConfig {
    players: PickerPlayer[];
    duration: number;
    humanChoice: PickerPlayer;
    betAmount: number;
    currency: 'SOL' | 'FREE';
    gameTitle: string;
    authToken: string;
    gameType: string;
    paymentSignature?: string;
    gameEntryTokenId?: string;
    // ...add new fields for future games here
}

interface OnboardingPanelProps {
    ledger: any[];
    minPlayers: number;
    onComplete: (players: PickerPlayer[], raceDuration: number, playerChoice: PickerPlayer) => void;
    onCancel: () => void;
}

// --- ONBOARDING PANEL ---
function OnboardingPanel({ ledger, minPlayers, onComplete, onCancel }: OnboardingPanelProps) {
    const [selectedUsers, setSelectedUsers] = useState<PickerPlayer[]>([]);
    const [search, setSearch] = useState("");
    const [raceDuration, setRaceDuration] = useState<number>(2);
    const [humanPlayerChoice, setHumanPlayerChoice] = useState<PickerPlayer | null>(null);
    const { user } = useProfile();

    const timeOptions = [
        { value: 1, label: "1 Min" }, { value: 2, label: "2 Mins" },
        { value: 3, label: "3 Mins" }, { value: 4, label: "4 Mins" },
        { value: 5, label: "5 Mins" }, { value: 8, label: "8 Mins" },
        { value: 15, label: "15 Mins" }, { value: 30, label: "30 Mins" }
    ];

    // Add current user as default/human pick
 

    const filteredLedger = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return [];
        const safeLedger = Array.isArray(ledger) ? ledger : [];
        if (safeLedger.length === 0) return [];
        return safeLedger.filter(u =>
            ((u.username && u.username.toLowerCase().includes(query)) ||
             (u.wallet && u.wallet.toLowerCase().includes(query))) &&
            !selectedUsers.some(su =>
                (su.key === (u.key || u.wallet || u.uid)) ||
                (su.username && u.username && su.username.toLowerCase() === u.username.toLowerCase()) ||
                ((su as any).wallet && (u as any).wallet && (su as any).wallet.toLowerCase() === (u as any).wallet.toLowerCase())
            )
        );
    }, [search, ledger, selectedUsers]);

    const addUser = (user: any) => {
        const userWithKey: PickerPlayer = {
            key: user.key || user.wallet || user.uid || `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            name: user.username || user.name || 'Guest Player',
            username: user.username || user.name,
            avatarUrl: user.avatarUrl || '/WegenRaceAssets/G1small.png',
            isHumanPlayer: false,
        };
        setSelectedUsers(prev => [...prev, userWithKey]);
        if (!humanPlayerChoice) setHumanPlayerChoice(userWithKey);
        setSearch("");
    };

    const tryAdd = (val: string) => {
        const trimmedVal = val.trim();
        if (!trimmedVal) return;
        if (selectedUsers.some(su => (su.username || su.name)?.toLowerCase() === trimmedVal.toLowerCase() || (su as any).wallet?.toLowerCase() === trimmedVal.toLowerCase())) {
            toast.info("This player is already in the race.");
            return;
        }
        const safeLedger = Array.isArray(ledger) ? ledger : [];
        const userFound = safeLedger.find(u =>
            (u.username?.toLowerCase() === trimmedVal.toLowerCase() || u.wallet?.toLowerCase() === trimmedVal.toLowerCase())
        );
        if (userFound) addUser(userFound);
        else {
            const guestPlayer: PickerPlayer = {
                key: `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                name: trimmedVal,
                username: trimmedVal,
                avatarUrl: '/WegenRaceAssets/G1small.png',
                isHumanPlayer: false,
            };
            addUser(guestPlayer);
        }
    };

    const removeAt = (idx: number) => {
        const removedUser = selectedUsers[idx];
        setSelectedUsers(prev => {
            const newUsers = prev.filter((_, i) => i !== idx);
            if (humanPlayerChoice?.key === removedUser?.key) {
                setHumanPlayerChoice(newUsers.length > 0 ? newUsers[0] : null);
            }
            return newUsers;
        });
    };

    const canStartRace = selectedUsers.length >= minPlayers && raceDuration > 0 && humanPlayerChoice !== null;

    return (
        <div className="max-w-md w-full m-auto text-white">
            <h2 className="text-yellow-300 text-center font-bold text-xl mb-4">Set Up The Race</h2>
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
                {Array.isArray(filteredLedger) && filteredLedger.length > 0 && (
                    <div className="absolute w-full bg-slate-800 shadow rounded mt-1 max-h-48 overflow-y-auto z-20">
                        {filteredLedger.slice(0, 8).map((u, i) => (
                            <div key={(u as any).key || (u as any).wallet || `user-${i}`}
                                className="flex gap-2 items-center px-3 py-2 cursor-pointer hover:bg-yellow-400 hover:text-black text-zinc-200"
                                onMouseDown={() => addUser(u)}>
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
            <div className="mb-4 p-3 bg-black bg-opacity-20 rounded-lg">
                <div className="mb-2 text-zinc-300 font-semibold">Selected Players ({selectedUsers.length}):</div>
                <ul className="mb-2 space-y-2 max-h-[250px] overflow-y-auto pr-2">
                    {selectedUsers.length === 0 ? (
                        <li className="text-gray-400 italic text-sm text-center py-2">No players selected.</li>
                    ) : (
                        selectedUsers.map((u, idx) => (
                            <li key={u.key}
                                className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-all duration-200 ${humanPlayerChoice?.key === u.key ? 'bg-yellow-400 text-black scale-105 shadow-lg' : 'bg-gray-700 hover:bg-gray-600'}`}
                                onClick={() => setHumanPlayerChoice(u)}
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
                                    {(u as any).wallet && !(u.key.startsWith('guest_')) && (
                                        <div className="text-xs opacity-80 font-mono">
                                            {(u as any).wallet.length > 8 ? `${(u as any).wallet.slice(0, 4)}...${(u as any).wallet.slice(-4)}` : (u as any).wallet}
                                        </div>
                                    )}
                                    {(!u.avatarUrl || u.avatarUrl === '/WegenRaceAssets/G1small.png') && (
                                        <div className="text-xs opacity-60">🦒 Default Avatar</div>
                                    )}
                                </div>
                                <button
                                    className="ml-auto flex-shrink-0 text-xs font-bold text-red-500 hover:text-red-300 px-2 py-1 rounded bg-black bg-opacity-20"
                                    onClick={(e) => { e.stopPropagation(); removeAt(idx); }}
                                >
                                    X
                                </button>
                            </li>
                        ))
                    )}
                </ul>
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
                                ? `bg-gradient-to-r from-green-500 to-green-600 text-white scale-105 shadow-lg`
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
                                ? `bg-gradient-to-r from-green-500 to-green-600 text-white scale-105 shadow-lg`
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>
            <button
                className={`w-full px-4 py-3 text-lg font-bold rounded-lg shadow-lg border-2 transition-all duration-200 ${canStartRace
                    ? 'bg-gradient-to-r from-green-500 to-lime-400 hover:from-green-600 hover:to-lime-700 text-white border-green-400 hover:scale-105 shadow-green-400/50'
                    : 'bg-gray-600 text-gray-300 border-gray-500 cursor-not-allowed opacity-75'
                    }`}
                disabled={!canStartRace}
                onClick={() => onComplete(selectedUsers, raceDuration, humanPlayerChoice!)}
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
            <button
                className="w-full mt-3 py-2 rounded-lg bg-gray-700 text-white font-bold shadow hover:bg-gray-800 transition-colors"
                onClick={onCancel}
            >
                Cancel
            </button>
        </div>
    );
}

export default function PickerInitModal(props: any) {
    const {
        gameId, gameType, onSuccess, onError, onClose, gameTitle, minPlayers = 2,
    } = props;

    const wallet = useWallet();
    const { profile, refreshProfile, firebaseAuthToken } = useProfile();
    const [step, setStep] = useState<"pay" | "paying" | "onboarding" | "done" | "error">("pay");
    const [txSig, setTxSig] = useState<string | null>(null);
    const [paymentError, setPaymentError] = useState<string | null>(null);
    const [paymentMethod, setPaymentMethod] = useState<'SOL' | 'FREE' | null>(null);
    const [ledger, setLedger] = useState<any[]>([]);
    const [loadingLedger, setLoadingLedger] = useState(false);
    const [gameEntryTokenId, setGameEntryTokenId] = useState<string | null>(null);

    const freeEntryTokensCount = profile?.freeEntryTokens?.picker ?? 0;
    const destinationWallet = import.meta.env.VITE_PLATFORM_WALLET_PUBLIC_KEY || "4TA49YPJRYbQF5riagHj3DSzDeMek9fHnXChQpgnKkzy";
    const rpcUrl = import.meta.env.VITE_SOLANA_RPC_URL;
    const connection = useMemo(() => (!rpcUrl || typeof rpcUrl !== "string" || !rpcUrl.startsWith("http")) ? null : new Connection(rpcUrl, 'confirmed'), [rpcUrl]);

    useEffect(() => { if (step === "onboarding") fetchLedger(); }, [step]);
    async function fetchLedger() {
        setLoadingLedger(true);
        try {
            const response = await api.get("/api/usernames", {
                headers: { Authorization: `Bearer ${firebaseAuthToken}` }
            });
            setLedger(Array.isArray(response.data) ? response.data : []);
        } catch {
            toast.error("Problem loading users for selection.");
            setLedger([]);
        }
        setLoadingLedger(false);
    }

    async function createGameSession(currency: 'SOL' | 'FREE', paymentSignature?: string) {
        try {
            const result = await api.post('/api/picker/create-session', {
                gameId,
                paymentSignature: paymentSignature ?? null,
                currency,
            }, {
                headers: { Authorization: `Bearer ${firebaseAuthToken}` }
            });
            if (result?.data?.gameEntryTokenId) {
                return result.data.gameEntryTokenId;
            } else {
                throw new Error("Failed to create game session.");
            }
        } catch (err: any) {
            throw new Error(err?.response?.data?.message || err?.message || "Failed to create game session.");
        }
    }

    // --- PAYMENT HANDLER ---
    async function handlePay(currency: 'SOL' | 'FREE') {
        setPaymentMethod(currency);
        if (currency === 'SOL' && (!wallet.publicKey || !wallet.sendTransaction)) {
            setPaymentError("Wallet not available. Please connect your wallet.");
            onError("Wallet not available.");
            return;
        }
        if (!firebaseAuthToken) {
            setPaymentError("Authentication required. Please log in to proceed.");
            onError("No Firebase token.");
            toast.error("Authentication required.");
            return;
        }
        setStep("paying");
        setPaymentError(null);

        try {
            if (currency === "FREE") {
                // Only check here, do NOT consume
                if (freeEntryTokensCount <= 0) throw new Error("No Picker Free Entry Tokens available.");
                const sessionId = await createGameSession("FREE");
                setGameEntryTokenId(sessionId);
                setStep("onboarding");
                return;
            }

            // --- SOL path ---
            if (!connection) throw new Error("Solana RPC connection not available.");
            const tx = new Transaction();
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
            tx.recentBlockhash = blockhash;
            tx.lastValidBlockHeight = lastValidBlockHeight;
            tx.feePayer = wallet.publicKey!;

            tx.add(
                SystemProgram.transfer({
                    fromPubkey: wallet.publicKey!,
                    toPubkey: new PublicKey(destinationWallet),
                    lamports: Math.ceil(FIXED_SOL_ENTRY_FEE * LAMPORTS_PER_SOL)
                })
            );

            let transactionSignature = null;
            try {
                transactionSignature = await wallet.sendTransaction(tx, connection);
            } catch (walletSendErr: any) {
                if (walletSendErr?.message?.toLowerCase().includes("user rejected")) {
                    throw new Error("Transaction cancelled by user.");
                }
                throw walletSendErr;
            }

            const confirmation = await connection.confirmTransaction({
                signature: transactionSignature,
                blockhash,
                lastValidBlockHeight,
            }, "confirmed");

            if (confirmation.value.err) {
                if (confirmation.value.err.toString().toLowerCase().includes('insufficient')) {
                    throw new Error("Insufficient funds. Please check your wallet balance.");
                }
                throw new Error(`Transaction failed: ${confirmation.value.err.toString()}`);
            }

            setTxSig(transactionSignature);
            toast.success("Payment successful on Solana!");

            // Grant free picker token using /tokens/generate (protected, uses current user)
            await api.post('/tokens/generate', { tokenType: "picker" }, {
                headers: { Authorization: `Bearer ${firebaseAuthToken}` }
            });
            toast.success("1 Picker Free Entry Token granted!");
            await refreshProfile();

            // Create a game session for paid entry with paymentSignature
            const sessionId = await createGameSession("SOL", transactionSignature);
            setGameEntryTokenId(sessionId);
            setStep("onboarding");
        } catch (err: any) {
            let msg = err?.message || "Transaction failed. Please check your balance and try again.";
            if (msg.toLowerCase().includes("insufficient funds")) {
                msg = "Insufficient funds. Please check your wallet balance.";
            } else if (msg.toLowerCase().includes("user rejected transaction") || msg.toLowerCase().includes("transaction cancelled by user")) {
                msg = "Transaction cancelled by user.";
            }
            setStep("error");
            setPaymentError(msg);
            onError(msg);
        }
    }

    // --- ONBOARDING COMPLETE ---
    const handleOnboardingComplete = useCallback((
        players: PickerPlayer[], raceDuration: number, playerChoice: PickerPlayer
    ) => {
        if (!Array.isArray(players) || players.length === 0) {
            toast.error("No players selected."); return;
        }
        if (!raceDuration || raceDuration <= 0) {
            toast.error("Invalid race duration."); return;
        }
        if (!playerChoice) {
            toast.error("No player choice selected."); return;
        }
        if (!firebaseAuthToken) {
            toast.error("Authentication token missing. Please try again or refresh."); onError("Authentication token missing."); return;
        }
        if (!gameEntryTokenId) {
            toast.error("Game session token missing. Please re-initiate payment or free entry.");
            onError("Game session token missing.");
            return;
        }
        const gameConfig: PickerGameConfig = {
            players: players.map(player => ({
                ...player,
                isHumanPlayer: player.key === playerChoice.key,
                avatarUrl: player.avatarUrl || '/WegenRaceAssets/G1small.png',
                name: player.username || player.name || 'Guest Player'
            })),
            duration: raceDuration,
            humanChoice: {
                ...playerChoice,
                isHumanPlayer: true,
                avatarUrl: playerChoice.avatarUrl || '/WegenRaceAssets/G1small.png',
                name: playerChoice.username || playerChoice.name || 'Guest Player'
            },
            betAmount: paymentMethod === 'SOL' ? FIXED_SOL_ENTRY_FEE : 0,
            currency: paymentMethod as 'SOL' | 'FREE',
            gameTitle: gameTitle,
            authToken: firebaseAuthToken,
            gameType: gameType,
            paymentSignature: txSig || undefined,
            gameEntryTokenId: gameEntryTokenId,
        };
        setStep("done");
        onSuccess(gameConfig);
    }, [onSuccess, onError, firebaseAuthToken, txSig, gameTitle, paymentMethod, gameType, gameEntryTokenId]);

    const handleCancel = () => onClose();

    const safeWalletDisplay = (walletAddress: string) => {
        if (!walletAddress || typeof walletAddress !== 'string') return 'Invalid Address';
        if (walletAddress.length < 8) return walletAddress;
        return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
    };

    return (
        <Modal
            isOpen={props.isOpen}
            onRequestClose={handleCancel}
            ariaHideApp={false}
            style={modalStyles}
            contentLabel="Init Game Modal"
            shouldCloseOnOverlayClick={step !== "paying"}
        >
            <div className="w-full mx-auto px-6 py-6 rounded-2xl bg-gradient-to-br from-zinc-900 via-zinc-800 to-black shadow-2xl flex flex-col items-center relative min-w-[320px] border-2 border-yellow-500">
                {step !== "paying" && (
                    <button className="absolute right-4 top-4 text-gray-400 text-2xl font-bold hover:text-yellow-200 z-10" onClick={handleCancel}>×</button>
                )}
                <h2 className="text-3xl font-extrabold mb-2 text-yellow-300 text-center font-orbitron">🎮 Play {gameTitle || "Game"}</h2>
                <div className="mb-2 text-xs text-purple-300 uppercase font-semibold tracking-widest">{gameType}</div>
                {step === "pay" && (
                    <div className="w-full flex flex-col items-center gap-3 mt-3">
                        <div className="text-base text-white font-medium">
                            Available <span className="font-bold text-yellow-300">Degen Gaming Picker Free Entry Tokens</span>: <span className="text-lime-300">{freeEntryTokensCount}</span>
                        </div>
                        <div className="text-lg text-white font-medium">
                            Entry Fee: <span className="font-bold text-lime-300">{FIXED_SOL_ENTRY_FEE.toFixed(2)} SOL</span>
                        </div>
                        <div className="text-xs text-gray-400 mb-2 text-center">
                            To: <span className="font-mono text-slate-300">{safeWalletDisplay(destinationWallet)}</span>
                        </div>
                        {paymentError && <div className="bg-red-800 w-full rounded py-2 px-3 mb-1 text-center text-red-200 text-xs font-semibold shadow">{paymentError}</div>}
                        <div className="w-full space-y-3">
                            <button
                                className="w-full py-3 rounded-lg bg-gradient-to-r from-green-500 to-lime-500 text-white text-lg font-bold font-orbitron shadow-lg hover:scale-105 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                                onClick={() => handlePay('SOL')}
                                disabled={step === "paying" || FIXED_SOL_ENTRY_FEE <= 0}
                            >
                                Pay {FIXED_SOL_ENTRY_FEE.toFixed(2)} SOL
                            </button>
                            <button
                                className={`w-full py-3 rounded-lg bg-gradient-to-r from-sky-500 to-blue-500 text-white text-lg font-bold font-orbitron shadow-lg transition-transform ${freeEntryTokensCount > 0 && step !== "paying" ? 'hover:scale-105' : 'opacity-50 cursor-not-allowed'}`}
                                onClick={() => handlePay('FREE')}
                                disabled={step === "paying" || freeEntryTokensCount <= 0}
                            >
                                Use Free Token! ({freeEntryTokensCount} available)
                            </button>
                        </div>
                        <button className="w-full py-2 mt-2 rounded-lg bg-gray-700 text-gray-200 font-bold hover:bg-gray-600" onClick={handleCancel}>Cancel</button>
                    </div>
                )}
                {step === "paying" && (
                    <div className="w-full py-9 flex flex-col items-center">
                        <LottiePlayer src="/assets/lottie/loading-spinner.json" autoplay loop style={{ width: 68, height: 68 }} />
                        <p className="text-base text-yellow-200 text-center animate-pulse font-medium">
                            {paymentMethod === 'FREE' ? "Using free tokens…" : "Waiting for wallet confirmation…"}
                        </p>
                        <p className="text-xs text-gray-400 text-center">
                            {paymentMethod === 'FREE' ? "Updating your token balance…" : "Please approve the transaction in your wallet."}
                        </p>
                    </div>
                )}
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
                {step === "done" && (
                    <div className="w-full py-8 flex flex-col items-center">
                        <LottiePlayer src="/assets/lottie/confetti.json" autoplay loop={false} style={{ width: 250, height: 250, position: "absolute", top: -50, left: "50%", transform: "translateX(-50%)" }} />
                        <div className="mt-24 text-green-300 font-orbitron font-black text-2xl text-center animate-pulse">GET READY!</div>
                        <p className="text-white text-center mt-2">The race is about to begin...</p>
                    </div>
                )}
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