require("dotenv").config();
const mongoose = require("mongoose");
const Note = require("./models/note.model");
const User = require("./models/user.model");

const runMigration = async () => {
    const uri = process.env.MONGO_URI;
    if (!uri) {
        console.error("MONGO_URI is missing from environment!");
        process.exit(1);
    }

    try {
        console.log("Connecting to MongoDB...");
        await mongoose.connect(uri);
        console.log("Connected successfully!");

        // 1. Pinned status transition: isPinned: true -> showInHome: true
        console.log("Migrating pin statuses...");
        const pinResult = await Note.updateMany(
            { isPinned: true },
            { $set: { showInHome: true } }
        );
        console.log(`Updated showInHome for ${pinResult.modifiedCount} pinned notes.`);

        // 2. Fetch all users to seed homeOrderIndex independently per user
        console.log("Fetching users to seed homeOrderIndex...");
        const users = await User.find({}, "_id");
        console.log(`Found ${users.length} users. Migrating home indices...`);

        let migratedUsersCount = 0;
        for (const user of users) {
            const notes = await Note.find({ userId: user._id }).sort({ orderIndex: 1 });
            if (notes.length === 0) continue;

            const bulkOps = notes.map((note, index) => ({
                updateOne: {
                    filter: { _id: note._id },
                    update: { 
                        $set: { 
                            homeOrderIndex: index, 
                            folderId: null 
                        } 
                    }
                }
            }));

            await Note.bulkWrite(bulkOps);
            migratedUsersCount++;
        }
        console.log(`Seeded homeOrderIndex for notes of ${migratedUsersCount} active users.`);

        // 3. Clean up: Drop the deprecated isPinned field
        console.log("Dropping isPinned field from database documents...");
        const cleanupResult = await Note.updateMany(
            {}, 
            { $unset: { isPinned: "" } }
        );
        console.log(`Dropped isPinned field on ${cleanupResult.modifiedCount} note documents.`);

        console.log("Migration completed successfully!");
        process.exit(0);
    } catch (error) {
        console.error("Migration failed:", error);
        process.exit(1);
    }
};

runMigration();
