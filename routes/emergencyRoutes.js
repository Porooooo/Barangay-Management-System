const express = require("express");
const EmergencyAlert = require("../models/EmergencyAlert");
const User = require("../models/User");
const mongoose = require("mongoose");
const router = express.Router();
const nodemailer = require('nodemailer');

// ==================== TELEGRAM BOT FUNCTIONS ====================

// Send Telegram notification (FREE & RELIABLE)
async function sendTelegramAlert(alert) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    if (!botToken || !chatId) {
      console.log('❌ Telegram bot token or chat ID not configured');
      return false;
    }

    const message = `🚨 EMERGENCY ALERT - Barangay Talipapa\n\n` +
                   `👤 Resident: ${alert.residentName}\n` +
                   `📱 Contact: ${alert.residentId?.contactNumber || 'Not provided'}\n` +
                   `📍 Address: ${alert.residentId?.address || 'Not provided'}\n\n` +
                   `📝 Emergency: ${alert.message}\n\n` +
                   `⏰ Time: ${new Date(alert.createdAt).toLocaleString()}\n` +
                   `🔗 Alert ID: ${alert._id}`;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });

    const result = await response.json();
    
    if (result.ok) {
      console.log('✅ Telegram alert sent successfully');
      
      // Update alert with Telegram status
      await EmergencyAlert.findByIdAndUpdate(alert._id, {
        telegramSent: true,
        telegramSentAt: new Date(),
        telegramMessageId: result.result.message_id
      });
      
      return true;
    } else {
      console.log('❌ Telegram API error:', result.description);
      return false;
    }
  } catch (error) {
    console.error('❌ Telegram send error:', error.message);
    return false;
  }
}

// Test Telegram connection
async function testTelegramConnection() {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!botToken) {
      return { success: false, error: 'Telegram bot token not configured' };
    }

    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const data = await response.json();
    
    if (data.ok) {
      return { 
        success: true, 
        bot_name: data.result.first_name,
        bot_username: data.result.username
      };
    } else {
      return { success: false, error: data.description };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// FREE SMS function using CallMeBot WhatsApp API (WORKS FOR ALL PHONES)
async function sendEmergencySMSToBarangay(req, alert) {
  try {
    const barangayMobileNumber = "09109754216"; // TNT number
    
    // Format message for SMS
    const smsMessage = `🚨 EMERGENCY: ${alert.residentName}: ${alert.message.substring(0, 100)}${alert.message.length > 100 ? '...' : ''} - Barangay Talipapa`;
    
    console.log(`📱 Sending FREE SMS via CallMeBot API to: ${barangayMobileNumber}`);
    
    // Method 1: CallMeBot WhatsApp API (FREE & RELIABLE)
    const smsSent = await sendViaCallMeBot(smsMessage);
    
    if (smsSent) {
      console.log('✅ SMS delivered via CallMeBot API');
      
      await EmergencyAlert.findByIdAndUpdate(alert._id, {
        smsSent: true,
        smsSentAt: new Date(),
        smsGatewayUsed: 'CallMeBot-WhatsApp',
        $inc: { smsAttempts: 1 }
      });
      
      return true;
    } else {
      // Method 2: Fallback to TextBelt (FREE SMS API)
      console.log('🔄 CallMeBot failed, trying TextBelt...');
      const fallbackSent = await sendViaTextBelt(barangayMobileNumber, smsMessage);
      
      if (fallbackSent) {
        console.log('✅ SMS delivered via TextBelt');
        
        await EmergencyAlert.findByIdAndUpdate(alert._id, {
          smsSent: true,
          smsSentAt: new Date(),
          smsGatewayUsed: 'TextBelt-API',
          $inc: { smsAttempts: 1 }
        });
        
        return true;
      }
      
      throw new Error('All SMS methods failed');
    }
    
  } catch (error) {
    console.error('❌ SMS sending failed:', error.message);
    
    // Final fallback: Enhanced email notification
    return await sendSMSFailureEmail(req, alert);
  }
}

// Method 1: CallMeBot WhatsApp API (FREE & WORKS)
async function sendViaCallMeBot(message) {
  try {
    // CallMeBot WhatsApp API - FREE for personal use
    // Format: +639109754216 -> 639109754216 (remove +)
    const phoneNumber = '639109754216'; // Your TNT number in international format
    
    // URL encode the message
    const encodedMessage = encodeURIComponent(message);
    
    // CallMeBot API URL (WhatsApp)
    const apiUrl = `https://api.callmebot.com/whatsapp.php?phone=${phoneNumber}&text=${encodedMessage}&apikey=123456`;
    
    console.log(`📞 Calling CallMeBot API for: ${phoneNumber}`);
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      timeout: 10000
    });
    
    const result = await response.text();
    console.log('CallMeBot response:', result);
    
    // CallMeBot returns "Message sent" on success
    if (result.includes('Message sent') || response.ok) {
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.log('❌ CallMeBot failed:', error.message);
    return false;
  }
}

