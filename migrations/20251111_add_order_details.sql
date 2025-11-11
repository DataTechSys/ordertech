-- Migration: Add detailed order history to customer_analytics
-- Date: 2025-11-11
-- Purpose: Store pre-calculated order metrics for faster analytics

BEGIN;

-- Add order history columns
ALTER TABLE customer_analytics
  ADD COLUMN IF NOT EXISTS order_history JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS channel_preferences JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS time_patterns JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS top_products_detail JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS monthly_spending JSONB DEFAULT '{}'::jsonb;

-- Add indexes for JSONB columns
CREATE INDEX IF NOT EXISTS idx_customer_analytics_order_history ON customer_analytics USING GIN (order_history);
CREATE INDEX IF NOT EXISTS idx_customer_analytics_channel_prefs ON customer_analytics USING GIN (channel_preferences);
CREATE INDEX IF NOT EXISTS idx_customer_analytics_time_patterns ON customer_analytics USING GIN (time_patterns);

-- Comments
COMMENT ON COLUMN customer_analytics.order_history IS 'Last 10 orders: [{date, branch, type, amount, products_count}]';
COMMENT ON COLUMN customer_analytics.channel_preferences IS 'Order type percentages: {dine_in: 40, pickup: 30, delivery: 30}';
COMMENT ON COLUMN customer_analytics.time_patterns IS 'Favorite patterns: {favorite_day: "Monday", favorite_hour: 14, day_distribution: {...}, hour_distribution: {...}}';
COMMENT ON COLUMN customer_analytics.top_products_detail IS 'Top 5 products: [{name, category, quantity, total_spent}]';
COMMENT ON COLUMN customer_analytics.monthly_spending IS 'Last 12 months: {"2025-01": 150.50, "2025-02": 200.00, ...}';

COMMIT;
