# Final Inventory Report — OrderTech Cloud SQL (ordertech)

Generated: 2025-09-20T07:17:36Z
Database: ordertech
Search path: saas, catalog, audit, media, public

Summary
- Canonical schemas in use:
  - SaaS core: saas.* (tenants, branches, users, roles, permissions, role_permissions, devices, subscriptions)
  - Catalog domain: catalog.* (categories, products)
  - Audit logs: audit.*
- Legacy public.* duplicates: archived under archive.public__* with timestamps
- saas.tenants now includes company_id (6-digit, unique) and has been backfilled

Schemas and table counts
- audit: 1
- catalog: 36
- media: 2
- public: 30
- saas: 11
- staging: 12

Duplicated table names across schemas (post‑cleanup)
- 34 names remain duplicated (mostly catalog vs public; and a few catalog vs saas):
  - Example pairs: platform_* tables, invites, rtc_*, product_* mappings, etc.
  - These do not impact runtime because search_path prioritizes saas and catalog.

Canonical row counts
- saas.tenants: 2
- saas.branches: 6
- saas.users: 3
- saas.roles: 10
- saas.permissions: 14
- saas.role_permissions: 88
- saas.devices: 3
- saas.subscriptions: 0
- audit.audit_logs: 0
- catalog.categories: 24
- catalog.products: 154

Archive snapshot (public duplicates moved)
- archive.public__categories__20250920064751
- archive.public__products__20250920064751
- archive.public__tenants__20250920065220
- archive.public__branches__20250920065220
- archive.public__users__20250920065220
- archive.public__roles__20250920065220
- archive.public__permissions__20250920065220
- archive.public__role_permissions__20250920065220
- archive.public__devices__20250920065220
- archive.public__subscriptions__20250920065220
- archive.public__audit_logs__20250920065220

Notes and recommendations
- Runtime: With the search_path = saas, catalog, audit, media, public, unqualified table references resolve to canonical tables.
- App is aligned to ordertech DB (not smart_order). Scripts default updated accordingly.
- The catalog vs public duplicates are benign under the current search_path. If you’d like, we can archive those public copies too in a Phase 2 cleanup.
- Consider a retention policy for archive.* (e.g., 30–90 days), after which we can drop those tables.

Files produced
- out/after_inventory.txt — schema counts, duplicates list, canonical counts, archive list
- out/after_structural_diff.txt — column/PK/index comparison across duplicated names

Rollback guide (if ever needed)
- Move a specific archived table back to public (reverse of archive-first):
  - ALTER TABLE archive.public__tenants__YYYYMMDDHHMMSS SET SCHEMA public;
  - ALTER TABLE public.public__tenants__YYYYMMDDHHMMSS RENAME TO tenants;
- Restore previous search_path if desired:
  - ALTER ROLE ordertech IN DATABASE ordertech RESET search_path;

Audit checks
- Views/functions referencing public.* duplicates were not detected in our quick scan (no evidence of hard references). If you want a deeper scan, enable pg_stat_statements or point-in-time code analysis.
