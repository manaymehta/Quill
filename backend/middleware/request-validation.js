const mongoose = require("mongoose");

const validationError = (res, message) => {
    return res.status(400).json({ error: true, message });
};

const validateObjectBody = (req, res, next) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return validationError(res, "Request body must be a JSON object");
    }
    next();
};

const validateObjectIdParam = (paramName) => (req, res, next) => {
    const value = req.params[paramName];
    if (!mongoose.Types.ObjectId.isValid(value)) {
        return validationError(res, `Invalid ${paramName}`);
    }
    next();
};

const validateQueryParam = (paramName, { required = false, maxLength = 256 } = {}) => (req, res, next) => {
    const value = req.query[paramName];

    if (required && (typeof value !== "string" || !value.trim())) {
        return validationError(res, `${paramName} is required`);
    }

    if (value !== undefined && (typeof value !== "string" || value.length > maxLength)) {
        return validationError(res, `Invalid ${paramName}`);
    }

    next();
};

module.exports = {
    validateObjectBody,
    validateObjectIdParam,
    validateQueryParam,
};
