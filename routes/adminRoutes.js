const express = require("express");
const bcrypt = require("bcrypt");
const Admin = require("../models/Admin");
const User = require("../models/User"); // Import the User model

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

        // Login successful
        res.status(200).json({
            message: "✅ Login successful",
            redirect: "/admin-dashboard.html", // Redirect to admin dashboard
        });
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

// Fetch all users
router.get("/users", async (req, res) => {
    try {
        const users = await User.find().select('-password'); // Exclude passwords
        res.status(200).json(users);
    } catch (error) {
        res.status(500).json({ error: "❌ Failed to fetch users" });
    }
});

module.exports = router;