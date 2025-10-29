const express = require("express");
const Request = require("../models/Request");
const User = require("../models/User");
const { format, isValid, addDays, isAfter, isBefore, startOfDay, endOfDay, isWeekend } = require('date-fns');

const router = express.Router();

// Middleware to verify session
const verifySession = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ 
            error: "Unauthorized", 
            message: "Please log in to access this resource" 
        });
    }
    next();
};

// Middleware to verify user is not banned
const checkNotBanned = async (req, res, next) => {
    try {
        const user = await User.findById(req.session.userId);
        if (user?.isBanned) {
            return res.status(403).json({ 
                error: "Forbidden", 
                message: "Your account has been disabled. You cannot submit or manage requests." 
            });
        }
        next();
    } catch (error) {
        console.error("Error checking user ban status:", error);
        res.status(500).json({ 
            error: "Server error", 
            message: "Failed to verify account status" 
        });
    }
};

// NEW: Flood protection middleware
const checkFloodProtection = async (req, res, next) => {
    try {
        const userId = req.session.userId;
        
        // Check if user has submitted too many requests recently
        const recentRequests = await Request.find({
            userId: userId,
            createdAt: {
                $gte: new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
            }
        });
        
        // Allow maximum 3 requests in 5 minutes
        if (recentRequests.length >= 3) {
            return res.status(429).json({
                error: "Too Many Requests",
                message: "You have submitted too many requests recently. Please wait 5 minutes before submitting another request.",
                retryAfter: 300 // 5 minutes in seconds
            });
        }
        
        // Check daily limit (10 requests per day)
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        
        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);
        
        const todayRequests = await Request.find({
            userId: userId,
            createdAt: {
                $gte: startOfToday,
                $lte: endOfToday
            }
        });
        
        if (todayRequests.length >= 10) {
            return res.status(429).json({
                error: "Daily Limit Exceeded",
                message: "You have reached the daily limit of 10 requests. Please try again tomorrow.",
                retryAfter: 86400 // 24 hours in seconds
            });
        }
        
        next();
    } catch (error) {
        console.error("Error checking flood protection:", error);
        // Don't block the request if there's an error checking flood protection
        next();
    }
};

// NEW: Check and update expiration status for individual requests
const checkAndUpdateRequestExpiration = async (requestId) => {
    try {
        const request = await Request.findById(requestId);
        
        if (!request) return false;
        
        // Check if request should be expired
        if (request.shouldBeExpired && !request.isExpired) {
            await Request.findByIdAndUpdate(requestId, {
                status: "Expired",
                isExpired: true,
                expirationDate: new Date(),
                $push: { 
                    automationNotes: `Request automatically expired on ${new Date().toLocaleString()}` 
                },
                updatedAt: new Date()
            });
            return true;
        }
        
        return false;
    } catch (error) {
        console.error("Error checking request expiration:", error);
        return false;
    }
};

// NEW: Manual expiration check for testing
router.post("/check-expirations", verifySession, checkNotBanned, async (req, res) => {
    try {
        const result = await Request.processAutomaticUpdates();
        
        res.status(200).json({
            message: "Expiration check completed",
            ...result
        });
    } catch (error) {
        console.error("Error checking expirations:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to check expirations"
        });
    }
});

// NEW: Automatic expiration and archiving endpoint
router.post("/process-automatic-updates", verifySession, checkNotBanned, async (req, res) => {
    try {
        const result = await Request.processAutomaticUpdates();
        
        res.status(200).json({
            message: "Automatic updates processed successfully",
            ...result
        });
    } catch (error) {
        console.error("Error processing automatic updates:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to process automatic updates"
        });
    }
});

// Helper function to get user profile picture URL
const getUserProfilePicture = (user) => {
    if (!user) return '/images/default-profile.png';
    
    if (user.profilePicture) {
        if (user.profilePicture.startsWith('http') || user.profilePicture.startsWith('/')) {
            return user.profilePicture;
        } else {
            return '/uploads/' + user.profilePicture;
        }
    }
    return '/images/default-profile.png';
};

