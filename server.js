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
const cloudinary = require('cloudinary').v2;

// Cloudinary Configuration
cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Import the cleanup scheduler
const { startCleanupSchedule } = require('./middleware/announcementCleanup');
const { authMiddleware, adminMiddleware } = require('./middleware/authMiddleware');

const app = express();
const server = http.createServer(app);

// Enhanced Socket.IO Configuration for Production
const io = new Server(server, {
  cors: {
    origin: [
      process.env.FRONTEND_URL,
      "https://barangay-management-system-eight.vercel.app",
      "http://localhost:3000"
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    transports: ['websocket', 'polling']
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true
  }
});

// Port Configuration
const PORT = process.env.PORT || 3000;

// Modern MongoDB Connection (removed deprecated options)
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/test')
  .then(() => {
    console.log("✅ Connected to MongoDB");
    startCleanupSchedule();
  })
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// File Upload Handling (consider switching to Cloudinary in production)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Created uploads directory');
}

app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    if (filePath.match(/\.(jpg|jpeg|png|gif)$/)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Static Files with Cache Control
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, filePath) => {
    const cacheControl = filePath.match(/\.(css|js|html)$/) 
      ? 'public, max-age=0' 
      : 'public, max-age=31536000, immutable';
    res.setHeader('Cache-Control', cacheControl);
  }
}));

// Secure Session Configuration
const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGO_URI,
  collectionName: 'sessions',
  ttl: 24 * 60 * 60 // 1 day
});

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 1 day
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    domain: process.env.NODE_ENV === 'production' ? '.barangay-management-system-eight.vercel.app' : undefined
  }
}));

// Production-Grade CORS
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    "https://barangay-management-system-eight.vercel.app",
    "http://localhost:3000"
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['set-cookie'],
  maxAge: 600
}));

// Security Middleware
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.disable('x-powered-by');

// Make Socket.IO available in routes
app.set('io', io);

// Route Imports
const routes = [
  require("./routes/authRoutes"),
  require("./routes/residentRoutes"),
  require("./routes/blotterRoutes"),
  require("./routes/requestsRoutes"),
  require("./routes/adminRoutes"),
  require("./routes/announceRoutes"),
  require("./routes/emergencyRoutes")
];

// Mount all routes
routes.forEach(route => app.use("/api", route));

// Protected Routes
const protectedRoutes = {
  "/admin-dashboard.html": [authMiddleware, adminMiddleware],
  "/admin-blotter.html": [authMiddleware, adminMiddleware],
  "/residentdashboard.html": authMiddleware
};

Object.entries(protectedRoutes).forEach(([path, middleware]) => {
  app.get(path, ...(Array.isArray(middleware) ? middleware : [middleware]), (req, res) => {
    res.sendFile(path.join(__dirname, "public", path));
  });
});

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    session: req.sessionID ? 'active' : 'inactive'
  });
});

// Enhanced Socket.IO Events
io.on('connection', (socket) => {
  console.log(`📡 Client connected: ${socket.id}`);

  socket.on('new_announcement', (announcement) => {
    io.emit('new_announcement', announcement);
  });

  socket.on('disconnect', (reason) => {
    console.log(`🔌 Client disconnected (${reason}): ${socket.id}`);
  });

  socket.on('error', (err) => {
    console.error(`Socket error (${socket.id}):`, err);
  });
});

// Error Handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ 
    error: err.message || 'Something went wrong!',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Server Startup
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`🛡️  Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    mongoose.connection.close(false, () => {
      console.log('🔒 MongoDB connection closed');
      process.exit(0);
    });
  });
});