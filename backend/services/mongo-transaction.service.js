const mongoose = require("mongoose");

const transactionSupportUnavailable = (error) => /transaction numbers are only allowed|transaction is not supported|replica set|mongos/i.test(error.message || "");

const supportsTransactions = () => {
    const topologyType = mongoose.connection?.client?.topology?.description?.type;
    return topologyType === "ReplicaSetWithPrimary" || topologyType === "Sharded";
};

const withOptionalTransaction = async (work) => {
    if (!supportsTransactions()) return work(null);

    const session = await mongoose.startSession();
    try {
        let result;
        try {
            await session.withTransaction(async () => {
                result = await work(session);
            });
            return result;
        } catch (error) {
            if (!transactionSupportUnavailable(error)) throw error;
            // Standalone MongoDB is valid for local development but cannot run
            // transactions. The same operation remains usable there.
            return work(null);
        }
    } finally {
        await session.endSession();
    }
};

module.exports = {
    withOptionalTransaction,
};
