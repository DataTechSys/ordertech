# OrderTech Dashboard

A comprehensive, real-time monitoring dashboard for all OrderTech services - both local and cloud-based.

## 🎯 Features

### Real-Time Monitoring
- **Local Services**: Express, PostgreSQL, Redis, MinIO, Docker, LiveKit, Whisper
- **Cloud Services**: Cloud Run, Cloud SQL, GCS, Firebase, OpenAI, Secret Manager
- **Live Updates**: WebSocket connections for instant status changes
- **Historical Data**: Service response times and availability tracking

### Pro Dashboard Features
- 📊 **Interactive Charts**: Response times, availability percentages, uptime metrics
- 🔄 **Real-time Updates**: WebSocket-powered live status updates
- 📈 **Performance Graphs**: Historical trends with multiple time ranges
- 🎛️ **Service Controls**: Safe restart actions for Docker containers
- 📤 **Export Options**: CSV, JSON, and PDF reporting
- 🔔 **Smart Alerting**: Slack/Email notifications with deduplication
- 🔐 **Secure Access**: Google OAuth + role-based permissions
- 📝 **Audit Trail**: Complete logging of all actions and changes

### Architecture
- **Backend**: Node.js + Express + Socket.IO + PostgreSQL + Knex
- **Frontend**: React + Vite + TailwindCSS + Chart.js (coming soon)
- **Database**: PostgreSQL with structured schemas for configs, history, settings
- **Real-time**: Socket.IO for live updates and notifications
- **Security**: Helmet, CORS, rate limiting, input validation

## 🚀 Quick Start

### Automated Setup (Recommended)

```bash
# Development mode (port 8080, no sudo required)
./start-dashboard.sh dev

# Production mode (port 80, requires sudo)
./start-dashboard.sh prod
```

### Manual Setup

### 1. Environment Setup

Copy the environment template:
```bash
cp server/.env.dashboard.example server/.env.dashboard
```

Edit `server/.env.dashboard` with your actual values:
```bash
# Core Configuration
DATABASE_URL=postgres://ordertech:password@127.0.0.1:6555/smart_order
REDIS_URL=redis://127.0.0.1:6379

# GCP Configuration  
GCP_PROJECT=smart-order-469705
GCP_REGION=me-central1
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Security
DASHBOARD_JWT_SECRET=your-super-secret-32-char-key
ALLOWED_GOOGLE_WORKSPACE_DOMAIN=ordertech.me

# Optional: Alerting
ALERT_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

### 2. Database Setup

Run migrations and seed initial data:
```bash
npm run dashboard:setup
```

This will:
- Create all required database tables
- Seed initial service configurations for monitoring
- Set up default dashboard settings

### 3. Start the Dashboard

**Development mode (port 8080, no sudo required):**
```bash
npm run dashboard:dev
```

**Standard mode (port 8080):**
```bash
npm run dashboard:start
```

**Production mode (port 80, requires sudo):**
```bash
npm run dashboard:prod
```

The dashboard will be available at:
- **Development**: http://localhost:8080/server
- **Production**: http://localhost/server (port 80)
- **API**: http://localhost:8080/api/dashboard/summary (or port 80)
- **Health Check**: http://localhost:8080/health (or port 80)
- **Production**: app.ordertech.me/server

## 📊 Services Monitored

### Local Services (Port-based)
| Service | Port | Type | Description |
|---------|------|------|-------------|
| Express Main | 3000 | HTTP | Main OrderTech server |
| PostgreSQL | 6555 | TCP | Database via Cloud SQL Proxy |
| Redis | 6379 | TCP | Cache and sessions |
| Redis Commander | 8081 | HTTP | Redis admin UI |
| MinIO API | 9000 | TCP | S3-compatible storage |
| MinIO Console | 9001 | HTTP | MinIO admin UI |
| pgAdmin | 5050 | HTTP | Database admin |
| LiveKit | 7880/7881/7882 | HTTP/TCP/UDP | RTC server |
| Whisper | 8000 | HTTP | Speech transcription |
| Docker | socket | Docker API | Container management |

### Cloud Services (me-central1)
| Service | Type | Description |
|---------|------|-------------|
| Cloud Run | GCP | OrderTech production service |
| Cloud SQL | GCP | Production PostgreSQL |
| Cloud Storage | GCP | File storage bucket |
| Firebase Admin | GCP | Authentication & database |
| Secret Manager | GCP | Secure configuration |
| OpenAI API | External | AI/ML services |
| Load Balancer | Global | app.ordertech.me |

## 🔧 API Endpoints

### Dashboard API
```bash
# Get dashboard summary
GET /api/dashboard/summary

# Get all services status
GET /api/services

# Get specific service details  
GET /api/services/:id

