import React, { useState } from "react";
import Modal from "react-modal";
import { toast } from "react-toastify";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createTransferInstruction } from "@solana/spl-token";
import { useProfile } from "../../context/ProfileContext";
import { api } from '../../services/api';

const FIXED_SOL_ENTRY_FEE = 0.005;
const FIXED_CJT_ENTRY_FEE = 5; // You can set the CJT fee as needed
const CJT_MINT_ADDRESS = "7ztGsbEkbSzeeUgm3SwCp6hkmaJe3Gwi4zgvANKSfYML";
const FONT_FAMILY = "'WegensFont', Orbitron, Arial, sans-serif";

const modalStyles = {
  overlay: { backgroundColor: "rgba(10, 10, 10, 0.90)", zIndex: 1000 },
  content: {
    borderRadius: "20px",
    border: "none",
    background: "none",
    padding: 0,
    overflow: "visible",
    top: "50%", left: "50%", right: "auto", bottom: "auto",
    marginRight: "-50%",
    transform: "translate(-50%, -50%)",
    minWidth: 440,
    maxWidth: 660,
    minHeight: 240, maxHeight: "95vh",
    boxShadow: "0 4px 48px 0 rgba(0,0,0,0.7)",
    fontFamily: FONT_FAMILY
  },
};

export default function ArcadeInitModal(props: any) {
  const {
    isOpen, gameId, category, ticketPriceSol, destinationWallet, onSuccess, onError, onClose, gameTitle
  } = props;

  const wallet = useWallet();
  const { profile, refreshProfile, firebaseAuthToken } = useProfile();
  const [step, setStep] = useState<"pay" | "paying" | "done" | "error">("pay");
  const [txSig, setTxSig] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'SOL' | 'CJT' | 'FREE' | null>(null);

  const tokensObj = profile?.freeEntryTokens || {};
  const arcadeFreeEntryTokens = Math.max(tokensObj.arcade ?? 0, tokensObj.arcadeTokens ?? 0);

  const rpcUrl = import.meta.env.VITE_SOLANA_RPC_URL;
  const connection = (!rpcUrl || typeof rpcUrl !== "string" || !rpcUrl.startsWith("http")) ? null : new Connection(rpcUrl, 'confirmed');

  // --- PAYMENT HANDLER ---
  async function handlePay(method: 'SOL' | 'CJT' | 'FREE') {
    setPaymentMethod(method);
    setStep("paying");
    setPaymentError(null);

    if (!firebaseAuthToken) {
      setPaymentError("Authentication required. Please log in to proceed.");
      onError("No Firebase token.");
      toast.error("Authentication required.");
      setStep("error");
      return;
    }

    try {
      if (method === "FREE") {
        if (arcadeFreeEntryTokens <= 0) throw new Error("No Arcade Free Entry Tokens available.");
        // Just route, do NOT consume here; parent will consume later
        setStep("done");
        onSuccess({ paid: false, useArcadeFreeEntry: true });
        return;
      }

      // --- SOL path ---
      if (method === "SOL") {
        if (!wallet.publicKey || !wallet.sendTransaction) {
          throw new Error("Wallet not available. Please connect your wallet.");
        }
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
            lamports: Math.ceil(ticketPriceSol * LAMPORTS_PER_SOL)
          })
        );

        let transactionSignature = null;
        try {
          transactionSignature = await wallet.sendTransaction(tx, connection);
        } catch (walletSendErr: any) {
          if (walletSendErr?.message?.toLowerCase().includes("user rejected")) throw new Error("Transaction cancelled by user.");
          throw walletSendErr;
        }
        const confirmation = await connection.confirmTransaction({
          signature: transactionSignature,
          blockhash,
          lastValidBlockHeight,
        }, "confirmed");

        if (confirmation.value.err) {
          if (confirmation.value.err.toString().toLowerCase().includes('insufficient')) throw new Error("Insufficient funds. Please check your wallet balance.");
          throw new Error(`Transaction failed: ${confirmation.value.err.toString()}`);
        }

        setTxSig(transactionSignature);
        toast.success("Payment successful on Solana!");

        // Grant free arcade token as receipt
        await api.post('/tokens/generate', { tokenType: "arcade" }, {
          headers: { Authorization: `Bearer ${firebaseAuthToken}` }
        });
        toast.success("1 Arcade Free Entry Token granted!");
        await refreshProfile();

        setStep("done");
        onSuccess({ paid: true, useArcadeFreeEntry: false, txSig: transactionSignature });
        return;
      }

      // --- CJT path ---
      if (method === "CJT") {
        if (!wallet.publicKey || !wallet.sendTransaction) {
          throw new Error("Wallet not available. Please connect your wallet.");
        }
        if (!connection) throw new Error("Solana RPC connection not available.");
        // 1. Get user's CJT associated token account
        const mint = new PublicKey(CJT_MINT_ADDRESS);
        const sourceATA = await getAssociatedTokenAddress(mint, wallet.publicKey);
        const destATA = await getAssociatedTokenAddress(mint, new PublicKey(destinationWallet));

        const tx = new Transaction();
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.lastValidBlockHeight = lastValidBlockHeight;
        tx.feePayer = wallet.publicKey!;

        // Transfer CJT
        tx.add(
          createTransferInstruction(
            sourceATA,
            destATA,
            wallet.publicKey!,
            FIXED_CJT_ENTRY_FEE, // Amount in base units (assuming CJT has 0 decimals, adjust if needed)
            [],
            TOKEN_PROGRAM_ID
          )
        );

        let transactionSignature = null;
        try {
          transactionSignature = await wallet.sendTransaction(tx, connection);
        } catch (walletSendErr: any) {
          if (walletSendErr?.message?.toLowerCase().includes("user rejected")) throw new Error("Transaction cancelled by user.");
          throw walletSendErr;
        }
        const confirmation = await connection.confirmTransaction({
          signature: transactionSignature,
          blockhash,
          lastValidBlockHeight,
        }, "confirmed");

        if (confirmation.value.err) {
          if (confirmation.value.err.toString().toLowerCase().includes('insufficient')) throw new Error("Insufficient CJT. Please check your wallet balance.");
          throw new Error(`Transaction failed: ${confirmation.value.err.toString()}`);
        }

        setTxSig(transactionSignature);
        toast.success("Payment successful with CJT!");

        // Grant free arcade token as receipt
        await api.post('/tokens/generate', { tokenType: "arcade" }, {
          headers: { Authorization: `Bearer ${firebaseAuthToken}` }
        });
        toast.success("1 Arcade Free Entry Token granted!");
        await refreshProfile();

        setStep("done");
        onSuccess({ paid: true, useArcadeFreeEntry: false, txSig: transactionSignature, paidWith: "CJT" });
        return;
      }

    } catch (err: any) {
      let msg = err?.message || "Transaction failed. Please check your balance and try again.";
      if (msg.toLowerCase().includes("insufficient funds")) msg = "Insufficient funds. Please check your wallet balance.";
      else if (msg.toLowerCase().includes("insufficient cjt")) msg = "Insufficient CJT. Please check your wallet balance.";
      else if (msg.toLowerCase().includes("user rejected transaction") || msg.toLowerCase().includes("transaction cancelled by user")) msg = "Transaction cancelled by user.";
      setStep("error");
      setPaymentError(msg);
      onError(msg);
    }
  }

  const handleCancel = () => onClose();

  const safeWalletDisplay = (walletAddress: string) => {
    if (!walletAddress || typeof walletAddress !== 'string') return 'Invalid Address';
    if (walletAddress.length < 8) return walletAddress;
    return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={handleCancel}
      ariaHideApp={false}
      style={modalStyles}
      contentLabel="Arcade Init Modal"
      shouldCloseOnOverlayClick={step !== "paying"}
    >
      <div className="w-full mx-auto px-6 py-6 rounded-2xl bg-gradient-to-br from-zinc-900 via-zinc-800 to-black shadow-2xl flex flex-col items-center relative min-w-[420px] border-2 border-yellow-600"
        style={{ minWidth: 420, fontFamily: FONT_FAMILY }}>
        {step !== "paying" && (
          <button className="absolute right-4 top-4 text-gray-400 text-2xl font-bold hover:text-yellow-200 z-10" onClick={handleCancel}>×</button>
        )}
        <h2 className="text-3xl font-extrabold mb-2 text-yellow-300 text-center font-orbitron">🎮 Play {gameTitle || "Game"}</h2>
        <div className="mb-2 text-xs text-purple-300 uppercase font-semibold tracking-widest">{category}</div>
        {step === "pay" && (
          <div className="w-full flex flex-col items-center gap-3 mt-3">
            <div className="text-base text-white font-medium">
              Arcade Free Entry Tokens: <span className="text-lime-300 font-bold">{arcadeFreeEntryTokens}</span>
            </div>
            <div className="text-lg text-white font-medium">
              Entry Fee: <span className="font-bold text-lime-300">{ticketPriceSol.toFixed(3)} SOL</span> or <span className="font-bold text-blue-300">{FIXED_CJT_ENTRY_FEE} CJT</span>
            </div>
            <div className="text-xs text-gray-400 mb-2 text-center">
              To: <span className="font-mono text-slate-300">{safeWalletDisplay(destinationWallet)}</span>
            </div>
            {paymentError && <div className="bg-red-800 w-full rounded py-2 px-3 mb-1 text-center text-red-200 text-xs font-semibold shadow">{paymentError}</div>}
            <div className="w-full space-y-3">
              <button
                className="w-full py-3 rounded-lg bg-gradient-to-r from-green-500 to-lime-500 text-white text-lg font-bold font-orbitron shadow-lg hover:scale-105 transition-transform"
                onClick={() => handlePay('SOL')}
                disabled={step === "paying" || ticketPriceSol <= 0}
              >
                Pay {ticketPriceSol.toFixed(3)} SOL
              </button>
              <button
                className={`w-full py-3 rounded-lg bg-gradient-to-r from-blue-400 to-blue-600 text-white text-lg font-bold font-orbitron shadow-lg transition-transform`}
                onClick={() => handlePay('CJT')}
                disabled={step === "paying"}
              >
                Pay {FIXED_CJT_ENTRY_FEE} CJT
              </button>
              <button
                className={`w-full py-3 rounded-lg bg-gradient-to-r from-sky-500 to-blue-500 text-white text-lg font-bold font-orbitron shadow-lg transition-transform ${arcadeFreeEntryTokens > 0 ? "" : "opacity-50 cursor-not-allowed"}`}
                onClick={() => handlePay('FREE')}
                disabled={step === "paying" || arcadeFreeEntryTokens <= 0}
              >
                Use Free Token! ({arcadeFreeEntryTokens} available)
              </button>
            </div>
            <button className="w-full py-2 mt-2 rounded-lg bg-gray-700 text-gray-200 font-bold hover:bg-gray-600" onClick={handleCancel}>Cancel</button>
          </div>
        )}
        {step === "paying" && (
          <div className="w-full py-9 flex flex-col items-center">
            <div className="w-8 h-8 border-4 border-t-transparent border-yellow-400 border-solid rounded-full animate-spin mb-4" />
            <p className="text-base text-yellow-200 text-center animate-pulse font-medium">
              {paymentMethod === 'FREE' ? "Checking free token…" :
                paymentMethod === 'CJT' ? "Waiting for CJT wallet confirmation…" : "Waiting for wallet confirmation…"}
            </p>
            <p className="text-xs text-gray-400 text-center">
              {paymentMethod === 'FREE' ? "Routing to game..." : "Please approve the transaction in your wallet."}
            </p>
          </div>
        )}
        {step === "done" && (
          <div className="w-full py-8 flex flex-col items-center">
            <span className="text-5xl mb-2 text-yellow-400 animate-bounce">🎟️</span>
            <div className="mt-2 text-green-300 font-orbitron font-black text-2xl text-center animate-pulse">
              {paymentMethod === "FREE" ? "Free Entry Token Ready!" :
                paymentMethod === "CJT" ? "Payment received (CJT)!" : "Payment received (SOL)!"}
            </div>
            <p className="text-white text-center mt-2">Loading your game...</p>
          </div>
        )}
        {step === "error" && (
          <div className="w-full py-9 flex flex-col items-center">
            <span className="text-4xl mb-2 text-red-400">❌</span>
            <p className="font-bold text-red-300 text-center text-lg">Game Initiation Failed</p>
            <p className="mb-4 text-gray-300 text-sm text-center px-4 break-words">Error: {paymentError}</p>
            <button className="w-full py-2 mb-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-bold shadow" onClick={() => setStep("pay")}>Try Again</button>
            <button className="w-full py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm" onClick={handleCancel}>Cancel</button>
          </div>
        )}
      </div>
    </Modal>
  );
}