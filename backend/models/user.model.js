const mongoose = require("mongoose")
const Schema = mongoose.Schema;
const bcrypt = require('bcrypt');

const userSchema = new Schema({
    fullName: { type: String },
    email: { type: String },
    password: { type: String },
    googleId: { type: String },
    createdOn: { type: Date, default: () => new Date() },
});

userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
    } catch (error) {
        return next(error);
    }
    next();
})

userSchema.methods.comparePassword = async function (password) {
    return await bcrypt.compare(password, this.password);
}

module.exports = mongoose.model("User", userSchema);