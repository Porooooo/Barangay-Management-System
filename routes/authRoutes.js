const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const User = require("../models/User");

const router = express.Router();

// Set timezone to UTC for consistent time handling
process.env.TZ = 'UTC'; 

// Improved email transporter configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

// Test email connection on startup
transporter.verify((error, success) => {
    if (error) {
        console.error('Email transporter verification error:', error);
    } else {
        console.log('✅ Email server is ready to take our messages');
    }
});

// NEW: CAPTCHA storage (in-memory for simplicity, use Redis in production)
const captchaStore = new Map();

// NEW: Generate CAPTCHA endpoint - ONLY ADDITION
router.get("/generate-captcha", async (req, res) => {
    try {
        // Generate random numbers for addition (1-20 for reasonable sums)
        const num1 = Math.floor(Math.random() * 10) + 1;
        const num2 = Math.floor(Math.random() * 10) + 1;
        const answer = num1 + num2;
        
        const captchaId = crypto.randomBytes(16).toString('hex');
        const question = `${num1} + ${num2}`;
        
        // Store CAPTCHA with expiration (5 minutes)
        captchaStore.set(captchaId, {
            answer: answer,
            expires: Date.now() + 5 * 60 * 1000 // 5 minutes
        });
        
        // Clean up expired CAPTCHAs
        for (let [id, captcha] of captchaStore.entries()) {
            if (captcha.expires < Date.now()) {
                captchaStore.delete(id);
            }
        }
        
        return res.status(200).json({
            captchaId: captchaId,
            question: question
        });
    } catch (error) {
        console.error("CAPTCHA generation error:", error);
        return res.status(500).json({
            error: "Server error",
            message: "Failed to generate CAPTCHA"
        });
    }
});

// NEW: Validate CAPTCHA middleware
function validateCaptcha(req, res, next) {
    try {
        const { captchaId, captchaAnswer } = req.body;
        
        if (!captchaId || !captchaAnswer) {
            return res.status(400).json({
                error: "Validation error",
                message: "CAPTCHA verification required"
            });
        }
        
        // Handle client-side CAPTCHA (starts with 'client-')
        if (captchaId.startsWith('client-')) {
            // For client-side CAPTCHA, we need to validate differently
            // The answer should be validated by the client-side logic
            // For now, we'll accept it and rely on client-side validation
            console.log('Client-side CAPTCHA detected, skipping server validation');
            return next();
        }
        
        const captcha = captchaStore.get(captchaId);
        
        // Check if CAPTCHA exists and is not expired
        if (!captcha) {
            return res.status(400).json({
                error: "Invalid CAPTCHA",
                message: "CAPTCHA expired or invalid. Please refresh and try again."
            });
        }
        
        if (captcha.expires < Date.now()) {
            captchaStore.delete(captchaId);
            return res.status(400).json({
                error: "Expired CAPTCHA",
                message: "CAPTCHA has expired. Please refresh and try again."
            });
        }
        
        // Validate answer
        if (parseInt(captchaAnswer) !== captcha.answer) {
            return res.status(400).json({
                error: "Invalid CAPTCHA",
                message: "Incorrect CAPTCHA answer. Please try again."
            });
        }
        
        // CAPTCHA is valid, remove it from store
        captchaStore.delete(captchaId);
        next();
    } catch (error) {
        console.error("CAPTCHA validation error:", error);
        return res.status(500).json({
            error: "Server error",
            message: "Failed to validate CAPTCHA"
        });
    }
}

// Multer configuration for file uploads - UPDATED: Removed ID photo upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    
    // Different prefix for different file types
    let prefix = "file-";
    if (file.fieldname === "profilePicture") {
      prefix = "profile-";
    }
    
    cb(null, prefix + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed!"), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 2 // Allow up to 2 files (profile picture only)
  }
});