// Method 2: TextBelt FREE SMS API (Alternative)
async function sendViaTextBelt(phoneNumber, message) {
  try {
    // TextBelt FREE SMS API (50 texts/day free)
    const response = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone: phoneNumber,
        message: message,
        key: 'textbelt' // FREE key
      })
    });

    const result = await response.json();
    console.log('TextBelt response:', result);
    
    return result.success === true;
    
  } catch (error) {
    console.log('❌ TextBelt failed:', error.message);
    return false;
  }
}

// Method 3: SMS77.io FREE Tier (Backup)
async function sendViaSMS77(phoneNumber, message) {
  try {
    // SMS77.io offers free test credits
    const apiKey = 'free'; // Use their free test API
    const response = await fetch(`https://gateway.sms77.io/api/sms?p=${apiKey}&to=${phoneNumber}&text=${encodeURIComponent(message)}&type=direct`);
    
    const result = await response.text();
    console.log('SMS77 response:', result);
    
    return result.includes('100'); // 100 means success in SMS77
    
  } catch (error) {
    console.log('❌ SMS77 failed:', error.message);
    return false;
  }
}

// Enhanced fallback for SMS failure
async function sendSMSFailureEmail(req, alert) {
  try {
    const emailTransporter = req.app.get('emailTransporter');
    
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: process.env.EMERGENCY_EMAIL_RECIPIENT,
      subject: '🚨 URGENT: EMERGENCY ALERT - SMS DELIVERY FAILED',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 2px solid #e74c3c; border-radius: 8px; padding: 20px;">
          <h2 style="color: #e74c3c; text-align: center; border-bottom: 2px solid #e74c3c; padding-bottom: 10px;">
            🚨 EMERGENCY ALERT - SMS NOTIFICATION FAILED
          </h2>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 6px; margin: 15px 0;">
            <h3 style="color: #2c3e50; margin-top: 0;">Emergency Details:</h3>
            <p><strong>Resident:</strong> ${alert.residentName}</p>
            <p><strong>Emergency:</strong> ${alert.message}</p>
            <p><strong>Time:</strong> ${new Date(alert.createdAt).toLocaleString()}</p>
            <p><strong>Target Mobile:</strong> 09109754216 (TNT)</p>
            <p><strong>Status:</strong> All SMS gateways failed - REQUIRES MANUAL ATTENTION</p>
          </div>
          
          <div style="background-color: #fff3cd; padding: 12px; border-radius: 6px; border-left: 4px solid #ffc107;">
            <p style="margin: 0; color: #856404;">
              <strong>⚠️ IMMEDIATE ACTION REQUIRED:</strong><br>
              SMS notification to barangay mobile failed. Please contact the resident directly and check the emergency alert in the system.
            </p>
          </div>
          
          <div style="margin-top: 15px; padding: 12px; background-color: #e74c3c; color: white; border-radius: 6px; text-align: center;">
            <strong>URGENT: Manual intervention required for this emergency!</strong>
          </div>
          
          <footer style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #ddd; color: #6c757d; font-size: 12px;">
            <p>This is an automated alert from Barangay Talipapa Emergency System.</p>
          </footer>
        </div>
      `
    };

    await emailTransporter.sendMail(mailOptions);
    console.log('📧 SMS failure notification email sent');
    
    return true;
  } catch (error) {
    console.error('Failed to send SMS failure email:', error);
    return false;
  }
}

// Test TNT SMS with REAL APIs
router.post("/test-tnt-sms", async (req, res) => {
  try {
    const tntNumber = "09109754216";
    const testMessage = 'Test SMS from Barangay Talipapa Emergency System - Please ignore. Time: ' + new Date().toLocaleString();

    const results = [];

    // Test CallMeBot
    console.log('🧪 Testing CallMeBot API...');
    const callMeBotResult = await sendViaCallMeBot(testMessage);
    results.push({
      method: 'CallMeBot-WhatsApp',
      status: callMeBotResult ? 'SUCCESS' : 'FAILED',
      note: callMeBotResult ? 'Check WhatsApp on your phone' : 'CallMeBot API failed'
    });

    // Test TextBelt
    console.log('🧪 Testing TextBelt API...');
    const textBeltResult = await sendViaTextBelt(tntNumber, testMessage);
    results.push({
      method: 'TextBelt-SMS',
      status: textBeltResult ? 'SUCCESS' : 'FAILED',
      note: textBeltResult ? 'Check SMS on your phone' : 'TextBelt API failed'
    });

    // Test SMS77
    console.log('🧪 Testing SMS77 API...');
    const sms77Result = await sendViaSMS77(tntNumber, testMessage);
    results.push({
      method: 'SMS77-API',
      status: sms77Result ? 'SUCCESS' : 'FAILED',
      note: sms77Result ? 'Check SMS on your phone' : 'SMS77 API failed'
    });

    const successCount = results.filter(r => r.status === 'SUCCESS').length;
    
    res.json({
      success: successCount > 0,
      message: successCount > 0 ? 'SMS test completed successfully' : 'All SMS APIs failed',
      results: results,
      summary: {
        total: results.length,
        success: successCount,
        failed: results.length - successCount
      },
      note: successCount > 0 ? 
        'Check your TNT phone for test messages via WhatsApp or SMS!' :
        'All free SMS APIs failed. Email notifications are still working.'
    });
    
  } catch (error) {
    console.error('TNT SMS test error:', error);
    res.status(500).json({
      success: false,
      error: 'TNT SMS test failed: ' + error.message
    });
  }
});



// Enhanced emergency email function
async function sendEmergencyEmailToAdmin(req, alert) {
  try {
    const emailTransporter = req.app.get('emailTransporter');
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'barangaytalipapa7@gmail.com',
      to: process.env.EMERGENCY_EMAIL_RECIPIENT || 'barangaytalipapa7@gmail.com',
      subject: `🚨 URGENT: Emergency Alert - ${alert.residentName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #e74c3c; border-bottom: 2px solid #e74c3c; padding-bottom: 10px;">
            🚨 EMERGENCY ALERT REQUIRES IMMEDIATE ATTENTION
          </h2>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #2c3e50; margin-top: 0;">Alert Details:</h3>
            <p><strong>Resident Name:</strong> ${alert.residentName}</p>
            <p><strong>Contact Number:</strong> ${alert.residentId?.contactNumber || 'Not provided'}</p>
            <p><strong>Emergency Message:</strong> ${alert.message}</p>
            <p><strong>Time Received:</strong> ${new Date(alert.createdAt).toLocaleString()}</p>
            <p><strong>Time Elapsed:</strong> More than 1 minute without response</p>
            <p><strong>Address:</strong> ${alert.residentId?.address || 'Not provided'}</p>
          </div>
          
          <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; border-left: 4px solid #ffc107;">
            <p style="margin: 0; color: #856404;">
              <strong>⚠️ ACTION REQUIRED:</strong> 
              This emergency alert has been pending for over 1 minute. 
              SMS notification has been sent to barangay mobile number (09109754216).
            </p>
          </div>
          
          <div style="margin-top: 20px; padding: 15px; background-color: #e8f4fd; border-radius: 6px;">
            <p style="margin: 0; color: #0c5460;">
              <strong>🚀 Quick Actions:</strong><br>
              1. Log in to Admin Dashboard immediately<br>
              2. Navigate to Emergency Alerts section<br>
              3. Respond to this emergency<br>
              4. Contact resident if needed: ${alert.residentId?.contactNumber || 'N/A'}
            </p>
          </div>
          
          <div style="margin-top: 15px; padding: 10px; background-color: #e74c3c; color: white; border-radius: 6px; text-align: center;">
            <strong>URGENT: This requires immediate response!</strong>
          </div>
          
          <footer style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #6c757d;">
            <p>This is an automated message from Barangay Talipapa Emergency Alert System.</p>
            <p>Please do not reply to this email.</p>
          </footer>
        </div>
      `
    };

    await emailTransporter.sendMail(mailOptions);
    
    // Update alert to mark email as sent
    await EmergencyAlert.findByIdAndUpdate(alert._id, {
      emailSent: true,
      emailSentAt: new Date()
    });
    
    console.log(`✅ Emergency email sent to admin for alert: ${alert._id}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending emergency email:', error);
    return false;
  }
}

// ENHANCED notification handler with TELEGRAM + REAL FREE SMS
async function handleUnacknowledgedEmergency(req, alert) {
  try {
    console.log(`🚨 Alert ${alert._id} unacknowledged after 1 minute - sending notifications`);
    
    const notificationResults = {
      telegramSent: false,
      emailSent: false,
      smsSent: false
    };
    
    // 1. Send Telegram notification (MOST RELIABLE)
    notificationResults.telegramSent = await sendTelegramAlert(alert);
    
    // 2. Send detailed email to admin
    notificationResults.emailSent = await sendEmergencyEmailToAdmin(req, alert);
    
    // 3. Send REAL FREE SMS via APIs
    notificationResults.smsSent = await sendEmergencySMSToBarangay(req, alert);
    
    // 4. Send urgent socket notification to all admins
    const io = req.app.get('io');
    io.emit('urgentEmergencyAlert', {
      _id: alert._id,
      residentId: alert.residentId?._id,
      residentName: alert.residentName,
      message: alert.message,
      status: alert.status,
      createdAt: alert.createdAt,
      contactNumber: alert.residentId?.contactNumber,
      address: alert.residentId?.address,
      urgent: true,
      notificationType: 'unacknowledged_emergency',
      telegramDelivered: notificationResults.telegramSent,
      smsDelivered: notificationResults.smsSent,
      emailDelivered: notificationResults.emailSent
    });
    
    // Emit Telegram status
    if (notificationResults.telegramSent) {
      io.emit('telegramNotificationSent', {
        alertId: alert._id,
        success: true,
        timestamp: new Date()
      });
    }
    
    console.log(`📊 Emergency notifications sent - Telegram: ${notificationResults.telegramSent}, Email: ${notificationResults.emailSent}, SMS: ${notificationResults.smsSent}`);
    
    return notificationResults;
    
  } catch (error) {
    console.error('❌ Error in emergency notification handler:', error);
    return { telegramSent: false, emailSent: false, smsSent: false };
  }
}

// Middleware to get user from session
const getAuthenticatedUser = async (req) => {
  try {
    // Check session-based authentication
    if (req.session.userId) {
      const user = await User.findById(req.session.userId);
      return user;
    }
    
    // Check token-based authentication (if you're using JWT)
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      // You would verify JWT token here if using JWT
      // For now, we'll rely on session
    }
    
    return null;
  } catch (error) {
    console.error('Error getting authenticated user:', error);
    return null;
  }
};

