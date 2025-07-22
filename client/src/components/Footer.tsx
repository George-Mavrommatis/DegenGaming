import { FaTwitter, FaDiscord } from "react-icons/fa";

export default function Footer() {
  return (
    <footer className="w-full bg-[#18181b] py-7 select-none">
      <div className="max-w-6xl mx-auto w-full flex flex-col md:flex-row items-center justify-between gap-y-4 gap-x-6 px-3">
        {/* LOGO (left) */}
        <div className="flex items-center justify-center md:justify-end flex-1 mb-3 md:mb-0">
          <img
            src="/logo.png"
            alt="GGWEB3 logo"
            className="h-12 w-12 object-contain rounded "
            draggable={false}
          />
        </div>
        {/* CENTER */}
        <div className="text-center flex-1 mb-3 md:mb-0">
          <span className="text-zinc-400 font-semibold text-base md:text-lg whitespace-nowrap">
          Degen Gaming ©{new Date().getFullYear()}
          </span>
          <span className="text-zinc-400 font-semibold text-base md:text-lg whitespace-nowrap">
           By Wegens - Bongo Dev — All Rights Reserved.
          </span>
        </div>
        {/* ICONS (right) */}
        <div className="flex flex-1 items-center justify-center md:justify-start gap-5">
          <a
            href="https://discord.gg/yourinvite"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Discord"
            className="text-zinc-300 hover:text-[#5865F2] transition rounded-full flex"
            style={{ fontSize: 36, padding: 6 }}
          >
            <FaDiscord />
          </a>
          <a
            href="https://twitter.com/yourhandle"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Twitter"
            className="text-zinc-300 hover:text-[#1DA1F2] transition rounded-full flex"
            style={{ fontSize: 36, padding: 6 }}
          >
            <FaTwitter />
          </a>
        </div>
      </div>
    </footer>
  );
}
