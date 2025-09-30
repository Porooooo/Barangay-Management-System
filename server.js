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
    domain: process.env.NODE_ENV === 'production' ? 'barangay-management-system-1-xfkw.onrender.com' : undefined
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

// ⚡ Make Socket Available to Routes
app.set('io', io);

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
// Routes
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


// 🔐 Protected HTML Routes
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

// 📍 Home
app.get("/", setSecurityHeaders, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
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
});
