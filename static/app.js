/**
 * RouteIQ — Smart University Transit Application
 * Modular Vanilla JavaScript Architecture
 * Modules: Utils, Auth, Router, Student, Driver, Admin, BusesPage, StopsPage, MapManager
 */

(function () {
  'use strict';

  // ------------------------------------------------------------
  // 1. UTILITIES & HELPERS
  // ------------------------------------------------------------
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getInitials(name) {
    if (!name || typeof name !== 'string') return 'IQ';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0 || !parts[0]) return 'IQ';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function formatTime(timeStr) {
    if (!timeStr) return '—';
    const parts = String(timeStr).split(':');
    if (parts.length >= 2) {
      const h = parseInt(parts[0], 10);
      const m = parts[1];
      const ampm = h >= 12 ? 'PM' : 'AM';
      const formattedH = h % 12 || 12;
      return `${formattedH}:${m} ${ampm}`;
    }
    return timeStr;
  }

  function toast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toastEl = document.createElement('div');
    toastEl.className = `toast ${type}`;
    toastEl.innerHTML = `<span>${escapeHtml(message)}</span>`;
    container.appendChild(toastEl);
    setTimeout(() => {
      toastEl.style.animation = 'toast-out 0.3s forwards ease-in';
      setTimeout(() => toastEl.remove(), 300);
    }, duration);
  }

  function confirmModal(title, text, onConfirm) {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const bodyEl = document.getElementById('confirm-modal-body');
    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');

    titleEl.textContent = title;
    bodyEl.textContent = text;
    modal.style.display = 'flex';

    function cleanup() {
      modal.style.display = 'none';
      okBtn.onclick = null;
      cancelBtn.onclick = null;
    }

    okBtn.onclick = () => {
      cleanup();
      if (typeof onConfirm === 'function') onConfirm();
    };
    cancelBtn.onclick = cleanup;
  }

  // ------------------------------------------------------------
  // 2. STATE MANAGEMENT
  // ------------------------------------------------------------
  const state = {
    currentUser: null,
    currentLoginRole: 'student',
    allRoutes: [],
    allBuses: [],
    allDrivers: [],
    activeMapInstance: null,
    activeMapBusId: null,
    mapRefreshTimer: null,
    driverWatchId: null,
    auditPage: 1,
    auditTotalPages: 1,
    auditStatus: ''
  };

  // ------------------------------------------------------------
  // 3. AUTHENTICATION & SESSION
  // ------------------------------------------------------------
  async function checkSession() {
    try {
      const res = await fetch('/api/session');
      const data = await res.json();
      if (data.logged_in && data.user) {
        state.currentUser = data.user;
        updateUserUI(data.user);
        Router.navigate(window.location.hash || '#/dashboard');
      } else {
        showLoginView();
      }
    } catch (e) {
      console.error('Session check failed:', e);
      showLoginView();
    }
  }

  function updateUserUI(user) {
    const initials = getInitials(user.name);
    // Student
    const stAvatar = document.getElementById('student-avatar');
    const stNav = document.getElementById('student-nav-name');
    const stWelcome = document.getElementById('student-welcome-name');
    if (stAvatar) stAvatar.textContent = initials;
    if (stNav) stNav.textContent = user.name || 'Student';
    if (stWelcome) stWelcome.textContent = user.name || 'Student';

    // Driver
    const drAvatar = document.getElementById('driver-avatar');
    const drNav = document.getElementById('driver-nav-name');
    const drWelcome = document.getElementById('driver-welcome-name');
    if (drAvatar) drAvatar.textContent = initials;
    if (drNav) drNav.textContent = user.name || 'Driver';
    if (drWelcome) drWelcome.textContent = user.name || 'Driver';

    // Admin
    const adAvatar = document.getElementById('admin-avatar');
    const adNav = document.getElementById('admin-nav-name');
    if (adAvatar) adAvatar.textContent = initials;
    if (adNav) adNav.textContent = user.name || 'Administrator';
  }

  function showLoginView() {
    state.currentUser = null;
    hideAllViews();
    const loginSec = document.getElementById('login-section');
    if (loginSec) loginSec.style.display = 'flex';
    showRoleSelection();
  }

  function showRoleSelection() {
    document.getElementById('role-selection-view').style.display = 'block';
    document.getElementById('signin-view').style.display = 'none';
    document.getElementById('register-view').style.display = 'none';
  }

  function showSignIn(role) {
    state.currentLoginRole = role;
    document.getElementById('role-selection-view').style.display = 'none';
    document.getElementById('signin-view').style.display = 'block';
    document.getElementById('register-view').style.display = 'none';

    const titleEl = document.getElementById('signin-title');
    const subEl = document.getElementById('signin-sub');
    const switchContainer = document.getElementById('auth-switch-container');

    if (role === 'admin') {
      titleEl.textContent = 'Administrator Portal';
      subEl.textContent = 'Sign in with institutional administrator credentials';
      switchContainer.style.display = 'none'; // Admins cannot register
    } else if (role === 'driver') {
      titleEl.textContent = 'Driver Portal';
      subEl.textContent = 'Sign in to broadcast GPS and review route schedule';
      switchContainer.style.display = 'none'; // Drivers cannot register
    } else {
      titleEl.textContent = 'Student Transit Portal';
      subEl.textContent = 'Sign in with your Acropolis student email';
      switchContainer.style.display = 'block'; // Students can register
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const submitBtn = document.getElementById('login-submit-btn');

    if (!email || !password) {
      toast('Please enter both email and password.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role: state.currentLoginRole })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        state.currentUser = data.user;
        updateUserUI(data.user);
        toast(`Welcome back, ${data.user.name}!`, 'success');
        document.getElementById('login-form').reset();
        Router.navigate('#/dashboard');
      } else {
        toast(data.error || 'Authentication failed. Please verify credentials.', 'error');
      }
    } catch (err) {
      toast('Network error during sign in.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const route_id = document.getElementById('reg-route').value;
    const submitBtn = document.getElementById('register-submit-btn');

    if (password.length < 8) {
      toast('Password must be at least 8 characters long.', 'error');
      return;
    }
    if (!route_id) {
      toast('Please select your daily commute route.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account...';

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, route_id: parseInt(route_id, 10), role: 'student' })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        state.currentUser = data.user;
        updateUserUI(data.user);
        toast('Account registered successfully! Welcome to RouteIQ.', 'success');
        document.getElementById('register-form').reset();
        Router.navigate('#/dashboard');
      } else {
        toast(data.error || 'Registration failed.', 'error');
      }
    } catch (err) {
      toast('Network error during registration.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Student Account';
    }
  }

  async function handleLogout() {
    confirmModal('Sign Out', 'Are you sure you want to log out of your session?', async () => {
      try {
        await fetch('/api/logout', { method: 'POST' });
      } catch (e) {
        console.error(e);
      }
      if (state.driverWatchId !== null) {
        navigator.geolocation.clearWatch(state.driverWatchId);
        state.driverWatchId = null;
      }
      MapManager.clear();
      state.currentUser = null;
      window.location.hash = '';
      showLoginView();
      toast('You have been logged out safely.', 'info');
    });
  }

  async function loadRoutesForRegistration() {
    try {
      const res = await fetch('/api/routes');
      const routes = await res.json();
      const select = document.getElementById('reg-route');
      if (!select) return;
      select.innerHTML = '<option value="" disabled selected>Select your commute route...</option>' +
        routes.map(r => `<option value="${r.route_id}">${escapeHtml(r.route_name)} (${escapeHtml(r.start_point)} → ${escapeHtml(r.end_point)})</option>`).join('');
    } catch (e) {
      console.error('Failed to load routes for registration:', e);
    }
  }

  // ------------------------------------------------------------
  // 4. ROUTER & VIEW ORCHESTRATION
  // ------------------------------------------------------------
  function hideAllViews() {
    const views = [
      'login-section',
      'student-dashboard',
      'driver-dashboard',
      'admin-dashboard',
      'buses-page-view',
      'stops-page-view',
      'admin-drivers-view',
      'admin-students-view'
    ];
    views.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  const Router = {
    navigate(hash) {
      window.location.hash = hash;
    },

    handleRoute() {
      if (!state.currentUser) {
        showLoginView();
        return;
      }

      const fullHash = window.location.hash || '#/dashboard';
      const [path, queryString] = fullHash.split('?');
      const params = new URLSearchParams(queryString || '');

      // Update active nav links across all topbars
      document.querySelectorAll('.topbar-nav .nav-link').forEach(link => {
        const linkHash = link.getAttribute('data-hash');
        if (linkHash === path) {
          link.classList.add('active');
        } else {
          link.classList.remove('active');
        }
      });

      hideAllViews();
      MapManager.clear();

      if (path === '#/buses') {
        BusesPage.render(params.get('focus'));
      } else if (path === '#/stops') {
        StopsPage.render(params.get('route'), params.get('focus'));
      } else if (path === '#/drivers') {
        if (state.currentUser.role === 'admin') {
          AdminDriversPage.render();
        } else {
          Router.navigate('#/dashboard');
        }
      } else if (path === '#/students') {
        if (state.currentUser.role === 'admin') {
          AdminStudentsPage.render();
        } else {
          Router.navigate('#/dashboard');
        }
      } else {
        // #/dashboard default
        if (state.currentUser.role === 'admin') {
          document.getElementById('admin-dashboard').style.display = 'flex';
          AdminPortal.load();
        } else if (state.currentUser.role === 'driver') {
          document.getElementById('driver-dashboard').style.display = 'flex';
          DriverPortal.load();
        } else {
          document.getElementById('student-dashboard').style.display = 'flex';
          StudentPortal.load();
        }
      }
    }
  };

  // ------------------------------------------------------------
  // 5. STUDENT PORTAL
  // ------------------------------------------------------------
  const StudentPortal = {
    async load() {
      const dateEl = document.getElementById('student-hero-date');
      if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
        });
      }

      try {
        const res = await fetch('/api/student/dashboard');
        const data = await res.json();
        StudentPortal.render(data);
      } catch (err) {
        console.error('Failed to load student dashboard:', err);
        toast('Unable to load dashboard data.', 'error');
      }
    },

    render(data) {
      const { route, buses, stops, notices } = data;

      // Stats
      document.getElementById('student-stat-buses').textContent = buses ? buses.length : '0';
      document.getElementById('student-stat-stops').textContent = stops ? stops.length : '0';
      document.getElementById('student-stat-notices').textContent = notices ? notices.length : '0';

      const routeInfoEl = document.getElementById('student-route-info');
      const noRouteAlert = document.getElementById('student-no-route-alert');

      if (!route) {
        routeInfoEl.textContent = 'No route assigned';
        if (noRouteAlert) {
          noRouteAlert.style.display = 'block';
          StudentPortal.populateRouteSelect();
        }
      } else {
        routeInfoEl.textContent = `${route.route_name} (${route.start_point} → ${route.end_point})`;
        if (noRouteAlert) noRouteAlert.style.display = 'none';
      }

      // Heading link
      const heading = document.getElementById('student-timeline-heading');
      if (heading) {
        heading.onclick = () => {
          if (route) location.hash = `#/stops?route=${route.route_id}`;
          else location.hash = '#/stops';
        };
      }

      // Stops timeline
      const stopList = document.getElementById('student-stop-list');
      if (stopList) {
        if (!stops || stops.length === 0) {
          stopList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No stops mapped for this route.</p>';
        } else {
          stopList.innerHTML = stops.map(s => `
            <div class="timeline-item" role="link" tabindex="0" onclick="location.hash='#/stops?route=${route ? route.route_id : ''}&focus=${encodeURIComponent(s.stop_name)}'">
              <div class="timeline-node"></div>
              <div class="timeline-content">
                <span class="timeline-title">${escapeHtml(s.stop_name)}</span>
                <span class="timeline-time">${formatTime(s.arrival_time_1st_shift)}</span>
              </div>
            </div>
          `).join('');
        }
      }

      // Buses on route
      const busList = document.getElementById('student-bus-list');
      if (busList) {
        if (!buses || buses.length === 0) {
          busList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No buses scheduled on this route currently.</p>';
        } else {
          busList.innerHTML = buses.map(b => `
            <div class="bus-item" role="link" tabindex="0" onclick="location.hash='#/buses?focus=${b.bus_id}'">
              <div class="bus-meta">
                <h4>${escapeHtml(b.bus_number)}</h4>
                <p>Driver: ${escapeHtml(b.driver || 'Assigned Driver')} · Arrival: ${formatTime(b.departure)}</p>
              </div>
              <div class="bus-actions">
                <button class="track-btn" onclick="event.stopPropagation(); location.hash='#/buses?focus=${b.bus_id}'">
                  <span>📍 Track</span>
                </button>
              </div>
            </div>
          `).join('');
        }
      }

      // Bulletins
      const noticeList = document.getElementById('student-notice-list');
      if (noticeList) {
        if (!notices || notices.length === 0) {
          noticeList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No active bulletins for your route.</p>';
        } else {
          noticeList.innerHTML = notices.map(n => `
            <div class="notice-item">
              <div class="notice-header">
                <span class="notice-title">${escapeHtml(n.title)}</span>
                ${n.expiry_date ? `<span class="notice-expiry-badge">Expires: ${escapeHtml(n.expiry_date)}</span>` : ''}
              </div>
              <p class="notice-body">${escapeHtml(n.text)}</p>
            </div>
          `).join('');
        }
      }
    },

    async populateRouteSelect() {
      const select = document.getElementById('student-change-route-select');
      if (!select) return;
      try {
        const res = await fetch('/api/routes');
        const routes = await res.json();
        select.innerHTML = '<option value="" disabled selected>Choose a route...</option>' +
          routes.map(r => `<option value="${r.route_id}">${escapeHtml(r.route_name)}</option>`).join('');
      } catch (e) {
        console.error(e);
      }
    },

    async handleSaveRoute() {
      const select = document.getElementById('student-change-route-select');
      const route_id = select ? select.value : null;
      if (!route_id) {
        toast('Please pick a route from the list.', 'error');
        return;
      }
      try {
        const res = await fetch('/api/student/route', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ route_id: parseInt(route_id, 10) })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          toast('Route updated successfully!', 'success');
          StudentPortal.load();
        } else {
          toast(data.error || 'Failed to update route.', 'error');
        }
      } catch (e) {
        toast('Network error updating route.', 'error');
      }
    },

    async handleSearch() {
      const input = document.getElementById('student-search-input');
      const container = document.getElementById('search-results');
      const query = input.value.trim();
      if (!query) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
      }

      container.style.display = 'flex';
      container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">Searching transit system...</p>';

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const results = await res.json();
        if (!results || results.length === 0) {
          container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem;">No results found for "${escapeHtml(query)}".</p>`;
          return;
        }

        let html = `<p style="font-size: 0.8rem; color: var(--color-secondary); font-weight: 600;">Results for "${escapeHtml(query)}":</p>`;
        results.forEach(item => {
          html += `
            <div style="background: rgba(15,23,42,0.6); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-light);">
              <div style="font-weight: 700; font-size: 0.95rem; margin-bottom: 6px;">
                ${escapeHtml(item.route.route_name)}
                <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: normal;">(${escapeHtml(item.route.start_point)} → ${escapeHtml(item.route.end_point)})</span>
              </div>
              <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;">
                ${(item.buses || []).map(b => `
                  <span class="chip" onclick="location.hash='#/buses?focus=${b.bus_id}'">
                    🚌 ${escapeHtml(b.bus_number)} (${escapeHtml(b.driver || 'Driver')})
                  </span>
                `).join('')}
                ${(item.stops || []).slice(0, 8).map(s => `
                  <span class="chip stop-chip" onclick="location.hash='#/stops?route=${item.route.route_id}&focus=${encodeURIComponent(s)}'">
                    📍 ${escapeHtml(s)}
                  </span>
                `).join('')}
              </div>
            </div>
          `;
        });
        container.innerHTML = html;
      } catch (e) {
        container.innerHTML = '<p style="color: var(--color-danger); font-size: 0.85rem;">Search request failed.</p>';
      }
    }
  };

  // ------------------------------------------------------------
  // 6. DRIVER PORTAL
  // ------------------------------------------------------------
  const DriverPortal = {
    async load() {
      const dateEl = document.getElementById('driver-hero-date');
      if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
        });
      }

      try {
        const res = await fetch('/api/driver/dashboard');
        const data = await res.json();
        DriverPortal.render(data);
      } catch (err) {
        console.error('Failed to load driver dashboard:', err);
        toast('Unable to load driver portal.', 'error');
      }
    },

    render(data) {
      const { bus, route, stops, notices } = data;

      document.getElementById('driver-stat-bus').textContent = bus ? bus.bus_number : 'Unassigned';
      document.getElementById('driver-stat-route').textContent = route ? route.route_name : 'No active route';

      const assignedInfo = document.getElementById('driver-assigned-info');
      if (assignedInfo) {
        if (bus) {
          assignedInfo.textContent = `Vehicle ${bus.bus_number} · ${route ? route.route_name : 'General Transit Fleet'}`;
        } else {
          assignedInfo.textContent = 'Vehicle unassigned. Contact transit administrator.';
        }
      }

      if (bus && bus.latitude && bus.longitude) {
        const coordsEl = document.getElementById('driver-coordinates');
        if (coordsEl) coordsEl.textContent = `${Number(bus.latitude).toFixed(4)}, ${Number(bus.longitude).toFixed(4)}`;
      }

      // Render driver route stops
      const stopList = document.getElementById('driver-stop-list');
      if (stopList) {
        if (!stops || stops.length === 0) {
          stopList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No stops defined for your assigned route.</p>';
        } else {
          stopList.innerHTML = stops.map(s => `
            <div class="timeline-item">
              <div class="timeline-node"></div>
              <div class="timeline-content">
                <span class="timeline-title">${escapeHtml(s.stop_name)}</span>
                <span class="timeline-time">${formatTime(s.arrival_time_1st_shift)}</span>
              </div>
            </div>
          `).join('');
        }
      }

      // Render notices
      const noticeList = document.getElementById('driver-notice-list');
      if (noticeList) {
        if (!notices || notices.length === 0) {
          noticeList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No bulletins broadcasted currently.</p>';
        } else {
          noticeList.innerHTML = notices.map(n => `
            <div class="notice-item">
              <div class="notice-header">
                <span class="notice-title">${escapeHtml(n.title)}</span>
                ${n.expiry_date ? `<span class="notice-expiry-badge">Expires: ${escapeHtml(n.expiry_date)}</span>` : ''}
              </div>
              <p class="notice-body">${escapeHtml(n.text)}</p>
            </div>
          `).join('');
        }
      }
    },

    async sendGpsPing(lat, lng) {
      try {
        const res = await fetch('/api/driver/dashboard');
        const data = await res.json();
        if (!data.bus || !data.bus.bus_id) {
          toast('Cannot broadcast GPS: No bus assigned to your driver account.', 'error');
          return;
        }

        const busId = data.bus.bus_id;
        const postRes = await fetch(`/api/track/${busId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude: lat, longitude: lng })
        });
        const postData = await postRes.json();
        if (postRes.ok && postData.success) {
          const coordsEl = document.getElementById('driver-coordinates');
          if (coordsEl) coordsEl.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
          toast('GPS coordinates broadcasted to students.', 'success', 2500);
        } else {
          toast(postData.error || 'Failed to update GPS.', 'error');
        }
      } catch (err) {
        console.error('GPS send failed:', err);
      }
    },

    toggleAutoGps(enabled) {
      const statusPill = document.getElementById('driver-live-status-pill');
      if (enabled) {
        if (statusPill) statusPill.style.display = 'inline-flex';
        toast('Automatic GPS transmission activated (every 10s).', 'info');

        // Initial ping immediately
        if (navigator.geolocation) {
          state.driverWatchId = navigator.geolocation.watchPosition(
            pos => {
              DriverPortal.sendGpsPing(pos.coords.latitude, pos.coords.longitude);
            },
            err => {
              console.warn('Geolocation error, falling back to simulated ping:', err);
              // Fallback simulated jitter around Acropolis Indore
              const simLat = 22.6850 + (Math.random() - 0.5) * 0.005;
              const simLng = 75.8100 + (Math.random() - 0.5) * 0.005;
              DriverPortal.sendGpsPing(simLat, simLng);
            },
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 8000 }
          );
        }
      } else {
        if (statusPill) statusPill.style.display = 'none';
        if (state.driverWatchId !== null) {
          navigator.geolocation.clearWatch(state.driverWatchId);
          state.driverWatchId = null;
        }
        toast('Automatic GPS broadcast disabled.', 'info');
      }
    }
  };

  // ------------------------------------------------------------
  // 7. ADMINISTRATOR PORTAL
  // ------------------------------------------------------------
  const AdminPortal = {
    async load() {
      const dateEl = document.getElementById('admin-hero-date');
      if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
        });
      }

      await Promise.all([
        AdminPortal.loadStats(),
        AdminPortal.loadRoutesDropdown(),
        AdminPortal.loadDriversDropdown(),
        AdminPortal.loadNotices(),
        AdminPortal.loadBuses(),
        AdminPortal.loadAuditLogs()
      ]);
    },

    async loadStats() {
      try {
        const res = await fetch('/api/admin/stats');
        const stats = await res.json();
        document.getElementById('admin-stat-routes').textContent = stats.routes || '0';
        document.getElementById('admin-stat-stops').textContent = stats.stops || '0';
        document.getElementById('admin-stat-buses').textContent = stats.buses || '0';
        document.getElementById('admin-stat-drivers').textContent = stats.drivers || '0';
        document.getElementById('admin-stat-students').textContent = stats.students || '0';
      } catch (e) {
        console.error('Failed to load admin stats:', e);
      }
    },

    async loadRoutesDropdown() {
      try {
        const res = await fetch('/api/routes');
        const routes = await res.json();
        state.allRoutes = routes;

        const busRouteSelect = document.getElementById('bus-route-select');
        const noticeRouteSelect = document.getElementById('notice-target-route');

        if (busRouteSelect) {
          busRouteSelect.innerHTML = routes.map(r =>
            `<option value="${r.route_id}">${escapeHtml(r.route_name)}</option>`
          ).join('');
        }
        if (noticeRouteSelect) {
          noticeRouteSelect.innerHTML = '<option value="">All Routes (Broadcast to Everyone)</option>' +
            routes.map(r => `<option value="${r.route_id}">${escapeHtml(r.route_name)}</option>`).join('');
        }
      } catch (e) {
        console.error(e);
      }
    },

    async loadDriversDropdown() {
      try {
        const res = await fetch('/api/drivers');
        const drivers = await res.json();
        state.allDrivers = drivers;

        const select = document.getElementById('bus-driver-select');
        if (select) {
          select.innerHTML = '<option value="">-- No driver assigned --</option>' +
            drivers.map(d => `<option value="${d.driver_id}">${escapeHtml(d.name)} (${escapeHtml(d.phone_number)})</option>`).join('');
        }
      } catch (e) {
        console.error(e);
      }
    },

    async loadNotices() {
      try {
        const res = await fetch('/api/notices?include_expired=1');
        const notices = await res.json();
        const container = document.getElementById('admin-notice-list');
        if (!container) return;

        if (!notices || notices.length === 0) {
          container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No bulletins published.</p>';
          return;
        }

        container.innerHTML = notices.map(n => `
          <div class="notice-item" style="display: flex; justify-content: space-between; align-items: center;">
            <div style="flex: 1; margin-right: 14px;">
              <div class="notice-header">
                <span class="notice-title">${escapeHtml(n.title)}</span>
                ${n.expiry_date ? `<span class="notice-expiry-badge">Expires: ${escapeHtml(n.expiry_date)}</span>` : ''}
              </div>
              <p class="notice-body">${escapeHtml(n.message)}</p>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="page-btn" onclick="AdminPortal.openEditNoticeModal(${n.notice_id}, '${escapeHtml(n.title)}', '${escapeHtml(n.message)}', '${escapeHtml(n.expiry_date || '')}', ${n.target_route_id || 'null'})">Edit</button>
              <button class="logout-btn" style="padding: 5px 10px;" onclick="AdminPortal.deleteNotice(${n.notice_id})">Delete</button>
            </div>
          </div>
        `).join('');
      } catch (e) {
        console.error(e);
      }
    },

    async handleAddNotice(e) {
      e.preventDefault();
      const title = document.getElementById('notice-title').value.trim();
      const message = document.getElementById('notice-text').value.trim();
      const expiry_date = document.getElementById('notice-expiry-date').value || null;
      const target_route_id = document.getElementById('notice-target-route').value || null;

      try {
        const res = await fetch('/api/notices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            message,
            expiry_date,
            target_route_id: target_route_id ? parseInt(target_route_id, 10) : null
          })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          toast('Notice published successfully!', 'success');
          document.getElementById('add-notice-form').reset();
          AdminPortal.loadNotices();
          AdminPortal.loadStats();
        } else {
          toast(data.error || 'Failed to publish notice.', 'error');
        }
      } catch (err) {
        toast('Network error creating notice.', 'error');
      }
    },

    openEditNoticeModal(id, title, message, expiry, targetRoute) {
      const modal = document.getElementById('form-modal');
      const titleEl = document.getElementById('form-modal-title');
      const bodyEl = document.getElementById('form-modal-body');
      const saveBtn = document.getElementById('form-modal-save');
      const cancelBtn = document.getElementById('form-modal-cancel');

      titleEl.textContent = 'Edit Notice';
      bodyEl.innerHTML = `
        <div class="field-group" style="margin-bottom: 12px;">
          <label>Title</label>
          <input type="text" id="edit-notice-title" value="${title}" required>
        </div>
        <div class="field-group" style="margin-bottom: 12px;">
          <label>Content</label>
          <textarea id="edit-notice-msg" rows="3" required>${message}</textarea>
        </div>
        <div class="field-group">
          <label>Expiry Date</label>
          <input type="date" id="edit-notice-expiry" value="${expiry}">
        </div>
      `;

      modal.style.display = 'flex';
      cancelBtn.onclick = () => { modal.style.display = 'none'; };

      saveBtn.onclick = async () => {
        const newTitle = document.getElementById('edit-notice-title').value.trim();
        const newMsg = document.getElementById('edit-notice-msg').value.trim();
        const newExp = document.getElementById('edit-notice-expiry').value || null;

        try {
          const res = await fetch(`/api/notices/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTitle, message: newMsg, expiry_date: newExp, target_route_id: targetRoute })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            toast('Notice updated successfully!', 'success');
            modal.style.display = 'none';
            AdminPortal.loadNotices();
          } else {
            toast(data.error || 'Update failed.', 'error');
          }
        } catch (e) {
          toast('Network error.', 'error');
        }
      };
    },

    async deleteNotice(id) {
      confirmModal('Delete Notice', 'Permanently delete this bulletin?', async () => {
        try {
          const res = await fetch(`/api/notices/${id}`, { method: 'DELETE' });
          const data = await res.json();
          if (res.ok && data.success) {
            toast('Notice deleted.', 'info');
            AdminPortal.loadNotices();
            AdminPortal.loadStats();
          } else {
            toast(data.error || 'Delete failed.', 'error');
          }
        } catch (e) {
          toast('Network error.', 'error');
        }
      });
    },

    async loadBuses() {
      try {
        const res = await fetch('/api/buses');
        const buses = await res.json();
        const container = document.getElementById('admin-bus-list');
        if (!container) return;

        if (!buses || buses.length === 0) {
          container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No buses registered.</p>';
          return;
        }

        container.innerHTML = buses.slice(0, 10).map(b => `
          <div class="bus-item" role="link" tabindex="0" onclick="location.hash='#/buses?focus=${b.bus_id}'">
            <div class="bus-meta">
              <h4>${escapeHtml(b.bus_number)}</h4>
              <p>${escapeHtml(b.route_name || 'Unassigned')} · Driver: ${escapeHtml(b.driver_name || 'None')} (${escapeHtml(b.driver_phone || 'No phone')})</p>
            </div>
            <div class="bus-actions">
              <button class="logout-btn" style="padding: 5px 10px;" onclick="event.stopPropagation(); AdminPortal.deleteBus(${b.bus_id}, '${escapeHtml(b.bus_number)}')">Delete</button>
            </div>
          </div>
        `).join('');
      } catch (e) {
        console.error(e);
      }
    },

    async handleAddBus(e) {
      e.preventDefault();
      const bus_number = document.getElementById('bus-number').value.trim();
      const capacity = parseInt(document.getElementById('bus-capacity').value, 10);
      const driver_id = document.getElementById('bus-driver-select').value || null;
      const route_id = parseInt(document.getElementById('bus-route-select').value, 10);
      const departure = document.getElementById('bus-departure').value + ':00';
      const arrival = document.getElementById('bus-arrival').value + ':00';

      try {
        const res = await fetch('/api/buses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bus_number,
            capacity,
            driver_id: driver_id ? parseInt(driver_id, 10) : null,
            route_id,
            departure,
            arrival
          })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          toast(`Bus ${bus_number} registered!`, 'success');
          document.getElementById('add-bus-form').reset();
          AdminPortal.loadBuses();
          AdminPortal.loadStats();
        } else {
          toast(data.error || 'Failed to add bus.', 'error');
        }
      } catch (err) {
        toast('Network error adding bus.', 'error');
      }
    },

    deleteBus(id, busNum) {
      confirmModal('Deregister Bus', `Are you sure you want to delete ${busNum}?`, async () => {
        try {
          const res = await fetch(`/api/buses/${id}`, { method: 'DELETE' });
          const data = await res.json();
          if (res.ok && data.success) {
            toast(`Bus ${busNum} deregistered.`, 'info');
            AdminPortal.loadBuses();
            AdminPortal.loadStats();
          } else {
            toast(data.error || 'Failed to delete bus.', 'error');
          }
        } catch (e) {
          toast('Network error.', 'error');
        }
      });
    },

    async loadAuditLogs() {
      const tbody = document.getElementById('admin-audit-logs');
      if (!tbody) return;

      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Loading logs...</td></tr>';

      try {
        const statusParam = state.auditStatus ? `&status=${encodeURIComponent(state.auditStatus)}` : '';
        const res = await fetch(`/api/admin/logs?page=${state.auditPage}&per_page=25${statusParam}`);
        const data = await res.json();

        state.auditTotalPages = data.pages || 1;
        document.getElementById('audit-page-info').textContent = `Page ${data.page} of ${data.pages || 1} (${data.total} entries)`;
        document.getElementById('audit-prev-btn').disabled = data.page <= 1;
        document.getElementById('audit-next-btn').disabled = data.page >= data.pages;

        if (!data.logs || data.logs.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No log records found.</td></tr>';
          return;
        }

        tbody.innerHTML = data.logs.map(log => {
          const isSuccess = log.status && log.status.toLowerCase().includes('success');
          return `
            <tr>
              <td>${escapeHtml(log.login_time)}</td>
              <td><strong>${escapeHtml(log.email)}</strong></td>
              <td><span class="badge-${escapeHtml(log.role)} brand-badge">${escapeHtml(log.role)}</span></td>
              <td><code>${escapeHtml(log.ip_address || '—')}</code></td>
              <td>
                <span class="status-badge ${isSuccess ? 'status-success' : 'status-failed'}">
                  ${escapeHtml(log.status)}
                </span>
              </td>
            </tr>
          `;
        }).join('');
      } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" style="color: var(--color-danger); text-align: center;">Failed to load audit logs.</td></tr>';
      }
    }
  };

  // ------------------------------------------------------------
  // 8. DEDICATED BUSES PAGE (#/buses)
  // ------------------------------------------------------------
  const BusesPage = {
    async render(focusBusId) {
      document.getElementById('buses-page-view').style.display = 'flex';
      const container = document.getElementById('buses-grid-container');
      container.innerHTML = '<div class="skeleton skeleton-card" style="grid-column: 1 / -1;"></div>';

      try {
        const res = await fetch('/api/buses');
        const buses = await res.json();
        state.allBuses = buses;

        BusesPage.renderGrid(buses, focusBusId);
      } catch (err) {
        container.innerHTML = '<p style="color: var(--color-danger);">Failed to load fleet data.</p>';
      }
    },

    renderGrid(buses, focusBusId) {
      const container = document.getElementById('buses-grid-container');
      const filterInput = document.getElementById('buses-filter-input');
      const query = filterInput ? filterInput.value.toLowerCase().trim() : '';

      let filtered = buses.filter(b => {
        if (!query) return true;
        const num = (b.bus_number || '').toLowerCase();
        const drv = (b.driver_name || '').toLowerCase();
        const rt = (b.route_name || '').toLowerCase();
        return num.includes(query) || drv.includes(query) || rt.includes(query);
      });

      // Pin student's route bus first if applicable
      if (state.currentUser && state.currentUser.role === 'student') {
        // Look up assigned route if present
        filtered.sort((a, b) => {
          if (focusBusId && String(a.bus_id) === String(focusBusId)) return -1;
          if (focusBusId && String(b.bus_id) === String(focusBusId)) return 1;
          return 0;
        });
      }

      if (filtered.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); grid-column: 1 / -1;">No buses matching your query.</p>';
        return;
      }

      const isAdmin = state.currentUser && state.currentUser.role === 'admin';

      container.innerHTML = filtered.map(b => {
        const isFocused = focusBusId && String(b.bus_id) === String(focusBusId);
        return `
          <div id="bus-card-${b.bus_id}" class="bus-card glass ${isFocused ? 'pinned' : ''}" style="${isFocused ? 'border: 2px solid var(--color-secondary);' : ''}">
            <div>
              <div class="bus-card-top">
                <span class="bus-card-num">${escapeHtml(b.bus_number)}</span>
                <span class="brand-badge badge-student">Cap: ${escapeHtml(b.capacity)}</span>
              </div>

              <div class="bus-detail-row">
                <span class="bus-detail-label">Route:</span>
                <strong>${escapeHtml(b.route_name || 'Unassigned Line')}</strong>
              </div>

              <div class="bus-detail-row">
                <span class="bus-detail-label">Driver:</span>
                <span>${escapeHtml(b.driver_name || 'Pending assignment')}</span>
              </div>

              <div class="bus-detail-row">
                <span class="bus-detail-label">Contact:</span>
                ${b.driver_phone ? `<a href="tel:${escapeHtml(b.driver_phone)}" class="tel-link">📞 ${escapeHtml(b.driver_phone)}</a>` : '<span style="color: var(--text-muted);">No phone</span>'}
              </div>

              <div class="bus-detail-row">
                <span class="bus-detail-label">Shifts:</span>
                <span>1st: ${formatTime(b.arrival_time_1st_shift)} · 2nd: ${formatTime(b.arrival_time_2nd_shift)}</span>
              </div>
            </div>

            <!-- In-Card Live Leaflet Map Container -->
            <div id="map-wrap-${b.bus_id}" class="map-container-box" style="display: ${isFocused ? 'block' : 'none'};">
              <div id="leaflet-map-${b.bus_id}" style="width: 100%; height: 100%;"></div>
            </div>
            <div id="map-meta-${b.bus_id}" class="map-status-bar" style="display: ${isFocused ? 'flex' : 'none'};">
              <span id="map-coords-${b.bus_id}">Lat: ${Number(b.latitude || 22.7196).toFixed(4)}, Lng: ${Number(b.longitude || 75.8577).toFixed(4)}</span>
              <span id="map-time-${b.bus_id}">Updated: ${b.last_updated ? escapeHtml(b.last_updated) : 'Live'}</span>
            </div>

            <div class="bus-card-footer">
              <button class="primary-btn" style="padding: 7px 14px; font-size: 0.85rem;" onclick="BusesPage.toggleMap(${b.bus_id}, ${b.latitude || 22.7196}, ${b.longitude || 75.8577})">
                <span>📍 Track on Map</span>
              </button>

              ${isAdmin ? `
                <div style="display: flex; gap: 8px;">
                  <button class="page-btn" onclick="BusesPage.openEditModal(${b.bus_id})">Edit</button>
                  <button class="logout-btn" style="padding: 5px 10px;" onclick="AdminPortal.deleteBus(${b.bus_id}, '${escapeHtml(b.bus_number)}')">Delete</button>
                </div>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');

      if (focusBusId) {
        const card = document.getElementById(`bus-card-${focusBusId}`);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const target = buses.find(x => String(x.bus_id) === String(focusBusId));
          if (target) {
            BusesPage.toggleMap(target.bus_id, target.latitude || 22.7196, target.longitude || 75.8577);
          }
        }
      }
    },

    toggleMap(busId, lat, lng) {
      const wrap = document.getElementById(`map-wrap-${busId}`);
      const meta = document.getElementById(`map-meta-${busId}`);
      if (!wrap) return;

      if (state.activeMapBusId === busId && wrap.style.display === 'block') {
        wrap.style.display = 'none';
        if (meta) meta.style.display = 'none';
        MapManager.clear();
        return;
      }

      // Hide any other active map
      if (state.activeMapBusId && state.activeMapBusId !== busId) {
        const prevWrap = document.getElementById(`map-wrap-${state.activeMapBusId}`);
        const prevMeta = document.getElementById(`map-meta-${state.activeMapBusId}`);
        if (prevWrap) prevWrap.style.display = 'none';
        if (prevMeta) prevMeta.style.display = 'none';
        MapManager.clear();
      }

      wrap.style.display = 'block';
      if (meta) meta.style.display = 'flex';
      state.activeMapBusId = busId;

      setTimeout(() => {
        MapManager.init(`leaflet-map-${busId}`, lat, lng, busId);
      }, 100);
    },

    openEditModal(busId) {
      const bus = state.allBuses.find(x => x.bus_id === busId);
      if (!bus) return;

      const modal = document.getElementById('form-modal');
      const titleEl = document.getElementById('form-modal-title');
      const bodyEl = document.getElementById('form-modal-body');
      const saveBtn = document.getElementById('form-modal-save');
      const cancelBtn = document.getElementById('form-modal-cancel');

      titleEl.textContent = `Edit Bus ${bus.bus_number}`;
      bodyEl.innerHTML = `
        <div class="field-group" style="margin-bottom: 12px;">
          <label>Bus Number</label>
          <input type="text" id="edit-bus-num" value="${escapeHtml(bus.bus_number)}" required>
        </div>
        <div class="field-group" style="margin-bottom: 12px;">
          <label>Capacity</label>
          <input type="number" id="edit-bus-cap" value="${bus.capacity || 52}" required>
        </div>
        <div class="field-group" style="margin-bottom: 12px;">
          <label>Assign Driver</label>
          <select id="edit-bus-driver">
            <option value="">-- None --</option>
            ${(state.allDrivers || []).map(d => `
              <option value="${d.driver_id}" ${d.driver_id === bus.driver_id ? 'selected' : ''}>${escapeHtml(d.name)}</option>
            `).join('')}
          </select>
        </div>
        <div class="field-group" style="margin-bottom: 12px;">
          <label>Assign Route</label>
          <select id="edit-bus-route">
            ${(state.allRoutes || []).map(r => `
              <option value="${r.route_id}" ${r.route_id === bus.route_id ? 'selected' : ''}>${escapeHtml(r.route_name)}</option>
            `).join('')}
          </select>
        </div>
      `;

      modal.style.display = 'flex';
      cancelBtn.onclick = () => { modal.style.display = 'none'; };

      saveBtn.onclick = async () => {
        const num = document.getElementById('edit-bus-num').value.trim();
        const cap = parseInt(document.getElementById('edit-bus-cap').value, 10);
        const drv = document.getElementById('edit-bus-driver').value || null;
        const rt = document.getElementById('edit-bus-route').value || null;

        try {
          const res = await fetch(`/api/buses/${busId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bus_number: num,
              capacity: cap,
              driver_id: drv ? parseInt(drv, 10) : null,
              route_id: rt ? parseInt(rt, 10) : null
            })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            toast('Bus details updated successfully!', 'success');
            modal.style.display = 'none';
            BusesPage.render(busId);
          } else {
            toast(data.error || 'Update failed.', 'error');
          }
        } catch (e) {
          toast('Network error.', 'error');
        }
      };
    }
  };

  // ------------------------------------------------------------
  // 9. DEDICATED STOPS & ROUTES PAGE (#/stops)
  // ------------------------------------------------------------
  const StopsPage = {
    async render(targetRouteId, targetStopName) {
      document.getElementById('stops-page-view').style.display = 'flex';
      const container = document.getElementById('stops-accordion-container');
      const adminActions = document.getElementById('admin-route-actions');

      if (adminActions) {
        adminActions.style.display = (state.currentUser && state.currentUser.role === 'admin') ? 'flex' : 'none';
      }

      container.innerHTML = '<div class="skeleton skeleton-card"></div>';

      try {
        const [routesRes, busesRes] = await Promise.all([
          fetch('/api/routes'),
          fetch('/api/buses')
        ]);
        const routes = await routesRes.json();
        const buses = await busesRes.json();
        state.allRoutes = routes;
        state.allBuses = buses;

        StopsPage.renderAccordion(routes, buses, targetRouteId, targetStopName);
      } catch (err) {
        container.innerHTML = '<p style="color: var(--color-danger);">Failed to load stops and routes.</p>';
      }
    },

    renderAccordion(routes, buses, targetRouteId, targetStopName) {
      const container = document.getElementById('stops-accordion-container');
      const filterInput = document.getElementById('stops-filter-input');
      const query = filterInput ? filterInput.value.toLowerCase().trim() : '';

      const isAdmin = state.currentUser && state.currentUser.role === 'admin';

      container.innerHTML = routes.map(r => {
        const isTarget = targetRouteId && String(r.route_id) === String(targetRouteId);
        const routeBuses = buses.filter(b => b.route_id === r.route_id);

        return `
          <div id="route-card-${r.route_id}" class="route-card glass">
            <div class="route-card-header" onclick="StopsPage.toggleRoute(${r.route_id})">
              <div class="route-title-wrap">
                <span style="font-size: 1.2rem;">📍</span>
                <div>
                  <h3 style="font-size: 1.15rem; font-weight: 700; color: #fff;">${escapeHtml(r.route_name)}</h3>
                  <p style="font-size: 0.85rem; color: var(--text-muted);">${escapeHtml(r.start_point)} → ${escapeHtml(r.end_point)} · ${r.stop_count || 0} Stops</p>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 12px;">
                <span class="chip" style="pointer-events: none;">${routeBuses.length} Buses</span>
                <span id="route-arrow-${r.route_id}" style="transition: transform 0.2s;">▼</span>
              </div>
            </div>

            <div id="route-body-${r.route_id}" class="route-card-body" style="display: ${isTarget ? 'block' : 'none'};">
              <!-- Route Buses Chips -->
              <div class="route-buses-serving">
                <span style="font-size: 0.85rem; color: var(--text-muted);">Serving fleet:</span>
                ${routeBuses.length > 0 ? routeBuses.map(b => `
                  <span class="chip" onclick="location.hash='#/buses?focus=${b.bus_id}'">
                    🚌 ${escapeHtml(b.bus_number)} (${escapeHtml(b.driver_name || 'Driver')})
                  </span>
                `).join('') : '<span style="font-size: 0.8rem; color: var(--text-muted);">No buses assigned</span>'}
              </div>

              ${isAdmin ? `
                <div style="margin-bottom: 16px; display: flex; gap: 8px;">
                  <button class="page-btn" onclick="StopsPage.openAddStopModal(${r.route_id})">+ Add Stop to Route</button>
                  <button class="logout-btn" style="padding: 6px 12px;" onclick="StopsPage.deleteRoute(${r.route_id})">Delete Route</button>
                </div>
              ` : ''}

              <!-- Dynamic Stop Timeline -->
              <div id="route-timeline-${r.route_id}" class="timeline">
                <p style="color: var(--text-muted); font-size: 0.85rem;">Click header to load stop timeline...</p>
              </div>
            </div>
          </div>
        `;
      }).join('');

      // Auto-expand target route if specified
      if (targetRouteId) {
        StopsPage.loadRouteStops(targetRouteId, targetStopName);
        const card = document.getElementById(`route-card-${targetRouteId}`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },

    toggleRoute(routeId) {
      const body = document.getElementById(`route-body-${routeId}`);
      const arrow = document.getElementById(`route-arrow-${routeId}`);
      if (!body) return;

      const isHidden = body.style.display === 'none';
      body.style.display = isHidden ? 'block' : 'none';
      if (arrow) arrow.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';

      if (isHidden) {
        StopsPage.loadRouteStops(routeId);
      }
    },

    async loadRouteStops(routeId, targetStopName) {
      const container = document.getElementById(`route-timeline-${routeId}`);
      if (!container) return;

      try {
        const res = await fetch(`/api/routes/${routeId}/stops`);
        const stops = await res.json();
        const isAdmin = state.currentUser && state.currentUser.role === 'admin';

        if (!stops || stops.length === 0) {
          container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No stops mapped for this route.</p>';
          return;
        }

        container.innerHTML = stops.map(s => {
          const isHighlighted = targetStopName && s.stop_name.toLowerCase().includes(targetStopName.toLowerCase());
          return `
            <div id="stop-item-${s.stop_id}" class="timeline-item ${isHighlighted ? 'stop-highlight' : ''}">
              <div class="timeline-node"></div>
              <div class="timeline-content">
                <div>
                  <span class="timeline-title">${escapeHtml(s.stop_name)}</span>
                  <div style="font-size: 0.78rem; color: var(--text-muted);">
                    1st Shift: ${formatTime(s.arrival_time_1st_shift)} · 2nd Shift: ${formatTime(s.arrival_time_2nd_shift)}
                  </div>
                </div>
                ${isAdmin ? `
                  <div style="display: flex; gap: 6px;">
                    <button class="page-btn" style="padding: 3px 8px; font-size: 0.75rem;" onclick="StopsPage.editStop(${s.stop_id}, '${escapeHtml(s.stop_name)}')">Rename</button>
                    <button class="logout-btn" style="padding: 3px 8px; font-size: 0.75rem;" onclick="StopsPage.deleteStop(${s.stop_id})">Delete</button>
                  </div>
                ` : ''}
              </div>
            </div>
          `;
        }).join('');

        if (targetStopName) {
          const matched = stops.find(x => x.stop_name.toLowerCase().includes(targetStopName.toLowerCase()));
          if (matched) {
            const el = document.getElementById(`stop-item-${matched.stop_id}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      } catch (e) {
        container.innerHTML = '<p style="color: var(--color-danger);">Failed to load stops.</p>';
      }
    },

    openAddStopModal(routeId) {
      const modal = document.getElementById('form-modal');
      const titleEl = document.getElementById('form-modal-title');
      const bodyEl = document.getElementById('form-modal-body');
      const saveBtn = document.getElementById('form-modal-save');
      const cancelBtn = document.getElementById('form-modal-cancel');

      titleEl.textContent = 'Add Stop to Route';
      bodyEl.innerHTML = `
        <div class="field-group" style="margin-bottom: 12px;">
          <label>Stop Name</label>
          <input type="text" id="new-stop-name" placeholder="e.g. Navlakha Square" required>
        </div>
        <div class="field-group" style="margin-bottom: 12px;">
          <label>Stop Sequence / Order</label>
          <input type="number" id="new-stop-order" value="99" min="1" required>
        </div>
      `;

      modal.style.display = 'flex';
      cancelBtn.onclick = () => { modal.style.display = 'none'; };

      saveBtn.onclick = async () => {
        const name = document.getElementById('new-stop-name').value.trim();
        const order = parseInt(document.getElementById('new-stop-order').value, 10);
        if (!name) return;

        try {
          const res = await fetch('/api/stops', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stop_name: name, route_id: routeId, stop_order: order })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            toast('Stop added to route!', 'success');
            modal.style.display = 'none';
            StopsPage.loadRouteStops(routeId);
          } else {
            toast(data.error || 'Failed to add stop.', 'error');
          }
        } catch (e) {
          toast('Network error.', 'error');
        }
      };
    },

    editStop(stopId, currentName) {
      const modal = document.getElementById('form-modal');
      const titleEl = document.getElementById('form-modal-title');
      const bodyEl = document.getElementById('form-modal-body');
      const saveBtn = document.getElementById('form-modal-save');
      const cancelBtn = document.getElementById('form-modal-cancel');

      titleEl.textContent = 'Rename Transit Stop';
      bodyEl.innerHTML = `
        <div class="field-group">
          <label>Stop Name</label>
          <input type="text" id="rename-stop-input" value="${currentName}" required>
        </div>
      `;

      modal.style.display = 'flex';
      cancelBtn.onclick = () => { modal.style.display = 'none'; };

      saveBtn.onclick = async () => {
        const newName = document.getElementById('rename-stop-input').value.trim();
        if (!newName) return;
        try {
          const res = await fetch(`/api/stops/${stopId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stop_name: newName })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            toast('Stop renamed.', 'success');
            modal.style.display = 'none';
            StopsPage.render();
          } else {
            toast(data.error || 'Rename failed.', 'error');
          }
        } catch (e) {
          toast('Network error.', 'error');
        }
      };
    },

    deleteStop(stopId) {
      confirmModal('Delete Stop', 'Remove this stop from all assigned routes?', async () => {
        try {
          const res = await fetch(`/api/stops/${stopId}`, { method: 'DELETE' });
          const data = await res.json();
          if (res.ok && data.success) {
            toast('Stop deleted.', 'info');
            StopsPage.render();
          } else {
            toast(data.error || 'Delete failed.', 'error');
          }
        } catch (e) {
          toast('Network error.', 'error');
        }
      });
    },

    deleteRoute(routeId) {
      confirmModal('Delete Route', 'Permanently delete this transit route and all stop associations?', async () => {
        try {
          const res = await fetch(`/api/routes/${routeId}`, { method: 'DELETE' });
          const data = await res.json();
          if (res.ok && data.success) {
            toast('Route deleted.', 'info');
            StopsPage.render();
          } else {
            toast(data.error || 'Delete failed.', 'error');
          }
        } catch (e) {
          toast('Network error.', 'error');
        }
      });
    }
  };

  // ------------------------------------------------------------
  // 10. ADMIN DRIVERS & STUDENTS MANAGEMENT PAGES
  // ------------------------------------------------------------
  const AdminDriversPage = {
    async render() {
      document.getElementById('admin-drivers-view').style.display = 'flex';
      const tbody = document.getElementById('admin-drivers-tbody');
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Loading drivers...</td></tr>';

      try {
        const res = await fetch('/api/drivers');
        const drivers = await res.json();
        state.allDrivers = drivers;

        if (!drivers || drivers.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No drivers registered.</td></tr>';
          return;
        }

        tbody.innerHTML = drivers.map(d => `
          <tr>
            <td>#${d.driver_id}</td>
            <td><strong>${escapeHtml(d.name)}</strong></td>
            <td><a href="tel:${escapeHtml(d.phone_number)}" class="tel-link">${escapeHtml(d.phone_number)}</a></td>
            <td>${escapeHtml(d.experience_years || 0)} years</td>
            <td>${escapeHtml(d.email || '—')}</td>
            <td>
              <button class="page-btn" onclick="AdminDriversPage.openEditModal(${d.driver_id})">Edit</button>
              <button class="logout-btn" style="padding: 4px 8px;" onclick="AdminDriversPage.deleteDriver(${d.driver_id}, '${escapeHtml(d.name)}')">Delete</button>
            </td>
          </tr>
        `).join('');
      } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" style="color: var(--color-danger); text-align: center;">Failed to load drivers.</td></tr>';
      }
    },

    openAddModal() {
      const modal = document.getElementById('form-modal');
      const titleEl = document.getElementById('form-modal-title');
      const bodyEl = document.getElementById('form-modal-body');
      const saveBtn = document.getElementById('form-modal-save');
      const cancelBtn = document.getElementById('form-modal-cancel');

      titleEl.textContent = 'Add New Driver';
      bodyEl.innerHTML = `
        <div class="field-group" style="margin-bottom: 12px;">
          <label>Full Name</label>
          <input type="text" id="add-drv-name" placeholder="Shri Name" required>
        </div>
        <div class="field-group" style="margin-bottom: 12px;">
          <label>Phone Number (10 digits)</label>
          <input type="tel" id="add-drv-phone" placeholder="9893000001" required maxlength="10">
        </div>
        <div class="field-group" style="margin-bottom: 12px;">
          <label>Experience (Years)</label>
          <input type="number" id="add-drv-exp" value="5" min="0">
        </div>
        <div class="field-group" style="margin-bottom: 12px;">
          <label>Email (Optional for portal login)</label>
          <input type="email" id="add-drv-email" placeholder="driver@routeiq.edu">
        </div>
        <div class="field-group">
          <label>Portal Password (Optional, min 8 chars)</label>
          <input type="password" id="add-drv-password" placeholder="••••••••">
        </div>
      `;

      modal.style.display = 'flex';
      cancelBtn.onclick = () => { modal.style.display = 'none'; };

      saveBtn.onclick = async () => {
        const name = document.getElementById('add-drv-name').value.trim();
        const phone = document.getElementById('add-drv-phone').value.trim();
        const exp = parseInt(document.getElementById('add-drv-exp').value, 10);
        const email = document.getElementById('add-drv-email').value.trim();
        const password = document.getElementById('add-drv-password').value;

        if (!/^\d{10}$/.test(phone)) {
          toast('Phone number must be exactly 10 digits.', 'error');
          return;
        }

        try {
          const res = await fetch('/api/drivers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone_number: phone, experience_years: exp, email, password })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            toast('Driver added successfully!', 'success');
            modal.style.display = 'none';
            AdminDriversPage.render();
          } else {
            toast(data.error || 'Failed to add driver.', 'error');
          }
        } catch (e) {
          toast('Network error.', 'error');
        }
      };
    },

    openEditModal(id) {
      const d = state.allDrivers.find(x => x.driver_id === id);
      if (!d) return;

      const modal = document.getElementById('form-modal');
      const titleEl = document.getElementById('form-modal-title');
      const bodyEl = document.getElementById('form-modal-body');
      const saveBtn = document.getElementById('form-modal-save');
      const cancelBtn = document.getElementById('form-modal-cancel');

      titleEl.textContent = `Edit Driver: ${d.name}`;
      bodyEl.innerHTML = `
        <div class="field-group" style="margin-bottom: 12px;">
          <label>Full Name</label>
          <input type="text" id="edit-drv-name" value="${escapeHtml(d.name)}" required>
        </div>
        <div class="field-group" style="margin-bottom: 12px;">
          <label>Phone Number (10 digits)</label>
          <input type="tel" id="edit-drv-phone" value="${escapeHtml(d.phone_number)}" required maxlength="10">
        </div>
        <div class="field-group" style="margin-bottom: 12px;">
          <label>Experience (Years)</label>
          <input type="number" id="edit-drv-exp" value="${d.experience_years || 0}" min="0">
        </div>
        <div class="field-group">
          <label>Email</label>
          <input type="email" id="edit-drv-email" value="${escapeHtml(d.email || '')}">
        </div>
      `;

      modal.style.display = 'flex';
      cancelBtn.onclick = () => { modal.style.display = 'none'; };

      saveBtn.onclick = async () => {
        const name = document.getElementById('edit-drv-name').value.trim();
        const phone = document.getElementById('edit-drv-phone').value.trim();
        const exp = parseInt(document.getElementById('edit-drv-exp').value, 10);
        const email = document.getElementById('edit-drv-email').value.trim();

        if (!/^\d{10}$/.test(phone)) {
          toast('Phone must be 10 digits.', 'error');
          return;
        }

        try {
          const res = await fetch(`/api/drivers/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone_number: phone, experience_years: exp, email })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            toast('Driver updated!', 'success');
            modal.style.display = 'none';
            AdminDriversPage.render();
          } else {
            toast(data.error || 'Failed to update driver.', 'error');
          }
        } catch (e) {
          toast('Network error.', 'error');
        }
      };
    },

    deleteDriver(id, name) {
      confirmModal('Delete Driver', `Are you sure you want to remove driver ${name}?`, async () => {
        try {
          const res = await fetch(`/api/drivers/${id}`, { method: 'DELETE' });
          const data = await res.json();
          if (res.ok && data.success) {
            toast('Driver removed.', 'info');
            AdminDriversPage.render();
          } else {
            toast(data.error || 'Delete failed.', 'error');
          }
        } catch (e) {
          toast('Network error.', 'error');
        }
      });
    }
  };

  const AdminStudentsPage = {
    async render() {
      document.getElementById('admin-students-view').style.display = 'flex';
      const tbody = document.getElementById('admin-students-tbody');
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Loading students...</td></tr>';

      try {
        const res = await fetch('/api/students');
        const students = await res.json();

        if (!students || students.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No students registered.</td></tr>';
          return;
        }

        tbody.innerHTML = students.map(s => `
          <tr>
            <td>#${s.student_id}</td>
            <td><strong>${escapeHtml(s.name)}</strong></td>
            <td>${escapeHtml(s.email)}</td>
            <td>Route ID: ${s.route_id || '—'}</td>
            <td>
              <button class="logout-btn" style="padding: 4px 8px;" onclick="AdminStudentsPage.deleteStudent(${s.student_id}, '${escapeHtml(s.name)}')">Delete</button>
            </td>
          </tr>
        `).join('');
      } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" style="color: var(--color-danger); text-align: center;">Failed to load students.</td></tr>';
      }
    },

    deleteStudent(id, name) {
      confirmModal('Delete Student', `Permanently delete student account for ${name}?`, async () => {
        try {
          const res = await fetch(`/api/students/${id}`, { method: 'DELETE' });
          const data = await res.json();
          if (res.ok && data.success) {
            toast('Student deleted.', 'info');
            AdminStudentsPage.render();
          } else {
            toast(data.error || 'Delete failed.', 'error');
          }
        } catch (e) {
          toast('Network error.', 'error');
        }
      });
    }
  };

  // ------------------------------------------------------------
  // 11. LEAFLET MAP MANAGER
  // ------------------------------------------------------------
  const MapManager = {
    init(elementId, initialLat, initialLng, busId) {
      MapManager.clear();

      const el = document.getElementById(elementId);
      if (!el || typeof L === 'undefined') return;

      const map = L.map(elementId, {
        zoomControl: true,
        attributionControl: false
      }).setView([initialLat, initialLng], 14);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      }).addTo(map);

      // Custom pulsing bus icon
      const busIcon = L.divIcon({
        className: 'custom-bus-marker',
        html: `
          <div style="background: var(--color-primary); color: #fff; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 15px rgba(59,130,246,0.8); border: 2px solid #fff;">
            🚌
          </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 17]
      });

      const marker = L.marker([initialLat, initialLng], { icon: busIcon }).addTo(map);
      marker.bindPopup(`<strong>Bus #${busId}</strong><br>Real-time transit tracker`).openPopup();

      state.activeMapInstance = map;

      // Auto-refresh coordinates every 10 seconds (Section 3.B)
      state.mapRefreshTimer = setInterval(async () => {
        try {
          const res = await fetch(`/api/track/${busId}`);
          if (!res.ok) return;
          const busData = await res.json();
          if (busData && busData.latitude && busData.longitude) {
            const newLat = parseFloat(busData.latitude);
            const newLng = parseFloat(busData.longitude);
            marker.setLatLng([newLat, newLng]);
            map.panTo([newLat, newLng]);

            const coordsEl = document.getElementById(`map-coords-${busId}`);
            const timeEl = document.getElementById(`map-time-${busId}`);
            if (coordsEl) coordsEl.textContent = `Lat: ${newLat.toFixed(4)}, Lng: ${newLng.toFixed(4)}`;
            if (timeEl) timeEl.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
          }
        } catch (e) {
          console.warn('Map refresh ping error:', e);
        }
      }, 10000);
    },

    clear() {
      if (state.mapRefreshTimer) {
        clearInterval(state.mapRefreshTimer);
        state.mapRefreshTimer = null;
      }
      if (state.activeMapInstance) {
        state.activeMapInstance.remove();
        state.activeMapInstance = null;
      }
      state.activeMapBusId = null;
    }
  };

  // Expose global helpers to window for inline onclicks
  window.Router = Router;
  window.BusesPage = BusesPage;
  window.StopsPage = StopsPage;
  window.AdminPortal = AdminPortal;
  window.AdminDriversPage = AdminDriversPage;
  window.AdminStudentsPage = AdminStudentsPage;
  window.toggleMobileNav = function (navId) {
    const nav = document.getElementById(navId);
    if (nav) nav.classList.toggle('mobile-open');
  };

  // ------------------------------------------------------------
  // 12. EVENT LISTENERS INITIALIZATION
  // ------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    // Role selection buttons
    const btnStudent = document.getElementById('select-student-btn');
    const btnDriver = document.getElementById('select-driver-btn');
    const btnAdmin = document.getElementById('select-admin-btn');
    const btnBackToRoles = document.getElementById('back-to-roles-btn');
    const btnRegBackToLogin = document.getElementById('reg-back-to-login-btn');
    const btnShowRegister = document.getElementById('show-register-btn');
    const btnShowLogin = document.getElementById('show-login-btn');

    if (btnStudent) btnStudent.onclick = () => showSignIn('student');
    if (btnDriver) btnDriver.onclick = () => showSignIn('driver');
    if (btnAdmin) btnAdmin.onclick = () => showSignIn('admin');
    if (btnBackToRoles) btnBackToRoles.onclick = showRoleSelection;
    if (btnRegBackToLogin) btnRegBackToLogin.onclick = () => showSignIn('student');

    if (btnShowRegister) {
      btnShowRegister.onclick = () => {
        document.getElementById('signin-view').style.display = 'none';
        document.getElementById('register-view').style.display = 'block';
        loadRoutesForRegistration();
      };
    }
    if (btnShowLogin) {
      btnShowLogin.onclick = () => showSignIn('student');
    }

    // Forms
    const loginForm = document.getElementById('login-form');
    if (loginForm) loginForm.onsubmit = handleLogin;

    const registerForm = document.getElementById('register-form');
    if (registerForm) registerForm.onsubmit = handleRegister;

    // Logouts
    ['student-logout-btn', 'driver-logout-btn', 'admin-logout-btn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.onclick = handleLogout;
    });

    // Student Search
    const searchBtn = document.getElementById('student-search-btn');
    const searchInput = document.getElementById('student-search-input');
    if (searchBtn) searchBtn.onclick = () => StudentPortal.handleSearch();
    if (searchInput) {
      searchInput.onkeydown = e => {
        if (e.key === 'Enter') StudentPortal.handleSearch();
      };
    }

    // Student Save Route
    const saveRouteBtn = document.getElementById('student-save-route-btn');
    if (saveRouteBtn) saveRouteBtn.onclick = () => StudentPortal.handleSaveRoute();

    // Driver GPS controls
    const gpsToggle = document.getElementById('driver-auto-gps-toggle');
    if (gpsToggle) {
      gpsToggle.onchange = e => DriverPortal.toggleAutoGps(e.target.checked);
    }
    const updateGpsBtn = document.getElementById('update-gps-btn');
    if (updateGpsBtn) {
      updateGpsBtn.onclick = () => {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            pos => DriverPortal.sendGpsPing(pos.coords.latitude, pos.coords.longitude),
            () => {
              const simLat = 22.6850 + (Math.random() - 0.5) * 0.005;
              const simLng = 75.8100 + (Math.random() - 0.5) * 0.005;
              DriverPortal.sendGpsPing(simLat, simLng);
            }
          );
        }
      };
    }

    // Admin forms
    const addNoticeForm = document.getElementById('add-notice-form');
    if (addNoticeForm) addNoticeForm.onsubmit = e => AdminPortal.handleAddNotice(e);

    const addBusForm = document.getElementById('add-bus-form');
    if (addBusForm) addBusForm.onsubmit = e => AdminPortal.handleAddBus(e);

    // Audit logs pagination & filter
    const prevBtn = document.getElementById('audit-prev-btn');
    const nextBtn = document.getElementById('audit-next-btn');
    const statusFilter = document.getElementById('audit-status-filter');

    if (prevBtn) {
      prevBtn.onclick = () => {
        if (state.auditPage > 1) {
          state.auditPage--;
          AdminPortal.loadAuditLogs();
        }
      };
    }
    if (nextBtn) {
      nextBtn.onclick = () => {
        if (state.auditPage < state.auditTotalPages) {
          state.auditPage++;
          AdminPortal.loadAuditLogs();
        }
      };
    }
    if (statusFilter) {
      statusFilter.onchange = e => {
        state.auditStatus = e.target.value;
        state.auditPage = 1;
        AdminPortal.loadAuditLogs();
      };
    }

    // Buses filter input
    const busesFilter = document.getElementById('buses-filter-input');
    if (busesFilter) {
      busesFilter.oninput = () => BusesPage.renderGrid(state.allBuses);
    }

    // Stops filter input
    const stopsFilter = document.getElementById('stops-filter-input');
    if (stopsFilter) {
      stopsFilter.oninput = () => StopsPage.render();
    }

    // Admin add driver / student buttons
    const addDrvBtn = document.getElementById('admin-add-driver-btn');
    if (addDrvBtn) addDrvBtn.onclick = () => AdminDriversPage.openAddModal();

    // Hash change routing
    window.addEventListener('hashchange', () => Router.handleRoute());

    // Boot app
    checkSession();
  });

})();
