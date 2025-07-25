const User = require('../models/User');

// Auth check
const authMiddleware = async (req, res, next) => {
  try {
    // Check session-based auth first
    if (req.session && req.session.userId) {
      const user = await User.findById(req.session.userId);
      if (!user) {
        return res.status(401).json({ 
          error: "Unauthorized",
          message: "User not found" 
        });
      }
      req.user = user;
      return next();
    }

    // Check token-based auth if no session
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
        if (!user) {
          return res.status(401).json({ 
            error: "Unauthorized",
            message: "User not found" 
          });
        }
        req.user = user;
        return next();
      } catch (err) {
        return res.status(401).json({ 
          error: "Unauthorized",
          message: "Invalid token" 
        });
      }
    }

    // No auth found
    return res.status(401).json({
      error: "Unauthorized",
      message: "Please log in to access this resource"
    });
  } catch (error) {
    console.error("Auth Middleware Error:", error);
    res.status(500).json({ 
      error: "Internal server error",
      message: "Failed to authenticate user"
    });
  }
};

// Admin check (must be used after authMiddleware)
const adminMiddleware = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ 
        error: "Unauthorized",
        message: "Authentication required" 
      });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        error: "Forbidden",
        message: "Admin privileges required" 
      });
    }

    next();
  } catch (error) {
    console.error("Admin Middleware Error:", error);
    res.status(500).json({ 
      error: "Server Error",
      message: "Failed to verify admin privileges" 
    });
  }
};
  
module.exports = {
  authMiddleware,
  adminMiddleware
};