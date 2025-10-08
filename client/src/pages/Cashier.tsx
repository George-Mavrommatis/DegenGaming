import React, { useState } from "react";
import CashierModal from "../components/CashierModal";
import { useProfile } from "../context/ProfileContext";

export default function CashierPage() {
  const [open, setOpen] = useState(true);
  const { profile } = useProfile();
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <CashierModal isOpen={open} onClose={() => setOpen(false)} />
      {!open && (
        <div className="text-center text-zinc-300">
          <h1 className="text-2xl font-bold mb-4">Cashier</h1>
          <p className="mb-4">Your GG Balance: {Number(profile?.coins?.gg ?? 0)}</p>
          <button className="px-6 py-3 rounded-lg bg-yellow-600 hover:bg-yellow-500 font-bold" onClick={() => setOpen(true)}>
            Open Cashier
          </button>
        </div>
      )}
    </div>
  );
}