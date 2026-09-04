const mongoose = require("mongoose");
require("dotenv").config();

const connectDB = async () => {
    const connectionString = process.env.MONGO_URI;
    if (!connectionString) {
        throw new Error("MONGO_URI is not configured");
    }

    try {
        await mongoose.connect(connectionString);
        console.log("MongoDB Connected");
    } catch (error) {
        console.error("Database connection error:", error);
        throw error;
    }
};

module.exports = connectDB;
