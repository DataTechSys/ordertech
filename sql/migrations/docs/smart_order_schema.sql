--
-- PostgreSQL database dump
--

\restrict T7ywWTdL8XaHyE62s8e0hEcC71s7jagMxlpvRBFopsg6q8WxQOHqoDyU4i6RPIB

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: device_activation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.device_activation_status AS ENUM (
    'pending',
    'claimed',
    'expired',
    'canceled'
);


--
-- Name: device_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.device_role AS ENUM (
    'cashier',
    'display'
);


--
-- Name: device_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.device_status AS ENUM (
    'active',
    'revoked'
);


--
-- Name: product_spice_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.product_spice_level AS ENUM (
    'none',
    'mild',
    'medium',
    'hot',
    'extra_hot'
);


--
-- Name: tenant_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tenant_role AS ENUM (
    'owner',
    'admin',
    'manager',
    'viewer'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'owner',
    'admin',
    'staff',
    'viewer'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_activity_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    level text DEFAULT 'info'::text NOT NULL,
    scope text NOT NULL,
    tenant_id uuid,
    actor text,
    action text,
    path text,
    method text,
    status integer,
    duration_ms integer,
    ip text,
    user_agent text,
    meta jsonb
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    log_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    action character varying(100) NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    meta jsonb
);


--
-- Name: branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branches (
    branch_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    branch_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    location text,
    expiry_date date,
    is_active boolean DEFAULT true
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reference text,
    name_localized text,
    image_url text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    deleted boolean DEFAULT false NOT NULL
);


--
-- Name: device_activation_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_activation_codes (
    code text NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    claimed_at timestamp with time zone,
    device_id uuid,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    status public.device_activation_status DEFAULT 'pending'::public.device_activation_status NOT NULL,
    role public.device_role
);