// CORRECTED: Helper function to format date in Philippine Time (UTC+8)
const formatInPhilippineTime = (date) => {
    if (!isValid(new Date(date))) {
        return {
            formattedDate: 'Invalid Date',
            formattedTime: 'Invalid Time'
        };
    }
    
    const utcDate = new Date(date);
    
    try {
        // Use toLocaleString with Manila timezone
        const formattedDate = utcDate.toLocaleDateString('en-US', {
            timeZone: 'Asia/Manila',
            month: 'short',
            day: '2-digit',
            year: 'numeric'
        });
        
        const formattedTime = utcDate.toLocaleTimeString('en-US', {
            timeZone: 'Asia/Manila',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
        
        return {
            formattedDate,
            formattedTime
        };
    } catch (error) {
        console.error('Error formatting date:', error);
        return {
            formattedDate: 'Invalid Date',
            formattedTime: 'Invalid Time'
        };
    }
};

// NEW: Generate time slots for pickup period
const generateTimeSlots = (startDate, endDate) => {
    const slots = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    const currentDate = new Date(start);
    
    // Office hours: 8:00 AM to 4:00 PM, hourly slots (skip 12:00 PM for lunch)
    const timeSlots = ['08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];
    
    // Generate slots for each day in the period
    while (currentDate <= end) {
        // Skip weekends (0 = Sunday, 6 = Saturday)
        if (currentDate.getDay() !== 0 && currentDate.getDay() !== 6) {
            timeSlots.forEach(time => {
                slots.push({
                    date: new Date(currentDate),
                    time: time,
                    isAvailable: true
                });
            });
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return slots;
};

// NEW: Validate time slot selection
const validateTimeSlot = (request, selectedDate, selectedTime) => {
    try {
        if (!request.adminPickupPeriod.availableTimeSlots || !request.adminPickupPeriod.availableTimeSlots.length) {
            return { valid: false, message: "No available time slots set by admin" };
        }

        const selectedDateTime = new Date(selectedDate);
        const selectedDateStr = selectedDateTime.toISOString().split('T')[0];
        
        // Find the selected time slot
        const selectedSlot = request.adminPickupPeriod.availableTimeSlots.find(slot => {
            const slotDateStr = new Date(slot.date).toISOString().split('T')[0];
            return slotDateStr === selectedDateStr && slot.time === selectedTime && slot.isAvailable;
        });

        if (!selectedSlot) {
            return { valid: false, message: "Selected time slot is not available" };
        }

        // Check if the selected date/time is in the future
        const now = new Date();
        const selectedFullDate = new Date(selectedDate);
        const [hours, minutes] = selectedTime.split(':').map(Number);
        selectedFullDate.setHours(hours, minutes, 0, 0);

        if (selectedFullDate < now) {
            return { valid: false, message: "Cannot schedule pickup for past dates/times" };
        }

        return { valid: true };
    } catch (error) {
        console.error('Time slot validation error:', error);
        return { valid: false, message: "Invalid time slot selection" };
    }
};

// Create a new document request - UPDATED WITH FLOOD PROTECTION
router.post("/", verifySession, checkNotBanned, checkFloodProtection, async (req, res) => {
    try {
        const { fullName, address, documentTypes, purpose } = req.body;

        // Basic validation
        if (!fullName || !address || !documentTypes || !purpose) {
            return res.status(400).json({ 
                error: "Validation error", 
                message: "All fields are required" 
            });
        }

        if (!Array.isArray(documentTypes)) {
            return res.status(400).json({ 
                error: "Validation error", 
                message: "Document types must be an array" 
            });
        }

        if (documentTypes.length === 0) {
            return res.status(400).json({ 
                error: "Validation error", 
                message: "At least one document type must be selected" 
            });
        }

        // Create new request - using current time (will be stored as UTC)
        const newRequest = new Request({
            fullName,
            email: req.session.userEmail,
            address,
            documentTypes,
            purpose,
            status: "Pending",
            processingStage: "Submitted",
            userId: req.session.userId,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        await newRequest.save();

        // Format dates for response using Philippine Time
        const phTime = formatInPhilippineTime(newRequest.createdAt);
        
        const formattedRequest = {
            ...newRequest.toObject(),
            id: newRequest._id.toString(),
            formattedDate: phTime.formattedDate,
            formattedTime: phTime.formattedTime,
            formattedEstimatedCompletion: newRequest.formattedEstimatedCompletion
        };

        // Emit real-time update
        req.app.get('io').emit('request-update', {
            type: 'created',
            request: formattedRequest
        });

        res.status(201).json({
            message: "Request submitted successfully!",
            request: formattedRequest
        });
    } catch (error) {
        console.error("Error submitting request:", error);
        
        // More specific error handling
        if (error.name === 'ValidationError') {
            const errors = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({ 
                error: "Validation error",
                message: errors.join(', ')
            });
        }
        
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to submit request. Please try again later." 
        });
    }
});

// Get all requests (admin view) - WITH PRIORITY SORTING AND EXPIRATION CHECK
router.get("/", verifySession, checkNotBanned, async (req, res) => {
    try {
        const { status, documentType, startDate, endDate, search, archive, priority } = req.query;
        let query = {};

        // Build query based on parameters
        if (archive === 'true') {
            query.status = { $in: ['Archived', 'Expired', 'Claimed'] };
        } else {
            query.status = status || { $in: ['Pending', 'Approved', 'Processing', 'Ready to Claim', 'Scheduled for Pickup'] };
        }

        if (documentType) {
            query.documentTypes = documentType;
        }

        if (startDate && endDate) {
            query.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
            };
        }

        if (search) {
            query.$or = [
                { fullName: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { address: { $regex: search, $options: 'i' } }
            ];
        }

        // Always sort by priority score (high priority first), then by creation date
        let sortOptions = { priorityScore: -1, createdAt: -1 };

        // Fetch requests with user data populated
        const requests = await Request.find(query)
            .populate('userId', 'fullName profilePicture')
            .sort(sortOptions)
            .lean();

        // NEW: Check and update expiration for each request that needs it
        const expirationPromises = requests
            .filter(request => {
                // Check if request should be expired using the same logic as the virtual
                if (request.status !== 'Scheduled for Pickup' && request.status !== 'Ready to Claim') {
                    return false;
                }
                
                const now = new Date();
                
                // For scheduled pickups, check if scheduled date has passed
                if (request.status === 'Scheduled for Pickup' && request.scheduledClaimDate) {
                    const scheduledDateTime = new Date(request.scheduledClaimDate);
                    if (request.scheduledClaimTime) {
                        const [hours, minutes] = request.scheduledClaimTime.split(':').map(Number);
                        scheduledDateTime.setHours(hours, minutes, 0, 0);
                    }
                    return isAfter(now, scheduledDateTime);
                }
                
                // For ready to claim, check if admin pickup period has ended
                if (request.status === 'Ready to Claim' && request.adminPickupPeriod && request.adminPickupPeriod.endDate) {
                    const endOfPickupPeriod = endOfDay(new Date(request.adminPickupPeriod.endDate));
                    return isAfter(now, endOfPickupPeriod);
                }
                
                return false;
            })
            .map(request => checkAndUpdateRequestExpiration(request._id));

        // Wait for all expiration updates to complete
        await Promise.all(expirationPromises);

        // If we updated any requests, refetch them
        let updatedRequests = requests;
        if (expirationPromises.length > 0) {
            updatedRequests = await Request.find(query)
                .populate('userId', 'fullName profilePicture')
                .sort(sortOptions)
                .lean();
        }

        // Format response with Philippine Time
        const formattedRequests = updatedRequests.map(request => {
            const createdPhTime = formatInPhilippineTime(request.createdAt);
            const updatedPhTime = formatInPhilippineTime(request.updatedAt);
            
            // Get user data if populated
            const userProfile = request.userId ? {
                profilePicture: getUserProfilePicture(request.userId),
                fullName: request.userId.fullName || request.fullName || 'Unknown User'
            } : {
                profilePicture: '/images/default-profile.png',
                fullName: request.fullName || 'Unknown User'
            };

            // Format scheduled claim date in Philippine Time if exists
            let formattedScheduledDate = 'Not scheduled';
            let formattedScheduledTime = 'Not scheduled';
            
            if (request.scheduledClaimDate) {
                const scheduledPhTime = formatInPhilippineTime(request.scheduledClaimDate);
                formattedScheduledDate = scheduledPhTime.formattedDate;
                formattedScheduledTime = request.scheduledClaimTime || 'Not scheduled';
            }

            return {
                ...request,
                id: request._id.toString(),
                documentType: Array.isArray(request.documentTypes) 
                    ? request.documentTypes.join(', ') 
                    : request.documentTypes || 'N/A',
                formattedDate: createdPhTime.formattedDate,
                formattedTime: createdPhTime.formattedTime,
                formattedScheduledDate: formattedScheduledDate,
                formattedScheduledTime: formattedScheduledTime,
                formattedAdminPickupPeriod: request.adminPickupPeriod ? 
                    `${new Date(request.adminPickupPeriod.startDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })} to ${new Date(request.adminPickupPeriod.endDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}` 
                    : 'Not set',
                hasAdminPickupPeriod: !!(request.adminPickupPeriod && request.adminPickupPeriod.startDate && request.adminPickupPeriod.endDate),
                availableTimeSlots: request.adminPickupPeriod?.availableTimeSlots || [],
                formattedEstimatedCompletion: request.estimatedCompletionDate ? 
                    new Date(request.estimatedCompletionDate).toLocaleDateString('en-US', {
                        month: 'short',
                        day: '2-digit',
                        year: 'numeric'
                    }) : 'Not set',
                updatedAt: updatedPhTime.formattedDate,
                userProfile: userProfile,
                daysInStatus: request.updatedAt ? 
                    Math.ceil((new Date() - new Date(request.updatedAt)) / (1000 * 60 * 60 * 24)) : 0,
                shouldBeExpired: request.shouldBeExpired // NEW: Include expiration status
            };
        });

        res.status(200).json(formattedRequests);
    } catch (error) {
        console.error("Error fetching requests:", error);
        res.status(500).json({ 
            error: "Server error",
            message: error.message 
        });
    }
});

// Get requests for logged-in user - WITH EXPIRATION CHECK
router.get("/user", verifySession, checkNotBanned, async (req, res) => {
    try {
        const { archive } = req.query;
        let query = { userId: req.session.userId };

        if (archive === 'true') {
            query.status = { $in: ["Scheduled for Pickup", "Archived", "Claimed", "Expired"] };
        } else {
            query.status = { $nin: ["Scheduled for Pickup", "Archived", "Claimed", "Expired"] };
        }

        const requests = await Request.find(query)
            .populate('userId', 'fullName profilePicture')
            .sort({ priorityScore: -1, createdAt: -1 }) // Sort by priority then by date
            .lean();

        // NEW: Check and update expiration for each request that needs it
        const expirationPromises = requests
            .filter(request => {
                // Check if request should be expired using the same logic as the virtual
                if (request.status !== 'Scheduled for Pickup' && request.status !== 'Ready to Claim') {
                    return false;
                }
                
                const now = new Date();
                
                // For scheduled pickups, check if scheduled date has passed
                if (request.status === 'Scheduled for Pickup' && request.scheduledClaimDate) {
                    const scheduledDateTime = new Date(request.scheduledClaimDate);
                    if (request.scheduledClaimTime) {
                        const [hours, minutes] = request.scheduledClaimTime.split(':').map(Number);
                        scheduledDateTime.setHours(hours, minutes, 0, 0);
                    }
                    return isAfter(now, scheduledDateTime);
                }
                
                // For ready to claim, check if admin pickup period has ended
                if (request.status === 'Ready to Claim' && request.adminPickupPeriod && request.adminPickupPeriod.endDate) {
                    const endOfPickupPeriod = endOfDay(new Date(request.adminPickupPeriod.endDate));
                    return isAfter(now, endOfPickupPeriod);
                }
                
                return false;
            })
            .map(request => checkAndUpdateRequestExpiration(request._id));

        // Wait for all expiration updates to complete
        await Promise.all(expirationPromises);

        // If we updated any requests, refetch them
        let updatedRequests = requests;
        if (expirationPromises.length > 0) {
            updatedRequests = await Request.find(query)
                .populate('userId', 'fullName profilePicture')
                .sort({ priorityScore: -1, createdAt: -1 })
                .lean();
        }

        const formattedRequests = updatedRequests.map(request => {
            const createdPhTime = formatInPhilippineTime(request.createdAt);
            
            const userProfile = request.userId ? {
                profilePicture: getUserProfilePicture(request.userId),
                fullName: request.userId.fullName || request.fullName || 'Unknown User'
            } : {
                profilePicture: '/images/default-profile.png',
                fullName: request.fullName || 'Unknown User'
            };

            let formattedScheduledDate = 'Not scheduled';
            let formattedScheduledTime = 'Not scheduled';
            
            if (request.scheduledClaimDate) {
                const scheduledPhTime = formatInPhilippineTime(request.scheduledClaimDate);
                formattedScheduledDate = scheduledPhTime.formattedDate;
                formattedScheduledTime = request.scheduledClaimTime || 'Not scheduled';
            }

            return {
                ...request,
                id: request._id.toString(),
                documentType: Array.isArray(request.documentTypes) 
                    ? request.documentTypes.join(', ') 
                    : request.documentTypes || 'N/A',
                formattedDate: createdPhTime.formattedDate,
                formattedTime: createdPhTime.formattedTime,
                formattedScheduledDate: formattedScheduledDate,
                formattedScheduledTime: formattedScheduledTime,
                formattedAdminPickupPeriod: request.adminPickupPeriod ? 
                    `${new Date(request.adminPickupPeriod.startDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })} to ${new Date(request.adminPickupPeriod.endDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}` 
                    : 'Not set',
                hasAdminPickupPeriod: !!(request.adminPickupPeriod && request.adminPickupPeriod.startDate && request.adminPickupPeriod.endDate),
                availableTimeSlots: request.adminPickupPeriod?.availableTimeSlots || [],
                formattedEstimatedCompletion: request.estimatedCompletionDate ? 
                    new Date(request.estimatedCompletionDate).toLocaleDateString('en-US', {
                        month: 'short',
                        day: '2-digit',
                        year: 'numeric'
                    }) : 'Not set',
                userProfile: userProfile,
                shouldBeExpired: request.shouldBeExpired // NEW: Include expiration status
            };
        });

        res.status(200).json(formattedRequests);
    } catch (error) {
        console.error("Error fetching user requests:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to fetch your requests. Please try again later."
        });
    }
});

// Approve request
router.put("/:id/approve", verifySession, checkNotBanned, async (req, res) => {
    try {
        const request = await Request.findByIdAndUpdate(
            req.params.id,
            {
                status: "Approved",
                processingStage: "Processing",
                updatedAt: new Date()
            },
            { new: true }
        ).populate('userId', 'fullName profilePicture');

        if (!request) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Request not found" 
            });
        }

        // Format response
        const createdPhTime = formatInPhilippineTime(request.createdAt);
        const userProfile = request.userId ? {
            profilePicture: getUserProfilePicture(request.userId),
            fullName: request.userId.fullName || request.fullName || 'Unknown User'
        } : {
            profilePicture: '/images/default-profile.png',
            fullName: request.fullName || 'Unknown User'
        };

        let formattedScheduledDate = 'Not scheduled';
        let formattedScheduledTime = 'Not scheduled';
        
        if (request.scheduledClaimDate) {
            const scheduledPhTime = formatInPhilippineTime(request.scheduledClaimDate);
            formattedScheduledDate = scheduledPhTime.formattedDate;
            formattedScheduledTime = request.scheduledClaimTime || 'Not scheduled';
        }

        const formattedRequest = {
            ...request.toObject(),
            id: request._id.toString(),
            documentType: Array.isArray(request.documentTypes) 
                ? request.documentTypes.join(', ') 
                : request.documentTypes || 'N/A',
            formattedDate: createdPhTime.formattedDate,
            formattedTime: createdPhTime.formattedTime,
            formattedScheduledDate: formattedScheduledDate,
            formattedScheduledTime: formattedScheduledTime,
            formattedAdminPickupPeriod: request.adminPickupPeriod ? 
                `${new Date(request.adminPickupPeriod.startDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })} to ${new Date(request.adminPickupPeriod.endDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}` 
                : 'Not set',
            hasAdminPickupPeriod: !!(request.adminPickupPeriod && request.adminPickupPeriod.startDate && request.adminPickupPeriod.endDate),
            availableTimeSlots: request.adminPickupPeriod?.availableTimeSlots || [],
            formattedEstimatedCompletion: request.formattedEstimatedCompletion,
            userProfile: userProfile
        };

        req.app.get('io').emit('request-update', {
            type: 'updated',
            request: formattedRequest
        });

        res.status(200).json({
            message: "Request approved successfully!",
            request: formattedRequest
        });
    } catch (error) {
        console.error("Error approving request:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to approve request. Please try again later."
        });
    }
});

