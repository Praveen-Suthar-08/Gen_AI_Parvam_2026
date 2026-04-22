// payment.js

const API = 'http://localhost:5001/api';
let currentTab = 'payment';
let selectedMethod = null;
let currentInvoice = null;
let currentTotal = 0;
let otpAttempts = 0;
let otpTimerInterval = null;
let cashTokenInterval = null;
let revenueChart = null;
let methodChart = null;
let currentTxnId = null;
let appliedDiscount = null;
let audioCtx = null;
let isSplitPayment = false;

// ── INIT ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupTabNav();
  setupKeyboardShortcuts();
  loadInvoice();
  renderMethodGrid();
  loadSavedCards();
  showTab('payment');
  
  document.getElementById('shortcuts-btn')?.addEventListener('click', () => {
    document.getElementById('shortcuts-panel').classList.toggle('hidden');
  });

  document.body.addEventListener('click', (e) => {
    if(e.target.closest('#shortcuts-btn') || e.target.closest('#shortcuts-panel')) return;
    document.getElementById('shortcuts-panel')?.classList.add('hidden');
  });
});

// ── SOUND EFFECTS ─────────────────────────────
function initAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) {}
  }
}

function playTone(freq, type, duration, vol=0.1, delay=0) {
  if (!audioCtx) initAudio();
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime + delay);
  
  gain.gain.setValueAtTime(0, audioCtx.currentTime + delay);
  gain.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + delay + 0.05);
  gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + delay + duration);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(audioCtx.currentTime + delay);
  osc.stop(audioCtx.currentTime + delay + duration);
}

function playSuccessSound() {
  playTone(523.25, 'sine', 0.15, 0.1, 0); // C5
  playTone(659.25, 'sine', 0.15, 0.1, 0.1); // E5
  playTone(783.99, 'sine', 0.25, 0.1, 0.2); // G5
}

function playFailureSound() {
  playTone(400, 'square', 0.15, 0.1, 0);
  playTone(200, 'sawtooth', 0.25, 0.1, 0.15);
}

function playClickSound() {
  playTone(800, 'sine', 0.05, 0.05, 0);
}

// ── TAB NAVIGATION ─────────────────────────────
function setupTabNav() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      showTab(tab.dataset.tab);
    });
  });
  updateNavWallet();
}

