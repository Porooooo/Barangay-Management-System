const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  subject: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  type: {
    type: String,
    enum: ['general', 'complaint', 'suggestion'],
    default: 'general'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['unread', 'read', 'responded', 'archived'],
    default: 'unread'
  },
  adminResponse: {
    type: String,
    trim: true,
    maxlength: 2000
  },
  respondedAt: {
    type: Date
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  tags: [{
    type: String,
    trim: true
  }]
}, {
  timestamps: true
});

// Index for efficient queries
messageSchema.index({ userId: 1, createdAt: -1 });
messageSchema.index({ status: 1 });
messageSchema.index({ type: 1 });
messageSchema.index({ priority: 1 });
messageSchema.index({ createdAt: -1 });

// Virtual for formatted dates
messageSchema.virtual('formattedDate').get(function() {
  return this.createdAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
});

messageSchema.virtual('formattedTime').get(function() {
  return this.createdAt.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });
});

// Method to check if message is recent (within 24 hours)
messageSchema.methods.isRecent = function() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return this.createdAt > twentyFourHoursAgo;
};

// Static method to get messages by status
messageSchema.statics.getByStatus = function(status) {
  return this.find({ status }).populate('userId', 'fullName email');
};

// Static method to get messages by type
messageSchema.statics.getByType = function(type) {
  return this.find({ type }).populate('userId', 'fullName email');
};

// Method to get priority based on type
messageSchema.methods.getPriority = function() {
  switch(this.type) {
    case 'complaint':
      return 'high';
    case 'suggestion':
      return 'medium';
    default:
      return 'low';
  }
};

// Pre-save middleware to set priority based on type
messageSchema.pre('save', function(next) {
  if (this.isModified('type')) {
    this.priority = this.getPriority();
  }
  next();
});

// Ensure virtual fields are serialized
messageSchema.set('toJSON', { virtuals: true });

const Message = mongoose.model("Message", messageSchema);

module.exports = Message;