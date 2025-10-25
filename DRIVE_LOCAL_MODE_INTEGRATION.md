# Drive-Thru Display Local Mode Integration Guide

This guide explains how to integrate local standalone ordering functionality into the drive-thru display application.

## Overview

The **Display** is the primary device that controls the ordering flow. This local mode feature allows the Display to operate independently when no cashier is connected, adding payment/checkout capabilities without requiring a remote cashier connection.

### Architecture Understanding

- **Display** = Primary controller, manages the basket and UI state
- **Cashier** = Secondary device that mirrors/follows the Display
- **Local Mode** = Adds payment capability when no cashier is connected

## Files Created

1. **`js/drive-thru-local-mode.js`** - Local mode extension script
2. **Server endpoint: `/orders/local`** - Handles local orders on the backend  
3. **Integration instructions** - This file

## Integration Steps

### 1. Include Local Mode Script

Add the local mode script to your drive-thru display HTML file:

```html
<!-- Include after the main drive-thru.js script -->
<script src="/js/drive-thru.js"></script>
<script src="/js/drive-thru-local-mode.js"></script>
```

### 2. No Additional HTML Required

The local mode works with the existing Display structure. It uses:
- `window.currentBasket` - Display's existing basket
- `window.updateBillFromBasket()` - Display's existing basket update function
- Existing product selection and options flow

### 3. CSS Styling (Optional)

Add these styles to enhance the local mode UI:

```css
/* Local Mode Indicator */
#localModeIndicator {
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.8; }
}

/* Local Checkout Button */
#localCheckoutBtn:hover {
  background: #059669 !important;
  transform: translateY(-3px) !important;
}

/* Payment Method Buttons */
.payment-method:hover {
  border-color: #10b981 !important;
  background: #f0fdf4 !important;
}

/* Receipt Modal */
.receipt-modal {
  backdrop-filter: blur(4px);
}
```

## How Local Mode Works

### Activation
- **Automatic**: Activates after 30 seconds without cashier connection
- **Manual**: Can be controlled via `window.localMode.enable()`
- **Visual Indicator**: Shows orange "Local Mode" banner at top

### Ordering Flow
1. Customer browses menu normally
2. Products are added to local basket (overrides remote basket operations)
3. "Checkout" button appears when basket has items
4. Customer selects payment method (Cash, Card, K-Net)
5. Order is confirmed and receipt is displayed
6. Order data is submitted to server (if available)

### Payment Methods
Configured in `LOCAL_MODE_CONFIG.PAYMENT_METHODS`:
- Cash (نقد)
- Credit/Debit Card (بطاقة ائتمان) 
- K-Net (كي-نت)

### Order Storage
- **Local Storage**: Orders stored in browser `localStorage` as backup
- **Server Submission**: Orders sent to `/orders/local` endpoint
- **Graceful Degradation**: Works offline, syncs when connection restored

## Configuration Options

Edit the `LOCAL_MODE_CONFIG` object in `drive-thru-local-mode.js`:

```javascript
const LOCAL_MODE_CONFIG = {
  // Auto-enable local mode after this many seconds without cashier connection
  AUTO_ENABLE_DELAY: 30000, // 30 seconds
  
  // Payment methods available in local mode
  PAYMENT_METHODS: [
    { id: 'cash', name: 'Cash', nameAr: 'نقد', icon: '💵' },
    { id: 'card', name: 'Credit/Debit Card', nameAr: 'بطاقة ائتمان', icon: '💳' },
    { id: 'knet', name: 'K-Net', nameAr: 'كي-نت', icon: '🏧' }
  ],
  
  // Order confirmation settings
  ORDER_TIMEOUT_MS: 300000, // 5 minutes for order completion
  RECEIPT_DISPLAY_MS: 10000   // 10 seconds to show receipt
};
```

## Server-Side Requirements

The `/orders/local` endpoint has been added to `server.js` and handles:
- Order validation and storage
- Product ID resolution 
- Device tracking
- Graceful fallbacks when database unavailable

## Testing

### Test Local Mode Activation
1. Open display app in browser
2. Ensure no cashier is connected
3. Wait 30 seconds or run: `window.localMode.enable()`
4. Verify orange "Local Mode" indicator appears

### Test Ordering Flow
1. Add products to basket
2. Click "Checkout" button (appears bottom-right)
3. Select payment method
4. Confirm order
5. Verify receipt displays
6. Check browser console for successful server submission

### Test Cashier Reconnection
1. While in local mode, connect cashier
2. Verify local mode disables automatically
3. Confirm normal remote operation resumes

## Development and Debugging

### Debug Interface
Access via browser console:
```javascript
// Enable/disable local mode manually
window.localMode.enable();
window.localMode.disable();

// Check current state
window.localMode.isEnabled(); // returns true/false

// View local basket
window.localMode.getBasket();

// Clear local basket
window.localMode.clearBasket();
```

### Console Logging
The local mode extension logs key events with `[LocalMode]` prefix:
- Mode activation/deactivation
- Basket operations
- Order processing
- Server communication

### Local Storage Keys
- `DRIVE_LAST_ACTIVITY` - Timestamp of last activity
- `LOCAL_ORDERS` - Array of orders (max 50, for backup)

## Troubleshooting

### Local Mode Not Activating
- Check browser console for errors
- Verify `peersConnected` and `sessionActive` are false
- Confirm timer is not being cleared by connection events

### Orders Not Submitting to Server
- Check network connectivity
- Verify `/orders/local` endpoint is available
- Ensure tenant authentication headers are present
- Orders still save locally as backup

### UI Elements Missing
- Verify required HTML elements exist
- Check CSS conflicts preventing display
- Ensure scripts load in correct order

### Display Not Returning to Remote Mode
- Check WebSocket connection status
- Verify `setStatusLabelText` override is working
- Manually disable with `window.localMode.disable()`

## Security Considerations

- Local orders are validated on server-side
- Payment methods are display-only (actual processing requires external integration)
- Order data includes source tracking (`local_display`)
- Device authentication via tenant tokens maintained

## Future Enhancements

Potential improvements to consider:
- Integration with actual payment processors
- Order status tracking and kitchen display
- Customer notification systems
- Analytics and reporting for local orders
- Multi-language payment method names
- Receipt printing functionality