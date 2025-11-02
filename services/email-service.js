// services/email-service.js
// Email service using Zoho Mail SMTP

const nodemailer = require('nodemailer');

// Zoho Mail SMTP Configuration
const SMTP_CONFIG = {
  host: 'smtp.zoho.com',
  port: 465,
  secure: true, // SSL
  auth: {
    user: process.env.ZOHO_EMAIL_USER ? process.env.ZOHO_EMAIL_USER.trim() : null,
    pass: process.env.ZOHO_EMAIL_PASSWORD ? process.env.ZOHO_EMAIL_PASSWORD.trim() : null
  }
};

// Create reusable transporter
let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport(SMTP_CONFIG);
  }
  return transporter;
}

/**
 * Send verification email
 */
async function sendVerificationEmail(email, verificationToken) {
  try {
    const verificationLink = `https://foodics.ordertech.me/foodics/verify-email.html?token=${verificationToken}`;
    
    const mailOptions = {
      from: `"DataTech Platform" <${process.env.ZOHO_EMAIL_USER || 'noreply@ordertech.me'}>`,
      to: email,
      subject: 'Verify your DataTech account',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #319795 0%, #2c7a7b 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #319795; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome to DataTech!</h1>
            </div>
            <div class="content">
              <h2>Verify your email address</h2>
              <p>Thank you for registering with DataTech. To complete your registration and set your password, please verify your email address by clicking the button below:</p>
              <p style="text-align: center;">
                <a href="${verificationLink}" class="button">Verify Email & Set Password</a>
              </p>
              <p>Or copy and paste this link into your browser:</p>
              <p style="background: white; padding: 10px; border-radius: 4px; word-break: break-all;">
                ${verificationLink}
              </p>
              <p><strong>This link will expire in 24 hours.</strong></p>
              <p>If you didn't create an account with DataTech, you can safely ignore this email.</p>
            </div>
            <div class="footer">
              <p>© 2025 DataTech. All rights reserved.</p>
              <p>foodics.ordertech.me</p>
            </div>
          </div>
        </body>
        </html>
      `
    };
    
    const info = await getTransporter().sendMail(mailOptions);
    console.log('[Email] Verification email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
    
  } catch (error) {
    console.error('[Email] Failed to send verification email:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send password reset email
 */
async function sendPasswordResetEmail(email, resetToken) {
  try {
    const resetLink = `https://foodics.ordertech.me/reset-password?token=${resetToken}`;
    
    const mailOptions = {
      from: `"DataTech Platform" <${process.env.ZOHO_EMAIL_USER || 'noreply@ordertech.me'}>`,
      to: email,
      subject: 'Reset your DataTech password',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #319795 0%, #2c7a7b 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #319795; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Password Reset Request</h1>
            </div>
            <div class="content">
              <h2>Reset your password</h2>
              <p>We received a request to reset your DataTech account password. Click the button below to create a new password:</p>
              <p style="text-align: center;">
                <a href="${resetLink}" class="button">Reset Password</a>
              </p>
              <p>Or copy and paste this link into your browser:</p>
              <p style="background: white; padding: 10px; border-radius: 4px; word-break: break-all;">
                ${resetLink}
              </p>
              <p><strong>This link will expire in 1 hour.</strong></p>
              <p>If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
            </div>
            <div class="footer">
              <p>© 2025 DataTech. All rights reserved.</p>
              <p>foodics.ordertech.me</p>
            </div>
          </div>
        </body>
        </html>
      `
    };
    
    const info = await getTransporter().sendMail(mailOptions);
    console.log('[Email] Password reset email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
    
  } catch (error) {
    console.error('[Email] Failed to send password reset email:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send welcome email after verification
 */
async function sendWelcomeEmail(email, userName) {
  try {
    const mailOptions = {
      from: `"DataTech Platform" <${process.env.ZOHO_EMAIL_USER || 'noreply@ordertech.me'}>`,
      to: email,
      subject: 'Welcome to DataTech - Let\'s get started!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #319795 0%, #2c7a7b 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #319795; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Welcome to DataTech!</h1>
            </div>
            <div class="content">
              <h2>Hi ${userName || 'there'}!</h2>
              <p>Your account is now active and your <strong>14-day free trial</strong> has started!</p>
              <h3>Next Steps:</h3>
              <ol>
                <li><strong>Configure Foodics Integration</strong><br>
                   Add your Foodics Account ID and API Token in the dashboard</li>
                <li><strong>Set up your devices</strong><br>
                   Install the iOS app and activate your devices</li>
                <li><strong>Start taking orders</strong><br>
                   Begin using DriveThru POS for your business</li>
              </ol>
              <p style="text-align: center;">
                <a href="https://foodics.ordertech.me/login.html" class="button">Go to Dashboard</a>
              </p>
              <p>If you have any questions, feel free to reach out to our support team.</p>
            </div>
            <div class="footer">
              <p>© 2025 DataTech. All rights reserved.</p>
              <p>foodics.ordertech.me</p>
            </div>
          </div>
        </body>
        </html>
      `
    };
    
    const info = await getTransporter().sendMail(mailOptions);
    console.log('[Email] Welcome email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
    
  } catch (error) {
    console.error('[Email] Failed to send welcome email:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail
};
