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

// Import the cleanup scheduler
const { startCleanupSchedule } = require('./middleware/announcementCleanup');
const { authMiddleware, adminMiddleware } = require('./middleware/authMiddleware');

const app = express();
const server = http.createServer(app);

// Enhanced Socket.IO configuration
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  }
});

// Port Configuration
const PORT = process.env.PORT || 3000;

// Enhanced MongoDB Atlas Connection
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
  
  // Start the announcement cleanup scheduler
  startCleanupSchedule();
})
.catch(err => {
  console.error("❌ MongoDB Atlas Connection Error:", err);
  process.exit(1); // Exit if DB connection fails
});

// Ensure Uploads Folder Exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Created uploads directory');
}

// Serve Uploads with proper caching headers
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    if (filePath.match(/\.(jpg|jpeg|png|gif|pdf|docx)$/)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, filePath) => {
    if (filePath.match(/\.(css|js|html|json)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=0');
    }
  }
}));

// Default profile picture handler
app.get('/images/default-profile.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'images', 'default-profile.png'), {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  });
});

// Session Store Configuration for Atlas
const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGO_URI,
  collectionName: 'sessions',
  ttl: 14 * 24 * 60 * 60, // 14 days expiration
  autoRemove: 'native' // Native MongoDB TTL index
});

// Enhanced Session Configuration
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    domain: process.env.NODE_ENV === 'production' ? '.yourdomain.com' : undefined
  },
  name: 'btms.sid', // Custom session cookie name
  rolling: true // Reset maxAge on every request
}));

// Enhanced CORS Configuration
const corsOptions = {
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Origin', 'Accept'],
  exposedHeaders: ['set-cookie', 'Date', 'ETag'],
  maxAge: 86400
};
app.use(cors(corsOptions));

// Preflight OPTIONS handling
app.options('*', cors(corsOptions));

// Enhanced Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Make Socket Available
app.set('io', io);

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // limit each IP to 500 requests per windowMs
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// Routes
const authRoutes = require("./routes/authRoutes");
const residentRoutes = require("./routes/residentRoutes");
const blotterRoutes = require("./routes/blotterRoutes");
const requestsRoutes = require("./routes/requestsRoutes");
const adminRoutes = require("./routes/adminRoutes");
const announceRoutes = require("./routes/announceRoutes");
const emergencyRoutes = require("./routes/emergencyRoutes");

app.use("/api/auth", authRoutes);
app.use("/api/residents", residentRoutes);
app.use("/api/blotter", blotterRoutes);
app.use("/api/requests", requestsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/announcements", announceRoutes);
app.use("/api/emergency", emergencyRoutes);

// Protected HTML Routes with enhanced security headers
const setSecurityHeaders = (req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
};

app.get("/admin-dashboard.html", setSecurityHeaders, authMiddleware, adminMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-dashboard.html"));
});

app.get("/admin-blotter.html", setSecurityHeaders, authMiddleware, adminMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-blotter.html"));
});

app.get("/residentdashboard.html", setSecurityHeaders, authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "residentdashboard.html"));
});

// Default Route
app.get("/", setSecurityHeaders, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Enhanced Health Check
app.get('/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.status(200).json({ 
    status: 'healthy',
    database: dbStatus,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage()
  });
});

// Socket.IO Connection with enhanced events
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

// Enhanced Error Handling
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Error:`, err.stack);
  
  // Different error handling for API vs HTML routes
  if (req.originalUrl.startsWith('/api')) {
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
  } else {
    res.status(500).sendFile(path.join(__dirname, "public", "500.html"));
  }
});

// 404 Handler
app.use((req, res) => {
  if (req.originalUrl.startsWith('/api')) {
    res.status(404).json({ error: 'Endpoint not found' });
  } else {
    res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
  }
});

// Server startup with graceful shutdown
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

// Start Server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Access via: ${process.env.FRONTEND_URL || `http://localhost:${PORT}`}`);
});