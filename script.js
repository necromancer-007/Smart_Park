// --- Constants & State ---
const RATES = { car: 50, bike: 20 };
const TOTAL_SLOTS = 12;
let stream = null;
let isRealtimeReady = false;
let isDetecting = false;
let detectionTimeout = null;

// Backend API URL (Dynamically targets the same host on port 8000, or localhost if opened directly)
// Backend API URL (Hardcoded to local machine to work from GitHub Pages)
const BACKEND_URL = 'http://127.0.0.1:8000';

const USERS = { 'driver': '123', 'admin': '123' };

let state = {
    currentUser: null,
    view: 'login',
    slots: Array.from({ length: TOTAL_SLOTS }, (_, i) => ({
        id: i + 1, status: 'available', occupiedBy: null, type: 'standard'
    })),
    revenue: 0,
    history: [],
    selectedSlot: null
};

// UI Helpers
function openConfigModal() {
    document.getElementById('config-modal').classList.remove('hidden');
    const current = localStorage.getItem('parking_firebase_config');
    if (current) document.getElementById('config-input').value = current;
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

    window.auth.onAuthStateChanged(async (user) => {
        if (user) {
            const statusEl = document.getElementById('connection-status');
            if (statusEl) statusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-green-500 live-dot"></span> Live`;

            isRealtimeReady = true;
            // Using fixed path so both devices hit same doc
            const docRef = window.doc(window.db, 'parking_data', 'main_lot_v1');

            window.onSnapshot(docRef, (snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.data();
                    console.log("🔥 Update");
                    state = { ...state, slots: data.slots, revenue: data.revenue, history: data.history };
                    refreshUI();
                } else {
                    saveData(); // Init
                }
            }, (err) => {
                console.error(err);
                if (statusEl) statusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-red-500"></span> Sync Error`;
            });
        }
    });
}

async function saveData() {
    if (window.isOffline) return;
    if (!window.db || !window.auth.currentUser) return;

    const docRef = window.doc(window.db, 'parking_data', 'main_lot_v1');
    const sharedState = { slots: state.slots, revenue: state.revenue, history: state.history };

    try { await window.setDoc(docRef, sharedState); }
    catch (e) { console.error("Save failed", e); }
}

function resetSystem() {
    if (confirm("Confirm System Reset?")) {
        state.slots = Array.from({ length: TOTAL_SLOTS }, (_, i) => ({ id: i + 1, status: 'available', occupiedBy: null, type: 'standard' }));
        state.revenue = 0; state.history = [];
        addLog("RESET PERFORMED", "alert");
        saveData(); refreshUI();
    }
}

// --- Auth Logic ---
function login() {
    const user = document.getElementById('login-user').value.trim();
    const pass = document.getElementById('login-pass').value.trim();

    if (USERS[user] && USERS[user] === pass) {
        state.currentUser = user;
        state.view = user === 'admin' ? 'admin' : 'user';
        showToast(`Welcome back, ${user}`, 'success');
        switchView(state.view);
        if (window.firebaseInitialized || window.isOffline) window.initRealtime();
    } else {
        showToast('Invalid Credentials', 'error');
    }
}

function logout() {
    state.currentUser = null; state.view = 'login';
    if (stream) stopCamera();
    switchView('login');
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
        document.getElementById('username-span').innerText = state.currentUser === 'admin' ? 'Admin' : 'Driver';

        if (viewName === 'user') {
            document.getElementById('user-view').classList.remove('hidden');
            renderSlots('user-grid');
        } else if (viewName === 'admin') {
            document.getElementById('admin-view').classList.remove('hidden');
            renderSlots('admin-grid');
            renderStats();
            renderLog();
        }
        // Clear search bars
        const s1 = document.getElementById('slot-search');
        const s2 = document.getElementById('admin-slot-search');
        if (s1) s1.value = '';
        if (s2) s2.value = '';
    }
    if (window.lucide) lucide.createIcons();
}

