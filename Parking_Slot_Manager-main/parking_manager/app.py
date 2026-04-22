# app.py
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS
import json
import os
from datetime import datetime, timedelta
import random
import uuid

app = Flask(__name__, static_folder='static')
CORS(app)

DATA_DIR = 'data'
DATA_FILE = os.path.join(DATA_DIR, 'parking_data.json')

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
    slots = []
    zones = ['A', 'B', 'C', 'D']
    types_weights = ['standard', 'compact', 'ev', 'handicap', 'vip']
    weights = [60, 10, 12, 8, 10]
    
    for zone in zones:
        for i in range(1, 21):
            slot_type = random.choices(types_weights, weights=weights, k=1)[0]
            floor = ((i - 1) // 7) + 1
            if floor > 3: 
                floor = 3
            slots.append({
                "id": f"{zone}{i:02d}",
                "zone": zone,
                "number": i,
                "type": slot_type,
                "status": "available",
                "plate": None,
                "owner": None,
                "phone": None,
                "vehicle_type": None,
                "entry_time": None,
                "reserved_by": None,
                "reserved_until": None,
                "maintenance_reason": None,
                "floor": floor,
                "sensor_status": "online" if random.random() < 0.95 else "offline",
                "last_updated": datetime.utcnow().isoformat() + "Z"
            })
            
    transactions = []
    now = datetime.utcnow()

    data = {
        "slots": slots,
        "reservations": [],
        "transactions": transactions,
        "alerts": [],
        "activity_log": [{
            "type": "info",
            "slot": "SYS",
            "plate": "",
            "message": "System initialized",
            "fee": None,
            "time": now.isoformat() + "Z"
        }],
        "memberships": [],
        "shifts": [],
        "blacklist": [],
        "settings": {
            "facility_name": "SmartPark Central",
            "location": "Sector 5, Downtown",
            "address": "123 Tech Park Ave, Silicon City, 560001",
            "contact": "+91 98765 43210",
            "gst_number": "29AAAAA0000A1Z5",
            "hourly_rates": {"standard": 2.0, "handicap": 1.0, "ev": 2.5, "vip": 5.0, "compact": 1.5},
            "reservation_fee": 1.0,
            "grace_period_minutes": 10,
            "max_reservation_hours": 24,
            "open_time": "06:00",
            "close_time": "23:00"
        }
    }
    save_data(data)
    return data

def send_digital_receipt(phone, email, invoice_data):
    # Mock integration logic for Phase 4
    if phone or email:
        print(f"[MOCK NOTIFICATION] Sending digital receipt to Phone: {phone}, Email: {email}")
        print(f"[MOCK NOTIFICATION] Invoice Detail: {invoice_data}")

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/static/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)

@app.route('/api/slots', methods=['GET'])
def get_slots():
    try:
        data = load_data()
        slots = data['slots']
        
        zone = request.args.get('zone', 'All')
        floor = request.args.get('floor', 'All')
        slot_type = request.args.get('type', 'All')
        status = request.args.get('status', 'All')
        search = request.args.get('search', '').upper()
        
        filtered = []
        for s in slots:
            if zone != 'All' and s['zone'] != zone: continue
            if floor != 'All' and str(s['floor']) != floor: continue
            if slot_type != 'All' and s['type'].lower() != slot_type.lower(): continue
            if status != 'All' and s['status'].lower() != status.lower(): continue
            if search and search not in s['id'].upper(): continue
            filtered.append(s)
            
        return jsonify(filtered)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/slots/<id>', methods=['GET'])
