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

const { startCleanupSchedule } = require('./middleware/announcementCleanup');
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
  startCleanupSchedule();
})
.catch(err => {
  console.error("❌ MongoDB Atlas Connection Error:", err);
  process.exit(1);
});

// 📧 Email Transporter Configuration - FIXED: createTransport (not createTransporter)
const emailTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Verify email configuration
emailTransporter.verify((error, success) => {
  if (error) {
    console.error('❌ Email configuration error:', error);
  } else {
    console.log('✅ Email server is ready to send messages');
  }
});

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

// 🔐 Rate Limit
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// 🛣️ Routes
const authRoutes = require("./routes/authRoutes");
const residentRoutes = require("./routes/residentRoutes");
const blotterRoutes = require("./routes/blotterRoutes");
const requestsRoutes = require("./routes/requestsRoutes");
const adminRoutes = require("./routes/adminRoutes");
const announceRoutes = require("./routes/announceRoutes");
const emergencyRoutes = require("./routes/emergencyRoutes");
const approvalRoutes = require("./routes/approvalRoutes");

app.use("/api/auth", authRoutes);
app.use("/api/residents", residentRoutes);
app.use("/api/blotter", blotterRoutes);
app.use("/api/requests", requestsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/announcements", announceRoutes);
app.use("/api/emergency", emergencyRoutes);
app.use("/api/approvals", approvalRoutes);

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

app.get("/emergency", setSecurityHeaders, authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "emergency.html"));
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

// 🩺 Health Check
app.get('/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.status(200).json({ 
    status: 'healthy',
    database: dbStatus,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage()
  });
});

// 📡 Socket.IO Events
io.on('connection', (socket) => {
  console.log('📡 New user connected:', socket.id);
  
  socket.on('new_announcement', (announcement) => {
    io.emit('new_announcement', announcement);
  });

  socket.on('emergency_alert', (alert) => {
    io.emit('emergency_alert', alert);
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

// ❓ 404 Not Found
app.use((req, res) => {
  if (req.originalUrl.startsWith('/api')) {
    res.status(404).json({ error: 'Endpoint not found' });
  } else {
    res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
  }
});

// 🛑 Graceful Shutdown
const gracefulShutdown = () => {
  console.log('🛑 Shutting down gracefully...');
  server.close(() => {
    console.log('🚪 Server closed');
    mongoose.connection.close(false, () => {
      console.log('🗄️ MongoDB connection closed');
      process.exit(0);
    });
  });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// 🚀 Start Server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Access via: ${process.env.FRONTEND_URL || `http://localhost:${PORT}`}`);
  console.log(`📧 Email system: ${process.env.EMAIL_USER ? 'Configured' : 'Not configured'}`);
});