--
-- Name: device_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    event_type text NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devices (
    device_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    device_name text,
    role public.device_role NOT NULL,
    status public.device_status DEFAULT 'active'::public.device_status NOT NULL,
    branch text,
    device_token text NOT NULL,
    activated_at timestamp with time zone,
    revoked_at timestamp with time zone,
    last_seen timestamp with time zone,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    short_code character(6),
    branch_id uuid,
    location text,
    uuid text,
    activation_token character varying(100),
    expiry_date date,
    last_checkin timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: drive_thru_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drive_thru_state (
    tenant_id uuid NOT NULL,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: integration_sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_sync_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    provider text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    ok boolean,
    error text,
    stats jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    email text NOT NULL,
    role public.tenant_role DEFAULT 'viewer'::public.tenant_role NOT NULL,
    token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    redeemed_at timestamp with time zone
);


--
-- Name: modifier_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.modifier_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    reference text,
    min_select integer,
    max_select integer,
    required boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: modifier_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.modifier_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    group_id uuid NOT NULL,
    name text NOT NULL,
    price numeric(10,3) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reference text
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer NOT NULL,
    price numeric(10,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    total numeric(10,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'paid'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: paid_order_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.paid_order_counters (
    tenant_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    current bigint DEFAULT 0 NOT NULL
);


--
-- Name: paid_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.paid_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_no bigint NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid,
    basket_id text NOT NULL,
    osn text,
    cashier_device_id uuid,
    cashier_name text,
    display_device_id uuid,
    location text,
    branch text,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    total numeric(10,3) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'KWD'::text NOT NULL,
    paid_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_to_foodics_at timestamp with time zone,
    foodics_status text,
    foodics_order_id text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    ref text,
    branch_ticket_no bigint,
    customer_name text,
    source text
);


--
-- Name: paid_orders_ticket_no_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.paid_orders_ticket_no_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: paid_orders_ticket_no_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.paid_orders_ticket_no_seq OWNED BY public.paid_orders.ticket_no;


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    permission_id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(100) NOT NULL,
    description text
);


--
-- Name: platform_admin_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_admin_roles (
    admin_id uuid NOT NULL,
    role_id uuid NOT NULL
);


--
-- Name: platform_admin_tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_admin_tenants (
    admin_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_admins (
    admin_id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    full_name text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_permissions (
    code text NOT NULL,
    description text
);


--
-- Name: platform_role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_role_permissions (
    role_id uuid NOT NULL,
    code text NOT NULL
);


--
-- Name: platform_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_roles (
    role_id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_settings (
    id text NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_branch_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_branch_availability (
    product_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    available boolean DEFAULT true NOT NULL,
    price_override numeric(10,3),
    packaging_fee_override numeric(10,3)
);


--
-- Name: product_modifier_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_modifier_groups (
    product_id uuid NOT NULL,
    group_id uuid NOT NULL,
    sort_order integer,
    required boolean,
    min_select integer,
    max_select integer
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    category_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    price numeric(10,3) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    image_url text,
    image_ext text,
    name_localized text,
    description_localized text,
    sku text,
    tax_group_reference text,
    is_sold_by_weight boolean,
    is_active boolean,
    is_stock_product boolean,
    cost numeric(10,3),
    barcode text,
    preparation_time integer,
    calories integer,
    walking_minutes_to_burn_calories integer,
    is_high_salt boolean,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    category_reference text,
    ingredients_en text,
    ingredients_ar text,
    allergens jsonb,
    fat_g numeric(10,3),
    carbs_g numeric(10,3),
    protein_g numeric(10,3),
    sugar_g numeric(10,3),
    sodium_mg integer,
    serving_size text,
    pos_visible boolean DEFAULT true NOT NULL,
    online_visible boolean DEFAULT true NOT NULL,
    delivery_visible boolean DEFAULT true NOT NULL,
    spice_level public.product_spice_level,
    packaging_fee numeric(10,3) DEFAULT 0 NOT NULL,
    image_white_url text,
    image_beauty_url text,
    talabat_reference text,
    jahez_reference text,
    vthru_reference text,
    nutrition jsonb,
    salt_g numeric(10,3)
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    role_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    role_name character varying(50) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rtc_preflight_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rtc_preflight_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    device_id text,
    device_name text,
    scenario_id text,
    provider text,
    policy text,
    connect_time_ms integer,
    rtt_avg_ms integer,
    local_candidate text,
    local_protocol text,
    remote_candidate text,
    remote_protocol text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rtc_session_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rtc_session_stats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    side text NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    metrics jsonb NOT NULL,
    CONSTRAINT rtc_session_stats_side_check CHECK ((side = ANY (ARRAY['cashier'::text, 'display'::text])))
);


--
-- Name: rtc_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rtc_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    basket_id text,
    cashier_device_id uuid,
    display_device_id uuid,
    provider text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    summary jsonb
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    id text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    subscription_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    start_date date,
    end_date date,
    is_active boolean DEFAULT true,
    devices_allowed integer,
    branches_allowed integer,
    notes text
);


--
-- Name: tenant_api_integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_api_integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    provider text NOT NULL,
    label text,
    token_encrypted bytea,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: tenant_brand; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_brand (
    tenant_id uuid NOT NULL,
    display_name text,
    logo_url text,
    color_primary text,
    color_secondary text,
    address text,
    website text,
    contact_phone text,
    contact_email text
);


--
-- Name: tenant_domains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_domains (
    host text NOT NULL,
    tenant_id uuid NOT NULL,
    verified_at timestamp with time zone
);


--
-- Name: tenant_external_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_external_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    provider text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    external_id text NOT NULL,
    external_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tenant_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_permissions (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    permissions jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: tenant_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_settings (
    tenant_id uuid NOT NULL,
    slug text,
    default_locale text,
    currency text,
    timezone text,
    features jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: tenant_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_users (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    invited_at timestamp with time zone,
    accepted_at timestamp with time zone,
    role public.tenant_role DEFAULT 'viewer'::public.tenant_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tenant_users_deleted; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_users_deleted (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    email text,
    role text,
    deleted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    tenant_id uuid NOT NULL,
    company_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    license_limit integer DEFAULT 1 NOT NULL,
    branch_limit integer DEFAULT 3 NOT NULL,
    short_code character(6),
    subdomain character varying(50),
    email character varying(100),
    status character varying(20),
    start_date date,
    renewal_date date,
    plan_type character varying(20)
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    name text,
    password_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    full_name text,
    mobile text,
    photo_url text,
    deleted_at timestamp with time zone,
    status character varying(20),
    last_login timestamp with time zone
);


--
-- Name: webrtc_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webrtc_rooms (
    pair_id text NOT NULL,
    offer text,
    answer text,
    ice_cashier_queued jsonb DEFAULT '[]'::jsonb NOT NULL,
    ice_display_queued jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: paid_orders ticket_no; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paid_orders ALTER COLUMN ticket_no SET DEFAULT nextval('public.paid_orders_ticket_no_seq'::regclass);


--
-- Name: admin_activity_logs admin_activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_activity_logs
    ADD CONSTRAINT admin_activity_logs_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (log_id);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (branch_id);


--
-- Name: branches branches_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_tenant_id_name_key UNIQUE (tenant_id, branch_name);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: device_activation_codes chk_dac_code_6digits; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.device_activation_codes
    ADD CONSTRAINT chk_dac_code_6digits CHECK ((code ~ '^\d{6}$'::text)) NOT VALID;


--
-- Name: products chk_products_packaging_fee_nonneg; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.products
    ADD CONSTRAINT chk_products_packaging_fee_nonneg CHECK ((packaging_fee >= (0)::numeric)) NOT VALID;


--
-- Name: device_activation_codes device_activation_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_activation_codes
    ADD CONSTRAINT device_activation_codes_pkey PRIMARY KEY (code);


--
-- Name: device_events device_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_events
    ADD CONSTRAINT device_events_pkey PRIMARY KEY (id);


--
-- Name: devices devices_device_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_device_token_key UNIQUE (device_token);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (device_id);


--
-- Name: drive_thru_state drive_thru_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drive_thru_state
    ADD CONSTRAINT drive_thru_state_pkey PRIMARY KEY (tenant_id);


--
-- Name: integration_sync_runs integration_sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_sync_runs
    ADD CONSTRAINT integration_sync_runs_pkey PRIMARY KEY (id);


--
-- Name: invites invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_pkey PRIMARY KEY (id);


--
-- Name: invites invites_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_token_key UNIQUE (token);


--
-- Name: modifier_groups modifier_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modifier_groups
    ADD CONSTRAINT modifier_groups_pkey PRIMARY KEY (id);


--
-- Name: modifier_groups modifier_groups_tenant_id_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modifier_groups
    ADD CONSTRAINT modifier_groups_tenant_id_reference_key UNIQUE (tenant_id, reference);


--
-- Name: modifier_options modifier_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modifier_options
    ADD CONSTRAINT modifier_options_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: paid_order_counters paid_order_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paid_order_counters
    ADD CONSTRAINT paid_order_counters_pkey PRIMARY KEY (tenant_id, branch_id);


--
-- Name: paid_orders paid_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paid_orders
    ADD CONSTRAINT paid_orders_pkey PRIMARY KEY (id);


--
-- Name: paid_orders paid_orders_ticket_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paid_orders
    ADD CONSTRAINT paid_orders_ticket_no_key UNIQUE (ticket_no);


--
-- Name: permissions permissions_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_code_key UNIQUE (code);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (permission_id);


--
-- Name: platform_admin_roles platform_admin_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admin_roles
    ADD CONSTRAINT platform_admin_roles_pkey PRIMARY KEY (admin_id, role_id);


--
-- Name: platform_admin_tenants platform_admin_tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admin_tenants
    ADD CONSTRAINT platform_admin_tenants_pkey PRIMARY KEY (admin_id, tenant_id);


--
-- Name: platform_admins platform_admins_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_email_key UNIQUE (email);


--
-- Name: platform_admins platform_admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (admin_id);


--
-- Name: platform_permissions platform_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_permissions
    ADD CONSTRAINT platform_permissions_pkey PRIMARY KEY (code);


--
-- Name: platform_role_permissions platform_role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_role_permissions
    ADD CONSTRAINT platform_role_permissions_pkey PRIMARY KEY (role_id, code);


--
-- Name: platform_roles platform_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_roles
    ADD CONSTRAINT platform_roles_pkey PRIMARY KEY (role_id);


--
-- Name: platform_roles platform_roles_role_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_roles
    ADD CONSTRAINT platform_roles_role_name_key UNIQUE (role_name);


--
-- Name: platform_settings platform_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_settings
    ADD CONSTRAINT platform_settings_pkey PRIMARY KEY (id);


--
-- Name: product_branch_availability product_branch_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_branch_availability
    ADD CONSTRAINT product_branch_availability_pkey PRIMARY KEY (product_id, branch_id);


--
-- Name: product_modifier_groups product_modifier_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_modifier_groups
    ADD CONSTRAINT product_modifier_groups_pkey PRIMARY KEY (product_id, group_id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (role_id);


--
-- Name: roles roles_tenant_id_role_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_tenant_id_role_name_key UNIQUE (tenant_id, role_name);


--
-- Name: rtc_preflight_logs rtc_preflight_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rtc_preflight_logs
    ADD CONSTRAINT rtc_preflight_logs_pkey PRIMARY KEY (id);


--
-- Name: rtc_session_stats rtc_session_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rtc_session_stats
    ADD CONSTRAINT rtc_session_stats_pkey PRIMARY KEY (id);


--
-- Name: rtc_sessions rtc_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rtc_sessions
    ADD CONSTRAINT rtc_sessions_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (subscription_id);


--
-- Name: tenant_api_integrations tenant_api_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_api_integrations
    ADD CONSTRAINT tenant_api_integrations_pkey PRIMARY KEY (id);


--
-- Name: tenant_brand tenant_brand_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_brand
    ADD CONSTRAINT tenant_brand_pkey PRIMARY KEY (tenant_id);


--
-- Name: tenant_domains tenant_domains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_domains
    ADD CONSTRAINT tenant_domains_pkey PRIMARY KEY (host);


--
-- Name: tenant_external_mappings tenant_external_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_external_mappings
    ADD CONSTRAINT tenant_external_mappings_pkey PRIMARY KEY (id);


--
-- Name: tenant_permissions tenant_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_permissions
    ADD CONSTRAINT tenant_permissions_pkey PRIMARY KEY (tenant_id, user_id);


--
-- Name: tenant_settings tenant_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_settings
    ADD CONSTRAINT tenant_settings_pkey PRIMARY KEY (tenant_id);


--
-- Name: tenant_settings tenant_settings_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_settings
    ADD CONSTRAINT tenant_settings_slug_key UNIQUE (slug);


--
-- Name: tenant_users_deleted tenant_users_deleted_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_users_deleted
    ADD CONSTRAINT tenant_users_deleted_pkey PRIMARY KEY (tenant_id, user_id, deleted_at);


--
-- Name: tenant_users tenant_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_users
    ADD CONSTRAINT tenant_users_pkey PRIMARY KEY (tenant_id, user_id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (tenant_id);


--
-- Name: tenants tenants_short_code_digits_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.tenants
    ADD CONSTRAINT tenants_short_code_digits_chk CHECK ((short_code ~ '^[0-9]{6}$'::text)) NOT VALID;


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: webrtc_rooms webrtc_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webrtc_rooms
    ADD CONSTRAINT webrtc_rooms_pkey PRIMARY KEY (pair_id);


--
-- Name: idx_branches_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_branches_tenant ON public.branches USING btree (tenant_id);


--
-- Name: idx_dac_tenant_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dac_tenant_expires ON public.device_activation_codes USING btree (tenant_id, expires_at);


--
-- Name: idx_device_events_tenant_device_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_events_tenant_device_created ON public.device_events USING btree (tenant_id, device_id, created_at);


--
-- Name: idx_devices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_devices_status ON public.devices USING btree (status);


--
-- Name: idx_devices_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_devices_tenant ON public.devices USING btree (tenant_id);


--
-- Name: idx_devices_tenant_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_devices_tenant_role ON public.devices USING btree (tenant_id, role);


--
-- Name: idx_devices_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_devices_tenant_status ON public.devices USING btree (tenant_id, status);


--
-- Name: idx_entityid_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entityid_provider ON public.tenant_external_mappings USING btree (entity_id, provider);


--
-- Name: idx_invites_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invites_tenant ON public.invites USING btree (tenant_id);


--
-- Name: idx_orders_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_tenant_created ON public.orders USING btree (tenant_id, created_at);


--
-- Name: idx_products_tenant_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_tenant_active ON public.products USING btree (tenant_id, active);


--
-- Name: idx_sync_runs_tenant_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_runs_tenant_provider ON public.integration_sync_runs USING btree (tenant_id, provider, started_at DESC);


--
-- Name: idx_tenant_domains_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_domains_tenant_id ON public.tenant_domains USING btree (tenant_id);


--
-- Name: idx_tenant_provider_entitytype_entityid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_provider_entitytype_entityid ON public.tenant_external_mappings USING btree (tenant_id, provider, entity_type, entity_id);


--
-- Name: idx_tud_tenant_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tud_tenant_deleted ON public.tenant_users_deleted USING btree (tenant_id, deleted_at DESC);


--
-- Name: ix_aal_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_aal_action ON public.admin_activity_logs USING btree (action);


--
-- Name: ix_aal_tenant_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_aal_tenant_ts ON public.admin_activity_logs USING btree (tenant_id, ts DESC);


--
-- Name: ix_aal_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_aal_ts ON public.admin_activity_logs USING btree (ts DESC);


--
-- Name: ix_audit_logs_tenant_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_audit_logs_tenant_time ON public.audit_logs USING btree (tenant_id, "timestamp" DESC);


--
-- Name: ix_categories_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_categories_tenant_name ON public.categories USING btree (tenant_id, name);


--
-- Name: ix_categories_tenant_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_categories_tenant_ref ON public.categories USING btree (tenant_id, reference);


--
-- Name: ix_dac_tenant_status_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_dac_tenant_status_expires ON public.device_activation_codes USING btree (tenant_id, status, expires_at DESC);


--
-- Name: ix_device_events_device_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_device_events_device_time ON public.device_events USING btree (device_id, created_at DESC);


--
-- Name: ix_device_events_tenant_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_device_events_tenant_time ON public.device_events USING btree (tenant_id, created_at DESC);


--
-- Name: ix_devices_tenant_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_devices_tenant_branch ON public.devices USING btree (tenant_id, branch);


--
-- Name: ix_devices_tenant_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_devices_tenant_branch_id ON public.devices USING btree (tenant_id, branch_id);


--
-- Name: ix_invites_tenant_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_invites_tenant_email ON public.invites USING btree (tenant_id, email);


--
-- Name: ix_modifier_groups_tenant_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_modifier_groups_tenant_ref ON public.modifier_groups USING btree (tenant_id, reference);


--
-- Name: ix_modifier_options_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_modifier_options_group ON public.modifier_options USING btree (group_id);


--
-- Name: ix_modifier_options_tenant_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_modifier_options_tenant_ref ON public.modifier_options USING btree (tenant_id, reference);


--
-- Name: ix_paid_orders_basket_paid_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_paid_orders_basket_paid_at ON public.paid_orders USING btree (basket_id, paid_at DESC);


--
-- Name: ix_paid_orders_branch_paid_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_paid_orders_branch_paid_at ON public.paid_orders USING btree (branch_id, paid_at DESC);


--
-- Name: ix_paid_orders_tenant_paid_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_paid_orders_tenant_paid_at ON public.paid_orders USING btree (tenant_id, paid_at DESC);


--
-- Name: ix_pat_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pat_admin ON public.platform_admin_tenants USING btree (admin_id);


--
-- Name: ix_pat_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pat_tenant ON public.platform_admin_tenants USING btree (tenant_id);


--
-- Name: ix_pba_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pba_branch ON public.product_branch_availability USING btree (branch_id);


--
-- Name: ix_products_tenant_category_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_products_tenant_category_reference ON public.products USING btree (tenant_id, category_reference);


--
-- Name: ix_products_tenant_catref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_products_tenant_catref ON public.products USING btree (tenant_id, category_reference);


--
-- Name: ix_products_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_products_tenant_name ON public.products USING btree (tenant_id, name);


--
-- Name: ix_roles_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_roles_tenant ON public.roles USING btree (tenant_id);


--
-- Name: ix_rtc_preflight_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_rtc_preflight_tenant_created ON public.rtc_preflight_logs USING btree (tenant_id, created_at DESC);


--
-- Name: ix_rtc_session_stats_session_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_rtc_session_stats_session_ts ON public.rtc_session_stats USING btree (session_id, ts);


--
-- Name: ix_rtc_sessions_basket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_rtc_sessions_basket ON public.rtc_sessions USING btree (basket_id);


--
-- Name: ix_rtc_sessions_cashier_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_rtc_sessions_cashier_started ON public.rtc_sessions USING btree (cashier_device_id, started_at DESC);


--
-- Name: ix_rtc_sessions_display_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_rtc_sessions_display_started ON public.rtc_sessions USING btree (display_device_id, started_at DESC);


--
-- Name: ix_rtc_sessions_tenant_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_rtc_sessions_tenant_started ON public.rtc_sessions USING btree (tenant_id, started_at DESC);


--
-- Name: ix_subscriptions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_subscriptions_tenant ON public.subscriptions USING btree (tenant_id);


--
-- Name: ix_tenant_users_tenant_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tenant_users_tenant_role ON public.tenant_users USING btree (tenant_id, role);


--
-- Name: uniq_tenant_provider_entitytype_externalid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_tenant_provider_entitytype_externalid ON public.tenant_external_mappings USING btree (tenant_id, provider, entity_type, external_id);


--
-- Name: ux_categories_tenant_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_categories_tenant_reference ON public.categories USING btree (tenant_id, reference);


--
-- Name: ux_devices_short_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_devices_short_code ON public.devices USING btree (short_code);


--
-- Name: ux_devices_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_devices_uuid ON public.devices USING btree (uuid);


--
-- Name: ux_products_tenant_jahez_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_products_tenant_jahez_ref ON public.products USING btree (tenant_id, jahez_reference) WHERE (jahez_reference IS NOT NULL);


--
-- Name: ux_products_tenant_talabat_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_products_tenant_talabat_ref ON public.products USING btree (tenant_id, talabat_reference) WHERE (talabat_reference IS NOT NULL);


--
-- Name: ux_products_tenant_vthru_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_products_tenant_vthru_ref ON public.products USING btree (tenant_id, vthru_reference) WHERE (vthru_reference IS NOT NULL);


--
-- Name: ux_tenant_api_integrations_tenant_provider_label; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_tenant_api_integrations_tenant_provider_label ON public.tenant_api_integrations USING btree (tenant_id, provider, COALESCE(label, ''::text));


--
-- Name: ux_tenants_short_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_tenants_short_code ON public.tenants USING btree (short_code) WHERE (short_code IS NOT NULL);


--
-- Name: ux_tenants_subdomain; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_tenants_subdomain ON public.tenants USING btree (subdomain);


--
-- Name: ux_users_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_users_email_lower ON public.users USING btree (lower(email));


--
-- Name: audit_logs audit_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: branches branches_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: categories categories_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id);


--
-- Name: device_activation_codes device_activation_codes_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_activation_codes
    ADD CONSTRAINT device_activation_codes_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(device_id);


--
-- Name: device_activation_codes device_activation_codes_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_activation_codes
    ADD CONSTRAINT device_activation_codes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: device_events device_events_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_events
    ADD CONSTRAINT device_events_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(device_id) ON DELETE CASCADE;


--
-- Name: device_events device_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_events
    ADD CONSTRAINT device_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: devices devices_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id) ON DELETE SET NULL;


--
-- Name: devices devices_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: integration_sync_runs integration_sync_runs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_sync_runs
    ADD CONSTRAINT integration_sync_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: invites invites_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: modifier_groups modifier_groups_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modifier_groups
    ADD CONSTRAINT modifier_groups_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: modifier_options modifier_options_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modifier_options
    ADD CONSTRAINT modifier_options_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.modifier_groups(id) ON DELETE CASCADE;


--
-- Name: modifier_options modifier_options_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modifier_options
    ADD CONSTRAINT modifier_options_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: orders orders_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id);


--
-- Name: paid_orders paid_orders_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paid_orders
    ADD CONSTRAINT paid_orders_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id) ON DELETE SET NULL;


--
-- Name: paid_orders paid_orders_cashier_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paid_orders
    ADD CONSTRAINT paid_orders_cashier_device_id_fkey FOREIGN KEY (cashier_device_id) REFERENCES public.devices(device_id) ON DELETE SET NULL;


--
-- Name: paid_orders paid_orders_display_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paid_orders
    ADD CONSTRAINT paid_orders_display_device_id_fkey FOREIGN KEY (display_device_id) REFERENCES public.devices(device_id) ON DELETE SET NULL;


--
-- Name: paid_orders paid_orders_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paid_orders
    ADD CONSTRAINT paid_orders_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: platform_admin_roles platform_admin_roles_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admin_roles
    ADD CONSTRAINT platform_admin_roles_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.platform_admins(admin_id) ON DELETE CASCADE;


--
-- Name: platform_admin_roles platform_admin_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admin_roles
    ADD CONSTRAINT platform_admin_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.platform_roles(role_id) ON DELETE CASCADE;


--
-- Name: platform_admin_tenants platform_admin_tenants_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admin_tenants
    ADD CONSTRAINT platform_admin_tenants_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.platform_admins(admin_id) ON DELETE CASCADE;


--
-- Name: platform_admin_tenants platform_admin_tenants_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admin_tenants
    ADD CONSTRAINT platform_admin_tenants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: platform_role_permissions platform_role_permissions_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_role_permissions
    ADD CONSTRAINT platform_role_permissions_code_fkey FOREIGN KEY (code) REFERENCES public.platform_permissions(code) ON DELETE CASCADE;


--
-- Name: platform_role_permissions platform_role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_role_permissions
    ADD CONSTRAINT platform_role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.platform_roles(role_id) ON DELETE CASCADE;


--
-- Name: product_branch_availability product_branch_availability_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_branch_availability
    ADD CONSTRAINT product_branch_availability_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id) ON DELETE CASCADE;


--
-- Name: product_branch_availability product_branch_availability_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_branch_availability
    ADD CONSTRAINT product_branch_availability_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_modifier_groups product_modifier_groups_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_modifier_groups
    ADD CONSTRAINT product_modifier_groups_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.modifier_groups(id) ON DELETE CASCADE;


--
-- Name: product_modifier_groups product_modifier_groups_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_modifier_groups
    ADD CONSTRAINT product_modifier_groups_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: products products_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id);


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(permission_id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(role_id) ON DELETE CASCADE;


--
-- Name: roles roles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: rtc_preflight_logs rtc_preflight_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rtc_preflight_logs
    ADD CONSTRAINT rtc_preflight_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: rtc_session_stats rtc_session_stats_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rtc_session_stats
    ADD CONSTRAINT rtc_session_stats_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.rtc_sessions(id) ON DELETE CASCADE;


--
-- Name: rtc_sessions rtc_sessions_cashier_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rtc_sessions
    ADD CONSTRAINT rtc_sessions_cashier_device_id_fkey FOREIGN KEY (cashier_device_id) REFERENCES public.devices(device_id) ON DELETE SET NULL;


--
-- Name: rtc_sessions rtc_sessions_display_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rtc_sessions
    ADD CONSTRAINT rtc_sessions_display_device_id_fkey FOREIGN KEY (display_device_id) REFERENCES public.devices(device_id) ON DELETE SET NULL;


--
-- Name: rtc_sessions rtc_sessions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rtc_sessions
    ADD CONSTRAINT rtc_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: tenant_api_integrations tenant_api_integrations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_api_integrations
    ADD CONSTRAINT tenant_api_integrations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: tenant_brand tenant_brand_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_brand
    ADD CONSTRAINT tenant_brand_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: tenant_domains tenant_domains_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_domains
    ADD CONSTRAINT tenant_domains_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: tenant_external_mappings tenant_external_mappings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_external_mappings
    ADD CONSTRAINT tenant_external_mappings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: tenant_permissions tenant_permissions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_permissions
    ADD CONSTRAINT tenant_permissions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: tenant_permissions tenant_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_permissions
    ADD CONSTRAINT tenant_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: tenant_settings tenant_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_settings
    ADD CONSTRAINT tenant_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: tenant_users_deleted tenant_users_deleted_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_users_deleted
    ADD CONSTRAINT tenant_users_deleted_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: tenant_users tenant_users_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_users
    ADD CONSTRAINT tenant_users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: tenant_users tenant_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_users
    ADD CONSTRAINT tenant_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict T7ywWTdL8XaHyE62s8e0hEcC71s7jagMxlpvRBFopsg6q8WxQOHqoDyU4i6RPIB

