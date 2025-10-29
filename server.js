require('dotenv').config();
const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const cors = require("cors");
const session = require("express-session");
const MongoStore = require('connect-mongo');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

const { authMiddleware, adminMiddleware } = require('./middleware/authMiddleware');

const app = express();
const server = http.createServer(app);

// 🔁 Updated CORS for Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  }
});

const PORT = process.env.PORT || 3000;

// ✅ Updated MongoDB Atlas Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  retryWrites: true,
  w: 'majority',
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000
})
.then(() => {
  console.log("✅ Connected to MongoDB Atlas");
})
.catch(err => {
  console.error("❌ MongoDB Atlas Connection Error:", err);
  process.exit(1);
});

// 📧 Email Transporter Configuration - CORRECTED: createTransport (not createTransporter)
const emailTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  // Enhanced settings for better reliability
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  rateDelta: 1000,
  rateLimit: 5,
  tls: {
    rejectUnauthorized: false
  },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 15000,
  // CLEANED: Reduced debugging output
  debug: false,
  logger: false
});

// Verify email configuration with enhanced logging
emailTransporter.verify((error, success) => {
  if (error) {
    console.error('❌ Email configuration error:', error.message);
  } else {
    console.log('✅ Email server ready for emergency alerts');
    console.log('📱 FREE SMS System: Active (Multiple APIs)');
    console.log('   - CallMeBot WhatsApp API');
    console.log('   - TextBelt SMS API'); 
    console.log('   - SMS77 Backup API');
    console.log('   - Telegram Bot API');
  }
});

// NEW: Automatic request processing function
function setupAutomaticRequestProcessing() {
  // Process automatic updates every hour
  setInterval(async () => {
      try {
          console.log('🔄 Running automatic request processing...');
          const Request = require("./models/Request");
          const result = await Request.processAutomaticUpdates();
          
          if (result.expiredCount > 0 || result.archivedCount > 0) {
              console.log(`✅ Automatic processing completed: ${result.expiredCount} expired, ${result.archivedCount} archived`);
              
              // Emit socket event for real-time updates
              io.emit('request-automatic-update', {
                  type: 'automatic_processing',
                  ...result,
                  timestamp: new Date().toISOString()
              });
          }
      } catch (error) {
          console.error('❌ Automatic request processing error:', error);
      }
  }, 60 * 60 * 1000); // Run every hour

  // Also run on server startup
  setTimeout(async () => {
      try {
          console.log('🔄 Running initial automatic request processing...');
          const Request = require("./models/Request");
          await Request.processAutomaticUpdates();
      } catch (error) {
          console.error('❌ Initial automatic processing error:', error);
      }
  }, 10000); // Run 10 seconds after server starts
}

// 📁 Ensure uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Created uploads directory');
}

// 🔁 Serve Uploads
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    if (filePath.match(/\.(jpg|jpeg|png|gif|pdf|docx)$/)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// 🔁 Serve Public Assets
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, filePath) => {
    if (filePath.match(/\.(css|js|html|json)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=0');
    }
  }
}));

// Default Profile Image
app.get('/images/default-profile.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'images', 'default-profile.png'), {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  });
});

app.get('/api/auth/check-session', (req, res) => {
  if (req.session && req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

// 🧠 Session Store in MongoDB
const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGO_URI,
  collectionName: 'sessions',
  ttl: 14 * 24 * 60 * 60,
  autoRemove: 'native'
});

// 🍪 Updated Session Config with Render domain
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    maxAge: 14 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    domain: process.env.NODE_ENV === 'production' ? 'barangaytalipapa.site' : undefined
  },
  name: 'btms.sid',
  rolling: true
}));

// 🔁 Updated CORS Middleware
const corsOptions = {
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Origin', 'Accept'],
  exposedHeaders: ['set-cookie', 'Date', 'ETag'],
  maxAge: 86400
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// 📦 Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ⚡ Make Socket and Email Transporter Available to Routes
app.set('io', io);
app.set('emailTransporter', emailTransporter);

// Relaxed limiter for beta testing
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 2000,                 // up to 2000 requests per 15 mins
  message: "Too many requests, please try again later"
});

// Apply only to authentication routes
app.use("/api/auth", authLimiter);