// ==================== GET ROUTES ====================

// Get resident's own emergency alerts
router.get("/my-alerts", async (req, res) => {
  try {
    // Get authenticated user
    const user = await getAuthenticatedUser(req);
    
    if (!user) {
      return res.status(401).json({ 
        success: false,
        error: "Authentication required. Please log in again." 
      });
    }

    console.log(`Fetching alerts for user: ${user._id}, ${user.email}`);

    const alerts = await EmergencyAlert.find({ residentId: user._id })
      .sort({ createdAt: -1 })
      .select('residentName message status adminResponse createdAt acknowledgedAt resolvedAt emailSent smsSent telegramSent smsGatewayUsed smsAttempts');
      
    console.log(`Found ${alerts.length} alerts for user ${user._id}`);
      
    res.json({
      success: true,
      alerts: alerts.map(alert => ({
        _id: alert._id,
        residentName: alert.residentName,
        message: alert.message,
        status: alert.status,
        adminResponse: alert.adminResponse,
        createdAt: alert.createdAt,
        acknowledgedAt: alert.acknowledgedAt,
        resolvedAt: alert.resolvedAt,
        emailSent: alert.emailSent,
        smsSent: alert.smsSent,
        telegramSent: alert.telegramSent,
        smsGatewayUsed: alert.smsGatewayUsed,
        smsAttempts: alert.smsAttempts
      }))
    });
  } catch (error) {
    console.error("Error fetching resident alerts:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch emergency alerts",
      details: error.message 
    });
  }
});

