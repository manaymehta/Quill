const mongoose = require("mongoose");
const { MONGO_URI } = require("./env");

const connectDB = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log("MongoDB Connected");
    } catch (error) {
        console.error("Database connection error:", error);
        throw error;
    }
};

module.exports = connectDB;