// NEW: Set pickup period (Admin only) - UPDATED TO GENERATE TIME SLOTS
router.put("/:id/set-pickup-period", verifySession, checkNotBanned, async (req, res) => {
    try {
        const { startDate, endDate, notes } = req.body;

        if (!startDate || !endDate) {
            return res.status(400).json({ 
                error: "Validation error", 
                message: "Start date and end date are required" 
            });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        if (start >= end) {
            return res.status(400).json({ 
                error: "Validation error", 
                message: "End date must be after start date" 
            });
        }

        // Check if end date is within reasonable range (e.g., 2 weeks)
        const maxEndDate = new Date(start);
        maxEndDate.setDate(maxEndDate.getDate() + 14); // Max 2 weeks

        if (end > maxEndDate) {
            return res.status(400).json({ 
                error: "Validation error", 
                message: "Pickup period cannot exceed 2 weeks" 
            });
        }

        // Generate available time slots
        const availableTimeSlots = generateTimeSlots(start, end);

        const request = await Request.findByIdAndUpdate(
            req.params.id,
            {
                status: "Ready to Claim",
                processingStage: "Ready",
                adminPickupPeriod: {
                    startDate: start,
                    endDate: end,
                    notes: notes || '',
                    availableTimeSlots: availableTimeSlots
                },
                updatedAt: new Date()
            },
            { new: true }
        ).populate('userId', 'fullName profilePicture email');

        if (!request) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Request not found" 
            });
        }

        // Format response
        const createdPhTime = formatInPhilippineTime(request.createdAt);
        const userProfile = request.userId ? {
            profilePicture: getUserProfilePicture(request.userId),
            fullName: request.userId.fullName || request.fullName || 'Unknown User'
        } : {
            profilePicture: '/images/default-profile.png',
            fullName: request.fullName || 'Unknown User'
        };

        const formattedRequest = {
            ...request.toObject(),
            id: request._id.toString(),
            documentType: Array.isArray(request.documentTypes) 
                ? request.documentTypes.join(', ') 
                : request.documentTypes || 'N/A',
            formattedDate: createdPhTime.formattedDate,
            formattedTime: createdPhTime.formattedTime,
            formattedAdminPickupPeriod: `${new Date(request.adminPickupPeriod.startDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })} to ${new Date(request.adminPickupPeriod.endDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}`,
            hasAdminPickupPeriod: true,
            availableTimeSlots: request.adminPickupPeriod.availableTimeSlots,
            formattedEstimatedCompletion: request.formattedEstimatedCompletion,
            userProfile: userProfile
        };

        req.app.get('io').emit('request-update', {
            type: 'updated',
            request: formattedRequest
        });

        // Emit notification to resident
        req.app.get('io').emit('request-notification', {
            userId: request.userId._id,
            message: `Your document is ready for pickup! Please choose a time slot between ${formattedRequest.formattedAdminPickupPeriod}`,
            requestId: request._id
        });

        res.status(200).json({
            message: "Pickup period set successfully! Resident will be notified to choose a time slot.",
            request: formattedRequest
        });
    } catch (error) {
        console.error("Error setting pickup period:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to set pickup period. Please try again later."
        });
    }
});

