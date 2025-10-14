const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const { authMiddleware, adminMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();

// Helper function for safe ISO date formatting
const formatDateSafe = (date) => {
  if (!date) return null;
  try {
    return new Date(date).toISOString();
  } catch (e) {
    return null;
  }
};

// Format resident object consistently
const formatResidentData = (resident) => {
  return {
    ...resident,
    profilePicture: resident.profilePicture
      ? resident.profilePicture.startsWith('http')
        ? resident.profilePicture
        : `/uploads/${resident.profilePicture}`
      : '/images/default-profile.png',
    createdAt: formatDateSafe(resident.createdAt),
    updatedAt: formatDateSafe(resident.updatedAt),
    birthdate: formatDateSafe(resident.birthdate)
  };
};

// GET all residents (Admin only) with search, filter
router.get("/", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { search, status, role } = req.query;
    let query = { role: "resident" };

    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [
        { fullName: searchRegex },
        { email: searchRegex },
        { contactNumber: searchRegex },
        { address: searchRegex }
      ];
    }

    if (status && ["Active", "Inactive"].includes(status)) {
      query.status = status;
    }

    if (role && ["resident", "admin"].includes(role)) {
      query.role = role;
    }

    const residents = await User.find(query)
      .select("-password -__v")
      .sort({ createdAt: -1 })
      .lean();

    const formattedResidents = residents.map(formatResidentData);

    res.status(200).json({
      success: true,
      count: formattedResidents.length,
      residents: formattedResidents
    });
  } catch (error) {
    console.error("Error fetching residents:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: error.message || "Failed to fetch residents"
    });
  }
});

// GET current authenticated resident's profile
router.get("/profile", authMiddleware, async (req, res) => {
  try {
    const resident = await User.findById(req.session.userId)
      .select("-password -__v -adminSpecificFields")
      .lean();

    if (!resident) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: "User profile not found"
      });
    }

    res.status(200).json({
      success: true,
      data: formatResidentData(resident)
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: error.message || "Failed to fetch profile"
    });
  }
});

// PUT update current authenticated resident's profile
router.put("/profile", authMiddleware, async (req, res) => {
  try {
    const allowedUpdates = [
      'fullName', 'firstName', 'lastName', 'middleName', 'suffix',
      'contactNumber', 'alternateContact', 'address', 'birthdate',
      'gender', 'civilStatus', 'occupation', 'educationalAttainment',
      'registeredVoter', 'fourPsMember', 'pwdMember', 'seniorCitizen', 'soloParent'
    ];

    const updates = Object.keys(req.body)
      .filter(key => allowedUpdates.includes(key))
      .reduce((obj, key) => {
        obj[key] = req.body[key];
        return obj;
      }, {});

    const requiredFields = ['fullName', 'contactNumber', 'address', 'birthdate'];
    for (const field of requiredFields) {
      if (updates[field] === '') {
        return res.status(400).json({
          success: false,
          error: "Validation Error",
          message: `${field} cannot be empty`
        });
      }
    }

    const updatedResident = await User.findByIdAndUpdate(
      req.session.userId,
      updates,
      { new: true, runValidators: true }
    ).select("-password -__v -adminSpecificFields").lean();

    if (!updatedResident) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: "User not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: formatResidentData(updatedResident)
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: error.message
    });
  }
});

// GET resident by ID (Admin only)
router.get("/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID",
        message: "Invalid user ID format"
      });
    }

    const resident = await User.findById(req.params.id)
      .select("-password -__v")
      .lean();

    if (!resident) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: "User not found"
      });
    }

    res.status(200).json({
      success: true,
      data: formatResidentData(resident)
    });
  } catch (error) {
    console.error("Error fetching resident:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: error.message
    });
  }
});

// POST create new resident (Admin only)
router.post("/", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const requiredFields = ['fullName', 'email', 'contactNumber', 'address', 'birthdate', 'password'];
    const missingFields = requiredFields.filter(field => !req.body[field]);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Validation Error",
        message: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    const existingUser = await User.findOne({ email: req.body.email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: "Duplicate Email",
        message: "Email already exists"
      });
    }

    // NEW: Check for duplicate phone number
    const existingPhone = await User.findOne({ contactNumber: req.body.contactNumber });
    if (existingPhone) {
      return res.status(409).json({
        success: false,
        error: "Duplicate Phone Number",
        message: "Phone number already exists"
      });
    }

    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const newResident = new User({
      ...req.body,
      password: hashedPassword,
      role: 'resident'
    });

    await newResident.save();

    res.status(201).json({
      success: true,
      message: "Resident created successfully",
      data: formatResidentData(newResident.toObject())
    });
  } catch (error) {
    console.error("Error creating resident:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: error.message
    });
  }
});

// PUT update resident by ID (Admin only)
router.put("/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID",
        message: "Invalid user ID format"
      });
    }

    const updates = { ...req.body };
    if (updates.role) delete updates.role;

    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 10);
    }

    // NEW: Check for duplicate phone number if updating contact number
    if (updates.contactNumber) {
      const existingPhone = await User.findOne({ 
        contactNumber: updates.contactNumber,
        _id: { $ne: req.params.id }
      });
      if (existingPhone) {
        return res.status(409).json({
          success: false,
          error: "Duplicate Phone Number",
          message: "Phone number already exists"
        });
      }
    }

    const updatedResident = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).select("-password -__v").lean();

    if (!updatedResident) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: "User not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Resident updated successfully",
      data: formatResidentData(updatedResident)
    });
  } catch (error) {
    console.error("Error updating resident:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: error.message
    });
  }
});

// DELETE resident (Admin only)
router.delete("/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID",
        message: "Invalid user ID format"
      });
    }

    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: "User not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Resident deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting resident:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: error.message
    });
  }
});

// PATCH toggle resident status (Admin only)
router.patch("/:id/status", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID",
        message: "Invalid user ID format"
      });
    }

    const resident = await User.findById(req.params.id);
    if (!resident) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: "User not found"
      });
    }

    resident.status = resident.status === "Active" ? "Inactive" : "Active";
    await resident.save();

    res.status(200).json({
      success: true,
      message: `Status updated to ${resident.status}`,
      data: {
        id: resident._id,
        status: resident.status
      }
    });
  } catch (error) {
    console.error("Error toggling status:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: error.message
    });
  }
});

module.exports = router;