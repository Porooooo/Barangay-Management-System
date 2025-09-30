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

// Multer configuration for multiple file uploads
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
    } else if (file.fieldname === "idPhoto") {
      prefix = "id-";
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
    fileSize: 5 * 1024 * 1024,
    files: 2 // Allow up to 2 files (profile picture and ID photo)
  }
});

// Login route with enhanced security features
router.post("/login", async (req, res) => {
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

// Register User - UPDATED TO PROPERLY HANDLE ALL FIELDS
router.post("/register", upload.fields([
  { name: "profilePicture", maxCount: 1 },
  { name: "idPhoto", maxCount: 1 }
]), async (req, res) => {
  try {
    const formData = req.body;
    const files = req.files;

    const profilePictureFile = files?.profilePicture?.[0];
    const idPhotoFile = files?.idPhoto?.[0];

    console.log("Received registration data:", formData); // Debug log

    // Validate required fields including ID verification
    const requiredFields = [
      'lastName', 'firstName', 'birthdate', 'gender',
      'email', 'contactNumber', 'houseNumber', 'street',
      'barangay', 'password', 'confirmPassword',
      'idType', 'idNumber' // ID verification fields
    ];
    
    const missingFields = requiredFields.filter(field => !formData[field]);
    if (missingFields.length > 0) {
      if (profilePictureFile) fs.unlinkSync(profilePictureFile.path);
      if (idPhotoFile) fs.unlinkSync(idPhotoFile.path);
      return res.status(400).json({
        error: "Validation error",
        message: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      if (profilePictureFile) fs.unlinkSync(profilePictureFile.path);
      if (idPhotoFile) fs.unlinkSync(idPhotoFile.path);
      return res.status(400).json({
        error: "Validation error",
        message: "Invalid email format"
      });
    }

    // Validate password match
    if (formData.password !== formData.confirmPassword) {
      if (profilePictureFile) fs.unlinkSync(profilePictureFile.path);
      if (idPhotoFile) fs.unlinkSync(idPhotoFile.path);
      return res.status(400).json({
        error: "Validation error",
        message: "Passwords do not match"
      });
    }

    // Check for existing user
    const existingUser = await User.findOne({ email: formData.email });
    if (existingUser) {
      if (profilePictureFile) fs.unlinkSync(profilePictureFile.path);
      if (idPhotoFile) fs.unlinkSync(idPhotoFile.path);
      return res.status(400).json({
        error: "Duplicate email",
        message: "Email already registered"
      });
    }

    // Create address string
    const address = `${formData.houseNumber} ${formData.street}, ${formData.barangay}`;

    // Process checkbox values properly
    const registeredVoter = formData.registeredVoter === 'true' || formData.registeredVoter === true;
    const fourPsMember = formData.fourPsMember === 'true' || formData.fourPsMember === true;
    const pwdMember = formData.pwdMember === 'true' || formData.pwdMember === true;
    const seniorCitizen = formData.seniorCitizen === 'true' || formData.seniorCitizen === true;
    const soloParent = formData.soloParent === 'true' || formData.soloParent === true;

    // Create new user with ALL fields - FIXED fullName generation
const newUser = new User({
  // Personal Information
  firstName: formData.firstName,
  lastName: formData.lastName,
  middleName: formData.middleName || null,
  suffix: formData.suffix || null,
  // EXPLICITLY SET fullName to ensure it's not undefined
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
  
  // Address Information
  address: address,
  houseNumber: formData.houseNumber,
  street: formData.street,
  barangay: formData.barangay,
  homeowner: formData.homeownerStatus || null,
  yearsResiding: formData.yearsResiding || null,
  monthlyIncome: formData.monthlyIncome || null,
  
  // Additional Information
  educationalAttainment: formData.educationalAttainment || null,
  
  // Government Programs
  registeredVoter: registeredVoter,
  fourPsMember: fourPsMember,
  pwdMember: pwdMember,
  seniorCitizen: seniorCitizen,
  soloParent: soloParent,
  
  // Account Information
  password: formData.password,
  role: "resident",
  approvalStatus: "pending",
  
  // ID Verification
  idVerification: {
    idType: formData.idType,
    idNumber: formData.idNumber,
    idPhoto: idPhotoFile ? idPhotoFile.filename : null,
    submittedAt: new Date()
  }
});

console.log("Generated fullName:", newUser.fullName); // Debug log

    // Let the pre-save hook generate the fullName
    await newUser.save();

    console.log("User created successfully:", {
      id: newUser._id,
      email: newUser.email,
      fullName: newUser.fullName,
      approvalStatus: newUser.approvalStatus
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
        if (idPhotoFile) fs.unlinkSync(idPhotoFile.path);
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
    // Clean up uploaded files on error
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
        message: "Files must be less than 5MB" 
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
      message: "User banned successfully",
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
      message: "User unbanned successfully",
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

module.exports = router;