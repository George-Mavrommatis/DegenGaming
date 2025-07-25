// src/main.tsx

// ADD THESE TWO LINES AT THE TOP
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
import { PhantomWalletAdapter, SolflareWalletAdapter} from '@solana/wallet-adapter-wallets';
import { BackpackWalletAdapter } from '@solana/wallet-adapter-backpack';
import { clusterApiUrl } from '@solana/web3.js';

// --- Import your custom contexts and App component ---
import { ProfileProvider } from './context/ProfileContext'; // Import your ProfileProvider
import App from './App';

// --- Import Global Styles and Toastify ---
import './index.css';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import '@solana/wallet-adapter-react-ui/styles.css';

// --- Solana Network Configuration ---
const network = WalletAdapterNetwork.Mainnet; // Or your desired network
const endpoint = clusterApiUrl(network);

// --- Wallets to be used in the application ---
const wallets = [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
    new BackpackWalletAdapter(),

    // Add other wallet adapters here
];

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {/* 1. BrowserRouter: Must wrap everything that uses Router hooks */}
    <BrowserRouter>
      {/* 2. ConnectionProvider & WalletProvider: Provide Solana connection and wallet context */}
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          {/* 3. WalletModalProvider: Provides the UI for wallet selection/connection */}
          <WalletModalProvider>
            {/* 4. ProfileProvider: Your custom context that relies on Firebase Auth and Solana Wallet context */}
            <ProfileProvider>
              {/* 5. Your main App component: Where your routes and other components reside */}
              <App />
              {/* 6. ToastContainer: For displaying toast notifications */}
              <ToastContainer position="bottom-right" autoClose={3000} hideProgressBar={false} newestOnTop={false} closeOnClick rtl={false} pauseOnFocusLoss draggable pauseOnHover theme="dark" />
            </ProfileProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </BrowserRouter>
  </React.StrictMode>
);