// Firebase initialization for the Chess web app.
// Re-exports the exact SDK functions script.js needs, so script.js only has one import line.

import {
  initializeApp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth, onAuthStateChanged, signInAnonymously,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, signOut, updateProfile,
  linkWithCredential, linkWithPopup, EmailAuthProvider, signInWithCredential,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  collection, addDoc, query, where, orderBy, limit, getDocs,
  arrayUnion, serverTimestamp, runTransaction, increment,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBb4Qidu_nkMF4zEGqIJV6RcJDCdZ5DUX0",
  authDomain: "chess-webapp-cfb9d.firebaseapp.com",
  projectId: "chess-webapp-cfb9d",
  storageBucket: "chess-webapp-cfb9d.firebasestorage.app",
  messagingSenderId: "411169356290",
  appId: "1:411169356290:web:54351268ed6776d3bd851b",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export {
  onAuthStateChanged, signInAnonymously,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, signOut, updateProfile,
  linkWithCredential, linkWithPopup, EmailAuthProvider, signInWithCredential,
  doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  collection, addDoc, query, where, orderBy, limit, getDocs,
  arrayUnion, serverTimestamp, runTransaction, increment,
};
