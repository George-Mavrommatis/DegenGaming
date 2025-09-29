import React, { useState, useEffect } from "react";
import Modal from "react-modal";
import { toast } from "react-toastify";
import { useProfile } from "../../context/ProfileContext";
import { api } from '../../services/api';
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

const FONT_FAMILY = "'WegensFont', Orbitron, Arial, sans-serif";

const modalStyles = {
  overlay: { backgroundColor: "rgba(10, 10, 10, 0.90)", zIndex: 1000 },
  content: {
    borderRadius: "32px",
    border: "2px solid #FFD700",
    background: "none",
    padding: 0,
    overflow: "visible",
    top: "50%", left: "50%", right: "auto", bottom: "auto",
    marginRight: "-50%",
    transform: "translate(-50%, -50%)",
    minWidth: 720,
    maxWidth: 1000,
    minHeight: 440, maxHeight: "98vh",
    boxShadow: "0 8px 64px 0 rgba(0,0,0,0.9)",
    fontFamily: FONT_FAMILY
  },
};

export default function ArcadeInitModal(props: any) {
  const {
    isOpen, gameId, category, onSuccess, onError, onClose, gameTitle
  } = props;

  const { profile, refreshProfile, firebaseAuthToken } = useProfile();
  const [step, setStep] = useState<"pay" | "paying" | "done" | "error">("pay");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'GGCOIN' | null>(null);
  const [playCost, setPlayCost] = useState<number | null>(null);

  // Fetch playCost from Firestore (per game)
  useEffect(() => {
    async function fetchPlayCost() {
      if (!gameId) return setPlayCost(null);
      try {
        const gameDoc = await getDoc(doc(db, "games", gameId));
        if (gameDoc.exists()) {
          setPlayCost(gameDoc.data().playCost ?? null);
        } else {
          setPlayCost(null);
        }
      } catch (err) {
        setPlayCost(null);
      }
    }
    fetchPlayCost();
  }, [gameId]);

  // --- PAYMENT HANDLER ---
  async function handlePayGGCoin() {
    setPaymentMethod("GGCOIN");
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
      if (!profile || playCost == null) throw new Error("Could not fetch GG Coin balance or play cost.");
      if ((profile.coins?.gg ?? 0) < playCost) throw new Error("Insufficient GG Coins.");

      // Deduct GG Coins via backend API
      await api.post(`/games/${gameId}/pay`, { amount: playCost }, {
        headers: { Authorization: `Bearer ${firebaseAuthToken}` }
      });
      await refreshProfile();
      setStep("done");
      toast.success("Payment successful with GG Coins!");
      onSuccess({ paid: true });
      return;
    } catch (err: any) {
      let msg = err?.message || "Transaction failed. Please check your balance and try again.";
      setStep("error");
      setPaymentError(msg);
      onError(msg);
    }
  }

  const handleCancel = () => onClose();

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={handleCancel}
      ariaHideApp={false}
      style={modalStyles}
      contentLabel="Arcade Init Modal"
      shouldCloseOnOverlayClick={step !== "paying"}
    >
      <div
        className="w-full mx-auto px-12 py-12 rounded-3xl bg-gradient-to-br from-zinc-900 via-zinc-800 to-black shadow-2xl flex flex-col items-center relative min-w-[720px] max-w-[1000px] border-2 border-yellow-400"
        style={{ minWidth: 720, fontFamily: FONT_FAMILY }}
      >
        {step !== "paying" && (
          <button className="absolute right-8 top-8 text-gray-400 text-3xl font-bold hover:text-yellow-200 z-10" onClick={handleCancel}>×</button>
        )}
        <h2 className="text-5xl font-extrabold mb-4 text-yellow-300 text-center font-orbitron flex items-center gap-4">
          <span role="img" aria-label="controller">🎮</span>
          {`PLAY ${gameTitle?.toUpperCase() || "GAME"}`}
        </h2>
        <div className="mb-4 text-lg text-purple-300 uppercase font-semibold tracking-widest">{category}</div>
        {step === "pay" && (
          <div className="w-full flex flex-col items-center gap-6 mt-6">
            <div className="text-2xl text-white font-bold">
              Entry Fee:{" "}
              <span className="font-black text-yellow-400 drop-shadow-lg">
                {playCost !== null ? playCost : <span className="text-gray-400">...</span>} GG COINS
              </span>
            </div>
            <div className="text-2xl text-white font-bold">
              Your GG Coins:{" "}
              <span className="font-black text-lime-400 drop-shadow-lg">{profile?.coins?.gg ?? 0}</span>
            </div>
            {paymentError && (
              <div className="bg-red-800 w-full rounded py-3 px-4 mb-2 text-center text-red-200 text-xl font-semibold shadow">{paymentError}</div>
            )}
            <div className="w-full space-y-4 mt-4">
              <button
                className={`w-full py-5 rounded-xl bg-gradient-to-r from-yellow-400 to-orange-400 text-white text-2xl font-extrabold font-orbitron shadow-xl hover:scale-105 transition-transform`}
                onClick={handlePayGGCoin}
                disabled={step === "paying" || playCost == null || (profile?.coins?.gg ?? 0) < playCost}
              >
                Pay {playCost ?? "…"} GG COINS
              </button>
            </div>
            <button className="w-full py-3 mt-6 rounded-xl bg-gray-700 text-gray-100 font-extrabold text-xl hover:bg-gray-600" onClick={handleCancel}>Cancel</button>
          </div>
        )}
        {step === "paying" && (
          <div className="w-full py-16 flex flex-col items-center">
            <div className="w-12 h-12 border-4 border-t-transparent border-yellow-400 border-solid rounded-full animate-spin mb-8" />
            <p className="text-2xl text-yellow-200 text-center animate-pulse font-bold">
              Processing GG Coin payment…
            </p>
            <p className="text-lg text-gray-400 text-center mt-4">
              Please wait for confirmation.
            </p>
          </div>
        )}
        {step === "done" && (
          <div className="w-full py-16 flex flex-col items-center">
            <span className="text-6xl mb-4 text-yellow-400 animate-bounce">🎟️</span>
            <div className="mt-2 text-green-300 font-orbitron font-black text-4xl text-center animate-pulse">
              Payment received (GG Coins)!
            </div>
            <p className="text-2xl text-white text-center mt-6">Loading your game...</p>
          </div>
        )}
        {step === "error" && (
          <div className="w-full py-16 flex flex-col items-center">
            <span className="text-6xl mb-4 text-red-400">❌</span>
            <p className="font-black text-red-300 text-center text-3xl">Game Initiation Failed</p>
            <p className="mb-6 text-gray-300 text-xl text-center px-6 break-words">Error: {paymentError}</p>
            <button className="w-full py-4 mb-3 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold text-xl shadow" onClick={() => setStep("pay")}>Try Again</button>
            <button className="w-full py-4 rounded-xl bg-gray-700 hover:bg-gray-600 text-white text-xl" onClick={handleCancel}>Cancel</button>
          </div>
        )}
      </div>
    </Modal>
  );
}