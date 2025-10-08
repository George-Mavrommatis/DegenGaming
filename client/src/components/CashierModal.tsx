import React, { useEffect, useMemo, useState } from "react";
import Modal from "react-modal";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { toast } from "react-toastify";
import { api } from "../services/api";
import { useProfile } from "../context/ProfileContext";

type Tab = "deposit" | "withdraw";

interface CashierModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: Tab;
  platformSolAddress?: string; // default from .env or hardcoded
}

const INT_ONLY = /^[0-9]+$/;

export default function CashierModal({
  isOpen,
  onClose,
  defaultTab = "deposit",
  platformSolAddress = import.meta.env.VITE_PLATFORM_WALLET_PUBLIC_KEY || "4TA49YPJRYbQF5riagHj3DSzDeMek9fHnXChQpgnKkzy",
}: CashierModalProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { profile, refreshProfile } = useProfile();

  const [tab, setTab] = useState<Tab>(defaultTab);
  const [amountStr, setAmountStr] = useState("10"); // integer GG coins
  const [solUsd, setSolUsd] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  const amount = useMemo(() => {
    if (!INT_ONLY.test(amountStr)) return 0;
    try {
      const n = parseInt(amountStr, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  }, [amountStr]);

  const computedSol = useMemo(() => {
    if (!amount || !solUsd) return 0;
    return amount / solUsd;
  }, [amount, solUsd]);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const { data } = await api.get("/api/prices");
        if (data?.solUsd) setSolUsd(Number(data.solUsd));
      } catch {
        toast.error("Failed to fetch SOL price.");
      }
    })();
  }, [isOpen]);

  function setPreset(n: number) {
    setAmountStr(String(n));
  }

  function onInput(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.trim();
    if (raw === "") return setAmountStr("");
    if (INT_ONLY.test(raw)) setAmountStr(raw);
  }

  async function handleDeposit() {
    if (!amount) return toast.warn("Enter a positive integer GG Coins amount.");
    if (!wallet.connected || !wallet.publicKey) return toast.error("Connect your wallet first.");
    if (!platformSolAddress) return toast.error("Platform SOL address not configured.");

    try {
      setLoading(true);

      // Compute lamports to send
      if (!solUsd || solUsd <= 0) throw new Error("Invalid SOL price.");
      const lamports = Math.ceil((amount / solUsd) * LAMPORTS_PER_SOL);

      const toPubkey = new PublicKey(platformSolAddress);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey!,
          toPubkey,
          lamports,
        })
      );
      tx.feePayer = wallet.publicKey!;
      const { blockhash } = await connection.getLatestBlockhash("finalized");
      tx.recentBlockhash = blockhash;

      const signature = await wallet.sendTransaction(tx, connection);
      await connection.confirmTransaction(signature, "confirmed");

      // Notify backend to credit integer GG (server computes from tx)
      const resp = await api.post("/cashier/deposit", { txSignature: signature });
      if (resp.data?.success) {
        toast.success(`Deposited ${amount} GG Coins (tx: ${signature.slice(0, 8)}...)`);
        await refreshProfile?.();
        onClose();
      } else {
        throw new Error(resp.data?.message || "Deposit failed");
      }
    } catch (e: any) {
      console.error("Deposit error:", e);
      toast.error(e?.message || "Deposit failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleWithdraw() {
    if (!amount) return toast.warn("Enter a positive integer GG Coins amount.");
    if (!wallet.connected || !wallet.publicKey) return toast.error("Connect your wallet first.");
    const ggBalance = Number(profile?.coins?.gg ?? 0);
    if (amount > ggBalance) return toast.error("Insufficient GG Coins.");

    try {
      setLoading(true);
      // Server will send SOL to the connected wallet and debit integer GG
      const resp = await api.post("/cashier/withdraw", {
        ggAmount: amount,
        destinationWallet: wallet.publicKey!.toBase58(),
      });
      if (resp.data?.success) {
        const tx = resp.data?.txSignature;
        toast.success(`Withdrew ${amount} GG Coins${tx ? ` (tx: ${tx.slice(0, 8)}...)` : ""}`);
        await refreshProfile?.();
        onClose();
      } else {
        throw new Error(resp.data?.message || "Withdraw failed");
      }
    } catch (e: any) {
      console.error("Withdraw error:", e);
      toast.error(e?.message || "Withdraw failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={() => !loading && onClose()}
      style={{
        overlay: { background: "rgba(0,0,0,0.7)", zIndex: 10000 },
        content: { inset: "auto", margin: "auto", maxWidth: 480, borderRadius: 16, padding: 0, background: "transparent" },
      }}
      contentLabel="Cashier"
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden text-white">
        {/* Header / Tabs */}
        <div className="flex">
          <button
            className={`flex-1 py-3 font-bold ${tab === "deposit" ? "bg-yellow-600" : "bg-zinc-800 hover:bg-zinc-700"}`}
            onClick={() => setTab("deposit")}
            disabled={loading}
          >
            Deposit
          </button>
          <button
            className={`flex-1 py-3 font-bold ${tab === "withdraw" ? "bg-yellow-600" : "bg-zinc-800 hover:bg-zinc-700"}`}
            onClick={() => setTab("withdraw")}
            disabled={loading}
          >
            Withdraw
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div className="text-sm text-zinc-300">
            1 GG Coin = $1. Enter an integer amount of GG Coins.
          </div>

          <div className="flex items-center gap-2">
            <input
              value={amountStr}
              onChange={onInput}
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Amount (integer)"
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-yellow-500"
              disabled={loading}
            />
            <div className="flex gap-1">
              {[10, 25, 50, 100].map(n => (
                <button
                  key={n}
                  className="px-3 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg"
                  onClick={() => setPreset(n)}
                  disabled={loading}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="text-xs text-zinc-400 space-y-1">
            <div>SOL price: {solUsd ? `$${solUsd.toFixed(2)}` : "…"}</div>
            {tab === "deposit" && (
              <div>
                Estimated SOL to send: {solUsd ? `${computedSol.toFixed(6)} SOL` : "…"}
              </div>
            )}
            <div>Your wallet: {wallet.publicKey?.toBase58() || "Not connected"}</div>
            {tab === "deposit" && (
              <div>Platform wallet: {platformSolAddress}</div>
            )}
            <div>Your GG balance: {Number(profile?.coins?.gg ?? 0)}</div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              className="flex-1 py-3 rounded-lg bg-zinc-700 hover:bg-zinc-600"
              onClick={() => !loading && onClose()}
              disabled={loading}
            >
              Cancel
            </button>
            {tab === "deposit" ? (
              <button
                className="flex-1 py-3 rounded-lg bg-yellow-600 hover:bg-yellow-500 font-bold"
                onClick={handleDeposit}
                disabled={loading || !amount || !solUsd}
              >
                {loading ? "Processing…" : "Deposit"}
              </button>
            ) : (
              <button
                className="flex-1 py-3 rounded-lg bg-yellow-600 hover:bg-yellow-500 font-bold"
                onClick={handleWithdraw}
                disabled={loading || !amount}
              >
                {loading ? "Processing…" : "Withdraw"}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}