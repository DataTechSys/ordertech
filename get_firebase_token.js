#!/usr/bin/env node

/**
 * Helper to extract Firebase authentication token for API usage
 */

console.log(`
🔐 Firebase Token Extraction Guide

To use the API, you need to get your Firebase ID token from the browser:

1. **Open the admin interface:**
   https://app.ordertech.me/products/

2. **Log in to your account** if not already logged in

3. **Open Browser Developer Tools:**
   - Chrome/Edge: Press F12 or Ctrl+Shift+I (Cmd+Opt+I on Mac)
   - Firefox: Press F12 or Ctrl+Shift+I (Cmd+Opt+I on Mac)
   - Safari: Enable Developer menu in Preferences, then Cmd+Opt+I

4. **Go to Console tab**

5. **Run this JavaScript code in the console:**

   // For Firebase v9+ (modular SDK)
   import('https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js').then(async ({ initializeApp }) => {
     const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js');
     const auth = getAuth();
     if (auth.currentUser) {
       const token = await auth.currentUser.getIdToken();
       console.log('🎯 Your Firebase ID Token:');
       console.log(token);
       console.log('\\n📋 Copy this token and paste it in the script as CONFIG.authToken');
     } else {
       console.log('❌ No authenticated user found. Please log in first.');
     }
   });

   // Alternative for older Firebase versions or if the above doesn't work:
   if (window.firebase && window.firebase.auth && window.firebase.auth().currentUser) {
     window.firebase.auth().currentUser.getIdToken().then(token => {
       console.log('🎯 Your Firebase ID Token:');
       console.log(token);
       console.log('\\n📋 Copy this token and paste it in the script as CONFIG.authToken');
     });
   } else {
     console.log('❌ Firebase not found or no authenticated user.');
   }

6. **Copy the token** that appears in the console

7. **Update the import script:**
   - Open: import_product_modifiers_auth.js
   - Find: CONFIG.authToken = null
   - Replace with: CONFIG.authToken = 'your-copied-token-here'
   - Set: CONFIG.adminToken = null (disable admin token)

8. **Run the import:**
   node import_product_modifiers_auth.js

⚠️  **Important Notes:**
- The ID token expires after 1 hour, so you may need to get a fresh one
- Keep the token secure and don't share it
- This token gives access to your account, so handle it carefully

🔄 **Alternative: Use localStorage method**
If the console method doesn't work:
1. Go to Developer Tools > Application tab (or Storage tab in Firefox)
2. Navigate to Local Storage > https://app.ordertech.me
3. Look for keys containing "firebase" or "auth" 
4. The token might be in a key like "firebase:authUser" or similar
`);