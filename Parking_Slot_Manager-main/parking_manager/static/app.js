const API = 'http://localhost:5000/api';
let currentPage = 'dashboard';
let revenueChart = null;
let allSlots = [];
let allVehicles = [];
let allTransactions = [];
let currentSlotId = null;
let lastRevenueData = [];

// ── THEME MANAGEMENT ────────────────────────────
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  const theme = savedTheme || (systemPrefersDark.matches ? 'dark' : 'light');
  applyTheme(theme);
  
  // Watch for system theme changes
  systemPrefersDark.addEventListener('change', e => {
    if(!localStorage.getItem('theme')) {
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });
  
  // Sync across tabs
  window.addEventListener('storage', (e) => {
    if (e.key === 'theme') applyTheme(e.newValue);
  });
}

function applyTheme(theme) {
  const body = document.body;
  const icon = document.getElementById('theme-toggle-icon');
  const text = document.getElementById('theme-toggle-text');
  
  if (theme === 'light') {
    body.classList.add('light-mode');
    if (icon) icon.innerText = '🌙';
    if (text) text.innerText = 'Switch to Dark Mode';
  } else {
    body.classList.remove('light-mode');
    if (icon) icon.innerText = '☀️';
    if (text) text.innerText = 'Switch to Light Mode';
  }
  
  localStorage.setItem('theme', theme);
  if (revenueChart && lastRevenueData.length > 0) renderRevenueChart(lastRevenueData);
}

function toggleTheme() {
  const isLight = document.body.classList.contains('light-mode');
  applyTheme(isLight ? 'dark' : 'light');
}

// ── PARTICLES INIT ──────────────────────────────
async function initParticles() {
  await tsParticles.load("tsparticles", {
    background: { color: { value: "transparent" } },
    fullScreen: { enable: false },
    fpsLimit: 60,
    particles: {
      number: { value: 80, density: { enable: true, width: 800, height: 800 } },
      color: { value: "#ffffff" },
      opacity: {
        value: { min: 0.1, max: 0.6 },
        animation: { enable: true, speed: 3, sync: false }
      },
      size: { value: { min: 0.4, max: 1.4 } },
      move: {
        enable: true, speed: 0.6, direction: "top",
        random: true, straight: false, outModes: { default: "out" }
      },
      shape: { type: "circle" }
    },
    detectRetina: true
  });
}

// ── NAVIGATION ──────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page-content > section').forEach(sec => sec.classList.add('hidden'));
  document.getElementById(`page-${name}`).classList.remove('hidden');
  
  document.querySelectorAll('.nav-link').forEach(link => {
    if(link.dataset.page === name) link.classList.add('active');
    else link.classList.remove('active');
  });
  
  const titleMap = {
    'dashboard': 'Dashboard',
    'slots': 'Parking Slots',
    'reservations': 'Reservations',
    'vehicles': 'Vehicles',
    'transactions': 'Transactions',
    'alerts': 'System Alerts',
    'settings': 'System Settings'
  };
  document.getElementById('page-title').innerText = titleMap[name] || name;
  currentPage = name;
  
  if(window.innerWidth < 768) {
    document.querySelector('.sidebar').classList.remove('open');
  }
  
  loadPageData(name);
}

function goToSlot(slotId) {
  showPage('slots');
  // Small delay to ensure the DOM is ready if it was hidden
  setTimeout(() => {
    openSlotModal(slotId);
  }, 150);
}

async function loadPageData(name) {
  switch(name) {
    case 'dashboard': await loadDashboard(); break;
    case 'slots': await loadSlots(); break;
    case 'reservations': await loadReservations(); break;
    case 'vehicles': await loadVehicles(); break;
    case 'transactions': await loadTransactions(); break;
    case 'alerts': await loadAlerts(); break;
    case 'settings': await loadSettings(); await loadBlacklist(); break;
    case 'memberships': await loadMemberships(); break;
  }
}

// ── SHIFT MANAGEMENT ────────────────────────────
async function loadShiftStatus() {
  try {
    const res = await fetch(`${API}/shift/status`);
    const data = await res.json();
    const btn = document.getElementById('btn-shift-drawer');
    btn.classList.remove('hidden');
    
    if(data.isOpen) {
      btn.innerText = `Shift: OPEN (₹ ${data.expected_cash})`;
      btn.classList.add('border-[#10b981]', 'text-[#10b981]');
      btn.classList.remove('border-[#f59e0b]', 'text-[#f59e0b]');
    } else {
      btn.innerText = `Shift: OFFLINE (Click to Open)`;
      btn.classList.add('border-[#f59e0b]', 'text-[#f59e0b]');
      btn.classList.remove('border-[#10b981]', 'text-[#10b981]');
    }
  } catch(e){}
}

window.openShiftModal = async function openShiftModal() {
  const res = await fetch(`${API}/shift/status`);
  const data = await res.json();
  if(!data.isOpen) {
    const res2 = await fetch(`${API}/shift/open`, {method:'POST'});
    const d2 = await res2.json();
    showToast(`Shift ${d2.id} Opened!`, "success");
    loadShiftStatus();
  } else {
    document.getElementById('shift-start-time').innerText = formatDateTime(data.start_time);
    document.getElementById('shift-expected-cash').innerText = `₹ ${data.expected_cash.toFixed(2)}`;
    openModal('modal-shift');
  }
}

document.getElementById('btn-close-shift').addEventListener('click', async() => {
  const res = await fetch(`${API}/shift/close`, {method:'POST'});
  if(res.ok) {
    const data = await res.json();
    closeAllModals(); showToast(`Shift Closed. Expected: ₹ ${data.expected_cash}`, "success");
    loadShiftStatus();
  }
});
setInterval(loadShiftStatus, 15000);
setTimeout(loadShiftStatus, 500);

