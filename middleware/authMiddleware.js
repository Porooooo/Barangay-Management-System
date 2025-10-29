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
        
        // Set both req.user and maintain session compatibility
        req.user = user;
        req.session.userId = user._id; // Ensure session has userId
        req.session.userEmail = user.email;
        req.session.role = user.role;
        
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
        
        // Set both req.user and create session for compatibility
        req.user = user;
        if (req.session) {
          req.session.userId = user._id;
          req.session.userEmail = user.email;
          req.session.role = user.role;
        }
        
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
    // Check both req.user and session for admin role
    let userRole = null;
    
    if (req.user) {
      userRole = req.user.role;
    } else if (req.session && req.session.role) {
      userRole = req.session.role;
    }

    if (!userRole) {
      return handleAuthError(req, res, 401, "Authentication required");
    }

    // Check for multiple possible admin role indicators
    const isAdmin = userRole === 'admin' || 
                   userRole === 'administrator' || 
                   (req.user && req.user.isAdmin === true);
    
    if (!isAdmin) {
      return handleAuthError(req, res, 403, "Admin privileges required");
    }

    next();
  } catch (error) {
    console.error("Admin Middleware Error:", error);
    return handleAuthError(req, res, 500, "Failed to verify admin privileges");
  }
};

// Session-based middleware for routes that expect session data
const sessionAuthMiddleware = async (req, res, next) => {
  try {
    if (!req.session || !req.session.userId) {
      return handleAuthError(req, res, 401, "Please log in to access this resource");
    }

    const user = await User.findById(req.session.userId);
    if (!user) {
      // Clear invalid session
      req.session.destroy();
      return handleAuthError(req, res, 401, "User not found");
    }

    // Update session with current user data
    req.user = user;
    req.session.userEmail = user.email;
    req.session.role = user.role;

    next();
  } catch (error) {
    console.error("Session Auth Middleware Error:", error);
    return handleAuthError(req, res, 500, "Failed to authenticate user");
  }
};

// Helper function to handle authentication errors consistently
const handleAuthError = (req, res, statusCode, message) => {
  // For API routes, return JSON response
  if (req.originalUrl.startsWith('/api')) {
    return res.status(statusCode).json({ 
      success: false,
      error: statusCode === 401 ? "Unauthorized" : 
             statusCode === 403 ? "Forbidden" : "Server Error",
      message 
    });
  } else {
    // For web routes, redirect to login
    if (statusCode === 401 || statusCode === 403) {
      // Store the original URL for redirect after login
      if (req.session) {
        req.session.returnTo = req.originalUrl;
      }
      return res.redirect('/login');
    } else {
      // For server errors, redirect to error page or show error
      return res.status(statusCode).send(message);
    }
  }
};

module.exports = {
  authMiddleware,
  adminMiddleware,
  sessionAuthMiddleware
};