// 🛣️ Routes
const authRoutes = require("./routes/authRoutes");
const residentRoutes = require("./routes/residentRoutes");
const blotterRoutes = require("./routes/blotterRoutes");
const requestsRoutes = require("./routes/requestsRoutes");
const adminRoutes = require("./routes/adminRoutes");
const announceRoutes = require("./routes/announceRoutes");
const emergencyRoutes = require("./routes/emergencyRoutes");
const approvalRoutes = require("./routes/approvalRoutes");
const messageRoutes = require("./routes/messageRoutes");

// ✅ ADDED: Document Routes
const documentRoutes = require("./routes/documentRoutes");

app.use("/api/auth", authRoutes);
app.use("/api/residents", residentRoutes);
app.use("/api/blotter", blotterRoutes);
app.use("/api/requests", requestsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/announcements", announceRoutes);
app.use("/api/emergency", emergencyRoutes);
app.use("/api/approvals", approvalRoutes);
app.use("/api/messages", messageRoutes);

// ✅ ADDED: Document Routes
app.use("/api/documents", documentRoutes);

// 🔐 Protected HTML Routes (Clean URLs)
const setSecurityHeaders = (req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
};

// ==================== ADMIN ROUTES ====================
app.get("/admin-dashboard", setSecurityHeaders, authMiddleware, adminMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-dashboard.html"));
});

app.get("/admin-blotter", setSecurityHeaders, authMiddleware, adminMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-blotter.html"));
});

app.get("/admin-approvals", setSecurityHeaders, authMiddleware, adminMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-approvals.html"));
});

app.get("/adminAnnounce", setSecurityHeaders, authMiddleware, adminMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "adminAnnounce.html"));
});

app.get("/adminRequests", setSecurityHeaders, authMiddleware, adminMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "adminRequests.html"));
});

app.get("/manage-residents", setSecurityHeaders, authMiddleware, adminMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "manage-residents.html"));
});

app.get("/view-resident", setSecurityHeaders, authMiddleware, adminMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "view-resident.html"));
});

app.get("/emergency", setSecurityHeaders, authMiddleware, adminMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "emergency.html"));
});

// ==================== NEW ADMIN MESSAGES ROUTE ====================
app.get("/admin-messages", setSecurityHeaders, authMiddleware, adminMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-messages.html"));
});

// ==================== RESIDENT ROUTES ====================
app.get("/residentdashboard", setSecurityHeaders, authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "residentdashboard.html"));
});

app.get("/requests", setSecurityHeaders, authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "requests.html"));
});

app.get("/residentRequests", setSecurityHeaders, authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "residentRequests.html"));
});

app.get("/blotter", setSecurityHeaders, authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "blotter.html"));
});

app.get("/resident-blotter", setSecurityHeaders, authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "resident-blotter.html"));
});

app.get("/announcement", setSecurityHeaders, authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "announcement.html"));
});

app.get("/profile", setSecurityHeaders, authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "profile.html"));
});

// ==================== AUTH ROUTES (Public) ====================
app.get("/login", setSecurityHeaders, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/register", setSecurityHeaders, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "register.html"));
});

app.get("/forgot-password", setSecurityHeaders, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "forgot-password.html"));
});

app.get("/admin-login", setSecurityHeaders, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-login.html"));
});

app.get("/admin-register", setSecurityHeaders, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-register.html"));
});

// ==================== PUBLIC ROUTES ====================
app.get("/", setSecurityHeaders, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/manifest", setSecurityHeaders, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "manifest.json"));
});

// ==================== REDIRECT OLD .HTML URLs ====================
app.get("/*.html", (req, res) => {
  const cleanPath = req.path.replace('.html', '');
  res.redirect(301, cleanPath);
});

// NEW: Manual trigger for automatic request processing
app.post('/api/requests/process-automatic-updates', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const Request = require("./models/Request");
    const result = await Request.processAutomaticUpdates();
    
    res.status(200).json({
      message: "Automatic updates processed successfully",
      ...result
    });
  } catch (error) {
    console.error("Error processing automatic updates:", error);
    res.status(500).json({ 
      error: "Server error",
      message: "Failed to process automatic updates"
    });
  }
});

