// routes/adminRoutes.js
const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { authMiddleware, adminMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();

// ✅ Admin Registration (only accessible by super admin)
router.post("/register", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    // Check if current user is super admin
    const currentAdmin = await User.findById(req.session.userId);
    if (!currentAdmin?.adminSpecificFields?.isSuperAdmin) {
      return res.status(403).json({ error: "❌ Only super admins can register new admins" });
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

    const hashedPassword = await bcrypt.hash(password, 10);

    // Default fields for admin registration
    const defaultFields = {
      contactNumber: "N/A",
      address: "Barangay Hall",
      birthdate: new Date(2000, 0, 1),
      status: "Active",
      role: "admin"
    };

    const newAdmin = new User({
      fullName,
      email,
      password: hashedPassword,
      ...defaultFields,
      adminSpecificFields: {
        position,
        department,
        isSuperAdmin: false // Only super admins can create other super admins
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
    return res.status(500).json({ error: "❌ Internal server error" });
  }
});

// ✅ Admin Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const admin = await User.findOne({ email, role: 'admin' }).select("+password");
    if (!admin) {
      return res.status(400).json({ error: "❌ Admin not found" });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(400).json({ error: "❌ Invalid credentials" });
    }

    req.session.userId = admin._id;
    req.session.role = admin.role;
    req.session.userEmail = admin.email;

    return res.status(200).json({
      message: "✅ Login successful",
      user: {
        id: admin._id,
        email: admin.email,
        fullName: admin.fullName,
        role: admin.role
      },
      redirect: "/admin-dashboard.html"
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({ error: "❌ Server error" });
  }
});

// ✅ Admin Session Check
router.get("/check-auth", (req, res) => {
  if (!req.session.userId || req.session.role !== 'admin') {
    return res.json({ isAuthenticated: false });
  }

  return res.json({
    isAuthenticated: true,
    user: {
      id: req.session.userId,
      email: req.session.userEmail,
      role: req.session.role
    }
  });
});

// ✅ Fetch All Users (Admin Only)
router.get("/users", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "❌ Failed to fetch users" });
  }
});

module.exports = router;