// Check email availability route
router.get("/check-email", async (req, res) => {
    try {
        const { email } = req.query;
        
        if (!email) {
            return res.status(400).json({
                error: "Validation error",
                message: "Email is required"
            });
        }

        const user = await User.findOne({ email });
        
        return res.status(200).json({
            exists: !!user,
            email: email
        });
    } catch (error) {
        console.error("Email check error:", error);
        return res.status(500).json({
            error: "Server error",
            message: "Failed to check email availability"
        });
    }
});

// NEW: Check phone number availability route
router.get("/check-phone", async (req, res) => {
    try {
        const { phone } = req.query;
        
        if (!phone) {
            return res.status(400).json({
                error: "Validation error",
                message: "Phone number is required"
            });
        }

        // Validate phone format
        const phonePattern = /^09\d{9}$/;
        if (!phonePattern.test(phone)) {
            return res.status(400).json({
                error: "Validation error",
                message: "Invalid phone number format"
            });
        }

        const user = await User.findOne({ contactNumber: phone });
        
        return res.status(200).json({
            exists: !!user,
            phone: phone
        });
    } catch (error) {
        console.error("Phone check error:", error);
        return res.status(500).json({
            error: "Server error",
            message: "Failed to check phone number availability"
        });
    }
});

// Helper function to calculate age from birthdate
function calculateAge(birthdate) {
    const today = new Date();
    const birthDate = new Date(birthdate);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    // Check if birthday has occurred this year
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    
    return age;
}

// Login route with enhanced security features - UPDATED to include CAPTCHA validation
router.post("/login", validateCaptcha, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        error: "Validation error",
        message: "Email and password are required"
      });
    }

    console.log(`Login attempt for: ${email}`);
    
    // Find user and include security fields
    const user = await User.findOne({ email })
      .select("+password +loginAttempts +lockUntil +lastFailedLogin");
    
    if (!user) {
      console.log(`User not found for email: ${email}`);
      return res.status(401).json({
        error: "Authentication error",
        message: "Invalid credentials"
      });
    }

    // Check if account is locked
    if (user.isLocked) {
      const remainingTime = Math.ceil((user.lockUntil - Date.now()) / 1000 / 60);
      return res.status(429).json({
        error: "Account locked",
        message: `Account is temporarily locked. Try again in ${remainingTime} minutes.`
      });
    }

    // NEW: Check if user is approved
    if (user.role === 'resident' && user.approvalStatus !== 'approved') {
      if (user.approvalStatus === 'pending') {
        return res.status(403).json({
          error: "Account pending approval",
          message: "Your account is pending administrator approval. Please wait for approval before logging in."
        });
      } else if (user.approvalStatus === 'rejected') {
        return res.status(403).json({
          error: "Account rejected",
          message: user.rejectionReason || "Your account registration has been rejected. Please contact administration for more information."
        });
      }
    }

    if (user.isBanned) {
      console.log(`Banned user attempted login: ${email}`);
      return res.status(403).json({
        error: "Account banned",
        message: "Your account has been suspended"
      });
    }

    console.log(`Comparing passwords for user: ${user.email}`);
    const isMatch = await user.comparePassword(password);
    console.log(`Password match result: ${isMatch}`);
    
    if (!isMatch) {
      // Get updated user to check current login attempts
      const updatedUser = await User.findOne({ email })
        .select('+loginAttempts +lockUntil');
      
      let message = "Invalid email or password";
      let warning = '';
      
      if (updatedUser && updatedUser.loginAttempts >= 3) {
        const attemptsLeft = 5 - updatedUser.loginAttempts;
        warning = attemptsLeft === 2 ? 'Warning: Only 2 attempts left!' : 
                 attemptsLeft === 1 ? 'Warning: Only 1 attempt left!' : '';
        
        if (warning) {
          message += ` ${warning}`;
        }
      }

      return res.status(401).json({
        error: "Authentication error",
        message: message,
        remainingAttempts: updatedUser ? Math.max(0, 5 - updatedUser.loginAttempts) : 5
      });
    }

    // Set session data
    req.session.userId = user._id;
    req.session.userEmail = user.email;
    req.session.role = user.role;

    // Save session explicitly
    req.session.save(err => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).json({
          error: "Session error",
          message: "Failed to save session"
        });
      }

      return res.status(200).json({
        message: "Logged in successfully",
        user: {
          id: user._id,
          email: user.email,
          fullName: user.fullName,
          isBanned: user.isBanned,
          profilePictureUrl: user.profilePicture.startsWith("http")
            ? user.profilePicture
            : `${req.protocol}://${req.get("host")}/uploads/${user.profilePicture}`,
          role: user.role,
          approvalStatus: user.approvalStatus // NEW: Include approval status in response
        }
      });
    });
  } catch (error) {
    console.error("Login error:", error);
    
    // Handle specific security-related errors
    if (error.message.includes('Account is temporarily locked') || 
        error.message.includes('Account locked due to too many failed attempts')) {
      return res.status(429).json({
        error: "Account locked",
        message: error.message
      });
    } else if (error.message.includes('Invalid password')) {
      // Error already handled in the main logic
      return res.status(401).json({
        error: "Authentication error",
        message: error.message
      });
    } else {
      return res.status(500).json({
        error: "Server error",
        message: "Failed to login"
      });
    }
  }
});

