import axiosInstance from './axiosInstance';

// A save replies before the note is re-indexed for the agent's search (that runs right after, on
// the server). This asks how it went, waiting for it if it's still running, and resolves to true
// if it failed, so the caller can still warn. Any error asking is treated as "fine": the note itself
// is saved, and a missed index heals on the agent's next search.
export const noteIndexingFailed = async (noteId) => {
  try {
    const { data } = await axiosInstance.get(`/note-index-status/${noteId}`);
    return ['failed', 'partial'].includes(data?.embedding?.status);
  } catch {
    return false;
  }
};
