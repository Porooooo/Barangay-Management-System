const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Enhanced Auth check middleware
const authMiddleware = async (req, res, next) => {
  try {
    // Check session-based auth first (with multiple possible session formats)
    if (req.session) {
      // Check for various possible session user identifiers
      const sessionUserId = req.session.userId || 
                           (req.session.user && req.session.user._id) || 
                           (req.session.user && req.session.user.id);
      
      if (sessionUserId) {
        const user = await User.findById(sessionUserId);
        if (!user) {
          return handleAuthError(req, res, 401, "User not found");
        }
        req.user = user;
        return next();
      }
    }

    // Check token-based auth if no session
    const token = req.headers.authorization?.split(' ')[1] || 
                  req.query.token || 
                  req.cookies?.token;
    
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
        if (!user) {
          return handleAuthError(req, res, 401, "User not found");
        }
        req.user = user;
        return next();
      } catch (err) {
        return handleAuthError(req, res, 401, "Invalid token");
      }
    }

    // No authentication found
    return handleAuthError(req, res, 401, "Please log in to access this resource");
  } catch (error) {
    console.error("Auth Middleware Error:", error);
    return handleAuthError(req, res, 500, "Failed to authenticate user");
  }
};

// Admin check middleware (must be used after authMiddleware)
const adminMiddleware = async (req, res, next) => {
  try {
    if (!req.user) {
      return handleAuthError(req, res, 401, "Authentication required");
    }

    // Check for multiple possible admin role indicators
    const isAdmin = req.user.role === 'admin' || 
                   req.user.role === 'administrator' || 
                   req.user.isAdmin === true;
    
    if (!isAdmin) {
      return handleAuthError(req, res, 403, "Admin privileges required");
    }

    next();
  } catch (error) {
    console.error("Admin Middleware Error:", error);
    return handleAuthError(req, res, 500, "Failed to verify admin privileges");
  }
};

// Helper function to handle authentication errors consistently
const handleAuthError = (req, res, statusCode, message) => {
  if (req.originalUrl.startsWith('/api')) {
    return res.status(statusCode).json({ 
      error: statusCode === 401 ? "Unauthorized" : 
             statusCode === 403 ? "Forbidden" : "Server Error",
      message 
    });
  } else {
    if (statusCode === 401 || statusCode === 403) {
      // Store the original URL for redirect after login
      req.session.returnTo = req.originalUrl;
      return res.redirect('/login.html');
    } else {
      // For server errors, redirect to error page or show error
      return res.status(statusCode).send(message);
    }
  }
};

module.exports = {
  authMiddleware,
  adminMiddleware
};