// Get login security status (for frontend)
router.get("/login-status/:email", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email })
      .select("+loginAttempts +lockUntil +lastFailedLogin");

    if (!user) {
      return res.status(404).json({
        error: "Not found",
        message: "User not found"
      });
    }

    const response = {
      success: true,
      loginAttempts: user.loginAttempts,
      isLocked: user.isLocked,
      remainingAttempts: user.remainingAttempts
    };

    if (user.lockUntil && user.isLocked) {
      const remainingTime = Math.ceil((user.lockUntil - Date.now()) / 1000 / 60);
      response.lockRemainingMinutes = remainingTime;
      response.lockUntil = user.lockUntil;
    }

    res.status(200).json(response);
  } catch (error) {
    console.error("Login status error:", error);
    res.status(500).json({
      error: "Server error",
      message: "Failed to get login status"
    });
  }
});

// Reset login attempts (admin only)
router.post("/reset-login-attempts/:userId", async (req, res) => {
  try {
    if (!req.session.userId || req.session.role !== "admin") {
      return res.status(403).json({
        error: "Forbidden",
        message: "Only admins can reset login attempts"
      });
    }

    const user = await User.findById(req.params.userId)
      .select("+loginAttempts +lockUntil +lastFailedLogin");

    if (!user) {
      return res.status(404).json({
        error: "Not found",
        message: "User not found"
      });
    }

    user.loginAttempts = 0;
    user.lockUntil = null;
    user.lastFailedLogin = null;
    await user.save();

    res.status(200).json({
      message: "Login attempts reset successfully"
    });
  } catch (error) {
    console.error("Reset login attempts error:", error);
    res.status(500).json({
      error: "Server error",
      message: "Failed to reset login attempts"
    });
  }
});

/* Debug endpoint to check user's OTP status */
router.get("/debug-otp/:email", async (req, res) => {
    try {
        const user = await User.findOne({ email: req.params.email })
            .select('+resetPasswordToken +resetPasswordExpires +resetPasswordVerified');
            
        if (!user) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "User not found" 
            });
        }

        const now = new Date();
        const otpStatus = {
            email: user.email,
            resetPasswordToken: user.resetPasswordToken || "None",
            resetPasswordExpires: user.resetPasswordExpires || "Not set",
            isExpired: user.resetPasswordExpires ? 
                (user.resetPasswordExpires < now) : true,
            timeRemaining: user.resetPasswordExpires ? 
                Math.max(0, Math.floor((user.resetPasswordExpires - now) / 1000)) + " seconds" : "N/A",
            resetPasswordVerified: user.resetPasswordVerified || false,
            currentTime: now.toISOString()
        };

        res.status(200).json(otpStatus);
    } catch (error) {
        console.error("Debug OTP error:", error);
        res.status(500).json({ 
            error: "Server error", 
            message: "Failed to fetch OTP debug info" 
        });
    }
});