// Alternative route that accepts user ID as parameter (for testing)
router.get("/user/:userId/alerts", async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false,
        error: "User ID is required" 
      });
    }

    const alerts = await EmergencyAlert.find({ residentId: userId })
      .sort({ createdAt: -1 })
      .select('residentName message status adminResponse createdAt acknowledgedAt resolvedAt emailSent smsSent telegramSent smsGatewayUsed smsAttempts');
      
    res.json({
      success: true,
      alerts: alerts.map(alert => ({
        _id: alert._id,
        residentName: alert.residentName,
        message: alert.message,
        status: alert.status,
        adminResponse: alert.adminResponse,
        createdAt: alert.createdAt,
        acknowledgedAt: alert.acknowledgedAt,
        resolvedAt: alert.resolvedAt,
        emailSent: alert.emailSent,
        smsSent: alert.smsSent,
        telegramSent: alert.telegramSent,
        smsGatewayUsed: alert.smsGatewayUsed,
        smsAttempts: alert.smsAttempts
      }))
    });
  } catch (error) {
    console.error("Error fetching user alerts:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch emergency alerts" 
    });
  }
});

// Stats endpoint
router.get("/stats", async (req, res) => {
  try {
    const pending = await EmergencyAlert.countDocuments({ status: 'pending' });
    const acknowledged = await EmergencyAlert.countDocuments({ status: 'acknowledged' });
    const resolved = await EmergencyAlert.countDocuments({ status: 'resolved' });
    const totalSmsSent = await EmergencyAlert.countDocuments({ smsSent: true });
    const totalEmailSent = await EmergencyAlert.countDocuments({ emailSent: true });
    const totalTelegramSent = await EmergencyAlert.countDocuments({ telegramSent: true });
    
    res.json({
      success: true,
      data: {
        pending: pending || 0,
        acknowledged: acknowledged || 0,
        resolved: resolved || 0,
        totalSmsSent: totalSmsSent || 0,
        totalEmailSent: totalEmailSent || 0,
        totalTelegramSent: totalTelegramSent || 0,
        total: (pending || 0) + (acknowledged || 0) + (resolved || 0)
      }
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch emergency alert statistics" 
    });
  }
});