// ── DASHBOARD ───────────────────────────────────
async function loadDashboard() {
  try {
    const res = await fetch(`${API}/dashboard`);
    const data = await res.json();
    renderStatCards(data.counts);
    renderOccupancyBar(data.occupancy_pct);
    renderZoneBars(data.zone_stats);
    renderRevenueChart(data.revenue_7days);
    renderPeakHour(data.peak_hour);
    renderTopSlot(data.top_slot);
    renderRecentActivity(data.recent_activity);
    
    document.getElementById('available-count').innerText = data.counts.available;
    document.getElementById('occupied-count').innerText = data.counts.occupied;
  } catch(e) { console.error("Dashboard error", e); }
}

function renderStatCards(c) {
  document.getElementById('dashboard-total').innerText = c.total;
  document.getElementById('dashboard-available').innerText = c.available;
  document.getElementById('dashboard-occupied').innerText = c.occupied;
  document.getElementById('dashboard-reserved').innerText = c.reserved;
  document.getElementById('dashboard-maintenance').innerText = c.maintenance;
}

function renderOccupancyBar(pct) {
  document.getElementById('occupancy-bar').style.width = pct + '%';
  document.getElementById('occupancy-text').innerText = pct.toFixed(1) + '%';
}

function renderZoneBars(stats) {
  for(let z of ['A','B','C','D']) {
    let t = stats[z].total;
    let o = stats[z].occupied;
    let pct = t > 0 ? (o/t*100) : 0;
    let bar = document.getElementById(`zone-${z.toLowerCase()}-bar`);
    let txt = document.getElementById(`zone-${z.toLowerCase()}-text`);
    if(bar) bar.style.width = pct + '%';
    if(txt) txt.innerText = Math.round(pct) + '%';
  }
}

function renderRevenueChart(data) {
  lastRevenueData = data;
  const ctx = document.getElementById('revenue-chart').getContext('2d');
  if(revenueChart) revenueChart.destroy();
  
  const isLight = document.body.classList.contains('light-mode');
  const textColor = isLight ? '#475569' : '#94a3b8';
  const gridColor = isLight ? '#e2e8f0' : '#1e2a3a';
  const barColor = '#00d4ff';

  Chart.defaults.color = textColor;
  revenueChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.date.substring(5)),
      datasets: [{
        label: 'Revenue (₹)',
        data: data.map(d => d.revenue),
        backgroundColor: barColor,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { 
          beginAtZero: true, 
          grid: { color: gridColor },
          ticks: { color: textColor }
        },
        x: { 
          grid: { display: false },
          ticks: { color: textColor }
        }
      },
      plugins: { 
        legend: { display:false },
        tooltip: {
          backgroundColor: isLight ? '#ffffff' : '#111827',
          titleColor: isLight ? '#0f172a' : '#f1f5f9',
          bodyColor: isLight ? '#0f172a' : '#f1f5f9',
          borderColor: isLight ? '#e2e8f0' : '#1e2a3a',
          borderWidth: 1
        }
      }
    }
  });
}

function renderPeakHour(hour) {
  document.getElementById('peak-hour').innerText = hour;
}
function renderTopSlot(slot) {
  document.getElementById('top-slot').innerText = slot;
}
function renderRecentActivity(items) {
  const list = document.getElementById('recent-activity-list');
  list.innerHTML = '';
  items.forEach(item => {
    let li = document.createElement('li');
    li.className = "flex gap-3 items-center py-2 border-b border-[#1e2a3a] last:border-0";
    let icon = item.type === 'checkin' ? '🚗' : item.type === 'checkout' ? '💳' : item.type === 'reservation' ? '📅' : 'ℹ';
    li.innerHTML = `
      <div class="text-xl">${icon}</div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis">${item.message} ${item.slot ? '(Slot '+item.slot+')' : ''}</div>
        <div class="text-xs text-[#64748b]">${formatTime(item.time)} ${item.fee ? '· ₹'+item.fee : ''}</div>
      </div>
    `;
    list.appendChild(li);
  });
}

// ── SLOTS ────────────────────────────────────────
async function loadSlots() {
  const z = document.getElementById('filter-zone').value;
  const f = document.getElementById('filter-floor').value;
  const t = document.getElementById('filter-type').value;
  const s = document.getElementById('filter-status').value;
  const q = new URLSearchParams({zone:z, floor:f, type:t, status:s});
  
  try {
    const res = await fetch(`${API}/slots?${q}`);
    const data = await res.json();
    allSlots = data;
    renderSlots(data);
  } catch(e){}
}

function renderSlots(slots) {
  const grid = document.getElementById('slots-grid');
  grid.innerHTML = '';
  
  const groups = {};
  slots.forEach(s => {
    if(!groups[s.zone]) groups[s.zone] = [];
    groups[s.zone].push(s);
  });
  
  Object.keys(groups).sort().forEach(z => {
    let zLabel = document.createElement('div');
    zLabel.className = 'zone-label';
    zLabel.innerText = `Zone ${z} (${groups[z].length} slots)`;
    
    let zGrid = document.createElement('div');
    zGrid.className = 'grid-slots mb-8';
    
    groups[z].forEach(s => {
      zGrid.innerHTML += buildSlotCard(s);
    });
    
    grid.appendChild(zLabel);
    grid.appendChild(zGrid);
  });
}

function getStatusClass(st) {
  if(st === 'available') return 'slot-available';
  if(st === 'occupied') return 'slot-occupied';
  if(st === 'reserved') return 'slot-reserved';
  return 'slot-maintenance';
}