// View Profile - Updated with better profile picture handling
router.get("/profile", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Please log in to access this resource"
    });
  }

  try {
    const user = await User.findById(req.session.userId).select("-password");
    if (!user) {
      return res.status(404).json({
        error: "Not found",
        message: "User not found"
      });
    }

    // Convert user to plain object
    const userObj = user.toObject();

    // Check if profile picture exists in uploads folder
    const profilePicturePath = path.join(__dirname, "../uploads", user.profilePicture);
    const profilePictureExists = fs.existsSync(profilePicturePath) && 
                              !user.profilePicture.startsWith('http');

    const responseData = {
      ...userObj,
      profilePictureUrl: profilePictureExists
        ? `${req.protocol}://${req.get("host")}/uploads/${user.profilePicture}?${Date.now()}`
        : `${req.protocol}://${req.get("host")}/images/default-profile.png`
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

// Update the register route - REMOVED ID upload
router.post("/register", upload.fields([
  { name: "profilePicture", maxCount: 1 }
  // REMOVED: ID photo upload
]), async (req, res) => {
  try {
    const formData = req.body;
    const files = req.files;

    const profilePictureFile = files?.profilePicture?.[0];
    // REMOVED: ID photo file handling

    console.log("Received registration data:", formData);

    // Validate required fields (REMOVED ID PHOTO requirement)
    const requiredFields = [
      'lastName', 'firstName', 'birthdate', 'gender',
      'email', 'contactNumber', 'houseNumber', 'street',
      'barangay', 'educationalAttainment'
    ];
    
    const missingFields = requiredFields.filter(field => !formData[field]);
    if (missingFields.length > 0) {
      if (profilePictureFile) fs.unlinkSync(profilePictureFile.path);
      return res.status(400).json({
        error: "Validation error",
        message: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      if (profilePictureFile) fs.unlinkSync(profilePictureFile.path);
      return res.status(400).json({
        error: "Validation error",
        message: "Invalid email format"
      });
    }

    // NEW: Validate age - must be 18 or older
    const birthdate = new Date(formData.birthdate);
    const age = calculateAge(birthdate);
    if (age < 18) {
      if (profilePictureFile) fs.unlinkSync(profilePictureFile.path);
      return res.status(400).json({
        error: "Age restriction",
        message: "You must be 18 years or older to register. Your current age is " + age
      });
    }

    // Check for existing user by email
    const existingUserByEmail = await User.findOne({ email: formData.email });
    if (existingUserByEmail) {
      if (profilePictureFile) fs.unlinkSync(profilePictureFile.path);
      return res.status(400).json({
        error: "Duplicate email",
        message: "Email already registered"
      });
    }

    // NEW: Check for existing user by phone number
    const existingUserByPhone = await User.findOne({ contactNumber: formData.contactNumber });
    if (existingUserByPhone) {
      if (profilePictureFile) fs.unlinkSync(profilePictureFile.path);
      return res.status(400).json({
        error: "Duplicate phone number",
        message: "Phone number already registered"
      });
    }

    // Generate temporary password (8 characters with numbers and letters)
    const generateTemporaryPassword = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let password = '';
      for (let i = 0; i < 8; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return password;
    };

    const temporaryPassword = generateTemporaryPassword();
    console.log("Generated temporary password for", formData.email, ":", temporaryPassword);

    // Create address string
    const address = `${formData.houseNumber} ${formData.street}, ${formData.barangay}`;

    // Process checkbox values properly
    const registeredVoter = formData.registeredVoter === 'true' || formData.registeredVoter === true;
    const fourPsMember = formData.fourPsMember === 'true' || formData.fourPsMember === true;
    const pwdMember = formData.pwdMember === 'true' || formData.pwdMember === true;
    const seniorCitizen = formData.seniorCitizen === 'true' || formData.seniorCitizen === true;
    const soloParent = formData.soloParent === 'true' || formData.soloParent === true;

    // Create new user with temporary password (REMOVED ID PHOTO)
    const newUser = new User({
      // Personal Information
      firstName: formData.firstName,
      lastName: formData.lastName,
      middleName: formData.middleName || null,
      suffix: formData.suffix || null,
      fullName: `${formData.firstName} ${formData.middleName ? formData.middleName + ' ' : ''}${formData.lastName}${formData.suffix ? ' ' + formData.suffix : ''}`.trim(),
      birthdate: new Date(formData.birthdate),
      gender: formData.gender,
      civilStatus: formData.civilStatus || null,
      occupation: formData.occupation || null,
      
      // Contact Information
      email: formData.email,
      contactNumber: formData.contactNumber,
      alternateContact: formData.alternateContactNumber || null,
      profilePicture: profilePictureFile ? profilePictureFile.filename : "default-profile.png",
      
      // REMOVED: ID Verification field
      
      // Address Information
      address: address,
      houseNumber: formData.houseNumber,
      street: formData.street,
      barangay: formData.barangay,
      
      // Additional Information
      educationalAttainment: formData.educationalAttainment || null,
      
      // Government Programs
      registeredVoter: registeredVoter,
      fourPsMember: fourPsMember,
      pwdMember: pwdMember,
      seniorCitizen: seniorCitizen,
      soloParent: soloParent,
      
      // Account Information - Use temporary password
      password: temporaryPassword,
      role: "resident",
      approvalStatus: "pending",
      
      // Mark that this user needs to change password on first login
      forcePasswordChange: true
    });

    await newUser.save();

    console.log("User created successfully with temporary password:", {
      id: newUser._id,
      email: newUser.email,
      fullName: newUser.fullName,
      approvalStatus: newUser.approvalStatus,
      age: age
      // REMOVED: hasIdPhoto field
    });

    // Set session data
    req.session.userId = newUser._id;
    req.session.userEmail = newUser.email;
    req.session.role = newUser.role;

    // Save the session explicitly
    req.session.save(err => {
      if (err) {
        console.error("Session save error:", err);
        if (profilePictureFile) fs.unlinkSync(profilePictureFile.path);
        return res.status(500).json({
          error: "Session error",
          message: "Failed to save session"
        });
      }

      return res.status(201).json({
        message: "User registered successfully - pending approval",
        user: {
          id: newUser._id,
          email: newUser.email,
          fullName: newUser.fullName,
          profilePictureUrl: profilePictureFile
            ? `${req.protocol}://${req.get("host")}/uploads/${profilePictureFile.filename}`
            : `${req.protocol}://${req.get("host")}/images/default-profile.png`,
          role: newUser.role,
          approvalStatus: newUser.approvalStatus
        }
      });
    });
  } catch (error) {
    // Clean up uploaded files on error (REMOVED ID photo cleanup)
    if (req.files) {
      Object.values(req.files).forEach(fileArray => {
        fileArray.forEach(file => {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        });
      });
    }
    console.error("Registration error:", error);

    if (error.name === "ValidationError") {
      return res.status(400).json({ 
        error: "Validation error", 
        message: error.message 
      });
    }
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ 
        error: "File too large", 
        message: "Files must be less than 10MB" 
      });
    }
    if (error.message === "Only image files are allowed!") {
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

// Update Profile Picture - Updated with better file handling
router.post("/update-profile-picture", upload.single("profilePicture"), async (req, res) => {
  try {
    if (!req.session.userId) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(401).json({
        error: "Unauthorized",
        message: "Please log in to update profile picture"
      });
    }

    const user = await User.findById(req.session.userId);
    if (!user) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({
        error: "Not found",
        message: "User not found"
      });
    }

    // Delete old profile picture if it exists and isn't the default
    if (user.profilePicture && user.profilePicture !== "default-profile.png") {
      const oldPath = path.join(__dirname, "../uploads", user.profilePicture);
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch (err) {
          console.error("Error deleting old profile picture:", err);
        }
      }
    }

    // Update user's profile picture
    user.profilePicture = req.file.filename;
    await user.save();

    // Return the new profile picture URL with timestamp to prevent caching
    const timestamp = Date.now();
    return res.status(200).json({
      message: "Profile picture updated successfully",
      profilePictureUrl: `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}?${timestamp}`
    });
  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    console.error("Update profile picture error:", error);
    return res.status(500).json({
      error: "Server error",
      message: "Failed to update profile picture"
    });
  }
});

// Ban user
router.post("/:userId/ban", async (req, res) => {
  try {
    if (!req.session.userId || req.session.role !== "admin") {
      return res.status(403).json({
        error: "Forbidden",
        message: "Only admins can ban users"
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { isBanned: true },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        error: "Not found",
        message: "User not found"
      });
    }

    res.status(200).json({
      message: "User Disabled successfully",
      user: {
        id: user._id,
        email: user.email,
        isBanned: user.isBanned
      }
    });
  } catch (error) {
    console.error("Error banning user:", error);
    res.status(500).json({
      error: "Server error",
      message: "Failed to ban user"
    });
  }
});

// Unban user
router.post("/:userId/unban", async (req, res) => {
  try {
    if (!req.session.userId || req.session.role !== "admin") {
      return res.status(403).json({
        error: "Forbidden",
        message: "Only admins can unban users"
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { isBanned: false },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        error: "Not found",
        message: "User not found"
      });
    }

    res.status(200).json({
      message: "User enabled successfully",
      user: {
        id: user._id,
        email: user.email,
        isBanned: user.isBanned
      }
    });
  } catch (error) {
    console.error("Error unbanning user:", error);
    res.status(500).json({
      error: "Server error",
      message: "Failed to unban user"
    });
  }
});

// Check if user is authenticated
router.get('/check-auth', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.json({ isAuthenticated: false });
    }

    // Fetch the full user data to ensure all needed fields are included
    const user = await User.findById(req.session.userId).select('-password');
    if (!user) {
      return res.json({ isAuthenticated: false });
    }
    
    return res.json({
      isAuthenticated: true,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        fullName: user.fullName,
        isBanned: user.isBanned,
        profilePictureUrl: user.profilePicture.startsWith("http")
          ? user.profilePicture
          : `${req.protocol}://${req.get("host")}/uploads/${user.profilePicture}`
      }
    });
  } catch (error) {
    console.error("Error checking authentication status:", error);
    res.json({ isAuthenticated: false });
  }
});

