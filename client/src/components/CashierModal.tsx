import React, { useEffect, useMemo, useState } from "react";
import Modal from "react-modal";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { toast } from "react-toastify";
import { apiService } from "../services/api";
import { useProfile } from "../context/ProfileContext";
import { FaCoins, FaArrowDown, FaArrowUp } from "react-icons/fa";

type Tab = "deposit" | "withdraw";

interface CashierModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: Tab;
  onSuccess?: () => Promise<void> | void;
  platformSolAddress?: string;
}

const INT_ONLY = /^[0-9]+$/;

export default function CashierModal({
  isOpen,
  onClose,
  defaultTab = "deposit",
  onSuccess,
  platformSolAddress = import.meta.env.VITE_PLATFORM_WALLET_PUBLIC_KEY || "4TA49YPJRYbQF5riagHj3DSzDeMek9fHnXChQpgnKkzy",
}: CashierModalProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { profile, refreshProfile } = useProfile();

  const [tab, setTab] = useState<Tab>(defaultTab);
  const [amountStr, setAmountStr] = useState("10");
  const [solUsd, setSolUsd] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTab(defaultTab);
      setAmountStr("10");
    }
  }, [isOpen, defaultTab]);

  const amount = useMemo(() => {
    if (!INT_ONLY.test(amountStr)) return 0;
    const n = parseInt(amountStr, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountStr]);

  const computedSol = useMemo(() => {
    if (!amount || !solUsd) return 0;
    return amount / solUsd;
  }, [amount, solUsd]);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const data = await apiService.getSolPrice();
        if ((data as any)?.solUsd) setSolUsd(Number((data as any).solUsd));
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

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (["e", "E", "+", "-", ".", ","].includes(e.key)) e.preventDefault();
  }

  async function afterSuccess() {
    try {
      await refreshProfile?.();
      if (onSuccess) await onSuccess();
    } catch { /* no-op */ }
    onClose();
  }

  async function handleDeposit() {
    if (!amount) return toast.warn("Enter a positive integer GG Coins amount.");
    if (!wallet.connected || !wallet.publicKey) return toast.error("Connect your wallet first.");
    if (!platformSolAddress) return toast.error("Platform SOL address not configured.");
    if (!solUsd || solUsd <= 0) return toast.error("Invalid SOL price.");

    try {
      setLoading(true);

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

      // Pre-check fee + balance to avoid confusing failures
      let feeLamports = 5000;
      try {
        // @ts-ignore
        const msg = tx.compileMessage();
        const fee = await connection.getFeeForMessage(msg);
        if (fee?.value) feeLamports = fee.value;
      } catch {}
      const needed = lamports + feeLamports;
      const balance = await connection.getBalance(wallet.publicKey!);
      if (balance < needed) {
        const needSol = needed / LAMPORTS_PER_SOL;
        const haveSol = balance / LAMPORTS_PER_SOL;
        setLoading(false);
        return toast.error(`Insufficient SOL to buy ${amount} GG. Need ~${needSol.toFixed(6)} SOL (have ${haveSol.toFixed(6)}).`);
      }

      const signature = await wallet.sendTransaction(tx, connection);
      await connection.confirmTransaction(signature, "confirmed");

      const resp = await apiService.cashierDeposit({ txSignature: signature });
      if ((resp as any)?.success) {
        toast.success(`Bought ${amount} GG Coins (tx: ${signature.slice(0, 8)}...)`);
        await afterSuccess();
      } else {
        throw new Error((resp as any)?.message || "Buy GG Coins failed");
      }
    } catch (e: any) {
      console.error("Buy/Deposit error:", e);
      toast.error(e?.message || "Buy GG Coins failed.");
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
      const resp = await apiService.cashierWithdraw({
        ggAmount: amount,
        destinationWallet: wallet.publicKey!.toBase58(),
      });
      if ((resp as any)?.success) {
        const tx = (resp as any)?.txSignature;
        toast.success(`Sold ${amount} GG Coins${tx ? ` (tx: ${tx.slice(0, 8)}...)` : ""}`);
        await afterSuccess();
      } else {
        throw new Error((resp as any)?.message || "Sell GG Coins failed");
      }
    } catch (e: any) {
      console.error("Sell/Withdraw error:", e);
      toast.error(e?.message || "Sell GG Coins failed.");
    } finally {
      setLoading(false);
    }
  }

  const ggBalance = Number(profile?.coins?.gg ?? 0);

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={() => !loading && onClose()}
      style={{
        overlay: {
          backgroundColor: "rgba(10, 10, 14, 0.85)",
          zIndex: 10000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "12px",
        },
        content: {
          position: "static",
          inset: "auto",
          border: "none",
          background: "transparent",
          padding: 0,
          maxWidth: "min(92vw, 560px)",
          width: "100%",
        },
      }}
      ariaHideApp={false}
      contentLabel="Cashier"
    >
      <div className="rounded-2xl overflow-hidden text-zinc-100 shadow-2xl border border-zinc-700 bg-gradient-to-br from-zinc-900 via-zinc-900/90 to-black">
        {/* Header */}
        <div className="px-5 pt-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-yellow-300 font-orbitron font-extrabold tracking-wide drop-shadow">
              <FaCoins /> <span>Cashier</span>
            </div>
            <div className="text-xs text-yellow-400 font-extrabold">1 GG Coin = $1 of Sol</div>
          </div>

          {/* Tabs */}
          <div className="mt-4 grid grid-cols-2 bg-zinc-800/80 rounded-lg p-1 border border-zinc-700">
            <button
              className={`py-2 rounded-md font-bold flex items-center justify-center gap-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${
                tab === "deposit"
                  ? "bg-emerald-500 text-yellow-400 border-2 border-emerald-300 shadow-[0_0_16px_rgba(16,185,129,0.35)]"
                  : "text-zinc-200 hover:text-white"
              }`}
              onClick={() => setTab("deposit")}
              disabled={loading}
            >
              <FaArrowDown /> Buy
            </button>
            <button
              className={`py-2 rounded-md font-bold flex items-center justify-center gap-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 ${
                tab === "withdraw"
                  ? "bg-rose-500 text-yellow-400 border-2 border-rose-300 shadow-[0_0_16px_rgba(244,63,94,0.35)]"
                  : "text-zinc-200 hover:text-white"
              }`}
              onClick={() => setTab("withdraw")}
              disabled={loading}
            >
              <FaArrowUp /> Sell
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div className="text-sm text-zinc-200">
            Enter an integer amount of GG Coins.
          </div>

          <div className="flex items-center gap-2">
            <input
              value={amountStr}
              onChange={onInput}
              onKeyDown={onKeyDown}
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Amount (integer)"
              className="flex-1 bg-zinc-800/90 text-zinc-100 placeholder:text-zinc-500 border border-zinc-700 rounded-lg px-3 py-3 outline-none focus:ring-2 focus:ring-yellow-400 text-base"
              disabled={loading}
              aria-label="GG Coins amount"
            />
            <div className="flex gap-1">
              {[10, 25, 50, 100].map(n => (
                <button
                  key={n}
                  className="px-3 py-2 text-sm text-zinc-200 bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-600 rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300"
                  onClick={() => setPreset(n)}
                  disabled={loading}
                >
                  {n}
                </button>
              ))}
              {tab === "withdraw" && (
                <button
                  className="px-3 py-2 text-sm text-zinc-200 bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-600 rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300"
                  onClick={() => setAmountStr(String(Math.max(0, Math.floor(ggBalance))))}
                  disabled={loading || ggBalance <= 0}
                  title="Max GG balance"
                >
                  MAX
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-400">SOL price</span>
              <span className="text-zinc-100">{solUsd ? `$${solUsd.toFixed(2)}` : "…"}</span>
            </div>
            {tab === "deposit" && (
              <div className="flex justify-between">
                <span className="text-zinc-400">Estimated SOL to pay</span>
                <span className="text-zinc-100">{solUsd ? `${computedSol.toFixed(6)} SOL` : "…"}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-zinc-400">Your wallet</span>
              <span className="font-mono text-zinc-100 truncate max-w-[60%]">{wallet.publicKey?.toBase58() || "Not connected"}</span>
            </div>
            {tab === "deposit" && (
              <div className="flex justify-between">
                <span className="text-zinc-400">Platform wallet</span>
                <span className="font-mono text-zinc-100 truncate max-w-[60%]">{platformSolAddress}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-zinc-400">Your GG balance</span>
              <span className="text-yellow-300 font-semibold">{ggBalance}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-3">
          <button
            className="flex-1 py-3 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-100 font-semibold border border-zinc-600 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 disabled:opacity-50"
            onClick={() => !loading && onClose()}
            disabled={loading}
          >
            Cancel
          </button>
          {tab === "deposit" ? (
            <button
              className="flex-1 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-yellow-400 font-extrabold border-2 border-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.35)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50"
              onClick={handleDeposit}
              disabled={loading || !amount || !solUsd || !wallet.connected}
            >
              {loading ? "Processing…" : "Buy GG Coins"}
            </button>
          ) : (
            <button
              className="flex-1 py-3 rounded-lg bg-rose-500 hover:bg-rose-400 text-yellow-400 font-extrabold border-2 border-rose-300 shadow-[0_0_18px_rgba(244,63,94,0.35)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:opacity-50"
              onClick={handleWithdraw}
              disabled={loading || !amount || !wallet.connected}
            >
              {loading ? "Processing…" : "Sell GG Coins"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}