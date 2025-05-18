const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const cors = require("cors");
const session = require("express-session");
const dotenv = require("dotenv");
const http = require('http');
const { Server } = require('socket.io');
const authRoutes = require("./routes/authRoutes");
const scheduleRoutes = require("./routes/scheduleRoutes");
const blotterRoutes = require("./routes/blotterRoutes");
const exchangeRoutes = require("./routes/exchangeRoutes");
const requestsRoutes = require("./routes/requestsRoutes");
const adminRoutes = require("./routes/adminRoutes");
const announceRoutes = require("./routes/announceRoutes");
const emergencyRoutes = require("./routes/emergencyRoutes"); // Add this line

dotenv.config();
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure CORS to allow credentials (cookies)
app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true
}));

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, "public")));

// Serve uploaded files from the "uploads" directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Session configuration
app.use(
    session({
        secret: "secretKey",
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false }
    })
);

// Database Connection
mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch((err) => console.error("❌ MongoDB Connection Error:", err));

// Make io accessible in routes
app.set('io', io);

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/schedule", scheduleRoutes);
app.use("/api/blotter", blotterRoutes);
app.use("/api/requests", requestsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/announcements", announceRoutes);
app.use("/api/emergency", emergencyRoutes); // Add this line

// Default Route    
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Middleware to check if user is an admin
const isAdmin = (req, res, next) => {
    if (req.session.userEmail && req.session.userEmail.endsWith('@admin.com')) {
        next();
    } else {
        res.status(403).json({ error: "❌ Forbidden: Access denied" });
    }
};

// Protect the manage-resident route
app.get("/manage-resident.html", isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "manage-resident.html"));
});

// WebSocket connection
io.on('connection', (socket) => {
    console.log('A user connected');
    
    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// Start Server
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});