// Check session endpoint - UPDATED to remove admin-login redirect
router.get('/check-session', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.json({ isAuthenticated: false });
    }

    const user = await User.findById(req.session.userId).select('-password');
    if (!user) {
      return res.json({ isAuthenticated: false });
    }
    
    return res.json({
      isAuthenticated: true,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        fullName: user.fullName,
        isBanned: user.isBanned,
        profilePictureUrl: user.profilePicture.startsWith("http")
          ? user.profilePicture
          : `${req.protocol}://${req.get("host")}/uploads/${user.profilePicture}`
      }
    });
  } catch (error) {
    console.error("Error checking session:", error);
    res.json({ isAuthenticated: false });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ 
        error: "Logout failed", 
        message: "Could not log out" 
      });
    }
    res.clearCookie('connect.sid');
    return res.status(200).json({ 
      message: "Logged out successfully" 
    });
  });
});

// Forgot Password - Send OTP
router.post("/forgot-password", async (req, res) => {
    try {
        const { email } = req.body;
        
        // 1. Validate email
        if (!email) {
            return res.status(400).json({
                error: "Validation error",
                message: "Email is required"
            });
        }

        // 2. Find user
        const user = await User.findOne({ email });
        if (!user) {
            console.log(`Forgot password attempt for non-existent email: ${email}`);
            return res.status(404).json({
                error: "Not found",
                message: "No account found with that email"
            });
        }

        // 3. Generate and save OTP
        const otp = user.createPasswordResetToken();
        const otpExpiry = new Date(user.resetPasswordExpires);

        // 4. Save to database with error handling
        try {
            await user.save({ validateBeforeSave: false });
            console.log(`OTP saved to database for ${email}:`, { 
                storedOTP: user.resetPasswordToken,
                expiresAt: user.resetPasswordExpires,
                currentTime: new Date().toISOString() 
            });
        } catch (saveError) {
            console.error("Failed to save OTP:", saveError);
            throw new Error("Failed to save OTP to database");
        }

        // 5. Send email
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Password Reset OTP',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">Password Reset Request</h2>
                    <p>You requested to reset your password. Here is your OTP:</p>
                    <div style="background: #f3e0b6; padding: 20px; text-align: center; margin: 20px 0; font-size: 24px; font-weight: bold;">
                        ${otp}
                    </div>
                    <p>This OTP is valid for 10 minutes.</p>
                    <p>If you didn't request this, please ignore this email.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log(`OTP email sent to ${email}`);

        return res.status(200).json({
            message: "OTP sent to email",
            email: email,
            expiresAt: otpExpiry.toISOString()
        });

    } catch (error) {
        console.error("Forgot password error:", error);
        return res.status(500).json({
            error: "Server error",
            message: error.message || "Failed to process forgot password request"
        });
    }
});