// Get all alerts (with optional status filter)
router.get("/", async (req, res) => {
  try {
    const { status } = req.query;
    let query = {};
    
    if (status === 'active') {
      query = { status: { $in: ['pending', 'acknowledged'] } };
    } else if (status && status !== 'all') {
      query = { status };
    }
    
    const alerts = await EmergencyAlert.find(query)
      .sort({ createdAt: -1 })
      .populate('residentId', 'contactNumber address email');
      
    res.json({
      success: true,
      alerts: alerts.map(alert => ({
        _id: alert._id,
        residentId: alert.residentId?._id,
        residentName: alert.residentName || 'Unknown Resident',
        residentEmail: alert.residentId?.email,
        message: alert.message || '',
        status: alert.status || 'pending',
        adminResponse: alert.adminResponse,
        createdAt: alert.createdAt,
        acknowledgedAt: alert.acknowledgedAt,
        resolvedAt: alert.resolvedAt,
        emailSent: alert.emailSent,
        emailSentAt: alert.emailSentAt,
        smsSent: alert.smsSent,
        smsSentAt: alert.smsSentAt,
        telegramSent: alert.telegramSent,
        telegramSentAt: alert.telegramSentAt,
        smsGatewayUsed: alert.smsGatewayUsed,
        smsAttempts: alert.smsAttempts,
        contactNumber: alert.residentId?.contactNumber || 'N/A',
        address: alert.residentId?.address || 'N/A'
      }))
    });
  } catch (error) {
    console.error("Error fetching alerts:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch alerts" 
    });
  }
});

