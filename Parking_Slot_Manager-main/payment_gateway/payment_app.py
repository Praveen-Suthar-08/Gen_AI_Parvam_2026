# payment_app.py
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS
import json
import os
from datetime import datetime, timedelta
import random
import uuid
import time

app = Flask(__name__, static_folder='static')
CORS(app)

DATA_DIR = 'data'
DATA_FILE = os.path.join(DATA_DIR, 'payment_data.json')

def load_data():
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)
    if not os.path.exists(DATA_FILE):
        return init_data()
    try:
        with open(DATA_FILE, 'r') as f:
            return json.load(f)
    except Exception as e:
        return init_data()

def save_data(data):
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)
    try:
        with open(DATA_FILE, 'w') as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        pass

def init_data():
    now = datetime.utcnow()
    transactions = []
    methods_pool = ['card']*8 + ['upi']*5 + ['wallet']*4 + ['netbanking']*2 + ['cash']*1
    statuses_pool = ['success']*16 + ['failed']*2 + ['refunded']*2
    
    for _ in range(20):
        days_ago = random.randint(0, 13)
        dt = now - timedelta(days=days_ago, hours=random.randint(1,23))
        method = random.choice(methods_pool)
        status = random.choice(statuses_pool)
        amount = round(random.uniform(5.0, 150.0), 2)
        transactions.append({
            "id": f"TXN-{str(uuid.uuid4())[:10].upper()}",
            "slot_id": f"{random.choice(['A','B','C','D'])}{random.randint(1,20):02d}",
            "plate": f"KA01AB{random.randint(1000,9999)}",
            "amount": amount,
            "method": method,
            "status": status,
            "created_at": dt.isoformat() + "Z",
            "failure_reason": "Insufficient funds" if status == 'failed' else None
        })
        
    wallet_txns = []
    for _ in range(5):
        days_ago = random.randint(0, 30)
        dt = now - timedelta(days=days_ago)
        wallet_txns.append({
            "id": f"WTX-{str(uuid.uuid4())[:8].upper()}",
            "date": dt.isoformat() + "Z",
            "description": "Added to Wallet",
            "type": "credit",
            "amount": 50.0
        })
        
    data = {
        "transactions": transactions,
        "wallet": {
            "balance": 245.00,
            "wallet_id": "WLT-A7K2M9",
            "transactions": wallet_txns
        },
        "refunds": [],
        "saved_cards": [
            {"id": "sc1", "last4": "4532", "type": "Visa", "expiry": "12/26", "name": "John Doe"},
            {"id": "sc2", "last4": "8923", "type": "Mastercard", "expiry": "09/25", "name": "John Doe"}
        ],
        "discount_codes": [
            {"code": "PARK10", "type": "percent", "value": 10, "max_uses": 100, "used": 14, "expiry": "2025-12-31"},
            {"code": "FIRST50", "type": "flat", "value": 50, "max_uses": 1, "used": 0, "expiry": "2025-12-31"},
            {"code": "WEEKEND20", "type": "percent", "value": 20, "max_uses": 50, "used": 8, "expiry": "2025-12-31"}
        ],
        "settings": {
            "payment_methods": {"card": True, "upi": True, "netbanking": True, "wallet": True, "emi": True, "cash": True},
            "platform_fee": {"type": "flat", "amount": 2.0},
            "gst_rate": 18,
            "otp_timeout": 300,
            "max_otp_attempts": 3,
            "transaction_limit_daily": 10000,
            "notifications": {"sms": True, "email": True, "whatsapp": False, "phone": "9876540123", "email_addr": "user@example.com"}
        },
        "otp_sessions": {}
    }
    save_data(data)
    return data

@app.route('/')
def index():
    return send_from_directory('static', 'payment.html')