function showTab(name) {
  currentTab = name;
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.nav-tab[data-tab="${name}"]`)?.classList.add('active');
  
  document.querySelectorAll('.content-area > section').forEach(s => s.classList.add('hidden'));
  document.getElementById(`tab-${name}`)?.classList.remove('hidden');
  
  if(name === 'wallet') loadWallet();
  if(name === 'transactions') loadTransactions();
  if(name === 'refunds') loadRefunds();
  if(name === 'dashboard') loadDashboard();
  if(name === 'settings') loadSettings();
}

async function updateNavWallet() {
  try {
    const res = await fetch(`${API}/wallet/balance`);
    const data = await res.json();
    if(data.balance !== undefined) {
      document.getElementById('nav-wallet-balance').textContent = formatCurrency(data.balance);
    }
  } catch(e) {}
}

// ── INVOICE ────────────────────────────────────
async function loadInvoice() {
  try {
    const res = await fetch(`${API}/payment/invoice`);
    const data = await res.json();
    currentInvoice = data;
    currentTotal = currentInvoice.total;
    
    document.getElementById('invoice-slot').textContent = data.slot_id;
    document.getElementById('invoice-vehicle').textContent = data.vehicle;
    document.getElementById('invoice-entry').textContent = formatTime(data.entry_time);
    document.getElementById('invoice-exit').textContent = formatTime(data.exit_time);
    document.getElementById('invoice-duration').textContent = data.duration;
    document.getElementById('invoice-subtotal').textContent = formatCurrency(data.subtotal);
    document.getElementById('invoice-fee').textContent = formatCurrency(data.platform_fee);
    document.getElementById('invoice-gst').textContent = formatCurrency(data.gst);
    updateTotalDisplay();
  } catch (e) {
    showToast('Failed to load invoice details', 'error');
  }
}

function updateTotalDisplay() {
  document.getElementById('invoice-total').textContent = formatCurrency(currentTotal);
}

// ── PAYMENT METHODS ────────────────────────────
const methodsConfig = [
  { id: 'card', name: 'Credit/Debit Card', icon: '💳', badge: 'Popular' },
  { id: 'upi', name: 'UPI', icon: '📱', badge: 'Instant' },
  { id: 'netbanking', name: 'Net Banking', icon: '🏦', badge: '' },
  { id: 'wallet', name: 'PayPark Wallet', icon: '👛', badge: 'No Fee' },
  { id: 'emi', name: 'EMI', icon: '🔄', badge: '' },
  { id: 'cash', name: 'Cash', icon: '💰', badge: 'Counter' }
];

function renderMethodGrid() {
  const grid = document.getElementById('method-grid');
  grid.innerHTML = methodsConfig.map(m => `
    <div class="method-card" onclick="selectMethod('${m.id}')" id="method-card-${m.id}">
      <span class="method-icon">${m.icon}</span>
      <span class="method-label">${m.name}</span>
      ${m.badge ? `<span class="method-badge">${m.badge}</span>` : ''}
    </div>
  `).join('');
}

function selectMethod(methodId) {
  selectedMethod = methodId;
  document.querySelectorAll('.method-card').forEach(c => c.classList.remove('selected'));
  document.getElementById(`method-card-${methodId}`)?.classList.add('selected');
  showPaymentForm(methodId);
  initAudio();
}

function showPaymentForm(method) {
  const area = document.getElementById('payment-form-area');
  document.getElementById('saved-cards-section').classList.add('hidden');
  
  if(method === 'card') {
    renderCardForm(area);
    document.getElementById('saved-cards-section').classList.remove('hidden');
  }
  else if(method === 'upi') renderUPIForm(area);
  else if(method === 'netbanking') renderNetBankingForm(area);
  else if(method === 'wallet') renderWalletForm(area);
  else if(method === 'emi') renderEMIForm(area);
  else if(method === 'cash') renderCashForm(area);
}

// ── CARD FORM ──────────────────────────────────
function renderCardForm(area) {
  area.innerHTML = `
    <div class="form-card">
      <h4 class="m-0 mb-4 border-b border-[#1e293b] pb-2 text-white">Enter Card Details</h4>
      <div class="form-group relative">
        <label>Card Number</label>
        <input type="text" id="card-num" placeholder="XXXX XXXX XXXX XXXX" maxlength="19" oninput="formatCardNumber(this)">
        <span id="card-type" class="card-type-badge hidden"></span>
        <div id="card-num-err" class="error-text hidden">Invalid card number</div>
      </div>
      <div class="form-group">
        <label>Cardholder Name</label>
        <input type="text" id="card-name" placeholder="John Doe">
        <div id="card-name-err" class="error-text hidden">Name required</div>
      </div>
      <div class="flex gap-4 mb-4">
        <div class="flex-1 form-group mb-0">
          <label>Expiry</label>
          <input type="text" id="card-exp" placeholder="MM/YY" maxlength="5" oninput="formatExpiry(this)">
          <div id="card-exp-err" class="error-text hidden">Invalid</div>
        </div>
        <div class="flex-1 form-group mb-0">
          <label>CVV</label>
          <input type="password" id="card-cvv" placeholder="•••" maxlength="4">
          <div id="card-cvv-err" class="error-text hidden">Invalid</div>
        </div>
      </div>
      <label class="flex items-center gap-2 mb-6 cursor-pointer text-white text-sm">
        <input type="checkbox" id="save-card"> Save card for future payments
      </label>
      <button class="btn btn-primary w-full" onclick="initiateCardPayment()">Pay ${formatCurrency(currentTotal)}</button>
    </div>
  `;
}

function formatCardNumber(input) {
  let v = input.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
  detectCardType(v);
  let parts = [];
  for(let i=0; i<v.length; i+=4) parts.push(v.substring(i, i+4));
  input.value = parts.join(' ');
}

function detectCardType(num) {
  const badge = document.getElementById('card-type');
  badge.className = 'card-type-badge';
  if(num.startsWith('4')) { badge.textContent = 'Visa'; badge.classList.add('card-type-Visa', 'block'); badge.classList.remove('hidden'); }
  else if(num.startsWith('5')) { badge.textContent = 'Mastercard'; badge.classList.add('card-type-Mastercard', 'block'); badge.classList.remove('hidden'); }
  else if(num.startsWith('6')) { badge.textContent = 'RuPay'; badge.classList.add('card-type-RuPay', 'block'); badge.classList.remove('hidden'); }
  else if(num.startsWith('37')) { badge.textContent = 'Amex'; badge.classList.add('card-type-Amex', 'block'); badge.classList.remove('hidden'); }
  else { badge.classList.add('hidden'); badge.classList.remove('block'); badge.textContent=''; }
}

function formatExpiry(input) {
  let v = input.value.replace(/\//g, '').replace(/[^0-9]/g, '');
  if(v.length >= 2) v = v.substring(0,2) + '/' + v.substring(2,4);
  input.value = v;
}

function luhnCheck(val) {
  let sum = 0;
  for (let i = 0; i < val.length; i++) {
    let intVal = parseInt(val.substr(i, 1));
    if (i % 2 === 0) {
      intVal *= 2;
      if (intVal > 9) intVal = 1 + (intVal % 10);
    }
    sum += intVal;
  }
  return (sum % 10) === 0;
}

function validateCardForm() {
  let valid = true;
  const num = document.getElementById('card-num');
  const name = document.getElementById('card-name');
  const exp = document.getElementById('card-exp');
  const cvv = document.getElementById('card-cvv');
  
  const vNum = num.value.replace(/\s/g, '');
  if(vNum.length < 13 || !luhnCheck(vNum)) { num.classList.add('input-error'); document.getElementById('card-num-err').classList.remove('hidden'); valid=false; }
  else { num.classList.remove('input-error'); document.getElementById('card-num-err').classList.add('hidden'); }
  
  if(!name.value.trim()) { name.classList.add('input-error'); document.getElementById('card-name-err').classList.remove('hidden'); valid=false; }
  else { name.classList.remove('input-error'); document.getElementById('card-name-err').classList.add('hidden'); }
  
  if(!exp.value.match(/^(0[1-9]|1[0-2])\/\d{2}$/)) { exp.classList.add('input-error'); document.getElementById('card-exp-err').classList.remove('hidden'); valid=false; }
  else { exp.classList.remove('input-error'); document.getElementById('card-exp-err').classList.add('hidden'); }
  
  if(cvv.value.length < 3) { cvv.classList.add('input-error'); document.getElementById('card-cvv-err').classList.remove('hidden'); valid=false; }
  else { cvv.classList.remove('input-error'); document.getElementById('card-cvv-err').classList.add('hidden'); }
  
  return valid;
}

async function initiateCardPayment() {
  if(!validateCardForm()) return;
  if(document.getElementById('save-card').checked) {
    const last4 = document.getElementById('card-num').value.slice(-4);
    const type = document.getElementById('card-type').textContent || 'Card';
    const exp = document.getElementById('card-exp').value;
    const name = document.getElementById('card-name').value;
    fetch(`${API}/saved-cards`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({last4, type, expiry:exp, name})
    });
  }
  await initiatePayment('card');
}

// ── UPI FORM ───────────────────────────────────
function renderUPIForm(area) {
  area.innerHTML = `
    <div class="form-card">
      <h4 class="m-0 mb-4 border-b border-[#1e293b] pb-2 text-white">Enter UPI ID</h4>
      <div class="upi-apps">
        <button class="upi-app-btn" onclick="selectUPIApp('gpay')"><span>GPay</span></button>
        <button class="upi-app-btn" onclick="selectUPIApp('phonepe')"><span>PhonePe</span></button>
        <button class="upi-app-btn" onclick="selectUPIApp('paytm')"><span>Paytm</span></button>
        <button class="upi-app-btn" onclick="selectUPIApp('bhim')"><span>BHIM</span></button>
      </div>
      <div class="form-group mb-2">
        <input type="text" id="upi-id" placeholder="username@upi" oninput="document.getElementById('upi-verified').classList.remove('show'); document.getElementById('upi-error').classList.remove('show');">
        <div id="upi-verified" class="upi-verified">✓ Verified: John Doe</div>
        <div id="upi-error" class="upi-error">Invalid UPI ID</div>
      </div>
      <button class="btn btn-gray w-full mb-4" onclick="verifyUPI()" id="btn-verify-upi">Verify UPI</button>
      <button class="btn btn-primary w-full opacity-50 cursor-not-allowed" disabled id="btn-pay-upi" onclick="initiateUPIPayment()">Pay ${formatCurrency(currentTotal)}</button>
      
      <div class="mt-6 text-center border-t border-[#1e293b] pt-4">
        <p class="text-xs text-[#94a3b8] mb-2">Or scan QR to pay</p>
        <div class="w-32 h-32 mx-auto bg-white rounded-lg flex items-center justify-center p-2 mb-2">
           <svg width="100" height="100" viewBox="0 0 100 100" fill="black"><rect width="40" height="40" x="5" y="5" fill="none" stroke="black" stroke-width="8"/><rect width="16" height="16" x="17" y="17"/><rect width="40" height="40" x="55" y="5" fill="none" stroke="black" stroke-width="8"/><rect width="16" height="16" x="67" y="17"/><rect width="40" height="40" x="5" y="55" fill="none" stroke="black" stroke-width="8"/><rect width="16" height="16" x="17" y="67"/><rect width="15" height="15" x="55" y="55"/><rect width="15" height="15" x="80" y="80"/><rect width="10" height="10" x="70" y="65"/><rect width="10" height="10" x="55" y="80"/></svg>
        </div>
        <p class="text-xs text-[#f8fafc]">Scan using any UPI app</p>
      </div>
    </div>
  `;
}

function selectUPIApp(app) {
  const map = {
    'gpay': 'john@okaxis',
    'phonepe': '9876543210@ybl',
    'paytm': '9876543210@paytm',
    'bhim': 'john@upi'
  };
  document.getElementById('upi-id').value = map[app];
  verifyUPI();
}

async function verifyUPI() {
  const upiId = document.getElementById('upi-id').value;
  if(!/^[\w.-]+@[\w.-]+$/.test(upiId)) {
    document.getElementById('upi-error').classList.add('show');
    return;
  }
  
  const btn = document.getElementById('btn-verify-upi');
  btn.textContent = 'Verifying...';
  btn.disabled = true;
  
  try {
    const res = await fetch(`${API}/payment/upi/verify`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({upi_id: upiId})
    });
    const d = await res.json();
    btn.textContent = 'Verify UPI';
    btn.disabled = false;
    
    if(d.success) {
      document.getElementById('upi-verified').textContent = `✓ Verified: ${d.name}`;
      document.getElementById('upi-verified').classList.add('show');
      document.getElementById('upi-error').classList.remove('show');
      
      const payBtn = document.getElementById('btn-pay-upi');
      payBtn.disabled = false;
      payBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    } else {
      document.getElementById('upi-error').classList.add('show');
    }
  } catch(e) {
    btn.textContent = 'Verify UPI';
    btn.disabled = false;
    showToast('Verification failed', 'error');
  }
}

async function initiateUPIPayment() {
  if(document.getElementById('btn-pay-upi').disabled) return;
  await initiatePayment('upi');
}

// ── NET BANKING ────────────────────────────────
function renderNetBankingForm(area) {
  area.innerHTML = `
    <div class="form-card">
      <h4 class="m-0 mb-4 border-b border-[#1e293b] pb-2 text-white">Select Bank</h4>
      <input type="text" placeholder="Search Bank..." class="mb-2" oninput="filterBanks(this.value)">
      <div id="banks-grid" class="banks-grid">
        <button class="bank-btn" onclick="selectBank(this)">SBI</button>
        <button class="bank-btn" onclick="selectBank(this)">HDFC</button>
        <button class="bank-btn" onclick="selectBank(this)">ICICI</button>
        <button class="bank-btn" onclick="selectBank(this)">Axis</button>
        <button class="bank-btn" onclick="selectBank(this)">Kotak</button>
        <button class="bank-btn" onclick="selectBank(this)">PNB</button>
        <button class="bank-btn" onclick="selectBank(this)">BOB</button>
        <button class="bank-btn" onclick="selectBank(this)">Yes Bank</button>
      </div>
      <button class="btn btn-primary w-full mt-4" id="btn-proceed-nb" onclick="proceedNetBanking()" disabled style="opacity:0.5;cursor:not-allowed">Proceed to Bank</button>
    </div>
  `;
}

function selectBank(btn) {
  document.querySelectorAll('.bank-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  const b = document.getElementById('btn-proceed-nb');
  b.disabled = false;
  b.style.opacity = 1;
  b.style.cursor = 'pointer';
}

function filterBanks(q) {
  q = q.toLowerCase();
  document.querySelectorAll('.bank-btn').forEach(b => {
    b.style.display = b.textContent.toLowerCase().includes(q) ? 'block' : 'none';
  });
}

async function proceedNetBanking() {
  document.getElementById('btn-proceed-nb').textContent = "Redirecting...";
  showLoading("Securely connecting to bank...");
  setTimeout(() => {
    hideLoading();
    const area = document.getElementById('payment-form-area');
    const bank = document.querySelector('.bank-btn.selected').textContent;
    area.innerHTML = `
      <div class="form-card">
        <div class="flex items-center gap-2 mb-4 border-b border-[#1e293b] pb-2 text-white"><span class="text-xl">🏦</span> <h4 class="m-0">${bank} Login</h4></div>
        <div class="form-group"><label>Customer/User ID</label><input type="text" id="nb-user"></div>
        <div class="form-group"><label>Password</label><input type="password" id="nb-pass"></div>
        <button class="btn btn-primary w-full" onclick="bankLogin()">Login & Pay ${formatCurrency(currentTotal)}</button>
      </div>
    `;
  }, 2000);
}

async function bankLogin() {
  if(!document.getElementById('nb-user').value || !document.getElementById('nb-pass').value) {
    showToast("Enter credentials", 'error'); return;
  }
  await initiatePayment('netbanking');
}

// ── WALLET FORM ────────────────────────────────
function renderWalletForm(area) {
  fetch(`${API}/wallet/balance`).then(r=>r.json()).then(data => {
    const bal = data.balance;
    const enough = bal >= currentTotal;
    area.innerHTML = `
      <div class="form-card text-center">
        <h4 class="m-0 mb-4 border-b border-[#1e293b] pb-2 text-white">Wallet Payment</h4>
        <div class="text-[#94a3b8] mb-1">Available Balance</div>
        <div class="text-3xl font-bold font-['Space_Grotesk'] text-[#3b82f6] mb-6">₹ ${bal.toFixed(2)}</div>
        
        ${enough ? `
          <div class="text-[#10b981] font-bold mb-4">✓ Sufficient Balance</div>
          <button class="btn btn-success w-full" onclick="payFromWallet()">Pay ${formatCurrency(currentTotal)}</button>
        ` : `
          <div class="text-[#ef4444] font-bold mb-4">✗ Insufficient Balance</div>
          <div class="bg-[#1e293b] p-4 rounded-lg mb-4 text-left">
             <label>Top-up Amount needed: ₹ ${(currentTotal - bal).toFixed(2)}</label>
             <input type="number" id="quick-topup-amt" value="${Math.ceil(currentTotal - bal)}" class="mb-2">
             <button class="btn btn-primary w-full" onclick="quickTopupWallet()">Add Money</button>
          </div>
        `}
      </div>
    `;
  });
}

function quickTopupWallet() {
  const a = parseFloat(document.getElementById('quick-topup-amt').value);
  if(a>0) topUpWallet(a).then(()=> showPaymentForm('wallet'));
}

async function payFromWallet() {
  await initiatePayment('wallet');
}

// ── EMI FORM ───────────────────────────────────
function renderEMIForm(area) {
  const emi3 = (currentTotal / 3).toFixed(2);
  const emi6 = ((currentTotal * 1.05) / 6).toFixed(2);
  const emi12 = ((currentTotal * 1.10) / 12).toFixed(2);
  
  area.innerHTML = `
    <div class="form-card">
      <h4 class="m-0 mb-4 border-b border-[#1e293b] pb-2 text-white">EMI Options</h4>
      <p class="text-xs text-[#94a3b8] mb-2">Select your credit card bank</p>
      <select id="emi-bank" class="mb-4">
        <option>HDFC Bank</option><option>ICICI Bank</option><option>Axis Bank</option>
      </select>
      <table class="emi-table">
        <thead><tr><th>Months</th><th>EMI/mo</th><th>Interest</th><th>Total</th></tr></thead>
        <tbody>
          <tr class="emi-row" onclick="selectEMIOption(this)"><td>3</td><td>₹ ${emi3}</td><td>0%</td><td>₹ ${currentTotal.toFixed(2)}</td></tr>
          <tr class="emi-row" onclick="selectEMIOption(this)"><td>6</td><td>₹ ${emi6}</td><td>5%</td><td>₹ ${(currentTotal*1.05).toFixed(2)}</td></tr>
          <tr class="emi-row" onclick="selectEMIOption(this)"><td>12</td><td>₹ ${emi12}</td><td>10%</td><td>₹ ${(currentTotal*1.10).toFixed(2)}</td></tr>
        </tbody>
      </table>
      <button class="btn btn-primary w-full mt-4" id="btn-proceed-emi" disabled style="opacity:0.5" onclick="proceedEMI()">Proceed with EMI</button>
    </div>
  `;
}

function selectEMIOption(row) {
  document.querySelectorAll('.emi-row').forEach(r => r.classList.remove('selected'));
  row.classList.add('selected');
  const b = document.getElementById('btn-proceed-emi');
  b.disabled = false;
  b.style.opacity = 1;
}

async function proceedEMI() {
  await initiatePayment('emi');
}

// ── CASH FORM ──────────────────────────────────
function renderCashForm(area) {
  area.innerHTML = `
    <div class="form-card text-center">
      <h4 class="m-0 mb-4 border-b border-[#1e293b] pb-2 text-white">Pay at Counter</h4>
      <p class="text-sm text-[#94a3b8] mb-6">Visit the parking counter with your vehicle details or scan the token.</p>
      <button class="btn btn-primary w-full mb-4" id="btn-gen-token" onclick="generateCashToken()">Generate Token</button>
      <div id="cash-token-area" class="hidden">
        <div class="text-xs text-white bg-[#1e293b] inline-block px-3 py-1 rounded-full mb-4">Token: <span id="cash-token-id" class="font-bold"></span></div>
        <div class="w-40 h-40 mx-auto bg-white rounded-lg flex items-center justify-center p-2 mb-4">
           <svg width="120" height="120" viewBox="0 0 100 100" fill="black"><rect width="40" height="40" x="5" y="5" fill="none" stroke="black" stroke-width="8"/><rect width="16" height="16" x="17" y="17"/><rect width="40" height="40" x="55" y="5" fill="none" stroke="black" stroke-width="8"/><rect width="16" height="16" x="67" y="17"/><rect width="40" height="40" x="5" y="55" fill="none" stroke="black" stroke-width="8"/><rect width="16" height="16" x="17" y="67"/><rect width="15" height="15" x="55" y="55"/><rect width="15" height="15" x="80" y="80"/><rect width="10" height="10" x="70" y="65"/><rect width="10" height="10" x="55" y="80"/></svg>
        </div>
        <div id="cash-countdown" class="text-[#f59e0b] font-mono text-xl font-bold">15:00</div>
        <p class="text-xs text-[#94a3b8] mt-1">Token expires in</p>
      </div>
    </div>
  `;
}

function generateCashToken() {
  document.getElementById('btn-gen-token').classList.add('hidden');
  document.getElementById('cash-token-area').classList.remove('hidden');
  document.getElementById('cash-token-id').textContent = 'TKN-' + Math.floor(Math.random()*900+100);
  startCashCountdown();
}

function startCashCountdown() {
  let secs = 15 * 60;
  if(cashTokenInterval) clearInterval(cashTokenInterval);
  const disp = document.getElementById('cash-countdown');
  cashTokenInterval = setInterval(() => {
    secs--;
    if(secs<=0) { clearInterval(cashTokenInterval); disp.textContent = "00:00"; disp.classList.add('text-[#ef4444]'); return; }
    const m = Math.floor(secs/60);
    const s = secs%60;
    disp.textContent = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  }, 1000);
}

// ── OTP FLOW ───────────────────────────────────
function showOTPModal(txnId) {
  currentTxnId = txnId;
  document.querySelectorAll('.otp-input').forEach(i => { i.value=''; i.classList.remove('filled', 'error', 'shake'); });
  document.getElementById('otp-attempts').textContent = '';
  document.querySelectorAll('.otp-input').forEach(i=>i.disabled=false);
  openModal('modal-otp');
  setupOTPInputs();
  startOTPTimer(30);
  setTimeout(()=> document.querySelector('.otp-input[data-index="0"]')?.focus(), 100);
}

function setupOTPInputs() {
  const inputs = Array.from(document.querySelectorAll('.otp-input'));
  inputs.forEach((input, index) => {
    input.onkeyup = (e) => {
      playClickSound();
      if(e.key === 'Backspace' && !input.value && index > 0) {
        inputs[index-1].focus();
        inputs[index-1].value = '';
      }
      else if(input.value && index < 5) {
        inputs[index+1].focus();
      }
      input.classList.toggle('filled', !!input.value);
    };
    input.onpaste = (e) => {
      e.preventDefault();
      const pasteData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0,6);
      for(let i=0; i<pasteData.length; i++) {
        inputs[i].value = pasteData[i];
        inputs[i].classList.add('filled');
      }
      if(pasteData.length>0) {
        inputs[Math.min(pasteData.length, 5)].focus();
      }
    };
  });
}

function startOTPTimer(seconds) {
  const tDisp = document.getElementById('otp-timer');
  const resend = document.getElementById('otp-resend');
  tDisp.classList.remove('hidden');
  resend.classList.add('hidden');
  if(otpTimerInterval) clearInterval(otpTimerInterval);
  
  otpTimerInterval = setInterval(() => {
    seconds--;
    if(seconds<=0) {
      clearInterval(otpTimerInterval);
      tDisp.classList.add('hidden');
      resend.classList.remove('hidden');
    } else {
      tDisp.textContent = `Resend in 0:${seconds.toString().padStart(2,'0')}`;
    }
  }, 1000);
}

function resendOTP() {
  showToast('OTP Resent via SMS', 'info');
  startOTPTimer(30);
}

async function verifyOTP() {
  const inputs = Array.from(document.querySelectorAll('.otp-input'));
  const otp = inputs.map(i=>i.value).join('');
  if(otp.length < 6) return showToast('Enter 6 digit OTP', 'error');
  
  try {
    const res = await fetch(`${API}/payment/verify-otp`, {
      method: 'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({txn_id: currentTxnId, otp})
    });
    const data = await res.json();
    if(data.success) {
      closeModal('modal-otp');
      processPayment();
    } else {
      inputs.forEach(i => { i.classList.add('error', 'shake'); setTimeout(()=>i.classList.remove('shake'), 400); });
      document.getElementById('otp-attempts').textContent = data.message + (data.attempts_left>0 ? ` (${data.attempts_left} attempts left)` : '');
      if(data.locked) {
        inputs.forEach(i=>i.disabled=true);
        showToast('Too many attempts', 'error');
      }
    }
  } catch(e) { showToast('Verification error', 'error'); }
}

// ── PAYMENT PROCESSING ─────────────────────────
async function processPayment() {
  openModal('modal-processing');
  const bar = document.getElementById('processing-bar');
  const steps = [
    document.getElementById('ps-1'), document.getElementById('ps-2'),
    document.getElementById('ps-3'), document.getElementById('ps-4')
  ];
  
  bar.style.width = '0%';
  steps.forEach(s => { s.classList.remove('visible', 'done'); });
  
  let w = 0;
  const iv = setInterval(() => { w += (100/60); if(w<=100) bar.style.width = w+'%'; }, 50);
  
  setTimeout(()=> { steps[0].classList.add('visible'); }, 200);
  setTimeout(()=> { steps[0].classList.add('done'); steps[1].classList.add('visible'); }, 900);
  setTimeout(()=> { steps[1].classList.add('done'); steps[2].classList.add('visible'); }, 1600);
  setTimeout(()=> { steps[2].classList.add('done'); steps[3].classList.add('visible'); }, 2300);
  
  setTimeout(async () => {
    clearInterval(iv);
    steps[3].classList.add('done');
    
    try {
      const res = await fetch(`${API}/payment/process`, {
        method: 'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({txn_id: currentTxnId})
      });
      const data = await res.json();
      closeModal('modal-processing');
      if(data.success) {
        renderSuccess();
      } else {
        renderFailure(data.failure_reason);
      }
    } catch(e) {
      closeModal('modal-processing');
      renderFailure('Network Error');
    }
  }, 3000);
}

// ── SUCCESS / FAILURE ──────────────────────────
function renderSuccess() {
  playSuccessSound();
  closeAllModals();
  
  const quotes = [
    "“Thank you for parking with us! Drive safely.”",
    "“Your car was in good hands. Have a wonderful day!”",
    "“Parking made easy. Peace of mind made simple.”",
    "“To infinity and beyond! Safe travels.”",
    "“A journey of a thousand miles begins with a single step out of the parking lot.”"
  ];
  const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
  
  const d = new Date();
  const receiptContainer = document.getElementById('receipt-container');
  receiptContainer.innerHTML = `
    <div class="absolute -top-10 -right-10 w-40 h-40 bg-[#10b981] rounded-full blur-[80px] opacity-20"></div>
    <div class="success-checkmark mx-auto mb-4 flex justify-center">
      <svg viewBox="0 0 52 52" style="width:60px; height:60px;">
        <circle stroke="#10b981" stroke-width="2" fill="none" cx="26" cy="26" r="25"/>
        <path stroke="#10b981" stroke-width="3" fill="none" style="stroke-dasharray:48;stroke-dashoffset:0;" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
      </svg>
    </div>
    <h2 class="text-3xl text-[#10b981] mb-1 m-0">Paid, Thanks!</h2>
    <p class="text-[#f8fafc] italic opacity-80 mb-6 font-serif">" ${randomQuote} "</p>

    <div class="bg-[#1e293b] rounded-lg p-5 border border-[#334155] text-left text-sm flex flex-col gap-3">
      <div class="text-center font-bold text-lg mb-2">PAYMENT RECEIPT</div>
      <div class="flex justify-between border-b border-[#334155] pb-2"><span class="text-[#94a3b8]">Transaction ID</span><span class="font-mono font-bold">${currentTxnId}</span></div>
      <div class="flex justify-between"><span class="text-[#94a3b8]">Date & Time</span><span class="font-bold">${d.toLocaleString()}</span></div>
      <div class="flex justify-between"><span class="text-[#94a3b8]">Slot / Vehicle</span><span class="font-bold text-[#06b6d4]">${currentInvoice?.slot_id || 'N/A'} / ${currentInvoice?.vehicle || 'N/A'}</span></div>
      <div class="flex justify-between"><span class="text-[#94a3b8]">Duration</span><span class="font-bold">${currentInvoice?.duration || 'N/A'}</span></div>
      <div class="flex justify-between mt-2 pt-2 border-t border-[#334155]"><span class="text-[#94a3b8]">Amount</span><span class="font-bold text-lg text-[#10b981]">₹ ${currentTotal.toFixed(2)}</span></div>
      <div class="flex justify-between"><span class="text-[#94a3b8]">Payment Method</span><span class="font-bold uppercase">${selectedMethod}</span></div>
    </div>
  `;
  
  showTab('receipt');
  updateNavWallet();
}

function renderFailure(reason) {
  playFailureSound();
  document.getElementById('failure-reason').textContent = reason || 'Transaction failed';
  document.getElementById('failure-txn-ref').textContent = currentTxnId;
  openModal('modal-failure');
}

function downloadReceipt() {
  const win = window.open('','_blank','width=600,height=800');
  const d = new Date();
  win.document.write(`
    <html>
      <head>
        <title>Receipt - ${currentTxnId}</title>
        <style>
          body { font-family: 'Courier New', monospace; max-width: 400px; margin: 40px auto; padding:20px; color:#000; background:#fff; }
          .h { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 20px; margin-bottom: 20px; }
          .logo { font-size: 24px; font-weight: bold; margin-bottom:10px; }
          .r { display: flex; justify-content: space-between; margin: 8px 0; font-size:14px;}
          .b { font-weight: bold; }
          .tot { border-top: 2px dashed #000; border-bottom: 2px dashed #000; padding:10px 0; font-size:18px; font-weight:bold; margin-top:20px; }
          .foot { text-align: center; font-size: 12px; margin-top: 40px; }
          .qr { width:100px; height:100px; border:2px solid #000; margin: 20px auto; display:flex; align-items:center; justify-content:center; }
          @media print { body{margin:0;} }
        </style>
      </head>
      <body>
        <div class="h">
          <div class="logo">PayPark</div>
          <div>PAYMENT RECEIPT</div>
          <div>TXN: ${currentTxnId}</div>
          <div>Date: ${d.toLocaleString()}</div>
        </div>
        <div class="b mb">Parking Details</div>
        <div class="r"><span>Slot:</span><span>${currentInvoice?.slot_id || 'N/A'}</span></div>
        <div class="r"><span>Vehicle:</span><span>${currentInvoice?.vehicle || 'N/A'}</span></div>
        <br>
        <div class="b mb">Payment Details</div>
        <div class="r"><span>Base Fee:</span><span>₹ ${(currentTotal-currentInvoice?.platform_fee-currentInvoice?.gst).toFixed(2)}</span></div>
        <div class="r"><span>Taxes & Fees:</span><span>₹ ${(currentInvoice?.platform_fee+currentInvoice?.gst).toFixed(2)}</span></div>
        ${appliedDiscount ? `<div class="r"><span>Discount:</span><span>- ₹ ${appliedDiscount}</span></div>` : ''}
        <div class="r tot"><span>TOTAL PAID:</span><span>₹ ${currentTotal.toFixed(2)}</span></div>
        <div class="r"><span>Method:</span><span style="text-transform:uppercase">${selectedMethod}</span></div>
        
        <div class="qr">[QR SCANNED]</div>
        <div class="foot">Thank you for using PayPark.<br>For support, visit support.paypark.com</div>
        <script>setTimeout(()=>window.print(), 500);</script>
      </body>
    </html>
  `);
  win.document.close();
}

function sendReceiptEmail() {
  const email = prompt("Enter email address to send receipt:");
  if(email && email.includes('@')) {
    showToast(`Receipt sent to ${email}`, 'success');
  } else if (email) {
    showToast('Invalid email', 'error');
  }
}

// ── INITIATE PAYMENT (shared) ──────────────────
async function initiatePayment(method) {
  try {
    const res = await fetch(`${API}/payment/initiate`, {
      method: 'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        method: method,
        amount: currentTotal,
        slot_id: currentInvoice?.slot_id,
        plate: currentInvoice?.vehicle
      })
    });
    const data = await res.json();
    currentTxnId = data.txn_id;
    if(method === 'wallet' || method === 'cash') {
      processPayment(); // Skip OTP
    } else {
      showOTPModal(currentTxnId);
    }
  } catch(e) {
    showToast('Failed to initiate transaction', 'error');
  }
}

// ── DISCOUNT CODE ──────────────────────────────
async function applyDiscount() {
  const code = document.getElementById('discount-code-input').value;
  if(!code) return;
  try {
    const res = await fetch(`${API}/discount/apply`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({code, amount: currentInvoice.total})
    });
    const data = await res.json();
    const resDiv = document.getElementById('discount-result');
    if(data.valid) {
      resDiv.innerHTML = `<span class="text-[#10b981]">✓ Successfully applied</span>`;
      appliedDiscount = data.discount_amount;
      currentTotal = data.new_total;
      document.getElementById('discount-line').classList.remove('hidden');
      document.getElementById('invoice-discount').textContent = `- ${formatCurrency(appliedDiscount)}`;
      updateTotalDisplay();
    } else {
      resDiv.innerHTML = `<span class="text-[#ef4444]">✗ ${data.message}</span>`;
      removeDiscount();
    }
  } catch(e) {}
}

function removeDiscount() {
  appliedDiscount = null;
  currentTotal = currentInvoice?.total || 0;
  document.getElementById('discount-line').classList.add('hidden');
  document.getElementById('discount-code-input').value = '';
  document.getElementById('discount-result').innerHTML = '';
  updateTotalDisplay();
}

// ── SAVED CARDS ────────────────────────────────
async function loadSavedCards() {
  try {
    const res = await fetch(`${API}/saved-cards`);
    const cards = await res.json();
    const list = document.getElementById('saved-cards-list');
    list.innerHTML = cards.map(c => `
      <div class="saved-card" onclick="selectSavedCard('${c.last4}', '${c.type}', '${c.expiry}', '${c.name}', this)">
        <div class="flex items-center gap-3">
          <div class="w-10 h-6 bg-[#1e293b] rounded flex items-center justify-center text-xs font-bold">${c.type}</div>
          <div><div class="font-mono text-sm tracking-widest text-[#f8fafc]">•••• ${c.last4}</div></div>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs text-[#64748b]">${c.expiry}</span>
          <svg onclick="event.stopPropagation(); deleteSavedCard('${c.id}')" class="w-4 h-4 text-[#ef4444] cursor-pointer hover:text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6m5 0V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2"/></svg>
        </div>
      </div>
    `).join('');
  } catch(e) {}
}

function selectSavedCard(last4, type, exp, name, el) {
  document.querySelectorAll('.saved-card').forEach(c=>c.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('card-num').value = `**** **** **** ${last4}`;
  document.getElementById('card-name').value = name;
  document.getElementById('card-exp').value = exp;
  document.getElementById('card-cvv').value = '';
  document.getElementById('card-type').textContent = type;
  document.getElementById('card-type').className = `card-type-badge card-type-${type} block`;
}

async function deleteSavedCard(id) {
  try {
    await fetch(`${API}/saved-cards/${id}`, {method:'DELETE'});
    showToast('Saved card removed', 'success');
    loadSavedCards();
  } catch(e){}
}

// ── WALLET TAB ─────────────────────────────────
async function loadWallet() {
  try {
    const res = await fetch(`${API}/wallet/balance`);
    const data = await res.json();
    document.getElementById('wallet-balance').textContent = formatCurrency(data.balance);
    document.getElementById('wallet-id').textContent = data.wallet_id;
    
    document.getElementById('wallet-history-tbody').innerHTML = data.transactions.map(t => `
      <tr>
        <td>${formatDateTime(t.date)}</td>
        <td>${t.description}</td>
        <td><span class="badge ${t.type==='credit'?'badge-success':'badge-failed'}">${t.type.toUpperCase()}</span></td>
        <td class="font-bold ${t.type==='credit'?'text-[#10b981]':''}">${t.type==='credit'?'+':'-'} ${formatCurrency(t.amount)}</td>
      </tr>
    `).join('');
  } catch(e) {}
}

function quickTopUp(amt) { document.getElementById('topup-amount').value = amt; }

async function addMoney() {
  const amt = parseFloat(document.getElementById('topup-amount').value);
  if(!amt || amt <= 0) return showToast('Enter valid amount', 'error');
  showLoading('Processing Top-up...');
  try {
    const res = await fetch(`${API}/wallet/topup`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({amount:amt, source:'Card'})
    });
    const d = await res.json();
    hideLoading();
    showToast(`Added ${formatCurrency(amt)} to wallet`, 'success');
    document.getElementById('topup-amount').value = '';
    loadWallet();
    updateNavWallet();
  } catch(e) { hideLoading(); }
}

// ── TRANSACTIONS TAB ──────────────────────────
async function loadTransactions() {
  try {
    const fFrom = document.getElementById('filter-from').value;
    const fTo = document.getElementById('filter-to').value;
    const fMeth = document.getElementById('filter-method').value;
    const fStat = document.getElementById('filter-status').value;
    let url = `${API}/transactions?method=${fMeth}&status=${fStat}`;
    if(fFrom) url += `&from=${fFrom}`;
    if(fTo) url += `&to=${fTo}`;
    
    const res = await fetch(url);
    const txns = await res.json();
    
    const tbody = document.getElementById('transactions-tbody');
    tbody.innerHTML = txns.map(t => {
      let bClass = '';
      if(t.status==='success') bClass='badge-success';
      if(t.status==='failed') bClass='badge-failed';
      if(t.status==='pending') bClass='badge-pending';
      if(t.status==='refunded') bClass='badge-refunded';
      
      return `
      <tr>
        <td class="font-mono text-xs">${t.id}</td>
        <td>${formatDateTime(t.created_at)}</td>
        <td>${t.slot_id} / <span class="text-[#06b6d4]">${t.plate}</span></td>
        <td class="uppercase text-xs">${t.method}</td>
        <td><span class="badge ${bClass}">${t.status}</span></td>
        <td class="font-bold">₹ ${t.amount.toFixed(2)}</td>
        <td>
           <button class="btn btn-gray text-xs py-1 px-2" onclick="showToast('Receipt download started','info')">Receipt</button>
        </td>
      </tr>
    `}).join('');
    
    document.getElementById('total-txn-count').textContent = txns.length;
    const rev = txns.filter(t=>t.status==='success').reduce((s,t)=>s+t.amount,0);
    document.getElementById('total-revenue-stat').textContent = formatCurrency(rev);
    const succ = txns.filter(t=>t.status==='success').length;
    document.getElementById('success-rate-stat').textContent = txns.length ? Math.round(succ/txns.length*100)+'%' : '0%';
    document.getElementById('avg-txn-stat').textContent = succ ? formatCurrency(rev/succ) : '₹ 0.00';
    
  } catch(e) {}
}

function applyFilters() { loadTransactions(); }
function resetFilters() {
  document.getElementById('filter-from').value = '';
  document.getElementById('filter-to').value = '';
  document.getElementById('filter-method').value = 'All';
  document.getElementById('filter-status').value = 'All';
  loadTransactions();
}
function exportCSV() { window.location.href = `${API}/transactions/csv`; }
function exportExcel() { window.location.href = `${API}/transactions/excel`; }

// ── REFUNDS TAB ───────────────────────────────
async function lookupTransaction() {
  const tid = document.getElementById('refund-txn-id').value.trim();
  if(!tid) return showToast('Enter TXN ID','error');
  try {
    const res = await fetch(`${API}/transactions`);
    const txns = await res.json();
    const t = txns.find(x => x.id === tid);
    if(t && t.status==='success') {
      document.getElementById('refund-form').classList.remove('hidden');
      document.getElementById('refund-form').classList.add('flex');
      document.getElementById('rfd-amount').textContent = formatCurrency(t.amount);
      document.getElementById('rfd-method').textContent = t.method.toUpperCase();
    } else {
      showToast('Transaction not eligible for refund', 'error');
    }
  } catch(e) {}
}

document.getElementById('refund-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showLoading('Processing Refund...');
  try {
    const res = await fetch(`${API}/refunds/request`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        txn_id: document.getElementById('refund-txn-id').value,
        reason: document.getElementById('rfd-reason').value
      })
    });
    const data = await res.json();
    hideLoading();
    if(data.success) {
      showToast(data.message, 'success');
      document.getElementById('refund-form').classList.replace('flex','hidden');
      document.getElementById('refund-txn-id').value = '';
      loadRefunds();
    } else {
      showToast(data.message, 'error');
    }
  } catch(e) { hideLoading(); }
});

async function loadRefunds() {
  try {
    const res = await fetch(`${API}/refunds`);
    const rfs = await res.json();
    document.getElementById('refunds-tbody').innerHTML = rfs.map(r => {
      let bClass = r.status==='Completed'?'badge-success':r.status==='Processing'?'badge-refunded':r.status==='Rejected'?'badge-failed':'badge-pending';
      return `
      <tr>
        <td class="font-mono text-xs">${r.id}</td>
        <td class="font-mono text-xs text-[#94a3b8]">${r.txn_id}</td>
        <td class="truncate max-w-[150px]">${r.reason}</td>
        <td><span class="badge ${bClass}">${r.status}</span></td>
        <td>${formatDate(r.submitted_at)}</td>
        <td class="font-bold text-[#f8fafc]">₹ ${r.amount.toFixed(2)}</td>
        <td>${(r.status==='Initiated' || r.status==='Processing')?`<button class="btn btn-danger text-xs py-1 px-2" onclick="cancelRefund('${r.id}')">Cancel</button>`:'-'}</td>
      </tr>
    `}).join('');
  } catch(e) {}
}

async function cancelRefund(id) {
  try {
    await fetch(`${API}/refunds/${id}`, {method:'DELETE'});
    showToast('Refund cancelled', 'success');
    loadRefunds();
  } catch(e){}
}

// ── DASHBOARD TAB ─────────────────────────────
async function loadDashboard() {
  try {
    const res = await fetch(`${API}/dashboard/stats`);
    const data = await res.json();
    
    document.getElementById('dashboard-stats-row').innerHTML = `
      <div class="stat-card"><div class="stat-value text-[#10b981]">₹ ${data.today_revenue}</div><div class="stat-label">Today's Revenue</div></div>
      <div class="stat-card"><div class="stat-value text-[#3b82f6]">₹ ${data.month_revenue}</div><div class="stat-label">Month Revenue</div></div>
      <div class="stat-card"><div class="stat-value text-[#f8fafc]">${data.txn_count_today}</div><div class="stat-label">Transactions Today</div></div>
      <div class="stat-card"><div class="stat-value text-[#f59e0b]">${data.success_rate}%</div><div class="stat-label">Success Rate</div></div>
    `;
    
    renderRevenueChart(data.revenue_14days);
    renderMethodChart(data.method_breakdown);
    renderHeatmap(data.hourly_heatmap);
    
    document.getElementById('recent-failed-tbody').innerHTML = data.recent_failed.map(t => `
      <tr>
        <td class="font-mono text-xs">${t.id}</td>
        <td class="font-bold">₹ ${t.amount.toFixed(2)}</td>
        <td class="uppercase text-xs">${t.method}</td>
        <td class="text-xs text-[#ef4444]">${t.failure_reason}</td>
      </tr>
    `).join('');
    
  } catch(e) {}
}

function renderRevenueChart(data) {
  if(revenueChart) revenueChart.destroy();
  const ctx = document.getElementById('revenue-chart').getContext('2d');
  revenueChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(d=>d.date.substring(5)),
      datasets: [
        { label: 'Collected (₹)', data: data.map(d=>d.collected), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.4 },
        { label: 'Refunded (₹)', data: data.map(d=>d.refunded), borderColor: '#ef4444', backgroundColor: 'transparent', fill: false, tension: 0.4 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { grid: { color: '#1e293b' }, ticks:{color:'#94a3b8'} }, y: { grid: { color: '#1e293b' }, ticks:{color:'#94a3b8'} } }, plugins: { legend: { labels: { color: '#f8fafc' } } } }
  });
}

function renderMethodChart(data) {
  if(methodChart) methodChart.destroy();
  const ctx = document.getElementById('method-chart').getContext('2d');
  const colors = {'card':'#3b82f6', 'upi':'#10b981', 'wallet':'#06b6d4', 'netbanking':'#f59e0b', 'emi':'#a855f7', 'cash':'#64748b'};
  const lbs = data.map(d=>d.method.toUpperCase());
  const vals = data.map(d=>d.count);
  const bg = data.map(d=>colors[d.method]||'#fff');
  
  methodChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: lbs, datasets: [{ data: vals, backgroundColor: bg, borderColor: '#0f172a', borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#f8fafc' } } }, cutout: '70%' }
  });
}

function renderHeatmap(grid) {
  const cont = document.getElementById('heatmap-container');
  cont.innerHTML = '';
  // 7 rows (days), 24 cols (hours)
  for(let r=0; r<7; r++) {
    for(let c=0; c<24; c++) {
      const val = grid[r][c];
      const div = document.createElement('div');
      div.className = 'heatmap-cell';
      if(val > 0) {
        const opacity = Math.min(val*0.2, 1);
        div.style.backgroundColor = `rgba(16, 185, 129, ${opacity})`;
      }
      div.title = `Day -${6-r}, Hour ${c}:00\n${val} Transactions`;
      cont.appendChild(div);
    }
  }
}

// ── SETTINGS TAB ──────────────────────────────
async function loadSettings() {
  try {
    const res = await fetch(`${API}/settings`);
    const set = await res.json();
    
    const mc = document.getElementById('methods-toggle-container');
    mc.innerHTML = Object.entries(set.payment_methods).map(([k,v]) => `
      <label class="flex items-center justify-between cursor-pointer">
        <span class="text-sm uppercase">${k}</span>
        <input type="checkbox" id="m-tg-${k}" ${v?'checked':''}>
      </label>
    `).join('');
    
    document.getElementById('setting-limit').value = set.transaction_limit_daily;
    document.getElementById('setting-otp-time').value = set.otp_timeout;
    
    document.getElementById('setting-fee-type').value = set.platform_fee.type;
    document.getElementById('setting-fee-amt').value = set.platform_fee.amount;
    document.getElementById('setting-gst').value = set.gst_rate;
    
    document.getElementById('setting-sms').checked = set.notifications.sms;
    document.getElementById('setting-email').checked = set.notifications.email;
    document.getElementById('setting-def-phone').value = set.notifications.phone;
    document.getElementById('setting-def-email').value = set.notifications.email_addr;
  } catch(e) {}
}

async function savePaymentSettings() {
  showToast('Payment config saved');
}

async function saveFeeConfig() {
  showToast('Fee config saved');
}

async function saveNotificationSettings() {
  showToast('Notification config saved');
}

function toggleSplitPayment() {
  isSplitPayment = document.getElementById('split-toggle').checked;
  if(isSplitPayment) showToast("Split payment enabled feature available in real API", 'info');
}

// ── KEYBOARD SHORTCUTS ────────────────────────
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if(k==='p') showTab('payment');
    if(k==='w') showTab('wallet');
    if(k==='t') showTab('transactions');
    if(k==='r') showTab('refunds');
    if(k==='d') showTab('dashboard');
    if(k==='s') showTab('settings');
    if(e.key==='Escape') closeAllModals();
  });
}

// ── UTILS & UI ────────────────────────────────
function showToast(msg, type='info') {
  const container = document.getElementById('toast-container');
  const t = document.createElement('div');
  const icons = {'success':'✓', 'error':'✕', 'warning':'!', 'info':'i'};
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="w-6 h-6 rounded-full border border-current flex items-center justify-center font-bold text-xs">${icons[type]}</span> <span>${msg}</span>`;
  container.appendChild(t);
  setTimeout(()=> {
    t.classList.add('removing');
    setTimeout(()=>t.remove(), 300);
  }, 4000);
}

function showLoading(text) {
  document.getElementById('loading-overlay').classList.remove('hidden');
  document.getElementById('loading-text').textContent = text || 'Loading...';
}
function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

function openModal(id) { document.getElementById(id).classList.add('active'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { document.getElementById(id).classList.remove('active'); document.body.style.overflow = ''; }
function closeAllModals() { document.querySelectorAll('.modal-overlay').forEach(m=>m.classList.remove('active')); document.body.style.overflow = ''; }

function formatCurrency(n) { return '₹ ' + parseFloat(n).toFixed(2); }
function formatDate(iso) { return new Date(iso).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}); }
function formatTime(iso) { return new Date(iso).toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'}); }
function formatDateTime(iso) { return formatDate(iso) + ' ' + formatTime(iso); }
