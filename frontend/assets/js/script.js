// --- Constants & State ---
let RATES = { car: 50, bike: 20 };
let ocrConfig = { threshold: 75, autoVerify: true };
const TOTAL_SLOTS = 20;
let stream = null;
let isRealtimeReady = false;
let isDetecting = false;
let detectionTimeout = null;
let realtimeUnsubscribe = null;
let authObserverAttached = false;
let scanCandidates = [];
let isLoginInProgress = false;

// Backend API URL (Loaded dynamically from localStorage with fallback)
const BACKEND_URL = localStorage.getItem('parking_backend_url') || 'https://smart-park-backend-kphl.onrender.com';

let state = {
    currentUser: null,
    view: 'login',
    profile: {
        name: '',
        role: 'driver',
        theme: localStorage.getItem('parking_theme') || 'dark',
        plates: ['', '', '']
    },
    currentBuilding: 'Building 1',
    slots: Array.from({ length: TOTAL_SLOTS }, (_, i) => ({
        id: i + 1, status: 'available', occupiedBy: null, type: 'standard', building: 'Building 1'
    })),
    revenue: 0,
    history: [],
    selectedSlot: null,
    adminTab: 'slots',
    analyticsFilter: {
        building: 'all',
        range: 'today',
        colorScheme: 'neon',
        gridLines: true,
        chartTypes: {
            revenue: 'line',
            peaks: 'bar'
        }
    }
};

// UI Helpers
function openConfigModal() {
    document.getElementById('config-modal').classList.remove('hidden');
    const current = localStorage.getItem('parking_firebase_config');
    if (current) document.getElementById('config-input').value = current;
    
    const currentBackend = localStorage.getItem('parking_backend_url') || 'https://smart-park-backend-kphl.onrender.com';
    const backendInput = document.getElementById('backend-url-input');
    if (backendInput) backendInput.value = currentBackend;
}

// --- Realtime DB Logic ---
window.initRealtime = function () {
    if (window.isOffline) {
        const statusEl = document.getElementById('connection-status');
        if (statusEl) statusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-gray-500"></span> Offline Mode (Click to Setup)`;
        return;
    }

    if (!window.firebaseInitialized) {
        window.addEventListener('firebase-ready', () => window.initRealtime());
        return;
    }

    if (!window.db || !window.auth) return;

    if (authObserverAttached) return;
    authObserverAttached = true;

    window.onAuthStateChanged(window.auth, async (user) => {
        if (user) {
            try {
                const profile = await loadUserProfile(user);
                if (!state.currentUser && !isLoginInProgress) enterPortal(user, profile);
            } catch (error) {
                console.warn(error.message);
                return;
            }
            connectRealtimeData();
        } else {
            state.currentUser = null;
            state.view = 'login';
            if (realtimeUnsubscribe) realtimeUnsubscribe();
            realtimeUnsubscribe = null;
            switchView('login');
        }
    });
}

function connectRealtimeData() {
    if (!window.db || !window.auth?.currentUser) return;
    const statusEl = document.getElementById('connection-status');
    if (statusEl) statusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-green-500 live-dot"></span> Live`;
    isRealtimeReady = true;
    const docRef = window.doc(window.db, 'parking_data', 'main_lot_v1');

    if (realtimeUnsubscribe) realtimeUnsubscribe();
    realtimeUnsubscribe = window.onSnapshot(docRef, (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.data();
            state = {
                ...state,
                slots: data.slots || state.slots,
                revenue: data.revenue || 0,
                history: data.history || []
            };
            refreshUI();
        } else {
            saveData();
        }
    }, (error) => {
        console.error(error);
        if (statusEl) statusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-red-500"></span> Sync Error`;
    });
}

async function saveData() {
    if (window.isOffline) {
        const sharedState = { slots: state.slots, revenue: state.revenue, history: state.history };
        localStorage.setItem('parking_offline_data', JSON.stringify(sharedState));
        return;
    }
    if (!window.db || !window.auth.currentUser) return;

    const docRef = window.doc(window.db, 'parking_data', 'main_lot_v1');
    const sharedState = { slots: state.slots, revenue: state.revenue, history: state.history };

    try { await window.setDoc(docRef, sharedState); }
    catch (e) { console.error("Save failed", e); }
}

function loadOfflineData() {
    const dataStr = localStorage.getItem('parking_offline_data');
    if (dataStr) {
        try {
            const data = JSON.parse(dataStr);
            state.slots = data.slots || state.slots;
            state.revenue = data.revenue || 0;
            state.history = data.history || [];
        } catch (e) {
            console.error("Failed to parse offline data", e);
        }
    }
}

function resetSystem() {
    if (confirm("Confirm System Reset?")) {
        state.slots = Array.from({ length: TOTAL_SLOTS }, (_, i) => ({ id: i + 1, status: 'available', occupiedBy: null, type: 'standard', building: 'Building 1' }));
        state.revenue = 0; state.history = [];
        addLog("RESET PERFORMED", "alert");
        saveData(); refreshUI();
    }
}

// --- Auth & Profile Logic ---
let authMode = 'login';

function setAuthMode(mode) {
    authMode = mode;
    const tabLogin = document.getElementById('tab-login');
    const tabSignup = document.getElementById('tab-signup');
    const nameContainer = document.getElementById('signup-name-container');
    const authTitle = document.getElementById('auth-title');
    const authSubtitle = document.getElementById('auth-subtitle');
    const authHeaderIcon = document.getElementById('auth-header-icon');
    const loginButton = document.getElementById('login-button');

    if (mode === 'login') {
        tabLogin.className = "flex-1 pb-3 text-center font-bold text-sm border-b-2 border-yellow-500 text-yellow-400";
        tabSignup.className = "flex-1 pb-3 text-center font-bold text-sm border-b-2 border-transparent text-gray-500 hover:text-white transition-colors";
        nameContainer.classList.add('hidden');
        authTitle.innerText = "System Access";
        authSubtitle.innerText = "Please authenticate to continue";
        if (authHeaderIcon) {
            authHeaderIcon.setAttribute('data-lucide', 'shield-check');
        }
        loginButton.innerHTML = 'Login <i data-lucide="arrow-right" class="w-4 h-4"></i>';
    } else {
        tabLogin.className = "flex-1 pb-3 text-center font-bold text-sm border-b-2 border-transparent text-gray-500 hover:text-white transition-colors";
        tabSignup.className = "flex-1 pb-3 text-center font-bold text-sm border-b-2 border-yellow-500 text-yellow-400";
        nameContainer.classList.remove('hidden');
        authTitle.innerText = "Create Account";
        authSubtitle.innerText = "Register for parking access";
        if (authHeaderIcon) {
            authHeaderIcon.setAttribute('data-lucide', 'user-plus');
        }
        loginButton.innerHTML = 'Sign Up <i data-lucide="arrow-right" class="w-4 h-4"></i>';
    }
    
    if (window.lucide) lucide.createIcons();
}

function handleAuthSubmit() {
    if (authMode === 'login') {
        login();
    } else {
        register();
    }
}

function updateAuthHint() {
    const hintEl = document.getElementById('auth-hint');
    if (!hintEl) return;
    if (window.isOffline) {
        hintEl.innerHTML = `Running offline. Default logins:<br>Admin: <strong>admin@smartpark.com</strong> / <strong>admin123</strong><br>Driver: <strong>driver@smartpark.com</strong> / <strong>driver123</strong>`;
    } else {
        hintEl.innerText = "Using Firebase Authentication. Log in or register an account.";
    }
}

function getLocalUsers() {
    const local = localStorage.getItem('parking_local_users');
    if (local) {
        try {
            return JSON.parse(local);
        } catch (e) {
            console.error("Failed to parse local users", e);
        }
    }
    const defaults = {
        'admin@smartpark.com': {
            email: 'admin@smartpark.com',
            password: 'admin123',
            uid: 'local_admin',
            profile: {
                name: 'Admin Local',
                role: 'admin',
                theme: 'dark',
                plates: []
            }
        },
        'driver@smartpark.com': {
            email: 'driver@smartpark.com',
            password: 'driver123',
            uid: 'local_driver',
            profile: {
                name: 'Driver Local',
                role: 'driver',
                theme: 'dark',
                plates: ['', '', '']
            }
        }
    };
    localStorage.setItem('parking_local_users', JSON.stringify(defaults));
    return defaults;
}

async function login() {
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-pass').value.trim();
    const requestedRole = document.getElementById('login-role').value;
    const button = document.getElementById('login-button');

    if (!email || !pass) return showToast('Enter your email and password', 'error');

    button.disabled = true;
    button.innerHTML = 'Signing in...';
    isLoginInProgress = true;

    if (window.isOffline || !window.signInWithEmailAndPassword) {
        try {
            const users = getLocalUsers();
            const emailKey = email.toLowerCase();
            const user = users[emailKey];
            if (!user || user.password !== pass) {
                throw new Error('Incorrect email or password');
            }
            if (user.profile.role !== requestedRole) {
                throw new Error(`This account belongs to the ${user.profile.role} portal`);
            }
            
            const mockUser = {
                uid: user.uid,
                email: user.email,
                displayName: user.profile.name
            };
            
            localStorage.setItem('parking_offline_user', JSON.stringify(mockUser));
            localStorage.setItem(`parking_profile_${user.uid}`, JSON.stringify(user.profile));
            
            enterPortal(mockUser, user.profile);
            loadOfflineData();
            refreshUI();
            showToast(`Welcome back, ${user.profile.name}`, 'success');
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            isLoginInProgress = false;
            button.disabled = false;
            button.innerHTML = 'Login <i data-lucide="arrow-right" class="w-4 h-4"></i>';
            if (window.lucide) lucide.createIcons();
        }
    } else {
        try {
            const credential = await window.signInWithEmailAndPassword(window.auth, email, pass);
            const profile = await loadUserProfile(credential.user, requestedRole);
            if (profile.role !== requestedRole) {
                await window.signOutFirebase(window.auth);
                throw new Error(`This account belongs to the ${profile.role} portal`);
            }
            enterPortal(credential.user, profile);
            connectRealtimeData();
            showToast(`Welcome back, ${profile.name || credential.user.email}`, 'success');
        } catch (error) {
            showToast(readableAuthError(error), 'error');
        } finally {
            isLoginInProgress = false;
            button.disabled = false;
            button.innerHTML = 'Login <i data-lucide="arrow-right" class="w-4 h-4"></i>';
            if (window.lucide) lucide.createIcons();
        }
    }
}

