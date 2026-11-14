// Layout breakpoints as media queries, matching Tailwind's defaults (sm = 40rem, md = 48rem) so
// JS decisions agree with the sm:/md: classes. Use with useMediaQuery() while rendering, or
// window.matchMedia(query).matches at the moment of an action.
export const MOBILE_QUERY = '(max-width: 639px)';      // below sm: phones
export const BELOW_TABLET_QUERY = '(max-width: 767px)'; // below md: phones + small tablets
// The summary panel stays beside the editor down to 900px (card ~572px, compact action bar); below
// that it becomes the shared bottom sheet. Latched when the panel opens — see GlobalEditorOverlay.
export const PANEL_NARROW_QUERY = '(max-width: 56.24rem)';
// From here the sidebar pushes the page aside; below it, it floats over the page instead, because
// the 220px it takes would leave the notes grid too little room for a card (see NotesGrid).
export const SIDEBAR_DOCK_QUERY = '(min-width: 56.25rem)';