function getTypeEmoji(type) {
  const m = { 'standard':'🚗', 'handicap':'♿', 'ev':'⚡', 'vip':'👑', 'compact':'🔹' };
  return m[type.toLowerCase()] || '🚗';
}

function buildSlotCard(s) {
  const sClass = getStatusClass(s.status);
  const dotClass = s.sensor_status === 'online' ? 'text-[#00e676]' : 'text-[#ff4444]';
  let middle = `<div class="text-3xl my-2 text-center opacity-80">${getTypeEmoji(s.type)}</div>`;
  
  if(s.status === 'occupied') {
    middle = `
      <div class="text-center mt-2">
        <div class="text-sm font-bold text-[var(--cyan)]">${s.plate}</div>
        <div class="live-timer text-xs text-[var(--text-primary)] mt-1 pt-1 border-t border-[var(--border)]" data-entry="${s.entry_time}">--m --s</div>
      </div>
    `;
  } else if(s.status === 'reserved') {
    let t = s.reserved_until ? formatTime(s.reserved_until) : '--:--';
    middle = `<div class="text-center mt-3 text-xs text-[#ffaa00] font-bold">Reserved until<br>${t}</div>`;
  } else if(s.status === 'maintenance') {
    middle = `<div class="text-center mt-3 text-xs text-[#94a3b8]">🔧 Maint.</div>`;
  }
  
  return `
    <div class="slot-card ${sClass}" onclick="openSlotModal('${s.id}')">
      <div class="flex justify-between items-start">
        <span class="font-bold text-lg leading-none m-0 p-0">${s.id}</span>
        <span class="${dotClass} text-[10px]">● ${s.sensor_status}</span>
      </div>
      <div class="flex-1 flex flex-col justify-center">${middle}</div>
      <div class="mt-2 flex justify-between items-center">
         <span class="badge badge-gray">F${s.floor}</span>
         <span class="text-[10px] text-gray-400 capitalize">${s.type}</span>
      </div>
    </div>
  `;
}

async function openSlotModal(id) {
  try {
    const res = await fetch(`${API}/slots/${id}`);
    const slot = await res.json();
    currentSlotId = id;
    
    let content = `
      <div class="flex justify-between items-center mb-6">
        <h3 class="text-2xl m-0 flex items-center gap-2">${getTypeEmoji(slot.type)} Slot ${slot.id}</h3>
        <span class="badge badge-${slot.status==='available'?'green':slot.status==='occupied'?'red':slot.status==='reserved'?'amber':'gray'} capitalize px-3 py-1 text-sm">${slot.status}</span>
      </div>
      
      <div class="grid grid-cols-2 gap-4 mb-6 bg-[var(--table-alt)] p-4 rounded-lg">
        <div><span class="text-xs text-[var(--text-muted)] block">Zone</span><span class="font-bold">${slot.zone}</span></div>
        <div><span class="text-xs text-[var(--text-muted)] block">Floor</span><span class="font-bold">${slot.floor}</span></div>
        <div><span class="text-xs text-[var(--text-muted)] block">Type</span><span class="capitalize font-bold">${slot.type}</span></div>
        <div><span class="text-xs text-[var(--text-muted)] block">Sensor</span><span class="${slot.sensor_status==='online'?'text-[var(--green)]':'text-[var(--red)]'} font-bold capitalize">${slot.sensor_status}</span></div>
      </div>
    `;
    
    let actions = "";
    
    if(slot.status === 'available') {
      actions = `
        <div class="flex gap-3 mb-2">
          <button class="btn btn-success flex-1" onclick="showCheckinForm('${id}')">Check In</button>
          <button class="btn btn-gray" onclick="setMaintenance('${id}')">Set Maintenance</button>
        </div>
        <button class="btn btn-outline border-[#00d4ff] text-[#00d4ff] w-full" onclick="showQRModal('${id}')">Generate Self-Service QR</button>
      `;
    } else if(slot.status === 'occupied') {
      content += `
        <div class="mb-6 p-4 border border-[var(--border)] rounded-lg">
          <div class="flex justify-between mb-2"><span class="text-xs text-[var(--text-muted)]">License Plate</span><span class="font-bold text-[var(--cyan)] text-lg uppercase">${slot.plate}</span></div>
          <div class="flex justify-between mb-2"><span class="text-xs text-[var(--text-muted)]">Owner</span><span class="font-bold">${slot.owner}</span></div>
          <div class="flex justify-between mb-2"><span class="text-xs text-[var(--text-muted)]">Entry Time</span><span class="font-bold">${formatDateTime(slot.entry_time)}</span></div>
          <div class="flex justify-between pt-2 mt-2 border-t border-[var(--border)]"><span class="text-xs text-[var(--text-muted)]">Elapsed</span><span class="font-bold live-timer text-[var(--green)]" data-entry="${slot.entry_time}">--</span></div>
        </div>
      `;
      actions = `<button class="btn btn-primary w-full" onclick="showCheckoutModal('${id}')">Check Out</button>`;
    } else if(slot.status === 'reserved') {
       content += `
        <div class="mb-6 p-4 border border-[#ffaa00] rounded-lg bg-[rgba(255,170,0,0.05)]">
          <div class="flex justify-between mb-2"><span class="text-xs text-[#64748b]">Reserved By</span><span class="font-bold">${slot.reserved_by}</span></div>
          <div class="flex justify-between"><span class="text-xs text-[#64748b]">Until</span><span class="font-bold text-[#ffaa00]">${formatDateTime(slot.reserved_until)}</span></div>
        </div>
      `;
      actions = `
         <div class="flex gap-3">
            <button class="btn btn-success flex-1" onclick="showCheckinForm('${id}')">Arrived (Check In)</button>
            <button class="btn btn-danger" onclick="cancelSlotReservation('${id}')">Cancel</button>
         </div>`;
    } else if(slot.status === 'maintenance') {
      content += `<div class="mb-6 p-4 bg-[var(--table-alt)] rounded-lg"><span class="text-xs text-[var(--text-muted)] block mb-1">Reason</span><span class="font-bold">${slot.maintenance_reason || 'General Maintenance'}</span></div>`;
      actions = `<button class="btn btn-success w-full" onclick="clearMaintenance('${id}')">Mark Available</button>`;
    }
    
    document.getElementById('slot-modal-content').innerHTML = content + actions;
    openModal('modal-slot');
  } catch(e){}
}