async function register() {
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-pass').value.trim();
    const name = document.getElementById('signup-name').value.trim();
    const requestedRole = document.getElementById('login-role').value;
    const button = document.getElementById('login-button');

    if (!email || !pass || !name) return showToast('Fill in all fields to sign up', 'error');

    button.disabled = true;
    button.innerHTML = 'Creating account...';
    isLoginInProgress = true;

    if (window.isOffline || !window.createUserWithEmailAndPassword) {
        try {
            const users = getLocalUsers();
            const emailKey = email.toLowerCase();
            if (users[emailKey]) {
                throw new Error('Account with this email already exists');
            }
            const uid = 'local_' + Date.now();
            const profile = {
                name: name,
                role: requestedRole,
                theme: 'dark',
                plates: ['', '', '']
            };
            users[emailKey] = {
                email: email,
                password: pass,
                uid: uid,
                profile: profile
            };
            localStorage.setItem('parking_local_users', JSON.stringify(users));
            
            const mockUser = { uid, email, displayName: name };
            localStorage.setItem('parking_offline_user', JSON.stringify(mockUser));
            localStorage.setItem(`parking_profile_${uid}`, JSON.stringify(profile));
            
            enterPortal(mockUser, profile);
            loadOfflineData();
            refreshUI();
            showToast('Account created locally!', 'success');
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            isLoginInProgress = false;
            button.disabled = false;
            button.innerHTML = 'Sign Up <i data-lucide="arrow-right" class="w-4 h-4"></i>';
            if (window.lucide) lucide.createIcons();
        }
    } else {
        try {
            const credential = await window.createUserWithEmailAndPassword(window.auth, email, pass);
            const profile = {
                name: name,
                role: requestedRole,
                theme: localStorage.getItem('parking_theme') || 'dark',
                plates: ['', '', '']
            };
            await window.setDoc(window.doc(window.db, 'users', credential.user.uid), profile);
            localStorage.setItem(`parking_profile_${credential.user.uid}`, JSON.stringify(profile));
            
            enterPortal(credential.user, profile);
            connectRealtimeData();
            showToast(`Welcome, ${name}! Account created.`, 'success');
        } catch (error) {
            showToast(error.message || 'Could not create account', 'error');
        } finally {
            isLoginInProgress = false;
            button.disabled = false;
            button.innerHTML = 'Sign Up <i data-lucide="arrow-right" class="w-4 h-4"></i>';
            if (window.lucide) lucide.createIcons();
        }
    }
}

async function logout() {
    state.currentUser = null; state.view = 'login';
    if (stream) stopCamera();
    localStorage.removeItem('parking_offline_user');
    if (window.auth?.currentUser && window.signOutFirebase) await window.signOutFirebase(window.auth);
    switchView('login');
}

function readableAuthError(error) {
    const messages = {
        'auth/invalid-credential': 'Incorrect email or password',
        'auth/invalid-email': 'Enter a valid email address',
        'auth/too-many-requests': 'Too many attempts. Try again later',
        'auth/user-disabled': 'This account has been disabled',
        'auth/email-already-in-use': 'The email address is already in use.'
    };
    return messages[error?.code] || error?.message || 'Unable to complete action';
}

function applyLoadedProfileConfig(profile) {
    if (profile.role === 'admin') {
        if (profile.rates) RATES = profile.rates;
        if (profile.ocrThreshold !== undefined) ocrConfig.threshold = Number(profile.ocrThreshold);
        if (profile.autoVerify !== undefined) ocrConfig.autoVerify = !!profile.autoVerify;
    }
}

async function loadUserProfile(user, requestedRole = null) {
    const localKey = `parking_profile_${user.uid}`;
    
    if (window.isOffline) {
        const users = getLocalUsers();
        const userObj = Object.values(users).find(u => u.uid === user.uid);
        if (userObj) {
            state.profile = {
                name: userObj.profile.name || 'User',
                role: userObj.profile.role,
                theme: userObj.profile.theme || 'dark',
                plates: [...(userObj.profile.plates || []), '', '', ''].slice(0, 3),
                rates: userObj.profile.rates || { car: 50, bike: 20 },
                ocrThreshold: userObj.profile.ocrThreshold || 75,
                autoVerify: userObj.profile.autoVerify !== undefined ? userObj.profile.autoVerify : true,
                prefVehicle: userObj.profile.prefVehicle || 'car',
                prefPayment: userObj.profile.prefPayment || 'UPI',
                defaultBuilding: userObj.profile.defaultBuilding || 'Building 1',
                alertThreshold: userObj.profile.alertThreshold || 90
            };
            applyLoadedProfileConfig(state.profile);
            localStorage.setItem(localKey, JSON.stringify(state.profile));
            applyTheme(state.profile.theme, false);
            renderSavedPlates();
            return state.profile;
        }
    }

    const localProfile = JSON.parse(localStorage.getItem(localKey) || 'null');
    let profile = localProfile;

    if (window.db && window.getDoc) {
        const snapshot = await window.getDoc(window.doc(window.db, 'users', user.uid));
        if (snapshot.exists()) profile = snapshot.data();
    }

    if (!profile?.role && requestedRole === 'driver') {
        profile = {
            name: user.displayName || user.email?.split('@')[0] || 'Driver',
            role: 'driver',
            theme: localStorage.getItem('parking_theme') || 'dark',
            plates: ['', '', ''],
            prefVehicle: 'car',
            prefPayment: 'UPI',
            defaultBuilding: 'Building 1'
        };
        await window.setDoc(window.doc(window.db, 'users', user.uid), profile);
    }

    if (!profile?.role) {
        throw new Error('No portal role is assigned to this account. Create users/{uid} with role "driver" or "admin".');
    }

    state.profile = {
        name: profile.name || user.displayName || user.email?.split('@')[0] || 'User',
        role: profile.role,
        theme: profile.theme || localStorage.getItem('parking_theme') || 'dark',
        plates: [...(profile.plates || []), '', '', ''].slice(0, 3),
        rates: profile.rates || { car: 50, bike: 20 },
        ocrThreshold: profile.ocrThreshold || 75,
        autoVerify: profile.autoVerify !== undefined ? profile.autoVerify : true,
        prefVehicle: profile.prefVehicle || 'car',
        prefPayment: profile.prefPayment || 'UPI',
        defaultBuilding: profile.defaultBuilding || 'Building 1',
        alertThreshold: profile.alertThreshold || 90
    };
    applyLoadedProfileConfig(state.profile);
    localStorage.setItem(localKey, JSON.stringify(state.profile));
    applyTheme(state.profile.theme, false);
    renderSavedPlates();
    return state.profile;
}

function enterPortal(user, profile) {
    state.currentUser = { uid: user.uid, email: user.email };
    state.profile = profile;
    applyLoadedProfileConfig(profile);
    state.view = profile.role === 'admin' ? 'admin' : 'user';
    state.currentBuilding = profile.defaultBuilding || 'Building 1';
    
    setTimeout(() => {
        const userActive = document.getElementById('user-active-building');
        const adminActive = document.getElementById('admin-active-building');
        if (userActive) userActive.innerText = state.currentBuilding;
        if (adminActive) adminActive.innerText = state.currentBuilding;
    }, 0);

    switchView(state.view);
}

