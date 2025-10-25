-- TENANTS TABLE

CREATE TABLE tenants (
    tenant_id UUID PRIMARY KEY,
    company_name VARCHAR(100),
    subdomain VARCHAR(50) UNIQUE,
    email VARCHAR(100),
    status VARCHAR(20),
    start_date DATE,
    renewal_date DATE,
    plan_type VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- BRANCHES TABLE

CREATE TABLE branches (
    branch_id UUID PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(tenant_id),
    branch_name VARCHAR(100),
    location VARCHAR(255),
    expiry_date DATE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ROLES TABLE

CREATE TABLE roles (
    role_id UUID PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(tenant_id),
    role_name VARCHAR(50),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- USERS TABLE

CREATE TABLE users (
    user_id UUID PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(tenant_id),
    branch_id UUID REFERENCES branches(branch_id),
    email VARCHAR(100) UNIQUE,
    password_hash TEXT,
    name VARCHAR(100),
    role_id UUID REFERENCES roles(role_id),
    status VARCHAR(20),
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- DEVICES TABLE

CREATE TABLE devices (
    device_id UUID PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(tenant_id),
    branch_id UUID REFERENCES branches(branch_id),
    device_name VARCHAR(100),
    uuid TEXT UNIQUE,
    activation_token VARCHAR(100),
    status VARCHAR(20),
    expiry_date DATE,
    last_checkin TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- SUBSCRIPTIONS TABLE

CREATE TABLE subscriptions (
    subscription_id UUID PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(tenant_id),
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN DEFAULT TRUE,
    devices_allowed INT,
    branches_allowed INT,
    notes TEXT
);


-- PERMISSIONS TABLE

CREATE TABLE permissions (
    permission_id UUID PRIMARY KEY,
    code VARCHAR(100) UNIQUE,
    description TEXT
);


-- ROLE_PERMISSIONS TABLE

CREATE TABLE role_permissions (
    role_id UUID REFERENCES roles(role_id),
    permission_id UUID REFERENCES permissions(permission_id),
    PRIMARY KEY (role_id, permission_id)
);


-- AUDIT_LOGS TABLE

CREATE TABLE audit_logs (
    log_id UUID PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(tenant_id),
    user_id UUID REFERENCES users(user_id),
    action VARCHAR(100),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    meta JSON
);


