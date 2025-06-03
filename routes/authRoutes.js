const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const fs = require('fs');
const User = require("../models/User");

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'profile-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { 
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1
  }
});

// Enhanced profile endpoint
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

    // Helper function to verify file exists
    const verifyProfilePicture = (filename) => {
      if (!filename) return false;
      const filePath = path.join(__dirname, '../uploads', filename);
      return fs.existsSync(filePath);
    };

    // Construct response data
    const responseData = {
      ...user.toObject(),
      profilePictureUrl: verifyProfilePicture(user.profilePicture)
        ? `${req.protocol}://${req.get('host')}/uploads/${user.profilePicture}?${Date.now()}`
        : `${req.protocol}://${req.get('host')}/images/profile.jpg`
    };

    return res.status(200).json(responseData);
  } catch (error) {
    console.error("Profile error:", error);
    return res.status(500).json({ 
      error: "Server error",
      message: "Failed to fetch profile"
    });
  }
});

// User Registration with enhanced file handling
router.post("/register", upload.single('profilePicture'), async (req, res) => {
  try {
    const formData = req.body;
    const file = req.file;

    // Validate required fields
    if (!formData.fullName || !formData.email || !formData.contactNumber || 
        !formData.address || !formData.birthdate || !formData.password || 
        !formData.confirmPassword) {
      if (file) fs.unlinkSync(file.path); // Clean up uploaded file
      return res.status(400).json({ 
        error: "Validation error",
        message: "All required fields must be provided" 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      if (file) fs.unlinkSync(file.path); // Clean up uploaded file
      return res.status(400).json({ 
        error: "Validation error",
        message: "Invalid email format" 
      });
    }

    // Check password match
    if (formData.password !== formData.confirmPassword) {
      if (file) fs.unlinkSync(file.path); // Clean up uploaded file
      return res.status(400).json({ 
        error: "Validation error",
        message: "Passwords do not match" 
      });
    }

    // Check existing user
    const existingUser = await User.findOne({ email: formData.email });
    if (existingUser) {
      if (file) fs.unlinkSync(file.path); // Clean up uploaded file
      return res.status(400).json({ 
        error: "Duplicate email",
        message: "Email already registered" 
      });
    }

    // Hash password
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
      profilePicture: file ? file.filename : 'default-profile.png',
      role: 'resident'
    });

    // Save user
    await newUser.save();

    // Set session
    req.session.userId = newUser._id;
    req.session.userEmail = newUser.email;
    req.session.role = newUser.role;
    
    return res.status(201).json({ 
      message: "User registered successfully",
      user: {
        id: newUser._id,
        email: newUser.email,
        fullName: newUser.fullName,
        profilePictureUrl: file 
          ? `${req.protocol}://${req.get('host')}/uploads/${file.filename}`
          : `${req.protocol}://${req.get('host')}/images/profile.jpg`,
        role: newUser.role
      }
    });

  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path); // Clean up on error
    console.error("Registration error:", error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        error: "Validation error",
        message: error.message 
      });
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: "File too large",
        message: "Profile picture must be less than 5MB"
      });
    }
    if (error.message === 'Only image files are allowed!') {
      return res.status(400).json({
        error: "Invalid file type",
        message: "Only JPG, JPEG, PNG, and GIF files are allowed"
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
    req.session.role = user.role;
    
    console.log('Session after login:', req.session);

    return res.status(200).json({ 
      message: "Logged in successfully", 
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        profilePictureUrl: user.profilePicture.startsWith('http') ? 
          user.profilePicture : `/uploads/${user.profilePicture}`,
        role: user.role
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

// Update Profile Picture
router.post("/update-profile-picture", upload.single('profilePicture'), async (req, res) => {
  try {
    if (!req.session.userId) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(401).json({ 
        error: "Unauthorized",
        message: "Please log in to update profile picture" 
      });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ 
        error: "Validation error",
        message: "No file uploaded" 
      });
    }

    // Update user's profile picture in database
    const user = await User.findById(req.session.userId);
    
    // Delete old profile picture if it's not the default
    if (user.profilePicture && user.profilePicture !== 'default-profile.png') {
      const oldFilePath = path.join(__dirname, '../uploads', user.profilePicture);
      if (fs.existsSync(oldFilePath)) {
        fs.unlinkSync(oldFilePath);
      }
    }

    user.profilePicture = file.filename;
    await user.save();

    res.status(200).json({ 
      message: "Profile picture updated successfully",
      profilePictureUrl: `${req.protocol}://${req.get('host')}/uploads/${file.filename}`
    });

  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    console.error("Error updating profile picture:", error);
    res.status(500).json({ 
      error: "Server error",
      message: "Failed to update profile picture" 
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
        role: req.session.role
      }
    });
  }
  return res.status(200).json({ isAuthenticated: false });
});

module.exports = router;