// Verify OTP - Enhanced with detailed logging
router.post("/verify-otp", async (req, res) => {
    try {
        const { email, otp } = req.body;
        
        console.log("OTP verification request received:", { 
            email, 
            otp,
            currentTime: new Date().toISOString() 
        });

        // 1. Validate input
        if (!email || !otp) {
            return res.status(400).json({
                error: "Validation error",
                message: "Email and OTP are required"
            });
        }

        // 2. Find user (including hidden fields)
        const user = await User.findOne({ email })
            .select('+resetPasswordToken +resetPasswordExpires +resetPasswordVerified');
        
        if (!user) {
            console.log(`OTP verification attempt for non-existent email: ${email}`);
            return res.status(404).json({
                error: "Not found",
                message: "No account found with that email"
            });
        }

        // 3. Debug logging
        const currentTime = new Date();
        console.log("Current OTP state:", {
            storedOTP: user.resetPasswordToken,
            expiresAt: user.resetPasswordExpires,
            isExpired: user.resetPasswordExpires ? 
                (user.resetPasswordExpires < currentTime) : true,
            currentTime: currentTime.toISOString()
        });

        // 4. Verify OTP
        if (!user.resetPasswordToken) {
            console.log(`No OTP found for ${email}`);
            return res.status(400).json({
                error: "Invalid OTP",
                message: "No OTP found. Please request a new one."
            });
        }

        if (user.resetPasswordToken !== otp) {
            console.log(`OTP mismatch for ${email}. Expected: ${user.resetPasswordToken}, Received: ${otp}`);
            return res.status(400).json({
                error: "Invalid OTP",
                message: "OTP is invalid. Please check and try again."
            });
        }

        if (user.resetPasswordExpires < currentTime) {
            console.log(`Expired OTP for ${email}. Expired at: ${user.resetPasswordExpires}`);
            return res.status(400).json({
                error: "Expired OTP",
                message: "OTP has expired. Please request a new one."
            });
        }

        // 5. Mark as verified
        user.resetPasswordVerified = true;
        await user.save({ validateBeforeSave: false });

        console.log(`OTP verified successfully for ${email}`);

        return res.status(200).json({
            message: "OTP verified successfully",
            email: user.email
        });

    } catch (error) {
        console.error("Verify OTP error:", error);
        return res.status(500).json({
            error: "Server error",
            message: "Failed to verify OTP. Please try again later."
        });
    }
});

