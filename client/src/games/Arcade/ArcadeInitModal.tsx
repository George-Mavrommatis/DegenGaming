import React, { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import Modal from "react-modal";

type ArcadeInitModalProps = {
  gameId: string;
  category: string;         // Lowercase! ("arcade", "picker", ...)
  ticketPriceSol: number;
  destinationWallet: string;
  onSuccess: (txSig: string) => void;
  onError: (msg: string) => void;
  onClose: () => void;
  gameTitle?: string;
};

export default function ArcadeInitModal({
  gameId,
  category,
  ticketPriceSol,
  destinationWallet,
  onSuccess,
  onError,
  onClose,
  gameTitle,
}: ArcadeInitModalProps) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const [step, setStep] = useState<"select" | "paying" | "success" | "error">("select");
  const [error, setError] = useState<string | null>(null);

  const handlePay = useCallback(async () => {
    if (!wallet.publicKey || !wallet.sendTransaction) {
      setError("Wallet is not available. Please reload or reconnect your wallet.");
      onError("Wallet not available.");
      return;
    }
    setStep("paying");
    setError(null);

    try {
      // 1. Create and sign the SOL transfer:
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: new PublicKey(destinationWallet),
          lamports: Math.floor(ticketPriceSol * 1e9),
        })
      );
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet.publicKey;

      const txSig = await wallet.sendTransaction(transaction, connection);
      await connection.confirmTransaction(txSig, "finalized");

      // 2. POST entry to backend (update pot/stats per game/category)
      const resp = await fetch('/api/platform/update-pot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId,
          category: category.toLowerCase(),  // Always lower!
          amount: ticketPriceSol,
          txSig,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || "Failed to update platform pot.");

      setStep("success");
      setTimeout(() => onSuccess(txSig), 900);
    } catch (err: any) {
      setStep("error");
      setError(err?.message || "Transaction failed");
      onError(err?.message || "Transaction failed");
    }
  }, [
    wallet, connection, onSuccess, onError,
    ticketPriceSol, destinationWallet, category, gameId
  ]);

  // Nice monospace short wallet
  const displayWallet = `${destinationWallet.slice(0, 6)}...${destinationWallet.slice(-4)}`;

  // RESPONSIVE Modal Styles
  const modalStyles = {
    overlay: {
      zIndex: 1000,
      backdropFilter: "blur(5px)",
      background: "rgba(15,14,24,0.85)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 0,
    } as React.CSSProperties,
    content: {
      position: "relative",
      width: "100%",
      maxWidth: 400,
      minWidth: 0,
      margin: "auto",
      padding: 0,
      borderRadius: 22,
      border: "none",
      background: "transparent",
      boxShadow: "none",
      inset: "unset",
      // Removes scroll bar on mobile for modal
      overflow: "visible"
    } as React.CSSProperties
  };

  return (
    <Modal
      isOpen
      onRequestClose={onClose}
      contentLabel="Arcade Game Modal"
      ariaHideApp={false}
      style={modalStyles}
      shouldCloseOnOverlayClick={step !== "paying"}
    >
      <div
        className="w-full sm:w-[370px] mx-auto
        bg-gradient-to-br from-[#19192B] via-[#2A2541] to-[#191A1C]
        rounded-2xl px-6 py-6 sm:px-8 sm:py-9 shadow-2xl
        border border-[#33265B]
        flex flex-col items-center
        relative
        "
        style={{
          minWidth: 0,
          maxWidth: 400,
          width: "95vw",
        }}
      >
        {/* Close button */}
        <button
          type="button"
          aria-label="Close"
          className="absolute right-5 top-5 text-gray-400 hover:text-purple-300 text-2xl font-bold"
          disabled={step === "paying"}
          onClick={onClose}
        >×</button>

        {/* Title */}
        <h2
          className="text-2xl sm:text-3xl font-extrabold mb-3 text-center text-yellow-300 font-orbitron drop-shadow"
        >
          🎮 {gameTitle ? `Play ${gameTitle}` : "Arcade Entry"}
        </h2>
        <div className="mb-1 text-xs text-purple-300 tracking-wider font-semibold uppercase">
          {category}
        </div>

        {step === "select" && (
          <div className="w-full flex flex-col gap-2 items-center mb-2">
            <div className="text-base sm:text-lg text-white font-medium">
              Entry Fee: <span className="font-bold text-lime-300">{ticketPriceSol} SOL</span>
            </div>
            <div className="text-xs text-gray-400 mb-2 text-center">
              Pot & leaderboard for this <span className="font-semibold">{category}</span> game will update.<br />
              <span className="block">Destination wallet: <span className="font-mono text-slate-200">{displayWallet}</span></span>
            </div>
            {error &&
              <div className="bg-red-900 w-full rounded py-2 px-3 mb-1 text-center text-red-200 text-xs font-semibold shadow">
                {error}
              </div>}
            <button
              className="w-full py-2.5 sm:py-3 rounded-lg bg-gradient-to-r from-green-500 to-lime-500 text-white text-lg font-orbitron font-bold shadow-lg
                          transition hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-green-400/50 mt-2"
              style={{ letterSpacing: '.03em' }}
              onClick={handlePay}
              disabled={step === "paying"}
            >
              Pay & Start Game
            </button>
            <button
              className="w-full py-2 rounded-lg bg-gray-800 text-gray-200 text-sm mt-2 mb-1 hover:bg-gray-700"
              onClick={onClose}
              disabled={step === "paying"}
            >Cancel</button>
          </div>
        )}

        {step === "paying" && (
          <div className="w-full flex flex-col items-center py-5">
            <div className="w-8 h-8 border-4 border-t-transparent border-yellow-400 border-solid rounded-full animate-spin mb-4" />
            <p className="mt-2 text-base text-yellow-200 text-center animate-pulse font-medium">
              Waiting for wallet confirmation...
            </p>
          </div>
        )}

        {step === "success" && (
          <div className="w-full py-5 flex flex-col items-center justify-center">
            <span className="text-4xl mb-2">🎟️</span>
            <p className="mb-1 text-green-300 font-bold text-lg">Payment received!</p>
            <p className="text-gray-200 text-sm text-center">Loading your game...</p>
          </div>
        )}

        {step === "error" && (
          <div className="w-full py-5 flex flex-col items-center">
            <span className="text-3xl mb-2 text-red-400">❌</span>
            <p className="font-bold text-red-300 mb-1 text-center">Payment failed</p>
            <p className="mb-2 text-gray-300 text-sm text-center">Error: {error}</p>
            <button
              className="w-full py-2 mb-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-bold shadow"
              onClick={() => setStep("select")}
              disabled={step === "paying"}
            >Try Again</button>
            <button
              className="w-full py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm"
              onClick={() => {
                  navigate('/games');
                }}>
                Cancel
              </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
