const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { authMiddleware, adminMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();

// Temporary route to create first admin
router.post("/create-first-admin", async (req, res) => {
  try {
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      return res.status(400).json({ 
        message: "Admin already exists. Use the regular admin registration." 
      });
    }

    const firstAdmin = new User({
      fullName: "System Administrator",
      email: "admin@barangaytalipapa.com",
      password: "Admin123!",
      role: "admin",
      approvalStatus: "approved",
      adminSpecificFields: {
        position: "Brgy. Captain",
        department: "Office of the Barangay Captain"
      }
    });

    await firstAdmin.save();

    res.status(201).json({
      message: "First admin created successfully",
      credentials: {
        email: "admin@barangaytalipapa.com",
        password: "Admin123!"
      }
    });
  } catch (error) {
    console.error("First admin creation error:", error);
    res.status(500).json({ error: "Failed to create first admin" });
  }
});

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
      },
      approvalStatus: "approved" // Auto-approve initial admin
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

// Admin Registration (only accessible by existing admins)
router.post("/register", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const {
      fullName,
      email,
      password,
      position,
      department
    } = req.body;

    console.log("Admin registration attempt:", { fullName, email, position, department });

    // Validate required fields
    if (!fullName || !email || !password || !position || !department) {
      return res.status(400).json({ 
        error: "Missing required fields",
        message: "All fields are required" 
      });
    }

    // Password validation
    if (password.length < 8) {
      return res.status(400).json({
        error: "Password too short",
        message: "Password must be at least 8 characters long"
      });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ 
        error: "Email already exists",
        message: "This email is already registered" 
      });
    }

    const newAdmin = new User({
      fullName,
      email,
      password,
      role: "admin",
      approvalStatus: "approved", // Auto-approve admin accounts
      adminSpecificFields: {
        position,
        department
      }
    });

    await newAdmin.save();

    console.log("New admin created successfully:", newAdmin.email);

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
      error: "Internal server error",
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
        message: "Admin access only" 
      });
    }

    // Use the comparePassword method from your User model
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ 
        error: "Authentication error",
        message: "Invalid credentials" 
      });
    }

    // Set session
    req.session.userId = user._id;
    req.session.role = user.role;
    req.session.userEmail = user.email;

    // Save session
    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).json({ 
          error: "Session error",
          message: "Failed to save session" 
        });
      }

      return res.status(200).json({
        message: "✅ Login successful",
        user: {
          id: user._id,
          email: user.email,
          fullName: user.fullName,
          role: user.role
        },
        redirect: "/admin-dashboard"
      });
    });

  } catch (error) {
    console.error("Admin login error:", error);
    
    // Handle specific error messages from comparePassword
    if (error.message.includes('Account is temporarily locked') || 
        error.message.includes('Account locked due to too many failed attempts') ||
        error.message.includes('Invalid password')) {
      return res.status(400).json({ 
        error: "Authentication error",
        message: error.message 
      });
    }
    
    res.status(500).json({ 
      error: "Server error",
      message: "Failed to process login request" 
    });
  }
});

// Admin Session Check
router.get("/check-auth", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.json({ isAuthenticated: false });
    }

    const user = await User.findById(req.session.userId);
    if (!user || user.role !== 'admin') {
      return res.json({ isAuthenticated: false });
    }

    return res.json({
      isAuthenticated: true,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        fullName: user.fullName
      }
    });
  } catch (error) {
    console.error("Admin auth check error:", error);
    return res.json({ isAuthenticated: false });
  }
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