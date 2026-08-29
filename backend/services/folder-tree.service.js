const Folder = require("../models/folder.model");

const getUserFolders = (userId, session = null) => {
    const query = Folder.find({ userId })
        .select("_id parentId isDeleted deletedBatchId isDeletedRoot");
    if (session) query.session(session);
    return query.lean();
};

const collectSubtreeFolderIds = (folders, rootId) => {
    const root = String(rootId);
    const folderIds = new Set(folders.map((folder) => String(folder._id)));
    if (!folderIds.has(root)) return [];

    const childrenByParent = new Map();
    for (const folder of folders) {
        const parentId = folder.parentId ? String(folder.parentId) : null;
        const children = childrenByParent.get(parentId) || [];
        children.push(String(folder._id));
        childrenByParent.set(parentId, children);
    }

    const result = [];
    const visited = new Set();
    const stack = [root];

    while (stack.length > 0) {
        const currentId = stack.pop();
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        result.push(currentId);

        const children = childrenByParent.get(currentId) || [];
        for (let index = children.length - 1; index >= 0; index -= 1) {
            if (!visited.has(children[index])) stack.push(children[index]);
        }
    }

    return result;
};

const findNearestLivingAncestor = (startParentId, folders) => {
    const foldersById = new Map(folders.map((folder) => [String(folder._id), folder]));
    const visited = new Set();
    let currentId = startParentId ? String(startParentId) : null;

    while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const folder = foldersById.get(currentId);
        if (!folder) return null;
        if (!folder.isDeleted) return currentId;
        currentId = folder.parentId ? String(folder.parentId) : null;
    }

    return null;
};

module.exports = {
    collectSubtreeFolderIds,
    findNearestLivingAncestor,
    getUserFolders,
};
