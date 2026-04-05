import { Buffer } from 'buffer';
window.Buffer = Buffer;

// --- The rest of your file ---
import React from 'react';
import ReactDOM from 'react-dom/client';

// --- Import React Router DOM components ---
import { BrowserRouter } from 'react-router-dom';

// --- Import Solana Wallet Adapter components ---
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { BackpackWalletAdapter } from '@solana/wallet-adapter-backpack';
import { clusterApiUrl } from '@solana/web3.js';
import { WalletError } from '@solana/wallet-adapter-base';

// --- Import your custom contexts and App component ---
import { ProfileProvider } from './context/ProfileContext';
import App from './App';

// --- Import Global Styles and Toastify ---
import './index.css';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import '@solana/wallet-adapter-react-ui/styles.css';

// --- Solana Network Configuration ---
// Set VITE_SOLANA_NETWORK=mainnet-beta in .env for mainnet; defaults to devnet
const networkEnv = import.meta.env.VITE_SOLANA_NETWORK || 'devnet';
const network = networkEnv === 'mainnet-beta'
    ? WalletAdapterNetwork.Mainnet
    : WalletAdapterNetwork.Devnet;
const endpoint = (import.meta.env.VITE_SOLANA_RPC_URL as string) || clusterApiUrl(network);

// --- Wallets to be used in the application ---
const wallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
  new BackpackWalletAdapter(),
];

// --- Wallet error handler: surfaces connection errors as toasts ---
function onWalletError(error: WalletError) {
  // Ignore user-rejected requests (e.g. user cancelled the popup)
  if (
    error.name === 'WalletNotReadyError' ||
    error.message?.includes('User rejected') ||
    error.message?.includes('user rejected')
  ) {
    return;
  }
  console.error('[WalletProvider] error:', error);
  toast.error(error.message || 'Wallet connection error. Please try again.');
}

// --- Render your React app as before ---
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <ConnectionProvider endpoint={endpoint}>
        {/*
          autoConnect={false}: prevents auto-reconnect on page load.
          On mobile, autoConnect fires before the deeplink return completes,
          causing silent failures. Users must explicitly tap "Connect".
        */}
        <WalletProvider wallets={wallets} autoConnect={false} onError={onWalletError}>
          <WalletModalProvider>
            <ProfileProvider>
              <App />
              <ToastContainer position="bottom-right" autoClose={3000} hideProgressBar={false} newestOnTop={false} closeOnClick rtl={false} pauseOnFocusLoss draggable pauseOnHover theme="dark" />
            </ProfileProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// --- REMOVE any setTimeout or ensureFontLoadedAndStartGame logic from here ---
// Phaser game is now started from within the WegenRace component after font and container are ready.