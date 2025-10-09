import React, { useState } from "react";
import CashierModal from "../components/CashierModal";
import { useProfile } from "../context/ProfileContext";

export default function CashierPage() {
  const [open, setOpen] = useState(true);
  const [defaultTab, setDefaultTab] = useState<"deposit" | "withdraw">("deposit");
  const { profile } = useProfile();

  return (
    <div className="min-h-[60vh] w-full flex flex-col items-center justify-center gap-6 px-4">
      <h1 className="text-4xl font-extrabold text-yellow-300 font-orbitron">Cashier</h1>
      <p className="text-zinc-300">Your GG Balance: {Number(profile?.coins?.gg ?? 0)}</p>

      <div className="flex gap-3">
        <button
          className="px-6 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 font-bold text-yellow-400"
          onClick={() => { setDefaultTab("deposit"); setOpen(true); }}
        >
          Buy GG Coins
        </button>
        <button
          className="px-6 py-3 rounded-lg bg-rose-500 hover:bg-rose-400 font-bold text-yellow-400"
          onClick={() => { setDefaultTab("withdraw"); setOpen(true); }}
        >
          Sell GG Coins
        </button>
      </div>

      <CashierModal
        isOpen={open}
        onClose={() => setOpen(false)}
        defaultTab={defaultTab}
      />
    </div>
  );
}