def get_slot(id):
    try:
        data = load_data()
        for s in data['slots']:
            if s['id'] == id:
                return jsonify(s)
        return jsonify({"error": "Not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def add_activity(data, type, slot, msg=None, plate=None, fee=None):
    data['activity_log'].insert(0, {
        "type": type,
        "slot": slot,
        "plate": plate,
        "message": msg,
        "fee": fee,
        "time": datetime.utcnow().isoformat() + "Z"
    })
    data['activity_log'] = data['activity_log'][:50]

@app.route('/api/slots/<id>/checkin', methods=['PUT'])
def checkin(id):
    try:
        body = request.json
        data = load_data()
        
        # Blacklist check
        plate = body.get('plate', '').upper()
        if plate and any(b['plate'] == plate for b in data.get('blacklist', [])):
            return jsonify({"error": "BLACKLISTED", "message": "This license plate is banned."}), 403
            
        for s in data['slots']:
            if s['id'] == id:
                s['status'] = 'occupied'
                s['plate'] = body.get('plate')
                s['owner'] = body.get('owner')
                s['phone'] = body.get('phone')
                s['vehicle_type'] = body.get('vehicle_type')
                s['entry_time'] = datetime.utcnow().isoformat() + "Z"
                s['last_updated'] = s['entry_time']
                add_activity(data, "checkin", id, msg="Checked in", plate=s['plate'])
                save_data(data)
                return jsonify({"success": True})
        return jsonify({"error": "Slot not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/slots/<id>/checkout', methods=['PUT'])
def checkout(id):
    try:
        data = load_data()
        body = request.json or {}
        now = datetime.utcnow()
        for s in data['slots']:
            if s['id'] == id:
                if s['status'] != 'occupied':
                    return jsonify({"error": "Slot not occupied"}), 400
                
                entry = datetime.fromisoformat(s['entry_time'].replace('Z', ''))
                dur_hours = (now - entry).total_seconds() / 3600.0
                dur_mins = int((now - entry).total_seconds() / 60)
                
                rate = data['settings']['hourly_rates'].get(s['type'], 2.0)
                
                # Check Membership
                fee = max(1.0, dur_hours) * rate
                is_member = any(m['plate'].upper() == (s['plate'] or '').upper() for m in data.get('memberships', []))
                
                # Check Surge Pricing
                surge_active = False
                if not is_member:
                    total_slots = len(data['slots'])
                    occupied_slots = sum(1 for slot in data['slots'] if slot['status'] == 'occupied')
                    if total_slots > 0 and (occupied_slots / total_slots) > 0.85:
                        fee = fee * 1.5
                        surge_active = True
                else:
                    fee = 0.0
                
                fee = round(fee, 2)
                payment_method = body.get("payment_method", "card") # Default mock method
                
                tx_id = str(uuid.uuid4())
                tx = {
                    "id": tx_id,
                    "slot_id": id,
                    "plate": s['plate'],
                    "owner": s['owner'],
                    "vehicle_type": s['vehicle_type'],
                    "entry_time": s['entry_time'],
                    "exit_time": now.isoformat() + "Z",
                    "duration_minutes": dur_mins,
                    "amount": fee,
                    "payment_method": payment_method,
                    "date": now.strftime("%Y-%m-%d")
                }
                data['transactions'].append(tx)
                
                add_activity(data, "checkout", id, msg=f"Checked out via {payment_method}", plate=s['plate'], fee=fee)
                
                send_digital_receipt(s.get('phone'), None, tx)
                
                s['status'] = 'available'
                s['plate'] = None
                s['owner'] = None
                s['phone'] = None
                s['vehicle_type'] = None
                s['entry_time'] = None
                s['last_updated'] = now.isoformat() + "Z"
                
                save_data(data)
                return jsonify({
                    "fee": fee,
                    "duration": dur_mins,
                    "transaction_id": tx_id,
                    "surge_active": surge_active,
                    "is_member": is_member
                })
        return jsonify({"error": "Slot not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/slots/<id>/maintenance', methods=['PUT'])
def maintenance(id):
    try:
        body = request.json
        action = body.get('action')
        reason = body.get('reason')
        data = load_data()
        for s in data['slots']:
            if s['id'] == id:
                if action == 'set':
                    s['status'] = 'maintenance'
                    s['maintenance_reason'] = reason
                elif action == 'clear':
                    s['status'] = 'available'
                    s['maintenance_reason'] = None
                s['last_updated'] = datetime.utcnow().isoformat() + "Z"
                save_data(data)
                return jsonify({"success": True})
        return jsonify({"error": "Slot not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/reservations', methods=['GET', 'POST'])
def reservations():
    try:
        data = load_data()
        if request.method == 'GET':
            sorted_res = sorted(data['reservations'], key=lambda x: x.get('created_at', ''), reverse=True)
            return jsonify(sorted_res)
        
        body = request.json
        slot_id = body.get('slot_id')
        now = datetime.utcnow()
        try:
            dt_str = f"{body['date']}T{body['time']}:00"
            from_dt = datetime.fromisoformat(dt_str)
        except:
            from_dt = now
            
        until_dt = from_dt + timedelta(hours=int(body.get('duration_hours', 1)))
        
        res = {
            "id": str(uuid.uuid4()),
            "slot_id": slot_id,
            "name": body.get('name'),
            "phone": body.get('phone'),
            "from_dt": from_dt.isoformat() + "Z",
            "until_dt": until_dt.isoformat() + "Z",
            "status": "active",
            "created_at": now.isoformat() + "Z"
        }
        
        for s in data['slots']:
            if s['id'] == slot_id:
                s['status'] = 'reserved'
                s['reserved_by'] = body.get('name')
                s['reserved_until'] = res['until_dt']
                s['last_updated'] = now.isoformat() + "Z"
                break
                
        data['reservations'].append(res)
        add_activity(data, "reservation", slot_id, msg="Reserved")
        save_data(data)
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/reservations/<id>', methods=['DELETE'])
def cancel_reservation(id):
    try:
        data = load_data()
        for r in data['reservations']:
            if r['id'] == id:
                r['status'] = 'cancelled'
                for s in data['slots']:
                    if s['id'] == r['slot_id']:
                        s['status'] = 'available'
                        s['reserved_by'] = None
                        s['reserved_until'] = None
                        s['last_updated'] = datetime.utcnow().isoformat() + "Z"
                        break
                save_data(data)
                return jsonify({"success": True})
        return jsonify({"error": "Not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/reservations/expire', methods=['POST'])
def expire_reservations():
    try:
        data = load_data()
        now = datetime.utcnow()
        changed = 0
        for r in data['reservations']:
            if r['status'] == 'active':
                until = datetime.fromisoformat(r['until_dt'].replace('Z', ''))
                if until < now:
                    r['status'] = 'expired'
                    for s in data['slots']:
                        if s['id'] == r['slot_id']:
                            s['status'] = 'available'
                            s['reserved_by'] = None
                            s['reserved_until'] = None
                            s['last_updated'] = now.isoformat() + "Z"
                            break
                    changed += 1
        if changed > 0:
            save_data(data)
        return jsonify({"expired": changed})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/vehicles', methods=['GET'])
def get_vehicles():
    try:
        data = load_data()
        occupied = [s for s in data['slots'] if s['status'] == 'occupied']
        return jsonify(occupied)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/vehicles/history', methods=['GET'])
def get_vehicle_history():
    try:
        data = load_data()
        txs = sorted(data['transactions'], key=lambda x: x.get('exit_time', ''), reverse=True)
        return jsonify(txs)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/transactions', methods=['GET'])
def transactions():
    try:
        data = load_data()
        txs = data['transactions']
        from_date = request.args.get('from_date')
        to_date = request.args.get('to_date')
        if from_date and to_date:
            filtered = [t for t in txs if from_date <= t['date'] <= to_date]
            return jsonify(sorted(filtered, key=lambda x: x.get('exit_time', ''), reverse=True))
        return jsonify(sorted(txs, key=lambda x: x.get('exit_time', ''), reverse=True))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/transactions/csv', methods=['GET'])
def transactions_csv():
    try:
        data = load_data()
        txs = data['transactions']
        lines = ["TX ID,Slot,Plate,Owner,Entry,Exit,Duration (min),Amount"]
        for t in sorted(txs, key=lambda x: x.get('exit_time', ''), reverse=True):
            lines.append(f"{t['id']},{t['slot_id']},{t['plate']},{t['owner']},{t['entry_time']},{t['exit_time']},{t['duration_minutes']},{t['amount']}")
        csv_data = "\n".join(lines)
        return Response(
            csv_data,
            mimetype="text/csv",
            headers={"Content-disposition": "attachment; filename=transactions.csv"}
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/dashboard', methods=['GET'])
def dashboard():
    try:
        data = load_data()
        slots = data['slots']
        total = len(slots)
        avail = sum(1 for s in slots if s['status'] == 'available')
        occ = sum(1 for s in slots if s['status'] == 'occupied')
        res = sum(1 for s in slots if s['status'] == 'reserved')
        maint = sum(1 for s in slots if s['status'] == 'maintenance')
        
        zone_stats = {
            "A": {"total": 0, "occupied": 0},
            "B": {"total": 0, "occupied": 0},
            "C": {"total": 0, "occupied": 0},
            "D": {"total": 0, "occupied": 0}
        }
        for s in slots:
            z = s['zone']
            if z in zone_stats:
                zone_stats[z]['total'] += 1
                if s['status'] == 'occupied':
                    zone_stats[z]['occupied'] += 1
                    
        txs = data['transactions']
        
        now = datetime.utcnow()
        rev_map = {}
        for i in range(7):
            d = (now - timedelta(days=6-i)).strftime("%Y-%m-%d")
            rev_map[d] = 0.0
            
        total_rev = 0.0
        for t in txs:
            total_rev += t['amount']
            d = t['date']
            if d in rev_map:
                rev_map[d] += t['amount']
                
        rev_list = [{"date": k, "revenue": v} for k, v in rev_map.items()]
        rev_list.sort(key=lambda x: x['date'])
        
        hours = {}
        slot_usage = {}
        for t in txs:
            if 'entry_time' in t:
                try:
                    h = datetime.fromisoformat(t['entry_time'].replace('Z', '')).hour
                    hours[h] = hours.get(h, 0) + 1
                except: pass
            sid = t['slot_id']
            slot_usage[sid] = slot_usage.get(sid, 0) + 1
            
        peak = "N/A"
        if hours:
            best_h = max(hours, key=hours.get)
            ampm = "AM" if best_h < 12 else "PM"
            display_h = best_h if best_h <= 12 else best_h - 12
            if display_h == 0: display_h = 12
            peak = f"{display_h} {ampm}"
            
        top_slot = "None"
        if slot_usage:
            top_slot = max(slot_usage, key=slot_usage.get)
            
        return jsonify({
            "counts": {"total": total, "available": avail, "occupied": occ, "reserved": res, "maintenance": maint},
            "occupancy_pct": round((occ / total * 100) if total else 0, 1),
            "zone_stats": zone_stats,
            "revenue_7days": rev_list,
            "total_revenue": total_rev,
            "peak_hour": peak,
            "top_slot": top_slot,
            "recent_activity": data['activity_log'][:5]
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/alerts', methods=['GET'])
def get_alerts():
    try:
        data = load_data()
        active = [a for a in data['alerts'] if not a.get('dismissed', False)]
        return jsonify(sorted(active, key=lambda x: x.get('created_at', ''), reverse=True))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/alerts/<id>', methods=['DELETE'])
def dismiss_alert(id):
    try:
        data = load_data()
        for a in data['alerts']:
            if a['id'] == id:
                a['dismissed'] = True
                save_data(data)
                return jsonify({"success": True})
        return jsonify({"error": "Not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/alerts/check', methods=['POST'])
def check_alerts():
    try:
        data = load_data()
        now = datetime.utcnow()
        created = 0
        active_alerts = {(a['type'], a['slot_id']) for a in data['alerts'] if not a.get('dismissed', False)}
        
        for s in data['slots']:
            if s['status'] == 'occupied' and s['entry_time']:
                entry = datetime.fromisoformat(s['entry_time'].replace('Z', ''))
                if (now - entry).total_seconds() > 4 * 3600:
                    if ('overstay', s['id']) not in active_alerts:
                        data['alerts'].append({
                            "id": str(uuid.uuid4()),
                            "type": "overstay",
                            "slot_id": s['id'],
                            "plate": s['plate'],
                            "message": f"Vehicle {s['plate']} overstayed (>4h)",
                            "created_at": now.isoformat() + "Z",
                            "dismissed": False
                        })
                        created += 1
            elif s['status'] == 'maintenance' and s['last_updated']:
                lu = datetime.fromisoformat(s['last_updated'].replace('Z', ''))
                if (now - lu).total_seconds() > 48 * 3600:
                    if ('maintenance', s['id']) not in active_alerts:
                        data['alerts'].append({
                            "id": str(uuid.uuid4()),
                            "type": "maintenance",
                            "slot_id": s['id'],
                            "plate": None,
                            "message": f"Slot {s['id']} in maintenance > 48h",
                            "created_at": now.isoformat() + "Z",
                            "dismissed": False
                        })
                        created += 1
        if created > 0:
            save_data(data)
        return jsonify({"created": created})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/slots/realtime', methods=['GET'])
def slots_realtime():
    data = load_data()
    lightweight = []
    for s in data['slots']:
        lightweight.append({
            'id': s['id'],
            'zone': s['zone'],
            'floor': s['floor'],
            'status': s['status'],
            'type': s['type'],
            'plate': s.get('plate'),
            'owner': s.get('owner'),
            'vehicle_type': s.get('vehicle_type'),
            'entry_time': s.get('entry_time'),
            'reserved_by': s.get('reserved_by'),
            'reserved_until': s.get('reserved_until'),
            'maintenance_reason': s.get('maintenance_reason'),
            'sensor_status': s.get('sensor_status','online')
        })
    return jsonify(lightweight)

@app.route('/api/3d/activity-stream', methods=['GET'])
def activity_stream():
    data = load_data()
    log = data.get('activity_log', [])
    return jsonify(log[-20:])

@app.route('/api/settings', methods=['GET', 'PUT'])
def settings():
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

@app.route('/api/reset', methods=['POST'])
def reset_system():
    try:
        init_data()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/memberships', methods=['GET', 'POST'])
def memberships():
    try:
        data = load_data()
        if 'memberships' not in data:
            data['memberships'] = []
            
        if request.method == 'GET':
            return jsonify(data['memberships'])
            
        body = request.json
        member = {
            "id": str(uuid.uuid4()),
            "name": body.get("name"),
            "plate": body.get("plate", "").upper(),
            "phone": body.get("phone"),
            "expiry": body.get("expiry"),
            "created_at": datetime.utcnow().isoformat() + "Z"
        }
        data['memberships'].append(member)
        save_data(data)
        return jsonify(member)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/memberships/<id>', methods=['DELETE'])
def remove_membership(id):
    try:
        data = load_data()
        data['memberships'] = [m for m in data.get('memberships', []) if m['id'] != id]
        save_data(data)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/blacklist', methods=['GET', 'POST'])
def blacklist():
    try:
        data = load_data()
        if 'blacklist' not in data:
            data['blacklist'] = []
            
        if request.method == 'GET':
            return jsonify(data['blacklist'])
            
        body = request.json
        banned = {
            "id": str(uuid.uuid4()),
            "plate": body.get("plate", "").upper(),
            "reason": body.get("reason", "No reason provided"),
            "added_by": "SysAdmin",
            "created_at": datetime.utcnow().isoformat() + "Z"
        }
        data['blacklist'].append(banned)
        save_data(data)
        return jsonify(banned)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/blacklist/<id>', methods=['DELETE'])
def remove_blacklist(id):
    try:
        data = load_data()
        data['blacklist'] = [b for b in data.get('blacklist', []) if b['id'] != id]
        save_data(data)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/shift/open', methods=['POST'])
def open_shift():
    try:
        data = load_data()
        if 'shifts' not in data: data['shifts'] = []
        
        # Check if already open
        if data['shifts'] and data['shifts'][-1].get('status') == 'open':
            return jsonify(data['shifts'][-1])
            
        shift = {
            "id": f"SHF-{str(uuid.uuid4())[:8]}",
            "start_time": datetime.utcnow().isoformat() + "Z",
            "status": "open",
            "expected_cash": 0.0
        }
        data['shifts'].append(shift)
        save_data(data)
        return jsonify(shift)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/shift/close', methods=['POST'])
def close_shift():
    try:
        data = load_data()
        if 'shifts' not in data or not data['shifts'] or data['shifts'][-1].get('status') != 'open':
            return jsonify({"error": "No open shift found"}), 400
            
        shift = data['shifts'][-1]
        start_time = shift['start_time']
        end_time = datetime.utcnow().isoformat() + "Z"
        
        # Calculate cash collected since start_time
        cash_collected = sum(t['amount'] for t in data.get('transactions', []) if t.get('payment_method') == 'cash' and t.get('exit_time', '') >= start_time)
        
        shift['status'] = 'closed'
        shift['end_time'] = end_time
        shift['expected_cash'] = round(cash_collected, 2)
        save_data(data)
        
        return jsonify(shift)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
        
@app.route('/api/shift/status', methods=['GET'])
def get_shift_status():
    try:
        data = load_data()
        if 'shifts' not in data or not data['shifts'] or data['shifts'][-1].get('status') != 'open':
            return jsonify({"isOpen": False})
            
        shift = data['shifts'][-1]
        start_time = shift['start_time']
        
        # Calculate cash collected since start_time
        cash_collected = sum(t['amount'] for t in data.get('transactions', []) if t.get('payment_method') == 'cash' and t.get('exit_time', '') >= start_time)
        
        return jsonify({"isOpen": True, "start_time": start_time, "expected_cash": round(cash_collected, 2)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/parking/qr/<slot_id>', methods=['GET'])
def generate_qr(slot_id):
    qr_url = f"https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://yourapp.domain/mobile/checkin?slot={slot_id}"
    return jsonify({"qr_url": qr_url})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