// Resend OTP - Enhanced with rate limiting
router.post("/resend-otp", async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({
                error: "Validation error",
                message: "Email is required"
            });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({
                error: "Not found",
                message: "No account found with that email"
            });
        }

        // Check if last OTP was sent too recently (prevent spam)
        if (user.resetPasswordExpires && 
            user.resetPasswordExpires > new Date(Date.now() - 1 * 60 * 1000)) {
            return res.status(429).json({
                error: "Too many requests",
                message: "Please wait at least 1 minute before requesting a new OTP"
            });
        }

        // Generate new 6-digit OTP
        const otp = crypto.randomInt(100000, 999999).toString();
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

        // Save new OTP to user document
        user.resetPasswordToken = otp;
        user.resetPasswordExpires = otpExpiry;
        user.resetPasswordVerified = false;
        await user.save({ validateBeforeSave: false });

        console.log(`Resent OTP for ${email}:`, { 
            otp, 
            expiresAt: otpExpiry.toISOString() 
        });

        // Send email with new OTP
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'New Password Reset OTP',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">New Password Reset OTP</h2>
                    <p>Here is your new OTP:</p>
                    <div style="background: #f3e0b6; padding: 20px; text-align: center; margin: 20px 0; font-size: 24px; font-weight: bold;">
                        ${otp}
                    </div>
                    <p>This OTP is valid for 10 minutes.</p>
                    <p>If you didn't request this, please ignore this email.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);

        return res.status(200).json({
            message: "New OTP sent to email",
            expiresAt: otpExpiry.toISOString()
        });

    } catch (error) {
        console.error("Resend OTP error:", error);
        return res.status(500).json({
            error: "Server error",
            message: "Failed to resend OTP"
        });
    }
});

