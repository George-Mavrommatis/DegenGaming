
import React, { useState } from "react";
const slides = [
  {
    title: " Welcome to Degen Gaming ! ",
    description: "A modern arcade in web3. Play, earn, and stand out.",
  },
    {
    title: "Your Wallet, Your Avatar",
    description: "Connect quickly, stay secure, and show off your unique style.",
  },
  {
    title: "Picker Games",
    description: "Picker games are meant to facilitate an entertaining way to pick a winner among a list of Wallets/Users/(or just Names) !",
  },
  {
    title: "Aracade Games",
    description: "Join now and take your place on the leaderboard. Compete for the TOP 5 in Leaderboards for each Arcade game for Sol prizes !",
  },
   {
    title: "Casino Games",
    description: "Join now the Degens into a Casino arcade style gaming for varying chance winning based Casino Games!",
  },
   {
    title: "PvP Games",
    description: "Duel any of your friends in platform or any online player in the platform and wager a bet with them for the fight before start and then fight in a PVP game in order to get the total pot - (-small platform fees) !!",
  },
];

export default function OnboardingCarousel({ onGetStarted }) {
  const [current, setCurrent] = useState(0);

  const next = () => setCurrent((current + 1) % slides.length);
  const prev = () => setCurrent(current === 0 ? slides.length - 1 : current - 1);

  return (
    <div className="flex flex-col items-center justify-center w-full min-h-[55vh] select-none">
      <div
        className="relative w-full max-w-4xl sm:max-w-5xl mx-auto p-12 rounded-3xl shadow-2xl"
        style={{
          background: "linear-gradient(135deg, #1a0638 70%, #a21caf 100%)",
          boxShadow: "0 0 80px 8px #a21caf99, 0 0 300px 0px #ff008099 inset",
        }}
      >
        <div aria-live="polite">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-400 via-pink-600 to-orange-400 text-center uppercase mb-4 font-[Orbitron,Montserrat,sans-serif] drop-shadow-[0_3px_15px_rgba(255,0,245,0.8)]">
            {slides[current].title}
          </h2>
          <p className="text-lg sm:text-xl text-pink-200 text-center font-medium mb-3 drop-shadow-[0_2px_6px_rgba(236,72,153,0.8)]">
            {slides[current].description}
          </p>
        </div>
        <div className="flex items-center justify-center mt-7 gap-8">
          <button
            onClick={prev}
            className="bg-gradient-to-r from-pink-700 to-orange-500 text-white font-bold px-6 py-2 rounded-lg shadow hover:from-purple-700 hover:to-pink-500 active:scale-95 transition disabled:opacity-40"
            disabled={slides.length < 2}
            aria-label="Previous slide"
          >
            Prev
          </button>
          <div className="flex gap-2">
            {slides.map((_, idx) => (
              <span
                key={idx}
                className={`w-3 h-3 rounded-full transition-all duration-300 shadow ${
                  idx === current
                    ? "bg-pink-400 scale-125 drop-shadow-[0_0_10px_purple]"
                    : "bg-zinc-800 opacity-60"
                }`}
                aria-label={`Go to slide ${idx + 1}`}
              ></span>
            ))}
          </div>
          <button
            onClick={next}
            className="bg-gradient-to-r from-orange-500 to-pink-700 text-white font-bold px-6 py-2 rounded-lg shadow hover:from-purple-700 hover:to-pink-500 active:scale-95 transition disabled:opacity-40"
            disabled={slides.length < 2}
            aria-label="Next slide"
          >
            Next
          </button>
        </div>
        {current === slides.length - 1 && (
          <div className="flex justify-center mt-8">
            <button
              onClick={onGetStarted}
              className="bg-pink-500 hover:bg-orange-500 text-white font-bold px-8 py-3 rounded-lg shadow-lg text-xl transition"
              aria-label="Get Started"
            >
              Get Started
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
