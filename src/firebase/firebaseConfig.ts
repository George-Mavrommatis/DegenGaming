// src/firebase/firebaseConfig.ts
import { initializeApp, FirebaseApp } from "firebase/app";
import { getFirestore, Firestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth, Auth } from "firebase/auth"; // ✅ 1. Import getAuth



// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAIwxSX2J2Rk6kebsuETFYUzaItdPNXADc",
  authDomain: "ggweb3.firebaseapp.com",
  projectId: "ggweb3",
  storageBucket: "ggweb3.firebasestorage.app",
  messagingSenderId: "22921995728",
  appId: "1:22921995728:web:861b967995c87de64145d5",
  measurementId: "G-BV5CGT7YX6"
};


// Initialize Firebase
export const app: FirebaseApp = initializeApp(firebaseConfig); // <--- THIS IS THE CRUCIAL LINE TO ADD/ENSURE
export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app); // Also good to export db if you use it frequently

// You can add other services here if you initialize them with 'app'
// export const storage = getStorage(app);
// export const functions = getFunctions(app);