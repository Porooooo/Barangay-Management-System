const express = require("express");
const bcrypt = require("bcrypt");
const Admin = require("../models/Admin");
const User = require("../models/User");

const router = express.Router();

// Admin Registration
router.post("/register", async (req, res) => {
    try {
        const { fullName, email, status, password } = req.body;

        // Check if admin already exists
        const existingAdmin = await Admin.findOne({ email });
        if (existingAdmin) {
            return res.status(400).json({ error: "❌ Email already registered" });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new admin
        const newAdmin = new Admin({
            fullName,
            email,
            status,
            password: hashedPassword,
        });

        await newAdmin.save();
        res.status(201).json({ message: "✅ Admin registered successfully" });
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

// Admin Login
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find admin by email
        const admin = await Admin.findOne({ email });
        if (!admin) {
            return res.status(400).json({ error: "❌ Admin not found" });
        }

        // Compare passwords
        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
            return res.status(400).json({ error: "❌ Invalid credentials" });
        }

        // ✅ Set userId in session
        req.session.userId = admin._id;

        // Login successful
        res.status(200).json({
            message: "✅ Login successful",
            redirect: "/admin-dashboard.html",
        });
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

// Middleware to verify session (optional: use for protected routes)
const verifySession = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
};

// Fetch all users (protected with verifySession)
router.get("/users", verifySession, async (req, res) => {
    try {
        const users = await User.find().select('-password'); // Exclude passwords
        res.status(200).json(users);
    } catch (error) {
        res.status(500).json({ error: "❌ Failed to fetch users" });
    }
});

module.exports = router;
