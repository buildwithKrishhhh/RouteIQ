"""
RouteIQ Test Suite
Tests for authentication, security hardening, track authorization, notice expiry, and buses/stops endpoints.
"""

import pytest
import datetime
from app import app, db_cursor

@pytest.fixture
def client():
    app.config['TESTING'] = True
    app.config['SECRET_KEY'] = 'test-secret-key'
    with app.test_client() as client:
        yield client

def test_login_success(client):
    """Test successful student login returns user data and session cookie."""
    res = client.post('/api/login', json={
        'email': 'student@routeiq.edu',
        'password': 'password',
        'role': 'student'
    })
    assert res.status_code == 200
    data = res.get_json()
    assert data['success'] is True
    assert data['user']['role'] == 'student'

def test_login_invalid_credentials(client):
    """Test failed login with incorrect password returns 401."""
    res = client.post('/api/login', json={
        'email': 'student@routeiq.edu',
        'password': 'wrongpassword123',
        'role': 'student'
    })
    assert res.status_code == 401
    data = res.get_json()
    assert 'error' in data

def test_register_admin_rejected(client):
    """SECURITY FIX: /api/register must NEVER create admins."""
    res = client.post('/api/register', json={
        'name': 'Malicious Admin',
        'email': 'hacker@routeiq.edu',
        'password': 'password123',
        'role': 'admin',
        'route_id': 1
    })
    assert res.status_code == 403
    data = res.get_json()
    assert 'Only student registration is supported' in data['error']

def test_register_short_password(client):
    """Enforce minimum 8 characters password on registration."""
    res = client.post('/api/register', json={
        'name': 'Short Pass',
        'email': 'shortpass@routeiq.edu',
        'password': 'short',
        'role': 'student',
        'route_id': 1
    })
    assert res.status_code == 400
    data = res.get_json()
    assert '8 characters' in data['error']

def test_track_get_location(client):
    """GET /api/track/<bus_id> returns 200 and coordinates."""
    res = client.get('/api/track/1')
    assert res.status_code == 200
    data = res.get_json()
    assert 'latitude' in data
    assert 'longitude' in data

def test_track_student_post_forbidden(client):
    """SECURITY: A student cannot POST to /api/track/<id>."""
    # Login as student
    client.post('/api/login', json={
        'email': 'student@routeiq.edu',
        'password': 'password',
        'role': 'student'
    })
    res = client.post('/api/track/1', json={
        'latitude': 22.7196,
        'longitude': 75.8577
    })
    assert res.status_code == 403

def test_track_unauthenticated_forbidden(client):
    """Unauthenticated users cannot update GPS coordinates."""
    with client.session_transaction() as sess:
        sess.clear()
    res = client.post('/api/track/1', json={
        'latitude': 22.7196,
        'longitude': 75.8577
    })
    assert res.status_code == 401

def test_track_invalid_coordinates(client):
    """Validate coordinate ranges (-90..90, -180..180)."""
    # Login as admin
    client.post('/api/login', json={
        'email': 'admin@routeiq.edu',
        'password': 'admin123',
        'role': 'admin'
    })
    res = client.post('/api/track/1', json={
        'latitude': 999.0,
        'longitude': 75.8577
    })
    assert res.status_code == 400

def test_notices_expiry_filter(client):
    """GET /api/notices excludes expired notices by default."""
    # Insert an expired notice and a future notice for testing
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()

    with db_cursor() as cur:
        cur.execute(
            "INSERT INTO notices (title, message, expiry_date) VALUES (%s, %s, %s)",
            ('Expired Test Notice', 'Should be hidden', yesterday)
        )
        cur.execute(
            "INSERT INTO notices (title, message, expiry_date) VALUES (%s, %s, %s)",
            ('Active Test Notice', 'Should be visible', tomorrow)
        )

    res = client.get('/api/notices')
    assert res.status_code == 200
    notices = res.get_json()
    titles = [n['title'] for n in notices]
    assert 'Active Test Notice' in titles
    assert 'Expired Test Notice' not in titles

    # Check that include_expired=1 returns it
    res_all = client.get('/api/notices?include_expired=1')
    titles_all = [n['title'] for n in res_all.get_json()]
    assert 'Expired Test Notice' in titles_all

def test_buses_extended_endpoint(client):
    """GET /api/buses returns route_id, route_name, and shift times."""
    res = client.get('/api/buses')
    assert res.status_code == 200
    buses = res.get_json()
    assert isinstance(buses, list)
    assert len(buses) > 0
    bus = buses[0]
    assert 'bus_number' in bus
    assert 'route_name' in bus
    assert 'arrival_time_1st_shift' in bus
    assert 'driver_name' in bus

def test_route_stops_endpoint(client):
    """GET /api/routes/<id>/stops returns ordered list of stops with shift times."""
    res = client.get('/api/routes/1/stops')
    assert res.status_code == 200
    stops = res.get_json()
    assert isinstance(stops, list)
    assert len(stops) > 0
    assert 'stop_name' in stops[0]
    assert 'stop_order' in stops[0]
    assert 'arrival_time_1st_shift' in stops[0]
