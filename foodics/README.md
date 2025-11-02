# Foodics Platform Integration - OrderTech

## Overview
Complete multi-tenant SaaS platform for Foodics-integrated services including Loyalty Programs, DriveThru Systems, and Digital Signage.

## 🚀 Features Implemented

### ✅ Authentication & User Management
- **Registration System**: Auto-generates unique 6-digit Foodics IDs
- **JWT Authentication**: 7-day token expiration with Bearer token support
- **Password Reset**: Secure token-based password recovery
- **Multi-Tenant Isolation**: Each tenant has isolated data and devices

### ✅ Subscription Management
- **14-Day Free Trial**: Automatic activation on signup with 1 free device
- **Device Licensing**: Per-device subscription model
- **Trial Tracking**: Days remaining calculation and expiration warnings
- **Upgrade Paths**: Easy license purchases for additional devices

### ✅ Device Management
- **Multi-Device Support**: Loyalty, DriveThru, and Digital Signage devices
- **Device Lifecycle**: Inactive → Active states with activation tokens
- **License Keys**: Unique keys generated for each device
- **Usage Tracking**: Real-time used/available device count

### ✅ Tenant Dashboard
- **Profile Management**: Company info, phone, email updates
- **Subscription Overview**: Plan type, status, trial expiration
- **Device Stats**: Active/inactive device counts
- **Quick Actions**: Add devices, configure API

### ✅ API Configuration
- **Foodics Integration**: API key and secret management
- **Webhook Support**: Optional webhook URL configuration
- **Business Reference**: Optional Foodics business ID
- **Connection Status**: Visual indicators for API health

## 📂 File Structure

```
/Users/mosawi/DATATECH/OrderTech/
├── foodics/
│   ├── index.html              # Landing page with service cards
│   ├── login.html              # Login with Foodics ID or email
│   ├── register.html           # Registration with 14-day trial
│   ├── dashboard.html          # Main tenant dashboard
│   ├── devices.html            # Device management interface
│   ├── api-config.html         # Foodics API configuration
│   ├── products.html           # Product information page
│   ├── prices.html             # Pricing and plans page
│   └── README.md               # This file
├── routes/
│   └── foodics-api.js          # All Foodics API endpoints
├── sql/migrations/
│   └── 006_foodics_schema.sql  # Database schema
└── server.js                   # Main server (integrated)
```

## 🔌 API Endpoints

### Authentication
- `POST /api/foodics/auth/register` - Create new account
- `POST /api/foodics/auth/login` - Login with Foodics ID/email
- `POST /api/foodics/auth/forgot-password` - Request password reset
- `POST /api/foodics/auth/reset-password` - Reset password with token

### User Profile
- `GET /api/foodics/user/profile` - Get current user profile
- `PUT /api/foodics/user/profile` - Update profile info

### Devices
- `GET /api/foodics/devices` - List all user devices
- `POST /api/foodics/devices` - Add new device
- `POST /api/foodics/devices/:id/activate` - Activate device
- `DELETE /api/foodics/devices/:id` - Remove device

### Subscription
- `GET /api/foodics/subscription` - Get subscription details
- `POST /api/foodics/subscription/purchase-licenses` - Buy more devices

### Activity
- `GET /api/foodics/activity` - View activity logs

## 🗄️ Database Schema

### Tables Created
1. **foodics_users** - User accounts with 6-digit Foodics IDs
2. **foodics_subscriptions** - Subscription plans and trials
3. **foodics_devices** - Device licenses and activations
4. **foodics_password_resets** - Password reset tokens
5. **foodics_email_verifications** - Email verification tokens
6. **foodics_activity_logs** - Audit trail of all actions

## 🔐 Authentication Flow

1. User registers → Receives unique 6-digit Foodics ID
2. System creates 14-day trial subscription with 1 device
3. JWT token issued (7-day expiration)
4. Token stored in `localStorage` as `foodics_token`
5. All API requests include `Authorization: Bearer <token>`

## 💳 Subscription Logic

### Trial Period
- **Duration**: 14 days from registration
- **Included**: 1 device license
- **Status**: Active trial
- **Expiration**: Warning shown 7 days before end

### Paid Plans
- **Starter**: $49/month - 1 device
- **Professional**: $99/month - 3 devices
- **Enterprise**: Custom pricing - unlimited devices
- **Additional Licenses**: $15/device/month

## 🛠️ Development Setup

### Prerequisites
- Node.js 16+
- PostgreSQL 13+
- Express.js server

### Environment Variables
```bash
FOODICS_JWT_SECRET=your-secret-key-here
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```

### Start the Server
```bash
cd /Users/mosawi/DATATECH/OrderTech
npm start
```

### Access the Platform
- Landing Page: `http://localhost:8080/foodics/`
- Login: `http://localhost:8080/foodics/login.html`
- Register: `http://localhost:8080/foodics/register.html`
- Dashboard: `http://localhost:8080/foodics/dashboard.html`

## 📡 Production Deployment

### Domain Configuration
The platform is designed to run on `foodics.ordertech.me`:
- Update CORS settings in server.js to allow subdomain
- Configure SSL certificates for HTTPS
- Update API_BASE in frontend files if needed

### Database Migration
```bash
# Run the Foodics schema migration
psql -h your-host -U your-user -d your-db -f sql/migrations/006_foodics_schema.sql
```

## 🔒 Security Features

1. **Password Hashing**: bcrypt with 10 rounds
2. **JWT Tokens**: Signed with secret, 7-day expiration
3. **Device Tokens**: Crypto-random 32-byte hex strings
4. **License Keys**: Crypto-random 16-byte hex strings
5. **SQL Injection**: Parameterized queries throughout
6. **Activity Logging**: All tenant actions tracked

## 📊 Monitoring & Analytics

### Activity Logs
Every action is logged with:
- User ID
- Action type (user_registered, device_added, etc.)
- Description
- IP address
- User agent
- Timestamp

### Subscription Tracking
- Trial start/end dates
- Payment status
- Device usage vs. limits
- Auto-renewal settings

## 🚦 Next Steps (Remaining)

### Payment Integration (TODO)
The subscription system has placeholder for payment gateway:
- Integrate Stripe or PayPal
- Add payment webhook handlers
- Implement invoice generation
- Add credit card storage

### Email Notifications (TODO)
- Welcome emails on registration
- Password reset emails
- Trial expiration warnings
- Payment receipts
- Device activation confirmations

### Advanced Features (TODO)
- User invitation system
- Team/sub-user management
- Detailed analytics dashboard
- Export activity logs
- API rate limiting
- Webhook events for devices

## 📝 Notes

- All Foodics IDs are 6 digits (e.g., 123456)
- Device types: `loyalty`, `drivethru`, `signage`
- Device status: `inactive`, `active`
- Subscription status: `active`, `expired`, `cancelled`
- All timestamps use PostgreSQL TIMESTAMPTZ
- Frontend uses localStorage for auth tokens
- API uses standard REST conventions

## 🔗 Related Documentation

- [Foodics Developer Docs](https://developers.foodics.com/guides/introduction.html)
- [OrderTech Main Repo](https://github.com/DataTechSys/ordertech)

## 🐛 Troubleshooting

### "Database connection failed"
- Check DATABASE_URL environment variable
- Verify PostgreSQL is running
- Run migrations: `npm run migrate`

### "Foodics routes not found"
- Ensure routes/foodics-api.js exists
- Check server.js has Foodics integration
- Restart the server

### "Token expired"
- Tokens expire after 7 days
- User must login again
- Check JWT_SECRET is consistent

---

**Built with ❤️ by OrderTech for Foodics Partners**
