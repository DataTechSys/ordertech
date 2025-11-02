// Test SMTP connection
const nodemailer = require('nodemailer');

async function testSMTP() {
  const user = process.env.ZOHO_EMAIL_USER || 'noreply@datatech.systems';
  const pass = process.env.ZOHO_EMAIL_PASSWORD;
  
  console.log('Testing SMTP with:');
  console.log('User:', user);
  console.log('Pass length:', pass ? pass.length : 0);
  console.log('Pass (trimmed) length:', pass ? pass.trim().length : 0);
  
  const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: {
      user: user,
      pass: pass ? pass.trim() : pass // Trim any whitespace
    },
    debug: true,
    logger: true
  });
  
  try {
    console.log('\nVerifying connection...');
    await transporter.verify();
    console.log('✓ SMTP connection successful!');
    
    console.log('\nSending test email...');
    const info = await transporter.sendMail({
      from: `"Test" <${user}>`,
      to: 'mosawi@koobs.cafe',
      subject: 'Test Email',
      text: 'This is a test email from Zoho SMTP'
    });
    
    console.log('✓ Email sent:', info.messageId);
  } catch (error) {
    console.error('✗ Error:', error.message);
    console.error('Full error:', error);
  }
}

testSMTP();