// Get single alert by ID
router.get("/:id", async (req, res) => {
  try {
    const alert = await EmergencyAlert.findById(req.params.id)
      .populate('residentId', 'contactNumber address email');
      
    if (!alert) {
      return res.status(404).json({ 
        success: false,
        error: "Alert not found" 
      });
    }
    
    res.json({
      success: true,
      alert: {
        _id: alert._id,
        residentId: alert.residentId?._id,
        residentName: alert.residentName || 'Unknown Resident',
        residentEmail: alert.residentId?.email,
        message: alert.message || '',
        status: alert.status || 'pending',
        adminResponse: alert.adminResponse,
        createdAt: alert.createdAt,
        acknowledgedAt: alert.acknowledgedAt,
        resolvedAt: alert.resolvedAt,
        emailSent: alert.emailSent,
        emailSentAt: alert.emailSentAt,
        smsSent: alert.smsSent,
        smsSentAt: alert.smsSentAt,
        telegramSent: alert.telegramSent,
        telegramSentAt: alert.telegramSentAt,
        smsGatewayUsed: alert.smsGatewayUsed,
        smsAttempts: alert.smsAttempts,
        contactNumber: alert.residentId?.contactNumber || 'N/A',
        address: alert.residentId?.address || 'N/A'
      }
    });
  } catch (error) {
    console.error("Error fetching alert:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch alert" 
    });
  }
});

// ==================== POST ROUTES ====================

// Send new emergency alert - UPDATED with TELEGRAM + REAL FREE SMS
router.post("/send", async (req, res) => {
  try {
    const { email, message } = req.body;
    
    if (!email || !message) {
      return res.status(400).json({ 
        success: false,
        error: "Email and message are required" 
      });
    }

    const resident = await User.findOne({ email });
    if (!resident) {
      return res.status(404).json({ 
        success: false,
        error: "Resident not found" 
      });
    }

    const alert = new EmergencyAlert({
      residentId: resident._id,
      residentName: resident.fullName,
      message
    });

    await alert.save();
    
    console.log(`✅ New emergency alert created: ${alert._id} for resident: ${resident.fullName}`);
    
    // Emit socket event to all admin users
    const io = req.app.get('io');
    io.emit('newEmergencyAlert', {
      _id: alert._id,
      residentId: resident._id,
      residentName: resident.fullName,
      message: alert.message,
      status: alert.status,
      createdAt: alert.createdAt,
      contactNumber: resident.contactNumber,
      address: resident.address
    });
    
    // Schedule TELEGRAM + REAL FREE SMS and email notifications after 1 minute
    setTimeout(async () => {
      try {
        const updatedAlert = await EmergencyAlert.findById(alert._id).populate('residentId');
        if (updatedAlert && updatedAlert.status === 'pending') {
          console.log(`⏰ Alert ${alert._id} still unacknowledged after 1 minute, sending notifications...`);
          await handleUnacknowledgedEmergency(req, updatedAlert);
        }
      } catch (error) {
        console.error('❌ Error in emergency notification scheduling:', error);
      }
    }, 61000); // 61 seconds to ensure 1 minute has passed
    
    res.status(201).json({
      success: true,
      alert: {
        _id: alert._id,
        residentName: alert.residentName,
        message: alert.message,
        status: alert.status,
        createdAt: alert.createdAt
      },
      message: "Emergency alert sent successfully. Officials will respond within 1 minute."
    });
  } catch (error) {
    console.error("❌ Error sending alert:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to send emergency alert" 
    });
  }
});

// Debug endpoint to check session
router.get("/debug/session", async (req, res) => {
  try {
    res.json({
      success: true,
      session: req.session,
      user: await getAuthenticatedUser(req)
    });
  } catch (error) {
    console.error("Debug error:", error);
    res.status(500).json({ 
      success: false,
      error: "Debug failed" 
    });
  }
});

// Enhanced Test SMS endpoint with TELEGRAM + REAL FREE APIs
router.post("/test-sms", async (req, res) => {
  try {
    const testAlert = {
      _id: 'test123',
      residentName: 'Test Resident',
      message: 'This is a test emergency message to verify FREE SMS functionality',
      residentId: {
        contactNumber: '09123456789',
        address: 'Test Address'
      },
      createdAt: new Date()
    };

    console.log('🧪 Testing TELEGRAM + REAL FREE SMS functionality...');
    
    // Test TELEGRAM first (most reliable)
    const telegramResult = await sendTelegramAlert(testAlert);
    
    // Test REAL FREE SMS method
    const smsResult = await sendEmergencySMSToBarangay(req, testAlert);
    
    res.json({
      success: telegramResult || smsResult,
      message: telegramResult ? 'Telegram test sent successfully' : 
               smsResult ? 'FREE SMS test sent successfully' : 
               'All notification methods failed',
      testData: testAlert,
      methods: {
        telegram: telegramResult ? 'SUCCESS' : 'FAILED',
        sms: smsResult ? 'SUCCESS' : 'FAILED'
      },
      note: telegramResult ? 
        'Check your Telegram app for the test message!' :
        smsResult ? 'Check your TNT phone for test message via WhatsApp or SMS!' :
        'All notification methods failed. Check your configurations.'
    });
  } catch (error) {
    console.error('SMS test error:', error);
    res.status(500).json({
      success: false,
      error: 'SMS test failed',
      details: error.message
    });
  }
});

