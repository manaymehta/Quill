const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Suggested groups of related notes (the agent's suggest_groups tool). Each
// group can be turned into a normal review list (move to a new folder, or
// tag); nothing changes until the user presses Apply. Erased after 3 days.
const GROUPING_TTL_DAYS = 3;

const misfitSchema = new Schema(
    {
        noteId: { type: String, required: true },
        reason: { type: String, default: "" },
    },
    { _id: false }
);

const groupSchema = new Schema(
    {
        name: { type: String, required: true },
        tag: { type: String, required: true },
        noteIds: { type: [String], default: [] },
        misfits: { type: [misfitSchema], default: [] },
    },
    { _id: false }
);

const agentGroupingSchema = new Schema(
    {
        groupingId: { type: String, required: true, unique: true },
        userId: { type: String, required: true, index: true },
        // The chat it was made in (set by Express when the turn is saved).
        chatId: { type: String, default: null },
        instruction: { type: String, default: "" },
        groups: { type: [groupSchema], default: [] },
    },
    { timestamps: true }
);

agentGroupingSchema.index({ createdAt: 1 }, { expireAfterSeconds: GROUPING_TTL_DAYS * 24 * 60 * 60 });

module.exports = mongoose.model("AgentGrouping", agentGroupingSchema);
