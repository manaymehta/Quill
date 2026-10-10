const mongoose = require("mongoose")
const Schema = mongoose.Schema;
const bcrypt = require('bcrypt');

const userSchema = new Schema({
    fullName: { type: String, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    password: { type: String },
    googleId: { type: String },
    createdOn: { type: Date, default: () => new Date() },
    // What the notes agent may do (architecture plan §5.3). Reading is always
    // on. A turned-off ability's tools are not offered to the agent at all.
    agentScopes: {
        compose: { type: Boolean, default: true },       // draft notes and edits
        organize: { type: Boolean, default: true },      // bulk move / tag / archive (via review list)
        destructive: { type: Boolean, default: false },  // bulk send to trash (soft delete only)
    },
});

userSchema.pre('save', async function () {
    if (!this.isModified('password')) return;
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
})

userSchema.methods.comparePassword = async function (password) {
    return await bcrypt.compare(password, this.password);
}

module.exports = mongoose.model("User", userSchema);
