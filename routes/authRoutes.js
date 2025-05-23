const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const User = require("../models/User");

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../uploads/'));
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// User Registration
router.post("/register", upload.single('profilePicture'), async (req, res) => {
  try {
    const formData = req.body;
    const file = req.file;
    
    // Validate required fields
    if (!formData.fullName || !formData.email || !formData.contactNumber || 
        !formData.address || !formData.birthdate || !formData.password || 
        !formData.confirmPassword) {
      return res.status(400).json({ 
        error: "Validation error",
        message: "All required fields must be provided" 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      return res.status(400).json({ 
        error: "Validation error",
        message: "Invalid email format" 
      });
    }

    // Check password match
    if (formData.password !== formData.confirmPassword) {
      return res.status(400).json({ 
        error: "Validation error",
        message: "Passwords do not match" 
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: formData.email });
    if (existingUser) {
      return res.status(400).json({ 
        error: "Duplicate email",
        message: "Email already registered" 
      });
    }

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(formData.password, salt);

    // Handle occupation
    const occupation = formData.occupation === 'Others' 
      ? formData.otherOccupation 
      : formData.occupation;

    // Create new user
    const newUser = new User({
      fullName: formData.fullName,
      email: formData.email,
      contactNumber: formData.contactNumber,
      address: formData.address,
      birthdate: new Date(formData.birthdate),
      civilStatus: formData.civilStatus,
      occupation: occupation,
      educationalAttainment: formData.educationalAttainment,
      registeredVoter: formData.registeredVoter === 'true',
      fourPsMember: formData.fourPsMember === 'true',
      pwdMember: formData.pwdMember === 'true',
      seniorCitizen: formData.seniorCitizen === 'true',
      pregnant: formData.pregnant === 'true',
      password: hashedPassword,
      profilePicture: file ? file.filename : 'default-profile.png'
    });

    // Save user
    await newUser.save();

    // Set session
    req.session.userId = newUser._id;
    req.session.userEmail = newUser.email;
    req.session.isAdmin = false;

    return res.status(201).json({ 
      message: "User registered successfully",
      user: {
        id: newUser._id,
        email: newUser.email,
        fullName: newUser.fullName
      }
    });

  } catch (error) {
    console.error("Registration error:", error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        error: "Validation error",
        message: error.message 
      });
    }
    return res.status(500).json({ 
      error: "Server error",
      message: "Failed to register user" 
    });
  }
});

// User Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('Login attempt for:', email);

    // Validate input
    if (!email || !password) {
      console.log('Missing credentials');
      return res.status(400).json({ 
        error: "Validation error",
        message: "Email and password are required" 
      });
    }

    // Find user with password explicitly selected
    const user = await User.findOne({ email }).select('+password');
    
    if (!user) {
      console.log('User not found:', email);
      return res.status(401).json({ 
        error: "Authentication error",
        message: "Invalid email or password" 
      });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    console.log('Password match:', isMatch);

    if (!isMatch) {
      return res.status(401).json({  
        error: "Authentication error",
        message: "Invalid email or password" 
      });
    }

    // Set session
    req.session.userId = user._id;
    req.session.userEmail = user.email;
    req.session.isAdmin = user.email.endsWith('@admin.com');
    
    console.log('Session after login:', req.session);

    return res.status(200).json({ 
      message: "Logged in successfully", 
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        isAdmin: req.session.isAdmin
      }
    });

  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ 
      error: "Server error",
      message: "Failed to login",
      details: error.message
    });
  }
});

// User Logout
router.post("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ 
        error: "Server error",
        message: "Failed to logout" 
      });
    }
    res.clearCookie('connect.sid');
    return res.status(200).json({ message: "Logged out successfully" });
  });
});

// Check Authentication Status
router.get("/check-auth", (req, res) => {
  if (req.session.userId) {
    return res.status(200).json({ 
      isAuthenticated: true,
      user: {
        id: req.session.userId,
        email: req.session.userEmail,
        isAdmin: req.session.isAdmin
      }
    });
  }
  return res.status(200).json({ isAuthenticated: false });
});

// Get user profile
router.get("/profile", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ 
      error: "Unauthorized",
      message: "Please log in to access this resource"
    });
  }

  try {
    const user = await User.findById(req.session.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ 
        error: "Not found",
        message: "User not found"
      });
    }

    return res.status(200).json(user);
  } catch (error) {
    console.error("Profile error:", error);
    return res.status(500).json({ 
      error: "Server error",
      message: "Failed to fetch profile"
    });
  }
});

module.exports = router;