/**
 * Utilities for fast O(1) folder hierarchy traversal and normalization.
 */

export const buildFolderHierarchy = (foldersList = []) => {
  const folders = Array.isArray(foldersList) ? foldersList : [];
  const foldersById = new Map();
  const childrenByParent = new Map();
  const rootFolders = [];

  // Pass 1: Index all folders by string ID
  for (const folder of folders) {
    if (folder && folder._id) {
      foldersById.set(String(folder._id), folder);
    }
  }

  // Pass 2: Group children by parent ID
  for (const folder of folders) {
    if (!folder || !folder._id) continue;
    const parentKey = folder.parentId ? String(folder.parentId) : null;
    
    // Only group under living / existing parents, otherwise surface as root if active
    const isParentValid = parentKey && foldersById.has(parentKey);
    const effectiveParentKey = isParentValid ? parentKey : null;

    if (effectiveParentKey === null && !folder.isDeleted) {
      rootFolders.push(folder);
    }

    const existingChildren = childrenByParent.get(effectiveParentKey) || [];
    existingChildren.push(folder);
    childrenByParent.set(effectiveParentKey, existingChildren);
  }

  // Sort root folders by orderIndex
  rootFolders.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

  const getSubtreeIds = (rootFolderId) => {
    const rootId = String(rootFolderId);
    if (!foldersById.has(rootId)) return [rootFolderId];

    const result = [];
    const visited = new Set();
    const stack = [rootId];

    while (stack.length > 0) {
      const currentId = stack.pop();
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      result.push(currentId);

      const children = childrenByParent.get(currentId) || [];
      for (let i = children.length - 1; i >= 0; i--) {
        const childId = String(children[i]._id);
        if (!visited.has(childId)) {
          stack.push(childId);
        }
      }
    }

    return result;
  };

  const getFolderPath = (targetFolderId) => {
    const path = [];
    const visited = new Set();
    let currentId = targetFolderId ? String(targetFolderId) : null;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const folder = foldersById.get(currentId);
      if (!folder) break;
      path.unshift(folder);
      currentId = folder.parentId ? String(folder.parentId) : null;
    }

    return path;
  };

  const getDirectChildren = (parentId) => {
    const key = parentId ? String(parentId) : null;
    const children = childrenByParent.get(key) || [];
    return children.filter((child) => !child.isDeleted);
  };

  const hasChildren = (parentId) => {
    const key = parentId ? String(parentId) : null;
    const children = childrenByParent.get(key) || [];
    return children.some((child) => !child.isDeleted);
  };

  const getFlattenedTree = (startParentId = null, initialDepth = 0) => {
    const result = [];
    const traverse = (parentId, depth) => {
      const key = parentId ? String(parentId) : null;
      const children = (childrenByParent.get(key) || [])
        .filter((child) => !child.isDeleted)
        .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

      for (const child of children) {
        result.push({ ...child, depth });
        traverse(child._id, depth + 1);
      }
    };
    traverse(startParentId, initialDepth);
    return result;
  };

  return {
    foldersById,
    childrenByParent,
    rootFolders,
    getSubtreeIds,
    getFolderPath,
    getDirectChildren,
    hasChildren,
    getFlattenedTree,
  };
};

export const getSubtreeIds = (foldersList, folderId) => {
  return buildFolderHierarchy(foldersList).getSubtreeIds(folderId);
};

export const getFolderPath = (foldersList, folderId) => {
  return buildFolderHierarchy(foldersList).getFolderPath(folderId);
};
