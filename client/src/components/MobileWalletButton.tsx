/**
 * MobileWalletButton
 *
 * On desktop or when already inside a wallet's in-app browser (Phantom, Solflare,
 * Backpack), renders the standard WalletMultiButton — the wallet is injected and
 * works normally.
 *
 * On a mobile external browser (Chrome/Safari iOS, Chrome Android) the wallet
 * extension is NOT available.  The correct UX is to redirect the user into the
 * wallet's built-in browser where the wallet IS injected.  This component shows
 * "Open in [Wallet] Browser" deeplink buttons for Phantom and Solflare.
 *
 * Deeplink formats (universal links — work on both iOS and Android):
 *   Phantom  : https://phantom.app/ul/browse/{encodedURL}?ref={encodedOrigin}
 *   Solflare : https://solflare.com/ul/v1/browse/{encodedURL}?ref={encodedOrigin}
 */

import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

// ─── detection helpers ────────────────────────────────────────────────────────

function isMobileDevice(): boolean {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/** Phantom injects window.phantom.solana in its in-app browser */
function isInPhantomBrowser(): boolean {
  return !!(window as any).phantom?.solana?.isPhantom;
}

/** Solflare injects window.solflare in its in-app browser */
function isInSolflareBrowser(): boolean {
  return !!(window as any).solflare?.isSolflare;
}

/** Backpack / xNFT injects window.xnft */
function isInBackpackBrowser(): boolean {
  return !!(window as any).xnft;
}

function isInWalletBrowser(): boolean {
  return isInPhantomBrowser() || isInSolflareBrowser() || isInBackpackBrowser();
}

// ─── deeplink builders ────────────────────────────────────────────────────────
//
// Android Chrome does NOT honour HTTPS universal links the same way iOS does —
// if the App Link isn't verified, it opens phantom.app in the browser (showing
// "install extension") instead of the app.
//
// The fix: on Android use the Chrome Intent URL scheme which always opens the
// installed app, with a fallback to the download page if the app isn't present.
// On iOS, the HTTPS universal link works reliably.

function phantomBrowseLink(url: string): string {
  const encodedUrl = encodeURIComponent(url);
  const encodedRef = encodeURIComponent(window.location.origin);

  if (isAndroid()) {
    // Chrome Intent URL — directly opens the Phantom app on Android
    return (
      'intent://phantom.app/ul/browse/' +
      encodedUrl +
      '?ref=' +
      encodedRef +
      '#Intent;package=app.phantom;scheme=https;S.browser_fallback_url=' +
      encodeURIComponent('https://phantom.app/download') +
      ';end'
    );
  }

  // iOS: HTTPS universal link — opens Phantom in-app browser if installed
  return (
    'https://phantom.app/ul/browse/' +
    encodedUrl +
    '?ref=' +
    encodedRef
  );
}

function solflareBrowseLink(url: string): string {
  const encodedUrl = encodeURIComponent(url);
  const encodedRef = encodeURIComponent(window.location.origin);

  if (isAndroid()) {
    return (
      'intent://solflare.com/ul/v1/browse/' +
      encodedUrl +
      '?ref=' +
      encodedRef +
      '#Intent;package=com.solflare.mobile;scheme=solflare;S.browser_fallback_url=' +
      encodeURIComponent('https://solflare.com/download') +
      ';end'
    );
  }

  return (
    'https://solflare.com/ul/v1/browse/' +
    encodedUrl +
    '?ref=' +
    encodedRef
  );
}

// ─── component ────────────────────────────────────────────────────────────────

interface MobileWalletButtonProps {
  /** Extra class names forwarded to WalletMultiButton when in desktop/wallet-browser mode */
  className?: string;
}

export default function MobileWalletButton({ className }: MobileWalletButtonProps) {
  // Desktop or already inside a wallet browser → standard button works fine
  if (!isMobileDevice() || isInWalletBrowser()) {
    return <WalletMultiButton className={className} />;
  }

  // Mobile external browser → show deeplink buttons
  const currentUrl = window.location.href;

  return (
    <div className="flex flex-col items-center gap-3 w-full max-w-xs mx-auto">
      <p className="text-gray-400 text-sm text-center">
        Open this page in your wallet's browser to connect:
      </p>

      {/* Phantom */}
      <a
        href={phantomBrowseLink(currentUrl)}
        className="w-full flex items-center justify-center gap-2 bg-purple-700 hover:bg-purple-600 active:bg-purple-800 text-white font-bold py-3 px-6 rounded-xl transition-colors shadow-lg"
        rel="noopener noreferrer"
      >
        <img
          src="https://phantom.app/img/phantom-logo.svg"
          alt=""
          className="w-5 h-5"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        Open in Phantom
      </a>

      {/* Solflare */}
      <a
        href={solflareBrowseLink(currentUrl)}
        className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-white font-bold py-3 px-6 rounded-xl transition-colors shadow-lg"
        rel="noopener noreferrer"
      >
        Open in Solflare
      </a>

      <p className="text-gray-500 text-xs text-center mt-1">
        New to Solana wallets?{' '}
        <a
          href="https://phantom.app"
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-purple-400"
        >
          Get Phantom
        </a>
      </p>
    </div>
  );
}
