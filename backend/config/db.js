const mongoose = require("mongoose");
require("dotenv").config();

const connectDB = async () => {
    try {
        const connectionString = process.env.MONGO_URI;

        await mongoose.connect(connectionString);
        console.log("MongoDB Connected");
    } catch (error) {
        console.error("Database connection error:", error);
        process.exit(1);
    }
};

module.exports = connectDB;