async function setMaintenance(id) {
  let r = prompt("Maintenance Reason:");
  if(r === null) return;
  await fetch(`${API}/slots/${id}/maintenance`, {
    method: 'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({action:'set', reason: r||'Routine'})
  });
  closeAllModals(); showToast("Slot set to maintenance", "warning"); loadSlots(); loadDashboard();
}

async function clearMaintenance(id) {
  await fetch(`${API}/slots/${id}/maintenance`, {
    method: 'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({action:'clear'})
  });
  closeAllModals(); showToast("Slot available", "success"); loadSlots(); loadDashboard();
}

async function cancelSlotReservation(id) {
  // Find reservation for this slot
  const r = await fetch(API+'/reservations');
  const arr = await r.json();
  const resv = arr.find(x => x.slot_id === id && x.status === 'active');
  if(resv) await cancelReservation(resv.id);
  else showToast("Reservation missing", "error");
}

// ── CHECK-IN ────────────────────────────────────
function showCheckinForm(id) {
  closeAllModals();
  currentSlotId = id;
  document.getElementById('checkin-form').reset();
  openModal('modal-checkin');
}

document.getElementById('checkin-form').addEventListener('submit', async(e) => {
  e.preventDefault();
  let p = document.getElementById('ci-plate').value.trim().toUpperCase();
  // Validates e.g. KA01AB1234 or AA1234
  if(!/^[A-Z]{2,3}[0-9]{4}$/.test(p) && !/^[A-Z]{2}[0-9]{1,2}[A-Z]{1,2}[0-9]{4}$/.test(p)) {
    showToast("Invalid plate format", "error"); return;
  }
  
  let data = {
    plate: p,
    vehicle_type: document.getElementById('ci-type').value,
    owner: document.getElementById('ci-owner').value.trim(),
    phone: document.getElementById('ci-phone').value.trim()
  };
  
  try {
    const res = await fetch(`${API}/slots/${currentSlotId}/checkin`, {
      method: 'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(data)
    });
    if(res.ok) {
      closeAllModals(); showToast("Check-in successful", "success");
      if(currentPage === 'slots') loadSlots();
      if(currentPage === 'dashboard') loadDashboard();
    } else {
      const respData = await res.json();
      if(res.status === 403 && respData.error === 'BLACKLISTED') {
        const plateInput = document.getElementById('ci-plate');
        plateInput.classList.add('input-error');
        plateInput.classList.add('shake');
        setTimeout(() => plateInput.classList.remove('shake'), 400);
        showToast("SECURITY ALERT: " + respData.message, "error");
      } else {
        showToast("Check-in failed", "error");
      }
    }
  } catch(e){}
});

// ── CHECK-OUT ───────────────────────────────────
async function showCheckoutModal(id) {
  try {
    const res = await fetch(`${API}/slots/${id}`);
    const slot = await res.json();
    currentSlotId = id;
    
    // Quick estimate calc
    let now = new Date();
    let entry = new Date(slot.entry_time);
    let hrs = (now - entry)/3600000;
    
    // Fetch rates from settings (dirty fetch for quick estimate UI, actual logic in backend)
    const settRes = await fetch(`${API}/settings`);
    const settings = await settRes.json();
    let rate = settings.hourly_rates[slot.type] || 2;
    let fee = Math.max(1, hrs) * rate;
    
    let dur = formatDuration(Math.floor((now-entry)/1000));
    
    document.getElementById('checkout-receipt-content').innerHTML = `
      <div class="flex justify-between"><span>Slot</span><span class="font-bold">${slot.id} (${slot.type})</span></div>
      <div class="flex justify-between"><span>Plate</span><span class="font-bold uppercase text-[var(--cyan)]">${slot.plate}</span></div>
      <div class="flex justify-between"><span>Entry</span><span class="font-bold">${formatTime(slot.entry_time)}</span></div>
      <div class="flex justify-between"><span>Duration</span><span class="font-bold">${dur}</span></div>
      <div class="flex justify-between mt-2 pt-2 border-t border-[var(--border)]"><span>Est. Rate</span><span class="font-bold">₹ ${rate.toFixed(2)}/hr</span></div>
      <div class="mt-4"><label class="text-xs text-[var(--text-muted)]">Select Payment Method:</label>
        <select id="checkout-method" class="w-full mt-1 p-2 bg-[var(--input-bg)] text-[var(--text-primary)] border border-[var(--border)] rounded">
          <option value="cash">Cash 💵</option>
          <option value="card">Credit Card 💳</option>
          <option value="upi">UPI 📱</option>
          <option value="wallet">Wallet 💼</option>
        </select>
      </div>
    `;
    document.getElementById('checkout-fee-display').innerText = `₹ ${fee.toFixed(2)}`;
    
    closeAllModals();
    openModal('modal-checkout');
  } catch(e){}
}

