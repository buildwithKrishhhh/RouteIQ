-- ============================================================
-- RouteIQ - University Transit System Database
-- Idempotent schema + seed for Acropolis College, Indore
-- Matches Bus-Route.pdf (July 2015 schedule)
-- ============================================================

CREATE DATABASE IF NOT EXISTS busmg;
USE busmg;

-- ============================================================
-- SCHEMA (lowercase table names, ON DELETE rules, indexes)
-- ============================================================

CREATE TABLE IF NOT EXISTS admins (
    admin_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS students (
    student_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) DEFAULT 'password'
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS drivers (
    driver_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(15) UNIQUE NOT NULL,
    experience_years INT,
    email VARCHAR(100) UNIQUE DEFAULT NULL,
    password VARCHAR(255) DEFAULT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS routes (
    route_id INT AUTO_INCREMENT PRIMARY KEY,
    route_name VARCHAR(100) NOT NULL,
    start_point VARCHAR(100),
    end_point VARCHAR(100)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS buses (
    bus_id INT AUTO_INCREMENT PRIMARY KEY,
    bus_number VARCHAR(50) UNIQUE NOT NULL,
    capacity INT DEFAULT 52,
    driver_id INT,
    latitude DECIMAL(10,8) DEFAULT 22.71960000,
    longitude DECIMAL(11,8) DEFAULT 75.85770000,
    speed DECIMAL(6,2) DEFAULT NULL,
    heading DECIMAL(6,2) DEFAULT NULL,
    last_updated TIMESTAMP NULL DEFAULT NULL,
    FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stops (
    stop_id INT AUTO_INCREMENT PRIMARY KEY,
    stop_name VARCHAR(100) NOT NULL,
    latitude DECIMAL(10,8) DEFAULT NULL,
    longitude DECIMAL(11,8) DEFAULT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS route_stops (
    route_stop_id INT AUTO_INCREMENT PRIMARY KEY,
    route_id INT,
    stop_id INT,
    stop_order INT,
    arrival_time_1st_shift TIME DEFAULT NULL,
    arrival_time_2nd_shift TIME DEFAULT NULL,
    FOREIGN KEY (route_id) REFERENCES routes(route_id) ON DELETE CASCADE,
    FOREIGN KEY (stop_id) REFERENCES stops(stop_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS schedules (
    schedule_id INT AUTO_INCREMENT PRIMARY KEY,
    bus_id INT,
    route_id INT,
    arrival_time_1st_shift TIME,
    arrival_time_2nd_shift TIME,
    FOREIGN KEY (bus_id) REFERENCES buses(bus_id) ON DELETE CASCADE,
    FOREIGN KEY (route_id) REFERENCES routes(route_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS student_routes (
    student_route_id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT,
    route_id INT,
    FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
    FOREIGN KEY (route_id) REFERENCES routes(route_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notices (
    notice_id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL DEFAULT 'General Alert',
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expiry_date DATE DEFAULT NULL,
    target_route_id INT DEFAULT NULL,
    FOREIGN KEY (target_route_id) REFERENCES routes(route_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS login_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(100) NOT NULL,
    role VARCHAR(50) NOT NULL,
    login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(100) DEFAULT 'Success',
    ip_address VARCHAR(45)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_preferences (
    user_role VARCHAR(20) NOT NULL,
    user_id INT NOT NULL,
    theme VARCHAR(10) NOT NULL DEFAULT 'dark',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_role, user_id)
) ENGINE=InnoDB;

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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bus_locations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bus_id INT NOT NULL,
    latitude DECIMAL(10,8) NOT NULL,
    longitude DECIMAL(11,8) NOT NULL,
    speed DECIMAL(6,2) DEFAULT NULL,
    heading DECIMAL(6,2) DEFAULT NULL,
    trip_id INT DEFAULT NULL,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bus_id) REFERENCES buses(bus_id) ON DELETE CASCADE,
    FOREIGN KEY (trip_id) REFERENCES trips(trip_id) ON DELETE SET NULL
) ENGINE=InnoDB;

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
    FOREIGN KEY (trip_id) REFERENCES trips(trip_id) ON DELETE SET NULL,
    UNIQUE KEY uk_feedback_student_bus_date (student_id, bus_id, feedback_date)
) ENGINE=InnoDB;

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
    FOREIGN KEY (trip_id) REFERENCES trips(trip_id) ON DELETE SET NULL,
    FOREIGN KEY (assigned_to_admin_id) REFERENCES admins(admin_id) ON DELETE SET NULL
) ENGINE=InnoDB;

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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS issue_attachments (
    attachment_id INT AUTO_INCREMENT PRIMARY KEY,
    issue_id INT NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (issue_id) REFERENCES issues(issue_id) ON DELETE CASCADE
) ENGINE=InnoDB;

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
) ENGINE=InnoDB;

-- ============================================================
-- INDEXES
-- ============================================================
-- Guard against duplicate index creation
SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'login_logs' AND INDEX_NAME = 'idx_login_logs_email_time');
SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_login_logs_email_time ON login_logs(email, login_time)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'buses' AND INDEX_NAME = 'idx_buses_driver_id');
SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_buses_driver_id ON buses(driver_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schedules' AND INDEX_NAME = 'idx_schedules_bus_id');
SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_schedules_bus_id ON schedules(bus_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schedules' AND INDEX_NAME = 'idx_schedules_route_id');
SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_schedules_route_id ON schedules(route_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'route_stops' AND INDEX_NAME = 'idx_route_stops_route_id');
SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_route_stops_route_id ON route_stops(route_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'route_stops' AND INDEX_NAME = 'idx_route_stops_stop_id');
SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_route_stops_stop_id ON route_stops(stop_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bus_locations' AND INDEX_NAME = 'idx_bus_locations_bus_id');
SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_bus_locations_bus_id ON bus_locations(bus_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bus_locations' AND INDEX_NAME = 'idx_bus_locations_bus_rec');
SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_bus_locations_bus_rec ON bus_locations(bus_id, recorded_at)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bus_locations' AND INDEX_NAME = 'idx_bus_locations_trip');
SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_bus_locations_trip ON bus_locations(trip_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trips' AND INDEX_NAME = 'idx_trips_status_started');
SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_trips_status_started ON trips(status, started_at)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trips' AND INDEX_NAME = 'idx_trips_bus_status');
SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_trips_bus_status ON trips(bus_id, status)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trips' AND INDEX_NAME = 'idx_trips_driver_status');
SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_trips_driver_status ON trips(driver_id, status)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feedback' AND INDEX_NAME = 'idx_feedback_bus_created');
SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_feedback_bus_created ON feedback(bus_id, created_at)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feedback' AND INDEX_NAME = 'idx_feedback_driver');
SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_feedback_driver ON feedback(driver_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'issues' AND INDEX_NAME = 'idx_issues_status_created');
SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_issues_status_created ON issues(status, created_at)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'issues' AND INDEX_NAME = 'idx_issues_bus_created');
SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_issues_bus_created ON issues(bus_id, created_at)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND INDEX_NAME = 'idx_notif_user_read');
SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_notif_user_read ON notifications(user_role, user_id, is_read, created_at)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- SEED DATA (idempotent: only insert if tables are empty)
-- ============================================================

-- Drivers (40 from Bus-Route.pdf)
INSERT INTO drivers (name, phone_number, experience_years)
SELECT * FROM (SELECT 'Shri Santosh Choudhary' AS name, '9893000001' AS phone_number, 5 AS exp) t
WHERE NOT EXISTS (SELECT 1 FROM drivers LIMIT 1);

-- Only seed if drivers table was empty
SET @do_seed = (SELECT COUNT(*) FROM drivers);

-- If we just seeded the first driver, insert the rest
INSERT IGNORE INTO drivers (name, phone_number, experience_years) VALUES
('Shri Santosh Choudhary', '9893000001', 5),
('Shri Ravi Rathore', '9893000002', 6),
('Shri Mohammad Firoz', '9893000003', 7),
('Shri Onkarlal Choudhary', '9893000004', 8),
('Shri Gautam Nagar', '9893000005', 4),
('Shri D. Makwana', '9893000006', 10),
('Jeevan S Thakur', '9893000007', 9),
('Shri Praveen Yadav', '9893000008', 6),
('Shri Kayyum Khan', '9893000009', 7),
('Shri Jeevan S Chavda', '9893000010', 5),
('Shri Ghanshyam Chouhan', '9893000011', 8),
('Shri Murarilal ji Mandloi', '9893000012', 6),
('Shri Gajju Limanpure', '9893000013', 7),
('Shri Rajendra Choudhary', '9893000014', 9),
('Shri Lakhan Thakur', '9893000015', 5),
('Shri Ishtikhar Hussain', '9893000016', 6),
('Shri Ranjeet Patel', '9893000017', 7),
('Shri Rajesh Patel', '9893000018', 8),
('Shri Champalal', '9893000019', 4),
('Shri Nilesh Patel', '9893000020', 6),
('Shri Vikram Patel', '9893000021', 7),
('Shri Prahlad Makwana', '9893000022', 5),
('Shri Akhilesh Patel', '9893000023', 8),
('Shri Jagdeesh Jatwa', '9893000024', 6),
('Shri Rajendra Rajpoot', '9893000025', 7),
('Shri Babulal Patel', '9893000026', 9),
('Shri Anil Choudhary', '9893000027', 5),
('Shri Anand Malviya', '9893000028', 6),
('Shri Lalji Malviya', '9893000029', 7),
('Shri Ramchander Baloniya', '9893000030', 8),
('Shri Chander Singh', '9893000031', 6),
('Shri Shankar Patel', '9893000032', 7),
('Shri Ganesh Patel', '9893000033', 5),
('Shri Dinesh Patel', '9893000034', 6),
('Shri Azamat Ali', '9893000035', 7),
('Shri Shriram Rawat', '9893000036', 8),
('Shri Madhav S. Dhakad', '9893000037', 6),
('Shri Omprakash Patel', '9893000038', 7),
('Shri Mukesh Patel', '9893000039', 5),
('Pappu Prajapat', '9575503760', 9);

-- Routes (5 core routes from PDF)
INSERT IGNORE INTO routes (route_name, start_point, end_point) VALUES
('Route 1 - Pragati Nagar', 'Pragati Nagar Ring Road', 'Acropolis College'),
('Route 3 - Kila Maidan', 'Kila Maidan', 'Acropolis College'),
('Route 5 - RTO', 'RTO', 'Acropolis College'),
('Route 7 - Gandhi Nagar', 'Gandhi Nagar', 'Acropolis College'),
('Route 10 - Bhamori Plaza', 'Bhamori Plaza', 'Acropolis College');

-- Buses with correct driver assignments (from PDF)
INSERT IGNORE INTO buses (bus_number, capacity, driver_id) VALUES
('MP-09FA-5572', 52, 1),
('MP-09FA-4890', 52, 2),
('MP-09FA-4387', 52, 3),
('MP-09FA-4892', 52, 4),
('MP-09FA-1691', 52, 5),
('MP-09FA-3944', 52, 6),
('MP-09FA-1525', 52, 7),
('MP-09FA-1081', 52, 8),
('MP-09FA-5571', 52, 11),
('MP-09FA-1521', 52, 12),
('MP-09FA-4889', 52, 13),
('MP-09FA-5574', 52, 20),
('MP-09FA-4386', 52, 21),
('MP-09FA-4388', 52, 22);

-- Stops (all unique stops with approximate Indore coordinates)
INSERT IGNORE INTO stops (stop_name, latitude, longitude) VALUES
('Pragati Nagar Ring Road', 22.7538, 75.8650),
('CAT Chouraha', 22.7490, 75.8620),
('Hawa Bungla (CAT Road)', 22.7450, 75.8605),
('Gopur Chowki (Ring Road)', 22.7420, 75.8580),
('Jarolia Market', 22.7390, 75.8560),
('Sai Dwar', 22.7370, 75.8545),
('Relax Garden', 22.7345, 75.8530),
('Sudama Nagar Ring Road', 22.7320, 75.8515),
('Footi Kothi Chouraha', 22.7300, 75.8500),
('Suruchi Garden', 22.7280, 75.8490),
('Reliance Fresh Footi Kothi Chouraha', 22.7265, 75.8480),
('Chandan Nagar Thana', 22.7245, 75.8465),
('Shankar Kirana Gumasta Nagar', 22.7225, 75.8450),
('Gumasta Nagar Shiv Mandir', 22.7210, 75.8440),
('Gumasta Nagar Chouraha', 22.7195, 75.8430),
('Charumedicoz (Kothari Clinic)', 22.7180, 75.8415),
('Ranjit Hanuman', 22.7165, 75.8400),
('Dravid Nagar', 22.7145, 75.8385),
('Usha Nagar', 22.7130, 75.8370),
('Mhow Naka Shiv Mandir', 22.7110, 75.8355),
('Mhow Naka Chouraha', 22.7095, 75.8340),
('Old GDC Jairampur Colony Chouraha', 22.7080, 75.8320),
('Collector Chauraha', 22.7065, 75.8305),
('Palsikar Chauraha', 22.7050, 75.8290),
('Juni Indore Bridge', 22.7035, 75.8275),
('Sindhi Colony', 22.7020, 75.8260),
('Ashok Nagar Bhauwarkua Main Road', 22.7000, 75.8240),
('Bhauwarkua Chouraha', 22.6980, 75.8220),
('Navlakha Chouraha', 22.6960, 75.8200),
('Nemawar Road', 22.6940, 75.8180),
('Teen Imli', 22.6920, 75.8160),
('Musakhedi', 22.6900, 75.8140),
('Acropolis College', 22.6850, 75.8100),
('Kila Maidan', 22.7190, 75.8570),
('Banganga Stop Old Naka', 22.7175, 75.8555),
('Sangam Nagar', 22.7155, 75.8540),
('Khada Ganpati', 22.7140, 75.8525),
('Mahesh Gard Line Petrol Pump', 22.7125, 75.8510),
('Marimata Chouraha', 22.7110, 75.8495),
('Agniban Press Chouraha', 22.7095, 75.8480),
('Rajkumar Bridge (Vallabh Nagar)', 22.7080, 75.8465),
('Malwa Mill', 22.7065, 75.8450),
('Ranisati Gate', 22.7050, 75.8435),
('City Office Chouraha', 22.7035, 75.8420),
('Janjirwala Chouraha', 22.7020, 75.8405),
('Mahidpurwala Chouraha', 22.7005, 75.8390),
('Palasia Thana', 22.6990, 75.8375),
('Khajrana Chouraha', 22.6975, 75.8360),
('Malvi Petrol Pump', 22.6960, 75.8345),
('RTO', 22.7350, 75.8900),
('Lokmanya Nagar', 22.7330, 75.8870),
('Vinay Nagar', 22.7310, 75.8850),
('Keshar Bag Railway Bridge', 22.7280, 75.8830),
('Kodariya (Mhow)', 22.7250, 75.8810),
('Dreamland Square', 22.7230, 75.8790),
('Hotel Shyam Vilas Palace', 22.7210, 75.8770),
('Hari Phatak Railway Crossing', 22.7190, 75.8750),
('Rau Bypass', 22.7150, 75.8700),
('Rau A.B. Road Bus Stand', 22.7130, 75.8680),
('Silicon City', 22.7100, 75.8650),
('IPS College', 22.7080, 75.8630),
('Rajendra Nagar Thana', 22.7060, 75.8600),
('Bijalpur Chouraha', 22.7040, 75.8570),
('Gadbadi Pooliya', 22.7020, 75.8540),
('Choithram Mandi Chouraha', 22.7000, 75.8510),
('Rajiv Gandhi Chouraha', 22.6980, 75.8480),
('Vishnupuri Chouraha', 22.6960, 75.8450),
('Indrapuri', 22.6950, 75.8420),
('Asharam Bapu Chouraha', 22.6935, 75.8395),
('SDPS College', 22.6920, 75.8370),
('Teen Imali Square', 22.6905, 75.8340),
('Khandwa Naka Chouraha', 22.6890, 75.8310),
('Mushakhedi Square', 22.6875, 75.8280),
('Pipliya Hana Square', 22.6860, 75.8250),
('Limbodi Gate Rani Bagh', 22.6845, 75.8220),
('Tejaji Nagar', 22.6830, 75.8190),
('Gandhi Nagar', 22.7250, 75.8400),
('Aerodrum Thana', 22.7230, 75.8385),
('Vidhya Dham', 22.7210, 75.8370),
('Kalani Nagar', 22.7190, 75.8355),
('Shikshak Nagar', 22.7170, 75.8340),
('Ramchand Nagar Petrol Pump', 22.7150, 75.8325),
('Bada Ganpati', 22.7130, 75.8310),
('Rajmohalla Chouraha Petrol Pump', 22.7110, 75.8295),
('Malganj Chouraha', 22.7090, 75.8280),
('Narsingh Bazar Chouraha', 22.7070, 75.8265),
('Bartanbazar Chouraha', 22.7050, 75.8250),
('Gurudwara Jawaharmarg', 22.7030, 75.8235),
('Saifi Hotel', 22.7010, 75.8220),
('Patel Bridge', 22.6990, 75.8205),
('Patel Pratima', 22.6970, 75.8190),
('Shrimaya Hotel Madhumilan Chou.', 22.6950, 75.8175),
('Dhakkanwala Kua', 22.6930, 75.8160),
('Kanadia Bypass', 22.6910, 75.8140),
('Bhamori Plaza', 22.7300, 75.8800),
('Astha Talkies', 22.7280, 75.8780),
('Patnipura Chouraha', 22.7260, 75.8760),
('Bhandari Bridge Thana', 22.7240, 75.8740),
('Subhash Nagar', 22.7220, 75.8720),
('Pardeshipura', 22.7200, 75.8700),
('Nanda Nagar Teen Puliya', 22.7180, 75.8680),
('Nanda Nagar', 22.7160, 75.8660),
('Patnipura', 22.7140, 75.8640),
('Atal Dwar', 22.7120, 75.8620),
('Christian Eminent School', 22.7100, 75.8600),
('LIG Square', 22.7080, 75.8580),
('Press Complex', 22.7060, 75.8560),
('Malviya Nagar Chouraha', 22.7040, 75.8540),
('Rasoma Chouraha', 22.7020, 75.8520),
('Vijay Nagar RTO Office', 22.7000, 75.8500),
('Hotel Redison Chouraha', 22.6980, 75.8480),
('Bypass', 22.6920, 75.8200);

-- Route_Stops mappings with stop_order
-- Route 1: Pragati Nagar → Acropolis College (33 stops)
INSERT INTO route_stops (route_id, stop_id, stop_order, arrival_time_1st_shift, arrival_time_2nd_shift)
SELECT 1, s.stop_id, pos.ord, pos.t1, pos.t2
FROM stops s
JOIN (
  SELECT 'Pragati Nagar Ring Road' AS name, 1 AS ord, '07:30:00' AS t1, '09:30:00' AS t2 UNION ALL
  SELECT 'CAT Chouraha', 2, '07:32:00', '09:32:00' UNION ALL
  SELECT 'Hawa Bungla (CAT Road)', 3, '07:34:00', '09:34:00' UNION ALL
  SELECT 'Gopur Chowki (Ring Road)', 4, '07:36:00', '09:36:00' UNION ALL
  SELECT 'Jarolia Market', 5, '07:38:00', '09:38:00' UNION ALL
  SELECT 'Sai Dwar', 6, '07:39:00', '09:39:00' UNION ALL
  SELECT 'Relax Garden', 7, '07:41:00', '09:41:00' UNION ALL
  SELECT 'Sudama Nagar Ring Road', 8, '07:43:00', '09:43:00' UNION ALL
  SELECT 'Footi Kothi Chouraha', 9, '07:45:00', '09:45:00' UNION ALL
  SELECT 'Suruchi Garden', 10, '07:46:00', '09:46:00' UNION ALL
  SELECT 'Reliance Fresh Footi Kothi Chouraha', 11, '07:47:00', '09:47:00' UNION ALL
  SELECT 'Chandan Nagar Thana', 12, '07:49:00', '09:49:00' UNION ALL
  SELECT 'Shankar Kirana Gumasta Nagar', 13, '07:50:00', '09:50:00' UNION ALL
  SELECT 'Gumasta Nagar Shiv Mandir', 14, '07:51:00', '09:51:00' UNION ALL
  SELECT 'Gumasta Nagar Chouraha', 15, '07:52:00', '09:52:00' UNION ALL
  SELECT 'Charumedicoz (Kothari Clinic)', 16, '07:53:00', '09:53:00' UNION ALL
  SELECT 'Ranjit Hanuman', 17, '07:54:00', '09:54:00' UNION ALL
  SELECT 'Dravid Nagar', 18, '07:55:00', '09:55:00' UNION ALL
  SELECT 'Usha Nagar', 19, '07:56:00', '09:56:00' UNION ALL
  SELECT 'Mhow Naka Shiv Mandir', 20, '07:57:00', '09:57:00' UNION ALL
  SELECT 'Mhow Naka Chouraha', 21, '07:58:00', '09:58:00' UNION ALL
  SELECT 'Old GDC Jairampur Colony Chouraha', 22, '07:59:00', '09:59:00' UNION ALL
  SELECT 'Collector Chauraha', 23, '08:00:00', '10:00:00' UNION ALL
  SELECT 'Palsikar Chauraha', 24, '08:01:00', '10:01:00' UNION ALL
  SELECT 'Juni Indore Bridge', 25, '08:02:00', '10:02:00' UNION ALL
  SELECT 'Sindhi Colony', 26, '08:03:00', '10:03:00' UNION ALL
  SELECT 'Ashok Nagar Bhauwarkua Main Road', 27, '08:04:00', '10:04:00' UNION ALL
  SELECT 'Bhauwarkua Chouraha', 28, '08:05:00', '10:05:00' UNION ALL
  SELECT 'Navlakha Chouraha', 29, '08:06:00', '10:06:00' UNION ALL
  SELECT 'Nemawar Road', 30, '08:07:00', '10:07:00' UNION ALL
  SELECT 'Teen Imli', 31, '08:08:00', '10:08:00' UNION ALL
  SELECT 'Musakhedi', 32, '08:09:00', '10:09:00' UNION ALL
  SELECT 'Acropolis College', 33, '08:10:00', '10:10:00'
) pos ON s.stop_name = pos.name
WHERE NOT EXISTS (SELECT 1 FROM route_stops WHERE route_id = 1 LIMIT 1);

-- Route 3: Kila Maidan → Acropolis College (17 stops)
INSERT INTO route_stops (route_id, stop_id, stop_order, arrival_time_1st_shift, arrival_time_2nd_shift)
SELECT 2, s.stop_id, pos.ord, pos.t1, pos.t2
FROM stops s
JOIN (
  SELECT 'Kila Maidan' AS name, 1 AS ord, '07:40:00' AS t1, '09:40:00' AS t2 UNION ALL
  SELECT 'Banganga Stop Old Naka', 2, '07:43:00', '09:43:00' UNION ALL
  SELECT 'Sangam Nagar', 3, '07:45:00', '09:45:00' UNION ALL
  SELECT 'Khada Ganpati', 4, '07:47:00', '09:47:00' UNION ALL
  SELECT 'Mahesh Gard Line Petrol Pump', 5, '07:49:00', '09:49:00' UNION ALL
  SELECT 'Marimata Chouraha', 6, '07:51:00', '09:51:00' UNION ALL
  SELECT 'Agniban Press Chouraha', 7, '07:53:00', '09:53:00' UNION ALL
  SELECT 'Rajkumar Bridge (Vallabh Nagar)', 8, '07:55:00', '09:55:00' UNION ALL
  SELECT 'Malwa Mill', 9, '07:56:00', '09:56:00' UNION ALL
  SELECT 'Ranisati Gate', 10, '07:57:00', '09:57:00' UNION ALL
  SELECT 'City Office Chouraha', 11, '07:58:00', '09:58:00' UNION ALL
  SELECT 'Janjirwala Chouraha', 12, '07:59:00', '09:59:00' UNION ALL
  SELECT 'Mahidpurwala Chouraha', 13, '08:00:00', '10:00:00' UNION ALL
  SELECT 'Palasia Thana', 14, '08:02:00', '10:02:00' UNION ALL
  SELECT 'Khajrana Chouraha', 15, '08:04:00', '10:04:00' UNION ALL
  SELECT 'Malvi Petrol Pump', 16, '08:06:00', '10:06:00' UNION ALL
  SELECT 'Acropolis College', 17, '08:10:00', '10:10:00'
) pos ON s.stop_name = pos.name
WHERE NOT EXISTS (SELECT 1 FROM route_stops WHERE route_id = 2 LIMIT 1);

-- Route 5: RTO → Acropolis College (29 stops)
INSERT INTO route_stops (route_id, stop_id, stop_order, arrival_time_1st_shift, arrival_time_2nd_shift)
SELECT 3, s.stop_id, pos.ord, pos.t1, pos.t2
FROM stops s
JOIN (
  SELECT 'RTO' AS name, 1 AS ord, '07:25:00' AS t1, '09:25:00' AS t2 UNION ALL
  SELECT 'Lokmanya Nagar', 2, '07:27:00', '09:27:00' UNION ALL
  SELECT 'Vinay Nagar', 3, '07:29:00', '09:29:00' UNION ALL
  SELECT 'Keshar Bag Railway Bridge', 4, '07:31:00', '09:31:00' UNION ALL
  SELECT 'Kodariya (Mhow)', 5, '07:33:00', '09:33:00' UNION ALL
  SELECT 'Dreamland Square', 6, '07:35:00', '09:35:00' UNION ALL
  SELECT 'Hotel Shyam Vilas Palace', 7, '07:37:00', '09:37:00' UNION ALL
  SELECT 'Hari Phatak Railway Crossing', 8, '07:39:00', '09:39:00' UNION ALL
  SELECT 'Rau Bypass', 9, '07:41:00', '09:41:00' UNION ALL
  SELECT 'Rau A.B. Road Bus Stand', 10, '07:43:00', '09:43:00' UNION ALL
  SELECT 'Silicon City', 11, '07:45:00', '09:45:00' UNION ALL
  SELECT 'IPS College', 12, '07:47:00', '09:47:00' UNION ALL
  SELECT 'Rajendra Nagar Thana', 13, '07:49:00', '09:49:00' UNION ALL
  SELECT 'Bijalpur Chouraha', 14, '07:51:00', '09:51:00' UNION ALL
  SELECT 'Gadbadi Pooliya', 15, '07:52:00', '09:52:00' UNION ALL
  SELECT 'Choithram Mandi Chouraha', 16, '07:53:00', '09:53:00' UNION ALL
  SELECT 'Rajiv Gandhi Chouraha', 17, '07:54:00', '09:54:00' UNION ALL
  SELECT 'Vishnupuri Chouraha', 18, '07:55:00', '09:55:00' UNION ALL
  SELECT 'Bhauwarkua Chouraha', 19, '07:56:00', '09:56:00' UNION ALL
  SELECT 'Indrapuri', 20, '07:57:00', '09:57:00' UNION ALL
  SELECT 'Asharam Bapu Chouraha', 21, '07:58:00', '09:58:00' UNION ALL
  SELECT 'SDPS College', 22, '07:59:00', '09:59:00' UNION ALL
  SELECT 'Teen Imali Square', 23, '08:00:00', '10:00:00' UNION ALL
  SELECT 'Khandwa Naka Chouraha', 24, '08:02:00', '10:02:00' UNION ALL
  SELECT 'Mushakhedi Square', 25, '08:03:00', '10:03:00' UNION ALL
  SELECT 'Pipliya Hana Square', 26, '08:04:00', '10:04:00' UNION ALL
  SELECT 'Limbodi Gate Rani Bagh', 27, '08:06:00', '10:06:00' UNION ALL
  SELECT 'Tejaji Nagar', 28, '08:08:00', '10:08:00' UNION ALL
  SELECT 'Acropolis College', 29, '08:10:00', '10:10:00'
) pos ON s.stop_name = pos.name
WHERE NOT EXISTS (SELECT 1 FROM route_stops WHERE route_id = 3 LIMIT 1);

-- Route 7: Gandhi Nagar → Acropolis College (19 stops)
INSERT INTO route_stops (route_id, stop_id, stop_order, arrival_time_1st_shift, arrival_time_2nd_shift)
SELECT 4, s.stop_id, pos.ord, pos.t1, pos.t2
FROM stops s
JOIN (
  SELECT 'Gandhi Nagar' AS name, 1 AS ord, '07:35:00' AS t1, '09:35:00' AS t2 UNION ALL
  SELECT 'Aerodrum Thana', 2, '07:37:00', '09:37:00' UNION ALL
  SELECT 'Vidhya Dham', 3, '07:39:00', '09:39:00' UNION ALL
  SELECT 'Kalani Nagar', 4, '07:41:00', '09:41:00' UNION ALL
  SELECT 'Shikshak Nagar', 5, '07:43:00', '09:43:00' UNION ALL
  SELECT 'Ramchand Nagar Petrol Pump', 6, '07:45:00', '09:45:00' UNION ALL
  SELECT 'Bada Ganpati', 7, '07:47:00', '09:47:00' UNION ALL
  SELECT 'Rajmohalla Chouraha Petrol Pump', 8, '07:49:00', '09:49:00' UNION ALL
  SELECT 'Malganj Chouraha', 9, '07:51:00', '09:51:00' UNION ALL
  SELECT 'Narsingh Bazar Chouraha', 10, '07:52:00', '09:52:00' UNION ALL
  SELECT 'Bartanbazar Chouraha', 11, '07:53:00', '09:53:00' UNION ALL
  SELECT 'Gurudwara Jawaharmarg', 12, '07:55:00', '09:55:00' UNION ALL
  SELECT 'Saifi Hotel', 13, '07:57:00', '09:57:00' UNION ALL
  SELECT 'Patel Bridge', 14, '07:59:00', '09:59:00' UNION ALL
  SELECT 'Patel Pratima', 15, '08:00:00', '10:00:00' UNION ALL
  SELECT 'Shrimaya Hotel Madhumilan Chou.', 16, '08:02:00', '10:02:00' UNION ALL
  SELECT 'Dhakkanwala Kua', 17, '08:04:00', '10:04:00' UNION ALL
  SELECT 'Kanadia Bypass', 18, '08:06:00', '10:06:00' UNION ALL
  SELECT 'Acropolis College', 19, '08:10:00', '10:10:00'
) pos ON s.stop_name = pos.name
WHERE NOT EXISTS (SELECT 1 FROM route_stops WHERE route_id = 4 LIMIT 1);

-- Route 10: Bhamori Plaza → Acropolis College (19 stops)
INSERT INTO route_stops (route_id, stop_id, stop_order, arrival_time_1st_shift, arrival_time_2nd_shift)
SELECT 5, s.stop_id, pos.ord, pos.t1, pos.t2
FROM stops s
JOIN (
  SELECT 'Bhamori Plaza' AS name, 1 AS ord, '07:35:00' AS t1, '09:35:00' AS t2 UNION ALL
  SELECT 'Astha Talkies', 2, '07:37:00', '09:37:00' UNION ALL
  SELECT 'Patnipura Chouraha', 3, '07:39:00', '09:39:00' UNION ALL
  SELECT 'Bhandari Bridge Thana', 4, '07:41:00', '09:41:00' UNION ALL
  SELECT 'Subhash Nagar', 5, '07:43:00', '09:43:00' UNION ALL
  SELECT 'Pardeshipura', 6, '07:45:00', '09:45:00' UNION ALL
  SELECT 'Nanda Nagar Teen Puliya', 7, '07:47:00', '09:47:00' UNION ALL
  SELECT 'Nanda Nagar', 8, '07:49:00', '09:49:00' UNION ALL
  SELECT 'Patnipura', 9, '07:51:00', '09:51:00' UNION ALL
  SELECT 'Atal Dwar', 10, '07:53:00', '09:53:00' UNION ALL
  SELECT 'Christian Eminent School', 11, '07:55:00', '09:55:00' UNION ALL
  SELECT 'LIG Square', 12, '07:56:00', '09:56:00' UNION ALL
  SELECT 'Press Complex', 13, '07:57:00', '09:57:00' UNION ALL
  SELECT 'Malviya Nagar Chouraha', 14, '07:58:00', '09:58:00' UNION ALL
  SELECT 'Rasoma Chouraha', 15, '07:59:00', '09:59:00' UNION ALL
  SELECT 'Vijay Nagar RTO Office', 16, '08:00:00', '10:00:00' UNION ALL
  SELECT 'Hotel Redison Chouraha', 17, '08:02:00', '10:02:00' UNION ALL
  SELECT 'Bypass', 18, '08:05:00', '10:05:00' UNION ALL
  SELECT 'Acropolis College', 19, '08:10:00', '10:10:00'
) pos ON s.stop_name = pos.name
WHERE NOT EXISTS (SELECT 1 FROM route_stops WHERE route_id = 5 LIMIT 1);

-- Schedules mapping
INSERT IGNORE INTO schedules (bus_id, route_id, arrival_time_1st_shift, arrival_time_2nd_shift) VALUES
(1, 1, '08:10:00', '10:15:00'),
(2, 1, '08:10:00', '10:15:00'),
(3, 1, '08:10:00', '10:15:00'),
(4, 2, '08:10:00', '10:15:00'),
(5, 2, '08:10:00', '10:15:00'),
(6, 3, '08:10:00', '10:15:00'),
(7, 3, '08:10:00', '10:15:00'),
(8, 3, '08:10:00', '10:15:00'),
(9, 4, '08:10:00', '10:15:00'),
(10, 4, '08:10:00', '10:15:00'),
(11, 4, '08:10:00', '10:15:00'),
(12, 5, '08:10:00', '10:15:00'),
(13, 5, '08:10:00', '10:15:00'),
(14, 5, '08:10:00', '10:15:00');

-- ============================================================
-- VERIFICATION
-- ============================================================
SELECT '=== ROUTES ===' AS info;
SELECT route_id, route_name, start_point, end_point FROM routes ORDER BY route_id;
SELECT '=== ROUTE STOPS COUNT ===' AS info;
SELECT r.route_name, COUNT(rs.stop_id) AS stop_count
FROM routes r LEFT JOIN route_stops rs ON r.route_id = rs.route_id
GROUP BY r.route_id ORDER BY r.route_id;
