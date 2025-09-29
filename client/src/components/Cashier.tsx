
import React, { useState } from "react";
import { FaPlus, FaMinus, FaWallet } from "react-icons/fa";

export default function Cashier({ ggCoins }: { ggCoins: number }) {
  // Add logic for deposit, buy, spend, etc. in the future.
  const [showDeposit, setShowDeposit] = useState(false);

  return (
    <div className="mt-6 w-full">
      <div className="rounded-lg bg-gradient-to-r from-yellow-200 via-yellow-400 to-yellow-800 p-4 shadow border-2 border-yellow-400 flex flex-col items-center">
        <div className="flex items-center gap-2 mb-2">
          <FaWallet className="text-yellow-700 text-2xl" />
          <span className="font-bold text-lg text-gray-900">GG Coin Cashier</span>
        </div>
        <div className="text-xl text-black font-bold mb-2">
          GG Coins: <span className="text-yellow-700">{ggCoins}</span>
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => setShowDeposit(!showDeposit)}
            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-lg flex items-center gap-2 transition"
          >
            <FaPlus /> Deposit Coins
          </button>
          <button
            disabled
            className="bg-gray-400 text-white font-bold py-2 px-6 rounded-lg flex items-center gap-2 opacity-70 cursor-not-allowed"
            title="Coming soon"
          >
            <FaMinus /> Withdraw Coins
          </button>
        </div>
        {showDeposit && (
          <div className="w-full mt-4 bg-yellow-100 rounded-lg p-3 border border-yellow-400">
            <p className="font-semibold text-gray-800 mb-2">Deposit GG Coins (Voucher Purchase)</p>
            <input
              type="number"
              min={1}
              className="w-full p-2 rounded border border-yellow-400 mb-2"
              placeholder="Enter amount to deposit"
            />
            <button
              className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded transition"
            >
              Confirm Deposit
            </button>
            <p className="text-xs text-gray-600 mt-1">*GG Coins are off-chain platform tokens. Deposits will be credited to your account instantly.</p>
          </div>
        )}
      </div>
    </div>
  );
}