async function saveSettings() {
    if (!state.currentUser) return;
    const name = document.getElementById('settings-name').value.trim();
    const theme = document.body.classList.contains('theme-light') ? 'light' : 'dark';
    const profile = { ...state.profile, name: name || state.profile.name, theme };

    if (state.profile.role === 'driver') {
        const plates = [1, 2, 3].map(i => normalizePlate(document.getElementById(`settings-plate-${i}`).value));
        profile.plates = plates;
        profile.prefVehicle = document.getElementById('settings-pref-vehicle').value;
        profile.prefPayment = document.getElementById('settings-pref-payment').value;
        profile.defaultBuilding = document.getElementById('settings-pref-building').value;
    } else {
        const carRate = Math.max(1, parseInt(document.getElementById('settings-rate-car').value) || 50);
        const bikeRate = Math.max(1, parseInt(document.getElementById('settings-rate-bike').value) || 20);
        const ocrThreshold = Math.min(100, Math.max(10, parseInt(document.getElementById('settings-ocr-threshold').value) || 75));
        const autoVerify = document.getElementById('settings-auto-verify').checked;
        const defaultBuilding = document.getElementById('settings-admin-building').value;
        const alertThreshold = Math.min(100, Math.max(50, parseInt(document.getElementById('settings-alert-threshold').value) || 90));
        
        profile.rates = { car: carRate, bike: bikeRate };
        profile.ocrThreshold = ocrThreshold;
        profile.autoVerify = autoVerify;
        profile.defaultBuilding = defaultBuilding;
        profile.alertThreshold = alertThreshold;
        
        // Update live variables
        RATES = profile.rates;
        ocrConfig.threshold = ocrThreshold;
        ocrConfig.autoVerify = autoVerify;
    }

    const button = document.getElementById('settings-save-button');
    button.disabled = true;
    button.innerText = 'Saving...';
    try {
        if (window.isOffline) {
            const users = getLocalUsers();
            const emailKey = state.currentUser.email.toLowerCase();
            if (users[emailKey]) {
                users[emailKey].profile = profile;
                localStorage.setItem('parking_local_users', JSON.stringify(users));
            }
        } else {
            await window.setDoc(window.doc(window.db, 'users', window.auth.currentUser.uid), profile, { merge: true });
            await window.updateFirebaseProfile(window.auth.currentUser, { displayName: profile.name });
        }
        state.profile = profile;
        localStorage.setItem('parking_theme', theme);
        localStorage.setItem(`parking_profile_${state.currentUser.uid}`, JSON.stringify(profile));
        renderSavedPlates();
        updateUserDisplay();
        
        if (profile.defaultBuilding) {
            selectBuilding(profile.defaultBuilding);
        }
        
        closeSettings();
        showToast('Settings saved', 'success');
        
        // If driver, update preferred vehicle in fast track selector
        if (state.profile.role === 'driver') {
            const prefType = state.profile.prefVehicle || 'car';
            const radio = document.querySelector(`input[name="quickVType"][value="${prefType}"]`);
            if (radio) radio.checked = true;
        }
    } catch (error) {
        showToast('Could not save settings', 'error');
    } finally {
        button.disabled = false;
        button.innerText = 'Save settings';
    }
}

