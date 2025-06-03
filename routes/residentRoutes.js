const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const { authMiddleware, adminMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();

// Get all residents (Admin only)
router.get("/", adminMiddleware, async (req, res) => {
  try {
    const { search, status } = req.query;
    let query = {};

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { fullName: searchRegex },
        { email: searchRegex },
        { contactNumber: searchRegex }
      ];
    }

    if (status && ['Active', 'Inactive'].includes(status)) {
      query.status = status;
    }

    const residents = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 });

    res.status(200).json({
      count: residents.length,
      residents
    });
  } catch (error) {
    console.error("Error fetching residents:", error);
    res.status(500).json({ 
      error: "Server error",
      message: "Failed to fetch residents"
    });
  }
});

// Get current resident profile
router.get("/profile", authMiddleware, async (req, res) => {
  try {
    const resident = await User.findById(req.session.userId)
      .select('-password');
    
    if (!resident) {
      return res.status(404).json({ 
        error: "Not found",
        message: "Resident not found"
      });
    }

    res.status(200).json(resident);
  } catch (error) {
    console.error("Error fetching resident profile:", error);
    res.status(500).json({ 
      error: "Server error",
      message: "Failed to fetch resident profile"
    });
  }
});

// Update current resident profile
router.put("/profile", authMiddleware, async (req, res) => {
  try {
    const userId = req.session.userId;
    const updates = req.body;

    if (!updates.fullName || !updates.contactNumber || !updates.address || 
        !updates.birthdate || !updates.civilStatus || !updates.occupation || 
        !updates.educationalAttainment) {
      return res.status(400).json({ 
        error: "Validation error",
        message: "All required fields must be provided" 
      });
    }

    const updatedResident = await User.findByIdAndUpdate(
      userId,
      updates,
      { 
        new: true,
        runValidators: true
      }
    ).select('-password');

    if (!updatedResident) {
      return res.status(404).json({ 
        error: "Not found",
        message: "Resident not found" 
      });
    }

    res.status(200).json({ 
      message: "Profile updated successfully",
      resident: updatedResident
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        error: "Validation error",
        message: error.message 
      });
    }
    res.status(500).json({ 
      error: "Server error",
      message: "Failed to update profile" 
    });
  }
});

// Get single resident by ID (Admin only)
router.get("/:id", adminMiddleware, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ 
        error: "Invalid ID",
        message: "Invalid resident ID format"
      });
    }

    const resident = await User.findById(req.params.id)
      .select('-password');
    
    if (!resident) {
      return res.status(404).json({ 
        error: "Not found",
        message: "Resident not found"
      });
    }

    res.status(200).json(resident);
  } catch (error) {
    console.error("Error fetching resident:", error);
    res.status(500).json({ 
      error: "Server error",
      message: "Failed to fetch resident"
    });
  }
});

// Create new resident (Admin only)
router.post("/", adminMiddleware, async (req, res) => {
  try {
    const { 
      fullName, 
      email, 
      contactNumber, 
      address, 
      birthdate,
      password 
    } = req.body;

    if (!fullName || !email || !contactNumber || !address || !birthdate || !password) {
      return res.status(400).json({ 
        error: "Validation error",
        message: "All required fields must be provided"
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ 
        error: "Duplicate email",
        message: "Email already exists"
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const newResident = new User({
      fullName,
      email,
      contactNumber,
      address,
      birthdate,
      password: hashedPassword,
      ...req.body
    });

    await newResident.save();
    
    res.status(201).json({ 
      message: "Resident created successfully",
      resident: newResident
    });
  } catch (error) {
    console.error("Error creating resident:", error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        error: "Validation error",
        message: error.message
      });
    }
    res.status(500).json({ 
      error: "Server error",
      message: "Failed to create resident"
    });
  }
});

// Update resident profile
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ 
        error: "Invalid ID",
        message: "Invalid resident ID format"
      });
    }

    const resident = await User.findById(req.params.id);
    if (!resident) {
      return res.status(404).json({ 
        error: "Not found",
        message: "Resident not found"
      });
    }
    
    if (!req.session.isAdmin && req.session.userId !== req.params.id) {
      return res.status(403).json({ 
        error: "Forbidden",
        message: "You can only update your own profile"
      });
    }

    const updates = req.body;

    if (updates.password) {
      const salt = await bcrypt.genSalt(10);
      updates.password = await bcrypt.hash(updates.password, salt);
    }

    const updatedResident = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { 
        new: true,
        runValidators: true
      }
    ).select('-password');

    res.status(200).json({ 
      message: "Resident updated successfully",
      resident: updatedResident
    });
  } catch (error) {
    console.error("Error updating resident:", error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        error: "Validation error",
        message: error.message
      });
    }
    res.status(500).json({ 
      error: "Server error",
      message: "Failed to update resident"
    });
  }
});

// Delete resident (Admin only)
router.delete("/:id", adminMiddleware, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ 
        error: "Invalid ID",
        message: "Invalid resident ID format"
      });
    }

    const resident = await User.findByIdAndDelete(req.params.id);
    if (!resident) {
      return res.status(404).json({ 
        error: "Not found",
        message: "Resident not found"
      });
    }

    res.status(200).json({ 
      message: "Resident deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting resident:", error);
    res.status(500).json({ 
      error: "Server error",
      message: "Failed to delete resident"
    });
  }
});

// ✅ Toggle resident status (Admin only)
router.patch("/:id/status", adminMiddleware, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ 
        error: "Invalid ID",
        message: "Invalid resident ID format"
      });
    }

    const resident = await User.findById(req.params.id);
    if (!resident) {
      return res.status(404).json({ 
        error: "Not found",
        message: "Resident not found"
      });
    }

    resident.status = resident.status === 'Active' ? 'Inactive' : 'Active';
    await resident.save();

    res.status(200).json({ 
      message: `Resident status updated to ${resident.status}`,
      status: resident.status
    });
  } catch (error) {
    console.error("Error toggling resident status:", error);
    res.status(500).json({ 
      error: "Server error",
      message: "Failed to toggle resident status"
    });
  }
});

module.exports = router;
