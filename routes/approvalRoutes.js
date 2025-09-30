const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const { authMiddleware, adminMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();

// GET users by status (pending, approved, rejected)
router.get("/:status", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.params;
    const { search } = req.query;

    // Validate status parameter
    const validStatuses = ['pending', 'approved', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid Status",
        message: "Status must be one of: pending, approved, rejected"
      });
    }

    let query = { 
      approvalStatus: status,
      role: 'resident'
    };

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { fullName: searchRegex },
        { email: searchRegex },
        { contactNumber: searchRegex }
      ];
    }

    const users = await User.find(query)
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .sort({ createdAt: -1 })
      .lean();

    const formattedUsers = users.map(user => ({
      ...user,
      profilePicture: user.profilePicture
        ? user.profilePicture.startsWith('http')
          ? user.profilePicture
          : `/uploads/${user.profilePicture}`
        : '/images/default-profile.png',
      createdAt: user.createdAt ? user.createdAt.toISOString() : null,
      updatedAt: user.updatedAt ? user.updatedAt.toISOString() : null,
      birthdate: user.birthdate ? user.birthdate.toISOString() : null
    }));

    res.status(200).json({
      success: true,
      count: formattedUsers.length,
      users: formattedUsers
    });
  } catch (error) {
    console.error("Error fetching users by status:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: error.message || "Failed to fetch users"
    });
  }
});

// GET user details for approval
router.get("/user/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID",
        message: "Invalid user ID format"
      });
    }

    const user = await User.findById(req.params.id)
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: "User not found"
      });
    }

    const formattedUser = {
      ...user,
      profilePicture: user.profilePicture
        ? user.profilePicture.startsWith('http')
          ? user.profilePicture
          : `/uploads/${user.profilePicture}`
        : '/images/default-profile.png',
      createdAt: user.createdAt ? user.createdAt.toISOString() : null,
      updatedAt: user.updatedAt ? user.updatedAt.toISOString() : null,
      birthdate: user.birthdate ? user.birthdate.toISOString() : null
    };

    res.status(200).json({
      success: true,
      data: formattedUser
    });
  } catch (error) {
    console.error("Error fetching user details:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: error.message || "Failed to fetch user details"
    });
  }
});

// POST approve user
router.post("/:id/approve", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID",
        message: "Invalid user ID format"
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: "User not found"
      });
    }

    if (user.approvalStatus !== 'pending') {
      return res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "User is not pending approval"
      });
    }

    user.approvalStatus = 'approved';
    user.approvedAt = new Date();
    user.approvedBy = req.session.userId;
    user.rejectionReason = null;
    user.rejectedAt = null;

    await user.save();

    // TODO: Send approval notification email here

    res.status(200).json({
      success: true,
      message: "User approved successfully",
      data: {
        id: user._id,
        approvalStatus: user.approvalStatus,
        approvedAt: user.approvedAt
      }
    });
  } catch (error) {
    console.error("Error approving user:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: error.message || "Failed to approve user"
    });
  }
});

// POST reject user
router.post("/:id/reject", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID",
        message: "Invalid user ID format"
      });
    }

    if (!reason || reason.trim() === '') {
      return res.status(400).json({
        success: false,
        error: "Validation Error",
        message: "Rejection reason is required"
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: "User not found"
      });
    }

    if (user.approvalStatus !== 'pending') {
      return res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "User is not pending approval"
      });
    }

    user.approvalStatus = 'rejected';
    user.rejectionReason = reason.trim();
    user.rejectedAt = new Date();
    user.approvedAt = null;
    user.approvedBy = null;

    await user.save();

    // TODO: Send rejection notification email here

    res.status(200).json({
      success: true,
      message: "User rejected successfully",
      data: {
        id: user._id,
        approvalStatus: user.approvalStatus,
        rejectedAt: user.rejectedAt,
        rejectionReason: user.rejectionReason
      }
    });
  } catch (error) {
    console.error("Error rejecting user:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: error.message || "Failed to reject user"
    });
  }
});

// GET approved users count for dashboard
router.get("/stats/counts", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const pendingCount = await User.countDocuments({ 
      approvalStatus: 'pending',
      role: 'resident'
    });
    
    const approvedCount = await User.countDocuments({ 
      approvalStatus: 'approved',
      role: 'resident'
    });
    
    const rejectedCount = await User.countDocuments({ 
      approvalStatus: 'rejected',
      role: 'resident'
    });

    res.status(200).json({
      success: true,
      data: {
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
        total: pendingCount + approvedCount + rejectedCount
      }
    });
  } catch (error) {
    console.error("Error fetching approval stats:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: error.message || "Failed to fetch approval statistics"
    });
  }
});

module.exports = router;