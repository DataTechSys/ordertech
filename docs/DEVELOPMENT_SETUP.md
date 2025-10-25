# OrderTech Development Setup

This document explains how to set up the OrderTech development environment with database connectivity.

## 🚀 Quick Start

1. **Copy environment template:**
   ```bash
   cp .env.example .env.local
   ```

2. **Edit database configuration in `.env.local`:**
   ```bash
   DATABASE_URL=postgresql://postgres:your_password@localhost:6555/ordertech
   ```

3. **Run setup script:**
   ```bash
   ./setup-db.sh
   ```

## 🗄️ Database Configuration

### Local Development
- **Database proxy port:** `6555`
- **Server port:** `3000`
- **Environment file:** `.env.local`

### Required Environment Variables
```bash
# Database connection
DATABASE_URL=postgresql://user:password@localhost:6555/database_name

# Server configuration
PORT=3000
NODE_ENV=development
DEV_OPEN_ADMIN=1
```

### Starting Cloud SQL Proxy
```bash
# IMPORTANT: Always use me-central1 region
cloud_sql_proxy --credentials-file=path/to/key.json smart-order-469705:me-central1:your-instance --port 6555
```

## 🌐 Cloud Run Deployment

1. **Deploy with script:**
   ```bash
   ./deploy-cloud-run.sh
   ```

2. **Configure database connection:**
   ```bash
   # For Cloud SQL - IMPORTANT: Always use me-central1
   gcloud run services update ordertech
     --region me-central1 \\
     --add-cloudsql-instances "smart-order-469705:me-central1:your-instance-name" \\
     --set-env-vars "PGHOST=/cloudsql/smart-order-469705:me-central1:your-instance-name" \\
     --set-env-vars "PGUSER=your-db-user" \\
     --set-env-vars "PGDATABASE=your-db-name" \\
     --set-env-vars "PGPASSWORD=your-db-password"
   ```

## 🔧 Modifier Sync

### Endpoints
- **Local:** `POST http://localhost:3000/admin/sync-modifiers/final`
- **Cloud:** `POST https://your-service-url/admin/sync-modifiers/final`

### Testing
```bash
# Test database connection
curl http://localhost:3000/health

# Run modifier sync
curl -X POST http://localhost:3000/admin/sync-modifiers/final

# Check admin page
open http://localhost:3000/admin
```

## 📂 File Structure
```
OrderTech/
├── .env.example          # Environment template
├── .env.local           # Local development config (git-ignored)
├── setup-db.sh          # Local setup script
├── deploy-cloud-run.sh  # Cloud deployment script
├── final_modifier_sync.js # Working modifier sync
└── server.js            # Main server file
```

## 🚨 Troubleshooting

### "db_required" Error
- Check if Cloud SQL proxy is running on port 6555
- Verify DATABASE_URL in .env.local
- Ensure dotenv is loading environment variables

### Admin Page Not Found
- Server should serve /admin route to index.html
- Check if server is running on correct port
- Verify static routes are configured

### Modifier Sync Issues
- Ensure database schema is using `catalog` schema
- Check foreign key constraints are properly configured
- Verify CSV data is accessible at /product_modifiers.csv

## 🎯 Key Commands
```bash
# Local development
npm start                    # Start server
./setup-db.sh               # Setup database
lsof -i:3000                # Check if server running
lsof -i:6555                # Check if proxy running

# Cloud deployment
./deploy-cloud-run.sh       # Deploy to Cloud Run
gcloud run services list    # List services
gcloud run logs read        # View logs
```