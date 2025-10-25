// drive-thru-local-mode.js
// Extension for drive-thru.js to support standalone local ordering without remote cashier
// Display is the primary controller - this just adds payment/checkout capability when no cashier is connected

(function() {
  'use strict';

  // Local mode state
  let localModeEnabled = false;
  let localOrderNumber = null;
  let isProcessingPayment = false;

  // Configuration
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

  let localModeTimer = null;
  let orderTimeoutTimer = null;

  // Initialize local mode monitoring
  function initializeLocalMode() {
    console.log('[LocalMode] Initializing local mode support');
    
    // Monitor connection state and auto-enable local mode if needed
    const originalConnect = window.connect;
    if (originalConnect) {
      window.connect = function() {
        resetLocalModeTimer();
        return originalConnect.apply(this, arguments);
      };
    }

    // Monitor peer connection status
    const originalSetStatusLabelText = window.setStatusLabelText;
    if (originalSetStatusLabelText) {
      window.setStatusLabelText = function(text, className) {
        // Auto-enable local mode when offline for extended period
        if (className === 'offline' || className === 'ready') {
          startLocalModeTimer();
        } else if (className === 'connected') {
          clearLocalModeTimer();
          if (localModeEnabled) {
            disableLocalMode();
          }
        }
        return originalSetStatusLabelText.apply(this, arguments);
      };
    }

    // Override basket operations for local mode
    setupLocalBasketOperations();
    
    // Add local mode UI elements
    addLocalModeUI();

    // Check if we should start in local mode
    checkInitialLocalModeState();
  }

  function startLocalModeTimer() {
    clearLocalModeTimer();
    localModeTimer = setTimeout(() => {
      if (!window.peersConnected && !window.sessionActive) {
        console.log('[LocalMode] Auto-enabling local mode - no cashier connection detected');
        enableLocalMode();
      }
    }, LOCAL_MODE_CONFIG.AUTO_ENABLE_DELAY);
  }

  function clearLocalModeTimer() {
    if (localModeTimer) {
      clearTimeout(localModeTimer);
      localModeTimer = null;
    }
  }

  function resetLocalModeTimer() {
    clearLocalModeTimer();
    startLocalModeTimer();
  }

  function checkInitialLocalModeState() {
    // If we're not connected and it's been a while, start in local mode
    const lastActivity = localStorage.getItem('DRIVE_LAST_ACTIVITY');
    const now = Date.now();
    
    if (!window.peersConnected && !window.sessionActive) {
      if (!lastActivity || (now - parseInt(lastActivity)) > LOCAL_MODE_CONFIG.AUTO_ENABLE_DELAY) {
        console.log('[LocalMode] Starting in local mode - no recent activity');
        enableLocalMode();
      } else {
        startLocalModeTimer();
      }
    }
  }

  function enableLocalMode() {
    if (localModeEnabled) return;
    
    console.log('[LocalMode] Enabling local mode');
    localModeEnabled = true;
    clearLocalModeTimer();
    
    // Update UI to show local mode
    showLocalModeIndicator();
    
    // Show local checkout button if current basket has items
    if (window.currentBasket && window.currentBasket.items && window.currentBasket.items.length > 0) {
      showLocalCheckoutButton();
    }

    // Hide poster to show the menu
    try {
      if (window.setPosterVisible) {
        window.setPosterVisible(false);
      }
    } catch (e) {
      console.warn('[LocalMode] Could not hide poster:', e);
    }
  }

  function disableLocalMode() {
    if (!localModeEnabled) return;
    
    console.log('[LocalMode] Disabling local mode - cashier connected');
    localModeEnabled = false;
    clearLocalModeTimer();
    
    hideLocalModeIndicator();
    hideLocalCheckoutButton();
    
    // No need to clear basket - Display manages its own basket
  }

  function setupLocalBasketOperations() {
    // No need to override basket operations - Display already manages the basket
    // We just need to monitor basket changes to show/hide checkout button
    
    const originalUpdateBillFromBasket = window.updateBillFromBasket;
    if (originalUpdateBillFromBasket) {
      window.updateBillFromBasket = function(basket) {
        const result = originalUpdateBillFromBasket.apply(this, arguments);
        
        // In local mode, show/hide checkout button based on basket contents
        if (localModeEnabled) {
          if (basket && basket.items && basket.items.length > 0) {
            showLocalCheckoutButton();
          } else {
            hideLocalCheckoutButton();
          }
        }
        
        return result;
      };
    }
  }

  // Use existing Display basket (window.currentBasket) instead of separate local basket
  function getCurrentBasket() {
    return window.currentBasket || { items: [], total: 0, version: 0 };
  }

  function addLocalModeUI() {
    // Add local mode indicator
    const indicator = document.createElement('div');
    indicator.id = 'localModeIndicator';
    indicator.style.cssText = `
      display: none;
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: #f59e0b;
      color: white;
      padding: 8px 16px;
      border-radius: 20px;
      font-weight: bold;
      z-index: 1000;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    `;
    indicator.innerHTML = '🏪 Local Mode - Order directly here';
    document.body.appendChild(indicator);

    // Add local checkout button container
    const checkoutContainer = document.createElement('div');
    checkoutContainer.id = 'localCheckoutContainer';
    checkoutContainer.style.cssText = `
      display: none;
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 1000;
    `;
    
    const checkoutBtn = document.createElement('button');
    checkoutBtn.id = 'localCheckoutBtn';
    checkoutBtn.style.cssText = `
      background: #10b981;
      color: white;
      border: none;
      padding: 16px 24px;
      border-radius: 12px;
      font-size: 18px;
      font-weight: bold;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(16, 185, 129, 0.4);
      transition: transform 0.2s ease;
    `;
    checkoutBtn.textContent = '🛒 Checkout';
    checkoutBtn.onclick = showLocalCheckout;
    checkoutBtn.onmouseenter = function() { this.style.transform = 'translateY(-2px)'; };
    checkoutBtn.onmouseleave = function() { this.style.transform = 'translateY(0)'; };
    
    checkoutContainer.appendChild(checkoutBtn);
    document.body.appendChild(checkoutContainer);
  }

  function showLocalModeIndicator() {
    const indicator = document.getElementById('localModeIndicator');
    if (indicator) {
      indicator.style.display = 'block';
    }
  }

  function hideLocalModeIndicator() {
    const indicator = document.getElementById('localModeIndicator');
    if (indicator) {
      indicator.style.display = 'none';
    }
  }

  function showLocalCheckoutButton() {
    const container = document.getElementById('localCheckoutContainer');
    const basket = getCurrentBasket();
    if (container && basket.items.length > 0) {
      container.style.display = 'block';
    }
  }

  function hideLocalCheckoutButton() {
    const container = document.getElementById('localCheckoutContainer');
    if (container) {
      container.style.display = 'none';
    }
  }

  function showLocalCheckout() {
    const basket = getCurrentBasket();
    if (!localModeEnabled || basket.items.length === 0) {
      return;
    }

    // Create checkout modal
    const modal = document.createElement('div');
    modal.id = 'localCheckoutModal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 500px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      position: relative;
    `;

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
      position: absolute;
      top: 16px;
      right: 16px;
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: #666;
    `;
    closeBtn.onclick = () => document.body.removeChild(modal);

    // Title
    const title = document.createElement('h2');
    title.textContent = 'Complete Your Order';
    title.style.cssText = 'margin: 0 0 24px 0; text-align: center; color: #333;';

    // Order summary
    const summary = document.createElement('div');
    summary.innerHTML = `
      <h3 style="margin: 0 0 16px 0; color: #555;">Order Summary</h3>
      <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
        ${basket.items.map(item => `
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span>${item.name} × ${item.qty}</span>
            <span>${((item.price || 0) * item.qty).toFixed(3)} KWD</span>
          </div>
        `).join('')}
        <hr style="margin: 12px 0; border: none; border-top: 1px solid #dee2e6;">
        <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 18px;">
          <span>Total</span>
          <span>${basket.total.toFixed(3)} KWD</span>
        </div>
      </div>
    `;

    // Payment methods
    const paymentSection = document.createElement('div');
    paymentSection.innerHTML = `
      <h3 style="margin: 0 0 16px 0; color: #555;">Select Payment Method</h3>
      <div id="paymentMethods" style="display: grid; gap: 12px; margin-bottom: 24px;">
        ${LOCAL_MODE_CONFIG.PAYMENT_METHODS.map(method => `
          <button class="payment-method" data-method="${method.id}" style="
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 16px;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            background: white;
            cursor: pointer;
            transition: border-color 0.2s ease;
          ">
            <span style="font-size: 24px;">${method.icon}</span>
            <div style="text-align: left;">
              <div style="font-weight: bold; color: #333;">${method.name}</div>
              <div style="font-size: 14px; color: #666;">${method.nameAr}</div>
            </div>
          </button>
        `).join('')}
      </div>
    `;

    // Confirm button
    const confirmBtn = document.createElement('button');
    confirmBtn.id = 'confirmOrderBtn';
    confirmBtn.textContent = 'Confirm Order';
    confirmBtn.style.cssText = `
      width: 100%;
      padding: 16px;
      background: #10b981;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 18px;
      font-weight: bold;
      cursor: pointer;
      opacity: 0.5;
      pointer-events: none;
      transition: all 0.2s ease;
    `;
    
    let selectedPaymentMethod = null;

    content.appendChild(closeBtn);
    content.appendChild(title);
    content.appendChild(summary);
    content.appendChild(paymentSection);
    content.appendChild(confirmBtn);
    modal.appendChild(content);
    document.body.appendChild(modal);

    // Payment method selection
    const paymentButtons = content.querySelectorAll('.payment-method');
    paymentButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        // Reset all buttons
        paymentButtons.forEach(b => {
          b.style.borderColor = '#e5e7eb';
          b.style.backgroundColor = 'white';
        });
        
        // Highlight selected
        btn.style.borderColor = '#10b981';
        btn.style.backgroundColor = '#f0fdf4';
        
        selectedPaymentMethod = btn.dataset.method;
        
        // Enable confirm button
        confirmBtn.style.opacity = '1';
        confirmBtn.style.pointerEvents = 'auto';
      });
    });

    // Confirm order
    confirmBtn.onclick = () => {
      if (selectedPaymentMethod) {
        processLocalOrder(selectedPaymentMethod);
        document.body.removeChild(modal);
      }
    };

    // Close on outside click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
  }

  function processLocalOrder(paymentMethod) {
    console.log('[LocalMode] Processing order with payment method:', paymentMethod);
    
    const basket = getCurrentBasket();
    if (isProcessingPayment || !basket.items.length) return;
    
    isProcessingPayment = true;

    // Generate order number
    localOrderNumber = generateOrderNumber();

    // Store order locally
    const order = {
      id: localOrderNumber,
      items: [...basket.items],
      total: basket.total,
      paymentMethod: paymentMethod,
      timestamp: new Date().toISOString(),
      basketId: window.basketId || 'local'
    };

    storeLocalOrder(order);

    // Submit order to server if possible
    submitLocalOrder(order);

    // Show receipt
    showLocalReceipt(order);

    // Clear the display's basket by sending empty basket update
    try {
      if (window.updateBillFromBasket) {
        window.updateBillFromBasket({ items: [], total: 0, version: 0 });
      }
    } catch (e) {
      console.warn('[LocalMode] Failed to clear basket after order:', e);
    }
    
    hideLocalCheckoutButton();
    isProcessingPayment = false;

    // Update last activity
    localStorage.setItem('DRIVE_LAST_ACTIVITY', Date.now().toString());
  }

  function generateOrderNumber() {
    const date = new Date();
    const prefix = 'DT'; // Drive-Thru
    const timestamp = date.getTime().toString().slice(-6);
    const random = Math.random().toString(36).substr(2, 3).toUpperCase();
    return `${prefix}${timestamp}${random}`;
  }

  function storeLocalOrder(order) {
    try {
      const orders = JSON.parse(localStorage.getItem('LOCAL_ORDERS') || '[]');
      orders.push(order);
      // Keep only last 50 orders
      const recentOrders = orders.slice(-50);
      localStorage.setItem('LOCAL_ORDERS', JSON.stringify(recentOrders));
    } catch (e) {
      console.error('[LocalMode] Failed to store order locally:', e);
    }
  }

  async function submitLocalOrder(order) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      const token = localStorage.getItem('DEVICE_TOKEN_DISPLAY') || localStorage.getItem('DEVICE_TOKEN');
      if (token) headers['x-device-token'] = token;
      if (window.tenant) headers['x-tenant-id'] = window.tenant;

      const response = await fetch('/orders/local', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(order)
      });

      if (response.ok) {
        console.log('[LocalMode] Order submitted to server successfully');
        // Mark order as synced
        order.synced = true;
        storeLocalOrder(order);
      } else {
        console.warn('[LocalMode] Failed to submit order to server:', response.statusText);
      }
    } catch (e) {
      console.error('[LocalMode] Error submitting order to server:', e);
    }
  }

  function showLocalReceipt(order) {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
    `;

    const receipt = document.createElement('div');
    receipt.style.cssText = `
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      width: 90%;
      text-align: center;
    `;

    const paymentMethodName = LOCAL_MODE_CONFIG.PAYMENT_METHODS
      .find(m => m.id === order.paymentMethod)?.name || 'Unknown';

    receipt.innerHTML = `
      <div style="color: #10b981; font-size: 48px; margin-bottom: 16px;">✓</div>
      <h2 style="margin: 0 0 16px 0; color: #333;">Order Confirmed!</h2>
      <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; margin-bottom: 24px; text-align: left;">
        <div style="font-weight: bold; margin-bottom: 12px; text-align: center;">Order #${order.id}</div>
        ${order.items.map(item => `
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>${item.name} × ${item.qty}</span>
            <span>${((item.price || 0) * item.qty).toFixed(3)} KWD</span>
          </div>
        `).join('')}
        <hr style="margin: 12px 0; border: none; border-top: 1px solid #dee2e6;">
        <div style="display: flex; justify-content: space-between; font-weight: bold;">
          <span>Total</span>
          <span>${order.total.toFixed(3)} KWD</span>
        </div>
        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #dee2e6;">
          <div style="color: #666; font-size: 14px;">Payment: ${paymentMethodName}</div>
          <div style="color: #666; font-size: 14px;">Time: ${new Date(order.timestamp).toLocaleTimeString()}</div>
        </div>
      </div>
      <p style="color: #666; margin-bottom: 24px;">Thank you for your order! Please proceed to the pickup window.</p>
    `;

    modal.appendChild(receipt);
    document.body.appendChild(modal);

    // Auto-close receipt after delay
    setTimeout(() => {
      if (document.body.contains(modal)) {
        document.body.removeChild(modal);
      }
    }, LOCAL_MODE_CONFIG.RECEIPT_DISPLAY_MS);

    // Close on click
    modal.addEventListener('click', () => {
      if (document.body.contains(modal)) {
        document.body.removeChild(modal);
      }
    });
  }

  // No need to override product options - Display already handles this correctly
  // The existing Display basket management will work fine in local mode

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeLocalMode);
  } else {
    initializeLocalMode();
  }

  // Export functions for debugging
  window.localMode = {
    enable: enableLocalMode,
    disable: disableLocalMode,
    isEnabled: () => localModeEnabled,
    getBasket: getCurrentBasket,
    clearBasket: () => {
      // Clear the display basket
      try {
        if (window.updateBillFromBasket) {
          window.updateBillFromBasket({ items: [], total: 0, version: 0 });
        }
      } catch (e) {
        console.warn('[LocalMode] Failed to clear basket:', e);
      }
      hideLocalCheckoutButton();
    }
  };

})();