function renderSlots(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    state.slots.forEach((slot) => {
        const div = document.createElement('div');
        let colorClass = "", iconHtml = "";

        if (slot.status === 'maintenance') {
            colorClass = "slot-maintenance";
            iconHtml = `<i data-lucide="cone" class="w-6 h-6 mb-2 text-yellow-500 drop-shadow-md"></i><span class='text-yellow-500 font-mono text-[10px] bg-slate-900 px-1 rounded border border-gray-700'>MAINTENANCE</span>`;
        } else if (slot.status === 'occupied') {
            colorClass = "slot-occupied";
            const verified = slot.occupiedBy?.verified ? `<div class="absolute top-2 right-2 text-green-400"><i data-lucide="shield-check" class="w-3 h-3"></i></div>` : '';
            iconHtml = `${verified}<i data-lucide="${slot.occupiedBy?.type === 'bike' ? 'bike' : 'car-front'}" class="w-8 h-8 mb-2 text-red-500"></i><span class="text-[10px] font-bold font-mono text-white tracking-widest bg-slate-900 px-2 py-1 rounded border border-gray-700">${slot.occupiedBy?.vehicleNo}</span>`;
        } else {
            colorClass = "slot-available group";
            iconHtml = `<div class="text-green-500/30 group-hover:text-green-500 transition-colors"><span class="text-2xl font-black font-mono opacity-50">${String(slot.id).padStart(2, '0')}</span></div><span class='text-green-500 font-bold text-[10px] uppercase tracking-wider mt-1'>Open</span>`;
        }

        div.className = `p-4 rounded-xl border-2 border-dashed flex flex-col items-center justify-center transition-all duration-300 min-h-[110px] relative overflow-hidden ${colorClass}`;
        div.innerHTML = iconHtml;
        div.onclick = () => handleSlotClick(slot);
        container.appendChild(div);
    });
    if (window.lucide) lucide.createIcons();
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
        html = `${header(`Book Slot ${String(state.selectedSlot).padStart(2, '0')}`)}
            <div class="p-6 space-y-5">
                <div class="grid grid-cols-2 gap-3">
                    <label class="cursor-pointer"><input type="radio" name="vType" value="car" class="peer sr-only" checked><div class="p-3 border border-gray-700 bg-slate-800 rounded-xl text-center peer-checked:border-yellow-500 peer-checked:text-yellow-400"><i data-lucide="car-front" class="w-6 h-6 mx-auto mb-1"></i><span class="text-xs font-bold">Car (₹${RATES.car}/hr)</span></div></label>
                    <label class="cursor-pointer"><input type="radio" name="vType" value="bike" class="peer sr-only"><div class="p-3 border border-gray-700 bg-slate-800 rounded-xl text-center peer-checked:border-yellow-500 peer-checked:text-yellow-400"><i data-lucide="bike" class="w-6 h-6 mx-auto mb-1"></i><span class="text-xs font-bold">Bike (₹${RATES.bike}/hr)</span></div></label>
                </div>
                <input type="text" id="vNo" placeholder="PLATE NO (AP 05 AB 1234)" class="w-full bg-slate-950 text-white px-4 py-3 rounded-xl border border-gray-700 uppercase font-mono outline-none">
                <button onclick="userPark()" class="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-black py-3 rounded-xl uppercase mt-2">Confirm</button>
            </div>`;
    } else if (type === 'user-pay') {
        const total = Math.max(1, Math.ceil((new Date() - new Date(data.occupiedBy.startTime)) / 36e5)) * (data.occupiedBy.type === 'car' ? RATES.car : RATES.bike);
        html = `${header('Checkout')}<div class="p-6 text-center"><h2 class="text-5xl font-black text-white font-mono mb-2">₹${total}</h2><button onclick="processPayment(${data.id}, ${total})" class="w-full bg-green-500 hover:bg-green-400 text-black font-black py-3 rounded-xl uppercase">Pay Now</button></div>`;
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
    const vNo = document.getElementById('quickVNo').value.trim().toUpperCase();
    if (!vNo) return showToast('Please enter a License Plate', 'error');

    // Find first available slot
    const availableSlot = state.slots.find(s => s.status === 'available');

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

    addLog(`AUTO-BOOK: Slot ${availableSlot.id} for ${vNo}`, 'user');

    // Clear the input
    document.getElementById('quickVNo').value = '';

    showToast(`Assigned Slot ${String(availableSlot.id).padStart(2, '0')} successfully!`, 'success');
}

