// middleware/adminMiddleware.js
const User = require("../models/User");

const adminMiddleware = async (req, res, next) => {
  try {
    // Check if user is authenticated
    if (!req.session.userId) {
      return res.status(401).json({ 
        error: "Unauthorized",
        message: "Please log in to access this resource" 
      });
    }

    // Check if user exists and is admin
    const user = await User.findById(req.session.userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ 
        error: "Forbidden",
        message: "Admin privileges required" 
      });
    }

    // Add admin flag to request for easy checking in routes
    req.isAdmin = true;
    next();
  } catch (error) {
    console.error("Admin middleware error:", error);
    res.status(500).json({ 
      error: "Server Error",
      message: "Failed to verify admin privileges" 
    });
  }
};

module.exports = adminMiddleware;