# Run health check on service
GET /api/services/:id/health
```

### Configuration API (Admin only)
```bash
# Service configurations
GET/POST /api/configs
GET/PATCH/DELETE /api/configs/:id

# Dashboard settings
GET/PATCH /api/settings
```

### Action API (Admin only)
```bash
# Restart service/container
POST /api/actions/restart
{
  "service_id": "uuid",
  "confirm": true
}

# Docker operations
POST /api/actions/docker
{
  "operation": "restart",
  "target": "container-name"
}
```

## 🔌 WebSocket Events

Connect to WebSocket for real-time updates:
- **Development**: `ws://localhost:8080`
- **Production**: `ws://localhost` (port 80)

### Client → Server
```javascript
// Join service monitoring
socket.emit('join-service', { service_id: 'uuid' });

// Join overview room  
socket.emit('join-overview');
```

### Server → Client
```javascript
// Service status update
socket.on('status:update', {
  service_id: 'uuid',
  status: 'up|down|degraded|unknown',
  response_time: 150,
  timestamp: '2024-01-01T00:00:00Z'
});

// Bulk status on connect
socket.on('status:bulk', [/* array of service statuses */]);

// Settings changed
socket.on('settings:update', { key: 'value' });
```

## 📈 Database Schema

### service_configs
- Service definitions with connection details
- Status tracking and metadata
- Enable/disable flags and timeouts

### service_status_history  
- Time-series data for response times
- Status transitions over time
- Error details and debugging info

### dashboard_settings
- Configurable thresholds and intervals
- Alert settings and integrations
- Cached availability calculations

### audit_logs
- Complete audit trail of actions
- User attribution and timestamps
- Before/after change tracking

## 🔐 Security Features

- **Helmet**: Security headers (CSP, HSTS, etc.)
- **CORS**: Restricted to ordertech.me domains
- **Rate Limiting**: API and admin action limits
- **Input Validation**: Zod schemas for all inputs
- **Authentication**: Google OAuth integration
- **Authorization**: Role-based access control
- **Audit Logging**: Complete action tracking

## 📱 Coming Soon

### Full React Frontend
- Interactive service grid with real-time status
- Detailed graphs and metrics visualization  
- Configuration management interface
- Alert management and acknowledgments
- Advanced filtering and search
- Mobile-responsive design

### Advanced Features
- Prometheus metrics endpoint
- Custom service checker plugins
- Advanced alerting rules engine
- Multi-tenant support
- Service dependency mapping
- Performance regression detection

## 🛠️ Development

### Project Structure
```
server/
├── dashboard-server.js      # Main Express application
├── lib/
│   ├── db.js               # Database client and helpers
│   └── logger.js           # Structured logging
├── routes/                 # API route handlers
├── ws/                     # WebSocket handlers  
├── monitors/               # Service health checkers
├── services/               # External service integrations
├── migrations/             # Database schema changes
├── seeds/                  # Initial data setup
└── public/                 # Frontend static files
```

### Adding New Services

1. Add service config to `seeds/001_initial_services.js`:
```javascript
{
  name: 'my-service',
  type: 'http',
  host: '127.0.0.1',
  port: 8080,
  region: 'local',
  description: 'My custom service',
  metadata: { health_path: '/health' }
}
```

2. Implement service checker in `monitors/checkers/`:
```javascript
async function myServiceChecker(config) {
  // Implementation
  return {
    status: 'up|down|degraded|unknown',
    responseTimeMs: 150,
    details: { /* additional info */ }
  };
}
```

3. Register checker in monitor manager
4. Re-run seeds: `npm run dashboard:seed`

## 🔍 Troubleshooting

### Common Issues

**Database Connection Failed**
- Ensure Cloud SQL Proxy is running on port 6555
- Check DATABASE_URL in .env.dashboard
- Run `npm run dashboard:migrate` to create tables

**Service Not Detected**
- Check service is running and accessible
- Verify port/host configuration in service_configs table
- Check dashboard logs for connection errors

**WebSocket Connection Issues**  
- Verify CORS settings for your domain
- Check browser developer tools for errors
- Ensure Socket.IO client library is loaded

### Logs and Debugging

View dashboard logs:
```bash
# Development (pretty printed)
npm run dashboard:dev

# Production (JSON structured)
NODE_ENV=production npm run dashboard:start
```

Check database:
```bash
# Connect to database
psql $DATABASE_URL

# View service statuses
SELECT name, status, updated_at FROM service_configs ORDER BY updated_at DESC;

# View recent history
SELECT sc.name, ssh.status, ssh.response_time_ms, ssh.timestamp 
FROM service_status_history ssh
JOIN service_configs sc ON ssh.service_id = sc.id
WHERE ssh.timestamp > NOW() - INTERVAL '1 hour'
ORDER BY ssh.timestamp DESC;
```

---

**Built with ❤️ for OrderTech**