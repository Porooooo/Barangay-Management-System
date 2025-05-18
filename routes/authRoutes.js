const express = require("express");
const bcrypt = require("bcrypt");
const multer = require("multer");
const User = require("../models/User");

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

// User Registration
router.post("/register", upload.single('profilePicture'), async (req, res) => {
    try {
        const { 
            fullName, 
            email, 
            contactNumber, 
            address, 
            birthdate, 
            civilStatus, 
            occupation, 
            educationalAttainment,
            registeredVoter,
            fourPsMember,
            pwdMember,
            seniorCitizen,
            pregnant,
            password 
        } = req.body;
        
        const profilePicture = req.file ? req.file.path : null;

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: "❌ Email already registered" });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user
        const newUser = new User({
            fullName,
            email,
            contactNumber,
            address,
            birthdate,
            civilStatus,
            occupation,
            educationalAttainment,
            registeredVoter: registeredVoter === 'true',
            fourPsMember: fourPsMember === 'true',
            pwdMember: pwdMember === 'true',
            seniorCitizen: seniorCitizen === 'true',
            pregnant: pregnant === 'true',
            password: hashedPassword,
            profilePicture
        });

        // Save user
        await newUser.save();

        res.status(201).json({ message: "✅ User registered successfully" });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ error: "❌ Failed to register user" });
    }
});

// User Login
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ error: "❌ Invalid email or password" });
        }

        // Compare password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: "❌ Invalid email or password" });
        }

        // Set session
        req.session.userId = user._id;
        req.session.userEmail = user.email; // Store the user's email in the session

        res.status(200).json({ message: "✅ Logged in successfully", userId: user._id, email: user.email });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "❌ Failed to login" });
    }
});

// User Profile Route
router.get("/profile", async (req, res) => {
    try {
        // Check if user is logged in
        if (!req.session.userId) {
            return res.status(401).json({ error: "❌ Unauthorized" });
        }

        // Find user by ID
        const user = await User.findById(req.session.userId).select('-password'); // Exclude password
        if (!user) {
            return res.status(404).json({ error: "❌ User not found" });
        }

        res.status(200).json(user);
    } catch (error) {
        console.error("Profile error:", error);
        res.status(500).json({ error: "❌ Failed to fetch profile" });
    }
});

// Update Profile Picture
router.post("/update-profile-picture", upload.single('profilePicture'), async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: "❌ Unauthorized" });
        }

        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: "❌ User not found" });
        }

        if (!req.file) {
            return res.status(400).json({ error: "❌ No file uploaded" });
        }

        // Update profile picture
        user.profilePicture = req.file.path;
        await user.save();

        res.status(200).json({ message: "✅ Profile picture updated successfully" });
    } catch (error) {
        console.error("Update profile picture error:", error);
        res.status(500).json({ error: "❌ Failed to update profile picture" });
    }
});

module.exports = router;        