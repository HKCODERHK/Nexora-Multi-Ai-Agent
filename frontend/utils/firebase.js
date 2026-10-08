// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider} from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "nexora-ai-6ae9a.firebaseapp.com",
  projectId: "nexora-ai-6ae9a",
  storageBucket: "nexora-ai-6ae9a.firebasestorage.app",
  messagingSenderId: "188085276355",
  appId: "1:188085276355:web:9d0b922e7198f224c29c76"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig)
export const auth=getAuth(app)
export const googleProvider=new GoogleAuthProvider()