document.getElementById('btn-confirm-checkout').addEventListener('click', async() => {
  const method = document.getElementById('checkout-method').value;
  try {
    // Get current slot details before it's cleared by checkout
    const slotRes = await fetch(`${API}/slots/${currentSlotId}`);
    const slot = await slotRes.json();
    
    const settRes = await fetch(`${API}/settings`);
    const settings = await settRes.json();

    const res = await fetch(`${API}/slots/${currentSlotId}/checkout`, { 
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({payment_method: method})
    });
    
    if(res.ok) {
      const data = await res.json();
      closeAllModals();
      
      // Show detailed receipt instead of just a toast
      showDetailedReceipt(data, slot, settings);
      
      if(currentPage === 'slots') loadSlots();
      if(currentPage === 'dashboard') loadDashboard();
    }
  } catch(e){
    console.error("Checkout error", e);
    showToast("Checkout failed", "error");
  }
});

async function showDetailedReceipt(checkoutData, slot, settings) {
  const now = new Date();
  document.getElementById('rec-facility-name').innerText = settings.facility_name;
  document.getElementById('rec-location').innerText = settings.location || 'Main Branch';
  document.getElementById('rec-address').innerText = settings.address || '';
  document.getElementById('rec-contact').innerText = settings.contact || '';
  document.getElementById('rec-gst').innerText = settings.gst_number ? `GST: ${settings.gst_number}` : '';

  document.getElementById('rec-id').innerText = `#${checkoutData.transaction_id.split('-')[0].toUpperCase()}`;
  document.getElementById('rec-date').innerText = now.toLocaleDateString();
  document.getElementById('rec-time').innerText = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

  document.getElementById('rec-plate').innerText = slot.plate;
  document.getElementById('rec-type').innerText = slot.vehicle_type || slot.type;
  document.getElementById('rec-slot').innerText = `${slot.id} (Zone ${slot.zone})`;

  document.getElementById('rec-entry').innerText = formatDateTime(slot.entry_time);
  document.getElementById('rec-exit').innerText = formatDateTime(now.toISOString());
  document.getElementById('rec-duration').innerText = formatDuration(checkoutData.duration * 60);

  const rate = settings.hourly_rates[slot.type] || 2.0;
  document.getElementById('rec-rate').innerText = `₹ ${rate.toFixed(2)}/hr`;
  
  // Fee is inclusive of 18% GST for display purposes
  const total = checkoutData.fee;
  const subtotal = total / 1.18;
  const tax = total - subtotal;
  
  document.getElementById('rec-subtotal').innerText = `₹ ${subtotal.toFixed(2)}`;
  document.getElementById('rec-tax').innerText = `₹ ${tax.toFixed(2)}`;
  document.getElementById('rec-total').innerText = `₹ ${total.toFixed(2)}`;
  
  document.getElementById('rec-method').innerText = document.getElementById('checkout-method').value;
  document.getElementById('rec-ref').innerText = checkoutData.transaction_id.substring(0, 18) + "...";

  // Mock QR using the transaction ID
  document.getElementById('rec-qr').innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${checkoutData.transaction_id}" class="w-full h-full object-contain">`;

  openModal('modal-receipt');
}

// ── QR CODE GENERATOR ───────────────────────────
window.showQRModal = async function showQRModal(id) {
  closeAllModals();
  openModal('modal-qr');
  document.getElementById('qr-slot-id').innerText = id;
  const img = document.getElementById('qr-image');
  const loader = document.getElementById('qr-loading');
  img.classList.add('hidden');
  loader.classList.remove('hidden');
  
  try {
    const res = await fetch(`${API}/parking/qr/${id}`);
    const data = await res.json();
    img.src = data.qr_url;
    img.onload = () => {
      loader.classList.add('hidden');
      img.classList.remove('hidden');
    };
  } catch(e) {
    loader.innerText = "Error generating QR";
  }
}

// ── MEMBERSHIPS ─────────────────────────────────
async function loadMemberships() {
  try {
    const res = await fetch(`${API}/memberships`);
    const data = await res.json();
    const tb = document.getElementById('memberships-table-body');
    tb.innerHTML = '';
    data.forEach(m => {
      tb.innerHTML += `
        <tr>
          <td class="font-bold">${m.name}</td>
          <td class="uppercase text-[#00d4ff]">${m.plate}</td>
          <td>${m.phone}</td>
          <td>${m.expiry}</td>
          <td><button class="btn btn-danger py-1 px-2 text-xs" onclick="deleteMembership('${m.id}')">Revoke</button></td>
        </tr>
      `;
    });
  } catch(e) {}
}

document.getElementById('membership-form').addEventListener('submit', async(e) => {
  e.preventDefault();
  const d = {
    name: document.getElementById('mem-name').value,
    plate: document.getElementById('mem-plate').value,
    phone: document.getElementById('mem-phone').value,
    expiry: document.getElementById('mem-expiry').value
  };
  await fetch(`${API}/memberships`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(d) });
  showToast("Member Registered", "success");
  document.getElementById('membership-form').reset();
  loadMemberships();
});

async function deleteMembership(id) {
  await fetch(`${API}/memberships/${id}`, { method: 'DELETE' });
  showToast("Membership Revoked", "success");
  loadMemberships();
}

// ── BLACKLIST ───────────────────────────────────
async function loadBlacklist() {
  try {
    const res = await fetch(`${API}/blacklist`);
    const data = await res.json();
    const tb = document.getElementById('blacklist-table-body');
    tb.innerHTML = '';
    data.forEach(b => {
      tb.innerHTML += `
        <tr>
          <td class="uppercase font-bold text-[#ff4444]">${b.plate}</td>
          <td>${b.reason}</td>
          <td><button class="btn btn-gray py-1 px-2 text-xs" onclick="deleteBlacklist('${b.id}')">Remove</button></td>
        </tr>
      `;
    });
  } catch(e) {}
}