function userPark() {
    const vNo = document.getElementById('vNo').value.toUpperCase();
    if (!vNo) return showToast('Plate Required', 'error');
    updateSlot(state.selectedSlot, 'occupied', { vehicleNo: vNo, type: document.querySelector('input[name="vType"]:checked').value, startTime: new Date().toISOString(), verified: false });
    addLog(`PARK: ${vNo}`, 'user'); closeModal(); showToast('Booked', 'success');
}
function processPayment(id, amt) { updateSlot(id, 'available', null); state.revenue += amt; addLog(`PAID: ₹${amt}`, 'success'); saveData(); closeModal(); showToast('Paid', 'success'); }
function toggleMaintenance(id) { updateSlot(id, state.slots.find(x => x.id === id).status === 'maintenance' ? 'available' : 'maintenance', null); addLog(`MAINTENANCE: ${id}`, 'system'); closeModal(); }
function emergencyBookSetup() { openModal('emergency-form'); }
function confirmEmergencyBook() { updateSlot(state.selectedSlot, 'occupied', { vehicleNo: document.getElementById('e-vNo').value.toUpperCase(), type: 'car', startTime: new Date().toISOString(), verified: true }); addLog('OVERRIDE', 'alert'); closeModal(); }

function updateSlot(id, status, data) {
    const i = state.slots.findIndex(s => s.id === id);
    state.slots[i].status = status; state.slots[i].occupiedBy = data;
    saveData(); refreshUI();
}

function refreshUI() {
    if (state.view === 'user') renderSlots('user-grid');
    if (state.view === 'admin') { renderSlots('admin-grid'); renderStats(); }
}

function renderStats() {
    document.getElementById('admin-revenue').innerText = `₹${state.revenue}`;
    const occ = state.slots.filter(s => s.status === 'occupied').length;
    const total = state.slots.length;
    const main = state.slots.filter(s => s.status === 'maintenance').length;
    document.getElementById('admin-occupancy').innerHTML = `${occ}<span class="text-gray-600 text-lg">/${total}</span>`;
    document.getElementById('admin-maintenance').innerText = main;

    // Also update graphs if they exist
    if (typeof updateGraphs === 'function') updateGraphs();
}

function addLog(msg, type) {
    const colors = { alert: 'text-red-400', success: 'text-green-400', system: 'text-blue-400', user: 'text-yellow-400' };
    state.history.unshift({ msg, time: new Date().toLocaleTimeString(), color: colors[type] || 'text-gray-400' });
    saveData(); renderLog();
}

