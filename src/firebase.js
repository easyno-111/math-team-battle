import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAsG6haJI874yEZlR40nBz-r3njLElmJCE",
  authDomain: "math-team-battle.firebaseapp.com",
  projectId: "math-team-battle",
  storageBucket: "math-team-battle.firebasestorage.app",
  messagingSenderId: "977566050731",
  appId: "1:977566050731:web:bb8add834678e5f1284aee",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);

export default app;