const bForm = document.getElementById('blacklist-form');
if(bForm) {
  bForm.addEventListener('submit', async(e) => {
    e.preventDefault();
    const d = {
      plate: document.getElementById('bl-plate').value,
      reason: document.getElementById('bl-reason').value
    };
    await fetch(`${API}/blacklist`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(d) });
    showToast("License Plate Banned", "error");
    bForm.reset();
    loadBlacklist();
  });
}

async function deleteBlacklist(id) {
  await fetch(`${API}/blacklist/${id}`, { method: 'DELETE' });
  showToast("Ban Removed", "success");
  loadBlacklist();
}

// ── RESERVATIONS ────────────────────────────────
async function loadReservations() {
  try {
    const res = await fetch(`${API}/reservations`);
    const data = await res.json();
    renderReservationsTable(data);
    
    // populated avail slots
    const sRes = await fetch(`${API}/slots?status=available`);
    const sData = await sRes.json();
    const sel = document.getElementById('res-slot');
    sel.innerHTML = '';
    sData.forEach(s => {
      sel.innerHTML += `<option value="${s.id}">${s.id} - ${s.type.charAt(0).toUpperCase()+s.type.slice(1)} F${s.floor}</option>`;
    });
  } catch(e){}
}

function renderReservationsTable(data) {
  const tb = document.getElementById('reservations-table-body');
  tb.innerHTML = '';
  data.forEach(r => {
    let statCls = r.status==='active'?'badge-green':r.status==='expired'?'badge-gray':'badge-red';
    let tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="font-mono text-xs">${r.id.split('-')[0]}</td>
      <td class="font-bold">${r.slot_id}</td>
      <td>${r.name}</td>
      <td>${r.phone}</td>
      <td>${formatDateTime(r.from_dt)}</td>
      <td>${formatDateTime(r.until_dt)}</td>
      <td><span class="badge ${statCls} capitalize">${r.status}</span></td>
      <td>${r.status==='active' ? `<button class="text-red-400 hover:text-red-600 bg-transparent border-0 cursor-pointer" onclick="cancelReservation('${r.id}')">Cancel</button>` : ''}</td>
    `;
    tb.appendChild(tr);
  });
}

function setupReservationForm() {
  document.getElementById('reservation-form').addEventListener('submit', async(e) => {
    e.preventDefault();
    let body = {
      slot_id: document.getElementById('res-slot').value,
      name: document.getElementById('res-name').value,
      phone: document.getElementById('res-phone').value,
      date: document.getElementById('res-date').value,
      time: document.getElementById('res-time').value,
      duration_hours: document.getElementById('res-dur').value
    };
    try {
      const res = await fetch(`${API}/reservations`, {
        method: 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
      });
      if(res.ok) {
        showToast("Reservation successful", "success");
        document.getElementById('reservation-form').reset();
        loadReservations();
      }
    } catch(e){}
  });
}

async function cancelReservation(id) {
  if(!confirm("Cancel this reservation?")) return;
  await fetch(`${API}/reservations/${id}`, {method:'DELETE'});
  showToast("Reservation cancelled", "success");
  if(currentPage==='reservations') loadReservations();
  if(currentPage==='slots') loadSlots();
}

// ── VEHICLES ────────────────────────────────────
async function loadVehicles() {
  try {
    const r1 = await fetch(`${API}/vehicles`);
    allVehicles = await r1.json();
    renderVehiclesTable(allVehicles);
    
    const r2 = await fetch(`${API}/vehicles/history`);
    const history = await r2.json();
    renderVehicleHistory(history);
  } catch(e){}
}

function renderVehiclesTable(arr) {
  const tb = document.getElementById('vehicles-table-body');
  tb.innerHTML = '';
  arr.forEach(v => {
    let tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="font-bold text-[var(--cyan)] uppercase cursor-pointer hover:underline" onclick="goToSlot('${v.id}')">${v.plate}</td>
      <td>${v.vehicle_type}</td>
      <td>${v.owner}</td>
      <td>${v.phone}</td>
      <td class="font-bold cursor-pointer hover:text-[var(--cyan)]" onclick="goToSlot('${v.id}')">${v.id} <span class="text-xs font-normal text-muted capitalize">(${v.type})</span></td>
      <td>${formatTime(v.entry_time)}</td>
      <td class="live-timer font-mono text-[var(--green)]" data-entry="${v.entry_time}">--</td>
      <td class="font-mono text-[var(--amber)]">--</td>
    `;
    tb.appendChild(tr);
  });
}