function renderLog() {
    const el = document.getElementById('activity-log');
    if (el) el.innerHTML = state.history.length ? state.history.map(i => `<div class="border-b border-gray-900/50 pb-1 mb-1 log-entry flex items-start gap-2"><span class="text-gray-600 shrink-0">[${i.time}]</span><span class="${i.color}">${i.msg}</span></div>`).join('') : '<p class="text-gray-600 text-center py-4 italic">Ready...</p>';
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

    // Check current theme for dynamic colors
    const labelColor = '#9ca3af'; // Always use light text on dark background
    const gridColor = '#374151';

    // Basic Chart Data with dark mode friendly options
    let data = { labels: [], datasets: [] };
    let options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: labelColor } } },
        scales: type === 'revenue' ? {
            x: { ticks: { color: labelColor }, grid: { color: gridColor } },
            y: { ticks: { color: labelColor }, grid: { color: gridColor } }
        } : {}
    };

    if (type === 'revenue') {
        data = {
            labels: ['Today', 'Yesterday', 'Past 7 Days'],
            datasets: [{
                label: 'Revenue (₹)',
                data: [state.revenue, state.revenue * 0.8, state.revenue * 4.5], // Demo data calculation
                backgroundColor: 'rgba(74, 222, 128, 0.2)',
                borderColor: 'rgba(74, 222, 128, 1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4
            }]
        };
    } else if (type === 'occupancy') {
        let occ = 0; let total = state.slots.length;
        state.slots.forEach(s => { if (s.status === 'occupied') occ++; });
        let available = total - occ;

        data = {
            labels: ['Occupied', 'Available'],
            datasets: [{
                label: 'Occupancy',
                data: [occ, available],
                backgroundColor: ['rgba(239, 68, 68, 0.8)', 'rgba(74, 222, 128, 0.8)'],
                borderWidth: 0,
                hoverOffset: 4
            }]
        };
        options.cutout = '70%'; // Doughnut
    } else if (type === 'service') {
        let maintenance = 0;
        state.slots.forEach(s => { if (s.status === 'maintenance') maintenance++; });

        data = {
            labels: ['In Service', 'Maintenance'],
            datasets: [{
                label: 'Service Status',
                data: [state.slots.length - maintenance, maintenance],
                backgroundColor: ['rgba(59, 130, 246, 0.8)', 'rgba(234, 179, 8, 0.8)'],
                borderWidth: 0,
                hoverOffset: 4
            }]
        };
        options.cutout = '70%'; // Doughnut
    }

    // Destroy existing chart if present to re-render clean
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
            if (!blob || !isDetecting) return;

            // Clear previous before drawing new ones
            if (isDetecting) ctx.clearRect(0, 0, overlay.width, overlay.height);

            const formData = new FormData();
            formData.append('image', blob, 'detect.jpg');

            try {
                const res = await fetch(`${BACKEND_URL}/detect`, { method: 'POST', body: formData });
                const { bbox } = await res.json();

                ctx.clearRect(0, 0, overlay.width, overlay.height);
                if (bbox && isDetecting) {
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
            } catch (e) { console.error("Detection error"); }
        }, 'image/jpeg', 0.5); // Low quality for speed
    }

    detectionTimeout = setTimeout(runDetectionLoop, 200); // 5 FPS
}

// OCR Processing via FastAPI Backend
async function performScan(isAuto = false) {
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
                const { plate, bbox } = result;

                if (result.success) {
                    // Log success to the system log
                    addLog(`SCAN PARSED: ${result.plate}`, 'system');

                    if (result.database_updated) {
                        showToast('MATCHED & VERIFIED', 'success');
                        addLog(`VERIFIED CLOUD: ${result.plate}`, 'success');
                    } else {
                    // Fallback for offline mode or missing Firebase backend config
                    let matchFound = false;
                    for (let slot of state.slots) {
                        if (slot.status === 'occupied' && !slot.occupiedBy.verified) {
                            let recNo = slot.occupiedBy.vehicleNo.toUpperCase().replace(/\s/g, '');
                            if (result.plate.includes(recNo) || recNo.includes(result.plate)) {
                                updateSlot(slot.id, 'occupied', { ...slot.occupiedBy, verified: true });
                                addLog(`VERIFIED: ${slot.occupiedBy.vehicleNo} (Offline fallback)`, 'success');
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
                }
            } else {
                showToast(result.message || 'No Match', 'error');
            }

            } catch (e) {
                console.error("Scan Error:", e);
                if (!isAuto) showToast('Backend Error. Is it running?', 'error');
            } finally {
                if (!isAuto) { b.disabled = false; b.innerText = 'SCAN BASEPLATE'; }
                resolve();
            }
        }, 'image/jpeg', 0.8);
    });
}

// Initialize on load
if (state.currentUser) switchView(state.view);
else if (window.lucide) lucide.createIcons();
