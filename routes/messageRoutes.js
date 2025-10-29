const express = require("express");
const mongoose = require("mongoose");
const { sessionAuthMiddleware } = require("../middleware/authMiddleware");
const Message = require("../models/Message");
const User = require("../models/User");

const router = express.Router();

// Apply sessionAuthMiddleware to all message routes (for session compatibility)
router.use(sessionAuthMiddleware);

// Send message to barangay
router.post("/send", async (req, res) => {
  try {
    const { subject, content, type = 'general' } = req.body;
    const userId = req.session.userId;

    if (!subject || !content) {
      return res.status(400).json({
        success: false,
        error: "Validation Error",
        message: "Subject and content are required"
      });
    }

    // Validate message type
    const validTypes = ['general', 'complaint', 'suggestion'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: "Validation Error",
        message: "Invalid message type. Must be one of: general, complaint, suggestion"
      });
    }

    // Create new message
    const newMessage = new Message({
      userId,
      subject,
      content,
      type,
      status: 'unread'
    });

    await newMessage.save();

    // Populate user details for response
    await newMessage.populate('userId', 'fullName email');

    // Emit socket event for new message
    const io = req.app.get('socketio');
    if (io) {
      io.emit('newMessage', {
        message: newMessage,
        userId: userId
      });
    }

    res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: newMessage
    });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: "Failed to send message"
    });
  }
});

// Get user's sent messages
router.get("/my-messages", async (req, res) => {
  try {
    const userId = req.session.userId;
    const { page = 1, limit = 10 } = req.query;

    const messages = await Message.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('userId', 'fullName email');

    const total = await Message.countDocuments({ userId });

    res.status(200).json({
      success: true,
      data: messages,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: "Failed to fetch messages"
    });
  }
});

// Get message by ID
router.get("/:id", async (req, res) => {
  try {
    const message = await Message.findById(req.params.id)
      .populate('userId', 'fullName email');

    if (!message) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: "Message not found"
      });
    }

    // Check if user owns the message or is admin
    if (message.userId._id.toString() !== req.session.userId && req.session.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "Access denied"
      });
    }

    res.status(200).json({
      success: true,
      data: message
    });
  } catch (error) {
    console.error("Error fetching message:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: "Failed to fetch message"
    });
  }
});

// Admin routes for managing messages
router.get("/admin/messages", async (req, res) => {
  try {
    if (req.session.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "Admin access required"
      });
    }

    const { page = 1, limit = 10, status, type } = req.query;
    let query = {};

    if (status) {
      query.status = status;
    }

    if (type) {
      query.type = type;
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('userId', 'fullName email contactNumber');

    const total = await Message.countDocuments(query);

    res.status(200).json({
      success: true,
      data: messages,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error("Error fetching admin messages:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: "Failed to fetch messages"
    });
  }
});

// Update message status (admin only) - with real-time response
router.patch("/admin/messages/:id/status", async (req, res) => {
  try {
    if (req.session.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "Admin access required"
      });
    }

    const { status, adminResponse } = req.body;

    const message = await Message.findById(req.params.id)
      .populate('userId', 'fullName email');

    if (!message) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: "Message not found"
      });
    }

    // Update message
    message.status = status;
    if (adminResponse) {
      message.adminResponse = adminResponse;
      message.respondedAt = new Date();
    }

    await message.save();

    // Emit socket event for message response
    const io = req.app.get('socketio');
    if (io) {
      io.emit('messageResponse', {
        messageId: message._id,
        userId: message.userId._id,
        adminResponse: message.adminResponse,
        respondedAt: message.respondedAt
      });
    }

    res.status(200).json({
      success: true,
      message: "Message status updated successfully",
      data: message
    });
  } catch (error) {
    console.error("Error updating message status:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: "Failed to update message status"
    });
  }
});

// Get message statistics for admin dashboard
router.get("/admin/statistics", async (req, res) => {
  try {
    if (req.session.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "Admin access required"
      });
    }

    const totalMessages = await Message.countDocuments();
    const unreadMessages = await Message.countDocuments({ status: 'unread' });
    const readMessages = await Message.countDocuments({ status: 'read' });
    const respondedMessages = await Message.countDocuments({ status: 'responded' });

    // Messages by type
    const generalMessages = await Message.countDocuments({ type: 'general' });
    const complaintMessages = await Message.countDocuments({ type: 'complaint' });
    const suggestionMessages = await Message.countDocuments({ type: 'suggestion' });

    // Recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentMessages = await Message.countDocuments({
      createdAt: { $gte: sevenDaysAgo }
    });

    // Messages by day for the last 7 days
    const dailyMessages = await Message.aggregate([
      {
        $match: {
          createdAt: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt"
            }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        total: totalMessages,
        unread: unreadMessages,
        read: readMessages,
        responded: respondedMessages,
        byType: {
          general: generalMessages,
          complaint: complaintMessages,
          suggestion: suggestionMessages
        },
        recent: recentMessages,
        daily: dailyMessages
      }
    });
  } catch (error) {
    console.error("Error fetching message statistics:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: "Failed to fetch message statistics"
    });
  }
});

// Delete message (admin only)
router.delete("/admin/messages/:id", async (req, res) => {
  try {
    if (req.session.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "Admin access required"
      });
    }

    const message = await Message.findByIdAndDelete(req.params.id);

    if (!message) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: "Message not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Message deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting message:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: "Failed to delete message"
    });
  }
});

// Mark message as read (admin only)
router.patch("/admin/messages/:id/read", async (req, res) => {
  try {
    if (req.session.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "Admin access required"
      });
    }

    const message = await Message.findByIdAndUpdate(
      req.params.id,
      { status: 'read' },
      { new: true }
    ).populate('userId', 'fullName email');

    if (!message) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: "Message not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Message marked as read",
      data: message
    });
  } catch (error) {
    console.error("Error marking message as read:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: "Failed to mark message as read"
    });
  }
});

// Get unread message count for admin
router.get("/admin/unread-count", async (req, res) => {
  try {
    if (req.session.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "Admin access required"
      });
    }

    const unreadCount = await Message.countDocuments({ status: 'unread' });

    res.status(200).json({
      success: true,
      data: {
        unreadCount
      }
    });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    res.status(500).json({
      success: false,
      error: "Server Error",
      message: "Failed to fetch unread count"
    });
  }
});

module.exports = router;