function renderVehicleHistory(arr) {
  const tb = document.getElementById('vehicles-history-body');
  tb.innerHTML = '';
  arr.forEach(t => {
    let dur = formatDuration(t.duration_minutes * 60);
    let tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="font-bold text-[var(--cyan)] uppercase cursor-pointer hover:underline" onclick="goToSlot('${t.slot_id}')">${t.plate}</td>
      <td>${t.owner}</td>
      <td class="font-bold cursor-pointer hover:text-[var(--cyan)]" onclick="goToSlot('${t.slot_id}')">${t.slot_id}</td>
      <td>${formatDateTime(t.entry_time)}</td>
      <td>${formatDateTime(t.exit_time)}</td>
      <td>${dur}</td>
      <td class="font-bold text-[var(--green)]">₹ ${t.amount.toFixed(2)}</td>
    `;
    tb.appendChild(tr);
  });
}

function setupVehicleSearch() {
  document.getElementById('vehicle-search').addEventListener('input', e => {
    let q = e.target.value.toUpperCase();
    let filtered = allVehicles.filter(v => (v.plate||'').toUpperCase().includes(q));
    renderVehiclesTable(filtered);
  });
}

// ── TRANSACTIONS ────────────────────────────────
async function loadTransactions() {
  try {
    const fd = document.getElementById('tx-from').value;
    const td = document.getElementById('tx-to').value;
    let url = `${API}/transactions`;
    if(fd && td) url += `?from_date=${fd}&to_date=${td}`;
    
    const res = await fetch(url);
    allTransactions = await res.json();
    renderTransactionsTable(allTransactions);
    updateTotalRevenue(allTransactions);
  } catch(e){}
}

function renderTransactionsTable(txns) {
  const tb = document.getElementById('transactions-table-body');
  tb.innerHTML = '';
  txns.forEach(t => {
    let tr = `
      <tr>
        <td class="font-mono text-xs text-[#64748b]">${t.id.split('-')[0]}</td>
        <td class="font-bold">${t.slot_id}</td>
        <td class="uppercase text-[#00d4ff]">${t.plate}</td>
        <td>${t.owner}</td>
        <td>${formatDateTime(t.entry_time)}</td>
        <td>${formatDateTime(t.exit_time)}</td>
        <td>${formatDuration(t.duration_minutes*60)}</td>
        <td class="font-bold text-[#00e676]">₹ ${t.amount.toFixed(2)}</td>
      </tr>
    `;
    tb.innerHTML += tr;
  });
}

function updateTotalRevenue(txns) {
  let sum = txns.reduce((acc, curr) => acc + curr.amount, 0);
  document.getElementById('total-revenue-display').innerText = `₹ ${sum.toFixed(2)}`;
}

function setupTransactionFilter() {
  document.getElementById('btn-tx-filter').addEventListener('click', loadTransactions);
}
function setupExportCSV() {
  document.getElementById('btn-export-csv').addEventListener('click', () => {
    window.location = `${API}/transactions/csv`;
  });
}

// ── ALERTS ──────────────────────────────────────
async function loadAlerts() {
  try {
    await fetch(`${API}/alerts/check`, {method:'POST'});
    const res = await fetch(`${API}/alerts`);
    const data = await res.json();
    renderAlerts(data);
    updateAlertBadge(data.length);
  } catch(e){}
}

function renderAlerts(alerts) {
  const container = document.getElementById('alerts-list');
  if(!container) return;
  container.innerHTML = '';
  if(alerts.length === 0) {
    container.innerHTML = '<div class="text-[#64748b] p-4 text-center">No active alerts.</div>';
    return;
  }
  
  alerts.forEach(a => {
    let color = a.type === 'overstay' ? 'red' : a.type === 'maintenance' ? 'amber' : 'blue';
    let card = document.createElement('div');
    card.className = `alert-card border-l-${color}-500`;
    card.innerHTML = `
      <div class="flex gap-3">
        <div class="text-2xl mt-1">${a.type === 'overstay' ? '⏱️' : '🔧'}</div>
        <div>
           <div class="flex items-center gap-2 mb-1">
              <span class="badge badge-${color} uppercase">${a.type}</span>
              <span class="text-xs text-[#64748b]">${formatDateTime(a.created_at)}</span>
           </div>
           <div class="font-medium">${a.message}</div>
        </div>
      </div>
      <button class="text-[#64748b] hover:text-white bg-transparent border-0 cursor-pointer text-xl" onclick="dismissAlert('${a.id}')">×</button>
    `;
    container.appendChild(card);
  });
}

async function dismissAlert(id) {
  await fetch(`${API}/alerts/${id}`, {method:'DELETE'});
  loadAlerts();
}

function updateAlertBadge(count) {
  ['alert-badge', 'header-alert-badge'].forEach(id => {
    let el = document.getElementById(id);
    if(count > 0) {
      el.innerText = count;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });
}

// ── SETTINGS ────────────────────────────────────
async function loadSettings() {
  try {
    const r = await fetch(`${API}/settings`);
    const set = await r.json();
    document.getElementById('setting-facility-name').value = set.facility_name;
    document.getElementById('setting-open-time').value = set.open_time;
    document.getElementById('setting-close-time').value = set.close_time;
    document.getElementById('setting-grace-period').value = set.grace_period_minutes;
    document.getElementById('setting-max-reservation').value = set.max_reservation_hours;
    
    document.getElementById('rate-standard').value = set.hourly_rates.standard;
    document.getElementById('rate-handicap').value = set.hourly_rates.handicap;
    document.getElementById('rate-ev').value = set.hourly_rates.ev;
    document.getElementById('rate-vip').value = set.hourly_rates.vip;
    document.getElementById('rate-compact').value = set.hourly_rates.compact;
  } catch(e){}
}

function setupSettingsForms() {
  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    let body = {
      facility_name: document.getElementById('setting-facility-name').value,
      open_time: document.getElementById('setting-open-time').value,
      close_time: document.getElementById('setting-close-time').value,
      grace_period_minutes: parseInt(document.getElementById('setting-grace-period').value),
      max_reservation_hours: parseInt(document.getElementById('setting-max-reservation').value),
      hourly_rates: {
        standard: parseFloat(document.getElementById('rate-standard').value),
        handicap: parseFloat(document.getElementById('rate-handicap').value),
        ev: parseFloat(document.getElementById('rate-ev').value),
        vip: parseFloat(document.getElementById('rate-vip').value),
        compact: parseFloat(document.getElementById('rate-compact').value)
      }
    };
    try {
      await fetch(`${API}/settings`, {
        method: 'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
      });
      showToast("Settings saved!", "success");
    } catch(e){}
  });
  
  document.getElementById('btn-reset-data').addEventListener('click', resetData);
}

function resetData() {
  document.getElementById('confirm-msg').innerText = "This will wipe all data and reinitialize 80 slots. Continue?";
  openModal('modal-confirm');
  document.getElementById('btn-do-confirm').onclick = async () => {
    closeAllModals();
    await fetch(`${API}/reset`, {method:'POST'});
    showToast("Data reset. Reloading...", "warning");
    setTimeout(() => location.reload(), 1500);
  };
}

// ── SEARCH ───────────────────────────────────────
function setupSearchInput() {
  let searchInput = document.getElementById('global-search');
  let drop = document.getElementById('search-dropdown');
  let timeout = null;
  
  searchInput.addEventListener('input', e => {
    clearTimeout(timeout);
    let q = e.target.value.trim();
    timeout = setTimeout(() => searchGlobal(q), 300);
  });
  
  searchInput.addEventListener('blur', () => {
    setTimeout(() => drop.classList.remove('show'), 200);
  });
}

async function searchGlobal(q) {
  let drop = document.getElementById('search-dropdown');
  if(q.length < 2) { drop.classList.remove('show'); return; }
  
  try {
    const res = await fetch(`${API}/slots`);
    const allSlots = await res.json();
    
    const r1 = await fetch(`${API}/vehicles`);
    const allVehs = await r1.json();
    
    let UQ = q.toUpperCase();
    let slotRes = allSlots.filter(s => s.id.toUpperCase().includes(UQ));
    let vehRes = allVehs.filter(v => (v.plate||'').toUpperCase().includes(UQ));
    
    slotRes = slotRes.slice(0, 5);
    vehRes = vehRes.slice(0, 5);
    
    let html = '';
    if(slotRes.length > 0) {
      html += `<div class="px-3 py-1 bg-[#0d1117] text-xs font-bold text-[#64748b]">Slots</div>`;
      slotRes.forEach(s => {
        html += `<div class="search-result-item" onmousedown="showPage('slots'); setTimeout(()=>openSlotModal('${s.id}'),100)"><span class="font-bold">${s.id}</span> <span class="text-xs text-[#00e676]">${s.status}</span></div>`;
      });
    }
    if(vehRes.length > 0) {
      html += `<div class="px-3 py-1 bg-[#0d1117] text-xs font-bold text-[#64748b]">Vehicles</div>`;
      vehRes.forEach(v => {
        html += `<div class="search-result-item" onmousedown="showPage('slots'); setTimeout(()=>openSlotModal('${v.id}'),100)"><span class="font-bold text-[#00d4ff]">${v.plate}</span> <span class="text-xs">in ${v.id}</span></div>`;
      });
    }
    
    if(html === '') html = '<div class="p-3 text-sm text-[#64748b]">No results</div>';
    
    drop.innerHTML = html;
    drop.classList.add('show');
  } catch(e){}
}

// ── FILTERS ──────────────────────────────────────
function setupSlotFilters() {
  ['filter-zone', 'filter-floor', 'filter-type', 'filter-status'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      if(currentPage === 'slots') loadSlots();
    });
  });
}

// ── UTILS & CORE ─────────────────────────────────
function updateLiveTimers() {
  document.querySelectorAll('.live-timer').forEach(el => {
    let entry = el.getAttribute('data-entry');
    if(entry) {
      let s = Math.floor((new Date() - new Date(entry))/1000);
      el.innerHTML = formatDuration(s);
    }
  });
}

function formatDuration(sec) {
  if (isNaN(sec) || sec < 0) return "--";
  let h = Math.floor(sec / 3600);
  let m = Math.floor((sec % 3600) / 60);
  let s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function formatTime(iso) {
  if(!iso) return "--";
  return new Date(iso).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}
function formatDateTime(iso) {
  if(!iso) return "--";
  let d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
}

function showToast(msg, type='info') {
  let c = document.getElementById('toast-container');
  let div = document.createElement('div');
  div.className = `toast ${type}`;
  let icon = type==='success'?'✓':type==='error'?'✗':type==='warning'?'⚠':'ℹ';
  div.innerHTML = `<span class="font-bold text-lg">${icon}</span> <span>${msg}</span>`;
  c.appendChild(div);
  setTimeout(() => {
    div.classList.add('removing');
    setTimeout(() => div.remove(), 300);
  }, 3000);
}

function openModal(id) {
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  document.body.style.overflow = 'auto';
}

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  await initParticles();
  
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
  
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => showPage(link.dataset.page));
  });
  
  document.getElementById('hamburger')?.addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('open');
  });

  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', e => { if(e.target === ov) closeAllModals(); });
  });
  document.addEventListener('keydown', e => { if(e.key === 'Escape') closeAllModals(); });

  setupSearchInput();
  setupSlotFilters();
  setupReservationForm();
  setupSettingsForms();
  setupVehicleSearch();
  setupTransactionFilter();
  setupExportCSV();
  
  try { await fetch(`${API}/reservations/expire`, {method:'POST'}); } catch(e){}
  
  const params = new URLSearchParams(window.location.search);
  const slotId = params.get('slot');
  if (slotId) {
    showPage('slots');
    setTimeout(() => {
      const hash = window.location.hash;
      if (hash === '#checkout') {
        showCheckoutModal(slotId);
      } else if (hash === '#checkin') {
        showCheckinForm(slotId);
      } else {
        openSlotModal(slotId);
      }
    }, 300);
  } else {
    showPage('dashboard');
  }
  
  setInterval(updateLiveTimers, 1000);
  setInterval(async () => {
    await loadAlerts();
    if(currentPage === 'dashboard') await loadDashboard();
  }, 30000);
});
