import React, { useState } from "react";
import CashierModal from "../components/CashierModal";
import { useProfile } from "../context/ProfileContext";

export default function CashierPage() {
  const [open, setOpen] = useState(true);
  const [defaultTab, setDefaultTab] = useState<"deposit" | "withdraw">("deposit");
  const { profile } = useProfile();

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6">
      <h1 className="text-3xl font-bold text-yellow-300 font-orbitron">Cashier</h1>
      <p className="text-zinc-300">Your GG Balance: {Number(profile?.coins?.gg ?? 0)}</p>

      <div className="flex gap-3">
        <button
          className="px-6 py-3 rounded-lg bg-yellow-600 hover:bg-yellow-500 font-bold"
          onClick={() => { setDefaultTab("deposit"); setOpen(true); }}
        >
          Deposit
        </button>
        <button
          className="px-6 py-3 rounded-lg bg-zinc-700 hover:bg-zinc-600 font-bold"
          onClick={() => { setDefaultTab("withdraw"); setOpen(true); }}
        >
          Withdraw
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