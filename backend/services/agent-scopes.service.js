const mongoose = require("mongoose");
const User = require("../models/user.model");

// The notes agent's permission toggles (architecture plan §5.3, feature plan
// §8). Read is always on and not stored. Defaults apply to users who never
// changed them (and to accounts with no user document, e.g. test users).
const DEFAULT_SCOPES = Object.freeze({ compose: true, organize: true, destructive: false });
const SCOPE_KEYS = Object.keys(DEFAULT_SCOPES);

const getAgentScopes = async (userId) => {
    if (!mongoose.Types.ObjectId.isValid(String(userId))) return { ...DEFAULT_SCOPES };
    const user = await User.findById(userId).select("agentScopes").lean();
    const stored = user?.agentScopes || {};
    return Object.fromEntries(SCOPE_KEYS.map((key) => [key, typeof stored[key] === "boolean" ? stored[key] : DEFAULT_SCOPES[key]]));
};

// Which bulk actions the scopes allow (trash needs `destructive`).
const allowsBulkAction = (scopes, action) => (action === "trash" ? scopes.organize && scopes.destructive : scopes.organize);

module.exports = { DEFAULT_SCOPES, SCOPE_KEYS, getAgentScopes, allowsBulkAction };
