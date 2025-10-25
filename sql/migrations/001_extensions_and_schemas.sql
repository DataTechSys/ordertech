-- Migration: 001_extensions_and_schemas.sql
-- Purpose: Enable required extensions and create logical schemas for organization.

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Logical schemas
CREATE SCHEMA IF NOT EXISTS util;
CREATE SCHEMA IF NOT EXISTS saas;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS staging;