// NEW: Choose time slot (Resident)
router.put("/:id/choose-timeslot", verifySession, checkNotBanned, async (req, res) => {
    try {
        const { selectedDate, selectedTime, pickupNotes } = req.body;
        const request = await Request.findById(req.params.id);

        if (!request) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Request not found",
                success: false
            });
        }

        // FIXED: Proper user ID comparison
        if (request.userId.toString() !== req.session.userId.toString()) {
            return res.status(403).json({
                error: "Forbidden",
                message: "You can only schedule pickup for your own requests",
                success: false
            });
        }

        // Check if admin has set pickup period
        if (!request.hasAdminPickupPeriod) {
            return res.status(400).json({
                error: "Bad Request",
                message: "Admin has not set a pickup period yet. Please wait for notification.",
                success: false
            });
        }

        // Validate time slot selection
        const validation = validateTimeSlot(request, selectedDate, selectedTime);
        if (!validation.valid) {
            return res.status(400).json({
                error: "Validation error",
                message: validation.message,
                success: false
            });
        }

        // Update the request with selected time slot
        const updatedRequest = await Request.findByIdAndUpdate(
            req.params.id,
            {
                status: "Scheduled for Pickup",
                scheduledClaimDate: new Date(selectedDate),
                scheduledClaimTime: selectedTime,
                pickupNotes: pickupNotes || '',
                updatedAt: new Date()
            },
            { new: true }
        ).populate('userId', 'fullName profilePicture');

        // Format dates in Philippine Time
        const createdPhTime = formatInPhilippineTime(updatedRequest.createdAt);
        
        // Get user data if populated
        const userProfile = updatedRequest.userId ? {
            profilePicture: getUserProfilePicture(updatedRequest.userId),
            fullName: updatedRequest.userId.fullName || updatedRequest.fullName || 'Unknown User'
        } : {
            profilePicture: '/images/default-profile.png',
            fullName: updatedRequest.fullName || 'Unknown User'
        };

        // Format scheduled claim date in Philippine Time
        const scheduledPhTime = formatInPhilippineTime(updatedRequest.scheduledClaimDate);

        const formattedRequest = {
            ...updatedRequest.toObject(),
            id: updatedRequest._id.toString(),
            documentType: Array.isArray(updatedRequest.documentTypes) 
                ? updatedRequest.documentTypes.join(', ') 
                : updatedRequest.documentTypes || 'N/A',
            formattedDate: createdPhTime.formattedDate,
            formattedTime: createdPhTime.formattedTime,
            formattedScheduledDate: scheduledPhTime.formattedDate,
            formattedScheduledTime: updatedRequest.scheduledClaimTime || 'Not scheduled',
            formattedAdminPickupPeriod: updatedRequest.adminPickupPeriod ? 
                `${new Date(updatedRequest.adminPickupPeriod.startDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })} to ${new Date(updatedRequest.adminPickupPeriod.endDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}` 
                : 'Not set',
            hasAdminPickupPeriod: !!(updatedRequest.adminPickupPeriod && updatedRequest.adminPickupPeriod.startDate && updatedRequest.adminPickupPeriod.endDate),
            availableTimeSlots: updatedRequest.adminPickupPeriod?.availableTimeSlots || [],
            formattedEstimatedCompletion: updatedRequest.formattedEstimatedCompletion,
            userProfile: userProfile
        };

        req.app.get('io').emit('request-update', {
            type: 'updated',
            request: formattedRequest
        });

        // Notify admin that resident has chosen a time slot
        req.app.get('io').emit('admin-notification', {
            message: `Resident ${userProfile.fullName} has scheduled pickup for ${formattedRequest.formattedScheduledDate} at ${formattedRequest.formattedScheduledTime}`,
            requestId: updatedRequest._id
        });

        res.status(200).json({
            message: `Pickup scheduled successfully for ${formattedRequest.formattedScheduledDate} at ${formattedRequest.formattedScheduledTime}`,
            request: formattedRequest,
            success: true
        });
    } catch (error) {
        console.error("Error choosing time slot:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to schedule pickup. Please try again later.",
            success: false
        });
    }
});

