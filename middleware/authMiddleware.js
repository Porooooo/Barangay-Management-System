// middleware/authMiddleware.js

const authMiddleware = (req, res, next) => {
    if (!req.session.userId) {
      return res.status(401).json({ 
        error: "Unauthorized",
        message: "Please log in to access this resource"
      });
    }
    next();
  };
  
  const adminMiddleware = (req, res, next) => {
    if (!req.session.userId || !req.session.isAdmin) {
      return res.status(403).json({ 
        error: "Forbidden",
        message: "Admin privileges required"
      });
    }
    next();
  };
  
  const residentMiddleware = (req, res, next) => {
    if (!req.session.userId || req.session.isAdmin) {
      return res.status(403).json({ 
        error: "Forbidden",
        message: "Resident access only"
      });
    }
    next();
  };
  
  module.exports = {
    authMiddleware,
    adminMiddleware,
    residentMiddleware
  };