// 🩺 Health Check
app.get('/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.status(200).json({ 
    status: 'healthy',
    database: dbStatus,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    email: process.env.EMAIL_USER ? 'Configured' : 'Not configured',
    telegram: process.env.TELEGRAM_BOT_TOKEN ? 'Configured' : 'Not configured',
    emergency_sms: 'Enhanced System Active'
  });
});

// NEW: Enhanced SMS Health Check
app.get('/health/sms', async (req, res) => {
  try {
    const emailTransporter = req.app.get('emailTransporter');
    
    // Test email configuration
    const emailTest = await new Promise((resolve) => {
      emailTransporter.verify((error, success) => {
        resolve({ success: !error, error: error?.message });
      });
    });

    // Test Telegram configuration
    const telegramTest = await testTelegramConnection();

    // Get SMS stats from database
    const smsStats = await mongoose.connection.db.collection('emergencyalerts').aggregate([
      {
        $group: {
          _id: null,
          totalAlerts: { $sum: 1 },
          smsSent: { $sum: { $cond: [{ $eq: ["$smsSent", true] }, 1, 0] } },
          smsFailed: { $sum: { $cond: [{ $eq: ["$smsSent", false] }, 1, 0] } },
          telegramSent: { $sum: { $cond: [{ $eq: ["$telegramSent", true] }, 1, 0] } },
          uniqueGateways: { $addToSet: "$smsGatewayUsed" }
        }
      }
    ]).toArray();

    const stats = smsStats[0] || { totalAlerts: 0, smsSent: 0, smsFailed: 0, telegramSent: 0, uniqueGateways: [] };

    res.status(200).json({
      status: 'sms_health_check',
      email: emailTest,
      telegram: telegramTest,
      sms_stats: {
        total_alerts: stats.totalAlerts,
        sms_sent: stats.smsSent,
        sms_failed: stats.smsFailed,
        telegram_sent: stats.telegramSent,
        success_rate: stats.totalAlerts > 0 ? ((stats.smsSent / stats.totalAlerts) * 100).toFixed(2) + '%' : 'N/A',
        gateways_used: stats.uniqueGateways.filter(g => g && g !== 'none' && g !== 'error')
      },
      environment: {
        sms_enabled: process.env.SMS_ENABLED === 'true',
        telegram_enabled: !!process.env.TELEGRAM_BOT_TOKEN,
        max_attempts: process.env.SMS_MAX_ATTEMPTS || 3,
        retry_delay: process.env.SMS_RETRY_DELAY || 2000
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// Helper function to test Telegram connection
async function testTelegramConnection() {
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      return { success: false, error: 'Telegram bot token not configured' };
    }

    const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
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

// Helper function to check if user is admin
function isAdminUser(userId) {
  // You'll need to implement this based on your user management
  // For now, we'll assume all connected users in admin dashboard are admins
  return true;
}

// 📡 Socket.IO Events - ENHANCED WITH URGENT EMERGENCY SUPPORT
io.on('connection', (socket) => {
  console.log('📡 New user connected:', socket.id);
  
  socket.on('new_announcement', (announcement) => {
    io.emit('new_announcement', announcement);
  });

  socket.on('emergency_alert', (alert) => {
    io.emit('emergency_alert', alert);
  });

  // NEW: Automatic request update handler
  socket.on('request-automatic-update', (data) => {
    console.log('🔄 Automatic request update:', data);
    io.emit('request-automatic-update', data);
  });

  // NEW: Urgent emergency alert handler
  socket.on('urgentEmergencyAlert', (data) => {
    console.log('🚨 URGENT EMERGENCY ALERT received:', data);
    
    // Broadcast to all admin users with urgent flag
    io.emit('urgentEmergencyAlert', {
      ...data,
      urgent: true,
      timestamp: new Date().toISOString(),
      notificationType: 'unacknowledged_emergency'
    });
    
    // Also emit specific event for admin dashboard
    io.emit('showUrgentAlert', {
      ...data,
      urgent: true,
      requiresImmediateAttention: true,
      timestamp: new Date().toISOString()
    });
  });

  // Enhanced SMS delivery status events
  socket.on('smsDeliveryStatus', (data) => {
    console.log('📱 SMS Delivery Status:', data);
    // Broadcast to relevant admin users
    io.emit('smsDeliveryStatus', data);
  });

  // Telegram notification events
  socket.on('telegramNotificationSent', (data) => {
    console.log('📱 Telegram notification sent:', data);
    io.emit('telegramNotificationSent', data);
  });

  // New message events
  socket.on('newMessage', (data) => {
    console.log('📨 New message received:', data);
    // Broadcast to all admin users
    io.emit('newMessage', data);
  });

  socket.on('messageResponse', (data) => {
    console.log('📨 Message response sent:', data);
    // Broadcast to specific user or all relevant parties
    io.emit('messageResponse', data);
  });

  socket.on('emergencyResponse', (response) => {
    console.log('🚨 Emergency response:', response);
    io.emit('emergencyResponse', response);
  });

  socket.on('alertResolved', (alertId) => {
    console.log('✅ Alert resolved:', alertId);
    io.emit('alertResolved', alertId);
  });

  socket.on('alertAcknowledged', (alert) => {
    console.log('✅ Alert acknowledged:', alert._id);
    io.emit('alertAcknowledged', alert);
  });

  socket.on('alertRemoved', (alertId) => {
    console.log('🗑️ Alert removed:', alertId);
    io.emit('alertRemoved', alertId);
  });

  socket.on('newEmergencyAlert', (alert) => {
    console.log('🚨 New emergency alert:', alert);
    io.emit('newEmergencyAlert', alert);
  });

  // Handle user joining specific rooms (for targeted messaging)
  socket.on('joinAdminRoom', () => {
    socket.join('admins');
    console.log(`👤 User ${socket.id} joined admin room`);
  });

  socket.on('joinResidentRoom', (userId) => {
    socket.join(`resident_${userId}`);
    console.log(`👤 User ${socket.id} joined resident room for user ${userId}`);
  });

  socket.on('disconnect', () => {
    console.log('🔌 User disconnected:', socket.id);
  });
});

// ❗ Error Handler
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Error:`, err.stack);

  if (req.originalUrl.startsWith('/api')) {
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
  } else {
    res.status(500).sendFile(path.join(__dirname, "public", "500.html"));
  }
});

// 404 Handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: 'API endpoint not found'
  });
});

// 404 Handler for HTML routes
app.use('*', (req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
});

const Shutdown = () => {
  console.log('🛑 Shutting down ...');
  server.close(() => {
    console.log('🚪 Server closed');
    mongoose.connection.close(false)
      .then(() => {
        console.log('🗄️ MongoDB connection closed');
        process.exit(0);
      })
      .catch(err => {
        console.error('❌ Error closing MongoDB connection:', err);
        process.exit(1);
      });
  });
};

process.on('SIGINT', Shutdown);
process.on('SIGTERM', Shutdown);  

// 🚀 Start Server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Access via: ${process.env.FRONTEND_URL || `http://localhost:${PORT}`}`);
  console.log(`📧 Email system: Configured`);
  console.log(`💬 Message system: Enabled`);
  console.log(`📱 Telegram Bot: ${process.env.TELEGRAM_BOT_TOKEN ? 'ACTIVE' : 'NOT CONFIGURED'}`);
  console.log(`🚨 Emergency SMS system: ACTIVE (Multiple FREE APIs)`);
  console.log(`⚡ Enhanced features:`);
  console.log(`   - CallMeBot WhatsApp API`);
  console.log(`   - TextBelt SMS API (50/day free)`);
  console.log(`   - SMS77 Backup API`);
  console.log(`   - Telegram Bot API (Recommended)`);
  console.log(`   - Fallback email notification`);
  console.log(`   - Real-time socket notifications`);
  console.log(`🔄 Automatic request expiration: ACTIVE (runs every hour)`);
  console.log(`📄 Document Generation: ACTIVE (Summons, CFA, Settlement)`);
  
  // Start automatic request processing
  setupAutomaticRequestProcessing();
  
  // Test Telegram connection on startup
  if (process.env.TELEGRAM_BOT_TOKEN) {
    testTelegramConnection().then(result => {
      if (result.success) {
        console.log(`🤖 Telegram Bot Connected: @${result.bot_username}`);
      } else {
        console.log(`❌ Telegram Bot Error: ${result.error}`);
      }
    });
  }
});