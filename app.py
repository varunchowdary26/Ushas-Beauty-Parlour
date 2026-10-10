import csv
import io
import json
import os
import random
from datetime import datetime
import bcrypt
from flask import Flask, Response, jsonify, send_from_directory, request
import psycopg2
from psycopg2.extras import RealDictCursor

# Configured to read HTML/JS directly from root directory instead of templates/
app = Flask(__name__, template_folder='.', static_folder='.')

OWNER_AUTH_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "owner_auth.json")

# --- POSTGRESQL CONFIGURATION ---
DB_CONFIG = {
    "host": "localhost",
    "database": "ushas_beauty_db",
    "user": "postgres",
    "password": "your_password",  # Update with your PostgreSQL password
    "port": 5432,
}


def get_db_connection():
    return psycopg2.connect(**DB_CONFIG)


def init_db():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS bookings (
                id VARCHAR(20) PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                phone VARCHAR(15) NOT NULL,
                email VARCHAR(100),
                service VARCHAR(100) NOT NULL,
                price NUMERIC(10, 2) DEFAULT 0,
                date DATE NOT NULL,
                time TIME NOT NULL,
                notes TEXT,
                status VARCHAR(20) DEFAULT 'Confirmed',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS owner_auth (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """
        )
        conn.commit()
        cursor.close()
        conn.close()
        print("PostgreSQL Database initialized successfully.")
    except Exception as e:
        print("Warning: Database initialization failed:", e)


def get_stored_owner_hash():
    if os.path.exists(OWNER_AUTH_FILE):
        try:
            with open(OWNER_AUTH_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if data.get("password_hash"):
                    return data["password_hash"]
        except Exception:
            pass

    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT password_hash FROM owner_auth WHERE id = 1")
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        if row and row[0]:
            return row[0]
    except Exception:
        pass

    return None


def save_owner_hash_once(password_hash):
    if get_stored_owner_hash() is not None:
        return False

    payload = {
        "password_hash": password_hash,
        "locked": True,
        "created_at": datetime.now().isoformat(),
    }
    with open(OWNER_AUTH_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO owner_auth (id, password_hash)
            VALUES (1, %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (password_hash,),
        )
        conn.commit()
        cursor.close()
        conn.close()
    except Exception:
        pass

    return True


# --- ROUTING FOR ROOT-LEVEL HTML FILES ---


@app.route("/")
def home():
    return send_from_directory('.', 'index.html')


@app.route("/my-bookings")
def my_bookings():
    return send_from_directory('.', 'my-bookings.html')


@app.route("/admin")
def admin_dashboard():
    return send_from_directory('.', 'admin.html')


@app.route("/admin-login")
@app.route("/login")
def admin_login():
    return send_from_directory('.', 'admin-login.html')


@app.route("/feedbackindex")
def feedback_index():
    return send_from_directory('.', 'feedbackindex.html')


@app.route("/feedbackdash")
def feedback_dash():
    return send_from_directory('.', 'feedbackdash.html')


@app.route("/privacy-policy")
def privacy_policy():
    return send_from_directory('.', 'privacy-policy.html')


@app.route("/terms")
def terms_and_conditions():
    return send_from_directory('.', 'terms.html')


# --- OWNER SINGLE-TIME BCRYPT AUTH API ---


@app.route("/api/owner/status", methods=["GET"])
def owner_auth_status():
    stored_hash = get_stored_owner_hash()
    return jsonify({"configured": bool(stored_hash)})


@app.route("/api/owner/setup", methods=["POST"])
def owner_auth_setup():
    if get_stored_owner_hash() is not None:
        return (
            jsonify(
                {
                    "error": "Master password has already been created once. Second-time password creation is permanently disabled."
                }
            ),
            403,
        )

    data = request.json or {}
    password = data.get("password", "")
    if len(password) < 4:
        return jsonify({"error": "Password must be at least 4 characters long."}), 400

    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

    if not save_owner_hash_once(hashed):
        return (
            jsonify(
                {
                    "error": "Master password has already been created once. Second-time password creation is permanently disabled."
                }
            ),
            403,
        )

    return jsonify({"success": True, "bcrypt_hash": hashed}), 201


@app.route("/api/owner/login", methods=["POST"])
def owner_auth_login():
    stored_hash = get_stored_owner_hash()
    if not stored_hash:
        return jsonify({"error": "Master password has not been created yet."}), 400

    data = request.json or {}
    password = data.get("password", "")
    if not password:
        return jsonify({"error": "Password is required."}), 400

    try:
        is_valid = bcrypt.checkpw(
            password.encode("utf-8"), stored_hash.encode("utf-8")
        )
    except Exception:
        is_valid = False

    if is_valid:
        return jsonify({"success": True}), 200
    return jsonify({"error": "Incorrect master password. Please verify and try again."}), 401


# Catch-all to serve static assets like script.js directly from root
@app.route('/<path:filename>')
def serve_static(filename):
    if filename in ("owner_auth.json", "app.py"):
        return jsonify({"error": "Forbidden"}), 403
    return send_from_directory('.', filename)


# --- API ENDPOINTS ---


@app.route("/api/bookings", methods=["POST"])
def create_booking():
    data = request.json or {}
    name = data.get("name", "").strip()
    phone = data.get("phone", "").strip()
    email = data.get("email", "").strip()
    service = data.get("service", "")
    price = float(data.get("price", 0))
    date = data.get("date", "")
    time = data.get("time", "")
    notes = data.get("notes", "").strip()

    if not all([name, phone, service, date, time]):
        return jsonify({"error": "Missing required fields"}), 400

    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Check for duplicate time slot
        cursor.execute(
            "SELECT id FROM bookings WHERE date = %s AND time = %s",
            (date, time),
        )
        if cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({"error": "This time slot is already booked."}), 409

        booking_id = f"USH-{random.randint(100000, 999999)}"

        cursor.execute(
            """
            INSERT INTO bookings (id, name, phone, email, service, price, date, time, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
            (
                booking_id,
                name,
                phone,
                email,
                service,
                price,
                date,
                time,
                notes,
            ),
        )

        conn.commit()
        cursor.close()
        conn.close()

        return (
            jsonify(
                {
                    "success": True,
                    "booking": {
                        "id": booking_id,
                        "name": name,
                        "phone": phone,
                        "email": email,
                        "service": service,
                        "price": price,
                        "date": str(date),
                        "time": str(time),
                        "notes": notes,
                    },
                }
            ),
            201,
        )

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/bookings/search", methods=["GET"])
def search_bookings():
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify([])

    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute(
            """
            SELECT id, name, phone, email, service, price, 
                   to_char(date, 'YYYY-MM-DD') as date, 
                   to_char(time, 'HH24:MI') as time, 
                   notes, status 
            FROM bookings 
            WHERE phone LIKE %s OR id ILIKE %s
            ORDER BY date DESC, time DESC
        """,
            (f"%{query}%", f"%{query}%"),
        )

        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        return jsonify([dict(row) for row in rows])

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/bookings", methods=["GET"])
def get_all_bookings():
    month = request.args.get("month", "")
    search = request.args.get("search", "").lower().strip()

    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT id, name, phone, email, service, price, 
                   to_char(date, 'YYYY-MM-DD') as date, 
                   to_char(time, 'HH24:MI') as time, 
                   notes, status 
            FROM bookings 
            ORDER BY date DESC, time DESC
        """)
        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        result = []
        for row in rows:
            b = dict(row)
            b["price"] = float(b["price"]) if b["price"] is not None else 0
            matches_month = not month or b["date"].startswith(month)
            matches_search = not search or (
                search in b["name"].lower()
                or search in b["phone"]
                or search in b["service"].lower()
                or search in b["id"].lower()
            )
            if matches_month and matches_search:
                result.append(b)

        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/export/csv", methods=["GET"])
def export_csv():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, phone, email, service, price, 
                   to_char(date, 'YYYY-MM-DD'), to_char(time, 'HH24:MI'), notes 
            FROM bookings 
            ORDER BY date DESC, time DESC
        """)
        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "Booking ID",
                "Customer",
                "Phone",
                "Email",
                "Service",
                "Price",
                "Date",
                "Time",
                "Notes",
            ]
        )
        writer.writerows(rows)

        return Response(
            output.getvalue(),
            mimetype="text/csv",
            headers={
                "Content-disposition": f"attachment; filename=bookings-{datetime.now().strftime('%Y-%m-%d')}.csv"
            },
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    init_db()
    app.run(debug=True, host="127.0.0.1", port=5000)