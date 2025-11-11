-- Migration: Create customer_analytics table for merged Foodics + DataTech customer data
-- Purpose: Enable professional customer analytics dashboard with RFM segmentation and CLV
-- Created: 2025-11-10

BEGIN;

-- Create enum for customer source tracking
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'customer_source') THEN
    CREATE TYPE customer_source AS ENUM ('Foodics','DataTech','Merged');
  END IF;
END$$;

-- Main customer analytics table with de-duplication via merge_key
CREATE TABLE IF NOT EXISTS customer_analytics (
  id BIGSERIAL PRIMARY KEY,
  
  -- Deduplication key (deterministic: fuid:{id} or phone:{e164} or dtid:{id})
  merge_key TEXT NOT NULL UNIQUE,
  
  -- Source tracking
  source customer_source NOT NULL DEFAULT 'Merged',
  has_foodics BOOLEAN NOT NULL DEFAULT FALSE,
  has_datatech BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Identifiers from both systems
  foodics_id TEXT,                                        -- Foodics customer UUID
  foodics_unique_id TEXT,                                 -- Parsed from Foodics name field
  datatech_customer_id TEXT,                              -- Remote DataTech customer ID
  
  -- Core identity (Foodics priority, DataTech fills missing)
  name TEXT,
  phone_raw TEXT,
  phone_normalized TEXT,                                  -- E.164 format for reliable matching
  email TEXT,
  
  -- Order aggregates (combined from both sources)
  first_order_date TIMESTAMPTZ,
  last_order_date TIMESTAMPTZ,
  days_since_last_order INTEGER,
  orders_count INTEGER NOT NULL DEFAULT 0,
  total_spent NUMERIC(14,2) NOT NULL DEFAULT 0,
  average_order_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  purchase_frequency_per_month NUMERIC(10,4) NOT NULL DEFAULT 0,
  customer_lifespan_months NUMERIC(10,2) NOT NULL DEFAULT 0,
  repeat_buyer BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- RFM segmentation (Recency, Frequency, Monetary)
  r_score INTEGER NOT NULL DEFAULT 0,                     -- 1-5 scale
  f_score INTEGER NOT NULL DEFAULT 0,                     -- 1-5 scale
  m_score INTEGER NOT NULL DEFAULT 0,                     -- 1-5 scale
  rfm_score INTEGER NOT NULL DEFAULT 0,                   -- Sum: 3-15
  segment TEXT,                                           -- Champions, Loyal, At Risk, New, Lost
  
  -- Business metrics
  clv NUMERIC(14,2) NOT NULL DEFAULT 0,                   -- Customer Lifetime Value
  churn_risk_score INTEGER NOT NULL DEFAULT 0,            -- 0-100 scale
  
  -- Preferences and behavioral data
  preferred_products TEXT[] DEFAULT '{}',                 -- Top 3 product names
  preferred_categories TEXT[] DEFAULT '{}',               -- Top 3 category names
  preferred_branch_id TEXT,                               -- Most frequent branch
  visit_heatmap JSONB,                                    -- 7x24 visit pattern {day: {hour: count}}
  acquisition_month DATE,                                 -- Month of first order for cohort analysis
  
  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance indexes for fast dashboard queries
CREATE INDEX IF NOT EXISTS idx_ca_phone_normalized ON customer_analytics (phone_normalized) WHERE phone_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ca_foodics_unique_id ON customer_analytics (foodics_unique_id) WHERE foodics_unique_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ca_foodics_id ON customer_analytics (foodics_id) WHERE foodics_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ca_datatech_customer_id ON customer_analytics (datatech_customer_id) WHERE datatech_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ca_last_order_date ON customer_analytics (last_order_date DESC);
CREATE INDEX IF NOT EXISTS idx_ca_segment ON customer_analytics (segment) WHERE segment IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ca_acquisition_month ON customer_analytics (acquisition_month);
CREATE INDEX IF NOT EXISTS idx_ca_updated_at ON customer_analytics (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ca_clv ON customer_analytics (clv DESC);
CREATE INDEX IF NOT EXISTS idx_ca_total_spent ON customer_analytics (total_spent DESC);
CREATE INDEX IF NOT EXISTS idx_ca_orders_count ON customer_analytics (orders_count DESC);

-- Composite indexes for common filter combinations
CREATE INDEX IF NOT EXISTS idx_ca_segment_last_order ON customer_analytics (segment, last_order_date DESC);
CREATE INDEX IF NOT EXISTS idx_ca_source_flags ON customer_analytics (has_foodics, has_datatech);

-- Optional: Monthly activity aggregation table for cohort analysis and trends
CREATE TABLE IF NOT EXISTS customer_activity_monthly (
  customer_merge_key TEXT NOT NULL,
  month DATE NOT NULL,
  orders_count INTEGER NOT NULL DEFAULT 0,
  total_spent NUMERIC(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (customer_merge_key, month)
);

CREATE INDEX IF NOT EXISTS idx_cam_month ON customer_activity_monthly (month);
CREATE INDEX IF NOT EXISTS idx_cam_customer ON customer_activity_monthly (customer_merge_key);

-- Comments for documentation
COMMENT ON TABLE customer_analytics IS 'Merged customer analytics from Foodics and DataTech with RFM segmentation and CLV';
COMMENT ON COLUMN customer_analytics.merge_key IS 'Deterministic deduplication key: fuid:{id} or phone:{e164} or dtid:{id}';
COMMENT ON COLUMN customer_analytics.rfm_score IS 'RFM combined score (3-15): sum of r_score + f_score + m_score';
COMMENT ON COLUMN customer_analytics.segment IS 'Customer segment: Champions, Loyal, At Risk, New, Lost, Others';
COMMENT ON COLUMN customer_analytics.clv IS 'Customer Lifetime Value = AOV * Frequency * Lifespan';

COMMENT ON TABLE customer_activity_monthly IS 'Pre-aggregated monthly customer activity for fast cohort and trend queries';

COMMIT;
