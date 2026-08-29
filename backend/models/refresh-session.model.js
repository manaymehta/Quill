const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const refreshSessionSchema = new Schema({
    userId: { type: String, required: true, index: true },
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    replacedByHash: { type: String, default: null },
    userAgent: { type: String, default: "" },
    ipAddress: { type: String, default: "" },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
}, {
    timestamps: true,
});

// MongoDB removes expired sessions automatically; this is cleanup only and
// never serves as the authorization check.
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RefreshSession", refreshSessionSchema);