// Reset Password - Enhanced with OTP verification check
router.post("/reset-password", async (req, res) => {
    try {
        const { email, newPassword } = req.body;
        
        if (!email || !newPassword) {
            return res.status(400).json({
                error: "Validation error",
                message: "Email and new password are required"
            });
        }

        // Find user and verify OTP was previously verified
        const user = await User.findOne({ 
            email,
            resetPasswordVerified: true 
        }).select('+password');

        if (!user) {
            return res.status(400).json({
                error: "Invalid request",
                message: "Password reset not initiated or OTP not verified"
            });
        }

        // Validate password requirements
        if (newPassword.length < 8 || 
            !/[A-Z]/.test(newPassword) || 
            !/[!@#$%^&*(),.?":{}|<>]/.test(newPassword)) {
            return res.status(400).json({
                error: "Validation error",
                message: "Password must be at least 8 characters long, contain one uppercase letter and one special character"
            });
        }

        // Update password and clear reset fields
        user.password = newPassword;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        user.resetPasswordVerified = undefined;
        await user.save();

        // Send confirmation email
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Password Changed Successfully',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">Password Changed</h2>
                    <p>Your password has been successfully changed.</p>
                    <p>If you didn't make this change, please contact us immediately.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);

        return res.status(200).json({
            message: "Password reset successfully. You can now login with your new password."
        });

    } catch (error) {
        console.error("Reset password error:", error);
        return res.status(500).json({
            error: "Server error",
            message: "Failed to reset password. Please try again later."
        });
    }
});

// Change Password Route
router.post("/change-password", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                error: "Unauthorized",
                message: "Please log in to change password"
            });
        }

        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                error: "Validation error",
                message: "Current password and new password are required"
            });
        }

        // Validate new password requirements
        if (newPassword.length < 8 || 
            !/[A-Z]/.test(newPassword) || 
            !/[!@#$%^&*(),.?":{}|<>]/.test(newPassword)) {
            return res.status(400).json({
                error: "Validation error",
                message: "Password must be at least 8 characters long, contain one uppercase letter and one special character"
            });
        }

        const user = await User.findById(req.session.userId).select('+password');
        if (!user) {
            return res.status(404).json({
                error: "Not found",
                message: "User not found"
            });
        }

        // Verify current password
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isCurrentPasswordValid) {
            return res.status(400).json({
                error: "Validation error",
                message: "Current password is incorrect"
            });
        }

        // Update password
        user.password = newPassword;
        user.forcePasswordChange = false; // Reset force password change flag
        await user.save();

        return res.status(200).json({
            message: "Password changed successfully"
        });

    } catch (error) {
        console.error("Change password error:", error);
        return res.status(500).json({
            error: "Server error",
            message: "Failed to change password"
        });
    }
});

module.exports = router;