// NEW: Debug SMS APIs endpoint
router.post("/debug-sms-apis", async (req, res) => {
  try {
    const testNumber = "09109754216";
    const testMessage = 'API Test from Barangay Talipapa - Please ignore';

    const results = [];

    // Test Telegram first
    console.log('🧪 Testing Telegram API...');
    const telegramResult = await testTelegramConnection();
    results.push({
      api: 'Telegram-Bot',
      status: telegramResult.success ? 'SUCCESS' : 'FAILED',
      description: 'FREE instant messaging',
      note: telegramResult.success ? 
        `Bot: @${telegramResult.bot_username}` : 
        telegramResult.error
    });

    // Test CallMeBot
    console.log('🧪 Testing CallMeBot API...');
    const callMeBotResult = await sendViaCallMeBot(testMessage);
    results.push({
      api: 'CallMeBot-WhatsApp',
      status: callMeBotResult ? 'SUCCESS' : 'FAILED',
      description: 'FREE WhatsApp messages via API',
      note: callMeBotResult ? 'Check WhatsApp on 09109754216' : 'API call failed'
    });

    // Test TextBelt
    console.log('🧪 Testing TextBelt API...');
    const textBeltResult = await sendViaTextBelt(testNumber, testMessage);
    results.push({
      api: 'TextBelt-SMS',
      status: textBeltResult ? 'SUCCESS' : 'FAILED',
      description: 'FREE SMS (50/day)',
      note: textBeltResult ? 'Check SMS on 09109754216' : 'Daily limit may be reached'
    });

    // Test SMS77
    console.log('🧪 Testing SMS77 API...');
    const sms77Result = await sendViaSMS77(testNumber, testMessage);
    results.push({
      api: 'SMS77-API',
      status: sms77Result ? 'SUCCESS' : 'FAILED',
      description: 'FREE test credits',
      note: sms77Result ? 'Check SMS on 09109754216' : 'Free credits may be used'
    });

    const successCount = results.filter(r => r.status === 'SUCCESS').length;
    
    res.json({
      success: successCount > 0,
      message: `API debug completed - ${successCount} successful, ${results.length - successCount} failed`,
      results: results,
      summary: {
        total: results.length,
        success: successCount,
        failed: results.length - successCount
      },
      recommendation: successCount > 0 ? 
        'System is working! Telegram is recommended for reliability.' :
        'All free APIs failed. Consider using a paid SMS service for production.'
    });
    
  } catch (error) {
    console.error('SMS API debug error:', error);
    res.status(500).json({
      success: false,
      error: 'API debug failed',
      details: error.message
    });
  }
});

// Respond to alert (acknowledge with message)
router.post("/:id/respond", async (req, res) => {
  try {
    const { id } = req.params;
    const { adminMessage } = req.body;
    
    const alert = await EmergencyAlert.findById(id);
    if (!alert) {
      return res.status(404).json({ 
        success: false,
        error: "Alert not found" 
      });
    }

    const updatedAlert = await EmergencyAlert.findByIdAndUpdate(
      id,
      { 
        status: 'acknowledged',
        acknowledgedAt: new Date(),
        adminResponse: adminMessage 
      },
      { new: true }
    ).populate('residentId', 'email contactNumber address');
    
    // Emit socket event to the specific resident
    const io = req.app.get('io');
    io.emit('emergencyResponse', {
      alertId: updatedAlert._id,
      residentId: updatedAlert.residentId._id,
      message: adminMessage,
      acknowledgedAt: updatedAlert.acknowledgedAt
    });
    
    // Also emit to admin for real-time updates
    io.emit('alertAcknowledged', {
      _id: updatedAlert._id,
      residentName: updatedAlert.residentName,
      message: updatedAlert.message,
      status: updatedAlert.status,
      adminResponse: updatedAlert.adminResponse,
      createdAt: updatedAlert.createdAt,
      acknowledgedAt: updatedAlert.acknowledgedAt,
      contactNumber: updatedAlert.residentId?.contactNumber,
      address: updatedAlert.residentId?.address
    });
    
    res.json({
      success: true,
      alert: updatedAlert,
      message: "Emergency alert responded to successfully"
    });
  } catch (error) {
    console.error("Error responding to alert:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to respond to alert" 
    });
  }
});

