"""
RouteIQ — University Transit System API
Flask backend for Acropolis College bus tracking.
"""

import os
import datetime
import contextlib
import logging
import re
import math
import uuid
import csv
import io
from decimal import Decimal
from functools import wraps

from flask import Flask, request, jsonify, session, render_template, send_file, cli as flask_cli
from flask_cors import CORS
import mysql.connector
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

# ------------------------------------
# Load environment
# ------------------------------------
load_dotenv()

app = Flask(__name__, template_folder='templates', static_folder='static')
app.secret_key = os.environ.get('SECRET_KEY', 'routeiq-dev-fallback-key')

# Upload & retention configuration
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_CONTENT_LENGTH', 16 * 1024 * 1024))
UPLOAD_DIR = os.environ.get('UPLOAD_DIR', 'uploads')
UPLOAD_PATH = os.path.join(app.root_path, UPLOAD_DIR)
os.makedirs(UPLOAD_PATH, exist_ok=True)
TRIP_RETENTION_DAYS = int(os.environ.get('TRIP_RETENTION_DAYS', '90'))

# Session cookie security
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

# CORS configuration — restrict to same-origin unless overridden
cors_origins = os.environ.get('CORS_ORIGINS', '').strip()
if cors_origins:
    CORS(app, origins=cors_origins.split(','), supports_credentials=True)

# Logging
logging.basicConfig(level=logging.INFO)

# ------------------------------------
# DB Configuration from env
# ------------------------------------
DB_CONFIG = {
    'host': os.environ.get('DB_HOST', 'localhost'),
    'user': os.environ.get('DB_USER', 'root'),
    'password': os.environ.get('DB_PASSWORD', 'root'),
    'database': os.environ.get('DB_NAME', 'busmg'),
}

# ------------------------------------
# JSON Serialization Helper
# ------------------------------------
def make_json_serializable(data):
    if isinstance(data, list):
        return [make_json_serializable(x) for x in data]
    elif isinstance(data, dict):
        return {k: make_json_serializable(v) for k, v in data.items()}
    elif isinstance(data, Decimal):
        return float(data)
    elif isinstance(data, datetime.timedelta):
        total_seconds = int(data.total_seconds())
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        return f"{hours:02d}:{minutes:02d}"
    elif isinstance(data, datetime.time):
        return data.strftime("%H:%M")
    elif isinstance(data, datetime.date):
        return data.isoformat()
    elif isinstance(data, datetime.datetime):
        return data.isoformat()
    return data


# ------------------------------------
# Database Connection Helper
# ------------------------------------
@contextlib.contextmanager
def db_cursor():
    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor(dictionary=True)
    try:
        yield cursor
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def _is_hashed(pw):
    """Check if a password string looks like a werkzeug hash."""
    if not pw:
        return False
    return pw.startswith(('pbkdf2:', 'scrypt:'))


