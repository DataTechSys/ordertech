# OrderTech Super Admin (.NET)

This is the .NET ASP.NET Core MVC application for the OrderTech super admin dashboard.

## Project Structure

```
admin/
├── Domain/                          # Domain entities & interfaces
│   └── OrderTech.SuperAdmin.Domain/
│       ├── Entities/               # Tenant, User, Order, Branch, Product
│       └── Interfaces/             # ITenantRepository, IUserRepository, IOrderRepository
├── Application/                     # Business logic layer
│   └── OrderTech.SuperAdmin.Application/
│       ├── Interfaces/             # Service interfaces
│       └── Services/               # TenantService, UserService, OrderService
├── Infrastructure/                  # Data access layer
│   └── OrderTech.SuperAdmin.Infrastructure/
│       ├── Data/                   # OrderTechDbContext
│       └── Repositories/           # Repository implementations
└── WebApp/                          # MVC Web application
    └── OrderTech.SuperAdmin.WebApp/
        ├── Controllers/            # MVC controllers
        ├── Views/                  # Razor views
        ├── wwwroot/                # Static assets
        ├── Program.cs              # Application entry point
        ├── appsettings.json        # Configuration
        └── Dockerfile              # Docker container definition
```

## Technology Stack

- **.NET 8.0** - Framework
- **ASP.NET Core MVC** - Web framework
- **Entity Framework Core 8.0** - ORM
- **Pomelo.EntityFrameworkCore.MySql 8.0** - MySQL provider
- **BCrypt.Net-Next** - Password hashing
- **MySQL 8.0** - Database

## Features

- **Tenant Management** - View and manage all tenants
- **User Management** - CRUD operations for users
- **Unified Orders View** - View both cashier and Foodics orders
- **Authentication** - Session-based auth with BCrypt password hashing
- **Clean Architecture** - Separation of concerns (Domain → Application → Infrastructure → WebApp)

## Prerequisites

- .NET 8.0 SDK or later
- MySQL 8.0 (Cloud SQL)
- Cloud SQL Proxy (for local development)
- Docker (for containerization)

## Local Development Setup

### 1. Start Cloud SQL Proxy

```bash
cloud-sql-proxy smart-order-469705:me-central1:ordertech-db --port=6556
```

### 2. Update Connection String

The connection string in `WebApp/OrderTech.SuperAdmin.WebApp/appsettings.json` is already configured for local development:

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=127.0.0.1;Port=6556;Database=ordertech;User=ordertech;Password=Ordertech.2020;"
  }
}
```

### 3. Restore Dependencies

```bash
cd admin
dotnet restore
```

### 4. Build the Solution

```bash
dotnet build
```

### 5. Run the Application

```bash
cd WebApp/OrderTech.SuperAdmin.WebApp
dotnet run
```

The application will be available at: **http://localhost:5000** (or the port shown in console)

## Database Schema

The application expects the following tables in MySQL:

- `tenants` - Tenant organizations
- `users` - User accounts (with role = 'SuperAdmin' for super admins)
- `branches` - Branches per tenant
- `orders` - Cashier orders
- `sales_orders` - Foodics orders (may need to be created)
- `products` - Products per tenant

### Create a Super Admin User

You need to manually create a super admin user in the database:

```sql
INSERT INTO users (id, email, name, password_hash, role, is_active, created_at)
VALUES (
  UUID(),
  'admin@ordertech.me',
  'Super Admin',
  '$2a$11$YourBCryptHashedPasswordHere', -- Use BCrypt to hash password
  'SuperAdmin',
  true,
  NOW()
);
```

To generate a BCrypt hash for a password:

```bash
# Using .NET CLI
dotnet run --project /path/to/password-hasher "yourpassword"
```

Or use an online BCrypt generator.

## Deployment to Cloud Run

### Option 1: Using Cloud Build (Recommended)

```bash
# From the root OrderTech directory
gcloud builds submit --config=admin/cloudbuild.yaml
```

This will:
1. Build the Docker image
2. Push to Google Container Registry
3. Deploy to Cloud Run service `admin-ordertech-me` in `me-central1`

### Option 2: Manual Deployment

```bash
# Build Docker image
cd admin
docker build -t gcr.io/smart-order-469705/admin-ordertech-me:latest \
  -f WebApp/OrderTech.SuperAdmin.WebApp/Dockerfile .

# Push to GCR
docker push gcr.io/smart-order-469705/admin-ordertech-me:latest

# Deploy to Cloud Run
gcloud run deploy admin-ordertech-me \
  --image=gcr.io/smart-order-469705/admin-ordertech-me:latest \
  --region=me-central1 \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=5 \
  --set-env-vars=ASPNETCORE_ENVIRONMENT=Production \
  --set-secrets=ConnectionStrings__DefaultConnection=DATABASE_URL:latest
```

## Environment Variables

### Production (Cloud Run)

Set these via Google Secret Manager:

- `DATABASE_URL` (secret) - MySQL connection string for Cloud SQL
  Format: `Server=/cloudsql/smart-order-469705:me-central1:ordertech-db;Database=ordertech;User=ordertech;Password=***;`

### Local Development

Set in `appsettings.json` or `appsettings.Development.json`.

## Application Configuration

### appsettings.json

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=127.0.0.1;Port=6556;Database=ordertech;User=ordertech;Password=***;"
  },
  "CloudSql": {
    "ConnectionName": "smart-order-469705:me-central1:ordertech-db"
  },
  "GCP": {
    "ProjectId": "smart-order-469705",
    "Region": "me-central1",
    "StorageBucket": "ordertech.me"
  }
}
```

