// The editor card's chrome (rounded corners, border, shadow), shared by the editor and its loading
// placeholder. The card keeps the same chrome in card and full-screen modes: full screen is the same
// floating card enlarged, with the page gap still around it. GlobalEditorOverlay sets
// --editor-radius and --editor-chrome on the layer around the card.
export const EDITOR_RADIUS_PX = 24;

// The editor's bottom toolbar height, keyed by the editor's own breakpoint
// (BELOW_TABLET_QUERY, which differs from the dock's phone breakpoint).
export const EDITOR_TOOLBAR_H_PX = { phone: 46, desktop: 52 };

// In full screen the dock shrinks to a dot that IS the compact dock reduced to one button: its
// height, a coral circle the size of its + button, sitting where the compact dock sits (TabDock).
// The toolbar is exactly that dot plus the dock's bottom gap, so the dot sits in the toolbar.
export const fullscreenToolbarHeight = (dockMetrics) => dockMetrics.height[1] + 2 * dockMetrics.paddingBottom[1];
// Room kept free in the toolbar for the dot: the dot plus a margin each side.
export const EDITOR_TOOLBAR_DOT_SLOT_MARGIN_PX = 8;

export const EDITOR_CARD_STYLE = {
  border: 'none',
  borderRadius: `var(--editor-radius, ${EDITOR_RADIUS_PX}px)`,
  // Tailwind's shadow-sm, faded with the chrome
  boxShadow: '0 1px 3px 0 rgb(0 0 0 / calc(0.1 * var(--editor-chrome, 1))), 0 1px 2px -1px rgb(0 0 0 / calc(0.1 * var(--editor-chrome, 1)))',
};
