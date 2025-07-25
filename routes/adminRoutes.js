const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { authMiddleware, adminMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();

// Special route for initial admin registration (only works when no admins exist)
router.post("/initial-register", async (req, res) => {
  try {
    // Check if any admin already exists
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      return res.status(403).json({ 
        error: "Forbidden",
        message: "Initial admin already exists. Please log in to create new admins."
      });
    }

    const {
      fullName,
      email,
      password,
      position,
      department
    } = req.body;

    // Validate required fields
    if (!fullName || !email || !password || !position || !department) {
      return res.status(400).json({ error: "❌ Missing required fields" });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: "❌ Email already exists" });
    }

    const newAdmin = new User({
      fullName,
      email,
      password,
      role: "admin",
      adminSpecificFields: {
        position,
        department
      }
    });

    await newAdmin.save();

    return res.status(201).json({
      message: "✅ Initial admin registered successfully",
      user: {
        id: newAdmin._id,
        email: newAdmin.email,
        fullName: newAdmin.fullName,
        role: newAdmin.role,
        position: newAdmin.adminSpecificFields.position
      }
    });
  } catch (error) {
    console.error("Initial admin registration error:", error);
    return res.status(500).json({ error: "❌ Internal server error" });
  }
});

// Admin Registration (only accessible by admins)
router.post("/register", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const {
      fullName,
      email,
      password,
      position,
      department
    } = req.body;

    // Validate required fields
    if (!fullName || !email || !password || !position || !department) {
      return res.status(400).json({ error: "❌ Missing required fields" });
    }

    // Password validation
    if (password.length < 8 || 
        !/[A-Z]/.test(password) || 
        !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      return res.status(400).json({
        error: "Password requirements not met",
        message: "Password must be at least 8 characters long, contain one uppercase letter and one special character"
      });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: "❌ Email already exists" });
    }

    const newAdmin = new User({
      fullName,
      email,
      password,
      role: "admin",
      adminSpecificFields: {
        position,
        department
      }
    });

    await newAdmin.save();

    return res.status(201).json({
      message: "✅ Admin registered successfully",
      user: {
        id: newAdmin._id,
        email: newAdmin.email,
        fullName: newAdmin.fullName,
        role: newAdmin.role,
        position: newAdmin.adminSpecificFields.position
      }
    });
  } catch (error) {
    console.error("Admin registration error:", error);
    return res.status(500).json({ 
      error: "❌ Internal server error",
      message: error.message || "Failed to register admin" 
    });
  }
});

// Admin Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        error: "Validation error",
        message: "Email and password are required" 
      });
    }

    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return res.status(400).json({ 
        error: "Authentication error",
        message: "Invalid credentials" 
      });
    }

    // Check if user is an admin
    if (user.role !== 'admin') {
      return res.status(403).json({ 
        error: "Forbidden",
        message: "Admin login only. Please use the regular user login."
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ 
        error: "Authentication error",
        message: "Invalid credentials" 
      });
    }

    // Generate JWT token (if using token-based auth)
    // const token = generateToken(user._id, user.role);
    
    // For session-based auth
    req.session.userId = user._id;
    req.session.role = user.role;
    req.session.userEmail = user.email;

    return res.status(200).json({
      message: "✅ Login successful",
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      },
      redirect: "/admin-dashboard.html"
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({ 
      error: "❌ Server error",
      message: "Failed to process login request" 
    });
  }
});

// Admin Session Check
router.get("/check-auth", authMiddleware, adminMiddleware, (req, res) => {
  return res.json({
    isAuthenticated: true,
    user: {
      id: req.user._id,
      email: req.user.email,
      role: req.user.role,
      fullName: req.user.fullName
    }
  });
});

// Fetch All Users (Admin Only)
router.get("/users", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { role } = req.query;
    let query = {};
    
    if (role) {
      query.role = role;
    }

    const users = await User.find(query).select("-password -resetPasswordToken -resetPasswordExpires");
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ 
      error: "❌ Failed to fetch users",
      message: error.message 
    });
  }
});

module.exports = router;