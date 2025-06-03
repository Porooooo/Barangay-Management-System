require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const User = require('./models/User');

async function migrateProfilePictures() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/btms', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('Starting profile picture migration...');
    const users = await User.find({});
    let updatedCount = 0;

    for (const user of users) {
      let needsUpdate = false;
      
      // Check if profile picture exists
      if (user.profilePicture && user.profilePicture !== 'default-profile.png') {
        const filePath = path.join(__dirname, 'uploads', user.profilePicture);
        if (!fs.existsSync(filePath)) {
          console.log(`❌ Missing file: ${user.profilePicture} for user ${user.email}`);
          user.profilePicture = 'default-profile.png';
          needsUpdate = true;
        }
      } else if (!user.profilePicture) {
        user.profilePicture = 'default-profile.png';
        needsUpdate = true;
      }

      if (needsUpdate) {
        await user.save();
        updatedCount++;
        console.log(`✅ Updated profile for ${user.email}`);
      }
    }

    console.log(`Migration complete. Updated ${updatedCount} of ${users.length} users.`);
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrateProfilePictures();