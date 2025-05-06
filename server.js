const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const cors = require("cors");
const session = require("express-session");
const dotenv = require("dotenv");
const authRoutes = require("./routes/authRoutes");
const scheduleRoutes = require("./routes/scheduleRoutes");
const blotterRoutes = require("./routes/blotterRoutes");
const exchangeRoutes = require("./routes/exchangeRoutes");
const requestsRoutes = require("./routes/requestsRoutes");
const adminRoutes = require("./routes/adminRoutes");

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure CORS to allow credentials (cookies)
app.use(cors({
    origin: 'http://localhost:3000', // Replace with your frontend domain
    credentials: true // Allow cookies to be sent
}));

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, "public")));

// Serve uploaded files from the "uploads" directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Session configuration
app.use(
    session({
        secret: "secretKey", // Secret key for session encryption
        resave: false, // Don't resave the session if it hasn't changed
        saveUninitialized: true, // Save new sessions
        cookie: { secure: false } // Set to true if using HTTPS
    })
);

// Database Connection
mongoose
    .connect(process.env.MONGO_URI) // Removed deprecated options
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch((err) => console.error("❌ MongoDB Connection Error:", err));

// Routes
app.use("/api/auth", authRoutes); // Authentication routes
app.use("/api/schedule", scheduleRoutes); // Schedule routes
app.use("/api/blotter", blotterRoutes); // Blotter routes
app.use("/api/requests", requestsRoutes); // Requests routes
app.use("/api/admin", adminRoutes); // Admin routes

// Default Route    
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Middleware to check if user is an admin
const isAdmin = (req, res, next) => {
    if (req.session.userEmail && req.session.userEmail.endsWith('@admin.com')) { // Adjust the condition as per your admin email logic
        next();
    } else {
        res.status(403).json({ error: "❌ Forbidden: Access denied" });
    }
};

// Protect the manage-resident route
app.get("/manage-resident.html", isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "manage-resident.html"));
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});