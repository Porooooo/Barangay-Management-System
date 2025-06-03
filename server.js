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

const app = express();
const server = http.createServer(app);

// Configure CORS for Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const PORT = process.env.PORT || 3000;

// Database Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/btms', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("✅ Connected to MongoDB"))
.catch(err => console.error("❌ MongoDB Connection Error:", err));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Created uploads directory');
}

// Session store using MongoDB
const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGO_URI || 'mongodb://localhost:27017/btms',
  collectionName: 'sessions'
});

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 1 day
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Serve uploaded files with proper caching
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    if (filePath.match(/\.(jpg|jpeg|png|gif)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

// Make io accessible in routes
app.set('io', io);

// Import routes
const authRoutes = require("./routes/authRoutes");
const residentRoutes = require("./routes/residentRoutes");
const blotterRoutes = require("./routes/blotterRoutes");
const requestsRoutes = require("./routes/requestsRoutes");
const adminRoutes = require("./routes/adminRoutes");
const announceRoutes = require("./routes/announceRoutes");
const emergencyRoutes = require("./routes/emergencyRoutes");

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/residents", residentRoutes);
app.use("/api/blotter", blotterRoutes);
app.use("/api/requests", requestsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/announcements", announceRoutes);
app.use("/api/emergency", emergencyRoutes);

// Protected routes
app.get("/admin-dashboard.html", (req, res, next) => {
  if (!req.session.userId || req.session.role !== 'admin') {
    return res.redirect('/');
  }
  next();
}, express.static(path.join(__dirname, "public")));

app.get("/staff-dashboard.html", (req, res, next) => {
  if (!req.session.userId || !['admin', 'staff'].includes(req.session.role)) {
    return res.redirect('/');
  }
  next();
}, express.static(path.join(__dirname, "public")));

app.get("/resident-dashboard.html", (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect('/');
  }
  next();
}, express.static(path.join(__dirname, "public")));

// Default Route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// WebSocket connection
io.on('connection', (socket) => {
  console.log('A user connected');
  
  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start Server
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
}); 