@app.route('/static/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)

@app.route('/api/payment/invoice', methods=['GET'])
def get_invoice():
    try:
        data = load_data()
        now = datetime.utcnow()
        entry = now - timedelta(hours=2, minutes=30)
        subtotal = 5.00
        plat_fee = data['settings']['platform_fee']['amount'] if data['settings']['platform_fee']['type'] == 'flat' else subtotal * (data['settings']['platform_fee']['amount'] / 100.0)
        gst = (subtotal + plat_fee) * (data['settings']['gst_rate'] / 100.0)
        total = subtotal + plat_fee + gst
        
        return jsonify({
            "slot_id": "B07",
            "vehicle": "KA01AB1234",
            "entry_time": entry.isoformat() + "Z",
            "exit_time": now.isoformat() + "Z",
            "duration": "2h 30m",
            "rate_per_hour": 2.0,
            "subtotal": round(subtotal, 2),
            "platform_fee": round(plat_fee, 2),
            "gst": round(gst, 2),
            "total": round(total, 2),
            "invoice_number": f"INV-{random.randint(100000, 999999)}"
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/payment/initiate', methods=['POST'])
def initiate_payment():
    try:
        body = request.json
        data = load_data()
        txn_id = f"TXN-{str(uuid.uuid4())[:10].upper()}"
        
        txn = {
            "id": txn_id,
            "slot_id": body.get('slot_id', 'SYS'),
            "plate": body.get('plate', 'N/A'),
            "amount": float(body.get('amount', 0)),
            "method": body.get('method', 'unknown'),
            "status": "pending",
            "created_at": datetime.utcnow().isoformat() + "Z"
        }
        data['transactions'].insert(0, txn)
        
        data['otp_sessions'][txn_id] = {"attempts": 0, "max": data['settings']['max_otp_attempts']}
        save_data(data)
        
        return jsonify({"txn_id": txn_id, "otp_ref": str(uuid.uuid4())})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/payment/verify-otp', methods=['POST'])
def verify_otp():
    try:
        body = request.json
        txn_id = body.get('txn_id')
        otp = body.get('otp')
        data = load_data()
        
        if txn_id not in data['otp_sessions']:
            return jsonify({"success": False, "message": "Invalid session"}), 400
            
        session = data['otp_sessions'][txn_id]
        if session['attempts'] >= session['max']:
            return jsonify({"success": False, "locked": True, "message": "Too many attempts. Locked out."}), 400
            
        if otp == "123456":
            return jsonify({"success": True, "attempts_left": session['max'] - session['attempts']})
        else:
            session['attempts'] += 1
            save_data(data)
            return jsonify({"success": False, "attempts_left": session['max'] - session['attempts'], "message": "Invalid OTP"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/payment/process', methods=['POST'])
def process_payment():
    try:
        body = request.json
        txn_id = body.get('txn_id')
        data = load_data()
        
        txn = next((t for t in data['transactions'] if t['id'] == txn_id), None)
        if not txn:
            return jsonify({"error": "Transaction not found"}), 404
            
        success = random.random() < 0.90
        
        if success:
            if txn['method'] == 'wallet':
                if data['wallet']['balance'] < txn['amount']:
                    txn['status'] = 'failed'
                    txn['failure_reason'] = "Insufficient wallet balance"
                    save_data(data)
                    return jsonify({"success": False, "status": "failed", "failure_reason": txn['failure_reason']})
                data['wallet']['balance'] -= txn['amount']
                data['wallet']['transactions'].insert(0, {
                    "id": f"WTX-{str(uuid.uuid4())[:8].upper()}",
                    "date": datetime.utcnow().isoformat() + "Z",
                    "description": "Payment for parking",
                    "type": "debit",
                    "amount": round(txn['amount'], 2)
                })
            txn['status'] = 'success'
            save_data(data)
            return jsonify({"success": True, "status": "success"})
        else:
            txn['status'] = 'failed'
            reasons = ["Insufficient funds", "Card declined", "Bank timeout", "Network error"]
            txn['failure_reason'] = random.choice(reasons)
            save_data(data)
            return jsonify({"success": False, "status": "failed", "failure_reason": txn['failure_reason']})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/payment/upi/verify', methods=['POST'])
def verify_upi():
    try:
        body = request.json
        upi_id = body.get('upi_id', '')
        time.sleep(1.5)
        if '@' in upi_id:
            return jsonify({"success": True, "name": "Verified User"})
        return jsonify({"success": False, "error": "Invalid UPI ID"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/wallet/balance', methods=['GET'])
def wallet_balance():
    try:
        data = load_data()
        return jsonify({
            "balance": round(data['wallet']['balance'], 2),
            "wallet_id": data['wallet']['wallet_id'],
            "transactions": data['wallet']['transactions']
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/wallet/topup', methods=['POST'])
def wallet_topup():
    try:
        body = request.json
        amount = float(body.get('amount', 0))
        data = load_data()
        data['wallet']['balance'] += amount
        data['wallet']['transactions'].insert(0, {
            "id": f"WTX-{str(uuid.uuid4())[:8].upper()}",
            "date": datetime.utcnow().isoformat() + "Z",
            "description": "Added to Wallet via " + body.get('source', 'Card'),
            "type": "credit",
            "amount": amount
        })
        save_data(data)
        return jsonify({"new_balance": round(data['wallet']['balance'], 2)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/transactions', methods=['GET'])
def get_transactions():
    try:
        data = load_data()
        txs = data['transactions']
        fd = request.args.get('from')
        td = request.args.get('to')
        meth = request.args.get('method')
        stat = request.args.get('status')
        min_a = request.args.get('min_amount')
        max_a = request.args.get('max_amount')
        
        res = []
        for t in txs:
            d = t['created_at'][:10]
            if fd and d < fd: continue
            if td and d > td: continue
            if meth and meth != 'All' and t['method'] != meth: continue
            if stat and stat != 'All' and t['status'] != stat: continue
            if min_a and t['amount'] < float(min_a): continue
            if max_a and t['amount'] > float(max_a): continue
            res.append(t)
            
        res.sort(key=lambda x: x['created_at'], reverse=True)
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/transactions/csv', methods=['GET'])
def transactions_csv():
    try:
        data = load_data()
        lines = ["TXN ID,Date,Slot,Plate,Amount,Method,Status"]
        for t in sorted(data['transactions'], key=lambda x: x['created_at'], reverse=True):
            lines.append(f"{t['id']},{t['created_at']},{t.get('slot_id','')},{t.get('plate','')},{t['amount']},{t['method']},{t['status']}")
        return Response("\n".join(lines), mimetype="text/csv", headers={"Content-disposition":"attachment; filename=transactions.csv"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/transactions/excel', methods=['GET'])
def transactions_excel():
    try:
        data = load_data()
        lines = ["TXN ID\tDate\tSlot\tPlate\tAmount\tMethod\tStatus"]
        for t in sorted(data['transactions'], key=lambda x: x['created_at'], reverse=True):
            lines.append(f"{t['id']}\t{t['created_at']}\t{t.get('slot_id','')}\t{t.get('plate','')}\t{t['amount']}\t{t['method']}\t{t['status']}")
        return Response("\n".join(lines), mimetype="application/vnd.ms-excel", headers={"Content-disposition":"attachment; filename=transactions.xls"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/refunds/request', methods=['POST'])
def req_refund():
    try:
        body = request.json
        txn_id = body.get('txn_id')
        data = load_data()
        txn = next((t for t in data['transactions'] if t['id'] == txn_id), None)
        if not txn: return jsonify({"success": False, "message": "Transaction not found"}), 404
        if txn['status'] != 'success': return jsonify({"success": False, "message": "Only successful transactions can be refunded"})
        dt = datetime.fromisoformat(txn['created_at'].replace('Z', ''))
        if (datetime.utcnow() - dt).total_seconds() > 24 * 3600:
            return jsonify({"success": False, "message": "Refund window expired (24h)"})
            
        if any(r['txn_id'] == txn_id for r in data['refunds']):
            return jsonify({"success": False, "message": "Refund already requested"})
            
        success = random.random() < 0.85
        if not success:
            return jsonify({"success": False, "message": "Refund rejected by payment processor"})
            
        rfd_id = f"RFD-{str(uuid.uuid4())[:5].upper()}"
        txn['status'] = 'refunded'
        data['refunds'].insert(0, {
            "id": rfd_id,
            "txn_id": txn_id,
            "amount": txn['amount'],
            "reason": body.get('reason'),
            "status": "Processing",
            "submitted_at": datetime.utcnow().isoformat() + "Z",
            "expected_date": (datetime.utcnow() + timedelta(days=3)).isoformat() + "Z"
        })
        save_data(data)
        return jsonify({"success": True, "refund_id": rfd_id, "message": "Refund initiated"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/refunds', methods=['GET'])
def get_refunds():
    try:
        return jsonify(load_data()['refunds'])
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/refunds/<id>', methods=['DELETE'])
def cancel_refund(id):
    try:
        data = load_data()
        for r in data['refunds']:
            if r['id'] == id:
                if r['status'] == 'Initiated' or r['status'] == 'Processing':
                    r['status'] = 'Cancelled'
                    save_data(data)
                    return jsonify({"success": True})
                return jsonify({"error": "Cannot cancel this refund"}), 400
        return jsonify({"error": "Not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/dashboard/stats', methods=['GET'])
def dash_stats():
    try:
        data = load_data()
        txs = data['transactions']
        now = datetime.utcnow()
        today_str = now.strftime("%Y-%m-%d")
        month_str = now.strftime("%Y-%m")
        
        today_rev = sum(t['amount'] for t in txs if t['status']=='success' and t['created_at'].startswith(today_str))
        month_rev = sum(t['amount'] for t in txs if t['status']=='success' and t['created_at'].startswith(month_str))
        today_txns = [t for t in txs if t['created_at'].startswith(today_str)]
        success_rate = (sum(1 for t in today_txns if t['status']=='success') / len(today_txns) * 100) if today_txns else 0
        
        rev_14 = {}
        for i in range(14):
            d = (now - timedelta(days=13-i)).strftime("%Y-%m-%d")
            rev_14[d] = {'collected': 0, 'refunded': 0}
        
        methods = {}
        hourly = [[0]*24 for _ in range(7)]
        recent_failed = []
        
        for t in txs:
            d = t['created_at'][:10]
            if d in rev_14:
                if t['status'] == 'success': rev_14[d]['collected'] += t['amount']
                elif t['status'] == 'refunded': rev_14[d]['refunded'] += t['amount']
            
            if t['status'] == 'success':
                methods[t['method']] = methods.get(t['method'], 0) + 1
                
            if t['status'] == 'failed' and len(recent_failed) < 5:
                recent_failed.append(t)
                
            try:
                dt = datetime.fromisoformat(t['created_at'].replace('Z',''))
                diff_days = (now - dt).days
                if 0 <= diff_days < 7:
                    hourly[diff_days][dt.hour] += 1
            except: pass
            
        method_arr = [{"method": k, "count": v} for k,v in methods.items()]
        rev_arr = [{"date": k, "collected": v['collected'], "refunded": v['refunded']} for k,v in rev_14.items()]
        
        return jsonify({
            "today_revenue": round(today_rev, 2),
            "month_revenue": round(month_rev, 2),
            "txn_count_today": len(today_txns),
            "success_rate": round(success_rate, 1),
            "revenue_14days": sorted(rev_arr, key=lambda x: x['date']),
            "method_breakdown": method_arr,
            "hourly_heatmap": hourly,
            "recent_failed": recent_failed
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/settings', methods=['GET', 'PUT'])
def handle_settings():
    try:
        data = load_data()
        if request.method == 'GET':
            return jsonify(data['settings'])
        else:
            body = request.json
            data['settings'].update(body)
            save_data(data)
            return jsonify(data['settings'])
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/discount/apply', methods=['POST'])
def apply_discount():
    try:
        body = request.json
        code = body.get('code', '').upper()
        amount = float(body.get('amount', 0))
        data = load_data()
        
        for disc in data['discount_codes']:
            if disc['code'] == code:
                if disc['used'] >= disc['max_uses']:
                    return jsonify({"valid": False, "message": "Promo code fully used"}), 400
                if datetime.utcnow().isoformat() > disc['expiry']:
                    return jsonify({"valid": False, "message": "Promo code expired"}), 400
                    
                val = disc['value']
                disc_amt = amount * (val/100.0) if disc['type'] == 'percent' else val
                disc_amt = min(disc_amt, amount)
                return jsonify({
                    "valid": True, "discount_type": disc['type'], "discount_value": val,
                    "discount_amount": round(disc_amt, 2), "new_total": round(amount - disc_amt, 2)
                })
        return jsonify({"valid": False, "message": "Invalid code"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/saved-cards', methods=['GET', 'POST'])
def handle_saved_cards():
    try:
        data = load_data()
        if request.method == 'GET':
            return jsonify(data.get('saved_cards', []))
        else:
            body = request.json
            new_card = {
                "id": f"sc{random.randint(100,999)}",
                "last4": body.get('last4'),
                "type": body.get('type'),
                "expiry": body.get('expiry'),
                "name": body.get('name')
            }
            if 'saved_cards' not in data: data['saved_cards'] = []
            data['saved_cards'].append(new_card)
            save_data(data)
            return jsonify(new_card)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/saved-cards/<id>', methods=['DELETE'])
def del_saved_card(id):
    try:
        data = load_data()
        data['saved_cards'] = [c for c in data.get('saved_cards', []) if c['id'] != id]
        save_data(data)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