// Reject request with reason
router.put("/:id/reject", verifySession, checkNotBanned, async (req, res) => {
    try {
        const { rejectionReason } = req.body;

        if (!rejectionReason || rejectionReason.trim() === '') {
            return res.status(400).json({ 
                error: "Validation error", 
                message: "Rejection reason is required" 
            });
        }

        const request = await Request.findByIdAndUpdate(
            req.params.id,
            {
                status: "Rejected",
                rejectionReason: rejectionReason.trim(),
                updatedAt: new Date()
            },
            { new: true }
        ).populate('userId', 'fullName profilePicture');

        if (!request) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Request not found" 
            });
        }

        // Format response
        const createdPhTime = formatInPhilippineTime(request.createdAt);
        const userProfile = request.userId ? {
            profilePicture: getUserProfilePicture(request.userId),
            fullName: request.userId.fullName || request.fullName || 'Unknown User'
        } : {
            profilePicture: '/images/default-profile.png',
            fullName: request.fullName || 'Unknown User'
        };

        let formattedScheduledDate = 'Not scheduled';
        let formattedScheduledTime = 'Not scheduled';
        
        if (request.scheduledClaimDate) {
            const scheduledPhTime = formatInPhilippineTime(request.scheduledClaimDate);
            formattedScheduledDate = scheduledPhTime.formattedDate;
            formattedScheduledTime = request.scheduledClaimTime || 'Not scheduled';
        }

        const formattedRequest = {
            ...request.toObject(),
            id: request._id.toString(),
            documentType: Array.isArray(request.documentTypes) 
                ? request.documentTypes.join(', ') 
                : request.documentTypes || 'N/A',
            formattedDate: createdPhTime.formattedDate,
            formattedTime: createdPhTime.formattedTime,
            formattedScheduledDate: formattedScheduledDate,
            formattedScheduledTime: formattedScheduledTime,
            formattedAdminPickupPeriod: request.adminPickupPeriod ? 
                `${new Date(request.adminPickupPeriod.startDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })} to ${new Date(request.adminPickupPeriod.endDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}` 
                : 'Not set',
            hasAdminPickupPeriod: !!(request.adminPickupPeriod && request.adminPickupPeriod.startDate && request.adminPickupPeriod.endDate),
            availableTimeSlots: request.adminPickupPeriod?.availableTimeSlots || [],
            formattedEstimatedCompletion: request.formattedEstimatedCompletion,
            userProfile: userProfile
        };

        req.app.get('io').emit('request-update', {
            type: 'updated',
            request: formattedRequest
        });

        res.status(200).json({
            message: "Request rejected successfully!",
            request: formattedRequest
        });
    } catch (error) {
        console.error("Error rejecting request:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to reject request. Please try again later."
        });
    }
});