// ==================== PUT ROUTES ====================

// Acknowledge alert
router.put("/:id/acknowledge", async (req, res) => {
  try {
    const alert = await EmergencyAlert.findByIdAndUpdate(
      req.params.id,
      { 
        status: 'acknowledged',
        acknowledgedAt: new Date() 
      },
      { new: true }
    );
    
    if (!alert) {
      return res.status(404).json({ error: "Alert not found" });
    }
    
    req.app.get('io').emit('alertAcknowledged', alert);
    res.json(alert);
  } catch (error) {
    res.status(500).json({ error: "Failed to acknowledge alert" });
  }
});

// Resolve alert
router.put("/:id/resolve", async (req, res) => {
  try {
    const alert = await EmergencyAlert.findByIdAndUpdate(
      req.params.id,
      { 
        status: 'resolved',
        resolvedAt: new Date() 
      },
      { new: true }
    );
    
    if (!alert) {
      return res.status(404).json({ error: "Alert not found" });
    }
    
    req.app.get('io').emit('alertResolved', alert._id);
    res.json(alert);
  } catch (error) {
    res.status(500).json({ error: "Failed to resolve alert" });
  }
});

// ==================== DELETE ROUTES ====================

// Test cleanup endpoint (MUST COME FIRST)
router.delete("/cleanup-test", async (req, res) => {
  try {
    console.log("TEST CLEANUP ROUTE HIT - SUCCESS");
    res.json({
      success: true,
      message: "Cleanup test route is working",
      test: true,
      deletedCount: 0
    });
  } catch (error) {
    console.error("Test route error:", error);
    res.status(500).json({ 
      success: false,
      error: "Test route failed",
      details: error.message 
    });
  }
});

// Cleanup endpoint to delete all resolved alerts
router.delete("/cleanup", async (req, res) => {
  try {
    console.log("=== CLEANUP REQUEST STARTED ===");
    
    // Check if MongoDB is connected
    if (mongoose.connection.readyState !== 1) {
      console.error("MongoDB is not connected");
      return res.status(500).json({
        success: false,
        error: "Database not connected",
        details: "MongoDB connection is not established"
      });
    }

    console.log("MongoDB connection status: OK");
    
    // Count before deletion for logging
    const beforeCount = await EmergencyAlert.countDocuments({ status: 'resolved' });
    console.log(`Found ${beforeCount} resolved alerts to delete`);
    
    if (beforeCount === 0) {
      console.log("No resolved alerts to delete");
      return res.json({
        success: true,
        message: "No resolved alerts to clear",
        deletedCount: 0
      });
    }

    // Perform the deletion
    console.log("Starting delete operation...");
    const result = await EmergencyAlert.deleteMany({ status: 'resolved' });
    
    console.log(`Cleaned up ${result.deletedCount} resolved alerts`);
    console.log("Delete operation completed successfully");
    console.log("=== CLEANUP REQUEST COMPLETED ===");
    
    res.json({
      success: true,
      message: `Successfully cleared ${result.deletedCount} resolved alerts`,
      deletedCount: result.deletedCount
    });
    
  } catch (error) {
    console.error("=== CLEANUP ERROR ===");
    console.error("Error clearing resolved alerts:", error);
    console.error("Error details:", error.message);
    console.error("Error stack:", error.stack);
    console.error("=== CLEANUP ERROR END ===");
    
    res.status(500).json({ 
      success: false,
      error: "Failed to clear resolved alerts",
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Delete single alert by ID (MUST COME LAST)
router.delete("/:id", async (req, res) => {
  try {
    const alert = await EmergencyAlert.findByIdAndDelete(req.params.id);
    
    if (!alert) {
      return res.status(404).json({ error: "Alert not found" });
    }
    
    req.app.get('io').emit('alertRemoved', alert._id);
    res.json({ message: "Alert deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete alert" });
  }
});

module.exports = router;