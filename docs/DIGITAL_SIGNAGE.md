# Digital Signage Interface

## Overview

The digital signage interface (`/ds`) displays active products from Foodics in a portrait-optimized grid layout, designed for display screens in your restaurant.

## Features

- **Portrait-optimized layout**: Grid automatically adapts to portrait screens
- **Auto-refresh**: Products refresh every 5 minutes automatically
- **Product cards**: Match the iOS app design with:
  - Square product images
  - Arabic name (if available)
  - English name
  - Price in KWD
- **Responsive**: Adapts to different screen sizes
- **Lazy loading**: Images load as they appear on screen for better performance
- **Error handling**: Graceful error states with retry functionality

## Access

### Production
Navigate to: `https://app.ordertech.me/ds`

### Local Development
Navigate to: `http://localhost:8080/ds`

### Custom Tenant
Add a tenant parameter to display products for a specific tenant:
```
https://app.ordertech.me/ds?tenant=YOUR_TENANT_ID
```

If no tenant is specified, it defaults to the `DEFAULT_TENANT_ID` configured in the server.

## Design

The interface uses the same design tokens as the iOS app:

- **Background**: `#A3B1A4` (sage green)
- **Surface**: `#ffffff` (white cards)
- **Text (ink)**: `#2D2A26` (dark brown)
- **Accent**: `#718472` (muted green)
- **Border**: `#E5E7EB` (light gray)
- **Border radius**: `14px`

### Product Card Layout

Each product card displays:
1. **Image**: Square aspect ratio (88% of card width)
2. **Arabic name**: 13px, semi-bold (hidden if empty)
3. **English name**: 11px, regular
4. **Price**: 12px, semi-bold, accent color (format: `X.XXX KWD`)

## Configuration

### Auto-refresh Interval
The default refresh interval is 5 minutes (300,000ms). To change it, modify the `REFRESH_INTERVAL` constant in `ds.html`:

```javascript
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
```

### Product Filtering
By default, only active products are displayed. The API call includes:
```
/api/v1/products?tenant_id=...&is_active=true&limit=1000
```

## Technical Details

### API Integration
- Fetches products from `/api/v1/products` endpoint
- Filters for active products only
- Auto-refreshes every 5 minutes
- Shows loading, error, and empty states

### Performance
- **Lazy loading**: Images load only when visible
- **Intersection Observer**: Efficient scroll detection
- **Minimal dependencies**: Pure vanilla JavaScript, no frameworks

### Browser Support
- Modern browsers with ES6+ support
- CSS Grid support required
- Intersection Observer API required

## Display Setup

### Recommended Configuration

1. **Screen Orientation**: Portrait
2. **Resolution**: 1080x1920 or higher
3. **Browser**: Chrome, Safari, or Edge (latest versions)
4. **Mode**: Fullscreen (F11 on Windows/Linux, Cmd+Ctrl+F on macOS)
5. **Refresh**: Automatic every 5 minutes

### Kiosk Mode Setup

For dedicated display screens, consider using:

#### Chrome Kiosk Mode (Linux/Windows)
```bash
chromium-browser --kiosk --app=https://app.ordertech.me/ds
```

#### Safari Fullscreen (macOS)
1. Open Safari
2. Navigate to the signage URL
3. Press Cmd+Ctrl+F for fullscreen

#### Browser Extensions
- **Kiosk Mode** extensions for auto-refresh and fullscreen
- **Display Control** for screen wake/sleep management

### Network Requirements

- Stable internet connection
- Access to `app.ordertech.me` (or your server domain)
- HTTPS support (for production)

## Maintenance

### Updating Products
Products are automatically synced from Foodics. To refresh:
1. Update products in Foodics
2. Sync via the admin panel: `/products/`
3. Digital signage will auto-refresh within 5 minutes

### Troubleshooting

#### No Products Displayed
- Check that products are marked as `active` in the database
- Verify the tenant ID is correct
- Check browser console for API errors

#### Images Not Loading
- Verify product `image_url` values in database
- Check CORS settings for external image URLs
- Ensure `/images/placeholder.png` exists for fallback

#### Auto-refresh Not Working
- Check browser console for errors
- Verify stable network connection
- Check that JavaScript is enabled

## Files

- **HTML**: `/ds.html` - Main signage interface
- **Route**: `server.js` line ~4490 - Server route configuration
- **API**: `/api/v1/products` - Products data source

## Future Enhancements

Potential improvements:
- Category filtering
- Featured products section
- Promotional banners
- Animated transitions
- Multi-language toggle
- Day/night themes
- Special offers overlay
