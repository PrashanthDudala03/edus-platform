-- Create schemas for each service
CREATE SCHEMA IF NOT EXISTS auth_db;
CREATE SCHEMA IF NOT EXISTS school_db;
CREATE SCHEMA IF NOT EXISTS student_db;
CREATE SCHEMA IF NOT EXISTS teacher_db;
CREATE SCHEMA IF NOT EXISTS parent_db;

-- Auth Roles and Permissions (create FIRST before users table)
CREATE TABLE IF NOT EXISTS auth_db.roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system_role BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(school_id, name)
);

CREATE TABLE IF NOT EXISTS auth_db.role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES auth_db.roles(id),
    permission_key VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(role_id, permission_key)
);

CREATE INDEX idx_roles_school_id ON auth_db.roles(school_id);
CREATE INDEX idx_role_permissions_role_id ON auth_db.role_permissions(role_id);

-- Auth Service Tables
CREATE TABLE IF NOT EXISTS auth_db.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    username VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(500) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMPTZ,
    role_id UUID REFERENCES auth_db.roles(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    created_by_user_id UUID,
    UNIQUE(school_id, username)
);

CREATE TABLE IF NOT EXISTS auth_db.refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES auth_db.users(id),
    token VARCHAR(500) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_school_id ON auth_db.users(school_id);
CREATE INDEX idx_refresh_tokens_user_id ON auth_db.refresh_tokens(user_id);

-- School Service Tables
CREATE TABLE IF NOT EXISTS school_db.schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    abbreviation VARCHAR(10),
    address VARCHAR(500),
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(10),
    phone_number VARCHAR(20),
    email VARCHAR(255),
    principal_name VARCHAR(255),
    founded_year INT,
    is_active BOOLEAN DEFAULT true,
    subscription_tier VARCHAR(50) DEFAULT 'trial',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    created_by_user_id UUID
);

CREATE TABLE IF NOT EXISTS school_db.roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_built_in BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    UNIQUE(school_id, name)
);

CREATE TABLE IF NOT EXISTS school_db.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    user_id UUID,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(50),
    user_agent TEXT
);

CREATE INDEX idx_audit_logs_school_id ON school_db.audit_logs(school_id);
CREATE INDEX idx_audit_logs_timestamp ON school_db.audit_logs(timestamp DESC);

-- Student Service Tables
CREATE TABLE IF NOT EXISTS student_db.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    roll_number VARCHAR(50) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE NOT NULL,
    gender VARCHAR(20),
    email VARCHAR(255),
    phone_number VARCHAR(20),
    address TEXT,
    admission_date DATE NOT NULL,
    current_class VARCHAR(50),
    status VARCHAR(50) DEFAULT 'Active',
    blood_group VARCHAR(5),
    parent_guardian_id UUID,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    created_by_user_id UUID,
    UNIQUE(school_id, roll_number)
);

CREATE TABLE IF NOT EXISTS student_db.enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    student_id UUID NOT NULL REFERENCES student_db.students(id),
    class VARCHAR(50) NOT NULL,
    enrollment_year INT NOT NULL,
    status VARCHAR(50) DEFAULT 'Enrolled',
    enrolled_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    dropout_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_students_school_id ON student_db.students(school_id);
CREATE INDEX idx_enrollments_student_id ON student_db.enrollments(student_id);

-- Teacher Service Tables
CREATE TABLE IF NOT EXISTS teacher_db.teachers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    employee_code VARCHAR(50) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone_number VARCHAR(20),
    date_of_birth DATE,
    qualification VARCHAR(255),
    date_of_joining DATE,
    department VARCHAR(100),
    status VARCHAR(50) DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    created_by_user_id UUID,
    UNIQUE(school_id, employee_code)
);

CREATE TABLE IF NOT EXISTS teacher_db.assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    teacher_id UUID NOT NULL REFERENCES teacher_db.teachers(id),
    subject VARCHAR(100) NOT NULL,
    class VARCHAR(50),
    academic_year INT,
    is_class_teacher BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_teachers_school_id ON teacher_db.teachers(school_id);
CREATE INDEX idx_assignments_teacher_id ON teacher_db.assignments(teacher_id);

-- Parent Service Tables
CREATE TABLE IF NOT EXISTS parent_db.parents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone_number VARCHAR(20) NOT NULL UNIQUE,
    occupation VARCHAR(100),
    address TEXT,
    alternate_phone VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    created_by_user_id UUID
);

CREATE INDEX idx_parents_school_id ON parent_db.parents(school_id);

-- Insert test data
INSERT INTO school_db.schools (name, abbreviation, city, principal_name)
VALUES ('Green Valley High School', 'GVHS', 'Springfield', 'Dr. John Smith');

INSERT INTO school_db.roles (school_id, name, description, is_built_in)
SELECT id, 'SuperAdmin', 'System administrator with full access', true FROM school_db.schools
UNION ALL
SELECT id, 'Principal', 'School principal with full school access', true FROM school_db.schools
UNION ALL
SELECT id, 'Teacher', 'Teacher with class access', true FROM school_db.schools
UNION ALL
SELECT id, 'Student', 'Student with limited access', true FROM school_db.schools
UNION ALL
SELECT id, 'Parent', 'Parent with child access', true FROM school_db.schools;

-- Insert test user (password: admin123 hashed with BCrypt.Net.BCrypt cost 12)
INSERT INTO auth_db.users (school_id, username, email, password_hash, first_name, last_name, is_active)
SELECT id, 'admin', 'admin@gvhs.edu', '$2b$12$4pwJo71C1YsNbUxME3LVluBMNsTR3OHFpGk9PrSbwmKc8eA4389h2', 'Admin', 'User', true
FROM school_db.schools;