## API Endpoints

### Authentication
- `GET /Auth/Login` - Login page
- `POST /Auth/Login` - Login action
- `GET /Auth/Logout` - Logout

### Dashboard
- `GET /Home/Index` - Main dashboard

### Tenants
- `GET /Tenants/Index` - List all tenants
- `GET /Tenants/Details/{id}` - Tenant details

### Orders
- `GET /Orders/Index` - Unified orders page
- `GET /Orders/GetOrders?tenantId={guid}&limit={int}` - Get orders API

### Users
- `GET /Users/Index` - List all users
- `GET /Users/GetAll` - Get all users (JSON)
- `POST /Users/Create` - Create new user
- `POST /Users/Update` - Update user
- `POST /Users/Delete/{id}` - Delete user

## Authentication & Authorization

The application uses **session-based authentication**:

1. User logs in with email/password
2. Password is verified using BCrypt
3. User role must be `SuperAdmin`
4. Session is created with user info
5. All controllers check session for authentication

To protect a controller/action:

```csharp
public async Task<IActionResult> Index()
{
    var userEmail = HttpContext.Session.GetString("UserEmail");
    if (string.IsNullOrEmpty(userEmail))
    {
        return RedirectToAction("Login", "Auth");
    }
    // ... rest of code
}
```

## Troubleshooting

### Database Connection Issues

**Error**: "Unable to connect to MySQL server"

**Solution**:
1. Ensure Cloud SQL Proxy is running on port 6556
2. Check connection string in appsettings.json
3. Verify database credentials

```bash
# Test connection
mysql -h 127.0.0.1 -P 6556 -u ordertech -p ordertech
```

### Build Errors

**Error**: "Package version conflicts"

**Solution**:
```bash
# Clean and restore
dotnet clean
dotnet restore --force
dotnet build
```

### Login Fails

**Issue**: "Invalid email or password" even with correct credentials

**Solution**:
1. Verify user exists in `users` table
2. Check `role` column = 'SuperAdmin'
3. Verify `is_active` = true
4. Ensure password hash is BCrypt format
5. Try regenerating password hash

### Cloud Run Deployment Fails

**Issue**: Build or deployment errors

**Solution**:
1. Check cloudbuild.yaml syntax
2. Verify GCP project ID
3. Ensure Secret Manager has `DATABASE_URL` secret
4. Check Cloud Run service region is `me-central1`
5. Review Cloud Build logs: `gcloud builds list --limit=5`

## Next Steps

### Features to Add

1. **Audit Logging** - Log all admin actions
2. **Advanced Filtering** - More filter options for orders
3. **Export Data** - Export orders/tenants to CSV/Excel
4. **Analytics Dashboard** - Charts and metrics
5. **Tenant Settings** - Edit tenant configuration
6. **Multi-Factor Authentication** - Add 2FA for admins
7. **API Rate Limiting** - Protect endpoints
8. **Real-time Updates** - Use SignalR for live data

### CSS & Styling

The views reference CSS classes that need to be implemented in `wwwroot/css/site.css`. You can:

1. Copy styles from the old `admin-html-old/` directory
2. Use a CSS framework like Bootstrap or Tailwind
3. Create custom styles

Example CSS classes needed:
- `.page-container`, `.page-header`, `.page-title`
- `.filters-card`, `.filter-row`, `.filter-group`
- `.stats-row`, `.stat-card`, `.stat-value`, `.stat-label`
- `.table-container`, `.table`
- `.badge`, `.btn`, `.input`, `.select`

### JavaScript

Create these JavaScript files in `wwwroot/js/`:

1. **orders.js** - Handle orders loading and filtering
2. **users.js** - Handle user CRUD operations
3. **app.js** - Common utilities

## Production Checklist

Before deploying to production:

- [ ] Update `appsettings.json` with production values
- [ ] Configure HTTPS/SSL certificates
- [ ] Set up Secret Manager for sensitive data
- [ ] Enable Cloud SQL IAM authentication
- [ ] Configure CORS policies
- [ ] Set up monitoring and alerting
- [ ] Configure backups for Cloud SQL
- [ ] Test all functionality
- [ ] Create super admin user in production database
- [ ] Update DNS records for admin.ordertech.me
- [ ] Configure Cloud Armor (optional)
- [ ] Set up log aggregation

## Support & Documentation

- **Main Project**: `/Volumes/MOSAWI-T9/DATATECH/OrderTech/`
- **Old HTML Admin**: `/Volumes/MOSAWI-T9/DATATECH/OrderTech/admin-html-old/`
- **Warp Config**: `/Volumes/MOSAWI-T9/DATATECH/OrderTech/WARP.md`
- **Cloud Run Service**: `admin-ordertech-me`
- **Load Balancer**: `admin-ordertech-lb`
- **Domain**: `https://admin.ordertech.me`

## License

Private - OrderTech Project