// Mark request as processing
router.put("/:id/process", verifySession, checkNotBanned, async (req, res) => {
    try {
        const request = await Request.findByIdAndUpdate(
            req.params.id,
            {
                status: "Processing",
                processingStage: "Processing",
                updatedAt: new Date()
            },
            { new: true }
        ).populate('userId', 'fullName profilePicture');

        if (!request) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Request not found" 
            });
        }

        // Format response
        const createdPhTime = formatInPhilippineTime(request.createdAt);
        const userProfile = request.userId ? {
            profilePicture: getUserProfilePicture(request.userId),
            fullName: request.userId.fullName || request.fullName || 'Unknown User'
        } : {
            profilePicture: '/images/default-profile.png',
            fullName: request.fullName || 'Unknown User'
        };

        let formattedScheduledDate = 'Not scheduled';
        let formattedScheduledTime = 'Not scheduled';
        
        if (request.scheduledClaimDate) {
            const scheduledPhTime = formatInPhilippineTime(request.scheduledClaimDate);
            formattedScheduledDate = scheduledPhTime.formattedDate;
            formattedScheduledTime = request.scheduledClaimTime || 'Not scheduled';
        }

        const formattedRequest = {
            ...request.toObject(),
            id: request._id.toString(),
            documentType: Array.isArray(request.documentTypes) 
                ? request.documentTypes.join(', ') 
                : request.documentTypes || 'N/A',
            formattedDate: createdPhTime.formattedDate,
            formattedTime: createdPhTime.formattedTime,
            formattedScheduledDate: formattedScheduledDate,
            formattedScheduledTime: formattedScheduledTime,
            formattedAdminPickupPeriod: request.adminPickupPeriod ? 
                `${new Date(request.adminPickupPeriod.startDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })} to ${new Date(request.adminPickupPeriod.endDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}` 
                : 'Not set',
            hasAdminPickupPeriod: !!(request.adminPickupPeriod && request.adminPickupPeriod.startDate && request.adminPickupPeriod.endDate),
            availableTimeSlots: request.adminPickupPeriod?.availableTimeSlots || [],
            formattedEstimatedCompletion: request.formattedEstimatedCompletion,
            userProfile: userProfile
        };

        req.app.get('io').emit('request-update', {
            type: 'updated',
            request: formattedRequest
        });

        res.status(200).json({
            message: "Request marked as processing!",
            request: formattedRequest
        });
    } catch (error) {
        console.error("Error updating request:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to update request status. Please try again later."
        });
    }
});

