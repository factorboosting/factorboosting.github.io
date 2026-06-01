import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyAsrHDe6EKfrHjlAFKUVz97ytzH_uycx8E",
    authDomain: "factorboosting-feed1.firebaseapp.com",
    projectId: "factorboosting-feed1",
    storageBucket: "factorboosting-feed1.firebasestorage.app",
    messagingSenderId: "411384504069",
    appId: "1:411384504069:web:ec2bfeb52e232d0df4a16c",
    measurementId: "G-ME3D8ZQB7T"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Explicitly set persistence to local storage so it remembers devices
setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.error("Persistence error:", error);
});

document.addEventListener('DOMContentLoaded', () => {
    const authOverlay = document.getElementById('auth-overlay');
    const loginBtn = document.getElementById('google-login-btn');
    const navLoginBtn = document.getElementById('nav-login-btn'); // For index.html
    const logoutBtn = document.getElementById('logout-btn');
    const userEmailSpan = document.getElementById('user-email');

    const handleLoginClick = () => {
        signInWithPopup(auth, provider).catch((error) => {
            console.error("Auth Error:", error);
            // Only alert if we're on the protected page, otherwise just log it
            if (authOverlay) alert("Failed to sign in. Please try again.");
        });
    };

    if (loginBtn) loginBtn.addEventListener('click', handleLoginClick);
    if (navLoginBtn) navLoginBtn.addEventListener('click', handleLoginClick);

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            signOut(auth).catch((error) => {
                console.error("Logout Error:", error);
            });
        });
    }

    onAuthStateChanged(auth, (user) => {
        if (user) {
            // User is signed in.
            if (authOverlay) authOverlay.style.display = 'none';
            if (userEmailSpan) userEmailSpan.textContent = user.email;
            if (logoutBtn) logoutBtn.style.display = 'inline-block';
            if (navLoginBtn) navLoginBtn.style.display = 'none';
            document.body.style.overflow = 'auto'; // restore scroll
        } else {
            // No user is signed in.
            if (authOverlay) {
                authOverlay.style.display = 'flex';
                document.body.style.overflow = 'hidden'; // prevent scrolling while locked
            }
            if (logoutBtn) logoutBtn.style.display = 'none';
            if (navLoginBtn) navLoginBtn.style.display = 'inline-block';
            if (userEmailSpan) userEmailSpan.textContent = '';
        }
    });
});
