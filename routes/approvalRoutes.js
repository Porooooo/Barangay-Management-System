const express = require("express");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const User = require("../models/User");
const { authMiddleware, adminMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();

// Email transporter configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

// GET approval statistics
router.get("/stats/counts", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const pendingCount = await User.countDocuments({ 
            approvalStatus: 'pending',
            role: 'resident'
        });
        
        const approvedCount = await User.countDocuments({ 
            approvalStatus: 'approved',
            role: 'resident'
        });
        
        const rejectedCount = await User.countDocuments({ 
            approvalStatus: 'rejected',
            role: 'resident'
        });

        res.status(200).json({
            success: true,
            data: {
                pending: pendingCount,
                approved: approvedCount,
                rejected: rejectedCount,
                total: pendingCount + approvedCount + rejectedCount
            }
        });
    } catch (error) {
        console.error("Error fetching approval stats:", error);
        res.status(500).json({
            success: false,
            error: "Server Error",
            message: error.message || "Failed to fetch approval statistics"
        });
    }
});

// GET users by status (pending, approved, rejected)
router.get("/:status", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { status } = req.params;
        const { search } = req.query;

        // Validate status parameter
        const validStatuses = ['pending', 'approved', 'rejected'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                error: "Invalid Status",
                message: "Status must be one of: pending, approved, rejected"
            });
        }

        let query = { 
            approvalStatus: status,
            role: 'resident'
        };

        if (search) {
            const searchRegex = new RegExp(search, 'i');
            query.$or = [
                { fullName: searchRegex },
                { email: searchRegex },
                { contactNumber: searchRegex },
                { firstName: searchRegex },
                { lastName: searchRegex }
            ];
        }

        const users = await User.find(query)
            .select('-password -resetPasswordToken -resetPasswordExpires')
            .sort({ createdAt: -1 })
            .lean();

        // Format user data including ID photo URL
        const formattedUsers = users.map(user => ({
            ...user,
            profilePicture: user.profilePicture
                ? user.profilePicture.startsWith('http')
                    ? user.profilePicture
                    : `/uploads/${user.profilePicture}`
                : '/images/default-profile.png',
            idPhoto: user.idPhoto
                ? user.idPhoto.startsWith('http')
                    ? user.idPhoto
                    : `/uploads/${user.idPhoto}`
                : null,
            createdAt: user.createdAt ? user.createdAt.toISOString() : null,
            updatedAt: user.updatedAt ? user.updatedAt.toISOString() : null,
            birthdate: user.birthdate ? user.birthdate.toISOString() : null,
            approvedAt: user.approvedAt ? user.approvedAt.toISOString() : null,
            rejectedAt: user.rejectedAt ? user.rejectedAt.toISOString() : null
        }));

        res.status(200).json({
            success: true,
            count: formattedUsers.length,
            users: formattedUsers
        });
    } catch (error) {
        console.error("Error fetching users by status:", error);
        res.status(500).json({
            success: false,
            error: "Server Error",
            message: error.message || "Failed to fetch users"
        });
    }
});

// GET user details for approval
router.get("/user/:id", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
                success: false,
                error: "Invalid ID",
                message: "Invalid user ID format"
            });
        }

        const user = await User.findById(req.params.id)
            .select('-password -resetPasswordToken -resetPasswordExpires')
            .lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                error: "Not Found",
                message: "User not found"
            });
        }

        // Format user data including ID photo URL
        const formattedUser = {
            ...user,
            profilePicture: user.profilePicture
                ? user.profilePicture.startsWith('http')
                    ? user.profilePicture
                    : `/uploads/${user.profilePicture}`
                : '/images/default-profile.png',
            idPhoto: user.idPhoto
                ? user.idPhoto.startsWith('http')
                    ? user.idPhoto
                    : `/uploads/${user.idPhoto}`
                : null,
            createdAt: user.createdAt ? user.createdAt.toISOString() : null,
            updatedAt: user.updatedAt ? user.updatedAt.toISOString() : null,
            birthdate: user.birthdate ? user.birthdate.toISOString() : null,
            approvedAt: user.approvedAt ? user.approvedAt.toISOString() : null,
            rejectedAt: user.rejectedAt ? user.rejectedAt.toISOString() : null
        };

        res.status(200).json({
            success: true,
            data: formattedUser
        });
    } catch (error) {
        console.error("Error fetching user details:", error);
        res.status(500).json({
            success: false,
            error: "Server Error",
            message: error.message || "Failed to fetch user details"
        });
    }
});