# ------------------------------------
# Database Setup & Migrations
# ------------------------------------
def init_db():
    try:
        conn = mysql.connector.connect(
            host=DB_CONFIG['host'],
            user=DB_CONFIG['user'],
            password=DB_CONFIG['password']
        )
        cursor = conn.cursor()

        cursor.execute("CREATE DATABASE IF NOT EXISTS " + DB_CONFIG['database'])
        cursor.execute("USE " + DB_CONFIG['database'])

        # --- Create tables ---
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS admins (
            admin_id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(100) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL
        ) ENGINE=InnoDB
        ''')

        cursor.execute('''
        CREATE TABLE IF NOT EXISTS login_logs (
            log_id INT AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(100) NOT NULL,
            role VARCHAR(50) NOT NULL,
            login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status VARCHAR(100) DEFAULT 'Success',
            ip_address VARCHAR(45)
        ) ENGINE=InnoDB
        ''')

        # Check tables exist before creating schedules (depends on buses/routes)
        cursor.execute("SHOW TABLES LIKE 'routes'")
        has_routes = cursor.fetchone()
        cursor.execute("SHOW TABLES LIKE 'buses'")
        has_buses = cursor.fetchone()

        if has_routes and has_buses:
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS schedules (
                schedule_id INT AUTO_INCREMENT PRIMARY KEY,
                bus_id INT,
                route_id INT,
                arrival_time_1st_shift TIME,
                arrival_time_2nd_shift TIME,
                FOREIGN KEY (bus_id) REFERENCES buses(bus_id) ON DELETE CASCADE,
                FOREIGN KEY (route_id) REFERENCES routes(route_id) ON DELETE CASCADE
            ) ENGINE=InnoDB
            ''')

        # bus_locations history table
        if has_buses:
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS bus_locations (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                bus_id INT NOT NULL,
                latitude DECIMAL(10,8) NOT NULL,
                longitude DECIMAL(11,8) NOT NULL,
                speed DECIMAL(6,2) DEFAULT NULL,
                heading DECIMAL(6,2) DEFAULT NULL,
                trip_id INT DEFAULT NULL,
                recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (bus_id) REFERENCES buses(bus_id) ON DELETE CASCADE
            ) ENGINE=InnoDB
            ''')

        # user_preferences table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_preferences (
            user_role VARCHAR(20) NOT NULL,
            user_id INT NOT NULL,
            theme VARCHAR(10) NOT NULL DEFAULT 'dark',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (user_role, user_id)
        ) ENGINE=InnoDB
        ''')

        # trips table
        if has_routes and has_buses:
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS trips (
                trip_id INT AUTO_INCREMENT PRIMARY KEY,
                bus_id INT NOT NULL,
                driver_id INT NOT NULL,
                route_id INT NOT NULL,
                shift ENUM('1st','2nd') NOT NULL,
                status ENUM('scheduled','in_progress','completed','cancelled') NOT NULL DEFAULT 'scheduled',
                started_at TIMESTAMP NULL DEFAULT NULL,
                ended_at TIMESTAMP NULL DEFAULT NULL,
                start_lat DECIMAL(10,8) NULL,
                start_lng DECIMAL(11,8) NULL,
                end_lat DECIMAL(10,8) NULL,
                end_lng DECIMAL(11,8) NULL,
                distance_km DECIMAL(8,2) DEFAULT 0.00,
                max_speed DECIMAL(6,2) DEFAULT 0.00,
                notes TEXT NULL,
                FOREIGN KEY (bus_id) REFERENCES buses(bus_id) ON DELETE CASCADE,
                FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE,
                FOREIGN KEY (route_id) REFERENCES routes(route_id) ON DELETE CASCADE
            ) ENGINE=InnoDB
            ''')

        # feedback table
        if has_buses:
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS feedback (
                feedback_id INT AUTO_INCREMENT PRIMARY KEY,
                student_id INT NOT NULL,
                bus_id INT NOT NULL,
                driver_id INT NOT NULL,
                route_id INT NOT NULL,
                trip_id INT NULL,
                rating_overall TINYINT NOT NULL,
                rating_punctuality TINYINT NULL,
                rating_cleanliness TINYINT NULL,
                rating_driver_behavior TINYINT NULL,
                rating_safety TINYINT NULL,
                comment TEXT,
                is_anonymous TINYINT(1) DEFAULT 0,
                feedback_date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                admin_response TEXT NULL,
                responded_at TIMESTAMP NULL DEFAULT NULL,
                FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
                FOREIGN KEY (bus_id) REFERENCES buses(bus_id) ON DELETE CASCADE,
                FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE,
                FOREIGN KEY (route_id) REFERENCES routes(route_id) ON DELETE CASCADE,
                UNIQUE KEY uk_feedback_student_bus_date (student_id, bus_id, feedback_date)
            ) ENGINE=InnoDB
            ''')

        # issues, comments, attachments, notifications
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS issues (
            issue_id INT AUTO_INCREMENT PRIMARY KEY,
            reporter_role VARCHAR(20) NOT NULL,
            reporter_id INT NOT NULL,
            bus_id INT NULL,
            route_id INT NULL,
            trip_id INT NULL,
            category ENUM('late_bus','breakdown','unsafe_driving','cleanliness','overcrowding','wrong_route','lost_item','harassment','other') NOT NULL,
            severity ENUM('low','medium','high','critical') NOT NULL,
            title VARCHAR(200) NOT NULL,
            description TEXT NOT NULL,
            latitude DECIMAL(10,8) NULL,
            longitude DECIMAL(11,8) NULL,
            status ENUM('open','acknowledged','in_progress','resolved','rejected') DEFAULT 'open',
            assigned_to_admin_id INT NULL,
            is_anonymous TINYINT(1) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            resolved_at TIMESTAMP NULL DEFAULT NULL,
            FOREIGN KEY (bus_id) REFERENCES buses(bus_id) ON DELETE SET NULL,
            FOREIGN KEY (route_id) REFERENCES routes(route_id) ON DELETE SET NULL,
            FOREIGN KEY (assigned_to_admin_id) REFERENCES admins(admin_id) ON DELETE SET NULL
        ) ENGINE=InnoDB
        ''')

        cursor.execute('''
        CREATE TABLE IF NOT EXISTS issue_comments (
            comment_id INT AUTO_INCREMENT PRIMARY KEY,
            issue_id INT NOT NULL,
            author_role VARCHAR(20) NOT NULL,
            author_id INT NOT NULL,
            author_name VARCHAR(100) NULL,
            is_internal TINYINT(1) DEFAULT 0,
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (issue_id) REFERENCES issues(issue_id) ON DELETE CASCADE
        ) ENGINE=InnoDB
        ''')

        cursor.execute('''
        CREATE TABLE IF NOT EXISTS issue_attachments (
            attachment_id INT AUTO_INCREMENT PRIMARY KEY,
            issue_id INT NOT NULL,
            file_path VARCHAR(255) NOT NULL,
            original_filename VARCHAR(255) NOT NULL,
            mime_type VARCHAR(100) NOT NULL,
            size INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (issue_id) REFERENCES issues(issue_id) ON DELETE CASCADE
        ) ENGINE=InnoDB
        ''')

        cursor.execute('''
        CREATE TABLE IF NOT EXISTS notifications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_role VARCHAR(20) NOT NULL,
            user_id INT NOT NULL,
            type VARCHAR(50) NOT NULL,
            title VARCHAR(200) NOT NULL,
            body TEXT NOT NULL,
            link VARCHAR(255) NULL,
            is_read TINYINT(1) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
        ''')

        # --- Column migrations ---
        def _has_column(table, col):
            cursor.execute(f"SHOW COLUMNS FROM `{table}` LIKE '{col}'")
            rows = cursor.fetchall()
            return len(rows) > 0

        def _has_index(table, idx):
            cursor.execute(f"SHOW INDEX FROM `{table}` WHERE Key_name = %s", (idx,))
            rows = cursor.fetchall()
            return len(rows) > 0

        def _add_index_if_missing(table, idx_name, cols_sql):
            cursor.execute(f"SHOW TABLES LIKE '{table}'")
            tables = cursor.fetchall()
            if tables and not _has_index(table, idx_name):
                try:
                    cursor.execute(f"ALTER TABLE `{table}` ADD INDEX `{idx_name}` ({cols_sql})")
                except Exception as ex:
                    app.logger.warning(f"Index {idx_name} error: {ex}")

        # Students: password column
        cursor.execute("SHOW TABLES LIKE 'students'")
        if cursor.fetchone():
            if not _has_column('students', 'password'):
                cursor.execute("ALTER TABLE students ADD COLUMN password VARCHAR(255) DEFAULT 'password'")

        # Drivers: email & password
        cursor.execute("SHOW TABLES LIKE 'drivers'")
        if cursor.fetchone():
            if not _has_column('drivers', 'email'):
                cursor.execute("ALTER TABLE drivers ADD COLUMN email VARCHAR(100) UNIQUE DEFAULT NULL")
            if not _has_column('drivers', 'password'):
                cursor.execute("ALTER TABLE drivers ADD COLUMN password VARCHAR(255) DEFAULT NULL")

        # Buses: latitude, longitude, last_updated, speed, heading
        if has_buses:
            if not _has_column('buses', 'latitude'):
                cursor.execute("ALTER TABLE buses ADD COLUMN latitude DECIMAL(10,8) DEFAULT 22.71960000")
            if not _has_column('buses', 'longitude'):
                cursor.execute("ALTER TABLE buses ADD COLUMN longitude DECIMAL(11,8) DEFAULT 75.85770000")
            if not _has_column('buses', 'speed'):
                cursor.execute("ALTER TABLE buses ADD COLUMN speed DECIMAL(6,2) DEFAULT NULL")
            if not _has_column('buses', 'heading'):
                cursor.execute("ALTER TABLE buses ADD COLUMN heading DECIMAL(6,2) DEFAULT NULL")
            if not _has_column('buses', 'last_updated'):
                cursor.execute("ALTER TABLE buses ADD COLUMN last_updated TIMESTAMP NULL DEFAULT NULL")

        # bus_locations: speed, heading, trip_id
        cursor.execute("SHOW TABLES LIKE 'bus_locations'")
        if cursor.fetchone():
            if not _has_column('bus_locations', 'speed'):
                cursor.execute("ALTER TABLE bus_locations ADD COLUMN speed DECIMAL(6,2) DEFAULT NULL")
            if not _has_column('bus_locations', 'heading'):
                cursor.execute("ALTER TABLE bus_locations ADD COLUMN heading DECIMAL(6,2) DEFAULT NULL")
            if not _has_column('bus_locations', 'trip_id'):
                cursor.execute("ALTER TABLE bus_locations ADD COLUMN trip_id INT DEFAULT NULL")

        # Foreign keys & indexes for trips on bus_locations
        _add_index_if_missing('bus_locations', 'idx_bus_locations_bus_rec', 'bus_id, recorded_at')
        _add_index_if_missing('bus_locations', 'idx_bus_locations_trip', 'trip_id')
        _add_index_if_missing('trips', 'idx_trips_status_started', 'status, started_at')
        _add_index_if_missing('trips', 'idx_trips_bus_status', 'bus_id, status')
        _add_index_if_missing('trips', 'idx_trips_driver_status', 'driver_id, status')
        _add_index_if_missing('feedback', 'idx_feedback_bus_created', 'bus_id, created_at')
        _add_index_if_missing('feedback', 'idx_feedback_driver', 'driver_id')
        _add_index_if_missing('issues', 'idx_issues_status_created', 'status, created_at')
        _add_index_if_missing('issues', 'idx_issues_bus_created', 'bus_id, created_at')
        _add_index_if_missing('notifications', 'idx_notif_user_read', 'user_role, user_id, is_read, created_at')

        # Stops: latitude, longitude
        cursor.execute("SHOW TABLES LIKE 'stops'")
        if cursor.fetchone():
            if not _has_column('stops', 'latitude'):
                cursor.execute("ALTER TABLE stops ADD COLUMN latitude DECIMAL(10,8) DEFAULT NULL")
            if not _has_column('stops', 'longitude'):
                cursor.execute("ALTER TABLE stops ADD COLUMN longitude DECIMAL(11,8) DEFAULT NULL")

        # Route_stops: arrival times
        cursor.execute("SHOW TABLES LIKE 'route_stops'")
        if cursor.fetchone():
            if not _has_column('route_stops', 'arrival_time_1st_shift'):
                cursor.execute("ALTER TABLE route_stops ADD COLUMN arrival_time_1st_shift TIME DEFAULT NULL")
            if not _has_column('route_stops', 'arrival_time_2nd_shift'):
                cursor.execute("ALTER TABLE route_stops ADD COLUMN arrival_time_2nd_shift TIME DEFAULT NULL")

        # --- Seed accounts (migrate old emails, use hashed passwords) ---
        hashed_admin = generate_password_hash('admin123')
        hashed_pass = generate_password_hash('password')

        # Migrate old CampusRide emails to RouteIQ
        cursor.execute("UPDATE admins SET username='admin@routeiq.edu' WHERE username='admin@campusride.edu'")
        cursor.execute("UPDATE students SET email='student@routeiq.edu' WHERE email='student@campusride.edu'")
        cursor.execute("UPDATE drivers SET email='driver@routeiq.edu' WHERE email='driver@campusride.edu'")

        # Seed admin
        cursor.execute("SELECT admin_id FROM admins WHERE username=%s", ('admin@routeiq.edu',))
        if not cursor.fetchone():
            cursor.execute("INSERT INTO admins (username, password) VALUES (%s, %s)",
                           ('admin@routeiq.edu', hashed_admin))

        # Seed student
        cursor.execute("SHOW TABLES LIKE 'students'")
        if cursor.fetchone():
            cursor.execute("SELECT student_id FROM students WHERE email=%s", ('student@routeiq.edu',))
            student = cursor.fetchone()
            if not student:
                cursor.execute("INSERT INTO students (name, email, password) VALUES (%s, %s, %s)",
                               ('Krishna Patel', 'student@routeiq.edu', hashed_pass))
                student_id = cursor.lastrowid
            else:
                student_id = student[0]

            # Seed student route mapping
            cursor.execute("SHOW TABLES LIKE 'student_routes'")
            if cursor.fetchone():
                cursor.execute("SELECT * FROM student_routes WHERE student_id=%s", (student_id,))
                if not cursor.fetchone():
                    cursor.execute("INSERT INTO student_routes (student_id, route_id) VALUES (%s, 1)",
                                   (student_id,))

        # Seed driver credentials
        cursor.execute("SHOW TABLES LIKE 'drivers'")
        if cursor.fetchone():
            cursor.execute("SELECT driver_id FROM drivers WHERE driver_id=1")
            if cursor.fetchone():
                cursor.execute("UPDATE drivers SET email=%s, password=%s WHERE driver_id=1 AND (email IS NULL OR email='' OR email='driver@routeiq.edu')",
                               ('driver@routeiq.edu', hashed_pass))

        # Seed default schedule
        if has_routes and has_buses:
            cursor.execute("SELECT * FROM schedules LIMIT 1")
            if not cursor.fetchone():
                cursor.execute("INSERT INTO schedules (bus_id, route_id, arrival_time_1st_shift, arrival_time_2nd_shift) VALUES (1, 1, '08:10:00', '10:15:00')")

        # --- Hash existing plaintext passwords ---
        for table, pw_col, id_col in [
            ('admins', 'password', 'admin_id'),
            ('students', 'password', 'student_id'),
            ('drivers', 'password', 'driver_id'),
        ]:
            cursor.execute(f"SHOW TABLES LIKE '{table}'")
            if not cursor.fetchone():
                continue
            cursor.execute(f"SELECT {id_col}, {pw_col} FROM {table} WHERE {pw_col} IS NOT NULL")
            rows = cursor.fetchall()
            for row in rows:
                rid, pw = row
                if pw and not _is_hashed(pw):
                    hashed = generate_password_hash(pw)
                    cursor.execute(f"UPDATE {table} SET {pw_col}=%s WHERE {id_col}=%s", (hashed, rid))

        conn.commit()
        cursor.close()
        conn.close()
        app.logger.info("RouteIQ database initialized and migrated successfully.")
    except Exception as e:
        app.logger.error("Database migration failed on startup: %s", e)

# Run migrations at import time
init_db()


# ------------------------------------
# Rate Limiting Helper (login)
# ------------------------------------
def _is_rate_limited(email, ip_addr):
    """Check if login is rate-limited: max 5 failed attempts per email+IP in 10 min."""
    try:
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT COUNT(*) AS cnt FROM login_logs
                WHERE email=%s AND ip_address=%s
                  AND status LIKE 'Failed%%'
                  AND login_time > NOW() - INTERVAL 10 MINUTE
            """, (email, ip_addr))
            row = cursor.fetchone()
            return row and row['cnt'] >= 5
    except Exception:
        return False


# ------------------------------------
# Auth Decorator
# ------------------------------------
def login_required(role=None):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'user' not in session:
                return jsonify({"error": "Unauthorized. Please log in."}), 401
            if role and session['user']['role'] != role:
                return jsonify({"error": "Forbidden. Insufficient permissions."}), 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator


# ------------------------------------
# Validation Helpers
# ------------------------------------
def _validate_phone(phone):
    return bool(re.match(r'^\d{10}$', str(phone).strip()))

def _validate_email(email):
    return bool(re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email.strip()))

def _safe_error(msg="An error occurred"):
    """Return a generic error to the client."""
    return jsonify({"error": msg})


# ------------------------------------
# Frontend Routes
# ------------------------------------
@app.route('/')
def home():
    return render_template('index.html')


# ------------------------------------
# Authentication API
# ------------------------------------
@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({"error": "Missing email or password"}), 400

    email = data['email'].strip().lower()
    password = data['password']
    role = data.get('role')
    ip_addr = request.headers.get('X-Forwarded-For', request.remote_addr)

    # Rate limiting
    if _is_rate_limited(email, ip_addr):
        return jsonify({"error": "Too many failed attempts. Please wait 10 minutes."}), 429

    try:
        with db_cursor() as cursor:
            # Admin login
            if not role or role == 'admin':
                cursor.execute("SELECT * FROM admins WHERE username=%s", (email,))
                admin = cursor.fetchone()
                if admin and check_password_hash(admin['password'], password):
                    session['user'] = {
                        'id': admin['admin_id'],
                        'email': admin['username'],
                        'name': 'System Administrator',
                        'role': 'admin'
                    }
                    cursor.execute("INSERT INTO login_logs (email, role, status, ip_address) VALUES (%s,%s,%s,%s)",
                                   (email, 'admin', 'Success', ip_addr))
                    return jsonify({"success": True, "message": "Admin login successful", "user": session['user']})

            # Student login
            if not role or role == 'student':
                cursor.execute("SELECT * FROM students WHERE email=%s", (email,))
                student = cursor.fetchone()
                if student and check_password_hash(student['password'], password):
                    session['user'] = {
                        'id': student['student_id'],
                        'email': student['email'],
                        'name': student['name'],
                        'role': 'student'
                    }
                    cursor.execute("INSERT INTO login_logs (email, role, status, ip_address) VALUES (%s,%s,%s,%s)",
                                   (email, 'student', 'Success', ip_addr))
                    return jsonify({"success": True, "message": "Student login successful", "user": session['user']})

            # Driver login
            if not role or role == 'driver':
                cursor.execute("SELECT * FROM drivers WHERE email=%s", (email,))
                driver = cursor.fetchone()
                if driver and driver.get('password') and check_password_hash(driver['password'], password):
                    session['user'] = {
                        'id': driver['driver_id'],
                        'email': driver['email'],
                        'name': driver['name'],
                        'role': 'driver'
                    }
                    cursor.execute("INSERT INTO login_logs (email, role, status, ip_address) VALUES (%s,%s,%s,%s)",
                                   (email, 'driver', 'Success', ip_addr))
                    return jsonify({"success": True, "message": "Driver login successful", "user": session['user']})

            # Log failure
            cursor.execute("INSERT INTO login_logs (email, role, status, ip_address) VALUES (%s,%s,%s,%s)",
                           (email, role or 'unknown', 'Failed - Invalid Credentials', ip_addr))

        return jsonify({"error": "Invalid credentials"}), 401
    except Exception as e:
        app.logger.error("Login error: %s", e)
        return _safe_error("Login failed. Please try again."), 500


# ------------------------------------
# Student Registration (students only — no admin registration)
# ------------------------------------
@app.route('/api/register', methods=['POST'])
def register_user():
    data = request.json
    if not data or 'name' not in data or 'email' not in data or 'password' not in data:
        return jsonify({"error": "Missing required fields"}), 400

    role = data.get('role', 'student')

    # SECURITY: Only student self-registration is allowed
    if role != 'student':
        return jsonify({"error": "Only student registration is supported."}), 403

    if 'route_id' not in data:
        return jsonify({"error": "Please select a route"}), 400

    name = data['name'].strip()
    email = data['email'].strip().lower()
    password = data['password']

    if not name or not email or not password:
        return jsonify({"error": "All fields are required"}), 400

    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400

    if not _validate_email(email):
        return jsonify({"error": "Invalid email address"}), 400

    if len(name) > 100:
        return jsonify({"error": "Name is too long (max 100 characters)"}), 400

    try:
        with db_cursor() as cursor:
            # Check for existing emails across all tables
            cursor.execute("SELECT email FROM students WHERE email=%s", (email,))
            if cursor.fetchone():
                return jsonify({"error": "Email already registered"}), 400
            cursor.execute("SELECT username FROM admins WHERE username=%s", (email,))
            if cursor.fetchone():
                return jsonify({"error": "Email is reserved"}), 400
            cursor.execute("SELECT email FROM drivers WHERE email=%s", (email,))
            if cursor.fetchone():
                return jsonify({"error": "Email is reserved"}), 400

            ip_addr = request.headers.get('X-Forwarded-For', request.remote_addr)
            hashed = generate_password_hash(password)

            route_id = data['route_id']
            cursor.execute("INSERT INTO students (name, email, password) VALUES (%s,%s,%s)",
                           (name, email, hashed))
            student_id = cursor.lastrowid
            cursor.execute("INSERT INTO student_routes (student_id, route_id) VALUES (%s,%s)",
                           (student_id, route_id))
            cursor.execute("INSERT INTO login_logs (email, role, status, ip_address) VALUES (%s,%s,%s,%s)",
                           (email, 'student', 'Registered New Account', ip_addr))

            session['user'] = {
                'id': student_id, 'email': email, 'name': name, 'role': 'student'
            }
            return jsonify({"success": True, "message": "Registration successful!", "user": session['user']})
    except Exception as e:
        app.logger.error("Registration error: %s", e)
        return _safe_error("Registration failed. Please try again."), 500


# ------------------------------------
# Admin-only: Create admin
# ------------------------------------
@app.route('/api/admins', methods=['POST'])
@login_required(role='admin')
def create_admin():
    data = request.json
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({"error": "Email and password required"}), 400

    email = data['email'].strip().lower()
    password = data['password']
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400

    try:
        with db_cursor() as cursor:
            cursor.execute("SELECT admin_id FROM admins WHERE username=%s", (email,))
            if cursor.fetchone():
                return jsonify({"error": "Admin already exists"}), 400
            hashed = generate_password_hash(password)
            cursor.execute("INSERT INTO admins (username, password) VALUES (%s,%s)", (email, hashed))
            return jsonify({"success": True, "message": "Admin created"})
    except Exception as e:
        app.logger.error("Create admin error: %s", e)
        return _safe_error("Failed to create admin"), 500


# ------------------------------------
# Session & Logout
# ------------------------------------
@app.route('/api/logout', methods=['POST'])
def logout():
    session.pop('user', None)
    return jsonify({"success": True, "message": "Logged out successfully"})

@app.route('/api/session', methods=['GET'])
def get_session():
    if 'user' in session:
        return jsonify({"logged_in": True, "user": session['user']})
    return jsonify({"logged_in": False})


# ------------------------------------
# Search API
# ------------------------------------
@app.route('/api/search', methods=['GET'])
@login_required()
def search_transit():
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify([])
    try:
        with db_cursor() as cursor:
            like_q = f"%{q}%"
            cursor.execute("""
                SELECT DISTINCT r.route_id, r.route_name, r.start_point, r.end_point
                FROM routes r
                LEFT JOIN route_stops rs ON r.route_id = rs.route_id
                LEFT JOIN stops s ON rs.stop_id = s.stop_id
                LEFT JOIN schedules sch ON r.route_id = sch.route_id
                LEFT JOIN buses b ON sch.bus_id = b.bus_id
                WHERE r.route_name LIKE %s OR r.start_point LIKE %s OR r.end_point LIKE %s
                   OR s.stop_name LIKE %s OR b.bus_number LIKE %s
            """, (like_q, like_q, like_q, like_q, like_q))
            routes = cursor.fetchall()

            results = []
            for r in routes:
                route_id = r['route_id']
                cursor.execute("""
                    SELECT b.bus_id, b.bus_number, b.capacity, b.latitude, b.longitude,
                           d.name AS driver, d.phone_number AS driver_phone,
                           s.arrival_time_1st_shift AS departure, s.arrival_time_2nd_shift AS arrival
                    FROM schedules s JOIN buses b ON s.bus_id = b.bus_id
                    LEFT JOIN drivers d ON b.driver_id = d.driver_id
                    WHERE s.route_id = %s
                """, (route_id,))
                buses = cursor.fetchall()
                cursor.execute("""
                    SELECT s.stop_id, s.stop_name
                    FROM route_stops rs JOIN stops s ON rs.stop_id = s.stop_id
                    WHERE rs.route_id = %s ORDER BY rs.stop_order ASC
                """, (route_id,))
                stops = cursor.fetchall()
                results.append({
                    "route": r,
                    "buses": buses,
                    "stops": [x['stop_name'] for x in stops]
                })
            return jsonify(make_json_serializable(results))
    except Exception as e:
        app.logger.error("Search error: %s", e)
        return _safe_error("Search failed"), 500


# ------------------------------------
# Admin Audit Logs
# ------------------------------------
@app.route('/api/admin/logs', methods=['GET'])
@login_required(role='admin')
def get_admin_logs():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 25, type=int)
    status_filter = request.args.get('status', '').strip()
    offset = (page - 1) * per_page
    try:
        with db_cursor() as cursor:
            where_clause = ""
            params = []
            if status_filter:
                where_clause = "WHERE status LIKE %s"
                params.append(f"%{status_filter}%")

            cursor.execute(f"SELECT COUNT(*) AS total FROM login_logs {where_clause}", params)
            total = cursor.fetchone()['total']

            cursor.execute(f"""
                SELECT * FROM login_logs {where_clause}
                ORDER BY login_time DESC LIMIT %s OFFSET %s
            """, params + [per_page, offset])
            logs = cursor.fetchall()
            return jsonify(make_json_serializable({
                "logs": logs,
                "total": total,
                "page": page,
                "per_page": per_page,
                "pages": (total + per_page - 1) // per_page
            }))
    except Exception as e:
        app.logger.error("Audit log error: %s", e)
        return _safe_error("Failed to fetch audit logs"), 500


# ------------------------------------
# Notices CRUD
# ------------------------------------
@app.route('/api/notices', methods=['GET'])
def get_notices():
    include_expired = request.args.get('include_expired', '0') == '1'
    try:
        with db_cursor() as cursor:
            if include_expired:
                cursor.execute("SELECT * FROM notices ORDER BY created_at DESC")
            else:
                cursor.execute("""
                    SELECT * FROM notices
                    WHERE expiry_date IS NULL OR expiry_date >= CURDATE()
                    ORDER BY created_at DESC
                """)
            return jsonify(make_json_serializable(cursor.fetchall()))
    except Exception as e:
        app.logger.error("Notices error: %s", e)
        return _safe_error("Failed to fetch notices"), 500

@app.route('/api/notices', methods=['POST'])
@login_required(role='admin')
def add_notice():
    data = request.json
    if not data or not data.get('message', '').strip():
        return jsonify({"error": "Message content is required"}), 400

    title = data.get('title', 'General Alert').strip()[:200]
    message = data['message'].strip()
    expiry_date = data.get('expiry_date') or None
    target_route_id = data.get('target_route_id') or None

    try:
        with db_cursor() as cursor:
            cursor.execute(
                "INSERT INTO notices (title, message, expiry_date, target_route_id) VALUES (%s,%s,%s,%s)",
                (title, message, expiry_date, target_route_id)
            )
            return jsonify({"success": True, "message": "Notice published successfully!"})
    except Exception as e:
        app.logger.error("Add notice error: %s", e)
        return _safe_error("Failed to publish notice"), 500

@app.route('/api/notices/<int:notice_id>', methods=['PUT'])
@login_required(role='admin')
def update_notice(notice_id):
    data = request.json
    if not data or not data.get('message', '').strip():
        return jsonify({"error": "Message content is required"}), 400
    title = data.get('title', 'General Alert').strip()[:200]
    message = data['message'].strip()
    expiry_date = data.get('expiry_date') or None
    target_route_id = data.get('target_route_id') or None
    try:
        with db_cursor() as cursor:
            cursor.execute(
                "UPDATE notices SET title=%s, message=%s, expiry_date=%s, target_route_id=%s WHERE notice_id=%s",
                (title, message, expiry_date, target_route_id, notice_id)
            )
            return jsonify({"success": True, "message": "Notice updated"})
    except Exception as e:
        app.logger.error("Update notice error: %s", e)
        return _safe_error("Failed to update notice"), 500

@app.route('/api/notices/<int:notice_id>', methods=['DELETE'])
@login_required(role='admin')
def delete_notice(notice_id):
    try:
        with db_cursor() as cursor:
            cursor.execute("DELETE FROM notices WHERE notice_id=%s", (notice_id,))
            return jsonify({"success": True, "message": "Notice deleted"})
    except Exception as e:
        app.logger.error("Delete notice error: %s", e)
        return _safe_error("Failed to delete notice"), 500


# ------------------------------------
# Drivers CRUD (admin)
# ------------------------------------
@app.route('/api/drivers', methods=['GET'])
@login_required(role='admin')
def get_drivers():
    try:
        with db_cursor() as cursor:
            cursor.execute("SELECT driver_id, name, phone_number, experience_years, email FROM drivers")
            return jsonify(make_json_serializable(cursor.fetchall()))
    except Exception as e:
        app.logger.error("Get drivers error: %s", e)
        return _safe_error("Failed to fetch drivers"), 500

@app.route('/api/drivers', methods=['POST'])
@login_required(role='admin')
def add_driver():
    data = request.json
    if not data or not data.get('name') or not data.get('phone_number'):
        return jsonify({"error": "Name and phone number are required"}), 400
    phone = str(data['phone_number']).strip()
    if not _validate_phone(phone):
        return jsonify({"error": "Phone number must be exactly 10 digits"}), 400
    name = data['name'].strip()[:100]
    exp = data.get('experience_years')
    email = (data.get('email') or '').strip().lower() or None
    password = data.get('password')
    hashed = generate_password_hash(password) if password and len(password) >= 8 else None
    try:
        with db_cursor() as cursor:
            cursor.execute(
                "INSERT INTO drivers (name, phone_number, experience_years, email, password) VALUES (%s,%s,%s,%s,%s)",
                (name, phone, exp, email, hashed)
            )
            return jsonify({"success": True, "message": "Driver added"})
    except Exception as e:
        app.logger.error("Add driver error: %s", e)
        return _safe_error("Failed to add driver"), 500

@app.route('/api/drivers/<int:driver_id>', methods=['PUT'])
@login_required(role='admin')
def update_driver(driver_id):
    data = request.json
    if not data or not data.get('name') or not data.get('phone_number'):
        return jsonify({"error": "Name and phone number are required"}), 400
    phone = str(data['phone_number']).strip()
    if not _validate_phone(phone):
        return jsonify({"error": "Phone number must be exactly 10 digits"}), 400
    name = data['name'].strip()[:100]
    exp = data.get('experience_years')
    email = (data.get('email') or '').strip().lower() or None
    password = data.get('password')
    try:
        with db_cursor() as cursor:
            if password and len(password) >= 8:
                hashed = generate_password_hash(password)
                cursor.execute(
                    "UPDATE drivers SET name=%s, phone_number=%s, experience_years=%s, email=%s, password=%s WHERE driver_id=%s",
                    (name, phone, exp, email, hashed, driver_id)
                )
            else:
                cursor.execute(
                    "UPDATE drivers SET name=%s, phone_number=%s, experience_years=%s, email=%s WHERE driver_id=%s",
                    (name, phone, exp, email, driver_id)
                )
            return jsonify({"success": True, "message": "Driver updated"})
    except Exception as e:
        app.logger.error("Update driver error: %s", e)
        return _safe_error("Failed to update driver"), 500

@app.route('/api/drivers/<int:driver_id>', methods=['DELETE'])
@login_required(role='admin')
def delete_driver(driver_id):
    try:
        with db_cursor() as cursor:
            # Unassign buses owned by this driver
            cursor.execute("UPDATE buses SET driver_id=NULL WHERE driver_id=%s", (driver_id,))
            cursor.execute("DELETE FROM drivers WHERE driver_id=%s", (driver_id,))
            return jsonify({"success": True, "message": "Driver deleted"})
    except Exception as e:
        app.logger.error("Delete driver error: %s", e)
        return _safe_error("Failed to delete driver"), 500


# ------------------------------------
# Buses CRUD
# ------------------------------------
@app.route('/api/buses', methods=['GET'])
def get_buses():
    try:
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT b.*, d.name AS driver_name, d.phone_number AS driver_phone,
                       r.route_id, r.route_name,
                       sch.arrival_time_1st_shift, sch.arrival_time_2nd_shift
                FROM buses b
                LEFT JOIN drivers d ON b.driver_id = d.driver_id
                LEFT JOIN schedules sch ON b.bus_id = sch.bus_id
                LEFT JOIN routes r ON sch.route_id = r.route_id
            """)
            return jsonify(make_json_serializable(cursor.fetchall()))
    except Exception as e:
        app.logger.error("Get buses error: %s", e)
        return _safe_error("Failed to fetch buses"), 500

@app.route('/api/buses', methods=['POST'])
@login_required(role='admin')
def add_bus():
    data = request.json
    if not data or not data.get('bus_number', '').strip():
        return jsonify({"error": "Bus number is required"}), 400

    bus_number = data['bus_number'].strip()[:50]
    capacity = data.get('capacity', 52)
    driver_id = data.get('driver_id')
    route_id = data.get('route_id', 1)
    departure = data.get('departure', '08:10:00')
    arrival = data.get('arrival', '10:15:00')

    try:
        with db_cursor() as cursor:
            # Check for duplicate bus number
            cursor.execute("SELECT bus_id FROM buses WHERE bus_number=%s", (bus_number,))
            if cursor.fetchone():
                return jsonify({"error": f"Bus {bus_number} already exists"}), 400

            # If driver_name was provided, find or create driver
            driver_name = data.get('driver_name', '').strip()
            if driver_name and not driver_id:
                cursor.execute("SELECT driver_id FROM drivers WHERE name=%s", (driver_name,))
                dr = cursor.fetchone()
                if dr:
                    driver_id = dr['driver_id']

            cursor.execute(
                "INSERT INTO buses (bus_number, capacity, driver_id) VALUES (%s,%s,%s)",
                (bus_number, capacity, driver_id)
            )
            bus_id = cursor.lastrowid
            cursor.execute(
                "INSERT INTO schedules (bus_id, route_id, arrival_time_1st_shift, arrival_time_2nd_shift) VALUES (%s,%s,%s,%s)",
                (bus_id, route_id, departure, arrival)
            )
            return jsonify({"success": True, "message": "Bus registered!"})
    except Exception as e:
        app.logger.error("Add bus error: %s", e)
        return _safe_error("Failed to register bus"), 500

@app.route('/api/buses/<int:bus_id>', methods=['PUT'])
@login_required(role='admin')
def update_bus(bus_id):
    data = request.json
    if not data or not data.get('bus_number', '').strip():
        return jsonify({"error": "Bus number is required"}), 400
    bus_number = data['bus_number'].strip()[:50]
    capacity = data.get('capacity')
    driver_id = data.get('driver_id')
    route_id = data.get('route_id')
    try:
        with db_cursor() as cursor:
            cursor.execute(
                "UPDATE buses SET bus_number=%s, capacity=%s, driver_id=%s WHERE bus_id=%s",
                (bus_number, capacity, driver_id, bus_id)
            )
            if route_id:
                cursor.execute("DELETE FROM schedules WHERE bus_id=%s", (bus_id,))
                dep = data.get('departure', '08:10:00')
                arr = data.get('arrival', '10:15:00')
                cursor.execute(
                    "INSERT INTO schedules (bus_id, route_id, arrival_time_1st_shift, arrival_time_2nd_shift) VALUES (%s,%s,%s,%s)",
                    (bus_id, route_id, dep, arr)
                )
            return jsonify({"success": True, "message": "Bus updated"})
    except Exception as e:
        app.logger.error("Update bus error: %s", e)
        return _safe_error("Failed to update bus"), 500

@app.route('/api/buses/<int:bus_id>', methods=['DELETE'])
@login_required(role='admin')
def delete_bus(bus_id):
    try:
        with db_cursor() as cursor:
            cursor.execute("DELETE FROM schedules WHERE bus_id=%s", (bus_id,))
            cursor.execute("DELETE FROM bus_locations WHERE bus_id=%s", (bus_id,))
            cursor.execute("DELETE FROM buses WHERE bus_id=%s", (bus_id,))
            return jsonify({"success": True, "message": "Bus deregistered"})
    except Exception as e:
        app.logger.error("Delete bus error: %s", e)
        return _safe_error("Failed to delete bus"), 500


# ------------------------------------
# Routes CRUD
# ------------------------------------
@app.route('/api/routes', methods=['GET'])
def get_routes():
    try:
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT r.*, COUNT(rs.stop_id) AS stop_count
                FROM routes r LEFT JOIN route_stops rs ON r.route_id = rs.route_id
                GROUP BY r.route_id ORDER BY r.route_id
            """)
            return jsonify(make_json_serializable(cursor.fetchall()))
    except Exception as e:
        app.logger.error("Get routes error: %s", e)
        return _safe_error("Failed to fetch routes"), 500

@app.route('/api/routes', methods=['POST'])
@login_required(role='admin')
def add_route():
    data = request.json
    if not data or not data.get('route_name', '').strip():
        return jsonify({"error": "Route name is required"}), 400
    try:
        with db_cursor() as cursor:
            cursor.execute(
                "INSERT INTO routes (route_name, start_point, end_point) VALUES (%s,%s,%s)",
                (data['route_name'].strip(), data.get('start_point', ''), data.get('end_point', ''))
            )
            return jsonify({"success": True, "message": "Route added", "route_id": cursor.lastrowid})
    except Exception as e:
        app.logger.error("Add route error: %s", e)
        return _safe_error("Failed to add route"), 500

@app.route('/api/routes/<int:route_id>', methods=['PUT'])
@login_required(role='admin')
def update_route(route_id):
    data = request.json
    if not data or not data.get('route_name', '').strip():
        return jsonify({"error": "Route name is required"}), 400
    try:
        with db_cursor() as cursor:
            cursor.execute(
                "UPDATE routes SET route_name=%s, start_point=%s, end_point=%s WHERE route_id=%s",
                (data['route_name'].strip(), data.get('start_point', ''), data.get('end_point', ''), route_id)
            )
            return jsonify({"success": True, "message": "Route updated"})
    except Exception as e:
        app.logger.error("Update route error: %s", e)
        return _safe_error("Failed to update route"), 500

@app.route('/api/routes/<int:route_id>', methods=['DELETE'])
@login_required(role='admin')
def delete_route(route_id):
    try:
        with db_cursor() as cursor:
            cursor.execute("UPDATE notices SET target_route_id=NULL WHERE target_route_id=%s", (route_id,))
            cursor.execute("DELETE FROM route_stops WHERE route_id=%s", (route_id,))
            cursor.execute("DELETE FROM student_routes WHERE route_id=%s", (route_id,))
            cursor.execute("DELETE FROM schedules WHERE route_id=%s", (route_id,))
            cursor.execute("DELETE FROM routes WHERE route_id=%s", (route_id,))
            return jsonify({"success": True, "message": "Route deleted"})
    except Exception as e:
        app.logger.error("Delete route error: %s", e)
        return _safe_error("Failed to delete route"), 500


# ------------------------------------
# Route Stops API
# ------------------------------------
@app.route('/api/routes/<int:route_id>/stops', methods=['GET'])
def get_route_stops(route_id):
    try:
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT s.stop_id, s.stop_name, s.latitude, s.longitude,
                       rs.stop_order, rs.arrival_time_1st_shift, rs.arrival_time_2nd_shift
                FROM route_stops rs JOIN stops s ON rs.stop_id = s.stop_id
                WHERE rs.route_id = %s ORDER BY rs.stop_order ASC
            """, (route_id,))
            return jsonify(make_json_serializable(cursor.fetchall()))
    except Exception as e:
        app.logger.error("Route stops error: %s", e)
        return _safe_error("Failed to fetch stops"), 500

@app.route('/api/stops', methods=['GET'])
def get_all_stops():
    try:
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT s.stop_id, s.stop_name, s.latitude, s.longitude,
                       GROUP_CONCAT(DISTINCT r.route_id) AS route_ids,
                       GROUP_CONCAT(DISTINCT r.route_name SEPARATOR '|') AS route_names
                FROM stops s
                LEFT JOIN route_stops rs ON s.stop_id = rs.stop_id
                LEFT JOIN routes r ON rs.route_id = r.route_id
                GROUP BY s.stop_id
                ORDER BY s.stop_name
            """)
            return jsonify(make_json_serializable(cursor.fetchall()))
    except Exception as e:
        app.logger.error("All stops error: %s", e)
        return _safe_error("Failed to fetch stops"), 500

@app.route('/api/stops', methods=['POST'])
@login_required(role='admin')
def add_stop():
    data = request.json
    if not data or not data.get('stop_name', '').strip():
        return jsonify({"error": "Stop name is required"}), 400
    try:
        with db_cursor() as cursor:
            cursor.execute("INSERT INTO stops (stop_name, latitude, longitude) VALUES (%s,%s,%s)",
                           (data['stop_name'].strip(), data.get('latitude'), data.get('longitude')))
            stop_id = cursor.lastrowid
            route_id = data.get('route_id')
            stop_order = data.get('stop_order', 999)
            if route_id:
                cursor.execute(
                    "INSERT INTO route_stops (route_id, stop_id, stop_order) VALUES (%s,%s,%s)",
                    (route_id, stop_id, stop_order)
                )
            return jsonify({"success": True, "stop_id": stop_id})
    except Exception as e:
        app.logger.error("Add stop error: %s", e)
        return _safe_error("Failed to add stop"), 500

@app.route('/api/stops/<int:stop_id>', methods=['PUT'])
@login_required(role='admin')
def update_stop(stop_id):
    data = request.json
    if not data or not data.get('stop_name', '').strip():
        return jsonify({"error": "Stop name is required"}), 400
    try:
        with db_cursor() as cursor:
            cursor.execute("UPDATE stops SET stop_name=%s WHERE stop_id=%s",
                           (data['stop_name'].strip(), stop_id))
            return jsonify({"success": True, "message": "Stop updated"})
    except Exception as e:
        app.logger.error("Update stop error: %s", e)
        return _safe_error("Failed to update stop"), 500

@app.route('/api/stops/<int:stop_id>', methods=['DELETE'])
@login_required(role='admin')
def delete_stop(stop_id):
    try:
        with db_cursor() as cursor:
            cursor.execute("DELETE FROM route_stops WHERE stop_id=%s", (stop_id,))
            cursor.execute("DELETE FROM stops WHERE stop_id=%s", (stop_id,))
            return jsonify({"success": True, "message": "Stop deleted"})
    except Exception as e:
        app.logger.error("Delete stop error: %s", e)
        return _safe_error("Failed to delete stop"), 500

@app.route('/api/routes/<int:route_id>/stops/reorder', methods=['PUT'])
@login_required(role='admin')
def reorder_route_stops(route_id):
    """Expects {"order": [stop_id, stop_id, ...]}"""
    data = request.json
    if not data or 'order' not in data:
        return jsonify({"error": "Order array required"}), 400
    try:
        with db_cursor() as cursor:
            for idx, stop_id in enumerate(data['order'], start=1):
                cursor.execute(
                    "UPDATE route_stops SET stop_order=%s WHERE route_id=%s AND stop_id=%s",
                    (idx, route_id, stop_id)
                )
            return jsonify({"success": True, "message": "Stop order updated"})
    except Exception as e:
        app.logger.error("Reorder error: %s", e)
        return _safe_error("Failed to reorder stops"), 500


# ------------------------------------
# Students CRUD (admin)
# ------------------------------------
@app.route('/api/students', methods=['GET'])
@login_required(role='admin')
def get_students():
    try:
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT s.student_id, s.name, s.email, sr.route_id
                FROM students s LEFT JOIN student_routes sr ON s.student_id = sr.student_id
            """)
            return jsonify(make_json_serializable(cursor.fetchall()))
    except Exception as e:
        app.logger.error("Get students error: %s", e)
        return _safe_error("Failed to fetch students"), 500

@app.route('/api/students', methods=['POST'])
@login_required(role='admin')
def add_student():
    data = request.json
    if not data or not data.get('name') or not data.get('email'):
        return jsonify({"error": "Name and email are required"}), 400
    email = data['email'].strip().lower()
    if not _validate_email(email):
        return jsonify({"error": "Invalid email"}), 400
    password = data.get('password', 'password')
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400
    try:
        with db_cursor() as cursor:
            hashed = generate_password_hash(password)
            cursor.execute("INSERT INTO students (name, email, password) VALUES (%s,%s,%s)",
                           (data['name'].strip()[:100], email, hashed))
            student_id = cursor.lastrowid
            route_id = data.get('route_id')
            if route_id:
                cursor.execute("INSERT INTO student_routes (student_id, route_id) VALUES (%s,%s)",
                               (student_id, route_id))
            return jsonify({"success": True, "message": "Student added"})
    except Exception as e:
        app.logger.error("Add student error: %s", e)
        return _safe_error("Failed to add student"), 500

@app.route('/api/students/<int:student_id>', methods=['PUT'])
@login_required(role='admin')
def update_student(student_id):
    data = request.json
    if not data or not data.get('name') or not data.get('email'):
        return jsonify({"error": "Name and email are required"}), 400
    email = data['email'].strip().lower()
    name = data['name'].strip()[:100]
    password = data.get('password')
    route_id = data.get('route_id')
    try:
        with db_cursor() as cursor:
            if password and len(password) >= 8:
                hashed = generate_password_hash(password)
                cursor.execute("UPDATE students SET name=%s, email=%s, password=%s WHERE student_id=%s",
                               (name, email, hashed, student_id))
            else:
                cursor.execute("UPDATE students SET name=%s, email=%s WHERE student_id=%s",
                               (name, email, student_id))
            if route_id:
                cursor.execute("DELETE FROM student_routes WHERE student_id=%s", (student_id,))
                cursor.execute("INSERT INTO student_routes (student_id, route_id) VALUES (%s,%s)",
                               (student_id, route_id))
            return jsonify({"success": True, "message": "Student updated"})
    except Exception as e:
        app.logger.error("Update student error: %s", e)
        return _safe_error("Failed to update student"), 500

@app.route('/api/students/<int:student_id>', methods=['DELETE'])
@login_required(role='admin')
def delete_student(student_id):
    try:
        with db_cursor() as cursor:
            cursor.execute("DELETE FROM student_routes WHERE student_id=%s", (student_id,))
            cursor.execute("DELETE FROM students WHERE student_id=%s", (student_id,))
            return jsonify({"success": True, "message": "Student deleted"})
    except Exception as e:
        app.logger.error("Delete student error: %s", e)
        return _safe_error("Failed to delete student"), 500


# ------------------------------------
# Student Dashboard
# ------------------------------------
@app.route('/api/student/dashboard', methods=['GET'])
@login_required(role='student')
def get_student_dashboard():
    student_id = session['user']['id']
    try:
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT r.route_id, r.route_name, r.start_point, r.end_point
                FROM student_routes sr JOIN routes r ON sr.route_id = r.route_id
                WHERE sr.student_id = %s
            """, (student_id,))
            route = cursor.fetchone()

            if not route:
                return jsonify(make_json_serializable({
                    "student": session['user'],
                    "route": None,
                    "buses": [], "stops": [], "notices": []
                }))

            route_id = route['route_id']

            cursor.execute("""
                SELECT b.bus_id, b.bus_number, b.capacity, b.latitude, b.longitude,
                       d.name AS driver, d.phone_number AS driver_phone,
                       s.arrival_time_1st_shift AS departure, s.arrival_time_2nd_shift AS arrival
                FROM schedules s JOIN buses b ON s.bus_id = b.bus_id
                LEFT JOIN drivers d ON b.driver_id = d.driver_id
                WHERE s.route_id = %s
            """, (route_id,))
            buses = cursor.fetchall()

            cursor.execute("""
                SELECT s.stop_id, s.stop_name, rs.stop_order,
                       rs.arrival_time_1st_shift, rs.arrival_time_2nd_shift
                FROM route_stops rs JOIN stops s ON rs.stop_id = s.stop_id
                WHERE rs.route_id = %s ORDER BY rs.stop_order ASC
            """, (route_id,))
            stops = cursor.fetchall()

            cursor.execute("""
                SELECT notice_id AS id, title, message AS text, target_route_id, expiry_date
                FROM notices
                WHERE (target_route_id IS NULL OR target_route_id = %s)
                  AND (expiry_date IS NULL OR expiry_date >= CURDATE())
                ORDER BY created_at DESC
            """, (route_id,))
            notices = cursor.fetchall()

            return jsonify(make_json_serializable({
                "student": session['user'],
                "route": route,
                "buses": buses,
                "stops": stops,
                "notices": notices
            }))
    except Exception as e:
        app.logger.error("Student dashboard error: %s", e)
        return _safe_error("Failed to load dashboard"), 500


# ------------------------------------
# Student: Change Route
# ------------------------------------
@app.route('/api/student/route', methods=['PUT'])
@login_required(role='student')
def change_student_route():
    data = request.json
    if not data or not data.get('route_id'):
        return jsonify({"error": "route_id is required"}), 400
    student_id = session['user']['id']
    try:
        with db_cursor() as cursor:
            cursor.execute("DELETE FROM student_routes WHERE student_id=%s", (student_id,))
            cursor.execute("INSERT INTO student_routes (student_id, route_id) VALUES (%s,%s)",
                           (student_id, data['route_id']))
            return jsonify({"success": True, "message": "Route updated"})
    except Exception as e:
        app.logger.error("Change route error: %s", e)
        return _safe_error("Failed to change route"), 500


# ------------------------------------
# Driver Dashboard
# ------------------------------------
@app.route('/api/driver/dashboard', methods=['GET'])
@login_required(role='driver')
def get_driver_dashboard():
    driver_id = session['user']['id']
    try:
        with db_cursor() as cursor:
            cursor.execute("SELECT * FROM buses WHERE driver_id = %s LIMIT 1", (driver_id,))
            bus = cursor.fetchone()

            if not bus:
                return jsonify(make_json_serializable({
                    "driver": session['user'], "bus": None,
                    "route": None, "stops": [], "notices": []
                }))

            cursor.execute("""
                SELECT r.route_id, r.route_name, r.start_point, r.end_point,
                       s.arrival_time_1st_shift, s.arrival_time_2nd_shift
                FROM schedules s JOIN routes r ON s.route_id = r.route_id
                WHERE s.bus_id = %s LIMIT 1
            """, (bus['bus_id'],))
            route = cursor.fetchone()
            route_id = route['route_id'] if route else None

            # Get route stops
            stops = []
            if route_id:
                cursor.execute("""
                    SELECT s.stop_name, rs.stop_order,
                           rs.arrival_time_1st_shift, rs.arrival_time_2nd_shift
                    FROM route_stops rs JOIN stops s ON rs.stop_id = s.stop_id
                    WHERE rs.route_id = %s ORDER BY rs.stop_order ASC
                """, (route_id,))
                stops = cursor.fetchall()

            # Notices
            if route_id:
                cursor.execute("""
                    SELECT notice_id AS id, title, message AS text, target_route_id, expiry_date
                    FROM notices
                    WHERE (target_route_id IS NULL OR target_route_id = %s)
                      AND (expiry_date IS NULL OR expiry_date >= CURDATE())
                    ORDER BY created_at DESC
                """, (route_id,))
            else:
                cursor.execute("""
                    SELECT notice_id AS id, title, message AS text, target_route_id, expiry_date
                    FROM notices
                    WHERE target_route_id IS NULL
                      AND (expiry_date IS NULL OR expiry_date >= CURDATE())
                    ORDER BY created_at DESC
                """)
            notices = cursor.fetchall()

            return jsonify(make_json_serializable({
                "driver": session['user'], "bus": bus,
                "route": route, "stops": stops, "notices": notices
            }))
    except Exception as e:
        app.logger.error("Driver dashboard error: %s", e)
        return _safe_error("Failed to load driver dashboard"), 500


# ------------------------------------
# GPS Tracking
# ------------------------------------
@app.route('/api/track/<int:bus_id>', methods=['GET'])
def get_bus_location(bus_id):
    try:
        with db_cursor() as cursor:
            cursor.execute("SELECT bus_id, bus_number, latitude, longitude, last_updated FROM buses WHERE bus_id=%s",
                           (bus_id,))
            bus = cursor.fetchone()
            if not bus:
                return jsonify({"error": "Bus not found"}), 404
            return jsonify(make_json_serializable(bus))
    except Exception as e:
        app.logger.error("Track GET error: %s", e)
        return _safe_error("Failed to get location"), 500

@app.route('/api/track/<int:bus_id>', methods=['POST'])
@login_required()
def update_bus_location(bus_id):
    """Only drivers (assigned to this bus) and admins can update bus location."""
    user = session['user']
    role = user['role']

    # Students cannot update bus locations
    if role == 'student':
        return jsonify({"error": "Forbidden"}), 403

    data = request.json
    if not data or 'latitude' not in data or 'longitude' not in data:
        return jsonify({"error": "Latitude and longitude are required"}), 400

    # Validate coordinates
    try:
        lat = float(data['latitude'])
        lng = float(data['longitude'])
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid coordinates"}), 400

    if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return jsonify({"error": "Coordinates out of range"}), 400

    try:
        with db_cursor() as cursor:
            # If driver, verify they own this bus
            if role == 'driver':
                cursor.execute("SELECT bus_id FROM buses WHERE bus_id=%s AND driver_id=%s",
                               (bus_id, user['id']))
                if not cursor.fetchone():
                    return jsonify({"error": "Forbidden: not your assigned bus"}), 403

            cursor.execute(
                "UPDATE buses SET latitude=%s, longitude=%s, last_updated=NOW() WHERE bus_id=%s",
                (lat, lng, bus_id)
            )
            # Record in history
            cursor.execute(
                "INSERT INTO bus_locations (bus_id, latitude, longitude) VALUES (%s,%s,%s)",
                (bus_id, lat, lng)
            )
            return jsonify({"success": True, "message": "Location updated"})
    except Exception as e:
        app.logger.error("Track POST error: %s", e)
        return _safe_error("Failed to update location"), 500


# ------------------------------------
# Admin Stats (counts from DB)
# ------------------------------------
@app.route('/api/admin/stats', methods=['GET'])
@login_required(role='admin')
def admin_stats():
    try:
        with db_cursor() as cursor:
            cursor.execute("SELECT COUNT(*) AS c FROM routes")
            routes = cursor.fetchone()['c']
            cursor.execute("SELECT COUNT(*) AS c FROM stops")
            stops = cursor.fetchone()['c']
            cursor.execute("SELECT COUNT(*) AS c FROM buses")
            buses = cursor.fetchone()['c']
            cursor.execute("SELECT COUNT(*) AS c FROM drivers")
            drivers = cursor.fetchone()['c']
            cursor.execute("SELECT COUNT(*) AS c FROM students")
            students = cursor.fetchone()['c']
            cursor.execute("""
                SELECT COUNT(*) AS c FROM notices
                WHERE expiry_date IS NULL OR expiry_date >= CURDATE()
            """)
            notices = cursor.fetchone()['c']
            return jsonify({
                "routes": routes, "stops": stops, "buses": buses,
                "drivers": drivers, "students": students, "notices": notices
            })
    except Exception as e:
        app.logger.error("Admin stats error: %s", e)
        return _safe_error("Failed to fetch stats"), 500


# ------------------------------------
# CLI: flask create-admin
# ------------------------------------
@app.cli.command('create-admin')
def cli_create_admin():
    """Create an admin account from the command line."""
    import getpass
    email = input("Admin email: ").strip().lower()
    password = getpass.getpass("Password (min 8 chars): ")
    if len(password) < 8:
        print("Error: Password must be at least 8 characters.")
        return
    hashed = generate_password_hash(password)
    try:
        with db_cursor() as cursor:
            cursor.execute("INSERT INTO admins (username, password) VALUES (%s,%s)", (email, hashed))
        print(f"Admin '{email}' created successfully.")
    except Exception as e:
        print(f"Error: {e}")


# ------------------------------------
# Run
# ------------------------------------
if __name__ == '__main__':
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    host = '0.0.0.0' if os.environ.get('ALLOW_LAN', '0') == '1' else '127.0.0.1'
    app.run(host=host, port=5000, debug=debug)
