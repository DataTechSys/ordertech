-- FOODICS SCHEMA
-- Schema for managing Foodics-specific users, subscriptions, and device licenses

-- Foodics Users Table
CREATE TABLE IF NOT EXISTS foodics_users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    foodics_id VARCHAR(6) UNIQUE NOT NULL, -- 6-digit Foodics ID
    foodics_account VARCHAR(50) NOT NULL, -- User's actual Foodics account number
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    company_name VARCHAR(255),
    phone VARCHAR(50),
    status VARCHAR(20) DEFAULT 'active', -- active, suspended, cancelled
    email_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ
);

-- Foodics Subscriptions Table
CREATE TABLE IF NOT EXISTS foodics_subscriptions (
    subscription_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES foodics_users(user_id) ON DELETE CASCADE,
    plan_type VARCHAR(50) DEFAULT 'trial', -- trial, basic, premium, enterprise
    status VARCHAR(20) DEFAULT 'active', -- active, expired, cancelled
    trial_start_date TIMESTAMPTZ DEFAULT NOW(),
    trial_end_date TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
    subscription_start_date TIMESTAMPTZ,
    subscription_end_date TIMESTAMPTZ,
    devices_allowed INT DEFAULT 1, -- Number of devices allowed
    auto_renew BOOLEAN DEFAULT FALSE,
    payment_method VARCHAR(50), -- stripe, paypal, etc.
    payment_status VARCHAR(20), -- pending, paid, failed
    last_payment_date TIMESTAMPTZ,
    next_billing_date TIMESTAMPTZ,
    amount_due DECIMAL(10, 2),
    currency VARCHAR(3) DEFAULT 'SAR',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Foodics Devices Table
CREATE TABLE IF NOT EXISTS foodics_devices (
    device_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES foodics_users(user_id) ON DELETE CASCADE,
    device_name VARCHAR(255) NOT NULL,
    device_type VARCHAR(50) NOT NULL, -- loyalty, drivethru, signage
    device_uuid TEXT UNIQUE,
    activation_token VARCHAR(255),
    status VARCHAR(20) DEFAULT 'inactive', -- active, inactive, suspended
    license_key VARCHAR(255) UNIQUE,
    activated_at TIMESTAMPTZ,
    last_seen TIMESTAMPTZ,
    ip_address VARCHAR(50),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Foodics Password Reset Tokens
CREATE TABLE IF NOT EXISTS foodics_password_resets (
    reset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES foodics_users(user_id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Foodics Email Verification Tokens
CREATE TABLE IF NOT EXISTS foodics_email_verifications (
    verification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES foodics_users(user_id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Foodics Activity Logs
CREATE TABLE IF NOT EXISTS foodics_activity_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES foodics_users(user_id) ON DELETE SET NULL,
    device_id UUID REFERENCES foodics_devices(device_id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    description TEXT,
    ip_address VARCHAR(50),
    user_agent TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_foodics_users_foodics_id ON foodics_users(foodics_id);
CREATE INDEX IF NOT EXISTS idx_foodics_users_email ON foodics_users(email);
CREATE INDEX IF NOT EXISTS idx_foodics_subscriptions_user_id ON foodics_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_foodics_subscriptions_status ON foodics_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_foodics_devices_user_id ON foodics_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_foodics_devices_status ON foodics_devices(status);
CREATE INDEX IF NOT EXISTS idx_foodics_devices_type ON foodics_devices(device_type);
CREATE INDEX IF NOT EXISTS idx_foodics_activity_logs_user_id ON foodics_activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_foodics_activity_logs_created_at ON foodics_activity_logs(created_at DESC);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_foodics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER foodics_users_updated_at BEFORE UPDATE ON foodics_users
    FOR EACH ROW EXECUTE FUNCTION update_foodics_updated_at();

CREATE TRIGGER foodics_subscriptions_updated_at BEFORE UPDATE ON foodics_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_foodics_updated_at();

CREATE TRIGGER foodics_devices_updated_at BEFORE UPDATE ON foodics_devices
    FOR EACH ROW EXECUTE FUNCTION update_foodics_updated_at();