// Admin marks request as claimed
router.put("/:id/claim", verifySession, checkNotBanned, async (req, res) => {
    try {
        const request = await Request.findByIdAndUpdate(
            req.params.id,
            {
                status: "Claimed",
                updatedAt: new Date()
            },
            { new: true }
        ).populate('userId', 'fullName profilePicture');

        if (!request) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Request not found" 
            });
        }

        // Format response
        const createdPhTime = formatInPhilippineTime(request.createdAt);
        const userProfile = request.userId ? {
            profilePicture: getUserProfilePicture(request.userId),
            fullName: request.userId.fullName || request.fullName || 'Unknown User'
        } : {
            profilePicture: '/images/default-profile.png',
            fullName: request.fullName || 'Unknown User'
        };

        let formattedScheduledDate = 'Not scheduled';
        let formattedScheduledTime = 'Not scheduled';
        
        if (request.scheduledClaimDate) {
            const scheduledPhTime = formatInPhilippineTime(request.scheduledClaimDate);
            formattedScheduledDate = scheduledPhTime.formattedDate;
            formattedScheduledTime = request.scheduledClaimTime || 'Not scheduled';
        }

        const formattedRequest = {
            ...request.toObject(),
            id: request._id.toString(),
            documentType: Array.isArray(request.documentTypes) 
                ? request.documentTypes.join(', ') 
                : request.documentTypes || 'N/A',
            formattedDate: createdPhTime.formattedDate,
            formattedTime: createdPhTime.formattedTime,
            formattedScheduledDate: formattedScheduledDate,
            formattedScheduledTime: formattedScheduledTime,
            formattedAdminPickupPeriod: request.adminPickupPeriod ? 
                `${new Date(request.adminPickupPeriod.startDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })} to ${new Date(request.adminPickupPeriod.endDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}` 
                : 'Not set',
            hasAdminPickupPeriod: !!(request.adminPickupPeriod && request.adminPickupPeriod.startDate && request.adminPickupPeriod.endDate),
            availableTimeSlots: request.adminPickupPeriod?.availableTimeSlots || [],
            formattedEstimatedCompletion: request.formattedEstimatedCompletion,
            userProfile: userProfile
        };

        req.app.get('io').emit('request-update', {
            type: 'updated',
            request: formattedRequest
        });

        res.status(200).json({
            message: "Request marked as claimed successfully!",
            request: formattedRequest
        });
    } catch (error) {
        console.error("Error marking request as claimed:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to mark request as claimed. Please try again later."
        });
    }
});

