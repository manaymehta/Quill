// Layout breakpoints as media queries, matching Tailwind's defaults (sm = 40rem, md = 48rem) so
// JS decisions agree with the sm:/md: classes. Use with useMediaQuery() while rendering, or
// window.matchMedia(query).matches at the moment of an action.
export const MOBILE_QUERY = '(max-width: 639px)';      // below sm: phones
export const BELOW_TABLET_QUERY = '(max-width: 767px)'; // below md: phones + small tablets
