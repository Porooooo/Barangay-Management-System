const Announcement = require('../models/Announcement');
const path = require('path');
const fs = require('fs');

// Function to clean up expired announcements
async function cleanupExpiredAnnouncements() {
    try {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const expiredAnnouncements = await Announcement.find({ createdAt: { $lt: twentyFourHoursAgo } });
        
        // Delete associated images
        for (const announcement of expiredAnnouncements) {
            if (announcement.imageUrl) {
                const imagePath = path.join(__dirname, '../public', announcement.imageUrl);
                if (fs.existsSync(imagePath)) {
                    fs.unlinkSync(imagePath);
                }
            }
        }
        
        // Delete from database
        await Announcement.deleteMany({ createdAt: { $lt: twentyFourHoursAgo } });
        
        console.log(`Cleaned up ${expiredAnnouncements.length} expired announcements`);
    } catch (error) {
        console.error('Error cleaning up announcements:', error);
    }
}

// Run cleanup every hour
function startCleanupSchedule() {
    setInterval(cleanupExpiredAnnouncements, 60 * 60 * 1000); // Every hour
    console.log('Announcement cleanup scheduler started');
}

module.exports = {
    cleanupExpiredAnnouncements,
    startCleanupSchedule
};