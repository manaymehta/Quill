// The editor card's chrome (rounded corners, border, shadow), shared by the editor and its loading
// placeholder. In full screen it fades away: GlobalEditorOverlay sets --editor-radius and
// --editor-chrome (1 = card, 0 = full screen) on the layer around the card as the transition runs.
// The border keeps its 1px width and only fades, so nothing inside shifts by a pixel.
export const EDITOR_RADIUS_PX = 24;

// The editor's bottom toolbar height in card mode, keyed by the editor's own breakpoint
// (BELOW_TABLET_QUERY, which differs from the dock's phone breakpoint).
export const EDITOR_TOOLBAR_H_PX = { phone: 46, desktop: 52 };

// In full screen the dock shrinks to a dot that IS the compact dock reduced to one button: its
// height, a coral circle the size of its + button, sitting where the compact dock sits (TabDock).
// The toolbar is then exactly that dot plus the dock's bottom gap above and below it, so the dot
// sits centred in the toolbar. Takes the dock's metrics (dockMetrics.js); [1] = the editor state.
export const fullscreenToolbarHeight = (dockMetrics) => dockMetrics.height[1] + 2 * dockMetrics.paddingBottom[1];
// Room kept free in the toolbar's middle for the dot: the dot plus a margin each side
export const EDITOR_TOOLBAR_DOT_SLOT_MARGIN_PX = 8;

export const EDITOR_CARD_STYLE = {
  borderWidth: 1,
  // The bottom border goes to 0 width in full screen (its sides keep 1px, so the text column never
  // shifts): a 1px invisible bottom border lifted the toolbar 1px off the screen's bottom edge, so the
  // dock's dot — measured from that edge — sat that much below the toolbar's centre.
  borderBottomWidth: 'calc(1px * var(--editor-chrome, 1))',
  borderStyle: 'solid',
  borderRadius: `var(--editor-radius, ${EDITOR_RADIUS_PX}px)`,
  borderColor: 'rgb(232 220 200 / var(--editor-chrome, 1))',
  // Tailwind's shadow-sm, faded with the chrome
  boxShadow: '0 1px 3px 0 rgb(0 0 0 / calc(0.1 * var(--editor-chrome, 1))), 0 1px 2px -1px rgb(0 0 0 / calc(0.1 * var(--editor-chrome, 1)))',
};
