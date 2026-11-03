# RouteIQ — Intelligent University Transit System

A secure, real-time college bus tracking and fleet operations web application built with Flask, MySQL, and vanilla JavaScript for Acropolis College, Indore.

---

## Features

- **Interactive Transit Portals:**
  - **Student Portal:** Personalized route stops timeline, serving buses, bulletin alerts, live transit search, and custom route assignment.
  - **Driver Portal:** Active trip dashboard, route schedule, bulletin board, manual GPS ping, and 10-second automatic geolocation broadcasting via Web Geolocation API.
  - **Administrator Portal:** Fleet management, route & stop definitions with drag/order controls, broadcast announcement dispatch with expiry dates, and real-time security authentication audit logs.
- **Dedicated Pages & Deep Linking:**
  - **Buses Page (`#/buses`):** Grid view of all 40+ transit vehicles with assigned drivers, tap-to-call driver phone numbers, shift times, and inline interactive OpenStreetMap / Leaflet live tracking.
  - **Stops & Routes Page (`#/stops`):** Accordion timeline of all 17 college routes with scheduled stop arrival times and serving bus chips.
- **Enterprise-Grade Security:**
  - Password hashing via `werkzeug.security` (`scrypt` / `pbkdf2`).
  - Strict role authorization (`/api/register` restricted exclusively to students; admins created via seed, CLI, or admin portal).
  - Rate limiting on authentication attempts (maximum 5 failed attempts per email+IP per 10 minutes).
  - Secure session cookies (`SESSION_COOKIE_HTTPONLY=True`, `SESSION_COOKIE_SAMESITE='Lax'`).
  - GPS broadcast protection (only drivers assigned to the specific bus or admins can update coordinates; coordinates validated to float ranges).
  - Complete XSS prevention (`escapeHtml` encoding across all dynamic UI components).
  - Generic server error responses (no stack trace or internal SQL leakage to client).

---

## Tech Stack

- **Backend:** Python 3.10+, Flask 3.1, Werkzeug 3.1
- **Database:** MySQL 8.0+ (InnoDB, lowercase tables, foreign keys with ON DELETE rules, indexing)
- **Frontend:** Semantic HTML5, Vanilla CSS3 (Dark Glassmorphism Theme), Modular Vanilla JavaScript
- **Mapping:** Leaflet.js with OpenStreetMap tiles

---

## Project Structure

```
pj001/
├── app.py                  # Main Flask application and REST API endpoints
├── bustrackingdb.sql       # Idempotent database schema and seed data (17 routes, 40 buses)
├── .env                    # Environment configuration (DB credentials, secret key)
├── .env.example            # Example environment template
├── requirements.txt        # Pinned Python package dependencies
├── test_app.py             # Pytest test suite for security, auth, and API endpoints
├── launch.json             # IDE debug configuration
├── Bus-Route.pdf           # Source college route schedule (July 2015)
├── static/
│   ├── style.css           # Dark glassmorphism stylesheet & responsive layout
│   └── app.js              # Modular frontend client application
└── templates/
    └── index.html          # Main application single-page layout
```

---

## Setup & Installation

### 1. Prerequisites
- **Python 3.10+**
- **MySQL 8.0+**

### 2. Configure Environment (`.env`)
Copy `.env.example` to `.env` and fill in your dedicated MySQL credentials:

```bash
cp .env.example .env
```

Example `.env`:
```ini
FLASK_DEBUG=0
ALLOW_LAN=0
SECRET_KEY=generate_a_random_32_byte_hex_key_here
DB_HOST=localhost
DB_USER=routeiq_user
DB_PASSWORD=your_secure_password
DB_NAME=busmg
```

### 3. Create Dedicated MySQL User & Import Database
Run MySQL as root to provision the database and application user:

```sql
CREATE DATABASE IF NOT EXISTS busmg;
CREATE USER IF NOT EXISTS 'routeiq_user'@'localhost' IDENTIFIED BY 'your_secure_password';
GRANT ALL PRIVILEGES ON busmg.* TO 'routeiq_user'@'localhost';
FLUSH PRIVILEGES;
```

Import the idempotent schema and full route seed data:
```bash
mysql -u routeiq_user -p busmg < bustrackingdb.sql
```

### 4. Install Dependencies
```bash
pip install -r requirements.txt
```

### 5. Create First Administrator Account (CLI)
You can create an administrator securely using the Flask CLI command:

```bash
flask create-admin
```
Follow the prompt to enter the administrator institutional email (e.g. `admin@routeiq.edu`) and a secure password (minimum 8 characters).

---

## Running the Application

Start the Flask server:
```bash
python app.py
```
Or with Flask CLI:
```bash
flask run --host=127.0.0.1 --port=5000
```
Open [http://127.0.0.1:5000](http://127.0.0.1:5000) in your browser.

### Seed Accounts (Development)
- **Admin:** `admin@routeiq.edu` / `admin123`
- **Student:** `student@routeiq.edu` / `password`
- **Driver:** `driver@routeiq.edu` / `password`

---

## Running the Test Suite

Execute the automated `pytest` test suite covering authentication, admin registration prevention, GPS tracking authorization, notice expiry, and route/bus endpoints:

```bash
pytest test_app.py -v
```

---

## License & Credits

© 2026 RouteIQ · Acropolis College University Transit Systems.
