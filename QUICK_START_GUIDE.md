# 🚀 OrderTech Quick Start Guide

## 🏃‍♂️ Local Development Setup (5 minutes)

### 1. **Start Docker Services**
```bash
cd dev
docker compose up -d
```

**Expected Services:**
- ✅ Redis (6379) - Healthy
- ✅ Redis UI (8081) - Management interface  
- ✅ MinIO (9000/9001) - S3-compatible storage
- ✅ pgAdmin (5050) - Database admin

### 2. **Start Node.js Server**
```bash
# With database connection
DATABASE_URL="postgresql://ordertech:Ordertech.2020@localhost:6555/ordertech" \
NODE_ENV=development \
node server.js
```

**Server will be available at:**
- 🌐 **Dashboard**: http://localhost:8080/dashboard
- 🔧 **Admin**: http://localhost:8080/admin  
- 🩺 **Health**: http://localhost:8080/health
- ⚙️ **Config**: http://localhost:8080/config.js

### 3. **Access Admin Interfaces**
- **pgAdmin**: http://localhost:5050
  - User: `admin@ordertech.com`
  - Password: `devpassword`
- **Redis Commander**: http://localhost:8081  
- **MinIO Console**: http://localhost:9001
  - User: `ordertech-dev` 
  - Password: `ordertech-dev-secret`

---

## 🔍 Quick Health Checks

### **All Services Running**
```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

### **Database Connection Test**
```bash
psql "postgresql://ordertech:Ordertech.2020@localhost:6555/ordertech" -c "SELECT current_database();"
```

### **API Response Test**  
```bash
curl http://localhost:8080/health
# Expected: OK
```

### **Dashboard Link Test**
```bash
npx linkinator "http://localhost:8080/dashboard" --recurse --timeout=60000
# Expected: All 200 responses
```

---

## 👥 Tenant Testing

### **Available Test Tenants**
1. **Koobs**: `f8578f9c-782b-4d31-b04f-3b2d890c5896` (Account: 494675)
2. **Fouzi Cafe**: `56ac557e-589d-4602-bc9b-946b201fb6f6` (Account: 532342)

### **Test Tenant-Specific API**
```bash
# Test Koobs tenant
curl -s "http://localhost:8080/admin/tenants/f8578f9c-782b-4d31-b04f-3b2d890c5896/public" | jq

# Test Fouzi Cafe tenant  
curl -s "http://localhost:8080/admin/tenants/56ac557e-589d-4602-bc9b-946b201fb6f6/public" | jq
```

---

## 🚨 Troubleshooting

### **Container Issues**
```bash
# Check container logs
docker logs ordertech-pgadmin
docker logs ordertech-redis
docker logs ordertech-minio

# Restart services
docker compose restart
```

### **Database Connection Issues**
```bash
# Check Cloud SQL Proxy
lsof -i :6555

# Verify database credentials
gcloud secrets versions access latest --secret=DATABASE_URL --project=smart-order-469705
```

### **Port Conflicts**
```bash
# Check what's using ports
lsof -i :8080,5050,6379,9000,9001

# Kill conflicting processes
sudo lsof -ti:8080 | xargs kill
```

---

## 🌐 Production Testing

### **Current Production Service**
- **URL**: https://ordertech-64v5pfkeba-ww.a.run.app
- **Status**: LiveKit enabled and operational
- **Region**: me-central1

### **Quick Production Health Check**
```bash
# Service health
curl -s "https://ordertech-64v5pfkeba-ww.a.run.app/health"

# LiveKit status
curl -s "https://ordertech-64v5pfkeba-ww.a.run.app/admin/rtc/status" | jq '.providers'

# WebRTC config
curl -s "https://ordertech-64v5pfkeba-ww.a.run.app/webrtc/config" | jq '.sfu.enabled'
```

---

## 📋 Development Workflow

### **Daily Startup**
1. `docker compose up -d` (start infrastructure)
2. Start Node.js with DATABASE_URL
3. Open http://localhost:8080/dashboard
4. Begin development

### **Before Deployment**
1. Run link validation: `npx linkinator http://localhost:8080/admin`
2. Test tenant switching in dashboard  
3. Verify database connectivity
4. Check Docker container health

### **Deploy to Production**
```bash
./deploy-cloud-run.sh
```

---

## 🔑 Key Credentials

### **Local Development**
- **Database**: `ordertech:Ordertech.2020@localhost:6555`
- **pgAdmin**: `admin@ordertech.com:devpassword`
- **MinIO**: `ordertech-dev:ordertech-dev-secret`

### **Production Secrets** (Google Secret Manager)
- `DATABASE_URL` - Production database connection
- `livekit-api-key` - LiveKit authentication  
- `livekit-api-secret` - LiveKit authentication
- `livekit-ws-url` - wss://rtc.ordertech.me

---

*Happy coding! 🎉*