// Bulk actions for requests
router.post("/bulk-action", verifySession, checkNotBanned, async (req, res) => {
    try {
        const { requestIds, action, rejectionReason } = req.body;

        if (!requestIds || !Array.isArray(requestIds) || requestIds.length === 0) {
            return res.status(400).json({ 
                error: "Validation error", 
                message: "Request IDs are required" 
            });
        }

        if (!['approve', 'reject', 'ready', 'claim', 'process'].includes(action)) {
            return res.status(400).json({ 
                error: "Validation error", 
                message: "Invalid action" 
            });
        }

        let updateData = {};
        switch (action) {
            case 'approve':
                updateData.status = 'Approved';
                updateData.processingStage = 'Processing';
                break;
            case 'reject':
                updateData.status = 'Rejected';
                if (rejectionReason) {
                    updateData.rejectionReason = rejectionReason;
                }
                break;
            case 'ready':
                updateData.status = 'Ready to Claim';
                updateData.processingStage = 'Ready';
                break;
            case 'claim':
                updateData.status = 'Claimed';
                break;
            case 'process':
                updateData.status = 'Processing';
                updateData.processingStage = 'Processing';
                break;
        }

        updateData.updatedAt = new Date();

        const result = await Request.updateMany(
            { _id: { $in: requestIds } },
            updateData
        );

        // Emit updates for each request
        const updatedRequests = await Request.find({ _id: { $in: requestIds } })
            .populate('userId', 'fullName profilePicture')
            .lean();

        updatedRequests.forEach(request => {
            const createdPhTime = formatInPhilippineTime(request.createdAt);
            const userProfile = request.userId ? {
                profilePicture: getUserProfilePicture(request.userId),
                fullName: request.userId.fullName || request.fullName || 'Unknown User'
            } : {
                profilePicture: '/images/default-profile.png',
                fullName: request.fullName || 'Unknown User'
            };

            let formattedScheduledDate = 'Not scheduled';
            let formattedScheduledTime = 'Not scheduled';
            
            if (request.scheduledClaimDate) {
                const scheduledPhTime = formatInPhilippineTime(request.scheduledClaimDate);
                formattedScheduledDate = scheduledPhTime.formattedDate;
                formattedScheduledTime = request.scheduledClaimTime || 'Not scheduled';
            }

            const formattedRequest = {
                ...request,
                id: request._id.toString(),
                documentType: Array.isArray(request.documentTypes) 
                    ? request.documentTypes.join(', ') 
                    : request.documentTypes || 'N/A',
                formattedDate: createdPhTime.formattedDate,
                formattedTime: createdPhTime.formattedTime,
                formattedScheduledDate: formattedScheduledDate,
                formattedScheduledTime: formattedScheduledTime,
                formattedAdminPickupPeriod: request.adminPickupPeriod ? 
                    `${new Date(request.adminPickupPeriod.startDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })} to ${new Date(request.adminPickupPeriod.endDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}` 
                    : 'Not set',
                hasAdminPickupPeriod: !!(request.adminPickupPeriod && request.adminPickupPeriod.startDate && request.adminPickupPeriod.endDate),
                availableTimeSlots: request.adminPickupPeriod?.availableTimeSlots || [],
                formattedEstimatedCompletion: request.estimatedCompletionDate ? 
                    new Date(request.estimatedCompletionDate).toLocaleDateString('en-US', {
                        month: 'short',
                        day: '2-digit',
                        year: 'numeric'
                    }) : 'Not set',
                userProfile: userProfile
            };

            req.app.get('io').emit('request-update', {
                type: 'updated',
                request: formattedRequest
            });
        });

        res.status(200).json({
            message: `Successfully ${action}ed ${result.modifiedCount} request(s)`,
            processedCount: result.modifiedCount
        });
    } catch (error) {
        console.error("Error performing bulk action:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to perform bulk action. Please try again later."
        });
    }
});

// Clean up archived requests (admin only - all users)
router.post("/cleanup", verifySession, checkNotBanned, async (req, res) => {
    try {
        const result = await Request.deleteMany({
            status: { $in: ['Archived', 'Expired'] }
        });

        req.app.get('io').emit('request-update', {
            type: 'deleted',
            count: result.deletedCount
        });

        res.status(200).json({
            message: `Deleted ${result.deletedCount} archived requests`,
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error("Error cleaning up archived requests:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to clean up archived requests. Please try again later."
        });
    }
});

// Delete a single request (for residents to delete rejected requests)
router.delete("/:id", verifySession, checkNotBanned, async (req, res) => {
    try {
        const request = await Request.findById(req.params.id);

        if (!request) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Request not found",
                success: false
            });
        }

        // Check if the request belongs to the user
        if (request.userId.toString() !== req.session.userId.toString()) {
            return res.status(403).json({
                error: "Forbidden",
                message: "You can only delete your own requests",
                success: false
            });
        }

        // Only allow deletion of rejected requests
        if (request.status !== 'Rejected') {
            return res.status(400).json({
                error: "Bad Request",
                message: "Only rejected requests can be deleted",
                success: false
            });
        }

        await Request.findByIdAndDelete(req.params.id);

        req.app.get('io').emit('request-update', {
            type: 'deleted',
            requestId: req.params.id
        });

        res.status(200).json({
            message: "Request deleted successfully",
            success: true
        });
    } catch (error) {
        console.error("Error deleting request:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to delete request. Please try again later.",
            success: false
        });
    }
});

module.exports = router;