const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  date: { 
    type: Date, 
    default: Date.now 
  },
  method: {
    type: String,
    enum: ['home_visit', 'sms', 'facebook', 'messenger', 'email', 'other']
  },
  notes: String,
  officer: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  successful: Boolean
});

const meetingSchema = new mongoose.Schema({
  meetingNumber: {
    type: Number,
    required: true,
    min: 1,
    max: 3
  },
  date: {
    type: Date,
    default: Date.now
  },
  location: String,
  attendees: [{
    name: String,
    role: String // 'complainant', 'accused', 'witness', 'officer'
  }],
  discussion: String,
  agreements: [String],
  nextSteps: String,
  officer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  status: {
    type: String,
    enum: ['scheduled', 'completed', 'cancelled'],
    default: 'completed'
  }
});

const blotterSchema = new mongoose.Schema({
  complainant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  incidentDate: {
    type: Date,
    required: true
  },
  dateReported: {
    type: Date,
    default: Date.now
  },
  location: {
    type: String,
    required: true
  },
  complaintType: {
    type: String,
    required: true
  },
  complaintDetails: {
    type: String,
    required: true
  },
  accused: {
    name: {
      type: String,
      required: true
    },
    address: {
      type: String,
      required: true
    },
    contact: {
      type: String
    },
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  status: {
    type: String,
    enum: ['Pending', 'Under Investigation', 'Resolved', 'Dismissed', 'Escalated to PNP', 'CFA Issued'],
    default: 'Pending'
  },
  resolutionDetails: {
    type: String,
    default: ''
  },
  // REPLACED: callHistory with contactHistory
  contactHistory: [contactSchema],
  
  // NEW: Meeting tracking
  meetings: [meetingSchema],
  currentMeeting: {
    type: Number,
    default: 0,
    min: 0,
    max: 3
  },
  
  resolvedDate: { 
    type: Date
  },
  isBanned: {
    type: Boolean,
    default: false
  },
  hearingDate: {
    type: Date
  },
  assignedOfficer: {
    type: String
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  lastReminderSent: {
    type: Date
  },
  documentHistory: [{
    type: {
      type: String,
      enum: ['summons', 'cfa', 'mediation_notice', 'settlement', 'meeting_minutes']
    },
    generatedAt: {
      type: Date,
      default: Date.now
    },
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    documentUrl: String,
    downloaded: {
      type: Boolean,
      default: false
    },
    meetingNumber: Number // For meeting minutes
  }],
  // CFA tracking
  cfaIssued: {
    type: Boolean,
    default: false
  },
  cfaIssueDate: {
    type: Date
  },
  cfaReason: String
}, {
  timestamps: true
});

// Virtual for complainant name
blotterSchema.virtual('complainantName').get(function() {
  return this.complainant ? this.complainant.fullName : 'Anonymous';
});

// Virtual for case age in days
blotterSchema.virtual('caseAgeInDays').get(function() {
  const now = new Date();
  const reported = new Date(this.dateReported);
  const diffTime = Math.abs(now - reported);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Method to check if case is overdue
blotterSchema.methods.isOverdue = function() {
  return this.caseAgeInDays > 7 && ['Pending', 'Under Investigation'].includes(this.status);
};

// Method to check if ready for next meeting
blotterSchema.methods.canScheduleNextMeeting = function() {
  return this.currentMeeting < 3 && this.status === 'Under Investigation';
};

// Method to check if ready for CFA
blotterSchema.methods.isReadyForCFA = function() {
  return this.currentMeeting >= 3 && this.status === 'Under Investigation' && !this.cfaIssued;
};

blotterSchema.set('toJSON', { virtuals: true });
blotterSchema.set('toObject', { virtuals: true });

const Blotter = mongoose.model('Blotter', blotterSchema);

module.exports = Blotter;