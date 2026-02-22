# PostgreSQL to MySQL Migration Guide

## Current Status

**Database Mismatch Detected**: The codebase currently has a critical configuration error:
- **Cloud SQL Instance**: MySQL 8.0 (`MYSQL_8_0`)
- **Application Code**: Uses PostgreSQL driver (`pg`)
- **Result**: Application cannot connect to database

## Migration Required

### Files Already Updated (Phase 1) ✅
1. ✅ `.env.local` - Changed `postgresql://` to `mysql://`, port 6555 → 6556
2. ✅ `config/ordertech-config.json` - Changed type to "mysql", port to 6556
3. ✅ `WARP.md` - Created with correct MySQL configuration

### Files Requiring Updates (Phase 2)

#### Critical Files
1. **`server.js`** - Main server file
   - Line 27: `const { Pool } = require('pg');` → `const mysql = require('mysql2/promise');`
   - Lines 275-375: PostgreSQL connection logic → MySQL connection logic
   - All `$1, $2, $3` parameter placeholders → `?` placeholders
   - PostgreSQL-specific SQL (gen_random_uuid(), timestamptz, jsonb) → MySQL equivalents

2. **`package.json`**
   - Remove: `"pg": "^8.16.3"`
   - Keep: `"mysql2": "^3.15.3"`

#### Script Files (Many)
All files using `require('pg')` need conversion:
- `import_*.js` files (50+ files)
- `check_*.js` files  
- `test_*.js` files
- `debug_*.js` files
- `sync_*.js` files
- Files in `routes/` directory
- Files in `jobs/` directory

#### Documentation Files
1. `CONFIGURATION.md` - References to PostgreSQL/port 6555
2. `START_SERVER.md` - PostgreSQL connection instructions  
3. `DEPLOYMENT_GUIDE.md` - PostgreSQL migration steps
4. `QUICK_START_GUIDE.md` - PostgreSQL commands
5. `OrderTech_server_info.txt` - PostgreSQL references

### Key Syntax Differences

#### Connection
```javascript
// PostgreSQL (OLD)
const { Pool } = require('pg');
const pool = new Pool({
  host: '127.0.0.1',
  port: 6555,
  user: 'ordertech',
  database: 'ordertech',
  password: 'Ordertech.2020'
});
const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);

// MySQL (NEW)
const mysql = require('mysql2/promise');
const pool = mysql.createPool({
  host: '127.0.0.1',
  port: 6556,
  user: 'ordertech',
  database: 'ordertech',
  password: 'Ordertech.2020'
});
const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
```

#### Query Placeholders
```sql
-- PostgreSQL (OLD)
SELECT * FROM users WHERE id = $1 AND email = $2

-- MySQL (NEW)
SELECT * FROM users WHERE id = ? AND email = ?
```

#### Data Types
```sql
-- PostgreSQL (OLD)
uuid, timestamptz, jsonb, gen_random_uuid()

-- MySQL (NEW)  
CHAR(36) or VARCHAR(36), DATETIME or TIMESTAMP, JSON, UUID()
```

#### UUID Generation
```sql
-- PostgreSQL (OLD)
id uuid PRIMARY KEY DEFAULT gen_random_uuid()

-- MySQL (NEW)
id CHAR(36) PRIMARY KEY DEFAULT (UUID())
```

#### JSON Operations
```sql
-- PostgreSQL (OLD)
meta jsonb
$1::jsonb
meta->>'key'

-- MySQL (NEW)
meta JSON
JSON_OBJECT(...)
JSON_EXTRACT(meta, '$.key')
```

### Migration Strategy

#### Option 1: Full Migration (Recommended)
1. Stop using PostgreSQL driver completely
2. Convert all files to MySQL
3. Update all queries to MySQL syntax
4. Update migrations to MySQL
5. Test thoroughly

#### Option 2: Dual Support (Not Recommended)
- Keep both drivers
- Add abstraction layer
- Too complex, not worth it

### Immediate Action Required

The application **cannot run** in its current state because:
1. Cloud SQL instance is MySQL 8.0
2. Application code uses PostgreSQL driver
3. Connection will fail immediately

### Recommended Next Steps

1. ⚠️ **DO NOT DEPLOY** until migration is complete
2. Create a branch for PostgreSQL → MySQL migration
3. Convert `server.js` first
4. Convert route files
5. Convert migration files
6. Test locally with Cloud SQL Proxy on port 6556
7. Update documentation
8. Deploy after thorough testing

### Testing Checklist

- [ ] Cloud SQL Proxy starts on port 6556
- [ ] Server connects to MySQL successfully
- [ ] Health check `/health` returns OK
- [ ] Database check `/dbz` returns OK
- [ ] Admin panel loads
- [ ] Product catalog loads
- [ ] Orders can be created
- [ ] All migrations run successfully
- [ ] No PostgreSQL references remain in logs

### Port Summary

| Service | Port | Database |
|---------|------|----------|
| OrderTech API | 8080 | - |
| Cloud SQL Proxy (MySQL) | **6556** | MySQL 8.0 |
| ~~Cloud SQL Proxy (PostgreSQL)~~ | ~~6555~~ | ~~Not used~~ |
| Redis | 6379 | - |
| MinIO API | 9000 | - |
| MinIO Console | 9001 | - |

### Questions to Answer

1. **When did this mismatch occur?**
   - Was PostgreSQL used initially?
   - When was Cloud SQL changed to MySQL?
   - Are there any PostgreSQL backups to migrate?

2. **Is there existing data in MySQL?**
   - If yes, do NOT drop database
   - Schema needs to match migration files
   - Verify table structures

3. **Are migrations PostgreSQL-specific?**
   - Check `migrations/*.sql` files
   - May need to rewrite CREATE TABLE statements
   - Check for PostgreSQL-specific functions

### Emergency Rollback

If needed, to rollback:
1. Revert `.env.local` to `postgresql://...@:6555/...`
2. Revert `config/ordertech-config.json`
3. Start PostgreSQL locally or Cloud SQL Proxy to a PostgreSQL instance
4. Deploy previous version

---

**Status**: Migration Not Started  
**Priority**: CRITICAL  
**Impact**: Application Cannot Connect to Database  
**Estimated Effort**: 4-8 hours for full migration  
**Last Updated**: 2026-02-22
