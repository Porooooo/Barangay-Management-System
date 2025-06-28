const Request = require("./models/Request");

const cleanupOldRequests = async () => {
    try {
        // Get current time
        const now = new Date();
        const oneMonthAgo = new Date(now);
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        
        const result = await Request.deleteMany({
            status: { $in: ['Approved', 'Rejected'] },
            updatedAt: { $lt: oneMonthAgo }
        });
        
        console.log(`Cleaned up ${result.deletedCount} old requests`);
        return result;
    } catch (error) {
        console.error('Error cleaning up old requests:', error);
        throw error;
    }
};

// Run cleanup daily
const scheduleCleanup = () => {
    // Run once immediately
    cleanupOldRequests();
    
    // Then run daily at 2 AM
    setInterval(() => {
        const now = new Date();
        if (now.getHours() === 2 && now.getMinutes() === 0) {
            cleanupOldRequests();
        }
    }, 60000); // Check every minute
};

module.exports = {
    cleanupOldRequests,
    scheduleCleanup
};