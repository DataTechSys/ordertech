// Temporary redirect patch - can be deployed as a single file change
const express = require('express');
const app = express();

// Override root route with redirect
app.get('/', (req, res) => {
  res.redirect(302, '/admin');
});

console.log('🔀 Redirect patch loaded: / -> /admin');
module.exports = app;