function openSettings() {
    document.getElementById('settings-name').value = state.profile.name || '';
    [1, 2, 3].forEach(i => document.getElementById(`settings-plate-${i}`).value = state.profile.plates?.[i - 1] || '');
    document.getElementById('driver-plates-settings').classList.toggle('hidden', state.profile.role !== 'driver');
    
    // Toggle role-specific settings visibility
    const isDriver = state.profile.role === 'driver';
    document.getElementById('driver-prefs-settings').classList.toggle('hidden', !isDriver);
    document.getElementById('admin-system-settings').classList.toggle('hidden', isDriver);
    
    if (isDriver) {
        document.getElementById('settings-pref-vehicle').value = state.profile.prefVehicle || 'car';
        document.getElementById('settings-pref-payment').value = state.profile.prefPayment || 'UPI';
        document.getElementById('settings-pref-building').value = state.profile.defaultBuilding || 'Building 1';
    } else {
        document.getElementById('settings-rate-car').value = RATES.car;
        document.getElementById('settings-rate-bike').value = RATES.bike;
        document.getElementById('settings-ocr-threshold').value = ocrConfig.threshold;
        document.getElementById('settings-auto-verify').checked = ocrConfig.autoVerify;
        document.getElementById('settings-admin-building').value = state.profile.defaultBuilding || 'Building 1';
        document.getElementById('settings-alert-threshold').value = state.profile.alertThreshold || 90;
    }

    updateThemeChoices();
    document.getElementById('settings-modal').classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function closeSettings() {
    document.getElementById('settings-modal').classList.add('hidden');
}

async function previewTheme(theme) {
    applyTheme(theme, true);
    updateThemeChoices();
    
    state.profile.theme = theme;
    if (state.currentUser) {
        localStorage.setItem(`parking_profile_${state.currentUser.uid}`, JSON.stringify(state.profile));
        
        try {
            if (window.isOffline) {
                const users = getLocalUsers();
                const emailKey = state.currentUser.email.toLowerCase();
                if (users[emailKey]) {
                    users[emailKey].profile.theme = theme;
                    localStorage.setItem('parking_local_users', JSON.stringify(users));
                }
            } else if (window.auth?.currentUser && window.db) {
                await window.setDoc(window.doc(window.db, 'users', window.auth.currentUser.uid), { theme }, { merge: true });
            }
        } catch (e) {
            console.error("Auto-saving theme failed", e);
        }
    }
}

function updateThemeChoices() {
    const active = document.body.classList.contains('theme-light') ? 'light' : 'dark';
    document.querySelectorAll('[data-theme-choice]').forEach(el => el.classList.toggle('active', el.dataset.themeChoice === active));
}

function applyTheme(theme, persist = true) {
    const isLight = theme === 'light';
    document.body.classList.toggle('theme-light', isLight);
    document.documentElement.classList.toggle('theme-light', isLight);
    if (persist) localStorage.setItem('parking_theme', theme);
    const icon = document.getElementById('theme-icon');
    if (icon) icon.setAttribute('data-lucide', isLight ? 'moon' : 'sun');
    if (window.lucide) lucide.createIcons();
    if (typeof updateGraphs === 'function') updateGraphs();
}

function normalizePlate(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
}

function renderSavedPlates() {
    const container = document.getElementById('saved-plates-list');
    if (!container) return;
    const plates = state.profile.plates || [];
    container.innerHTML = plates.map((plate, index) => plate
        ? `<button class="saved-plate" onclick="useSavedPlate('${plate}')"><span>Vehicle ${index + 1}</span><strong>${plate}</strong></button>`
        : `<button class="saved-plate empty" onclick="openSettings()"><span>Vehicle ${index + 1}</span><strong>Add plate</strong></button>`
    ).join('');
}

function useSavedPlate(plate) {
    document.getElementById('quickVNo').value = plate;
    document.getElementById('quickVNo').focus();
    showToast(`${plate} selected`, 'success');
}

function updateUserDisplay() {
    const span = document.getElementById('username-span');
    if (span) span.innerText = state.profile.name || (state.profile.role === 'admin' ? 'Admin' : 'Driver');
}

function switchView(viewName) {
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('user-view').classList.add('hidden');
    document.getElementById('admin-view').classList.add('hidden');
    document.getElementById('auth-controls').classList.add('hidden');

    if (viewName === 'login') {
        document.getElementById('login-view').classList.remove('hidden');
    } else {
        document.getElementById('auth-controls').classList.remove('hidden');
        updateUserDisplay();

        if (viewName === 'user') {
            document.getElementById('user-view').classList.remove('hidden');
            renderSlots('user-grid');
            renderSavedPlates();
        } else if (viewName === 'admin') {
            document.getElementById('admin-view').classList.remove('hidden');
            switchAdminTab(state.adminTab || 'slots');
        }
        // Clear search bars
        const s1 = document.getElementById('slot-search');
        const s2 = document.getElementById('admin-slot-search');
        if (s1) s1.value = '';
        if (s2) s2.value = '';
    }
    if (window.lucide) lucide.createIcons();
}

function selectBuilding(name) {
    state.currentBuilding = name;
    
    // Update active indicators
    const userActive = document.getElementById('user-active-building');
    const adminActive = document.getElementById('admin-active-building');
    
    if (userActive) userActive.innerText = name;
    if (adminActive) adminActive.innerText = name;
    
    refreshUI();
}

function renderSlots(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    // If active building is Building 1, render the 3-column blueprint
    if (state.currentBuilding === 'Building 1') {
        container.className = "grid grid-cols-[1fr_80px_1fr] gap-x-2 gap-y-3 w-full max-w-3xl mx-auto relative p-4 rounded-2xl border border-blue-500/20 bg-slate-950/20";
        
        // 1. Create the middle lane element
        const lane = document.createElement('div');
        lane.className = "col-start-2 row-start-1 row-span-10 flex flex-col justify-between items-center py-4 relative border-l border-r border-dashed border-blue-500/20 bg-slate-900/10";
        lane.innerHTML = `
            <!-- Top Entry Dotted -->
            <div class="w-full border-t border-dotted border-blue-500/60 text-center text-[8px] text-blue-400 font-mono tracking-widest py-1">
                ENTRY
            </div>
            
            <!-- Direction Arrows -->
            <div class="flex flex-col gap-8 my-auto opacity-50">
                <div class="flex flex-col items-center text-blue-400">
                    <i data-lucide="arrow-down" class="w-4 h-4"></i>
                </div>
                <div class="flex flex-col items-center text-blue-400">
                    <i data-lucide="arrow-up" class="w-4 h-4"></i>
                </div>
            </div>
            
            <!-- Bottom Exit Dotted -->
            <div class="w-full flex flex-col items-center">
                <span class="text-[8px] text-blue-400 font-bold font-mono tracking-wider mb-1">EXIT</span>
                <div class="w-full border-t border-dotted border-blue-500/60 text-center py-1">
                    <i data-lucide="arrow-down" class="w-4 h-4 text-blue-400 animate-pulse"></i>
                </div>
            </div>
        `;
        container.appendChild(lane);

        // 2. Render each of the 10 rows
        for (let r = 0; r < 10; r++) {
            const leftId = r + 1;
            const rightId = r + 11;

            const leftSlot = state.slots.find(s => s.id === leftId && s.building === 'Building 1') || { id: leftId, status: 'available', building: 'Building 1' };
            const rightSlot = state.slots.find(s => s.id === rightId && s.building === 'Building 1') || { id: rightId, status: 'available', building: 'Building 1' };

            // Render Left Slot
            const leftDiv = createSlotElement(leftSlot, 'left', r + 1);
            container.appendChild(leftDiv);

            // Render Right Slot
            const rightDiv = createSlotElement(rightSlot, 'right', r + 1);
            container.appendChild(rightDiv);
        }
    } else {
        // Fallback for standard layout (e.g. other buildings later)
        container.className = "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 w-full";
        state.slots.forEach(slot => {
            if (slot.building === state.currentBuilding) {
                const div = createSlotElement(slot, 'standard');
                container.appendChild(div);
            }
        });
    }

    if (window.lucide) lucide.createIcons();
}

function createSlotElement(slot, position = 'standard', row = 1) {
    const div = document.createElement('div');
    let colorClass = "", iconHtml = "";

    if (slot.status === 'maintenance') {
        colorClass = "slot-maintenance";
        iconHtml = `<i data-lucide="cone" class="w-5 h-5 mb-1 text-yellow-500 drop-shadow-md"></i><span class='text-yellow-500 font-mono text-[9px] bg-slate-900 px-1 rounded border border-gray-700'>MAINTENANCE</span>`;
    } else if (slot.status === 'occupied') {
        const isVerified = !!slot.occupiedBy?.verified;
        colorClass = isVerified ? "slot-occupied" : "slot-occupied slot-unverified";
        const verified = isVerified 
            ? `<div class="absolute top-1 right-1 text-green-400"><i data-lucide="shield-check" class="w-3 h-3"></i></div>` 
            : `<div class="absolute top-1 right-1 text-yellow-400"><i data-lucide="shield-alert" class="w-3 h-3 animate-pulse"></i></div>`;
        iconHtml = `${verified}<i data-lucide="${slot.occupiedBy?.type === 'bike' ? 'bike' : 'car-front'}" class="w-6 h-6 mb-1 ${isVerified ? 'text-red-500' : 'text-yellow-500'}"></i><span class="text-[9px] font-bold font-mono text-white tracking-wider bg-slate-900 px-1.5 py-0.5 rounded border border-gray-700">${slot.occupiedBy?.vehicleNo}</span>`;
    } else {
        colorClass = "slot-available group";
        iconHtml = `<div class="text-green-500/30 group-hover:text-green-500 transition-colors"><span class="text-xl font-black font-mono opacity-50">${String(slot.id).padStart(2, '0')}</span></div><span class='text-green-500 font-bold text-[9px] uppercase tracking-wider mt-0.5'>Open</span>`;
    }

    let posClass = "";
    if (position === 'left') {
        posClass = "slot-blueprint slot-left col-start-1";
        div.style.gridRow = row;
    } else if (position === 'right') {
        posClass = "slot-blueprint slot-right col-start-3";
        div.style.gridRow = row;
    } else {
        posClass = "p-4 rounded-xl border-2 border-dashed flex flex-col items-center justify-center transition-all duration-300 min-h-[110px] relative overflow-hidden";
    }

    div.className = `${posClass} ${colorClass}`;
    div.innerHTML = iconHtml;
    div.onclick = () => handleSlotClick(slot);
    return div;
}

function handleSlotClick(slot) {
    state.selectedSlot = slot.id;
    if (state.view === 'user') {
        if (slot.status === 'available') openModal('user-book');
        else if (slot.status === 'occupied') openModal('user-pay', slot);
    } else if (state.view === 'admin') {
        if (slot.status === 'available') openModal('admin-manage-empty', slot);
        else if (slot.status === 'maintenance') toggleMaintenance(slot.id);
        else if (slot.status === 'occupied') openModal('admin-details', slot);
    }
}

function openModal(type, data = null) {
    document.getElementById('modal-overlay').classList.remove('hidden');
    const header = (t) => `<div class="bg-slate-950 px-6 py-4 border-b border-gray-800 flex justify-between items-center"><h3 class="font-bold text-lg text-white uppercase tracking-wider">${t}</h3><button onclick="closeModal()" class="text-gray-500 hover:text-white"><i data-lucide="x" class="w-5 h-5"></i></button></div>`;

    let html = '';
    if (type === 'user-book') {
        const isBike = state.profile.prefVehicle === 'bike';
        html = `${header(`Book Slot ${String(state.selectedSlot).padStart(2, '0')}`)}
            <div class="p-6 space-y-5">
                <div class="grid grid-cols-2 gap-3">
                    <label class="cursor-pointer"><input type="radio" name="vType" value="car" class="peer sr-only" ${!isBike ? 'checked' : ''}><div class="p-3 border border-gray-700 bg-slate-800 rounded-xl text-center peer-checked:border-yellow-500 peer-checked:text-yellow-400"><i data-lucide="car-front" class="w-6 h-6 mx-auto mb-1"></i><span class="text-xs font-bold">Car (₹${RATES.car}/hr)</span></div></label>
                    <label class="cursor-pointer"><input type="radio" name="vType" value="bike" class="peer sr-only" ${isBike ? 'checked' : ''}><div class="p-3 border border-gray-700 bg-slate-800 rounded-xl text-center peer-checked:border-yellow-500 peer-checked:text-yellow-400"><i data-lucide="bike" class="w-6 h-6 mx-auto mb-1"></i><span class="text-xs font-bold">Bike (₹${RATES.bike}/hr)</span></div></label>
                </div>
                <input type="text" id="vNo" placeholder="PLATE NO (AP 05 AB 1234)" class="w-full bg-slate-950 text-white px-4 py-3 rounded-xl border border-gray-700 uppercase font-mono outline-none">
                <button onclick="userPark()" class="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-black py-3 rounded-xl uppercase mt-2">Confirm</button>
            </div>`;
    } else if (type === 'user-pay') {
        const total = Math.max(1, Math.ceil((new Date() - new Date(data.occupiedBy.startTime)) / 36e5)) * (data.occupiedBy.type === 'car' ? RATES.car : RATES.bike);
        const prefPay = state.profile.prefPayment || 'UPI';
        html = `${header('Checkout')}
            <div class="p-6 space-y-4">
                <div class="text-center">
                    <p class="text-xs text-gray-500 uppercase tracking-widest font-bold">Total Amount</p>
                    <h2 class="text-5xl font-black text-white font-mono my-2">₹${total}</h2>
                </div>
                <div>
                    <label class="settings-label">Payment Method</label>
                    <select id="checkout-payment-method" class="settings-input">
                        <option value="UPI" ${prefPay === 'UPI' ? 'selected' : ''}>UPI (GPay/PhonePe)</option>
                        <option value="FASTag" ${prefPay === 'FASTag' ? 'selected' : ''}>FASTag Auto-Debit</option>
                        <option value="Card" ${prefPay === 'Card' ? 'selected' : ''}>Debit/Credit Card</option>
                    </select>
                </div>
                <button onclick="processPayment(${data.id}, ${total})" class="w-full bg-green-500 hover:bg-green-400 text-black font-black py-3 rounded-xl uppercase tracking-wider font-bold">Confirm & Pay</button>
            </div>`;
    } else if (type === 'admin-manage-empty') {
        html = `${header('Slot Control')}<div class="p-6 space-y-3"><button onclick="toggleMaintenance(${data.id})" class="w-full p-4 border border-gray-700 bg-slate-800 rounded-xl text-white flex gap-3"><i data-lucide="cone" class="text-yellow-500"></i> Maintenance</button><button onclick="emergencyBookSetup()" class="w-full p-4 border border-red-900/30 bg-red-900/10 rounded-xl text-red-400 flex gap-3"><i data-lucide="siren"></i> Override</button></div>`;
    } else if (type === 'emergency-form') {
        html = `${header('Override')}<div class="p-6 space-y-4"><input type="text" id="e-vNo" placeholder="VIP ID" class="w-full bg-slate-950 text-white px-4 py-3 rounded-xl border border-gray-700 uppercase font-mono"><button onclick="confirmEmergencyBook()" class="w-full bg-red-600 hover:bg-red-500 text-[#fff] font-bold py-3 rounded-xl">Book</button></div>`;
    } else if (type === 'admin-details') {
        html = `${header('Details')}<div class="p-6 text-center"><h4 class="text-3xl font-black text-white font-mono">${data.occupiedBy.vehicleNo}</h4></div>`;
    }
    document.getElementById('modal-content').innerHTML = html;
    if (window.lucide) lucide.createIcons();
}

function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); }

// Core Actions
function autoBookSlot() {
    const vNo = normalizePlate(document.getElementById('quickVNo').value);
    if (!vNo) return showToast('Please enter a License Plate', 'error');

    // Find first available slot in the current building
    const availableSlot = state.slots.find(s => s.status === 'available' && s.building === state.currentBuilding);

    if (!availableSlot) {
        return showToast('Parking lot is completely full.', 'error');
    }

    const type = document.querySelector('input[name="quickVType"]:checked').value;

    updateSlot(availableSlot.id, 'occupied', {
        vehicleNo: vNo,
        type: type,
        startTime: new Date().toISOString(),
        verified: false
    });

    addLog(`AUTO-BOOK: Slot ${availableSlot.id} for ${vNo}`, 'user', { action: 'book', slotId: availableSlot.id, vehicleNo: vNo, vehicleType: type, building: availableSlot.building });

    // Clear the input
    document.getElementById('quickVNo').value = '';

    showToast(`Assigned Slot ${String(availableSlot.id).padStart(2, '0')} successfully!`, 'success');
}

