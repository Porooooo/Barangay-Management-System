const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const cloudinary = require('cloudinary').v2;
const { promisify } = require('util');
const stream = require('stream');
const pipeline = promisify(stream.pipeline);
const User = require("../models/User");

const router = express.Router();

// Set timezone to UTC for consistent time handling
process.env.TZ = 'UTC';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

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

// Multer configuration for temporary file storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"), false);
    }
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

// View Profile - Updated with Cloudinary profile picture handling
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

    const responseData = {
      ...userObj,
      profilePictureUrl: user.profilePicture || "https://res.cloudinary.com/dp5m6wkpc/image/upload/v1621234567/default-profile.png"
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

// Register User with Cloudinary
router.post("/register", upload.single("profilePicture"), async (req, res) => {
  try {
    const formData = req.body;
    const file = req.file;

    // Validate required fields
    const requiredFields = [
      'lastName', 'firstName', 'birthdate', 'gender',
      'email', 'contactNumber', 'houseNumber', 'street',
      'barangay', 'password', 'confirmPassword'
    ];
    
    const missingFields = requiredFields.filter(field => !formData[field]);
    if (missingFields.length > 0) {
      return res.status(400).json({
        error: "Validation error",
        message: `Missing required fields: ${missingFields.join(', ')}`
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

    // Validate password match
    if (formData.password !== formData.confirmPassword) {
      return res.status(400).json({
        error: "Validation error",
        message: "Passwords do not match"
      });
    }

    // Check for existing user
    const existingUser = await User.findOne({ email: formData.email });
    if (existingUser) {
      return res.status(400).json({
        error: "Duplicate email",
        message: "Email already registered"
      });
    }

    // Upload to Cloudinary if file exists
    let profilePictureUrl = "https://res.cloudinary.com/dp5m6wkpc/image/upload/v1621234567/default-profile.png";
    
    if (file) {
      // Create a temporary file path
      const tempFilePath = path.join(__dirname, '..', 'temp', file.originalname);
      
      // Ensure temp directory exists
      if (!fs.existsSync(path.dirname(tempFilePath))) {
        fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
      }

      // Write buffer to temp file
      await pipeline(
        file.buffer,
        fs.createWriteStream(tempFilePath)
      );

      // Upload to Cloudinary
      const result = await cloudinary.uploader.upload(tempFilePath, {
        folder: 'profile-pictures',
        use_filename: true,
        unique_filename: false,
        resource_type: 'auto'
      });

      // Delete temp file
      fs.unlinkSync(tempFilePath);

      profilePictureUrl = result.secure_url;
    }

    // Create address string
    const address = `${formData.houseNumber} ${formData.street}, ${formData.barangay}`;

    // Create new user
    const newUser = new User({
      fullName: `${formData.firstName} ${formData.lastName}`,
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email,
      contactNumber: formData.contactNumber,
      address: address,
      birthdate: new Date(formData.birthdate),
      gender: formData.gender,
      password: formData.password,
      profilePicture: profilePictureUrl,
      role: "resident"
    });

    await newUser.save();

    // Set session data
    req.session.userId = newUser._id;
    req.session.userEmail = newUser.email;
    req.session.role = newUser.role;

    // Save the session explicitly
    req.session.save(err => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).json({
          error: "Session error",
          message: "Failed to save session"
        });
      }

      return res.status(201).json({
        message: "User registered successfully",
        user: {
          id: newUser._id,
          email: newUser.email,
          fullName: newUser.fullName,
          profilePictureUrl: profilePictureUrl,
          role: newUser.role
        }
      });
    });
  } catch (error) {
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
        message: "Profile picture must be less than 10MB" 
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

// User Login
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
    const user = await User.findOne({ email }).select("+password");
    
    if (!user) {
      console.log(`User not found for email: ${email}`);
      return res.status(401).json({
        error: "Authentication error",
        message: "Invalid credentials"
      });
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
      return res.status(401).json({
        error: "Authentication error",
        message: "Invalid email or password"
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
          profilePictureUrl: user.profilePicture,
          role: user.role
        }
      });
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      error: "Server error",
      message: "Failed to login"
    });
  }
});

// Update Profile Picture with Cloudinary
router.post("/update-profile-picture", upload.single("profilePicture"), async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Please log in to update profile picture"
      });
    }

    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({
        error: "Not found",
        message: "User not found"
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Validation error",
        message: "Profile picture is required"
      });
    }

    // Create a temporary file path
    const tempFilePath = path.join(__dirname, '..', 'temp', req.file.originalname);
    
    // Ensure temp directory exists
    if (!fs.existsSync(path.dirname(tempFilePath))) {
      fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
    }

    // Write buffer to temp file
    await pipeline(
      req.file.buffer,
      fs.createWriteStream(tempFilePath)
    );

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(tempFilePath, {
      folder: 'profile-pictures',
      use_filename: true,
      unique_filename: false
    });

    // Delete temp file
    fs.unlinkSync(tempFilePath);

    // Update user's profile picture
    user.profilePicture = result.secure_url;
    await user.save();

    return res.status(200).json({
      message: "Profile picture updated successfully",
      profilePictureUrl: result.secure_url
    });
  } catch (error) {
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

//check-session route
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
        profilePictureUrl: user.profilePicture
      }
    });
  } catch (error) {
    console.error("Error checking session:", error);
    res.json({ isAuthenticated: false });
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
        profilePictureUrl: user.profilePicture
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