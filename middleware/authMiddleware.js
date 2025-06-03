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
  if (!req.session.userId || req.session.role !== 'admin') {
    return res.status(403).json({ 
      error: "Forbidden",
      message: "Admin privileges required"
    });
  }
  next();
};

const staffMiddleware = (req, res, next) => {
  if (!req.session.userId || !['admin', 'staff'].includes(req.session.role)) {
    return res.status(403).json({ 
      error: "Forbidden",
      message: "Staff privileges required"
    });
  }
  next();
};

module.exports = {
  authMiddleware,
  adminMiddleware,
  staffMiddleware
};