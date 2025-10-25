# Starting OrderTech Server - Quick Reference

## 🚀 Correct Way to Start the Server

To ensure the server loads environment variables from `.env.local` properly:

```bash
cd /Users/mosawi/DATATECH/OrderTech
node -r dotenv/config server.js dotenv_config_path=.env.local
```

Or for background execution:

```bash
cd /Users/mosawi/DATATECH/OrderTech
nohup node -r dotenv/config server.js dotenv_config_path=.env.local > server.log 2>&1 &
```

## 🔧 Environment Configuration

The server requires these key settings in `.env.local`:

- `DEV_OPEN_ADMIN=1` - Enables development bypass for admin authentication
- `PORT=3000` - Server port
- `NODE_ENV=development` - Development mode
- Database and AI configurations as needed

## ✅ Verify Setup

Run the authentication test:

```bash
node test_admin_auth.js
```

Expected output should show all tests passing with 100% success rate.

## 🌐 Access Points

- **Admin Panel**: http://localhost:3000/admin
- **Main Application**: http://localhost:3000
- **API Base**: http://localhost:3000/api
- **Device Management**: http://localhost:3000/devices

## 🔍 Troubleshooting

### 401 Unauthorized Errors

If you see 401 errors in the admin panel:

1. **Check server environment**:
   ```bash
   curl -s "http://localhost:3000/config.js" | grep devOpenAdmin
   ```
   Should return: `window.devOpenAdmin=true;`

2. **Restart server properly**:
   ```bash
   # Stop any running instances
   pkill -f "node.*server.js"
   
   # Start with environment loading
   node -r dotenv/config server.js dotenv_config_path=.env.local
   ```

3. **Verify environment file**:
   ```bash
   grep DEV_OPEN_ADMIN .env.local
   ```
   Should return: `DEV_OPEN_ADMIN=1`

### Common Issues

- **Server not loading .env.local**: Always use `-r dotenv/config` flag
- **Port conflicts**: Check if port 3000 is already in use
- **Database errors**: Check PostgreSQL connection if database features are needed

## 📝 Development Notes

- The `DEV_OPEN_ADMIN=1` setting bypasses Firebase authentication for local development
- This is only for development environments - never use in production
- The server supports both development bypass and Firebase authentication modes
- Admin panel functionality includes tenant management, user management, and system configuration

## 🔐 Security

- Development bypass is controlled by `DEV_OPEN_ADMIN` environment variable
- Only works when explicitly enabled
- Authentication is still enforced in production environments
- Firebase configuration can be added later for proper authentication

---

Last updated: October 7, 2025