function userPark() {
    const vNo = normalizePlate(document.getElementById('vNo').value);
    if (!vNo) return showToast('Plate Required', 'error');
    const type = document.querySelector('input[name="vType"]:checked').value;
    const slot = state.slots.find(s => s.id === state.selectedSlot);
    const building = slot?.building || 'Building 1';
    
    updateSlot(state.selectedSlot, 'occupied', { vehicleNo: vNo, type, startTime: new Date().toISOString(), verified: false });
    addLog(`PARK: ${vNo}`, 'user', { action: 'book', slotId: state.selectedSlot, vehicleNo: vNo, vehicleType: type, building });
    closeModal();
    showToast('Booked', 'success');
}
function processPayment(id, amt) {
    const slot = state.slots.find(s => s.id === id);
    const vehicleNo = slot?.occupiedBy?.vehicleNo || '';
    const vehicleType = slot?.occupiedBy?.type || 'car';
    const building = slot?.building || 'Building 1';
    const payMethod = document.getElementById('checkout-payment-method')?.value || state.profile.prefPayment || 'UPI';
    
    updateSlot(id, 'available', null);
    state.revenue += amt;
    addLog(`PAID: ₹${amt} via ${payMethod}`, 'success', { action: 'pay', slotId: id, amount: amt, vehicleNo, vehicleType, building, paymentMethod: payMethod });
    saveData();
    closeModal();
    showToast('Paid successfully', 'success');
}
function toggleMaintenance(id) {
    const slot = state.slots.find(s => s.id === id);
    const nextStatus = slot.status === 'maintenance' ? 'available' : 'maintenance';
    const building = slot?.building || 'Building 1';
    
    updateSlot(id, nextStatus, null);
    addLog(`MAINTENANCE: Slot ${id} ${nextStatus === 'maintenance' ? 'Started' : 'Ended'}`, 'system', { action: 'maintenance', slotId: id, status: nextStatus, building });
    closeModal();
}
function emergencyBookSetup() { openModal('emergency-form'); }
function confirmEmergencyBook() {
    const vNo = normalizePlate(document.getElementById('e-vNo').value);
    if (!vNo) return showToast('VIP ID/Plate Required', 'error');
    const slot = state.slots.find(s => s.id === state.selectedSlot);
    const building = slot?.building || 'Building 1';
    
    updateSlot(state.selectedSlot, 'occupied', { vehicleNo: vNo, type: 'car', startTime: new Date().toISOString(), verified: true });
    addLog(`OVERRIDE: Slot ${state.selectedSlot} for ${vNo}`, 'alert', { action: 'override', slotId: state.selectedSlot, vehicleNo: vNo, vehicleType: 'car', building });
    closeModal();
}

function updateSlot(id, status, data) {
    const i = state.slots.findIndex(s => s.id === id);
    state.slots[i].status = status;
    state.slots[i].occupiedBy = data;
    saveData();
    refreshUI();
    
    if (status === 'occupied') {
        checkOccupancyAlert(state.slots[i].building);
    }
}

function checkOccupancyAlert(building) {
    if (state.profile.role !== 'admin') return;
    const threshold = state.profile.alertThreshold || 90;
    const bSlots = state.slots.filter(s => s.building === building);
    const occupied = bSlots.filter(s => s.status === 'occupied').length;
    const total = bSlots.length;
    const pct = total > 0 ? (occupied / total) * 100 : 0;
    
    if (pct >= threshold) {
        showToast(`⚠️ WARNING: ${building} capacity at ${Math.round(pct)}% (exceeds threshold of ${threshold}%)!`, 'error');
        addLog(`ALERT: ${building} capacity at ${Math.round(pct)}%`, 'alert', { building });
    }
}

function refreshUI() {
    if (state.view === 'user') renderSlots('user-grid');
    if (state.view === 'admin') {
        if (state.adminTab === 'slots') renderSlots('admin-grid');
        renderStats();
    }
}

function renderStats() {
    const revEl = document.getElementById('admin-revenue');
    const occEl = document.getElementById('admin-occupancy');
    const mainEl = document.getElementById('admin-maintenance');
    
    if (revEl) revEl.innerText = `₹${state.revenue}`;
    
    const occ = state.slots.filter(s => s.status === 'occupied').length;
    const total = state.slots.length;
    const main = state.slots.filter(s => s.status === 'maintenance').length;
    
    if (occEl) occEl.innerHTML = `${occ}<span class="text-gray-600 text-lg">/${total}</span>`;
    if (mainEl) mainEl.innerText = main;

    // Also update graphs if they exist
    if (typeof updateGraphs === 'function') updateGraphs();
    
    // Also update analytics dashboard if visible
    if (state.view === 'admin' && state.adminTab === 'analytics') {
        renderAnalyticsDashboard();
    }
}

function addLog(msg, type, metadata = {}) {
    const colors = { alert: 'text-red-400', success: 'text-green-400', system: 'text-blue-400', user: 'text-yellow-400' };
    const logItem = {
        msg,
        time: new Date().toLocaleTimeString(),
        timestamp: new Date().toISOString(),
        color: colors[type] || 'text-gray-400',
        ...metadata
    };
    state.history.unshift(logItem);
    saveData();
    renderLog();
}

function renderLog() {
    const logsHtml = state.history.length 
        ? state.history.map(i => `<div class="border-b border-gray-900/50 pb-1 mb-1 log-entry flex items-start gap-2"><span class="text-gray-600 shrink-0">[${i.time}]</span><span class="${i.color}">${i.msg}</span></div>`).join('') 
        : '<p class="text-gray-600 text-center py-4 italic">Ready...</p>';
        
    const elSlots = document.getElementById('activity-log-slots');
    const elCamera = document.getElementById('activity-log-camera');
    const elFallback = document.getElementById('activity-log');
    
    if (elSlots) elSlots.innerHTML = logsHtml;
    if (elCamera) elCamera.innerHTML = logsHtml;
    if (elFallback) elFallback.innerHTML = logsHtml;
}

// --- Search & Export Features ---
function handleSearch(event) {
    const query = event.target.value.trim().toUpperCase();
    if (!query) {
        // Show all slots
        renderSlots(state.view === 'user' ? 'user-grid' : 'admin-grid');
        return;
    }
    const filtered = state.slots.filter(slot => {
        if (slot.status === 'available') return String(slot.id).includes(query);
        if (slot.status === 'occupied' && slot.occupiedBy) {
            const plate = slot.occupiedBy.vehicleNo.toUpperCase();
            return plate.includes(query) || String(slot.id).includes(query);
        }
        return false;
    });
    // Temporarily render filtered slots
    const original = state.slots;
    state.slots = filtered;
    renderSlots(state.view === 'user' ? 'user-grid' : 'admin-grid');
    state.slots = original;
}

