# Foodics Token Server-Based Activation

## Overview
The Foodics API token is now automatically synced from the server during device activation and is no longer hardcoded in the app. This ensures that each device gets the correct token for its associated tenant.

## Changes Made

### 1. Removed Hardcoded Token (`Core.swift`)
**Location**: `OrderTechCore/Sources/OrderTechCore/Core.swift`

**Before**:
```swift
var foodics = getKeychain(Keys.foodicsToken)
// Default Foodics token for Koobs testing
if foodics == nil || foodics?.isEmpty == true {
    foodics = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9..." // Long hardcoded token
}
```

**After**:
```swift
let foodics = getKeychain(Keys.foodicsToken)
```

The hardcoded fallback token has been completely removed. The token now comes exclusively from the server.

### 2. Token Cleared on Deactivation (`ActivationManager.swift`)
**Location**: `ios/OrderTech/DriveThru/Sources/Activation/ActivationManager.swift`

Added code to clear the Foodics token when a device is deactivated:

```swift
func tokenChanged(env: EnvironmentStore, app: AppModel) {
    if env.deviceToken == nil {
        // On deactivation, stop timers and clear cached activation/tenant info
        stop()
        _ = try? LocalCache.delete("activation.json")
        _ = try? LocalCache.delete("tenant.json")
        self.info = nil
        // Clear Foodics token on deactivation
        env.foodicsToken = nil
        print("[Activation] Device deactivated - cleared Foodics token")
    } else {
        // Fresh activation...
    }
}
```

### 3. Settings UI Made Read-Only (`SettingsView.swift`)
**Location**: `ios/OrderTech/DriveThru/Sources/App/SettingsView.swift`

Changed the Foodics token field from an editable `SecureField` to a read-only status display:

**New UI Features**:
- Shows "Active" with green checkmark when token is present
- Shows "Not Available" with orange warning when token is missing
- Displays first 20 characters of token as preview (e.g., `eyJ0eXAiOiJKV1QiLCJh...`)
- Shows informative message: "Token will be automatically synced from server during device activation"

## Server Requirements

The server must provide the Foodics token in the `/manifest` endpoint response. The token can be in any of these fields:

```json
{
  "profile": {
    "foodics_token": "YOUR_TOKEN_HERE",
    // OR
    "foodicsToken": "YOUR_TOKEN_HERE",
    // OR
    "foodics_api_token": "YOUR_TOKEN_HERE"
  },
  // OR at root level
  "foodics_token": "YOUR_TOKEN_HERE"
}
```

The activation manager will try all these field variants and use the first non-empty one found.

## Database Schema

The token should be stored in Cloud SQL:

- **Table**: `foodics_users`
- **Column**: `foodics_api_token`

The server should query this table based on the device's tenant_id and return the token in the manifest response.

## Flow

### Device Activation
1. User enters activation key in the app
2. App claims the activation token from server
3. Server validates and returns device token
4. App calls `/manifest` endpoint with device token
5. Server returns manifest including `foodics_api_token` from database
6. App stores token securely in iOS Keychain
7. Token is now available for all Foodics API calls

### Device Deactivation
1. User removes activation in app settings
2. App clears device token
3. App automatically clears Foodics token from Keychain
4. Catalog sync disabled until device is reactivated

## Security

- Token is stored in iOS Keychain (secure storage)
- Token is never displayed in full (only first 20 characters shown)
- Token is automatically cleared on deactivation
- No hardcoded fallback tokens in production code

## Testing

To test the implementation:

1. **Fresh Activation**:
   - Deactivate device if already activated
   - Enter activation key
   - Go to Settings → Check that Foodics token shows "Active"
   - Try syncing catalog (should work)

2. **Deactivation**:
   - Go to Settings → Remove activation
   - Check that Foodics token shows "Not Available"
   - Try syncing catalog (should be disabled)

3. **Token Persistence**:
   - Activate device
   - Close app completely
   - Reopen app
   - Check that token is still present (loaded from Keychain)

## Migration Notes

For existing activated devices:
- Devices with the old hardcoded token will continue working
- On next app launch, the activation manager will fetch the correct tenant-specific token from server
- The hardcoded token will be replaced with the server-provided token
- No manual intervention required

## Benefits

1. ✅ **Multi-tenant support**: Each tenant can have their own Foodics token
2. ✅ **Security**: No hardcoded tokens in source code
3. ✅ **Flexibility**: Token can be updated on server without app update
4. ✅ **Clean deactivation**: Token automatically removed when device is deactivated
5. ✅ **Better UX**: Users see clear status of token availability