// POST approve user - UPDATED WITH TEMPORARY PASSWORD GENERATION
router.post("/:id/approve", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
                success: false,
                error: "Invalid ID",
                message: "Invalid user ID format"
            });
        }

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: "Not Found",
                message: "User not found"
            });
        }

        if (user.approvalStatus !== 'pending') {
            return res.status(400).json({
                success: false,
                error: "Bad Request",
                message: "User is not pending approval"
            });
        }

        // Generate temporary password
        const generateTemporaryPassword = () => {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let password = '';
            for (let i = 0; i < 8; i++) {
                password += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return password;
        };

        const temporaryPassword = generateTemporaryPassword();
        
        // Update user with temporary password
        user.password = temporaryPassword;
        user.approvalStatus = 'approved';
        user.approvedAt = new Date();
        user.approvedBy = req.session.userId;
        user.rejectionReason = null;
        user.rejectedAt = null;
        user.forcePasswordChange = true; // Force password change on first login

        await user.save();

        // Send approval notification with temporary password
        try {
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: user.email,
                subject: 'Account Approved - Barangay Management System',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                        <div style="text-align: center; background: #f3e0b6; padding: 15px; border-radius: 8px 8px 0 0;">
                            <h2 style="color: #333; margin: 0;">Account Approved!</h2>
                        </div>
                        <div style="padding: 20px;">
                            <p>Dear ${user.firstName} ${user.lastName},</p>
                            
                            <p>We are pleased to inform you that your account registration with the Barangay Management System has been <strong>approved</strong>.</p>
                            
                            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; border-left: 4px solid #28a745; margin: 20px 0;">
                                <h3 style="color: #333; margin-top: 0;">Your Login Credentials:</h3>
                                <p style="margin: 5px 0;"><strong>Email:</strong> ${user.email}</p>
                                <p style="margin: 5px 0;"><strong>Temporary Password:</strong> 
                                    <span style="background: #fff3cd; padding: 5px 10px; border-radius: 3px; font-family: monospace; font-weight: bold;">
                                        ${temporaryPassword}
                                    </span>
                                </p>
                            </div>
                            
                            <div style="background: #d1ecf1; padding: 15px; border-radius: 5px; border-left: 4px solid #17a2b8; margin: 20px 0;">
                                <h4 style="color: #0c5460; margin-top: 0;">Important Security Notice:</h4>
                                <p style="margin: 5px 0; color: #0c5460;">
                                    🔒 For security reasons, you will be required to change your temporary password immediately after your first login.
                                </p>
                            </div>
                            
                            <p>You can now login to your account and access the Barangay Management System features.</p>
                            
                            <div style="text-align: center; margin: 25px 0;">
                                <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/login" 
                                style="background: #28a745; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                                    Login to Your Account
                                </a>
                            </div>
                            
                            <p style="color: #6c757d; font-size: 14px;">
                                <strong>Note:</strong> Please keep your login credentials secure and do not share them with anyone.
                            </p>
                            
                            <p>If you have any questions or need assistance, please contact the barangay administration.</p>
                            
                            <p>Best regards,<br>Barangay Management System Team</p>
                        </div>
                        <div style="text-align: center; padding: 15px; background: #f8f9fa; border-radius: 0 0 8px 8px; font-size: 12px; color: #6c757d;">
                            This is an automated message. Please do not reply to this email.
                        </div>
                    </div>
                `
            };

            await transporter.sendMail(mailOptions);
            console.log(`Approval email sent to ${user.email} with temporary password`);
            
        } catch (emailError) {
            console.error("Failed to send approval email:", emailError);
            // Don't fail the approval if email fails, just log it
        }

        console.log(`User ${user.email} approved. Temporary password: ${temporaryPassword}`);

        res.status(200).json({
            success: true,
            message: "User approved successfully. Temporary password generated and sent.",
            data: {
                id: user._id,
                approvalStatus: user.approvalStatus,
                approvedAt: user.approvedAt
            }
        });
    } catch (error) {
        console.error("Error approving user:", error);
        res.status(500).json({
            success: false,
            error: "Server Error",
            message: error.message || "Failed to approve user"
        });
    }
});

// POST reject user - UPDATED WITH REJECTION EMAIL
router.post("/:id/reject", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { reason } = req.body;

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
                success: false,
                error: "Invalid ID",
                message: "Invalid user ID format"
            });
        }

        if (!reason || reason.trim() === '') {
            return res.status(400).json({
                success: false,
                error: "Validation Error",
                message: "Rejection reason is required"
            });
        }

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: "Not Found",
                message: "User not found"
            });
        }

        if (user.approvalStatus !== 'pending') {
            return res.status(400).json({
                success: false,
                error: "Bad Request",
                message: "User is not pending approval"
            });
        }

        user.approvalStatus = 'rejected';
        user.rejectionReason = reason.trim();
        user.rejectedAt = new Date();
        user.approvedAt = null;
        user.approvedBy = null;

        await user.save();

        // Send rejection notification email
        try {
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: user.email,
                subject: 'Account Registration Update - Barangay Management System',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                        <div style="text-align: center; background: #f8d7da; padding: 15px; border-radius: 8px 8px 0 0;">
                            <h2 style="color: #721c24; margin: 0;">Registration Status Update</h2>
                        </div>
                        <div style="padding: 20px;">
                            <p>Dear ${user.firstName} ${user.lastName},</p>
                            
                            <p>Thank you for your interest in registering with the Barangay Management System.</p>
                            
                            <div style="background: #f8d7da; padding: 15px; border-radius: 5px; border-left: 4px solid #dc3545; margin: 20px 0;">
                                <h3 style="color: #721c24; margin-top: 0;">Registration Status: <span style="color: #dc3545;">Not Approved</span></h3>
                                <p style="margin: 10px 0; color: #721c24;">
                                    <strong>Reason:</strong> ${reason.trim()}
                                </p>
                            </div>
                            
                            <p>If you believe this was a mistake or would like to provide additional information, please contact the barangay administration office during business hours.</p>
                            
                            <p>You may also submit a new registration request with corrected or additional information.</p>
                            
                            <p>Thank you for your understanding.</p>
                            
                            <p>Best regards,<br>Barangay Management System Team</p>
                        </div>
                        <div style="text-align: center; padding: 15px; background: #f8f9fa; border-radius: 0 0 8px 8px; font-size: 12px; color: #6c757d;">
                            This is an automated message. Please do not reply to this email.
                        </div>
                    </div>
                `
            };

            await transporter.sendMail(mailOptions);
            console.log(`Rejection email sent to ${user.email}`);
            
        } catch (emailError) {
            console.error("Failed to send rejection email:", emailError);
            // Don't fail the rejection if email fails, just log it
        }

        res.status(200).json({
            success: true,
            message: "User rejected successfully. Notification sent.",
            data: {
                id: user._id,
                approvalStatus: user.approvalStatus,
                rejectedAt: user.rejectedAt,
                rejectionReason: user.rejectionReason
            }
        });
    } catch (error) {
        console.error("Error rejecting user:", error);
        res.status(500).json({
            success: false,
            error: "Server Error",
            message: error.message || "Failed to reject user"
        });
    }
});

// DELETE user (for rejected users only)
router.delete("/:id/delete", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
                success: false,
                error: "Invalid ID",
                message: "Invalid user ID format"
            });
        }

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: "Not Found",
                message: "User not found"
            });
        }

        // Only allow deletion of rejected users
        if (user.approvalStatus !== 'rejected') {
            return res.status(400).json({
                success: false,
                error: "Invalid Operation",
                message: "Only rejected users can be deleted"
            });
        }

        await User.findByIdAndDelete(req.params.id);

        res.status(200).json({
            success: true,
            message: "User deleted successfully"
        });
    } catch (error) {
        console.error("Error deleting user:", error);
        res.status(500).json({
            success: false,
            error: "Server Error",
            message: error.message || "Failed to delete user"
        });
    }
});

// DELETE all rejected users
router.delete("/delete-all-rejected", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await User.deleteMany({ 
            approvalStatus: 'rejected',
            role: 'resident'
        });

        res.status(200).json({
            success: true,
            message: `Successfully deleted ${result.deletedCount} rejected users`,
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error("Error deleting all rejected users:", error);
        res.status(500).json({
            success: false,
            error: "Server Error",
            message: error.message || "Failed to delete rejected users"
        });
    }
});

module.exports = router;