function exportCSV() {
    let csv = 'Slot ID,Status,Vehicle No,Type,Verified,Start Time\n';
    state.slots.forEach(slot => {
        const occ = slot.occupiedBy || {};
        csv += `${slot.id},${slot.status},${occ.vehicleNo || ''},${occ.type || ''},${occ.verified || ''},${occ.startTime || ''}\n`;
    });
    csv += `\nRevenue,${state.revenue}\n`;
    csv += '\nHistory,Message,Time,Color\n';
    state.history.forEach(h => {
        csv += `,${h.msg},${h.time},${h.color}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'smart_parking_dashboard.csv';
    a.click();
    showToast('CSV exported', 'success');
}

function exportCSVAdmin() {
    // We can use the same export logic, or add more admin-specific fields if needed.
    exportCSV();
}

// --- Chart.js Graph Logic ---
let modalChartInstance = null;
let activeGraph = null;

function toggleGraph(type) {
    const modal = document.getElementById('graphs-modal');
    modal.classList.remove('hidden');

    // Animate reveal
    setTimeout(() => {
        const content = modal.querySelector('#graphs-modal-content');
        if (content) {
            content.classList.add('scale-100', 'opacity-100');
            content.classList.remove('scale-95', 'opacity-0');
        }
    }, 10);

    activeGraph = type;

    // Update Modal Title dynamically based on selection
    const titleEl = document.getElementById('graph-modal-title');
    if (type === 'revenue') titleEl.innerHTML = `<i data-lucide="indian-rupee" class="w-5 h-5 text-green-400"></i> Revenue Analytics`;
    if (type === 'occupancy') titleEl.innerHTML = `<i data-lucide="bar-chart-3" class="w-5 h-5 text-blue-400"></i> Occupancy Analytics`;
    if (type === 'service') titleEl.innerHTML = `<i data-lucide="cone" class="w-5 h-5 text-yellow-400"></i> Service Analytics`;
    if (window.lucide) lucide.createIcons();

    initOrUpdateChart(type);
}

function closeGraphsModal() {
    const modal = document.getElementById('graphs-modal');
    const content = modal.querySelector('#graphs-modal-content');
    if (content) {
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
    }
    setTimeout(() => {
        modal.classList.add('hidden');
        activeGraph = null;
    }, 300);
}

function initOrUpdateChart(type) {
    const ctx = document.getElementById('modalChart').getContext('2d');
    const labelColor = '#9ca3af';
    const gridColor = '#374151';

    const building = state.analyticsFilter.building;
    const range = state.analyticsFilter.range;
    const filteredHistory = filterHistoryByRangeAndBuilding(state.history, range, building);

    let data = { labels: [], datasets: [] };
    let options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: labelColor } } }
    };

    if (type === 'revenue') {
        const payments = filteredHistory
            .filter(item => item.action === 'pay')
            .sort((a, b) => a.date - b.date);

        let labels = [];
        let bucketSums = [];

        if (range === 'today') {
            labels = ['12 AM', '2 AM', '4 AM', '6 AM', '8 AM', '10 AM', '12 PM', '2 PM', '4 PM', '6 PM', '8 PM', '10 PM'];
            bucketSums = Array(12).fill(0);
            payments.forEach(item => {
                const h = item.date.getHours();
                const bucketIndex = Math.floor(h / 2);
                if (bucketIndex >= 0 && bucketIndex < 12) bucketSums[bucketIndex] += item.amount;
            });
        } else if (range === 'week') {
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            labels = [];
            bucketSums = Array(7).fill(0);
            const now = new Date();
            now.setHours(23, 59, 59, 999);
            for (let i = 6; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                labels.push(dayNames[d.getDay()]);
            }
            payments.forEach(item => {
                const diffTime = now - item.date;
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays >= 0 && diffDays < 7) bucketSums[6 - diffDays] += item.amount;
            });
        } else {
            labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
            bucketSums = Array(4).fill(0);
            const now = new Date();
            now.setHours(23, 59, 59, 999);
            payments.forEach(item => {
                const diffTime = now - item.date;
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays >= 0 && diffDays < 30) {
                    let weekIndex = 3 - Math.floor(diffDays / 7.5);
                    weekIndex = Math.max(0, Math.min(3, weekIndex));
                    bucketSums[weekIndex] += item.amount;
                }
            });
        }

        let sum = 0;
        const values = bucketSums.map(v => {
            sum += v;
            return sum;
        });

        data = {
            labels: labels,
            datasets: [{
                label: 'Revenue (₹)',
                data: values,
                backgroundColor: 'rgba(74, 222, 128, 0.2)',
                borderColor: 'rgba(74, 222, 128, 1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4
            }]
        };
        options.scales = {
            x: { ticks: { color: labelColor }, grid: { color: gridColor } },
            y: { ticks: { color: labelColor }, grid: { color: gridColor } }
        };
    } else if (type === 'occupancy') {
        const filteredSlots = state.slots.filter(s => building === 'all' || s.building === building);
        const occupied = filteredSlots.filter(s => s.status === 'occupied').length;
        const available = filteredSlots.length - occupied;

        data = {
            labels: ['Occupied', 'Available'],
            datasets: [{
                label: 'Occupancy',
                data: [occupied, available],
                backgroundColor: ['rgba(239, 68, 68, 0.8)', 'rgba(74, 222, 128, 0.8)'],
                borderWidth: 0,
                hoverOffset: 4
            }]
        };
        options.cutout = '70%';
    } else if (type === 'service') {
        const filteredSlots = state.slots.filter(s => building === 'all' || s.building === building);
        const maintenance = filteredSlots.filter(s => s.status === 'maintenance').length;
        const inService = filteredSlots.length - maintenance;

        data = {
            labels: ['In Service', 'Maintenance'],
            datasets: [{
                label: 'Service Status',
                data: [inService, maintenance],
                backgroundColor: ['rgba(59, 130, 246, 0.8)', 'rgba(234, 179, 8, 0.8)'],
                borderWidth: 0,
                hoverOffset: 4
            }]
        };
        options.cutout = '70%';
    }

    if (modalChartInstance) {
        modalChartInstance.destroy();
    }

    const chartType = type === 'revenue' ? 'line' : 'doughnut';
    modalChartInstance = new Chart(ctx, { type: chartType, data: data, options: options });
}

function updateGraphs() {
    if (activeGraph && modalChartInstance) {
        initOrUpdateChart(activeGraph);
    }
}
function showToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    document.getElementById('toast-message').innerText = msg;
    document.getElementById('toast-icon-bg').className = `rounded-full p-1 ${type === 'error' ? 'bg-red-500' : type === 'success' ? 'bg-green-500' : 'bg-blue-500'}`;
    t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 3000);
}

// Camera Logic
async function startCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const v = document.getElementById('camera-feed');
        v.srcObject = stream;
        v.classList.remove('hidden');
        document.getElementById('cam-placeholder').classList.add('hidden');
        document.getElementById('btn-scan').classList.remove('hidden');
        document.getElementById('btn-start-cam').innerText = "STOP";
        document.getElementById('btn-start-cam').onclick = stopCamera;
        document.getElementById('btn-start-cam').classList.add('text-red-500', 'border-red-500');

        isDetecting = true;
        runDetectionLoop();
    } catch (e) { showToast("Cam Error", "error"); }
}

function stopCamera() {
    if (stream) stream.getTracks().forEach(t => t.stop()); stream = null;
    isDetecting = false;
    if (detectionTimeout) clearTimeout(detectionTimeout);

    // Clear overlay
    const canvas = document.getElementById('detection-canvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);

    document.getElementById('camera-feed').classList.add('hidden');
    document.getElementById('cam-placeholder').classList.remove('hidden');
    document.getElementById('btn-scan').classList.add('hidden');
    document.getElementById('btn-start-cam').innerText = "START CAM";
    document.getElementById('btn-start-cam').onclick = startCamera;
    document.getElementById('btn-start-cam').classList.remove('text-red-500', 'border-red-500');
}

async function runDetectionLoop() {
    if (!isDetecting || !stream) return;

    // Skip processing entirely if a scan is currently running to prevent canvas interference and save backend CPU
    if (window.isScanningLocked) {
        if (isDetecting) detectionTimeout = setTimeout(runDetectionLoop, 500);
        return;
    }

    const v = document.getElementById('camera-feed');
    const c = document.getElementById('camera-canvas');
    const overlay = document.getElementById('detection-canvas');
    const ctx = overlay.getContext('2d');

    if (v.readyState === v.HAVE_ENOUGH_DATA) {
        // Sync dimensions
        overlay.width = v.clientWidth;
        overlay.height = v.clientHeight;
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        c.getContext('2d').drawImage(v, 0, 0);

        // Capture frame
        c.toBlob(async (blob) => {
            if (!blob || !isDetecting) {
                if (isDetecting) detectionTimeout = setTimeout(runDetectionLoop, 200);
                return;
            }

            // Clear previous before drawing new ones
            ctx.clearRect(0, 0, overlay.width, overlay.height);

            const formData = new FormData();
            formData.append('image', blob, 'detect.jpg');

            try {
                const res = await fetch(`${BACKEND_URL}/detect`, { method: 'POST', body: formData });
                if (!res.ok) throw new Error(`Status ${res.status}`);
                const { bbox } = await res.json();

                if (isDetecting) {
                    ctx.clearRect(0, 0, overlay.width, overlay.height);
                    if (bbox) {
                        // Map video coordinates to overlay coordinates
                        const scaleX = overlay.width / v.videoWidth;
                        const scaleY = overlay.height / v.videoHeight;

                        ctx.strokeStyle = '#22c55e'; // green-500
                        ctx.lineWidth = 4;
                        ctx.strokeRect(bbox.x * scaleX, bbox.y * scaleY, bbox.w * scaleX, bbox.h * scaleY);

                        // Add subtle glow
                        ctx.shadowColor = 'rgba(34, 197, 94, 0.5)';
                        ctx.shadowBlur = 15;
                        ctx.stroke();

                        // Auto-scan logic: Trigger a full scan if a bbox is found, max once every 2.5 seconds
                        if (!window.isScanningLocked) {
                            if (!window.lastAutoScan || (Date.now() - window.lastAutoScan > 2500)) {
                                window.lastAutoScan = Date.now();
                                window.isScanningLocked = true;
                                performScan(true).finally(() => { 
                                    window.isScanningLocked = false; 
                                });
                            }
                        }
                    }
                }
            } catch (e) { 
                console.error("Detection error:", e); 
            } finally {
                // Schedule next frame ONLY after this request is completely finished!
                if (isDetecting) {
                    detectionTimeout = setTimeout(runDetectionLoop, 200);
                }
            }
        }, 'image/jpeg', 0.4); // Low quality for speed
    } else {
        // Video not ready, try again in 200ms
        detectionTimeout = setTimeout(runDetectionLoop, 200);
    }
}

// OCR Processing via FastAPI Backend
async function performScan(isAuto = false) {
    window.isScanningLocked = true;
    const v = document.getElementById('camera-feed');
    const c = document.getElementById('camera-canvas');
    const b = document.getElementById('btn-scan');

    if (!isAuto) {
        b.disabled = true;
        b.innerHTML = 'Scanning...';
    }

    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);

    // Convert canvas to a blob (image file)
    return new Promise((resolve) => {
        c.toBlob(async (blob) => {
            if (!blob) {
                window.isScanningLocked = false;
                if (!isAuto) showToast('Failed to capture frame', 'error');
                if (!isAuto) { b.disabled = false; b.innerText = 'SCAN BASEPLATE'; }
                return resolve();
            }

            const formData = new FormData();
            formData.append('image', blob, 'frame.jpg');

            try {
                // Send image to backend
                const response = await fetch(`${BACKEND_URL}/scan`, {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error(`Server error: ${response.status}`);
                }

                const result = await response.json();
                    const { plate, confidence } = result;

                if (result.success) {
                    if (isAuto && !isStableScan(plate, confidence)) return;
                    
                    // Log success to the system log
                    addLog(`SCAN PARSED: ${result.plate}`, 'system', { action: 'scan', plate: result.plate });

                    if (result.database_updated) {
                        showToast('MATCHED & VERIFIED', 'success');
                        addLog(`VERIFIED CLOUD: ${result.plate}`, 'success', { action: 'verify', plate: result.plate });
                    } else {
                        // Fallback for offline mode or missing Firebase backend config
                        if (ocrConfig.autoVerify) {
                            let matchFound = false;
                            for (let slot of state.slots) {
                                if (slot.status === 'occupied' && !slot.occupiedBy.verified) {
                                    let recNo = slot.occupiedBy.vehicleNo.toUpperCase().replace(/\s/g, '');
                                    if (result.plate.includes(recNo) || recNo.includes(result.plate)) {
                                        updateSlot(slot.id, 'occupied', { ...slot.occupiedBy, verified: true });
                                        addLog(`VERIFIED: ${slot.occupiedBy.vehicleNo} (Offline fallback)`, 'success', { action: 'verify', plate: slot.occupiedBy.vehicleNo, slotId: slot.id, building: slot.building });
                                        matchFound = true;
                                        break;
                                    }
                                }
                            }

                            if (matchFound) {
                                showToast('MATCHED & VERIFIED', 'success');
                            } else {
                                showToast(`Detected: ${result.plate} (No Unverified Match)`, 'info');
                            }
                        } else {
                            showToast(`Detected: ${result.plate} (Auto-Verify Disabled)`, 'info');
                        }
                    }
                } else {
                    showToast(result.message || 'No Match', 'error');
                }

            } catch (e) {
                console.error("Scan Error:", e);
                if (!isAuto) showToast('Backend Error. Is it running?', 'error');
            } finally {
                window.isScanningLocked = false;
                if (!isAuto) { b.disabled = false; b.innerText = 'SCAN BASEPLATE'; }
                resolve();
            }
        }, 'image/jpeg', 0.8);
    });
}

function isStableScan(plate, confidence = 0) {
    const normalized = normalizePlate(plate);
    if (!normalized || normalized.length < 6 || confidence < 35) return false;
    const now = Date.now();
    scanCandidates = scanCandidates.filter(item => now - item.time < 7000);
    scanCandidates.push({ plate: normalized, time: now });
    return scanCandidates.filter(item => item.plate === normalized).length >= 2 || confidence >= ocrConfig.threshold;
}

let charts = {
    revenue: null,
    occupancy: null,
    peaks: null,
    vehicles: null
};

const PALETTES = {
    neon: {
        revenue: { bg: 'rgba(34, 197, 94, 0.1)', border: '#22c55e' },
        occupancy: ['#ef4444', '#22c55e', '#eab308'],
        peaks: { bg: 'rgba(168, 85, 247, 0.4)', border: '#a855f7' },
        vehicles: ['#3b82f6', '#ec4899']
    },
    emerald: {
        revenue: { bg: 'rgba(16, 185, 129, 0.1)', border: '#10b981' },
        occupancy: ['#f43f5e', '#10b981', '#f59e0b'],
        peaks: { bg: 'rgba(14, 165, 233, 0.4)', border: '#0ea5e9' },
        vehicles: ['#0f766e', '#2dd4bf']
    },
    amber: {
        revenue: { bg: 'rgba(245, 158, 11, 0.1)', border: '#f59e0b' },
        occupancy: ['#dc2626', '#f59e0b', '#78350f'],
        peaks: { bg: 'rgba(234, 88, 12, 0.4)', border: '#ea580c' },
        vehicles: ['#b45309', '#fef08a']
    }
};

function switchAdminTab(tabName) {
    state.adminTab = tabName;

    // Stop camera and detection loops if switching away from camera tab
    if (tabName !== 'camera' && stream) {
        stopCamera();
    }

    // Toggle active state on buttons
    const btnSlots = document.getElementById('admin-tab-slots-btn');
    const btnCamera = document.getElementById('admin-tab-camera-btn');
    const btnAnalytics = document.getElementById('admin-tab-analytics-btn');

    const panelSlots = document.getElementById('admin-tab-slots-panel');
    const panelCamera = document.getElementById('admin-tab-camera-panel');
    const panelAnalytics = document.getElementById('admin-tab-analytics-panel');

    const activeBtnClass = "px-5 pb-3 text-center font-bold text-xs sm:text-sm border-b-2 border-yellow-500 text-yellow-400 flex items-center gap-2 transition-all uppercase tracking-wider";
    const inactiveBtnClass = "px-5 pb-3 text-center font-bold text-xs sm:text-sm border-b-2 border-transparent text-gray-500 hover:text-white flex items-center gap-2 transition-all uppercase tracking-wider";

    if (btnSlots) btnSlots.className = tabName === 'slots' ? activeBtnClass : inactiveBtnClass;
    if (btnCamera) btnCamera.className = tabName === 'camera' ? activeBtnClass : inactiveBtnClass;
    if (btnAnalytics) btnAnalytics.className = tabName === 'analytics' ? activeBtnClass : inactiveBtnClass;

    if (panelSlots) panelSlots.classList.toggle('hidden', tabName !== 'slots');
    if (panelCamera) panelCamera.classList.toggle('hidden', tabName !== 'camera');
    if (panelAnalytics) panelAnalytics.classList.toggle('hidden', tabName !== 'analytics');

    if (tabName === 'slots') {
        renderSlots('admin-grid');
        renderLog();
    } else if (tabName === 'camera') {
        renderLog();
        checkBackendStatus();
    } else if (tabName === 'analytics') {
        renderAnalyticsDashboard();
    }
    
    if (window.lucide) lucide.createIcons();
}

async function checkBackendStatus() {
    const badge = document.getElementById('backend-status-badge');
    if (!badge) return;

    badge.className = "ml-2 px-2 py-0.5 rounded text-[10px] font-mono bg-slate-950 text-yellow-500 border border-yellow-500/20 animate-pulse";
    badge.innerText = "Connecting...";

    try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 8000); // 8 second timeout

        const res = await fetch(`${BACKEND_URL}/debug`, { signal: controller.signal });
        clearTimeout(id);

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        if (data.tesseract_version) {
            badge.className = "ml-2 px-2 py-0.5 rounded text-[10px] font-mono bg-green-950/40 text-green-400 border border-green-500/20";
            badge.innerText = "OCR API Online";
        } else {
            badge.className = "ml-2 px-2 py-0.5 rounded text-[10px] font-mono bg-yellow-950/40 text-yellow-400 border border-yellow-500/20";
            badge.innerText = "OCR API Online (Tesseract Missing)";
            showToast("Tesseract is not installed on the backend!", "warning");
        }
    } catch (err) {
        badge.className = "ml-2 px-2 py-0.5 rounded text-[10px] font-mono bg-red-950/40 text-red-400 border border-red-500/20";
        badge.innerText = "API Offline";
        console.error("Backend check failed:", err);
        showToast("Backend connection failed. Check API URL.", "error");
    }
}

function parseHistoryItem(item) {
    let action = item.action;
    let amount = item.amount;
    let building = item.building || 'Building 1';
    let vehicleType = item.vehicleType || 'car';
    let dateObj = item.timestamp ? new Date(item.timestamp) : new Date();

    if (!action && item.msg) {
        const msg = String(item.msg);
        if (msg.startsWith('PAID:')) {
            action = 'pay';
            const match = msg.match(/PAID:\s*₹\s*(\d+)/);
            if (match) amount = parseInt(match[1]);
        } else if (msg.startsWith('PARK:')) {
            action = 'book';
        } else if (msg.startsWith('AUTO-BOOK:')) {
            action = 'book';
        } else if (msg.startsWith('OVERRIDE:')) {
            action = 'override';
        } else if (msg.startsWith('MAINTENANCE:')) {
            action = 'maintenance';
        }
    }

    return {
        action,
        amount: amount || 0,
        building,
        vehicleType,
        date: dateObj
    };
}

function filterHistoryByRangeAndBuilding(history, range, building) {
    const now = new Date();
    const cutoffDate = new Date();

    if (range === 'today') {
        cutoffDate.setHours(0, 0, 0, 0);
    } else if (range === 'week') {
        cutoffDate.setDate(now.getDate() - 7);
        cutoffDate.setHours(0, 0, 0, 0);
    } else if (range === 'month') {
        cutoffDate.setDate(now.getDate() - 30);
        cutoffDate.setHours(0, 0, 0, 0);
    }

    return history.map(parseHistoryItem).filter(item => {
        if (item.date < cutoffDate) return false;
        if (building !== 'all' && item.building !== building) return false;
        return true;
    });
}

function getAnalyticsData() {
    const building = state.analyticsFilter.building;
    const range = state.analyticsFilter.range;

    const filteredHistory = filterHistoryByRangeAndBuilding(state.history, range, building);

    const filteredSlots = state.slots.filter(s => building === 'all' || s.building === building);
    const occupied = filteredSlots.filter(s => s.status === 'occupied').length;
    const total = filteredSlots.length;
    const capacityPercent = total > 0 ? Math.round((occupied / total) * 100) : 0;

    const revenue = filteredHistory
        .filter(item => item.action === 'pay')
        .reduce((sum, item) => sum + item.amount, 0);

    const bookings = filteredHistory.filter(item => item.action === 'book' || item.action === 'override').length;

    return {
        revenue,
        occupied,
        total,
        capacityPercent,
        bookings,
        filteredHistory
    };
}

function renderAnalyticsDashboard() {
    const data = getAnalyticsData();

    document.getElementById('anal-kpi-revenue').innerText = `₹${data.revenue}`;
    document.getElementById('anal-kpi-occupancy').innerText = `${data.capacityPercent}%`;
    document.getElementById('anal-kpi-bookings').innerText = data.bookings;

    const palette = PALETTES[state.analyticsFilter.colorScheme] || PALETTES.neon;
    const gridColor = state.analyticsFilter.gridLines ? 'rgba(75, 85, 99, 0.2)' : 'rgba(0,0,0,0)';
    const labelColor = document.body.classList.contains('theme-light') ? '#4b5563' : '#9ca3af';

    renderRevenueChart(data, palette, gridColor, labelColor);
    renderOccupancyChart(palette, labelColor);
    renderPeaksChart(data.filteredHistory, palette, gridColor, labelColor);
    renderVehiclesChart(palette, labelColor);
}

function renderRevenueChart(data, palette, gridColor, labelColor) {
    const canvas = document.getElementById('chart-revenue');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const range = state.analyticsFilter.range;
    const filteredHistory = data.filteredHistory;

    let labels = [];
    let values = [];

    const payments = filteredHistory
        .filter(item => item.action === 'pay')
        .sort((a, b) => a.date - b.date);

    if (range === 'today') {
        labels = ['12 AM', '2 AM', '4 AM', '6 AM', '8 AM', '10 AM', '12 PM', '2 PM', '4 PM', '6 PM', '8 PM', '10 PM'];
        const bucketSums = Array(12).fill(0);
        payments.forEach(item => {
            const h = item.date.getHours();
            const bucketIndex = Math.floor(h / 2);
            if (bucketIndex >= 0 && bucketIndex < 12) {
                bucketSums[bucketIndex] += item.amount;
            }
        });
        let sum = 0;
        values = bucketSums.map(v => {
            sum += v;
            return sum;
        });
    } else if (range === 'week') {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        labels = [];
        const bucketSums = Array(7).fill(0);
        const now = new Date();
        now.setHours(23, 59, 59, 999);

        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            labels.push(dayNames[d.getDay()]);
        }

        payments.forEach(item => {
            const diffTime = now - item.date;
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays >= 0 && diffDays < 7) {
                bucketSums[6 - diffDays] += item.amount;
            }
        });

        let sum = 0;
        values = bucketSums.map(v => {
            sum += v;
            return sum;
        });
    } else {
        labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
        const bucketSums = Array(4).fill(0);
        const now = new Date();
        now.setHours(23, 59, 59, 999);

        payments.forEach(item => {
            const diffTime = now - item.date;
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays >= 0 && diffDays < 30) {
                let weekIndex = 3 - Math.floor(diffDays / 7.5);
                weekIndex = Math.max(0, Math.min(3, weekIndex));
                bucketSums[weekIndex] += item.amount;
            }
        });

        let sum = 0;
        values = bucketSums.map(v => {
            sum += v;
            return sum;
        });
    }

    if (charts.revenue) charts.revenue.destroy();

    const type = state.analyticsFilter.chartTypes.revenue || 'line';

    charts.revenue = new Chart(ctx, {
        type: type,
        data: {
            labels: labels,
            datasets: [{
                label: 'Revenue (₹)',
                data: values,
                backgroundColor: palette.revenue.bg,
                borderColor: palette.revenue.border,
                borderWidth: 2,
                fill: type === 'line',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: labelColor }, grid: { color: gridColor } },
                y: { ticks: { color: labelColor }, grid: { color: gridColor } }
            }
        }
    });
}

function renderOccupancyChart(palette, labelColor) {
    const canvas = document.getElementById('chart-occupancy');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const building = state.analyticsFilter.building;

    const filteredSlots = state.slots.filter(s => building === 'all' || s.building === building);
    const occupied = filteredSlots.filter(s => s.status === 'occupied').length;
    const available = filteredSlots.filter(s => s.status === 'available').length;
    const maintenance = filteredSlots.filter(s => s.status === 'maintenance').length;

    if (charts.occupancy) charts.occupancy.destroy();

    charts.occupancy = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Occupied', 'Available', 'Maintenance'],
            datasets: [{
                data: [occupied, available, maintenance],
                backgroundColor: palette.occupancy,
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { 
                    position: 'bottom',
                    labels: { color: labelColor, boxWidth: 12, font: { size: 11 } } 
                } 
            },
            cutout: '70%'
        }
    });
}

function renderPeaksChart(filteredHistory, palette, gridColor, labelColor) {
    const canvas = document.getElementById('chart-peaks');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const type = state.analyticsFilter.chartTypes.peaks || 'bar';

    const labels = ['08am', '10am', '12pm', '02pm', '04pm', '06pm', '08pm'];
    const bucketCounts = Array(7).fill(0);

    const bookings = filteredHistory.filter(item => item.action === 'book' || item.action === 'override');
    bookings.forEach(item => {
        const h = item.date.getHours();
        let index = -1;
        if (h >= 8 && h < 10) index = 0;
        else if (h >= 10 && h < 12) index = 1;
        else if (h >= 12 && h < 14) index = 2;
        else if (h >= 14 && h < 16) index = 3;
        else if (h >= 16 && h < 18) index = 4;
        else if (h >= 18 && h < 20) index = 5;
        else if (h >= 20 && h < 22) index = 6;
        else if (h < 8) index = 0;
        else if (h >= 22) index = 6;

        if (index >= 0 && index < 7) {
            bucketCounts[index]++;
        }
    });

    if (charts.peaks) charts.peaks.destroy();

    charts.peaks = new Chart(ctx, {
        type: type,
        data: {
            labels: labels,
            datasets: [{
                label: 'Peak Hour Bookings',
                data: bucketCounts,
                backgroundColor: type === 'bar' ? palette.peaks.border : palette.peaks.bg,
                borderColor: palette.peaks.border,
                borderWidth: 2,
                fill: type === 'line',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: labelColor }, grid: { color: gridColor } },
                y: { ticks: { color: labelColor }, grid: { color: gridColor } }
            }
        }
    });
}

function renderVehiclesChart(palette, labelColor) {
    const canvas = document.getElementById('chart-vehicles');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const building = state.analyticsFilter.building;

    const filteredSlots = state.slots.filter(s => building === 'all' || s.building === building);
    const cars = filteredSlots.filter(s => s.status === 'occupied' && s.occupiedBy?.type === 'car').length;
    const bikes = filteredSlots.filter(s => s.status === 'occupied' && s.occupiedBy?.type === 'bike').length;

    if (charts.vehicles) charts.vehicles.destroy();

    charts.vehicles = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: ['Cars', 'Bikes'],
            datasets: [{
                data: [cars, bikes],
                backgroundColor: palette.vehicles,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { 
                    position: 'bottom',
                    labels: { color: labelColor, boxWidth: 12, font: { size: 11 } } 
                } 
            }
        }
    });
}

function setAnalyticsBuilding(bName) {
    state.analyticsFilter.building = bName;
    ['all', 'b1', 'b2'].forEach(id => {
        const btn = document.getElementById(`anal-b-${id}`);
        if (!btn) return;
        const isActive = (id === 'all' && bName === 'all') || (id === 'b1' && bName === 'Building 1') || (id === 'b2' && bName === 'Building 2');
        btn.className = isActive 
            ? "px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all bg-slate-800 text-white shadow-sm"
            : "px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all text-gray-500 hover:text-white";
    });
    renderAnalyticsDashboard();
}

function setAnalyticsRange(range) {
    state.analyticsFilter.range = range;
    ['today', 'week', 'month'].forEach(id => {
        const btn = document.getElementById(`anal-r-${id}`);
        if (!btn) return;
        const isActive = id === range;
        btn.className = isActive 
            ? "px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all bg-slate-800 text-white shadow-sm"
            : "px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all text-gray-500 hover:text-white";
    });
    renderAnalyticsDashboard();
}

function toggleAnalyticsGridLines() {
    state.analyticsFilter.gridLines = document.getElementById('toggle-gridlines').checked;
    renderAnalyticsDashboard();
}

function changeAnalyticsPalette(palette) {
    state.analyticsFilter.colorScheme = palette;
    renderAnalyticsDashboard();
}

function toggleChartType(chartKey, type) {
    state.analyticsFilter.chartTypes[chartKey] = type;
    renderAnalyticsDashboard();
}

function focusAnalyticsChart(chartKey) {
    const el = document.getElementById(`chart-card-${chartKey === 'vehicles' ? 'vehicles' : chartKey}`);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-yellow-500');
        setTimeout(() => el.classList.remove('ring-2', 'ring-yellow-500'), 1500);
    }
}

// Initialize on load
getLocalUsers();
updateAuthHint();

window.addEventListener('firebase-ready', () => {
    updateAuthHint();
});

const lastOfflineUser = localStorage.getItem('parking_offline_user');
if (window.isOffline && lastOfflineUser) {
    try {
        const user = JSON.parse(lastOfflineUser);
        const localKey = `parking_profile_${user.uid}`;
        const profile = JSON.parse(localStorage.getItem(localKey));
        if (user && profile) {
            enterPortal(user, profile);
            loadOfflineData();
            refreshUI();
        }
    } catch (e) {
        console.error("Session restore failed", e);
        localStorage.removeItem('parking_offline_user');
    }
}

if (window.firebaseInitialized) window.initRealtime();
if (state.currentUser) switchView(state.view);
else if (window.lucide) lucide.createIcons();
